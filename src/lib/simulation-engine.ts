import type { OHLCVBar } from "../chart/types";
import type { ScriptResult } from "../chart/types";
import { evaluateCustomStrategy } from "../chart/customStrategies";
import type { CustomStrategyDefinition } from "../chart/customStrategies";
import { getTimeframeMs } from "../chart/constants";

export type SessionFilter = "regular" | "extended" | "all";

export interface SimConfig {
  symbol: string;
  strategy: CustomStrategyDefinition;
  timeframe: string;
  rawBars: OHLCVBar[];
  startBarIndex: number;
  sessionFilter: SessionFilter;
  rollDays: boolean;
}

export interface SimTrade {
  entryTime: number;
  entryPrice: number;
  exitTime: number | null;
  exitPrice: number | null;
  side: "long";
  pnl: number | null;
}

export interface SimMetrics {
  totalPnl: number;
  winRate: number;
  sharpe: number;
  maxDrawdown: number;
  profitFactor: number | "∞";
  totalTrades: number;
  avgPnl: number;
}

export interface SimState {
  tfBars: OHLCVBar[];
  trades: SimTrade[];
  openPosition: SimTrade | null;
  scriptResult: ScriptResult | null;
  done: boolean;
  rawBarIndex: number;
  metrics: SimMetrics;
}

const EMPTY_METRICS: SimMetrics = {
  totalPnl: 0,
  winRate: 0,
  sharpe: 0,
  maxDrawdown: 0,
  profitFactor: 0,
  totalTrades: 0,
  avgPnl: 0,
};

// ET offset approximation: UTC-5 hours (ignores DST)
const ET_OFFSET_MS = 5 * 60 * 60 * 1000;

function isInSession(timeMs: number, filter: SessionFilter): boolean {
  if (filter === "all") return true;
  const etMs = timeMs - ET_OFFSET_MS;
  const date = new Date(etMs);
  const minutesFromMidnight = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (filter === "regular") {
    // 9:30 (570) to 16:00 (960)
    return minutesFromMidnight >= 570 && minutesFromMidnight < 960;
  }
  // extended: pre-market (240-570) and after-hours (960-1200) — 4am to 8pm ET
  return minutesFromMidnight >= 240 && minutesFromMidnight < 1200;
}

function bucketMs(timeMs: number, tfMs: number): number {
  return Math.floor(timeMs / tfMs) * tfMs;
}

function computeMetrics(closedTrades: SimTrade[]): SimMetrics {
  if (closedTrades.length === 0) return EMPTY_METRICS;

  const pnls = closedTrades.map((t) => t.pnl ?? 0);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const winners = pnls.filter((p) => p > 0);
  const losers = pnls.filter((p) => p < 0);
  const winRate = closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0;
  const avgPnl = totalPnl / closedTrades.length;

  // Sharpe (annualized, trade-based)
  let sharpe = 0;
  if (pnls.length >= 2) {
    const mean = avgPnl;
    const variance = pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pnls.length;
    const stdDev = Math.sqrt(variance);
    sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
  }

  // Max drawdown on cumulative PnL curve
  let maxDrawdown = 0;
  let peak = 0;
  let cumPnl = 0;
  for (const p of pnls) {
    cumPnl += p;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Profit factor
  const grossWin = winners.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losers.reduce((a, b) => a + b, 0));
  const profitFactor: number | "∞" = grossLoss === 0 ? "∞" : grossWin / grossLoss;

  return {
    totalPnl,
    winRate,
    sharpe,
    maxDrawdown,
    profitFactor,
    totalTrades: closedTrades.length,
    avgPnl,
  };
}

export class SimulationEngine {
  private filteredBars: OHLCVBar[];
  private tfMs: number;
  private strategy: CustomStrategyDefinition;

  private currentIndex = 0;
  private tfBars: OHLCVBar[] = [];
  private partialBar: OHLCVBar | null = null;
  private partialBucket = -1;

  private closedTrades: SimTrade[] = [];
  private openPosition: SimTrade | null = null;
  private scriptResult: ScriptResult | null = null;
  private metrics: SimMetrics = EMPTY_METRICS;

  constructor(config: SimConfig) {
    this.strategy = config.strategy;
    this.tfMs = getTimeframeMs(config.timeframe);

    // Slice from startBarIndex and filter by session
    const sliced = config.rawBars.slice(config.startBarIndex);
    if (config.sessionFilter === "all" && config.rollDays) {
      this.filteredBars = sliced;
    } else {
      this.filteredBars = sliced.filter((bar) => isInSession(bar.time, config.sessionFilter));
    }
  }

  isDone(): boolean {
    return this.currentIndex >= this.filteredBars.length;
  }

  /** Advance one raw (1m) bar. Returns true if a new TF bar was completed. */
  step(): boolean {
    if (this.isDone()) return false;

    const bar = this.filteredBars[this.currentIndex++];
    const bucket = bucketMs(bar.time, this.tfMs);
    let tfBarCompleted = false;

    if (this.partialBar === null || bucket !== this.partialBucket) {
      // Finalize the previous partial bar
      if (this.partialBar !== null) {
        this.tfBars.push(this.partialBar);
        tfBarCompleted = true;
        this.onTfBarCompleted();
      }
      // Start new partial bar
      this.partialBucket = bucket;
      this.partialBar = { ...bar, time: bucket };
    } else {
      // Update the current partial bar
      this.partialBar = {
        time: this.partialBar.time,
        open: this.partialBar.open,
        high: Math.max(this.partialBar.high, bar.high),
        low: Math.min(this.partialBar.low, bar.low),
        close: bar.close,
        volume: this.partialBar.volume + bar.volume,
      };
    }

    return tfBarCompleted;
  }

  private onTfBarCompleted(): void {
    if (this.tfBars.length < 2) return;

    const evaluation = evaluateCustomStrategy(this.strategy, this.tfBars);
    this.scriptResult = evaluation.scriptResult;

    const latestState = evaluation.stateSeries[evaluation.stateSeries.length - 1];
    const lastBar = this.tfBars[this.tfBars.length - 1];

    if (latestState === "BUY" && this.openPosition === null) {
      // Enter long
      this.openPosition = {
        entryTime: lastBar.time,
        entryPrice: lastBar.close,
        exitTime: null,
        exitPrice: null,
        side: "long",
        pnl: null,
      };
    } else if (latestState === "SELL" && this.openPosition !== null) {
      // Close long
      const pnl = lastBar.close - this.openPosition.entryPrice;
      const closed: SimTrade = {
        ...this.openPosition,
        exitTime: lastBar.time,
        exitPrice: lastBar.close,
        pnl,
      };
      this.closedTrades.push(closed);
      this.openPosition = null;
      this.metrics = computeMetrics(this.closedTrades);
    }
  }

  getState(): SimState {
    return {
      tfBars: this.tfBars.slice(),
      trades: this.closedTrades.slice(),
      openPosition: this.openPosition,
      scriptResult: this.scriptResult,
      done: this.isDone(),
      rawBarIndex: this.currentIndex,
      metrics: this.metrics,
    };
  }
}

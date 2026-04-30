import type { OHLCVBar } from "../chart/types";
import type { ScriptResult } from "../chart/types";
import { evaluateCustomStrategy } from "../chart/customStrategies";
import type { CustomStrategyDefinition } from "../chart/customStrategies";
import { getTimeframeMs } from "../chart/constants";

const DAY_MS = 86_400_000;
import { interpretScript } from "../chart/scripting/interpreter";

export type SessionFilter = "regular" | "extended" | "all";

export interface SimConfig {
  symbol: string;
  strategy?: CustomStrategyDefinition;
  timeframe: string;
  rawBars: OHLCVBar[];
  startBarIndex: number;
  sessionFilter: SessionFilter;
  rollDays: boolean;
  /** Deprecated: prefer `positionQty` in qty mode */
  positionSize?: number;
  positionMode?: "qty" | "capital";
  positionQty?: number;
  startingCapital?: number;
  fractionalShares?: boolean;
  /** Capital mode only — compound exits into the next BUY */
  reinvest?: boolean;
  scriptSource?: string;
}

export interface SimTrade {
  entryTime: number;
  entryPrice: number;
  shares: number;
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

const _etFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

function etMinutesFromMidnight(timeMs: number): number {
  const parts = _etFormatter.formatToParts(new Date(timeMs));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  // hour12:false returns 24 as midnight in some engines; normalise
  return (h === 24 ? 0 : h) * 60 + m;
}

function isInSession(timeMs: number, filter: SessionFilter): boolean {
  if (filter === "all") return true;
  const min = etMinutesFromMidnight(timeMs);
  if (filter === "regular") {
    // 9:30 (570) to 16:00 (960)
    return min >= 570 && min < 960;
  }
  // extended: pre-market (240-570) and after-hours (960-1200) — 4am to 8pm ET
  return min >= 240 && min < 1200;
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

/** Build all TF bars from filtered 1m bars (no incremental state). */
function buildAllTfBars(filteredBars: OHLCVBar[], tfMs: number): OHLCVBar[] {
  const result: OHLCVBar[] = [];
  let partial: OHLCVBar | null = null;
  let partialBucket = -1;
  for (const bar of filteredBars) {
    const bucket = bucketMs(bar.time, tfMs);
    if (partial === null || bucket !== partialBucket) {
      if (partial !== null) result.push(partial);
      partialBucket = bucket;
      partial = { ...bar, time: bucket };
    } else {
      partial = {
        time: partial.time,
        open: partial.open,
        high: Math.max(partial.high, bar.high),
        low: Math.min(partial.low, bar.low),
        close: bar.close,
        volume: partial.volume + bar.volume,
      };
    }
  }
  if (partial !== null) result.push(partial);
  return result;
}

/** Extract a BUY/SELL/NEUTRAL signal per bar from a ScriptResult. */
function extractSignals(result: ScriptResult, barCount: number): Array<"BUY" | "SELL" | "NEUTRAL"> {
  const signals: Array<"BUY" | "SELL" | "NEUTRAL"> = new Array(barCount).fill("NEUTRAL");
  for (const shape of result.shapes) {
    const style = shape.style.toLowerCase();
    const text = shape.text.toUpperCase();
    const isBuy = style === "triangleup" || text.includes("BUY");
    const isSell = style === "triangledown" || text.includes("SELL");
    for (let i = 0; i < Math.min(shape.values.length, barCount); i++) {
      if (!Number.isNaN(shape.values[i])) {
        if (isBuy) signals[i] = "BUY";
        else if (isSell) signals[i] = "SELL";
      }
    }
  }
  return signals;
}

/** Slice all arrays in a ScriptResult to `length` bars. */
function sliceScriptResult(result: ScriptResult, length: number): ScriptResult {
  return {
    ...result,
    plots: result.plots.map((p) => ({ ...p, values: p.values.slice(0, length) })),
    shapes: result.shapes.map((s) => ({ ...s, values: s.values.slice(0, length) })),
    fills: result.fills,
    hlines: result.hlines,
    inputs: result.inputs,
    errors: result.errors,
  };
}

export class SimulationEngine {
  private filteredBars: OHLCVBar[];
  private tfMs: number;
  private strategy: CustomStrategyDefinition | undefined;

  private positionMode: "qty" | "capital";
  /** Whole or fractional shares per BUY in qty mode */
  private positionQty: number;
  /** USD pool for sizing in capital mode */
  private cash: number;
  private readonly startingCapital: number;
  private fractionalShares: boolean;
  /** Capital mode: after each exit, reuse full proceeds (`true`) or reset to starting capital (`false`) */
  private reinvest: boolean;

  private currentIndex = 0;
  private tfBars: OHLCVBar[] = [];
  private partialBar: OHLCVBar | null = null;
  private partialBucket = -1;

  private closedTrades: SimTrade[] = [];
  private openPosition: SimTrade | null = null;
  private scriptResult: ScriptResult | null = null;
  private metrics: SimMetrics = EMPTY_METRICS;

  // Script mode: precomputed signals and full result for slicing
  private scriptSignals: Array<"BUY" | "SELL" | "NEUTRAL"> = [];
  private fullScriptResult: ScriptResult | null = null;

  constructor(config: SimConfig) {
    this.strategy = config.strategy;
    this.tfMs = getTimeframeMs(config.timeframe);
    this.positionMode = config.positionMode ?? "qty";
    this.fractionalShares = config.fractionalShares ?? true;
    this.startingCapital =
      typeof config.startingCapital === "number"
      && Number.isFinite(config.startingCapital)
      && config.startingCapital > 0
        ? config.startingCapital
        : 10_000;
    const fallbackQty =
      config.positionQty ?? config.positionSize ?? 1;
    this.positionQty = Number.isFinite(fallbackQty) && (fallbackQty as number) > 0 ? (fallbackQty as number) : 1;
    this.reinvest = config.positionMode === "capital" ? Boolean(config.reinvest) : false;
    this.cash = this.startingCapital;

    // Slice from startBarIndex and filter by session
    const sliced = config.rawBars.slice(config.startBarIndex);
    const isDailyTf =
      getTimeframeMs(config.timeframe) >= DAY_MS;
    // Intraday session clock does not align with daily bar timestamps — use full series for ≥1D TFs.
    if (isDailyTf) {
      this.filteredBars = sliced;
    } else if (config.sessionFilter === "all" && config.rollDays) {
      this.filteredBars = sliced;
    } else {
      this.filteredBars = sliced.filter((bar) =>
        isInSession(bar.time, config.sessionFilter)
      );
    }

    // Precompute script signals if scriptSource provided
    if (config.scriptSource && config.scriptSource.trim()) {
      const allTfBars = buildAllTfBars(this.filteredBars, this.tfMs);
      try {
        const result = interpretScript(config.scriptSource, allTfBars);
        this.fullScriptResult = result;
        this.scriptSignals = extractSignals(result, allTfBars.length);
      } catch {
        this.fullScriptResult = null;
        this.scriptSignals = [];
      }
    }
  }

  private roundShares(raw: number): number {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    if (this.fractionalShares) return Math.round(raw * 1e6) / 1e6;
    return Math.floor(raw);
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

    const lastBar = this.tfBars[this.tfBars.length - 1];
    let latestState: "BUY" | "SELL" | "NEUTRAL";

    if (this.fullScriptResult !== null) {
      // Script mode: use precomputed signals, slice result for chart rendering
      const idx = this.tfBars.length - 1;
      latestState = this.scriptSignals[idx] ?? "NEUTRAL";
      this.scriptResult = sliceScriptResult(this.fullScriptResult, this.tfBars.length);
    } else if (this.strategy) {
      // Strategy mode
      const evaluation = evaluateCustomStrategy(this.strategy, this.tfBars);
      this.scriptResult = evaluation.scriptResult;
      latestState = evaluation.stateSeries[evaluation.stateSeries.length - 1] as "BUY" | "SELL" | "NEUTRAL";
    } else {
      return;
    }

    if (latestState === "BUY" && this.openPosition === null) {
      const price = lastBar.close;
      if (!(price > 0)) return;

      let shares: number;
      if (this.positionMode === "capital") {
        const budget =
          Math.min(this.cash, this.reinvest ? this.cash : this.startingCapital);
        if (!(budget > 0)) return;
        shares = this.roundShares(budget / price);
      } else {
        shares = this.roundShares(this.positionQty);
      }
      if (!(shares > 0)) return;

      const entrySpend = shares * price;
      this.openPosition = {
        entryTime: lastBar.time,
        entryPrice: price,
        shares,
        exitTime: null,
        exitPrice: null,
        side: "long",
        pnl: null,
      };
      if (this.positionMode === "capital") {
        this.cash -= entrySpend;
      }
    } else if (latestState === "SELL" && this.openPosition !== null) {
      const { entryPrice } = this.openPosition;
      const shares = this.openPosition.shares;
      const exitPx = lastBar.close;
      const pnl = (exitPx - entryPrice) * shares;

      if (this.positionMode === "capital") {
        const proceeds = shares * exitPx;
        this.cash = this.reinvest
          ? this.cash + proceeds
          : this.startingCapital;
      }

      const closed: SimTrade = {
        ...this.openPosition,
        exitTime: lastBar.time,
        exitPrice: exitPx,
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

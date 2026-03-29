import type { ScriptResult } from "./types";
import type { OHLCVBar } from "./types";
import { computeIndicator } from "./indicators/compute";
import { indicatorRegistry } from "./indicators/registry";

export type StrategyState = "BUY" | "SELL" | "NEUTRAL";
export type CustomStrategyValueSourceKind = "indicator" | "quote";
export type CustomStrategyScoreOperator = "above" | "below" | "equal" | "notEqual";

export type CustomStrategyIndicatorKey =
  | "Technical Score"
  | "DailyIQ Tech Score Signal"
  | "Liquidity Sweep Signal"
  | "Market Sentiment"
  | "Market Sentiment Signal"
  | "Trend Angle"
  | "Bull Bear Power"
  | "Supertrend"
  | "Linear Regression"
  | "Market Structure"
  | "RSI"
  | "RSI Strategy"
  | "MACD"
  | "MACD Crossover"
  | "EMA"
  | "SMA"
  | "EMA 9/14 Crossover"
  | "EMA 5/20 Crossover"
  | "Golden/Death Cross"
  | "CCI"
  | "ATR"
  | "Stochastic"
  | "Stochastic RSI"
  | "Williams %R"
  | "ROC"
  | "MFI"
  | "VWAP"
  | "OBV"
  | "ADL"
  | "ADL Crossover"
  | "Structure Breaks"
  | "Volume";

export interface CustomStrategyIndicatorSource {
  sourceKind: "indicator";
  indicatorKey: CustomStrategyIndicatorKey;
  params: Record<string, number>;
  output: string;
}

export interface CustomStrategyQuoteSource {
  sourceKind: "quote";
  field: "last" | "open" | "high" | "low" | "prevClose" | "change" | "changePct" | "volume";
}

export type CustomStrategyValueSource = CustomStrategyIndicatorSource | CustomStrategyQuoteSource;

export interface CustomStrategyCondition {
  left: CustomStrategyValueSource;
  operator: CustomStrategyScoreOperator;
  targetType: "value" | "source";
  threshold: number;
  right?: CustomStrategyValueSource;
}

export interface CustomStrategyDefinition {
  id: string;
  name: string;
  conditions: CustomStrategyCondition[];
  buyThreshold: number;
  sellThreshold: number;
}

export interface CustomStrategyEvaluation {
  scoreSeries: number[];
  stateSeries: StrategyState[];
  latestScore: number | null;
  latestState: StrategyState;
  scriptResult: ScriptResult;
}

export const CUSTOM_STRATEGY_INDICATOR_KEYS: CustomStrategyIndicatorKey[] = [
  "Technical Score",
  "DailyIQ Tech Score Signal",
  "Liquidity Sweep Signal",
  "Market Sentiment",
  "Market Sentiment Signal",
  "Trend Angle",
  "Bull Bear Power",
  "Supertrend",
  "Linear Regression",
  "Market Structure",
  "RSI",
  "RSI Strategy",
  "MACD",
  "MACD Crossover",
  "EMA",
  "SMA",
  "EMA 9/14 Crossover",
  "EMA 5/20 Crossover",
  "Golden/Death Cross",
  "CCI",
  "ATR",
  "Stochastic",
  "Stochastic RSI",
  "Williams %R",
  "ROC",
  "MFI",
  "VWAP",
  "OBV",
  "ADL",
  "ADL Crossover",
  "Structure Breaks",
  "Volume",
];

export const CUSTOM_STRATEGY_QUOTE_FIELDS: Array<{ value: CustomStrategyQuoteSource["field"]; label: string }> = [
  { value: "last", label: "Last" },
  { value: "open", label: "Open" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
  { value: "prevClose", label: "Prev Close" },
  { value: "change", label: "Change" },
  { value: "changePct", label: "Change %" },
  { value: "volume", label: "Volume" },
];

export function makeCustomStrategyIndicatorSource(indicatorKey: CustomStrategyIndicatorKey = "Technical Score"): CustomStrategyIndicatorSource {
  const meta = indicatorRegistry[indicatorKey];
  return {
    sourceKind: "indicator",
    indicatorKey,
    params: { ...meta.defaultParams },
    output: meta.outputs[0]?.key ?? "value",
  };
}

export function makeCustomStrategyQuoteSource(field: CustomStrategyQuoteSource["field"] = "last"): CustomStrategyQuoteSource {
  return { sourceKind: "quote", field };
}

export function getCustomStrategySourceLabel(source: CustomStrategyValueSource): string {
  if (source.sourceKind === "quote") {
    return CUSTOM_STRATEGY_QUOTE_FIELDS.find((item) => item.value === source.field)?.label ?? source.field;
  }
  const meta = indicatorRegistry[source.indicatorKey];
  const output = meta.outputs.find((item) => item.key === source.output);
  return output ? `${meta.shortName} ${output.label}` : meta.shortName;
}

function sourceCacheKey(source: CustomStrategyValueSource): string {
  return JSON.stringify(source);
}

function resolveOperator(left: number, right: number, operator: CustomStrategyScoreOperator): boolean {
  switch (operator) {
    case "above":
      return left > right;
    case "below":
      return left < right;
    case "equal":
      return left === right;
    case "notEqual":
      return left !== right;
  }
}

function toPriceSeries(field: CustomStrategyQuoteSource["field"], bars: OHLCVBar[]): number[] {
  return bars.map((bar, index) => {
    const prevClose = index > 0 ? bars[index - 1]?.close ?? NaN : NaN;
    switch (field) {
      case "last":
        return bar.close;
      case "open":
        return bar.open;
      case "high":
        return bar.high;
      case "low":
        return bar.low;
      case "prevClose":
        return prevClose;
      case "change":
        return Number.isFinite(prevClose) ? bar.close - prevClose : NaN;
      case "changePct":
        return Number.isFinite(prevClose) && prevClose !== 0 ? ((bar.close - prevClose) / prevClose) * 100 : NaN;
      case "volume":
        return bar.volume;
    }
  });
}

function normalizeIndicatorOutput(source: CustomStrategyIndicatorSource, bars: OHLCVBar[]): number[] {
  const meta = indicatorRegistry[source.indicatorKey];
  const data = computeIndicator(source.indicatorKey, bars, source.params);
  const outputIndex = meta.outputs.findIndex((output) => output.key === source.output);
  const series = outputIndex >= 0 ? (data[outputIndex] ?? []) : [];
  const outputMeta = outputIndex >= 0 ? meta.outputs[outputIndex] : undefined;
  if (outputMeta?.style === "markers") {
    return bars.map((_, index) => (Number.isFinite(series[index]) ? 1 : 0));
  }
  return bars.map((_, index) => (Number.isFinite(series[index]) ? series[index] : NaN));
}

function evaluateSource(
  source: CustomStrategyValueSource,
  bars: OHLCVBar[],
  cache: Map<string, number[]>,
): number[] {
  const cacheKey = sourceCacheKey(source);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const values = source.sourceKind === "quote"
    ? toPriceSeries(source.field, bars)
    : normalizeIndicatorOutput(source, bars);
  cache.set(cacheKey, values);
  return values;
}

function deriveState(score: number | null, buyThreshold: number, sellThreshold: number): StrategyState {
  if (score == null || Number.isNaN(score)) return "NEUTRAL";
  if (score >= buyThreshold) return "BUY";
  if (score <= sellThreshold) return "SELL";
  return "NEUTRAL";
}

function clampThreshold(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

export function createDefaultCustomStrategy(name = "Custom Strategy"): CustomStrategyDefinition {
  return {
    id: `custom_strategy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: makeCustomStrategyIndicatorSource("Technical Score"),
        operator: "above",
        targetType: "value",
        threshold: 50,
      },
    ],
  };
}

export function evaluateCustomStrategy(
  strategy: CustomStrategyDefinition,
  bars: OHLCVBar[],
): CustomStrategyEvaluation {
  const cache = new Map<string, number[]>();
  const len = bars.length;
  const scoreSeries = new Array<number>(len).fill(NaN);
  const stateSeries = new Array<StrategyState>(len).fill("NEUTRAL");
  const buyValues = new Array<number>(len).fill(NaN);
  const sellValues = new Array<number>(len).fill(NaN);
  const buyThreshold = clampThreshold(strategy.buyThreshold, 70);
  const sellThreshold = clampThreshold(strategy.sellThreshold, 30);

  for (let i = 0; i < len; i += 1) {
    let total = 0;
    let matches = 0;

    for (const condition of strategy.conditions) {
      const leftSeries = evaluateSource(condition.left, bars, cache);
      const left = leftSeries[i];
      if (!Number.isFinite(left)) continue;

      let right: number;
      if (condition.targetType === "value") {
        right = condition.threshold;
      } else {
        const rightSeries = evaluateSource(condition.right as CustomStrategyValueSource, bars, cache);
        right = rightSeries[i];
      }
      if (!Number.isFinite(right)) continue;

      total += 1;
      if (resolveOperator(left, right, condition.operator)) matches += 1;
    }

    const score = total === 0 ? NaN : Math.round((matches / total) * 100);
    scoreSeries[i] = score;
    stateSeries[i] = deriveState(Number.isFinite(score) ? score : null, buyThreshold, sellThreshold);
  }

  for (let i = 1; i < len; i += 1) {
    const prev = stateSeries[i - 1];
    const curr = stateSeries[i];
    if (curr === "BUY" && prev !== "BUY") {
      buyValues[i] = bars[i]?.low ?? NaN;
    } else if (curr === "SELL" && prev !== "SELL") {
      sellValues[i] = bars[i]?.high ?? NaN;
    }
  }

  const latestScore = [...scoreSeries].reverse().find((value) => Number.isFinite(value));
  const latestState = deriveState(
    typeof latestScore === "number" ? latestScore : null,
    buyThreshold,
    sellThreshold,
  );

  return {
    scoreSeries,
    stateSeries,
    latestScore: typeof latestScore === "number" ? latestScore : null,
    latestState,
    scriptResult: {
      plots: [],
      hlines: [],
      fills: [],
      shapes: [
        {
          values: buyValues,
          style: "triangleup",
          location: "belowbar",
          color: "#0EA5E9",
          text: "BUY",
        },
        {
          values: sellValues,
          style: "triangledown",
          location: "abovebar",
          color: "#F97316",
          text: "SELL",
        },
      ],
      inputs: {},
      errors: [],
      indicatorMeta: { name: strategy.name, overlay: true, isStrategy: true },
    },
  };
}

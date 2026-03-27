import type { TaScoreTimeframe } from "./ta-score-timeframes";
import { TA_SCORE_TIMEFRAMES } from "./ta-score-timeframes";

// ─── Custom Column Type System ──────────────────────────────────────
// expression  — legacy JS expression (backward compat)
// indicator   — single indicator value (RSI, MACD signal, etc.)
// crossover   — boolean comparison between two indicator outputs
// score       — composite 0-100 from multiple indicator conditions

export type IndicatorType =
  | "PRICE"
  | "RSI"
  | "EMA"
  | "SMA"
  | "MACD"
  | "CCI"
  | "StochK"
  | "StochRSI"
  | "BBP"
  | "VWAP"
  | "ATR";

export type Timeframe = TaScoreTimeframe;

export type IndicatorParams = Record<string, number>;

export interface IndicatorRequestSpec {
  type: IndicatorType;
  timeframe: string;
  params: IndicatorParams;
  output?: string;
}

export interface IndicatorCatalogEntry {
  label: string;
  defaults: IndicatorParams;
  paramOrder: string[];
  paramLabels: Record<string, string>;
  paramHelp?: Record<string, string>;
  outputs?: Array<{ key: string; label: string }>;
}

export const AVAILABLE_TIMEFRAMES: Timeframe[] = [...TA_SCORE_TIMEFRAMES];

export const INDICATOR_CATALOG: Record<IndicatorType, IndicatorCatalogEntry> = {
  PRICE: {
    label: "Price",
    defaults: {},
    paramOrder: [],
    paramLabels: {},
    outputs: [
      { key: "last", label: "Last" },
      { key: "open", label: "Open" },
      { key: "high", label: "High" },
      { key: "low", label: "Low" },
      { key: "prevClose", label: "Prev Close" },
      { key: "mid", label: "Mid" },
      { key: "bid", label: "Bid" },
      { key: "ask", label: "Ask" },
    ],
  },
  RSI: {
    label: "RSI",
    defaults: { period: 14 },
    paramOrder: ["period"],
    paramLabels: { period: "Period" },
    paramHelp: { period: "Bars used to calculate RSI." },
    outputs: [{ key: "value", label: "RSI" }],
  },
  EMA: {
    label: "EMA",
    defaults: { period: 20 },
    paramOrder: ["period"],
    paramLabels: { period: "Period" },
    paramHelp: { period: "Bars used for the EMA line." },
    outputs: [{ key: "value", label: "EMA" }],
  },
  SMA: {
    label: "SMA",
    defaults: { period: 20 },
    paramOrder: ["period"],
    paramLabels: { period: "Period" },
    paramHelp: { period: "Bars used for the SMA line." },
    outputs: [{ key: "value", label: "SMA" }],
  },
  MACD: {
    label: "MACD",
    defaults: { fast: 12, slow: 26, signal: 9 },
    paramOrder: ["fast", "slow", "signal"],
    paramLabels: { fast: "Fast", slow: "Slow", signal: "Signal" },
    paramHelp: {
      fast: "Fast EMA length.",
      slow: "Slow EMA length.",
      signal: "Signal EMA length.",
    },
    outputs: [
      { key: "macd", label: "MACD" },
      { key: "signal", label: "Signal" },
      { key: "histogram", label: "Histogram" },
    ],
  },
  CCI: {
    label: "CCI",
    defaults: { period: 20 },
    paramOrder: ["period"],
    paramLabels: { period: "Period" },
    paramHelp: { period: "Bars used for the CCI lookback." },
    outputs: [{ key: "value", label: "CCI" }],
  },
  StochK: {
    label: "StochK",
    defaults: { period: 14, smooth: 3 },
    paramOrder: ["period", "smooth"],
    paramLabels: { period: "%K Period", smooth: "Smooth" },
    paramHelp: {
      period: "Bars used for the high/low lookback.",
      smooth: "Smoothing applied to %K.",
    },
    outputs: [{ key: "k", label: "%K" }],
  },
  StochRSI: {
    label: "StochRSI",
    defaults: { period: 14, smooth: 3 },
    paramOrder: ["period", "smooth"],
    paramLabels: { period: "RSI Period", smooth: "Smooth" },
    paramHelp: {
      period: "Bars used to compute RSI before stochastic normalization.",
      smooth: "Smoothing applied to the final %K line.",
    },
    outputs: [{ key: "k", label: "Stoch RSI %K" }],
  },
  BBP: {
    label: "BBP",
    defaults: { period: 20, stdDev: 2 },
    paramOrder: ["period", "stdDev"],
    paramLabels: { period: "Period", stdDev: "Std Dev" },
    paramHelp: {
      period: "Bars used for the moving average.",
      stdDev: "Band width in standard deviations.",
    },
    outputs: [{ key: "value", label: "BBP" }],
  },
  VWAP: {
    label: "VWAP",
    defaults: {},
    paramOrder: [],
    paramLabels: {},
    outputs: [{ key: "value", label: "VWAP" }],
  },
  ATR: {
    label: "ATR",
    defaults: { period: 14 },
    paramOrder: ["period"],
    paramLabels: { period: "Period" },
    paramHelp: { period: "Bars used for the ATR smoothing." },
    outputs: [{ key: "value", label: "ATR" }],
  },
};

export const INDICATOR_TYPES: IndicatorType[] = Object.keys(INDICATOR_CATALOG) as IndicatorType[];

function cloneParams(params: IndicatorParams): IndicatorParams {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Number(value)]));
}

export function getDefaultIndicatorParams(type: IndicatorType): IndicatorParams {
  return cloneParams(INDICATOR_CATALOG[type].defaults);
}

export function getDefaultIndicatorOutput(type: IndicatorType): string | undefined {
  return INDICATOR_CATALOG[type].outputs?.[0]?.key;
}

export function getIndicatorOutputs(type: IndicatorType): Array<{ key: string; label: string }> {
  return INDICATOR_CATALOG[type].outputs ?? [];
}

export function getIndicatorCatalogEntry(type: IndicatorType): IndicatorCatalogEntry {
  return INDICATOR_CATALOG[type];
}

interface CustomColumnBase {
  id: string;
  label: string;
  width: number;
  decimals?: number;
  color?: string;
  colorize?: boolean;
}

export interface ExpressionColumn extends CustomColumnBase {
  kind: "expression";
  expression: string;
}

export interface IndicatorColumn extends CustomColumnBase {
  kind: "indicator";
  indicatorType: IndicatorType;
  timeframe: Timeframe;
  params: IndicatorParams;
  output?: string;
}

export interface IndicatorRef {
  type: IndicatorType;
  params: IndicatorParams;
  output?: string;
}

export interface CrossoverCombo {
  indicatorA: IndicatorRef;
  indicatorB: IndicatorRef;
}

export interface CrossoverColumn extends CustomColumnBase {
  kind: "crossover";
  timeframe: Timeframe;
  combos: CrossoverCombo[];
}

export interface ScoreCondition {
  indicatorType: IndicatorType;
  params: IndicatorParams;
  output?: string;
  comparison: "above" | "below";
  threshold: number;
}

export interface ScoreColumn extends CustomColumnBase {
  kind: "score";
  timeframe: Timeframe;
  conditions: ScoreCondition[];
}

export type CustomColumnDef =
  | ExpressionColumn
  | IndicatorColumn
  | CrossoverColumn
  | ScoreColumn;

function normalizeColor(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
}

function normalizeDecimals(raw: unknown, fallback = 0): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function normalizeWidth(raw: unknown, fallback = 54): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function paramsFromLegacy(type: IndicatorType, raw: Record<string, unknown>): IndicatorParams {
  const defaults = getDefaultIndicatorParams(type);
  if (raw.params && typeof raw.params === "object" && raw.params !== null) {
    return Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => {
        const value = (raw.params as Record<string, unknown>)[key];
        return [key, typeof value === "number" && Number.isFinite(value) ? value : fallback];
      }),
    );
  }

  if ("period" in raw && typeof raw.period === "number" && Number.isFinite(raw.period)) {
    const firstKey = Object.keys(defaults)[0];
    if (!firstKey) return {};
    return { ...defaults, [firstKey]: raw.period };
  }

  return defaults;
}

function normalizeOutput(type: IndicatorType, raw: unknown): string | undefined {
  const outputs = INDICATOR_CATALOG[type].outputs ?? [];
  if (typeof raw === "string" && outputs.some((output) => output.key === raw)) {
    return raw;
  }
  return outputs[0]?.key;
}

/** Normalize legacy columns (no `kind` field) to ExpressionColumn. */
export function migrateColumn(raw: Record<string, unknown>): CustomColumnDef {
  if (!("kind" in raw)) {
    return {
      id: String(raw.id ?? `col_${Date.now()}`),
      kind: "expression",
      label: String(raw.label ?? "Custom"),
      width: normalizeWidth(raw.width),
      decimals: normalizeDecimals(raw.decimals, 0),
      color: normalizeColor(raw.color),
      expression: String(raw.expression ?? ""),
    };
  }

  const base = {
    id: String(raw.id ?? `col_${Date.now()}`),
    label: String(raw.label ?? "Custom"),
    width: normalizeWidth(raw.width),
    decimals: normalizeDecimals(raw.decimals, 0),
    color: normalizeColor(raw.color),
    colorize: typeof raw.colorize === "boolean" ? raw.colorize : undefined,
  };

  switch (raw.kind) {
    case "expression":
      return {
        ...base,
        kind: "expression",
        expression: String(raw.expression ?? ""),
      };
    case "indicator": {
      const indicatorType = String(raw.indicatorType ?? "RSI") as IndicatorType;
      return {
        ...base,
        kind: "indicator",
        indicatorType,
        timeframe: String(raw.timeframe ?? "1h") as Timeframe,
        params: paramsFromLegacy(indicatorType, raw),
        output: normalizeOutput(indicatorType, raw.output),
      };
    }
    case "crossover": {
      const normalizeIndicatorRef = (item: Record<string, unknown> | undefined, fallback: IndicatorType): IndicatorRef => {
        const rawRef = item ?? {};
        const type = String(rawRef.type ?? fallback) as IndicatorType;
        return {
          type,
          params: paramsFromLegacy(type, rawRef),
          output: normalizeOutput(type, rawRef.output),
        };
      };

      const combos = Array.isArray(raw.combos)
        ? raw.combos.map((combo, idx) => {
            const item = (combo as Record<string, unknown>) ?? {};
            return {
              indicatorA: normalizeIndicatorRef(item.indicatorA as Record<string, unknown> | undefined, idx === 0 ? "EMA" : "RSI"),
              indicatorB: normalizeIndicatorRef(item.indicatorB as Record<string, unknown> | undefined, "EMA"),
            };
          })
        : [{
            indicatorA: normalizeIndicatorRef(raw.indicatorA as Record<string, unknown> | undefined, "EMA"),
            indicatorB: normalizeIndicatorRef(raw.indicatorB as Record<string, unknown> | undefined, "EMA"),
          }];

      return {
        id: base.id,
        label: base.label,
        width: base.width,
        color: base.color,
        kind: "crossover",
        timeframe: String(raw.timeframe ?? "1h") as Timeframe,
        combos: combos.length > 0 ? combos : [{
          indicatorA: normalizeIndicatorRef(undefined, "EMA"),
          indicatorB: normalizeIndicatorRef(undefined, "EMA"),
        }],
      };
    }
    case "score":
      return {
        ...base,
        kind: "score",
        timeframe: String(raw.timeframe ?? "1h") as Timeframe,
        conditions: Array.isArray(raw.conditions)
          ? raw.conditions.map((condition) => {
              const item = (condition as Record<string, unknown>) ?? {};
              const indicatorType = String(item.indicatorType ?? "RSI") as IndicatorType;
              return {
                indicatorType,
                params: paramsFromLegacy(indicatorType, item),
                output: normalizeOutput(indicatorType, item.output),
                comparison: item.comparison === "below" ? "below" : "above",
                threshold: typeof item.threshold === "number" && Number.isFinite(item.threshold) ? item.threshold : 0,
              };
            })
          : [],
      };
    default:
      return {
        ...base,
        kind: "expression",
        expression: String(raw.expression ?? ""),
      };
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function indicatorKey(spec: IndicatorRequestSpec): string {
  return stableSerialize({
    type: spec.type,
    timeframe: spec.timeframe,
    params: Object.fromEntries(Object.entries(spec.params).sort(([a], [b]) => a.localeCompare(b))),
    output: spec.output ?? null,
  });
}

function addRequest(
  requests: IndicatorRequestSpec[],
  seen: Set<string>,
  spec: IndicatorRequestSpec,
) {
  const key = indicatorKey(spec);
  if (!seen.has(key)) {
    seen.add(key);
    requests.push(spec);
  }
}

export function extractIndicatorRequests(columns: CustomColumnDef[]): IndicatorRequestSpec[] {
  const seen = new Set<string>();
  const requests: IndicatorRequestSpec[] = [];

  for (const col of columns) {
    switch (col.kind) {
      case "indicator":
        if (col.indicatorType !== "PRICE") {
          addRequest(requests, seen, {
            type: col.indicatorType,
            timeframe: col.timeframe,
            params: cloneParams(col.params),
            output: col.output,
          });
        }
        break;
      case "crossover":
        for (const combo of col.combos) {
          if (combo.indicatorA.type !== "PRICE") {
            addRequest(requests, seen, {
              type: combo.indicatorA.type,
              timeframe: col.timeframe,
              params: cloneParams(combo.indicatorA.params),
              output: combo.indicatorA.output,
            });
          }
          if (combo.indicatorB.type !== "PRICE") {
            addRequest(requests, seen, {
              type: combo.indicatorB.type,
              timeframe: col.timeframe,
              params: cloneParams(combo.indicatorB.params),
              output: combo.indicatorB.output,
            });
          }
        }
        break;
      case "score":
        for (const cond of col.conditions) {
          if (cond.indicatorType !== "PRICE") {
            addRequest(requests, seen, {
              type: cond.indicatorType,
              timeframe: col.timeframe,
              params: cloneParams(cond.params),
              output: cond.output,
            });
          }
        }
        break;
      default:
        break;
    }
  }

  return requests;
}

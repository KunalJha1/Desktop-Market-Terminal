import type { TaScoreTimeframe } from "./ta-score-timeframes";
import { TA_SCORE_TIMEFRAMES } from "./ta-score-timeframes";

// ─── Custom Column Type System ──────────────────────────────────────
// expression  — JS expression over quote + symbol metadata
// indicator   — display a single value source
// crossover   — compare two value sources across one or more combos
// score       — composite 0-100 from multiple source comparisons

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

export type QuoteField =
  | "last"
  | "open"
  | "high"
  | "low"
  | "prevClose"
  | "change"
  | "changePct"
  | "volume"
  | "bid"
  | "ask"
  | "mid"
  | "spread"
  | "week52High"
  | "week52Low"
  | "trailingPE"
  | "forwardPE"
  | "marketCap";

export type MetaField = "symbol" | "name" | "sector" | "industry" | "indexWeight";

export type EtfField =
  | "isEtf"
  | "holdingCount"
  | "topHoldingWeight"
  | "topHoldingSymbol"
  | "topHoldingName";

export type ValueSourceKind = "indicator" | "quote" | "meta" | "etf";
export type ScoreOperator = "above" | "below" | "equal" | "notEqual";

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

export interface IndicatorValueSource {
  sourceKind: "indicator";
  indicatorType: IndicatorType;
  timeframe: Timeframe;
  params: IndicatorParams;
  output?: string;
}

export interface QuoteValueSource {
  sourceKind: "quote";
  field: QuoteField;
}

export interface MetaValueSource {
  sourceKind: "meta";
  field: MetaField;
}

export interface EtfValueSource {
  sourceKind: "etf";
  field: EtfField;
}

export type ValueSource =
  | IndicatorValueSource
  | QuoteValueSource
  | MetaValueSource
  | EtfValueSource;

export const AVAILABLE_TIMEFRAMES: Timeframe[] = [...TA_SCORE_TIMEFRAMES];

export const QUOTE_FIELD_OPTIONS: Array<{ value: QuoteField; label: string }> = [
  { value: "last", label: "Last" },
  { value: "open", label: "Open" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
  { value: "prevClose", label: "Prev Close" },
  { value: "change", label: "Change" },
  { value: "changePct", label: "Change %" },
  { value: "volume", label: "Volume" },
  { value: "bid", label: "Bid" },
  { value: "ask", label: "Ask" },
  { value: "mid", label: "Mid" },
  { value: "spread", label: "Spread" },
  { value: "week52High", label: "52W High" },
  { value: "week52Low", label: "52W Low" },
  { value: "trailingPE", label: "Trailing P/E" },
  { value: "forwardPE", label: "Forward P/E" },
  { value: "marketCap", label: "Market Cap" },
];

export const META_FIELD_OPTIONS: Array<{ value: MetaField; label: string }> = [
  { value: "symbol", label: "Symbol" },
  { value: "name", label: "Name" },
  { value: "sector", label: "Sector" },
  { value: "industry", label: "Industry" },
  { value: "indexWeight", label: "Index Weight" },
];

export const ETF_FIELD_OPTIONS: Array<{ value: EtfField; label: string }> = [
  { value: "isEtf", label: "Is ETF" },
  { value: "holdingCount", label: "Holding Count" },
  { value: "topHoldingWeight", label: "Top Holding Weight" },
  { value: "topHoldingSymbol", label: "Top Holding Symbol" },
  { value: "topHoldingName", label: "Top Holding Name" },
];

export const INDICATOR_CATALOG: Record<IndicatorType, IndicatorCatalogEntry> = {
  PRICE: {
    label: "Price",
    defaults: {},
    paramOrder: [],
    paramLabels: {},
    outputs: QUOTE_FIELD_OPTIONS.filter((item) =>
      ["last", "open", "high", "low", "prevClose", "mid", "bid", "ask"].includes(item.value),
    ).map((item) => ({ key: item.value, label: item.label })),
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

export function makeIndicatorValueSource(
  indicatorType: IndicatorType,
  timeframe: Timeframe = "1h",
  params: IndicatorParams = getDefaultIndicatorParams(indicatorType),
  output: string | undefined = getDefaultIndicatorOutput(indicatorType),
): IndicatorValueSource {
  return {
    sourceKind: "indicator",
    indicatorType,
    timeframe,
    params: cloneParams(params),
    output,
  };
}

export function getDefaultValueSource(kind: ValueSourceKind = "indicator"): ValueSource {
  switch (kind) {
    case "quote":
      return { sourceKind: "quote", field: "last" };
    case "meta":
      return { sourceKind: "meta", field: "symbol" };
    case "etf":
      return { sourceKind: "etf", field: "isEtf" };
    default:
      return makeIndicatorValueSource("RSI");
  }
}

export function getValueSourceLabel(source: ValueSource): string {
  if (source.sourceKind === "indicator") {
    const outputLabel = getIndicatorOutputs(source.indicatorType).find((item) => item.key === source.output)?.label;
    return outputLabel ? `${source.indicatorType} ${outputLabel}` : source.indicatorType;
  }
  if (source.sourceKind === "quote") {
    return QUOTE_FIELD_OPTIONS.find((item) => item.value === source.field)?.label ?? source.field;
  }
  if (source.sourceKind === "meta") {
    return META_FIELD_OPTIONS.find((item) => item.value === source.field)?.label ?? source.field;
  }
  return ETF_FIELD_OPTIONS.find((item) => item.value === source.field)?.label ?? source.field;
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
  source: ValueSource;
}

export interface CrossoverCombo {
  left: ValueSource;
  right: ValueSource;
}

export interface CrossoverColumn extends CustomColumnBase {
  kind: "crossover";
  combos: CrossoverCombo[];
}

export interface ScoreCondition {
  left: ValueSource;
  operator: ScoreOperator;
  targetType: "value" | "source";
  threshold: number;
  right?: ValueSource;
}

export interface ScoreColumn extends CustomColumnBase {
  kind: "score";
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

function normalizeTimeframe(raw: unknown, fallback: Timeframe = "1h"): Timeframe {
  const value = typeof raw === "string" ? raw : fallback;
  return (AVAILABLE_TIMEFRAMES.includes(value as Timeframe) ? value : fallback) as Timeframe;
}

function normalizeQuoteField(raw: unknown, fallback: QuoteField = "last"): QuoteField {
  return QUOTE_FIELD_OPTIONS.some((item) => item.value === raw) ? (raw as QuoteField) : fallback;
}

function normalizeMetaField(raw: unknown, fallback: MetaField = "symbol"): MetaField {
  return META_FIELD_OPTIONS.some((item) => item.value === raw) ? (raw as MetaField) : fallback;
}

function normalizeEtfField(raw: unknown, fallback: EtfField = "isEtf"): EtfField {
  return ETF_FIELD_OPTIONS.some((item) => item.value === raw) ? (raw as EtfField) : fallback;
}

function normalizeValueSource(
  raw: Record<string, unknown> | undefined,
  fallback: ValueSource = makeIndicatorValueSource("RSI"),
  legacyTimeframe?: Timeframe,
): ValueSource {
  const item = raw ?? {};
  const sourceKind = item.sourceKind;
  if (sourceKind === "quote") {
    return { sourceKind, field: normalizeQuoteField(item.field) };
  }
  if (sourceKind === "meta") {
    return { sourceKind, field: normalizeMetaField(item.field) };
  }
  if (sourceKind === "etf") {
    return { sourceKind, field: normalizeEtfField(item.field) };
  }

  const indicatorType = String(
    item.indicatorType ?? item.type ?? ("indicatorType" in fallback && fallback.indicatorType) ?? "RSI",
  ) as IndicatorType;

  if (indicatorType === "PRICE") {
    return {
      sourceKind: "quote",
      field: normalizeQuoteField(item.output),
    };
  }

  return {
    sourceKind: "indicator",
    indicatorType,
    timeframe: normalizeTimeframe(item.timeframe, legacyTimeframe ?? ("timeframe" in fallback ? fallback.timeframe : "1h")),
    params: paramsFromLegacy(indicatorType, item),
    output: normalizeOutput(indicatorType, item.output),
  };
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
      const legacyIndicatorType = String(raw.indicatorType ?? "RSI") as IndicatorType;
      const legacyTimeframe = normalizeTimeframe(raw.timeframe);
      return {
        ...base,
        kind: "indicator",
        source: raw.source && typeof raw.source === "object"
          ? normalizeValueSource(raw.source as Record<string, unknown>, makeIndicatorValueSource("RSI"), legacyTimeframe)
          : normalizeValueSource(
              {
                indicatorType: legacyIndicatorType,
                timeframe: legacyTimeframe,
                params: raw.params,
                output: raw.output,
              },
              makeIndicatorValueSource("RSI"),
            ),
      };
    }
    case "crossover": {
      const legacyTimeframe = normalizeTimeframe(raw.timeframe);
      const combos = Array.isArray(raw.combos)
        ? raw.combos.map((combo, idx) => {
            const item = (combo as Record<string, unknown>) ?? {};
            return {
              left: item.left && typeof item.left === "object"
                ? normalizeValueSource(item.left as Record<string, unknown>, makeIndicatorValueSource(idx === 0 ? "EMA" : "RSI"), legacyTimeframe)
                : normalizeValueSource(item.indicatorA as Record<string, unknown> | undefined, makeIndicatorValueSource(idx === 0 ? "EMA" : "RSI"), legacyTimeframe),
              right: item.right && typeof item.right === "object"
                ? normalizeValueSource(item.right as Record<string, unknown>, makeIndicatorValueSource("EMA"), legacyTimeframe)
                : normalizeValueSource(item.indicatorB as Record<string, unknown> | undefined, makeIndicatorValueSource("EMA"), legacyTimeframe),
            };
          })
        : [{
            left: normalizeValueSource(raw.indicatorA as Record<string, unknown> | undefined, makeIndicatorValueSource("EMA"), legacyTimeframe),
            right: normalizeValueSource(raw.indicatorB as Record<string, unknown> | undefined, makeIndicatorValueSource("EMA"), legacyTimeframe),
          }];

      return {
        ...base,
        kind: "crossover",
        combos: combos.length > 0 ? combos : [{
          left: makeIndicatorValueSource("EMA", legacyTimeframe, { period: 9 }),
          right: makeIndicatorValueSource("EMA", legacyTimeframe, { period: 21 }),
        }],
      };
    }
    case "score": {
      const legacyTimeframe = normalizeTimeframe(raw.timeframe);
      return {
        ...base,
        kind: "score",
        conditions: Array.isArray(raw.conditions)
          ? raw.conditions.map((condition) => {
              const item = (condition as Record<string, unknown>) ?? {};
              const legacyIndicatorType = String(item.indicatorType ?? "RSI") as IndicatorType;
              return {
                left: item.left && typeof item.left === "object"
                  ? normalizeValueSource(item.left as Record<string, unknown>, makeIndicatorValueSource("RSI"), legacyTimeframe)
                  : normalizeValueSource(
                      {
                        indicatorType: legacyIndicatorType,
                        timeframe: legacyTimeframe,
                        params: item.params,
                        output: item.output,
                      },
                      makeIndicatorValueSource("RSI"),
                    ),
                operator: item.operator === "below" || item.operator === "equal" || item.operator === "notEqual"
                  ? item.operator
                  : item.comparison === "below"
                    ? "below"
                    : "above",
                targetType: item.targetType === "source" ? "source" : "value",
                threshold: typeof item.threshold === "number" && Number.isFinite(item.threshold) ? item.threshold : 0,
                right: item.right && typeof item.right === "object"
                  ? normalizeValueSource(item.right as Record<string, unknown>, { sourceKind: "quote", field: "last" })
                  : undefined,
              };
            })
          : [],
      };
    }
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

function addValueSourceRequest(
  requests: IndicatorRequestSpec[],
  seen: Set<string>,
  source: ValueSource | undefined,
) {
  if (!source || source.sourceKind !== "indicator") return;
  addRequest(requests, seen, {
    type: source.indicatorType,
    timeframe: source.timeframe,
    params: cloneParams(source.params),
    output: source.output,
  });
}

export function extractIndicatorRequests(columns: CustomColumnDef[]): IndicatorRequestSpec[] {
  const seen = new Set<string>();
  const requests: IndicatorRequestSpec[] = [];

  for (const col of columns) {
    switch (col.kind) {
      case "indicator":
        addValueSourceRequest(requests, seen, col.source);
        break;
      case "crossover":
        for (const combo of col.combos) {
          addValueSourceRequest(requests, seen, combo.left);
          addValueSourceRequest(requests, seen, combo.right);
        }
        break;
      case "score":
        for (const cond of col.conditions) {
          addValueSourceRequest(requests, seen, cond.left);
          if (cond.targetType === "source") {
            addValueSourceRequest(requests, seen, cond.right);
          }
        }
        break;
      default:
        break;
    }
  }

  return requests;
}

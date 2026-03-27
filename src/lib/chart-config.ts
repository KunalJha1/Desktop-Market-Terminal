import type { ChartType, Timeframe } from "../chart/types";
import { indicatorRegistry } from "../chart/indicators/registry";
import type {
  ChartState,
  PersistedChartIndicator,
  PersistedChartScript,
} from "./chart-state";

export interface DailyIqChartConfig {
  symbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  linkChannel: number | null;
  indicators: PersistedChartIndicator[];
  stopperPx: number;
  indicatorColorDefaults: Record<string, Record<string, string>>;
  scripts: PersistedChartScript[];
}

export interface DailyIqChartFile {
  type: "dailyiq-chart";
  version: 1;
  exportedAt: string;
  chart: DailyIqChartConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
  }
  return result;
}

function sanitizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key] = item;
  }
  return result;
}

function sanitizeLineStyleRecord(
  value: unknown,
): Record<string, "solid" | "dashed" | "dotted"> {
  if (!isRecord(value)) return {};
  const result: Record<string, "solid" | "dashed" | "dotted"> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === "solid" || item === "dashed" || item === "dotted") result[key] = item;
  }
  return result;
}

function parseIndicators(value: unknown): PersistedChartIndicator[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string") return [];

    return [{
      name: item.name,
      paneId: typeof item.paneId === "string"
        ? item.paneId
        : (indicatorRegistry[item.name]?.category === "overlay" ? "main" : `pane:${item.name}`),
      params: sanitizeNumberRecord(item.params),
      textParams: sanitizeStringRecord(item.textParams),
      colors: sanitizeStringRecord(item.colors),
      lineWidths: sanitizeNumberRecord(item.lineWidths),
      lineStyles: sanitizeLineStyleRecord(item.lineStyles),
      visible: typeof item.visible === "boolean" ? item.visible : true,
    }];
  });
}

function parseScripts(value: unknown): PersistedChartScript[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.source !== "string") return [];
    return [{
      id: typeof item.id === "string" ? item.id : `script_${Date.now()}`,
      source: item.source,
    }];
  });
}

function sanitizeChartConfig(value: unknown): DailyIqChartConfig | null {
  if (!isRecord(value)) return null;
  return {
    symbol: typeof value.symbol === "string" ? value.symbol : "",
    timeframe: (typeof value.timeframe === "string" ? value.timeframe : "1D") as Timeframe,
    chartType: (typeof value.chartType === "string" ? value.chartType : "candlestick") as ChartType,
    linkChannel: typeof value.linkChannel === "number" ? value.linkChannel : null,
    indicators: parseIndicators(value.indicators),
    stopperPx: typeof value.stopperPx === "number" ? value.stopperPx : 80,
    indicatorColorDefaults: isRecord(value.indicatorColorDefaults)
      ? (value.indicatorColorDefaults as Record<string, Record<string, string>>)
      : {},
    scripts: parseScripts(value.scripts),
  };
}

export function createDailyIqChartFile(config: DailyIqChartConfig): DailyIqChartFile {
  return {
    type: "dailyiq-chart",
    version: 1,
    exportedAt: new Date().toISOString(),
    chart: {
      ...config,
      indicators: config.indicators.map((indicator) => ({
        ...indicator,
        params: { ...indicator.params },
        textParams: indicator.textParams ? { ...indicator.textParams } : undefined,
        colors: { ...indicator.colors },
        lineWidths: indicator.lineWidths ? { ...indicator.lineWidths } : undefined,
        lineStyles: indicator.lineStyles ? { ...indicator.lineStyles } : undefined,
      })),
      indicatorColorDefaults: Object.fromEntries(
        Object.entries(config.indicatorColorDefaults).map(([key, value]) => [key, { ...value }]),
      ),
      scripts: config.scripts.map((script) => ({ ...script })),
    },
  };
}

export function parseDailyIqChartFile(raw: string): DailyIqChartFile | null {
  try {
    const parsed = JSON.parse(raw) as {
      type?: unknown;
      version?: unknown;
      exportedAt?: unknown;
      chart?: unknown;
    };
    if (parsed.type !== "dailyiq-chart" || parsed.version !== 1) return null;
    const chart = sanitizeChartConfig(parsed.chart);
    if (!chart) return null;
    return {
      type: "dailyiq-chart",
      version: 1,
      exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
      chart,
    };
  } catch {
    return null;
  }
}

export function chartStateToDailyIqChartConfig(state: ChartState): DailyIqChartConfig {
  return {
    symbol: state.symbol,
    timeframe: state.timeframe,
    chartType: state.chartType,
    linkChannel: state.linkChannel,
    indicators: state.indicators.map((indicator) => ({
      ...indicator,
      params: { ...indicator.params },
      textParams: indicator.textParams ? { ...indicator.textParams } : undefined,
      colors: { ...indicator.colors },
      lineWidths: indicator.lineWidths ? { ...indicator.lineWidths } : undefined,
      lineStyles: indicator.lineStyles ? { ...indicator.lineStyles } : undefined,
    })),
    stopperPx: state.stopperPx,
    indicatorColorDefaults: Object.fromEntries(
      Object.entries(state.indicatorColorDefaults).map(([key, value]) => [key, { ...value }]),
    ),
    scripts: (state.scripts ?? []).map((script) => ({ ...script })),
  };
}

export function dailyIqChartConfigToChartState(config: DailyIqChartConfig): ChartState {
  return {
    symbol: config.symbol,
    timeframe: config.timeframe,
    chartType: config.chartType,
    linkChannel: config.linkChannel,
    indicators: config.indicators.map((indicator) => ({
      ...indicator,
      params: { ...indicator.params },
      textParams: indicator.textParams ? { ...indicator.textParams } : undefined,
      colors: { ...indicator.colors },
      lineWidths: indicator.lineWidths ? { ...indicator.lineWidths } : undefined,
      lineStyles: indicator.lineStyles ? { ...indicator.lineStyles } : undefined,
      visible: indicator.visible,
    })),
    stopperPx: config.stopperPx,
    indicatorColorDefaults: Object.fromEntries(
      Object.entries(config.indicatorColorDefaults).map(([key, value]) => [key, { ...value }]),
    ),
    scripts: config.scripts.map((script) => ({ ...script })),
  };
}

export function miniChartConfigToDailyIqChartConfig(
  config: Record<string, unknown>,
  linkChannel: number | null,
): DailyIqChartConfig {
  const chart = sanitizeChartConfig({
    symbol: config.symbol,
    timeframe: config.timeframe,
    chartType: config.chartType,
    linkChannel,
    indicators: config.indicators,
    stopperPx: config.stopperPx,
    indicatorColorDefaults: config.indicatorColorDefaults,
    scripts: config.scripts,
  });

  return chart ?? {
    symbol: "",
    timeframe: "1D",
    chartType: "candlestick",
    linkChannel,
    indicators: [],
    stopperPx: 40,
    indicatorColorDefaults: {},
    scripts: [],
  };
}

export function dailyIqChartConfigToMiniChartConfig(
  config: DailyIqChartConfig,
): Record<string, unknown> {
  return {
    symbol: config.symbol,
    timeframe: config.timeframe,
    chartType: config.chartType,
    indicators: config.indicators.map((indicator) => ({
      ...indicator,
      params: { ...indicator.params },
      textParams: indicator.textParams ? { ...indicator.textParams } : undefined,
      colors: { ...indicator.colors },
      lineWidths: indicator.lineWidths ? { ...indicator.lineWidths } : undefined,
      lineStyles: indicator.lineStyles ? { ...indicator.lineStyles } : undefined,
      visible: indicator.visible,
    })),
    stopperPx: config.stopperPx,
    indicatorColorDefaults: Object.fromEntries(
      Object.entries(config.indicatorColorDefaults).map(([key, value]) => [key, { ...value }]),
    ),
    scripts: config.scripts.map((script) => ({ ...script })),
  };
}

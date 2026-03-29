import type { ChartType, Timeframe, YScaleMode } from "../chart/types";
import { indicatorRegistry } from "../chart/indicators/registry";
import type {
  ChartState,
  PersistedChartIndicator,
  PersistedChartScript,
  ProbEngWidgetState,
} from "./chart-state";
import { createDefaultProbEngWidgetState } from "./chart-state";
import type { CustomStrategyDefinition } from "../chart/customStrategies";

export interface DailyIqChartConfig {
  symbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  yScaleMode: YScaleMode;
  linkChannel: number | null;
  indicators: PersistedChartIndicator[];
  stopperPx: number;
  indicatorColorDefaults: Record<string, Record<string, string>>;
  scripts: PersistedChartScript[];
  customStrategies: CustomStrategyDefinition[];
  activeCustomStrategyIds: string[];
  probEngWidget: ProbEngWidgetState;
  tooltipFields: Record<string, boolean>;
}

export interface DailyIqChartFile {
  type: "dailyiq-chart";
  version: 1 | 2;
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

function sanitizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "boolean") result[key] = item;
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

function parseCustomStrategies(value: unknown): CustomStrategyDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || !Array.isArray(item.conditions)) return [];
    return [{
      id: item.id,
      name: item.name,
      conditions: item.conditions as CustomStrategyDefinition["conditions"],
      buyThreshold: typeof item.buyThreshold === "number" ? item.buyThreshold : 70,
      sellThreshold: typeof item.sellThreshold === "number" ? item.sellThreshold : 30,
    }];
  });
}

function sanitizeChartConfig(value: unknown): DailyIqChartConfig | null {
  if (!isRecord(value)) return null;
  return {
    symbol: typeof value.symbol === "string" ? value.symbol : "",
    timeframe: (typeof value.timeframe === "string" ? value.timeframe : "1D") as Timeframe,
    chartType: (typeof value.chartType === "string" ? value.chartType : "candlestick") as ChartType,
    yScaleMode: value.yScaleMode === "auto" || value.yScaleMode === "log" || value.yScaleMode === "manual"
      ? value.yScaleMode
      : "auto",
    linkChannel: typeof value.linkChannel === "number" ? value.linkChannel : null,
    indicators: parseIndicators(value.indicators),
    stopperPx: typeof value.stopperPx === "number" ? value.stopperPx : 80,
    indicatorColorDefaults: isRecord(value.indicatorColorDefaults)
      ? (value.indicatorColorDefaults as Record<string, Record<string, string>>)
      : {},
    scripts: parseScripts(value.scripts),
    customStrategies: parseCustomStrategies(value.customStrategies),
    activeCustomStrategyIds: Array.isArray(value.activeCustomStrategyIds)
      ? value.activeCustomStrategyIds.filter((item): item is string => typeof item === "string")
      : [],
    probEngWidget: isRecord(value.probEngWidget)
      ? {
          x: typeof value.probEngWidget.x === "number" ? value.probEngWidget.x : 96,
          y: typeof value.probEngWidget.y === "number" ? value.probEngWidget.y : 64,
          visible: typeof value.probEngWidget.visible === "boolean" ? value.probEngWidget.visible : true,
          detailed: typeof value.probEngWidget.detailed === "boolean" ? value.probEngWidget.detailed : false,
          locked: typeof value.probEngWidget.locked === "boolean" ? value.probEngWidget.locked : false,
        }
      : createDefaultProbEngWidgetState(),
    tooltipFields: sanitizeBooleanRecord(value.tooltipFields),
  };
}

export function createDailyIqChartFile(config: DailyIqChartConfig): DailyIqChartFile {
  return {
    type: "dailyiq-chart",
    version: 2,
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
      customStrategies: config.customStrategies.map((strategy) => ({ ...strategy, conditions: strategy.conditions.map((condition) => ({ ...condition })) })),
      activeCustomStrategyIds: [...config.activeCustomStrategyIds],
      probEngWidget: { ...config.probEngWidget },
      tooltipFields: { ...config.tooltipFields },
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
    if (parsed.type !== "dailyiq-chart" || (parsed.version !== 1 && parsed.version !== 2)) return null;
    const chart = sanitizeChartConfig(parsed.chart);
    if (!chart) return null;
    return {
      type: "dailyiq-chart",
      version: parsed.version,
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
    yScaleMode: state.yScaleMode ?? "auto",
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
    customStrategies: (state.customStrategies ?? []).map((strategy) => ({ ...strategy, conditions: strategy.conditions.map((condition) => ({ ...condition })) })),
    activeCustomStrategyIds: [...(state.activeCustomStrategyIds ?? [])],
    probEngWidget: { ...(state.probEngWidget ?? createDefaultProbEngWidgetState()) },
    tooltipFields: { ...(state.tooltipFields ?? {}) },
  };
}

export function dailyIqChartConfigToChartState(config: DailyIqChartConfig): ChartState {
  return {
    symbol: config.symbol,
    timeframe: config.timeframe,
    chartType: config.chartType,
    yScaleMode: config.yScaleMode,
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
    customStrategies: config.customStrategies.map((strategy) => ({ ...strategy, conditions: strategy.conditions.map((condition) => ({ ...condition })) })),
    activeCustomStrategyIds: [...config.activeCustomStrategyIds],
    probEngWidget: { ...config.probEngWidget },
    tooltipFields: { ...config.tooltipFields },
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
    yScaleMode: config.yScaleMode,
    linkChannel,
    indicators: config.indicators,
    stopperPx: config.stopperPx,
    indicatorColorDefaults: config.indicatorColorDefaults,
    scripts: config.scripts,
    probEngWidget: config.probEngWidget,
    tooltipFields: config.tooltipFields,
  });

  return chart ?? {
    symbol: "",
    timeframe: "1D",
    chartType: "candlestick",
    yScaleMode: "auto",
    linkChannel,
    indicators: [],
    stopperPx: 40,
    indicatorColorDefaults: {},
    scripts: [],
    customStrategies: [],
    activeCustomStrategyIds: [],
    probEngWidget: createDefaultProbEngWidgetState(),
    tooltipFields: {},
  };
}

export function dailyIqChartConfigToMiniChartConfig(
  config: DailyIqChartConfig,
): Record<string, unknown> {
  return {
    symbol: config.symbol,
    timeframe: config.timeframe,
    chartType: config.chartType,
    yScaleMode: config.yScaleMode,
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
    probEngWidget: { ...config.probEngWidget },
    tooltipFields: { ...config.tooltipFields },
  };
}

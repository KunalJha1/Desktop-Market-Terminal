/** Persists per-tab chart state in sessionStorage */
import type { ChartType, Timeframe, YScaleMode } from "../chart/types";
import { indicatorRegistry } from "../chart/indicators/registry";
import type { CustomStrategyDefinition } from "../chart/customStrategies";

export interface PersistedChartIndicator {
  name: string;
  paneId: string;
  params: Record<string, number>;
  textParams?: Record<string, string>;
  colors: Record<string, string>;
  lineWidths?: Record<string, number>;
  lineStyles?: Record<string, "solid" | "dashed" | "dotted">;
  visible: boolean;
}

export interface PersistedChartScript {
  id: string;
  source: string;
  name?: string;
  savedAt?: number;
}

export interface ProbEngWidgetState {
  x: number;
  y: number;
  /** 0–1 horizontal position in the draggable band (persists across window resize). */
  normX?: number;
  /** 0–1 vertical position in the draggable band. */
  normY?: number;
  visible: boolean;
  detailed: boolean;
  locked: boolean;
}

export interface ChartState {
  symbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  yScaleMode?: YScaleMode;
  linkChannel: number | null;
  indicators: PersistedChartIndicator[];
  stopperPx: number;
  indicatorColorDefaults: Record<string, Record<string, string>>;
  scripts?: PersistedChartScript[];
  activeScriptIds?: string[];
  customStrategies?: CustomStrategyDefinition[];
  activeCustomStrategyIds?: string[];
  probEngWidget?: ProbEngWidgetState;
  tooltipFields?: Record<string, boolean>;
  indicatorPanelOpen?: boolean;
  strategyPanelOpen?: boolean;
  legendCollapsed?: boolean;
}

const KEY_PREFIX = "chart-state:";

export function createDefaultProbEngWidgetState(): ProbEngWidgetState {
  return {
    x: 96,
    y: 64,
    visible: true,
    detailed: false,
    locked: false,
  };
}

export function createDefaultPersistedChartIndicators(): PersistedChartIndicator[] {
  return [{
    name: "Volume",
    paneId: "main",
    params: {},
    colors: {},
    lineWidths: {},
    lineStyles: {},
    visible: true,
  }];
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
    if (typeof item === "string") {
      const meta = indicatorRegistry[item];
      return [{
        name: item,
        paneId: meta?.category === "overlay" ? "main" : `pane:${item}`,
        params: {},
        textParams: {},
        colors: {},
        lineWidths: {},
        lineStyles: {},
        visible: true,
      }];
    }

    if (!isRecord(item) || typeof item.name !== "string") return [];

    const meta = indicatorRegistry[item.name];
    const paneId = typeof item.paneId === "string"
      ? item.paneId
      : (meta?.category === "overlay" ? "main" : `pane:${item.name}`);

    return [{
      name: item.name,
      paneId,
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
      name: typeof item.name === "string" ? item.name : undefined,
      savedAt: typeof item.savedAt === "number" ? item.savedAt : undefined,
    }];
  });
}

function parseCustomStrategies(value: unknown): CustomStrategyDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || !Array.isArray(item.conditions)) {
      return [];
    }
    return [{
      id: item.id,
      name: item.name,
      conditions: item.conditions as CustomStrategyDefinition["conditions"],
      buyThreshold: typeof item.buyThreshold === "number" ? item.buyThreshold : 70,
      sellThreshold: typeof item.sellThreshold === "number" ? item.sellThreshold : 30,
    }];
  });
}

export function loadChartState(tabId: string): ChartState | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + tabId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChartState> & {
      timeframe?: string;
      chartType?: string;
      indicators?: unknown;
    };
    const hasIndicators = Object.prototype.hasOwnProperty.call(parsed, "indicators");
    return {
      symbol: typeof parsed.symbol === "string" ? parsed.symbol : "",
      timeframe: (typeof parsed.timeframe === "string" ? parsed.timeframe : "1D") as Timeframe,
      chartType: (typeof parsed.chartType === "string" ? parsed.chartType : "candlestick") as ChartType,
      yScaleMode: (parsed.yScaleMode === "auto" || parsed.yScaleMode === "log" || parsed.yScaleMode === "manual")
        ? parsed.yScaleMode
        : "auto",
      linkChannel: typeof parsed.linkChannel === "number" ? parsed.linkChannel : null,
      indicators: hasIndicators ? parseIndicators(parsed.indicators) : createDefaultPersistedChartIndicators(),
      stopperPx: typeof parsed.stopperPx === "number" ? parsed.stopperPx : 80,
      indicatorColorDefaults:
        parsed.indicatorColorDefaults && typeof parsed.indicatorColorDefaults === "object"
          ? (parsed.indicatorColorDefaults as Record<string, Record<string, string>>)
          : {},
      scripts: parseScripts((parsed as { scripts?: unknown }).scripts),
      activeScriptIds: Array.isArray((parsed as { activeScriptIds?: unknown }).activeScriptIds)
        ? ((parsed as { activeScriptIds: unknown[] }).activeScriptIds.filter((item): item is string => typeof item === "string"))
        : [],
      customStrategies: parseCustomStrategies((parsed as { customStrategies?: unknown }).customStrategies),
      activeCustomStrategyIds: Array.isArray((parsed as { activeCustomStrategyIds?: unknown }).activeCustomStrategyIds)
        ? ((parsed as { activeCustomStrategyIds: unknown[] }).activeCustomStrategyIds.filter((item): item is string => typeof item === "string"))
        : [],
      indicatorPanelOpen: typeof (parsed as { indicatorPanelOpen?: unknown }).indicatorPanelOpen === "boolean"
        ? (parsed as { indicatorPanelOpen: boolean }).indicatorPanelOpen
        : false,
      strategyPanelOpen: typeof (parsed as { strategyPanelOpen?: unknown }).strategyPanelOpen === "boolean"
        ? (parsed as { strategyPanelOpen: boolean }).strategyPanelOpen
        : false,
      legendCollapsed: typeof (parsed as { legendCollapsed?: unknown }).legendCollapsed === "boolean"
        ? (parsed as { legendCollapsed: boolean }).legendCollapsed
        : false,
      probEngWidget: isRecord((parsed as { probEngWidget?: unknown }).probEngWidget)
        ? (() => {
            const pw = (parsed as { probEngWidget?: unknown }).probEngWidget as Record<string, unknown>;
            const base = {
              x: typeof pw.x === "number" ? pw.x : 16,
              y: typeof pw.y === "number" ? pw.y : 44,
              visible: typeof pw.visible === "boolean" ? pw.visible : true,
              detailed: typeof pw.detailed === "boolean" ? pw.detailed : false,
              locked: typeof pw.locked === "boolean" ? pw.locked : false,
            };
            const normX = typeof pw.normX === "number" && Number.isFinite(pw.normX) ? pw.normX : undefined;
            const normY = typeof pw.normY === "number" && Number.isFinite(pw.normY) ? pw.normY : undefined;
            return normX !== undefined && normY !== undefined
              ? { ...base, normX, normY }
              : base;
          })()
        : createDefaultProbEngWidgetState(),
    };
  } catch {
    return null;
  }
}

export function saveChartState(tabId: string, state: ChartState): void {
  try {
    localStorage.setItem(KEY_PREFIX + tabId, JSON.stringify(state));
  } catch {
    // Silently fail
  }
}

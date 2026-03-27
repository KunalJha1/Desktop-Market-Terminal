/** Persists per-tab chart state in sessionStorage */
import type { ChartType, Timeframe } from "../chart/types";
import { indicatorRegistry } from "../chart/indicators/registry";

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
}

export interface ChartState {
  symbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  linkChannel: number | null;
  indicators: PersistedChartIndicator[];
  stopperPx: number;
  indicatorColorDefaults: Record<string, Record<string, string>>;
  scripts?: PersistedChartScript[];
}

const KEY_PREFIX = "chart-state:";

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
      linkChannel: typeof parsed.linkChannel === "number" ? parsed.linkChannel : null,
      indicators: hasIndicators ? parseIndicators(parsed.indicators) : createDefaultPersistedChartIndicators(),
      stopperPx: typeof parsed.stopperPx === "number" ? parsed.stopperPx : 80,
      indicatorColorDefaults:
        parsed.indicatorColorDefaults && typeof parsed.indicatorColorDefaults === "object"
          ? (parsed.indicatorColorDefaults as Record<string, Record<string, string>>)
          : {},
      scripts: parseScripts((parsed as { scripts?: unknown }).scripts),
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

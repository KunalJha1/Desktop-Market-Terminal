/** Persists per-tab chart state in sessionStorage */
import type { ChartType, Timeframe } from "../chart/types";
import { indicatorRegistry } from "../chart/indicators/registry";

export interface PersistedChartIndicator {
  name: string;
  paneId: string;
  params: Record<string, number>;
  colors: Record<string, string>;
  lineWidths?: Record<string, number>;
  lineStyles?: Record<string, "solid" | "dashed" | "dotted">;
  visible: boolean;
}

export interface ChartState {
  symbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  linkChannel: number | null;
  indicators: PersistedChartIndicator[];
  stopperPx: number;
  indicatorColorDefaults: Record<string, Record<string, string>>;
}

const KEY_PREFIX = "chart-state:";

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
      colors: sanitizeStringRecord(item.colors),
      lineWidths: sanitizeNumberRecord(item.lineWidths),
      lineStyles: sanitizeLineStyleRecord(item.lineStyles),
      visible: typeof item.visible === "boolean" ? item.visible : true,
    }];
  });
}

export function loadChartState(tabId: string): ChartState | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + tabId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChartState> & {
      timeframe?: string;
      chartType?: string;
      indicators?: unknown;
    };
    return {
      symbol: typeof parsed.symbol === "string" ? parsed.symbol : "AAPL",
      timeframe: (typeof parsed.timeframe === "string" ? parsed.timeframe : "1D") as Timeframe,
      chartType: (typeof parsed.chartType === "string" ? parsed.chartType : "candlestick") as ChartType,
      linkChannel: typeof parsed.linkChannel === "number" ? parsed.linkChannel : null,
      indicators: parseIndicators(parsed.indicators),
      stopperPx: typeof parsed.stopperPx === "number" ? parsed.stopperPx : 80,
      indicatorColorDefaults:
        parsed.indicatorColorDefaults && typeof parsed.indicatorColorDefaults === "object"
          ? (parsed.indicatorColorDefaults as Record<string, Record<string, string>>)
          : {},
    };
  } catch {
    return null;
  }
}

export function saveChartState(tabId: string, state: ChartState): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + tabId, JSON.stringify(state));
  } catch {
    // Silently fail
  }
}

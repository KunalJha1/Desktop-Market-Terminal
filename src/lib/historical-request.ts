/**
 * Historical bar fetching and timeframe alignment shared by the chart (`useChartData`)
 * and simulations. Uses the same IBKR `bar_size` strings as `ChartPage.fetchTableBars`.
 */

import type { OHLCVBar } from "../chart/types";
import { DEFAULT_BARS_VISIBLE, getTimeframeMs } from "../chart/constants";

export type RawBarSize = "1m" | "5m" | "15m" | "1d";

export type IbkrBarSizeParam = "1 min" | "5 mins" | "15 mins" | "1 day";

const BUFFER_MULTIPLIER = 3;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function getResampleFactor(tf: string): number {
  const PRESET: Record<string, number> = {
    "1m": 1,
    "2m": 2,
    "3m": 3,
    "5m": 5,
    "10m": 10,
    "15m": 15,
    "30m": 30,
    "1H": 60,
    "2H": 120,
    "3H": 180,
    "4H": 240,
    "1D": 1,
    "3D": 1,
    "1W": 1,
    "1M": 1,
    "3M": 1,
    "6M": 1,
    "12M": 1,
  };
  if (tf in PRESET) return PRESET[tf];
  const ms = getTimeframeMs(tf);
  return ms >= 86_400_000 ? 1 : Math.max(1, Math.round(ms / 60_000));
}

function estimateIntradayDurationDays(timeframe: string, rawBarSize: RawBarSize): number {
  const factor = Math.max(1, getResampleFactor(timeframe));
  const targetRawBars = DEFAULT_BARS_VISIBLE * BUFFER_MULTIPLIER * factor;

  if (rawBarSize === "1m") {
    const days = Math.ceil((targetRawBars / 390) * 2);
    return clampInt(days, 3, 29);
  }
  if (rawBarSize === "5m") {
    const days = Math.ceil((targetRawBars / 78) * 2);
    return clampInt(days, 5, 365);
  }
  const days = Math.ceil((targetRawBars / 26) * 2);
  return clampInt(days, 10, 730);
}

/** Chart viewport: dynamic duration, same coarse bar selection rules as simulations. */
export function getHistoricalRequestConfig(timeframe: string): {
  barSizeParam: IbkrBarSizeParam;
  rawBarSize: RawBarSize;
  duration: string;
  stepMs: number;
} {
  const tfMs = getTimeframeMs(timeframe);
  if (tfMs >= 86_400_000) {
    return { barSizeParam: "1 day", rawBarSize: "1d", duration: "30 Y", stepMs: 86_400_000 };
  }
  if (tfMs <= 3 * 60_000) {
    const durationDays = estimateIntradayDurationDays(timeframe, "1m");
    return { barSizeParam: "1 min", rawBarSize: "1m", duration: `${durationDays} D`, stepMs: 60_000 };
  }
  if (tfMs <= 10 * 60_000) {
    const durationDays = estimateIntradayDurationDays(timeframe, "5m");
    return { barSizeParam: "5 mins", rawBarSize: "5m", duration: `${durationDays} D`, stepMs: 5 * 60_000 };
  }
  const durationDays = estimateIntradayDurationDays(timeframe, "15m");
  return { barSizeParam: "15 mins", rawBarSize: "15m", duration: `${durationDays} D`, stepMs: 15 * 60_000 };
}

/** Return shape shared by sim fetch helpers below. */
export type SimHistoricalFetchPlan = {
  barSizeParam: IbkrBarSizeParam;
  rawBarSize: RawBarSize;
  duration: string;
};

/**
 * Simulations: user-chosen lookback in calendar days, same native bar granularity as the chart.
 */
export function getSimHistoricalFetchConfig(timeframe: string, durationDays: number): SimHistoricalFetchPlan {
  const days = Math.max(1, Math.round(durationDays));
  const dayStr = `${days} D`;
  const tfMs = getTimeframeMs(timeframe);
  if (tfMs >= 86_400_000) {
    return { barSizeParam: "1 day", rawBarSize: "1d", duration: dayStr };
  }
  if (tfMs <= 3 * 60_000) {
    return { barSizeParam: "1 min", rawBarSize: "1m", duration: dayStr };
  }
  if (tfMs <= 10 * 60_000) {
    return { barSizeParam: "5 mins", rawBarSize: "5m", duration: dayStr };
  }
  return { barSizeParam: "15 mins", rawBarSize: "15m", duration: dayStr };
}

/**
 * Longest sustained history request aligned with coarse bar tier / provider limits (`useChartData` clamps).
 * Daily mirrors the chart’s `30 Y` historical request — use for “widest date range possible” simulations.
 */
export function getMaxSimHistoricalFetchConfig(timeframe: string): SimHistoricalFetchPlan {
  const tfMs = getTimeframeMs(timeframe);
  // Daily+: same root request as ChartPage / getHistoricalRequestConfig (30 Y × 1 day bars).
  if (tfMs >= 86_400_000) {
    return { barSizeParam: "1 day", rawBarSize: "1d", duration: "30 Y" };
  }
  // Intraday: upper bounds match estimateIntradayDurationDays() max clamps in this module (~29d / 365d / 730d tier).
  if (tfMs <= 3 * 60_000) {
    return { barSizeParam: "1 min", rawBarSize: "1m", duration: "29 D" };
  }
  if (tfMs <= 10 * 60_000) {
    return { barSizeParam: "5 mins", rawBarSize: "5m", duration: "365 D" };
  }
  return { barSizeParam: "15 mins", rawBarSize: "15m", duration: "730 D" };
}

function bucketFor(tsMs: number, timeframe: string): number {
  if (timeframe === "1W") {
    const MONDAY_OFFSET_MS = 4 * 86_400_000;
    return Math.floor((tsMs - MONDAY_OFFSET_MS) / 604_800_000) * 604_800_000 + MONDAY_OFFSET_MS;
  }
  if (timeframe === "1M" || timeframe === "3M" || timeframe === "6M" || timeframe === "12M") {
    const d = new Date(tsMs);
    const monthsPerBucket = timeframe === "3M" ? 3 : timeframe === "6M" ? 6 : timeframe === "12M" ? 12 : 1;
    const bucketMonth = Math.floor(d.getUTCMonth() / monthsPerBucket) * monthsPerBucket;
    return Date.UTC(d.getUTCFullYear(), bucketMonth, 1);
  }
  const ms = getTimeframeMs(timeframe);
  return Math.floor(tsMs / ms) * ms;
}

export function resampleBars(bars: OHLCVBar[], timeframe: string): OHLCVBar[] {
  if (timeframe === "1m") return bars;

  const result: OHLCVBar[] = [];
  let current: OHLCVBar | null = null;
  let currentBucket = -1;
  let bucketHasSynthetic = false;

  for (const bar of bars) {
    const bucket = bucketFor(bar.time, timeframe);

    if (bucket !== currentBucket || !current) {
      if (current) {
        if (bucketHasSynthetic) current.synthetic = true;
        result.push(current);
      }
      currentBucket = bucket;
      bucketHasSynthetic = !!bar.synthetic;
      current = {
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      };
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
      if (bar.synthetic) bucketHasSynthetic = true;
    }
  }

  if (current) {
    if (bucketHasSynthetic) current.synthetic = true;
    result.push(current);
  }
  return result;
}

/** Match `useChartData` / chart display path: align raw API bars to the selected timeframe. */
export function displayBarsForTimeframe(rawBars: OHLCVBar[], rawBarSize: RawBarSize, timeframe: string): OHLCVBar[] {
  if ((rawBarSize === "1d" && timeframe === "1D") || timeframe === rawBarSize) {
    return rawBars;
  }
  return resampleBars(rawBars, timeframe);
}

/** Normalize timestamps from API (seconds vs ms). */
export function normalizeHistoricalBarTimeMs(rawTime: number): number {
  if (!Number.isFinite(rawTime)) return NaN;
  return Math.abs(rawTime) < 100_000_000_000 ? Math.round(rawTime * 1000) : Math.round(rawTime);
}

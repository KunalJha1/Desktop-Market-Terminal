import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { OHLCVBar } from '../types';
import { getTimeframeMs, DEFAULT_BARS_VISIBLE } from '../constants';
import { generateMockData } from '../mock-data';

interface UseChartDataOptions {
  symbol: string;
  timeframe: string;
  sidecarPort: number | null;
}

interface UseChartDataResult {
  bars: OHLCVBar[];
  loading: boolean;
  source: 'tws' | 'yahoo' | 'cache' | 'mock';
  onViewportChange: (startIdx: number, endIdx: number) => void;
  pendingViewportShift: number;
  onViewportShiftApplied: () => void;
  updateMode: 'full' | 'tail';
  tailChangeOffset: number;
}

const SYNTHETIC_DAILY_TIMEFRAME = '1D';
const SYNTHETIC_DAILY_MINUTE_DURATION = '90 D';

function isDailyTimeframe(tf: string): boolean {
  return getTimeframeMs(tf) >= 86_400_000;
}

function getResampleFactor(tf: string): number {
  const PRESET: Record<string, number> = {
    '1m': 1, '2m': 2, '3m': 3, '5m': 5, '10m': 10, '15m': 15, '30m': 30,
    '1H': 60, '2H': 120, '3H': 180, '4H': 240,
    '1D': 1, '3D': 1, '1W': 1, '1M': 1, '3M': 1, '6M': 1, '12M': 1,
  };
  if (tf in PRESET) return PRESET[tf];
  const ms = getTimeframeMs(tf);
  return ms >= 86_400_000 ? 1 : Math.max(1, Math.round(ms / 60_000));
}

// Buffer: fetch 3x the visible range to avoid constant re-fetches while panning
const BUFFER_MULTIPLIER = 3;
// Max raw 1m bars to keep in memory (enough for ~256 trading days of 1m data)
const MAX_CACHED_BARS = 100_000;
// Debounce pan-triggered fetches (ms)
const PAN_FETCH_DEBOUNCE = 200;
// Polling intervals (ms)
const INTRADAY_POLL_MS = 5_000;
const DAILY_POLL_MS = 60_000;

function parseBars(payload: { bars: Array<Record<string, number>> }): OHLCVBar[] {
  return payload.bars.map(b => ({
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

function dayBucket(tsMs: number): number {
  const d = new Date(tsMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function aggregateBarsToDaily(bars: OHLCVBar[]): OHLCVBar[] {
  const result: OHLCVBar[] = [];
  let current: OHLCVBar | null = null;
  let currentBucket = -1;

  for (const bar of bars) {
    const bucket = dayBucket(bar.time);
    if (!current || bucket !== currentBucket) {
      if (current) result.push(current);
      currentBucket = bucket;
      current = {
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      };
      continue;
    }

    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  }

  if (current) result.push(current);
  return result;
}

function mergeDailyBars(nativeDaily: OHLCVBar[], syntheticDaily: OHLCVBar[]): OHLCVBar[] {
  const merged = new Map<number, OHLCVBar>();

  for (const bar of nativeDaily) {
    merged.set(dayBucket(bar.time), { ...bar, time: dayBucket(bar.time) });
  }

  for (const bar of syntheticDaily) {
    merged.set(dayBucket(bar.time), { ...bar, time: dayBucket(bar.time) });
  }

  return Array.from(merged.values()).sort((a, b) => a.time - b.time);
}

function normalizeSource(value: unknown): 'tws' | 'yahoo' | 'cache' {
  return value === 'tws' || value === 'yahoo' || value === 'cache' ? value : 'yahoo';
}

function mergeBarsByTime(existingBars: OHLCVBar[], incomingBars: OHLCVBar[]): OHLCVBar[] {
  if (existingBars.length === 0) return incomingBars;
  if (incomingBars.length === 0) return existingBars;

  const merged = new Map<number, OHLCVBar>();

  for (const bar of existingBars) {
    merged.set(bar.time, bar);
  }
  for (const bar of incomingBars) {
    merged.set(bar.time, bar);
  }

  return Array.from(merged.values()).sort((a, b) => a.time - b.time);
}

function getDisplayBars(rawBars: OHLCVBar[], rawBarSize: '1m' | '1d', timeframe: string): OHLCVBar[] {
  if ((rawBarSize === '1d' && timeframe === '1D') || (rawBarSize === '1m' && timeframe === '1m')) {
    return rawBars;
  }
  return resampleBars(rawBars, timeframe);
}

export function useChartData({ symbol, timeframe, sidecarPort }: UseChartDataOptions): UseChartDataResult {
  const [rawBars, setRawBars] = useState<OHLCVBar[]>([]);
  const [rawBarSize, setRawBarSize] = useState<'1m' | '1d'>('1m');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'tws' | 'yahoo' | 'cache' | 'mock'>('mock');
  const [pendingViewportShift, setPendingViewportShift] = useState(0);
  const [updateMode, setUpdateMode] = useState<'full' | 'tail'>('full');
  const [tailChangeOffset, setTailChangeOffset] = useState(0);
  const requestIdRef = useRef(0);
  // Keep a ref to rawBars for async access without stale closures
  const rawBarsRef = useRef<OHLCVBar[]>([]);
  const displayBarsRef = useRef<OHLCVBar[]>([]);
  // Track the server's full cached extent for the current symbol
  const serverExtentRef = useRef<{ tsMin: number; tsMax: number } | null>(null);
  // Debounce timer for pan fetches
  const panDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track if a pan fetch is in-flight to avoid stacking
  const panFetchingRef = useRef(false);
  const viewportAnchorRef = useRef<{ startIdx: number; anchorTime: number } | null>(null);

  // Keep ref in sync for async access
  rawBarsRef.current = rawBars;

  const useDaily = isDailyTimeframe(timeframe);

  // How many raw 1m bars to fetch for the initial load
  const initialLimit = useMemo(() => {
    const factor = getResampleFactor(timeframe);
    return DEFAULT_BARS_VISIBLE * BUFFER_MULTIPLIER * factor;
  }, [timeframe]);

  // ── Daily: full fetch (unchanged behavior) ──────────────────────────
  // ── Intraday: windowed fetch with limit ─────────────────────────────
  useEffect(() => {
    if (!sidecarPort) {
      setSource('mock');
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    serverExtentRef.current = null;
    setPendingViewportShift(0);
    viewportAnchorRef.current = null;

    let cancelled = false;

    async function fetchBars() {
      try {
        if (timeframe === SYNTHETIC_DAILY_TIMEFRAME) {
          const dailyUrl = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
          dailyUrl.searchParams.set('symbol', symbol);
          dailyUrl.searchParams.set('bar_size', '1 day');
          dailyUrl.searchParams.set('duration', '30 Y');

          const minuteUrl = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
          minuteUrl.searchParams.set('symbol', symbol);
          minuteUrl.searchParams.set('bar_size', '1 min');
          minuteUrl.searchParams.set('duration', SYNTHETIC_DAILY_MINUTE_DURATION);

          const [dailyRes, minuteRes] = await Promise.all([
            fetch(dailyUrl.toString()),
            fetch(minuteUrl.toString()),
          ]);
          if (!dailyRes.ok) return;

          const dailyPayload = await dailyRes.json();
          const minutePayload = minuteRes.ok ? await minuteRes.json() : { bars: [], source: 'cache' };
          if (cancelled || requestId !== requestIdRef.current) return;

          const nativeDailyBars = parseBars(dailyPayload);
          const minuteBars = parseBars(minutePayload);
          const syntheticDailyBars = aggregateBarsToDaily(minuteBars);
          const mergedBars = mergeDailyBars(nativeDailyBars, syntheticDailyBars);

          if (mergedBars.length > 0) {
            setRawBars(mergedBars);
            setRawBarSize('1d');
            setSource(normalizeSource(syntheticDailyBars.length > 0 ? minutePayload.source : dailyPayload.source));
          } else {
            setRawBars([]);
            setSource('mock');
          }
          setLoading(false);
          return;
        }

        const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
        url.searchParams.set('symbol', symbol);

        if (useDaily) {
          url.searchParams.set('bar_size', '1 day');
          url.searchParams.set('duration', '30 Y');
        } else {
          url.searchParams.set('bar_size', '1 min');
          url.searchParams.set('duration', '30 D');
        }

        const res = await fetch(url.toString());
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled || requestId !== requestIdRef.current) return;

        if (payload.ts_min != null && payload.ts_max != null) {
          serverExtentRef.current = { tsMin: payload.ts_min, tsMax: payload.ts_max };
        }

        const bars = parseBars(payload);

        setUpdateMode('full');
        if (bars.length > 0) {
          setRawBars(bars);
          setRawBarSize(useDaily ? '1d' : '1m');
          setSource((payload.source as 'tws' | 'yahoo' | 'cache') || 'yahoo');
        } else {
          setRawBars([]);
          setSource('mock');
        }
        setLoading(false);
      } catch {
        if (!cancelled) {
          // Don't clear bars on error — keep showing existing data.
          // A transient network failure shouldn't reset the viewport.
          setSource('mock');
          setLoading(false);
        }
      }
    }

    // Incremental poll: for intraday, only fetch new bars since last cached bar
    async function pollIncremental() {
      if (cancelled || requestId !== requestIdRef.current) return;
      if (panFetchingRef.current) return;
      try {
        if (timeframe === SYNTHETIC_DAILY_TIMEFRAME) {
          const dailyUrl = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
          dailyUrl.searchParams.set('symbol', symbol);
          dailyUrl.searchParams.set('bar_size', '1 day');
          dailyUrl.searchParams.set('duration', '30 Y');

          const minuteUrl = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
          minuteUrl.searchParams.set('symbol', symbol);
          minuteUrl.searchParams.set('bar_size', '1 min');
          minuteUrl.searchParams.set('duration', SYNTHETIC_DAILY_MINUTE_DURATION);

          const [dailyRes, minuteRes] = await Promise.all([
            fetch(dailyUrl.toString()),
            fetch(minuteUrl.toString()),
          ]);
          if (!dailyRes.ok) return;

          const dailyPayload = await dailyRes.json();
          const minutePayload = minuteRes.ok ? await minuteRes.json() : { bars: [], source: 'cache' };
          if (cancelled || requestId !== requestIdRef.current) return;

          const mergedBars = mergeDailyBars(
            parseBars(dailyPayload),
            aggregateBarsToDaily(parseBars(minutePayload)),
          );

          if (mergedBars.length > 0) {
            setUpdateMode('full');
            setRawBars(mergedBars);
            setRawBarSize('1d');
            const minuteBars = parseBars(minutePayload);
            setSource(normalizeSource(minuteBars.length > 0 ? minutePayload.source : dailyPayload.source));
          }
          return;
        }

        const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
        url.searchParams.set('symbol', symbol);

        if (useDaily) {
          url.searchParams.set('bar_size', '1 day');
          url.searchParams.set('duration', '30 Y');
        } else {
          url.searchParams.set('bar_size', '1 min');
          const currentBars = rawBarsRef.current;
          if (currentBars.length > 0) {
            const lastTs = currentBars[currentBars.length - 1].time;
            url.searchParams.set('ts_start', String(Math.max(0, lastTs - 60_000)));
          } else {
            url.searchParams.set('duration', '30 D');
          }
        }

        const res = await fetch(url.toString());
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled || requestId !== requestIdRef.current) return;

        if (payload.ts_min != null && payload.ts_max != null) {
          serverExtentRef.current = { tsMin: payload.ts_min, tsMax: payload.ts_max };
        }

        const newBars = parseBars(payload);

        if (useDaily) {
          if (newBars.length > 0) {
            setUpdateMode('full');
            setRawBars(newBars);
            setRawBarSize('1d');
            setSource((payload.source as 'tws' | 'yahoo' | 'cache') || 'yahoo');
          }
        } else if (newBars.length > 0) {
          const prevBars = rawBarsRef.current;
          const firstNewTs = newBars[0].time;
          const changeIdx = prevBars.length > 0
            ? prevBars.findIndex(b => b.time >= firstNewTs)
            : 0;
          setTailChangeOffset(Math.max(0, changeIdx === -1 ? prevBars.length : changeIdx));
          setUpdateMode('tail');
          setRawBars(prev => {
            const merged = mergeBarsByTime(prev, newBars);
            if (merged.length > MAX_CACHED_BARS) {
              return merged.slice(merged.length - MAX_CACHED_BARS);
            }
            return merged;
          });
          setSource((payload.source as 'tws' | 'yahoo' | 'cache') || 'yahoo');
        }
      } catch {
        // Swallow poll errors — next poll will retry
      }
    }

    fetchBars();
    const interval = setInterval(pollIncremental, useDaily ? DAILY_POLL_MS : INTRADAY_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (panDebounceRef.current) clearTimeout(panDebounceRef.current);
    };
  }, [symbol, sidecarPort, timeframe, useDaily]);

  // ── Pan-triggered fetch: load older bars when scrolling left ─────────
  const onViewportChange = useCallback((startIdx: number, endIdx: number) => {
    const displayBars = displayBarsRef.current;
    if (displayBars.length > 0) {
      const clampedStart = Math.max(0, Math.min(displayBars.length - 1, startIdx));
      const anchorBar = displayBars[clampedStart];
      if (anchorBar) {
        viewportAnchorRef.current = { startIdx: clampedStart, anchorTime: anchorBar.time };
      }
    }

    // Only do pan-fetches for intraday
    if (useDaily || !sidecarPort) return;

    // If user is near the left edge of cached bars, fetch older data
    const bufferThreshold = Math.max(10, (endIdx - startIdx) * 0.25);

    if (startIdx < bufferThreshold && !panFetchingRef.current) {
      // Already at the server's earliest bar — nothing older to fetch
      const extent = serverExtentRef.current;
      const currentBars = rawBarsRef.current;
      if (extent && currentBars.length > 0 && currentBars[0].time <= extent.tsMin) {
        return;
      }

      if (panDebounceRef.current) clearTimeout(panDebounceRef.current);
      panDebounceRef.current = setTimeout(async () => {
        panFetchingRef.current = true;
        try {
          const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
          url.searchParams.set('symbol', symbol);
          url.searchParams.set('bar_size', '1 min');

          const curBars = rawBarsRef.current;
          if (curBars.length > 0) {
            url.searchParams.set('ts_end', String(curBars[0].time - 1));
          }
          url.searchParams.set('limit', String(initialLimit));

          const res = await fetch(url.toString());
          if (!res.ok) return;
          const payload = await res.json();

          if (payload.ts_min != null && payload.ts_max != null) {
            serverExtentRef.current = { tsMin: payload.ts_min, tsMax: payload.ts_max };
          }

          const olderBars = parseBars(payload);
          if (olderBars.length > 0) {
            const anchor = viewportAnchorRef.current;
            const currentRawBars = rawBarsRef.current;
            const merged = [...olderBars, ...currentRawBars];
            const nextRawBars = merged.length > MAX_CACHED_BARS
              ? merged.slice(0, MAX_CACHED_BARS)
              : merged;
            if (anchor) {
              const nextDisplayBars = getDisplayBars(nextRawBars, '1m', timeframe);
              const nextAnchorIdx = nextDisplayBars.findIndex((bar) => bar.time === anchor.anchorTime);
              if (nextAnchorIdx > anchor.startIdx) {
                setPendingViewportShift(shift => shift + (nextAnchorIdx - anchor.startIdx));
              }
            }
            setUpdateMode('full');
            setRawBars(nextRawBars);
          }
        } catch {
          // Swallow — next pan will retry
        } finally {
          panFetchingRef.current = false;
        }
      }, PAN_FETCH_DEBOUNCE);
    }
  }, [useDaily, sidecarPort, symbol, initialLimit, timeframe]);

  const bars = useMemo(() => {
    if (rawBars.length > 0) {
      return getDisplayBars(rawBars, rawBarSize, timeframe);
    }
    if (!sidecarPort) {
      return generateMockData(symbol, timeframe, 2000);
    }
    return [];
  }, [rawBars, rawBarSize, timeframe, symbol, sidecarPort]);

  displayBarsRef.current = bars;

  const onViewportShiftApplied = useCallback(() => {
    setPendingViewportShift(0);
  }, []);

  return { bars, loading, source, onViewportChange, pendingViewportShift, onViewportShiftApplied, updateMode, tailChangeOffset };
}

function bucketFor(tsMs: number, timeframe: string): number {
  if (timeframe === '1W') {
    const MONDAY_OFFSET_MS = 4 * 86_400_000;
    return Math.floor((tsMs - MONDAY_OFFSET_MS) / 604_800_000) * 604_800_000 + MONDAY_OFFSET_MS;
  }
  if (timeframe === '1M' || timeframe === '3M' || timeframe === '6M' || timeframe === '12M') {
    const d = new Date(tsMs);
    const monthsPerBucket = timeframe === '3M' ? 3 : timeframe === '6M' ? 6 : timeframe === '12M' ? 12 : 1;
    const bucketMonth = Math.floor(d.getUTCMonth() / monthsPerBucket) * monthsPerBucket;
    return Date.UTC(d.getUTCFullYear(), bucketMonth, 1);
  }
  const ms = getTimeframeMs(timeframe);
  return Math.floor(tsMs / ms) * ms;
}

function resampleBars(bars1m: OHLCVBar[], timeframe: string): OHLCVBar[] {
  if (timeframe === '1m') return bars1m;

  const result: OHLCVBar[] = [];
  let current: OHLCVBar | null = null;
  let currentBucket = -1;

  for (const bar of bars1m) {
    const bucket = bucketFor(bar.time, timeframe);

    if (bucket !== currentBucket || !current) {
      if (current) result.push(current);
      currentBucket = bucket;
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
    }
  }

  if (current) result.push(current);
  return result;
}

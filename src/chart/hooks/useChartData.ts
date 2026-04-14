import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { OHLCVBar } from '../types';
import { getTimeframeMs, DEFAULT_BARS_VISIBLE } from '../constants';

interface UseChartDataOptions {
  symbol: string;
  timeframe: string;
  sidecarPort: number | null;
}

type RawBarSize = '1m' | '5m' | '15m' | '1d';

interface UseChartDataResult {
  bars: OHLCVBar[];
  loading: boolean;
  source: 'tws' | 'yahoo' | 'cache' | 'offline';
  datasetKey: string;
  onViewportChange: (startIdx: number, endIdx: number) => void;
  pendingViewportShift: number;
  onViewportShiftApplied: () => void;
  updateMode: 'full' | 'tail';
  tailChangeOffset: number;
}

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
// Max raw 1m bars to keep in memory (trim oldest when exceeded; pan-fetch can reload)
const MAX_INTRADAY_RAW_BARS = 200_000;
// Debounce pan-triggered fetches (ms)
const PAN_FETCH_DEBOUNCE = 200;
// Polling intervals (ms)
const INTRADAY_POLL_MS = 5_000;
const DAILY_POLL_MS = 60_000;

function parseBars(payload: { bars: Array<Record<string, number | boolean>> }): OHLCVBar[] {
  return payload.bars.map(b => ({
    time: b.time as number,
    open: b.open as number,
    high: b.high as number,
    low: b.low as number,
    close: b.close as number,
    volume: b.volume as number,
    ...(b.synthetic ? { synthetic: true } : {}),
  }));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function estimateIntradayDurationDays(timeframe: string, rawBarSize: RawBarSize): number {
  const factor = Math.max(1, getResampleFactor(timeframe));
  const targetRawBars = DEFAULT_BARS_VISIBLE * BUFFER_MULTIPLIER * factor;

  if (rawBarSize === '1m') {
    // Yahoo 1m hard-limit is ~29 days; keep this bounded.
    const days = Math.ceil((targetRawBars / 390) * 2);
    return clampInt(days, 3, 29);
  }
  if (rawBarSize === '5m') {
    const days = Math.ceil((targetRawBars / 78) * 2);
    return clampInt(days, 5, 365);
  }
  const days = Math.ceil((targetRawBars / 26) * 2);
  return clampInt(days, 10, 730);
}

function getHistoricalRequestConfig(timeframe: string): {
  barSizeParam: '1 min' | '5 mins' | '15 mins' | '1 day';
  rawBarSize: RawBarSize;
  duration: string;
  stepMs: number;
} {
  const tfMs = getTimeframeMs(timeframe);
  if (tfMs >= 86_400_000) {
    return { barSizeParam: '1 day', rawBarSize: '1d', duration: '30 Y', stepMs: 86_400_000 };
  }
  if (tfMs <= 3 * 60_000) {
    const durationDays = estimateIntradayDurationDays(timeframe, '1m');
    return { barSizeParam: '1 min', rawBarSize: '1m', duration: `${durationDays} D`, stepMs: 60_000 };
  }
  if (tfMs <= 10 * 60_000) {
    const durationDays = estimateIntradayDurationDays(timeframe, '5m');
    return { barSizeParam: '5 mins', rawBarSize: '5m', duration: `${durationDays} D`, stepMs: 5 * 60_000 };
  }
  const durationDays = estimateIntradayDurationDays(timeframe, '15m');
  return { barSizeParam: '15 mins', rawBarSize: '15m', duration: `${durationDays} D`, stepMs: 15 * 60_000 };
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

function trimIntradayTail(bars: OHLCVBar[]): OHLCVBar[] {
  if (bars.length <= MAX_INTRADAY_RAW_BARS) return bars;
  return bars.slice(bars.length - MAX_INTRADAY_RAW_BARS);
}

function canUseTailUpdate(existingBars: OHLCVBar[], nextBars: OHLCVBar[], changeOffset: number): boolean {
  if (existingBars.length === 0 || nextBars.length === 0) return false;
  if (!Number.isFinite(changeOffset) || changeOffset < 0) return false;
  if (changeOffset > existingBars.length || changeOffset > nextBars.length) return false;
  if (nextBars.length < existingBars.length) return false;
  for (let i = 0; i < changeOffset; i++) {
    if (existingBars[i]?.time !== nextBars[i]?.time) return false;
  }
  return true;
}

function getDisplayBars(rawBars: OHLCVBar[], rawBarSize: RawBarSize, timeframe: string): OHLCVBar[] {
  if ((rawBarSize === '1d' && timeframe === '1D') || timeframe === rawBarSize) {
    return rawBars;
  }
  return resampleBars(rawBars, timeframe);
}

export function useChartData({ symbol, timeframe, sidecarPort }: UseChartDataOptions): UseChartDataResult {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const [rawBars, setRawBars] = useState<OHLCVBar[]>([]);
  const [rawBarSize, setRawBarSize] = useState<RawBarSize>('1m');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'tws' | 'yahoo' | 'cache' | 'offline'>('offline');
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
  const intradayPollRafRef = useRef<number | null>(null);
  const intradayPollPendingRef = useRef<{ bars: OHLCVBar[]; source: 'tws' | 'yahoo' | 'cache' } | null>(null);
  const activeDatasetKeyRef = useRef('');

  // Keep ref in sync for async access
  rawBarsRef.current = rawBars;

  const useDaily = isDailyTimeframe(timeframe);
  const requestConfig = useMemo(() => getHistoricalRequestConfig(timeframe), [timeframe]);
  const datasetKey = useMemo(
    () => `${normalizedSymbol}::${timeframe}::${requestConfig.rawBarSize}`,
    [normalizedSymbol, timeframe, requestConfig.rawBarSize],
  );

  // How many raw 1m bars to fetch for the initial load
  const initialLimit = useMemo(() => {
    const factor = getResampleFactor(timeframe);
    return DEFAULT_BARS_VISIBLE * BUFFER_MULTIPLIER * factor;
  }, [timeframe]);

  // ── Daily: full fetch (unchanged behavior) ──────────────────────────
  // ── Intraday: windowed fetch with limit ─────────────────────────────
  useEffect(() => {
    const datasetChanged = activeDatasetKeyRef.current !== datasetKey;
    activeDatasetKeyRef.current = datasetKey;

    if (panDebounceRef.current) {
      clearTimeout(panDebounceRef.current);
      panDebounceRef.current = null;
    }
    if (intradayPollRafRef.current != null) {
      cancelAnimationFrame(intradayPollRafRef.current);
      intradayPollRafRef.current = null;
    }
    intradayPollPendingRef.current = null;
    panFetchingRef.current = false;
    setUpdateMode('full');
    setTailChangeOffset(0);
    setPendingViewportShift(0);
    viewportAnchorRef.current = null;

    if (datasetChanged) {
      rawBarsRef.current = [];
      displayBarsRef.current = [];
      setRawBars([]);
      setRawBarSize(requestConfig.rawBarSize);
    }

    if (!normalizedSymbol) {
      setRawBars([]);
      setSource('offline');
      setLoading(false);
      return;
    }
    if (!sidecarPort) {
      // Port temporarily offline (sidecar restarting) — keep existing bars visible
      setSource('offline');
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    serverExtentRef.current = null;

    let cancelled = false;

    async function fetchBars() {
      try {
        const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
        url.searchParams.set('symbol', normalizedSymbol);
        url.searchParams.set('bar_size', requestConfig.barSizeParam);
        url.searchParams.set('duration', requestConfig.duration);

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
          setRawBars(useDaily ? bars : trimIntradayTail(bars));
          setRawBarSize(requestConfig.rawBarSize);
          setSource((payload.source as 'tws' | 'yahoo' | 'cache') || 'yahoo');
        } else {
          setRawBars([]);
          setSource('offline');
        }
        setLoading(false);
      } catch {
        if (!cancelled) {
          // Don't clear bars on error — keep showing existing data.
          // A transient network failure shouldn't reset the viewport.
          if (rawBarsRef.current.length === 0) {
            setSource('offline');
          }
          setLoading(false);
        }
      }
    }

    // Incremental poll: for intraday, only fetch new bars since last cached bar
    async function pollIncremental() {
      if (cancelled || requestId !== requestIdRef.current) return;
      if (panFetchingRef.current) return;
      try {
        const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
        url.searchParams.set('symbol', normalizedSymbol);
        url.searchParams.set('bar_size', requestConfig.barSizeParam);
        const currentBars = rawBarsRef.current;
        if (currentBars.length > 0) {
          const lastTs = currentBars[currentBars.length - 1].time;
          url.searchParams.set('ts_start', String(Math.max(0, lastTs - requestConfig.stepMs)));
        } else {
          url.searchParams.set('duration', requestConfig.duration);
        }

        const res = await fetch(url.toString());
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled || requestId !== requestIdRef.current) return;

        if (payload.ts_min != null && payload.ts_max != null) {
          serverExtentRef.current = { tsMin: payload.ts_min, tsMax: payload.ts_max };
        }

        const newBars = parseBars(payload);

        if (newBars.length > 0) {
          intradayPollPendingRef.current = {
            bars: newBars,
            source: (payload.source as 'tws' | 'yahoo' | 'cache') || 'yahoo',
          };
          if (intradayPollRafRef.current == null) {
            intradayPollRafRef.current = requestAnimationFrame(() => {
              intradayPollRafRef.current = null;
              if (cancelled || requestId !== requestIdRef.current) {
                intradayPollPendingRef.current = null;
                return;
              }
              const pack = intradayPollPendingRef.current;
              intradayPollPendingRef.current = null;
              if (!pack?.bars.length) return;
              const incoming = pack.bars;
              const prevBars = rawBarsRef.current;
              const firstNewTs = incoming[0].time;
              const changeIdx = prevBars.length > 0
                ? prevBars.findIndex(b => b.time >= firstNewTs)
                : 0;
              let resolvedUpdateMode: 'full' | 'tail' = 'full';
              let resolvedTailChangeOffset = 0;
              setRawBars(prev => {
                const merged = mergeBarsByTime(prev, incoming);
                const nextBars = requestConfig.rawBarSize === '1d' ? merged : trimIntradayTail(merged);
                const offset = Math.max(0, changeIdx === -1 ? prevBars.length : changeIdx);
                if (canUseTailUpdate(prev, nextBars, offset)) {
                  resolvedUpdateMode = 'tail';
                  resolvedTailChangeOffset = offset;
                }
                return nextBars;
              });
              setTailChangeOffset(resolvedTailChangeOffset);
              setUpdateMode(resolvedUpdateMode);
              setRawBarSize(requestConfig.rawBarSize);
              setSource(pack.source);
            });
          }
        }
      } catch {
        // Swallow poll errors — next poll will retry
      }
    }

    fetchBars();
    const interval = setInterval(pollIncremental, requestConfig.rawBarSize === '1d' ? DAILY_POLL_MS : INTRADAY_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (panDebounceRef.current) clearTimeout(panDebounceRef.current);
      if (intradayPollRafRef.current != null) {
        cancelAnimationFrame(intradayPollRafRef.current);
        intradayPollRafRef.current = null;
      }
      intradayPollPendingRef.current = null;
    };
  }, [datasetKey, normalizedSymbol, sidecarPort, timeframe, useDaily, requestConfig]);

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
    if (useDaily || !sidecarPort || !normalizedSymbol) return;

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
          url.searchParams.set('symbol', normalizedSymbol);
          url.searchParams.set('bar_size', requestConfig.barSizeParam);

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
            const nextRawBars = merged.length > MAX_INTRADAY_RAW_BARS
              ? merged.slice(0, MAX_INTRADAY_RAW_BARS)
              : merged;
            if (anchor) {
              const nextDisplayBars = getDisplayBars(nextRawBars, requestConfig.rawBarSize, timeframe);
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
  }, [useDaily, sidecarPort, normalizedSymbol, initialLimit, timeframe, requestConfig]);

  const bars = useMemo(() => {
    if (rawBars.length > 0) {
      return getDisplayBars(rawBars, rawBarSize, timeframe);
    }
    return [];
  }, [rawBars, rawBarSize, timeframe]);

  displayBarsRef.current = bars;

  const onViewportShiftApplied = useCallback(() => {
    setPendingViewportShift(0);
  }, []);

  return { bars, loading, source, datasetKey, onViewportChange, pendingViewportShift, onViewportShiftApplied, updateMode, tailChangeOffset };
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
  let bucketHasSynthetic = false;

  for (const bar of bars1m) {
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

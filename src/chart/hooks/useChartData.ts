import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { OHLCVBar } from '../types';
import { getTimeframeMs, DEFAULT_BARS_VISIBLE } from '../constants';
import {
  type RawBarSize,
  getHistoricalRequestConfig,
  displayBarsForTimeframe,
} from '../../lib/historical-request';

interface UseChartDataOptions {
  symbol: string;
  timeframe: string;
  sidecarPort: number | null;
}

interface UseChartDataResult {
  bars: OHLCVBar[];
  loading: boolean;
  source: 'tws' | 'dailyiq' | 'yahoo' | 'cache' | 'offline';
  datasetKey: string;
  onViewportChange: (startIdx: number, endIdx: number) => void;
  pendingViewportShift: number;
  onViewportShiftApplied: () => void;
  updateMode: 'full' | 'tail';
  tailChangeOffset: number;
  isStale: boolean;
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
const INTRADAY_POLL_MS = 3_000;
const DAILY_POLL_MS = 60_000;
const DAILY_FALLBACK_POLL_MS = 5_000;

// ── Module-level raw bar cache ────────────────────────────────────────────────
// Survives timeframe switches within a session. Keyed by symbol::rawBarSize.
// Allows cross-tier switches (e.g. 5m→1H) to serve cached bars immediately
// while a background refresh runs, instead of showing a blank loading state.

interface RawBarCacheEntry {
  bars: OHLCVBar[];
  tsMin: number;
  tsMax: number;
  fetchedAt: number;
}

const RAW_BAR_CACHE = new Map<string, RawBarCacheEntry>();
const RAW_BAR_CACHE_MAX = 5;
const RAW_BAR_CACHE_TTL = 5 * 60_000; // mirrors backend SQLite intraday TTL

function rawCacheKey(symbol: string, rawBarSize: RawBarSize): string {
  return `${symbol}::${rawBarSize}`;
}

function setRawCache(
  symbol: string,
  rawBarSize: RawBarSize,
  bars: OHLCVBar[],
  tsMin: number,
  tsMax: number,
): void {
  if (RAW_BAR_CACHE.size >= RAW_BAR_CACHE_MAX) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [k, v] of RAW_BAR_CACHE) {
      if (v.fetchedAt < oldestTime) { oldestTime = v.fetchedAt; oldestKey = k; }
    }
    if (oldestKey) RAW_BAR_CACHE.delete(oldestKey);
  }
  RAW_BAR_CACHE.set(rawCacheKey(symbol, rawBarSize), { bars, tsMin, tsMax, fetchedAt: Date.now() });
}

function getRawCache(symbol: string, rawBarSize: RawBarSize): RawBarCacheEntry | undefined {
  return RAW_BAR_CACHE.get(rawCacheKey(symbol, rawBarSize));
}

// ─────────────────────────────────────────────────────────────────────────────

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

export function useChartData({ symbol, timeframe, sidecarPort }: UseChartDataOptions): UseChartDataResult {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const [rawBars, setRawBars] = useState<OHLCVBar[]>([]);
  const [rawBarSize, setRawBarSize] = useState<RawBarSize>('1m');
  const [loading, setLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [source, setSource] = useState<'tws' | 'dailyiq' | 'yahoo' | 'cache' | 'offline'>('offline');
  const [pendingViewportShift, setPendingViewportShift] = useState(0);
  const [updateMode, setUpdateMode] = useState<'full' | 'tail'>('full');
  const [tailChangeOffset, setTailChangeOffset] = useState(0);
  const requestIdRef = useRef(0);
  // Keep a ref to rawBars for async access without stale closures
  const rawBarsRef = useRef<OHLCVBar[]>([]);
  const displayBarsRef = useRef<OHLCVBar[]>([]);
  const sourceRef = useRef<'tws' | 'dailyiq' | 'yahoo' | 'cache' | 'offline'>('offline');
  // Track the server's full cached extent for the current symbol
  const serverExtentRef = useRef<{ tsMin: number; tsMax: number } | null>(null);
  // Debounce timer for pan fetches
  const panDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce timer for initial fetch (prevents stacked requests on rapid TF clicks)
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track if a pan fetch is in-flight to avoid stacking
  const panFetchingRef = useRef(false);
  const viewportAnchorRef = useRef<{ startIdx: number; anchorTime: number } | null>(null);
  const intradayPollRafRef = useRef<number | null>(null);
  const intradayPollPendingRef = useRef<{ bars: OHLCVBar[]; source: 'tws' | 'dailyiq' | 'yahoo' | 'cache' } | null>(null);
  // Track what is currently loaded to detect same-tier TF switches vs. real tier/symbol changes
  const loadedSymbolRef = useRef<string>('');
  const loadedRawBarSizeRef = useRef<RawBarSize | null>(null);
  const lastSidecarPortRef = useRef<number | null>(null);

  // Keep ref in sync for async access
  rawBarsRef.current = rawBars;
  sourceRef.current = source;

  const useDaily = isDailyTimeframe(timeframe);
  const requestConfig = useMemo(() => getHistoricalRequestConfig(timeframe), [timeframe]);

  // Always-fresh refs so async closures inside the effect never capture stale values,
  // even after we remove requestConfig/initialLimit from the effect dependency array.
  const requestConfigRef = useRef(requestConfig);
  requestConfigRef.current = requestConfig;

  const initialLimit = useMemo(() => {
    const factor = getResampleFactor(timeframe);
    return DEFAULT_BARS_VISIBLE * BUFFER_MULTIPLIER * factor;
  }, [timeframe]);

  const initialLimitRef = useRef(initialLimit);
  initialLimitRef.current = initialLimit;

  // Symbol+timeframe drives ChartEngine viewport resets. rawBarSize is intentionally
  // excluded so same-tier TF switches (5m→10m, 1H→4H, 1D→1W) don't trigger the fetch effect.
  const datasetKey = useMemo(
    () => `${normalizedSymbol}::${timeframe}`,
    [normalizedSymbol, timeframe],
  );

  // ── Daily: full fetch (unchanged behavior) ──────────────────────────
  // ── Intraday: windowed fetch with limit ─────────────────────────────
  useEffect(() => {
    // Classify this effect run to decide how much work is needed.
    const symbolChanged = loadedSymbolRef.current !== normalizedSymbol;
    // Port change (e.g. sidecar reconnect) always forces a full refetch.
    const portChanged = lastSidecarPortRef.current !== sidecarPort;
    const rawBarSizeChanged = loadedRawBarSizeRef.current !== requestConfig.rawBarSize;
    // Fast path: same symbol, same tier, same port, already have bars loaded.
    // Only the display resample changes (handled client-side in the bars memo).
    const isFastPath =
      !symbolChanged && !portChanged && !rawBarSizeChanged && rawBarsRef.current.length > 0;

    lastSidecarPortRef.current = sidecarPort;

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

    if (!isFastPath) {
      // Symbol, tier, or port changed — start fresh
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
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Define all async helpers first so they can be referenced below ──

    async function fetchBars() {
      try {
        const cfg = requestConfigRef.current;
        const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
        url.searchParams.set('symbol', normalizedSymbol);
        url.searchParams.set('bar_size', cfg.barSizeParam);
        url.searchParams.set('duration', cfg.duration);
        url.searchParams.set('prefer_live_refresh', '1');
        if (!useDaily) {
          url.searchParams.set('limit', String(initialLimitRef.current));
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
          const trimmed = useDaily ? bars : trimIntradayTail(bars);
          setRawBars(trimmed);
          setRawBarSize(cfg.rawBarSize);
          setSource((payload.source as 'tws' | 'dailyiq' | 'yahoo' | 'cache') || 'yahoo');
          // Populate module-level cache so future tier switches can serve immediately
          if (payload.ts_min != null && payload.ts_max != null) {
            setRawCache(normalizedSymbol, cfg.rawBarSize, trimmed, payload.ts_min, payload.ts_max);
          }
        } else {
          setRawBars([]);
          setSource('offline');
        }
        setIsStale(false);
        setLoading(false);
        loadedSymbolRef.current = normalizedSymbol;
        loadedRawBarSizeRef.current = cfg.rawBarSize;
      } catch {
        if (!cancelled) {
          // Don't clear bars on error — keep showing existing data.
          // A transient network failure shouldn't reset the viewport.
          if (rawBarsRef.current.length === 0) {
            setSource('offline');
          }
          setIsStale(false);
          setLoading(false);
        }
      }
    }

    // Like fetchBars but non-blocking: doesn't touch loading state, merges over cached bars.
    async function fetchBarsBackground() {
      try {
        const cfg = requestConfigRef.current;
        const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
        url.searchParams.set('symbol', normalizedSymbol);
        url.searchParams.set('bar_size', cfg.barSizeParam);
        url.searchParams.set('duration', cfg.duration);
        url.searchParams.set('prefer_live_refresh', '1');
        if (!useDaily) {
          url.searchParams.set('limit', String(initialLimitRef.current));
        }

        const res = await fetch(url.toString());
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled || requestId !== requestIdRef.current) return;

        if (payload.ts_min != null && payload.ts_max != null) {
          serverExtentRef.current = { tsMin: payload.ts_min, tsMax: payload.ts_max };
        }

        const bars = parseBars(payload);
        if (bars.length > 0) {
          const trimmed = useDaily ? bars : trimIntradayTail(bars);
          // Merge with any bars appended by the poll during background fetch
          const next = mergeBarsByTime(rawBarsRef.current, trimmed);
          const nextTrimmed = useDaily ? next : trimIntradayTail(next);
          setRawBars(nextTrimmed);
          setRawBarSize(cfg.rawBarSize);
          setSource((payload.source as 'tws' | 'dailyiq' | 'yahoo' | 'cache') || 'yahoo');
          if (payload.ts_min != null && payload.ts_max != null) {
            setRawCache(normalizedSymbol, cfg.rawBarSize, nextTrimmed, payload.ts_min, payload.ts_max);
          }
        }
        setIsStale(false);
        loadedSymbolRef.current = normalizedSymbol;
        loadedRawBarSizeRef.current = cfg.rawBarSize;
      } catch {
        if (!cancelled) setIsStale(false);
      }
    }

    // Incremental poll: for intraday, only fetch new bars since last cached bar
    async function pollIncremental() {
      if (cancelled || requestId !== requestIdRef.current) return;
      if (panFetchingRef.current) return;
      try {
        const cfg = requestConfigRef.current;
        const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
        url.searchParams.set('symbol', normalizedSymbol);
        url.searchParams.set('bar_size', cfg.barSizeParam);
        url.searchParams.set('prefer_live_refresh', '1');
        const currentBars = rawBarsRef.current;
        if (currentBars.length > 0) {
          const lastTs = currentBars[currentBars.length - 1].time;
          url.searchParams.set('ts_start', String(Math.max(0, lastTs - cfg.stepMs)));
        } else {
          url.searchParams.set('duration', cfg.duration);
        }

        const res = await fetch(url.toString());
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled || requestId !== requestIdRef.current) return;

        if (payload.ts_min != null && payload.ts_max != null) {
          serverExtentRef.current = { tsMin: payload.ts_min, tsMax: payload.ts_max };
        }

        // Proactive backfill detection: if the server's oldest bar is earlier than
        // what we have locally, the background worker has populated older history.
        // Trigger a prepend fetch so the chart grows left automatically.
        if (!useDaily) {
          const extent = serverExtentRef.current;
          const localBars = rawBarsRef.current;
          if (extent && localBars.length > 0 && extent.tsMin < localBars[0].time) {
            fetchOlderBars(localBars[0].time - 1).catch(() => {});
          }
        }

        const newBars = parseBars(payload);

        if (newBars.length > 0) {
          intradayPollPendingRef.current = {
            bars: newBars,
            source: (payload.source as 'tws' | 'dailyiq' | 'yahoo' | 'cache') || 'yahoo',
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
              const merged = mergeBarsByTime(prevBars, incoming);
              const cfg = requestConfigRef.current;
              const nextBars = cfg.rawBarSize === '1d' ? merged : trimIntradayTail(merged);
              const offset = Math.max(0, changeIdx === -1 ? prevBars.length : changeIdx);
              const canTail = canUseTailUpdate(prevBars, nextBars, offset);
              setRawBars(nextBars);
              setTailChangeOffset(canTail ? offset : 0);
              setUpdateMode(canTail ? 'tail' : 'full');
              setRawBarSize(cfg.rawBarSize);
              setSource(pack.source);
            });
          }
        }
      } catch {
        // Swallow poll errors — next poll will retry
      }
    }

    // ── Shared: fetch and prepend older bars up to tsEnd ─────────────
    async function fetchOlderBars(tsEnd: number) {
      if (panFetchingRef.current || cancelled || requestId !== requestIdRef.current) return;
      panFetchingRef.current = true;
      try {
        const cfg = requestConfigRef.current;
        const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
        url.searchParams.set('symbol', normalizedSymbol);
        url.searchParams.set('bar_size', cfg.barSizeParam);
        url.searchParams.set('prefer_live_refresh', '1');
        url.searchParams.set('ts_end', String(tsEnd));
        url.searchParams.set('limit', String(initialLimitRef.current));

        const res = await fetch(url.toString());
        if (!res.ok || cancelled || requestId !== requestIdRef.current) return;
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
            const nextDisplayBars = displayBarsForTimeframe(nextRawBars, cfg.rawBarSize, timeframe);
            const nextAnchorIdx = nextDisplayBars.findIndex(b => b.time === anchor.anchorTime);
            if (nextAnchorIdx > anchor.startIdx) {
              setPendingViewportShift(shift => shift + (nextAnchorIdx - anchor.startIdx));
            }
          }
          setUpdateMode('full');
          setRawBars(nextRawBars);
        }
      } catch {
        // Swallow — next poll/pan will retry
      } finally {
        panFetchingRef.current = false;
      }
    }

    function currentPollMs(): number {
      if (requestConfigRef.current.rawBarSize !== '1d') return INTRADAY_POLL_MS;
      const src = sourceRef.current;
      return src === 'dailyiq' || src === 'offline' ? DAILY_FALLBACK_POLL_MS : DAILY_POLL_MS;
    }

    const scheduleNextPoll = () => {
      if (cancelled || requestId !== requestIdRef.current) return;
      pollTimer = setTimeout(() => {
        pollTimer = null;
        pollIncremental().finally(scheduleNextPoll);
      }, currentPollMs());
    };

    // ── Fast path: same symbol, same raw bar tier, same port ──────────
    // Raw bars are already valid. Only the display resample changes, which
    // the bars memo handles client-side. Just restart the poll.
    if (isFastPath) {
      scheduleNextPoll();
      return () => {
        cancelled = true;
        if (pollTimer) clearTimeout(pollTimer);
      };
    }

    // ── Full path: need new bars ──────────────────────────────────────
    serverExtentRef.current = null;

    // Cancel any pending debounced fetch from a previous rapid TF click
    if (fetchDebounceRef.current) {
      clearTimeout(fetchDebounceRef.current);
      fetchDebounceRef.current = null;
    }

    const cached = getRawCache(normalizedSymbol, requestConfig.rawBarSize);
    const cacheIsFresh = cached != null && (Date.now() - cached.fetchedAt < RAW_BAR_CACHE_TTL);

    if (cacheIsFresh) {
      // Serve cached bars immediately — chart is not blank
      rawBarsRef.current = cached.bars;
      setRawBars(cached.bars);
      setRawBarSize(requestConfig.rawBarSize);
      serverExtentRef.current = { tsMin: cached.tsMin, tsMax: cached.tsMax };
      setSource('cache');
      setLoading(false);
      setIsStale(true);
      loadedSymbolRef.current = normalizedSymbol;
      loadedRawBarSizeRef.current = requestConfig.rawBarSize;
      // Refresh in background — UI stays responsive
      fetchBarsBackground();
    } else {
      // Cache miss or stale — debounce prevents stacking on rapid TF clicks
      setLoading(true);
      setIsStale(false);
      fetchDebounceRef.current = setTimeout(() => {
        fetchDebounceRef.current = null;
        if (cancelled || requestId !== requestIdRef.current) return;
        fetchBars();
      }, 150);
    }

    scheduleNextPoll();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current);
        fetchDebounceRef.current = null;
      }
      if (panDebounceRef.current) clearTimeout(panDebounceRef.current);
      if (intradayPollRafRef.current != null) {
        cancelAnimationFrame(intradayPollRafRef.current);
        intradayPollRafRef.current = null;
      }
      intradayPollPendingRef.current = null;
    };
  }, [normalizedSymbol, sidecarPort, requestConfig.rawBarSize, useDaily]);

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
        if (panFetchingRef.current) return;
        panFetchingRef.current = true;
        try {
          const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
          url.searchParams.set('symbol', normalizedSymbol);
          url.searchParams.set('bar_size', requestConfig.barSizeParam);
          url.searchParams.set('prefer_live_refresh', '1');

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
              const nextDisplayBars = displayBarsForTimeframe(nextRawBars, requestConfig.rawBarSize, timeframe);
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
      return displayBarsForTimeframe(rawBars, rawBarSize, timeframe);
    }
    return [];
  }, [rawBars, rawBarSize, timeframe]);

  displayBarsRef.current = bars;

  const onViewportShiftApplied = useCallback(() => {
    setPendingViewportShift(0);
  }, []);

  return { bars, loading, isStale, source, datasetKey, onViewportChange, pendingViewportShift, onViewportShiftApplied, updateMode, tailChangeOffset };
}

import { useState, useEffect, useRef, useMemo } from 'react';
import type { OHLCVBar, Timeframe } from '../types';
import { TIMEFRAME_MS } from '../constants';
import { generateMockData } from '../mock-data';

interface UseChartDataOptions {
  symbol: string;
  timeframe: Timeframe;
  sidecarPort: number | null;
}

interface UseChartDataResult {
  bars: OHLCVBar[];
  loading: boolean;
  source: 'tws' | 'yahoo' | 'cache' | 'mock';
}

const DAILY_TIMEFRAMES = new Set<Timeframe>(['1D', '1W', '1M']);

export function useChartData({ symbol, timeframe, sidecarPort }: UseChartDataOptions): UseChartDataResult {
  const [rawBars, setRawBars] = useState<OHLCVBar[]>([]);
  const [rawBarSize, setRawBarSize] = useState<'1m' | '1d'>('1m');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'tws' | 'yahoo' | 'cache' | 'mock'>('mock');
  const requestIdRef = useRef(0);

  const useDaily = DAILY_TIMEFRAMES.has(timeframe);

  useEffect(() => {
    if (!sidecarPort) {
      setSource('mock');
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);

    const barSize = useDaily ? '1 day' : '1 min';
    const duration = useDaily ? '2 Y' : '5 D';

    let cancelled = false;

    async function fetchBars() {
      try {
        const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
        url.searchParams.set('symbol', symbol);
        url.searchParams.set('bar_size', barSize);
        url.searchParams.set('duration', duration);

        const res = await fetch(url.toString());
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled || requestId !== requestIdRef.current) return;

        const bars = (payload.bars as Array<Record<string, number>>).map(b => ({
          time: b.time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));

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
          setRawBars([]);
          setSource('mock');
          setLoading(false);
        }
      }
    }

    fetchBars();
    const interval = setInterval(fetchBars, useDaily ? 60_000 : 5_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol, sidecarPort, useDaily]);

  const bars = useMemo(() => {
    if (rawBars.length > 0) {
      if ((rawBarSize === '1d' && timeframe === '1D') || (rawBarSize === '1m' && timeframe === '1m')) {
        return rawBars;
      }
      return resampleBars(rawBars, timeframe);
    }
    if (!sidecarPort) {
      return generateMockData(symbol, timeframe, 2000);
    }
    return [];
  }, [rawBars, rawBarSize, timeframe, symbol, sidecarPort]);

  return { bars, loading, source };
}

function bucketFor(tsMs: number, timeframe: Timeframe): number {
  if (timeframe === '1W') {
    const MONDAY_OFFSET_MS = 4 * 86_400_000;
    return Math.floor((tsMs - MONDAY_OFFSET_MS) / 604_800_000) * 604_800_000 + MONDAY_OFFSET_MS;
  }
  if (timeframe === '1M') {
    const d = new Date(tsMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  return Math.floor(tsMs / TIMEFRAME_MS[timeframe]) * TIMEFRAME_MS[timeframe];
}

function resampleBars(bars1m: OHLCVBar[], timeframe: Timeframe): OHLCVBar[] {
  if (timeframe === '1m' || timeframe === '1D') return bars1m;

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

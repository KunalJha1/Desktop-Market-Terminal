import { useState, useEffect, useRef, useMemo } from 'react';
import type { OHLCVBar, Timeframe } from '../types';
import { TIMEFRAME_MS } from '../constants';
import { generateMockData } from '../mock-data';
import type { SidecarWS } from '../../lib/ws';

interface UseChartDataOptions {
  symbol: string;
  timeframe: Timeframe;
  sidecarWS: SidecarWS | null;
  twsConnected: boolean;
}

interface UseChartDataResult {
  bars: OHLCVBar[];
  loading: boolean;
  source: 'tws' | 'yahoo' | 'cache' | 'mock';
}

// Timeframes that should use daily bars from the backend
const DAILY_TIMEFRAMES = new Set<Timeframe>(['1D', '1W', '1M']);

/**
 * Hook that provides OHLCV data for the chart.
 *
 * For intraday timeframes (1m–4H): requests 1m bars, resamples client-side.
 * For daily+ timeframes (1D, 1W, 1M): requests daily bars, resamples client-side.
 * Falls back to mock data when backend returns nothing.
 */
export function useChartData({ symbol, timeframe, sidecarWS, twsConnected }: UseChartDataOptions): UseChartDataResult {
  const [rawBars, setRawBars] = useState<OHLCVBar[]>([]);
  const [rawBarSize, setRawBarSize] = useState<'1m' | '1d'>('1m');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'tws' | 'yahoo' | 'cache' | 'mock'>('mock');
  const requestIdRef = useRef(0);

  const useDaily = DAILY_TIMEFRAMES.has(timeframe);

  // Request historical data from sidecar — daily bars for 1D+ timeframes, 1m for intraday
  useEffect(() => {
    if (!sidecarWS) {
      setSource('mock');
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);

    const barSize = useDaily ? '1 day' : '1 min';
    const duration = useDaily ? '2 Y' : '5 D';

    sidecarWS.send({
      type: 'historical_request',
      symbol,
      barSize,
      duration,
      requestId: `hist_${requestId}`,
    });

    // Listen for response
    const handler = (msg: Record<string, unknown>) => {
      if (msg.requestId !== `hist_${requestId}`) return;

      if (msg.type === 'historical_data') {
        const bars = (msg.bars as Array<Record<string, number>>).map(b => ({
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
          setSource((msg.source as 'tws' | 'yahoo' | 'cache') || 'tws');
        } else {
          // Backend returned zero bars — fall back to mock
          setRawBars([]);
          setSource('mock');
        }
        setLoading(false);
      }

      if (msg.type === 'historical_error') {
        console.warn('Historical data error:', msg.error);
        setRawBars([]);
        setSource('mock');
        setLoading(false);
      }
    };

    sidecarWS.on('historical_data', handler);
    sidecarWS.on('historical_error', handler);

    return () => {
      sidecarWS.off('historical_data', handler);
      sidecarWS.off('historical_error', handler);
    };
  }, [symbol, sidecarWS, twsConnected, useDaily]);

  // Listen for real-time bar updates to append (intraday only)
  useEffect(() => {
    if (!sidecarWS || !twsConnected || useDaily) return;

    sidecarWS.send({
      type: 'realtime_bars_subscribe',
      symbol,
      barSize: '1 min',
    });

    const handler = (msg: Record<string, unknown>) => {
      if (msg.symbol !== symbol) return;
      const bar: OHLCVBar = {
        time: msg.time as number,
        open: msg.open as number,
        high: msg.high as number,
        low: msg.low as number,
        close: msg.close as number,
        volume: msg.volume as number,
      };

      setRawBars(prev => {
        if (prev.length === 0) return [bar];
        const last = prev[prev.length - 1];
        if (bar.time === last.time) {
          // Update last bar
          return [...prev.slice(0, -1), bar];
        }
        return [...prev, bar];
      });
    };

    sidecarWS.on('realtime_bar', handler);

    return () => {
      sidecarWS.off('realtime_bar', handler);
      sidecarWS.send({ type: 'realtime_bars_unsubscribe', symbol });
    };
  }, [symbol, twsConnected, sidecarWS, useDaily]);

  // Resample raw bars into the requested timeframe
  // Daily bars: 1D is pass-through, 1W/1M get resampled from daily
  // Intraday bars: 1m is pass-through, 5m/15m/30m/1H/4H get resampled from 1m
  const bars = useMemo(() => {
    if (rawBars.length > 0) {
      // If raw data matches the timeframe exactly, skip resampling
      if ((rawBarSize === '1d' && timeframe === '1D') || (rawBarSize === '1m' && timeframe === '1m')) {
        return rawBars;
      }
      return resampleBars(rawBars, timeframe);
    }
    // Only fall back to mock when there is no backend connection at all.
    // When sidecarWS exists, the request is in-flight or the DB returned empty —
    // in either case show nothing rather than fake data that would be replaced on
    // response and cause a visible flicker.
    if (!sidecarWS) {
      return generateMockData(symbol, timeframe, 2000);
    }
    return [];
  }, [rawBars, rawBarSize, timeframe, symbol, sidecarWS]);

  return { bars, loading, source };
}

/**
 * Return the bucket start timestamp (Unix ms) for a bar, given the target timeframe.
 *
 * Fixed-interval timeframes (1m–4H, 1D): simple floor division.
 * 1W: floor to Monday 00:00 UTC — epoch was a Thursday so we subtract 4 days
 *     before bucketing and add it back.
 * 1M: floor to the first of the calendar month in UTC — fixed-ms math is wrong
 *     because months have 28/29/30/31 days.
 */
function bucketFor(tsMs: number, timeframe: Timeframe): number {
  if (timeframe === '1W') {
    // Jan 1 1970 was a Thursday; Jan 5 1970 was a Monday.
    // Offset so that floor-division aligns to Monday 00:00 UTC.
    const MONDAY_OFFSET_MS = 4 * 86_400_000; // Thu→Mon = +4 days
    return Math.floor((tsMs - MONDAY_OFFSET_MS) / 604_800_000) * 604_800_000 + MONDAY_OFFSET_MS;
  }
  if (timeframe === '1M') {
    const d = new Date(tsMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  return Math.floor(tsMs / TIMEFRAME_MS[timeframe]) * TIMEFRAME_MS[timeframe];
}

/**
 * Resample bars into a higher timeframe.
 * Works for both 1m→intraday and 1d→weekly/monthly resampling.
 * Volume is summed across all source bars in each bucket.
 */
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

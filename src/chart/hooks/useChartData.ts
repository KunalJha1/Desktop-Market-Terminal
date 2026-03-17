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

/**
 * Hook that provides OHLCV data for the chart.
 *
 * When TWS is connected, requests 1m historical data from the sidecar,
 * then resamples it into the requested timeframe.
 * Falls back to mock data when TWS is disconnected.
 */
export function useChartData({ symbol, timeframe, sidecarWS, twsConnected }: UseChartDataOptions): UseChartDataResult {
  const [rawBars1m, setRawBars1m] = useState<OHLCVBar[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'tws' | 'yahoo' | 'cache' | 'mock'>('mock');
  const requestIdRef = useRef(0);

  // Request 1m historical data from sidecar — always tries backend (TWS → Yahoo → cache)
  // Only falls back to mock if sidecar is unavailable or returns zero bars
  useEffect(() => {
    if (!sidecarWS) {
      setSource('mock');
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);

    // Send historical data request — sidecar picks TWS or Yahoo based on status
    sidecarWS.send({
      type: 'historical_request',
      symbol,
      barSize: '1 min',
      duration: '5 D',
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
          setRawBars1m(bars);
          setSource((msg.source as 'tws' | 'yahoo' | 'cache') || 'tws');
        } else {
          // Backend returned zero bars — fall back to mock
          setRawBars1m([]);
          setSource('mock');
        }
        setLoading(false);
      }

      if (msg.type === 'historical_error') {
        console.warn('Historical data error:', msg.error);
        setRawBars1m([]);
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
  }, [symbol, sidecarWS, twsConnected]);

  // Listen for real-time bar updates to append
  useEffect(() => {
    if (!sidecarWS || !twsConnected) return;

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

      setRawBars1m(prev => {
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
  }, [symbol, twsConnected, sidecarWS]);

  // Resample 1m data into the requested timeframe
  // Only use mock data if backend returned nothing (no real bars in DB)
  const bars = useMemo(() => {
    if (rawBars1m.length > 0) {
      return resampleBars(rawBars1m, timeframe);
    }
    if (source === 'mock') {
      return generateMockData(symbol, timeframe, 2000);
    }
    return [];
  }, [rawBars1m, timeframe, symbol, source]);

  return { bars, loading, source };
}

/**
 * Resample 1-minute bars into a higher timeframe.
 */
function resampleBars(bars1m: OHLCVBar[], timeframe: Timeframe): OHLCVBar[] {
  if (timeframe === '1m') return bars1m;

  const intervalMs = TIMEFRAME_MS[timeframe];
  const result: OHLCVBar[] = [];
  let current: OHLCVBar | null = null;
  let bucketStart = 0;

  for (const bar of bars1m) {
    const bucket = Math.floor(bar.time / intervalMs) * intervalMs;

    if (bucket !== bucketStart || !current) {
      if (current) result.push(current);
      bucketStart = bucket;
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

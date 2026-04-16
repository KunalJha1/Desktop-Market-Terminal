import type { OHLCVBar } from '../../types';
import { getTimeframeMs } from '../../constants';
import { atr, ema, sma } from '../shared/ictSmc';
import {
  DIQ_TABLE_OUTPUT_INDEX,
  DIQ_TABLE_OVERALL_INDEX,
  DIQ_TABLE_TIMEFRAMES,
  DIQ_TABLE_TF_METRIC_INDEX,
  diqTableTfMetricSeriesIndex,
} from './dailyIQTechnicalTable.constants';

function estimateBarMs(bars: OHLCVBar[]): number {
  if (bars.length < 2) return 60_000;
  const diffs: number[] = [];
  const start = Math.max(1, bars.length - 120);
  for (let i = start; i < bars.length; i += 1) {
    const diff = bars[i].time - bars[i - 1].time;
    if (Number.isFinite(diff) && diff > 0) diffs.push(diff);
  }
  if (diffs.length === 0) return 60_000;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] ?? 60_000;
}

function bucketForTimeframe(tsMs: number, timeframe: string): number {
  if (timeframe === '1W') {
    const mondayOffsetMs = 4 * 86_400_000;
    return Math.floor((tsMs - mondayOffsetMs) / 604_800_000) * 604_800_000 + mondayOffsetMs;
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

function resampleBarsForTimeframe(bars: OHLCVBar[], timeframe: string): OHLCVBar[] {
  if (!timeframe) return bars;
  const result: OHLCVBar[] = [];
  let current: OHLCVBar | null = null;
  let currentBucket = -1;
  let bucketHasSynthetic = false;

  for (const bar of bars) {
    const bucket = bucketForTimeframe(bar.time, timeframe);
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

function alignSeriesToChart(chartBars: OHLCVBar[], sourceBars: OHLCVBar[], sourceSeries: number[]): number[] {
  const aligned = new Array<number>(chartBars.length).fill(NaN);
  if (sourceBars.length === 0) return aligned;

  let sourceIndex = 0;
  for (let i = 0; i < chartBars.length; i += 1) {
    const t = chartBars[i].time;
    while (sourceIndex + 1 < sourceBars.length && sourceBars[sourceIndex + 1].time <= t) {
      sourceIndex += 1;
    }
    const value = sourceSeries[sourceIndex];
    aligned[i] = Number.isFinite(value) ? value : NaN;
  }

  return aligned;
}

function rollingHighest(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let highest = -Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      highest = Math.max(highest, values[j]);
    }
    result[i] = highest;
  }
  return result;
}

function rollingLowest(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      lowest = Math.min(lowest, values[j]);
    }
    result[i] = lowest;
  }
  return result;
}

function rsiValues(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  return result;
}

function emaNaNSafe(values: number[], period: number): number[] {
  const len = values.length;
  const result = new Array<number>(len).fill(NaN);
  const k = 2 / (period + 1);

  let seeded = false;
  let seedSum = 0;
  let seedCount = 0;
  let prev = NaN;

  for (let i = 0; i < len; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;

    if (!seeded) {
      seedSum += value;
      seedCount += 1;
      if (seedCount === period) {
        prev = seedSum / period;
        result[i] = prev;
        seeded = true;
      }
    } else {
      prev = (value * k) + (prev * (1 - k));
      result[i] = prev;
    }
  }

  return result;
}

function chopAngle(ema34: number, ema34Prev: number, avg: number, highestHigh: number, lowestLow: number): number {
  const rangeVal = highestHigh - lowestLow;
  const safeRange = rangeVal === 0 ? 0.000001 : rangeVal;
  const safeAvg = avg === 0 ? 0.000001 : avg;
  const span = (25 / safeRange) * lowestLow;
  const y2 = ((ema34Prev - ema34) / safeAvg) * span;
  const c = Math.sqrt(1 + (y2 * y2));
  const angle1 = Math.round((180 * Math.acos(1 / c)) / Math.PI);
  return y2 > 0 ? -angle1 : angle1;
}

interface TfMetrics {
  trend: number[];
  strength: number[];
  chop: number[];
  rsiNow: number[];
  rsiPrev: number[];
  macdNow: number[];
  macdSignal: number[];
  macdPrev: number[];
  macdSignalPrev: number[];
}

function computeTfMetrics(
  chartBars: OHLCVBar[],
  targetTimeframe: string,
  chartBarMs: number,
  fastLen: number,
  slowLen: number,
  trendLen: number,
): TfMetrics {
  const targetMs = getTimeframeMs(targetTimeframe);
  const sourceBars = targetMs > chartBarMs
    ? resampleBarsForTimeframe(chartBars, targetTimeframe)
    : chartBars;

  const closes = sourceBars.map((bar) => bar.close);
  const highs = sourceBars.map((bar) => bar.high);
  const lows = sourceBars.map((bar) => bar.low);
  const avg = sourceBars.map((bar) => (bar.high + bar.low + bar.close) / 3);

  const fast = ema(closes, fastLen);
  const slow = ema(closes, slowLen);
  const trend = ema(closes, trendLen);
  const atr14 = atr(sourceBars, 14);
  const rsi14 = rsiValues(closes, 14);
  const macdFast = ema(closes, 12);
  const macdSlow = ema(closes, 26);
  const macdLine = macdFast.map((value, i) => Number.isFinite(value) && Number.isFinite(macdSlow[i]) ? value - macdSlow[i] : NaN);
  const macdSignal = emaNaNSafe(macdLine, 9);
  const ema34 = ema(closes, 34);
  const high30 = rollingHighest(highs, 30);
  const low30 = rollingLowest(lows, 30);

  const sourceTrend = new Array<number>(sourceBars.length).fill(NaN);
  const sourceStrength = new Array<number>(sourceBars.length).fill(NaN);
  const sourceChop = new Array<number>(sourceBars.length).fill(NaN);
  const sourceRsiPrev = new Array<number>(sourceBars.length).fill(NaN);
  const sourceMacdPrev = new Array<number>(sourceBars.length).fill(NaN);
  const sourceMacdSignalPrev = new Array<number>(sourceBars.length).fill(NaN);

  for (let i = 0; i < sourceBars.length; i += 1) {
    if (Number.isFinite(closes[i]) && Number.isFinite(fast[i]) && Number.isFinite(slow[i]) && Number.isFinite(trend[i])) {
      sourceTrend[i] = closes[i] > trend[i] && fast[i] > slow[i]
        ? 1
        : closes[i] < trend[i] && fast[i] < slow[i]
          ? -1
          : 0;
    }

    if (Number.isFinite(fast[i]) && Number.isFinite(slow[i]) && Number.isFinite(atr14[i]) && atr14[i] !== 0) {
      sourceStrength[i] = Math.abs(fast[i] - slow[i]) / atr14[i];
    }

    if (i > 0) {
      sourceRsiPrev[i] = Number.isFinite(rsi14[i - 1]) ? rsi14[i - 1] : NaN;
      sourceMacdPrev[i] = Number.isFinite(macdLine[i - 1]) ? macdLine[i - 1] : NaN;
      sourceMacdSignalPrev[i] = Number.isFinite(macdSignal[i - 1]) ? macdSignal[i - 1] : NaN;
    }

    if (
      i > 0
      && Number.isFinite(ema34[i])
      && Number.isFinite(ema34[i - 1])
      && Number.isFinite(avg[i])
      && Number.isFinite(high30[i])
      && Number.isFinite(low30[i])
    ) {
      sourceChop[i] = chopAngle(ema34[i], ema34[i - 1], avg[i], high30[i], low30[i]);
    }
  }

  return {
    trend: alignSeriesToChart(chartBars, sourceBars, sourceTrend),
    strength: alignSeriesToChart(chartBars, sourceBars, sourceStrength),
    chop: alignSeriesToChart(chartBars, sourceBars, sourceChop),
    rsiNow: alignSeriesToChart(chartBars, sourceBars, rsi14),
    rsiPrev: alignSeriesToChart(chartBars, sourceBars, sourceRsiPrev),
    macdNow: alignSeriesToChart(chartBars, sourceBars, macdLine),
    macdSignal: alignSeriesToChart(chartBars, sourceBars, macdSignal),
    macdPrev: alignSeriesToChart(chartBars, sourceBars, sourceMacdPrev),
    macdSignalPrev: alignSeriesToChart(chartBars, sourceBars, sourceMacdSignalPrev),
  };
}

function seriesWithToggle(series: number[], enabled: boolean): number[] {
  return enabled ? series : series.map(() => NaN);
}

export function computeDailyIQTechnicalTable(
  bars: OHLCVBar[],
  params: Record<string, number>,
): number[][] {
  const len = bars.length;
  const totalSeries = DIQ_TABLE_OVERALL_INDEX.MACD_STATE + 1;
  const result = Array.from({ length: totalSeries }, () => new Array<number>(len).fill(NaN));
  if (len === 0) return result;

  const fastLen = Math.max(1, Math.round(params.fastLen ?? 5));
  const slowLen = Math.max(fastLen + 1, Math.round(params.slowLen ?? 20));
  const trendLen = Math.max(1, Math.round(params.trendLen ?? 50));
  const volLen = Math.max(1, Math.round(params.volLen ?? 20));
  const sweepLookback = Math.max(2, Math.round(params.sweepLookback ?? 10));
  const useVolFilter = (params.useVolFilter ?? 0) >= 0.5;
  const requireSweepEntry = (params.requireSweepEntry ?? 0) >= 0.5;
  const showTrendEma = (params.showTrendEma ?? 0) >= 0.5;
  const showEma200 = (params.showEma200 ?? 1) >= 0.5;

  const closes = bars.map((bar) => bar.close);
  const lows = bars.map((bar) => bar.low);
  const highs = bars.map((bar) => bar.high);
  const volumes = bars.map((bar) => bar.volume);

  const fast = ema(closes, fastLen);
  const slow = ema(closes, slowLen);
  const trend = ema(closes, trendLen);
  const ema200 = ema(closes, 200);
  const volMA = sma(volumes, volLen);

  const buy = new Array<number>(len).fill(NaN);
  const sell = new Array<number>(len).fill(NaN);
  const bullSweepMarkers = new Array<number>(len).fill(NaN);
  const bearSweepMarkers = new Array<number>(len).fill(NaN);

  for (let i = 1; i < len; i += 1) {
    const lookbackStart = Math.max(0, i - sweepLookback);
    let priorLow = Infinity;
    let priorHigh = -Infinity;
    for (let j = lookbackStart; j < i; j += 1) {
      priorLow = Math.min(priorLow, lows[j]);
      priorHigh = Math.max(priorHigh, highs[j]);
    }

    const bullishSweep = Number.isFinite(priorLow) && lows[i] < priorLow && closes[i] > priorLow;
    const bearishSweep = Number.isFinite(priorHigh) && highs[i] > priorHigh && closes[i] < priorHigh;

    if (bullishSweep) bullSweepMarkers[i] = lows[i];
    if (bearishSweep) bearSweepMarkers[i] = highs[i];

    const crossUp = Number.isFinite(fast[i - 1])
      && Number.isFinite(slow[i - 1])
      && Number.isFinite(fast[i])
      && Number.isFinite(slow[i])
      && fast[i - 1] <= slow[i - 1]
      && fast[i] > slow[i];

    const crossDown = Number.isFinite(fast[i - 1])
      && Number.isFinite(slow[i - 1])
      && Number.isFinite(fast[i])
      && Number.isFinite(slow[i])
      && fast[i - 1] >= slow[i - 1]
      && fast[i] < slow[i];

    const volOk = !useVolFilter || (Number.isFinite(volMA[i]) && volumes[i] > volMA[i]);

    const baseLong = crossUp && Number.isFinite(trend[i]) && closes[i] > trend[i] && volOk;
    const baseShort = crossDown && Number.isFinite(trend[i]) && closes[i] < trend[i] && volOk;

    const longSignal = requireSweepEntry ? (baseLong && bullishSweep) : baseLong;
    const shortSignal = requireSweepEntry ? (baseShort && bearishSweep) : baseShort;

    if (longSignal) buy[i] = lows[i];
    if (shortSignal) sell[i] = highs[i];
  }

  result[DIQ_TABLE_OUTPUT_INDEX.FAST_EMA] = fast;
  result[DIQ_TABLE_OUTPUT_INDEX.SLOW_EMA] = slow;
  result[DIQ_TABLE_OUTPUT_INDEX.TREND_EMA] = seriesWithToggle(trend, showTrendEma);
  result[DIQ_TABLE_OUTPUT_INDEX.EMA_200] = seriesWithToggle(ema200, showEma200);
  result[DIQ_TABLE_OUTPUT_INDEX.BUY_SIGNAL] = buy;
  result[DIQ_TABLE_OUTPUT_INDEX.SELL_SIGNAL] = sell;
  result[DIQ_TABLE_OUTPUT_INDEX.BULL_SWEEP] = bullSweepMarkers;
  result[DIQ_TABLE_OUTPUT_INDEX.BEAR_SWEEP] = bearSweepMarkers;

  const chartBarMs = estimateBarMs(bars);

  for (let tfIndex = 0; tfIndex < DIQ_TABLE_TIMEFRAMES.length; tfIndex += 1) {
    const metrics = computeTfMetrics(bars, DIQ_TABLE_TIMEFRAMES[tfIndex], chartBarMs, fastLen, slowLen, trendLen);

    result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.TREND)] = metrics.trend;
    result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.STRENGTH)] = metrics.strength;
    result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.CHOP_ANGLE)] = metrics.chop;
    result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.RSI_NOW)] = metrics.rsiNow;
    result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.RSI_PREV)] = metrics.rsiPrev;
    result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.MACD_NOW)] = metrics.macdNow;
    result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.MACD_SIGNAL)] = metrics.macdSignal;
    result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.MACD_PREV)] = metrics.macdPrev;
    result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.MACD_SIGNAL_PREV)] = metrics.macdSignalPrev;
  }

  for (let i = 0; i < len; i += 1) {
    let bullCount = 0;
    let bearCount = 0;
    let strengthSum = 0;
    let strengthCount = 0;
    let chopSum = 0;
    let chopCount = 0;
    let rsiSum = 0;
    let rsiCount = 0;
    let macdBull = 0;
    let macdBear = 0;

    for (let tfIndex = 0; tfIndex < DIQ_TABLE_TIMEFRAMES.length; tfIndex += 1) {
      const trendVal = result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.TREND)][i];
      if (trendVal === 1) bullCount += 1;
      else if (trendVal === -1) bearCount += 1;

      const strengthVal = result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.STRENGTH)][i];
      if (Number.isFinite(strengthVal)) {
        strengthSum += strengthVal;
        strengthCount += 1;
      }

      const chopVal = result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.CHOP_ANGLE)][i];
      if (Number.isFinite(chopVal)) {
        chopSum += chopVal;
        chopCount += 1;
      }

      const rsiVal = result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.RSI_NOW)][i];
      if (Number.isFinite(rsiVal)) {
        rsiSum += rsiVal;
        rsiCount += 1;
      }

      const macdNow = result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.MACD_NOW)][i];
      const macdSignal = result[diqTableTfMetricSeriesIndex(tfIndex, DIQ_TABLE_TF_METRIC_INDEX.MACD_SIGNAL)][i];
      if (Number.isFinite(macdNow) && Number.isFinite(macdSignal)) {
        if (macdNow > macdSignal) macdBull += 1;
        else if (macdNow < macdSignal) macdBear += 1;
      }
    }

    result[DIQ_TABLE_OVERALL_INDEX.TREND][i] = bullCount > bearCount ? 1 : bearCount > bullCount ? -1 : 0;
    result[DIQ_TABLE_OVERALL_INDEX.STRENGTH][i] = strengthCount > 0 ? (strengthSum / strengthCount) : NaN;
    result[DIQ_TABLE_OVERALL_INDEX.CHOP_ANGLE][i] = chopCount > 0 ? (chopSum / chopCount) : NaN;
    result[DIQ_TABLE_OVERALL_INDEX.RSI_AVG][i] = rsiCount > 0 ? (rsiSum / rsiCount) : NaN;
    result[DIQ_TABLE_OVERALL_INDEX.MACD_STATE][i] = macdBull > macdBear ? 1 : macdBear > macdBull ? -1 : 0;
  }

  return result;
}

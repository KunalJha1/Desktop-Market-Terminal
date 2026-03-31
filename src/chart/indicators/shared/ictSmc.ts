import type { OHLCVBar } from '../../types';
import { getTimeframeMs } from '../../constants';

export function sma(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  let sum = 0;

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }

  return result;
}

export function ema(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  const multiplier = 2 / (period + 1);
  let sum = 0;

  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) {
      sum += values[i];
    } else if (i === period - 1) {
      sum += values[i];
      result[i] = sum / period;
    } else {
      result[i] = values[i] * multiplier + result[i - 1] * (1 - multiplier);
    }
  }

  return result;
}

export function stdev(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);

  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += values[j];
    const mean = sum / period;

    let sq = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const diff = values[j] - mean;
      sq += diff * diff;
    }
    result[i] = Math.sqrt(sq / period);
  }

  return result;
}

export function atr(bars: OHLCVBar[], period: number): number[] {
  const tr = new Array<number>(bars.length).fill(NaN);
  const result = new Array<number>(bars.length).fill(NaN);

  for (let i = 0; i < bars.length; i += 1) {
    if (i === 0) tr[i] = bars[i].high - bars[i].low;
    else {
      tr[i] = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      );
    }
  }

  if (bars.length < period) return result;

  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += tr[i];
  result[period - 1] = seed / period;

  for (let i = period; i < bars.length; i += 1) {
    result[i] = ((result[i - 1] * (period - 1)) + tr[i]) / period;
  }

  return result;
}

function dayKey(time: number): string {
  const d = new Date(time);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function weekKey(time: number): string {
  const d = new Date(time);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = new Date(utc).getUTCDay() || 7;
  const monday = new Date(utc - ((day - 1) * 86400000));
  return `${monday.getUTCFullYear()}-${monday.getUTCMonth()}-${monday.getUTCDate()}`;
}

function monthKey(time: number): string {
  const d = new Date(time);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

interface PeriodLevels {
  currentHigh: number[];
  currentLow: number[];
  previousHigh: number[];
  previousLow: number[];
}

function computePeriodLevels(
  bars: OHLCVBar[],
  getKey: (time: number) => string,
): PeriodLevels {
  const len = bars.length;
  const currentHigh = new Array<number>(len).fill(NaN);
  const currentLow = new Array<number>(len).fill(NaN);
  const previousHigh = new Array<number>(len).fill(NaN);
  const previousLow = new Array<number>(len).fill(NaN);

  let activeKey = '';
  let periodHigh = NaN;
  let periodLow = NaN;
  let lastHigh = NaN;
  let lastLow = NaN;

  for (let i = 0; i < len; i += 1) {
    const key = getKey(bars[i].time);
    if (key !== activeKey) {
      activeKey = key;
      if (!Number.isNaN(periodHigh)) {
        lastHigh = periodHigh;
        lastLow = periodLow;
      }
      periodHigh = bars[i].high;
      periodLow = bars[i].low;
    } else {
      periodHigh = Math.max(periodHigh, bars[i].high);
      periodLow = Math.min(periodLow, bars[i].low);
    }

    currentHigh[i] = periodHigh;
    currentLow[i] = periodLow;
    previousHigh[i] = lastHigh;
    previousLow[i] = lastLow;
  }

  return { currentHigh, currentLow, previousHigh, previousLow };
}

export function computeLiquidityLevels(bars: OHLCVBar[]) {
  const day = computePeriodLevels(bars, dayKey);
  const week = computePeriodLevels(bars, weekKey);
  const month = computePeriodLevels(bars, monthKey);

  return {
    todayHigh: day.currentHigh,
    todayLow: day.currentLow,
    prevDayHigh: day.previousHigh,
    prevDayLow: day.previousLow,
    prevWeekHigh: week.previousHigh,
    prevWeekLow: week.previousLow,
    prevMonthHigh: month.previousHigh,
    prevMonthLow: month.previousLow,
  };
}

export function detectFvg(
  bars: OHLCVBar[],
  thresholdPercent: number,
  requireNextBarReaction: boolean = true,
  sourceTimeframe: string = '',
): {
  bullTop: number[];
  bullBottom: number[];
  bearTop: number[];
  bearBottom: number[];
  bullPullback: number[];
  bullReject: number[];
  bearPullback: number[];
  bearReject: number[];
} {
  const simulation = simulateFvgOnChart(bars, thresholdPercent, 80, requireNextBarReaction, sourceTimeframe);
  const len = bars.length;
  return {
    bullTop: simulation.bullTop.slice(0, len),
    bullBottom: simulation.bullBottom.slice(0, len),
    bearTop: simulation.bearTop.slice(0, len),
    bearBottom: simulation.bearBottom.slice(0, len),
    bullPullback: simulation.bullPullback.slice(0, len),
    bullReject: simulation.bullReject.slice(0, len),
    bearPullback: simulation.bearPullback.slice(0, len),
    bearReject: simulation.bearReject.slice(0, len),
  };
}

export interface ActiveFvgZone {
  leftIndex: number;
  rightIndex: number;
  leftTime: number;
  rightTime: number;
  top: number;
  bottom: number;
  isBull: boolean;
}

interface FvgZoneState {
  top: number;
  bottom: number;
  isBull: boolean;
  createdIndex: number;
  createdTime: number;
  rightTime: number;
  touched: boolean;
  touchIndex: number;
}

interface SourceFvgEvent {
  top: number;
  bottom: number;
  isBull: boolean;
  createdTime: number;
  sourceIndex: number;
}

function normalizeFvgTimeframe(sourceTimeframe: string, bars: OHLCVBar[]): string {
  const trimmed = sourceTimeframe.trim();
  if (!trimmed || bars.length < 2) return '';
  const estimatedChartMs = estimateBarMs(bars, bars.length - 1);
  const requestedMs = getTimeframeMs(trimmed);
  return requestedMs <= estimatedChartMs ? '' : trimmed;
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

function buildSourceFvgEvents(bars: OHLCVBar[], thresholdPercent: number): SourceFvgEvent[] {
  const threshold = thresholdPercent / 100;
  const events: SourceFvgEvent[] = [];

  for (let i = 2; i < bars.length; i += 1) {
    const bullGap = bars[i].low > bars[i - 2].high
      && bars[i - 1].close > bars[i - 2].high
      && ((bars[i].low - bars[i - 2].high) / bars[i - 2].high) > threshold;

    const bearGap = bars[i].high < bars[i - 2].low
      && bars[i - 1].close < bars[i - 2].low
      && ((bars[i - 2].low - bars[i].high) / bars[i].high) > threshold;

    if (bullGap) {
      events.push({
        top: Math.max(bars[i].low, bars[i - 2].high),
        bottom: Math.min(bars[i].low, bars[i - 2].high),
        isBull: true,
        createdTime: bars[i].time,
        sourceIndex: i,
      });
    }
    if (bearGap) {
      events.push({
        top: Math.max(bars[i - 2].low, bars[i].high),
        bottom: Math.min(bars[i - 2].low, bars[i].high),
        isBull: false,
        createdTime: bars[i].time,
        sourceIndex: i,
      });
    }
  }

  return events;
}

function estimateBarMs(bars: OHLCVBar[], index: number): number {
  const prev = index > 0 ? bars[index].time - bars[index - 1].time : NaN;
  if (Number.isFinite(prev) && prev > 0) return prev;
  const next = index + 1 < bars.length ? bars[index + 1].time - bars[index].time : NaN;
  if (Number.isFinite(next) && next > 0) return next;
  return 60_000;
}

function findSourceIndexForTime(sourceBars: OHLCVBar[], time: number): number {
  let lo = 0;
  let hi = sourceBars.length - 1;
  let answer = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sourceBars[mid].time <= time) {
      answer = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return answer;
}

function isLastChartBarForSourceIndex(chartBars: OHLCVBar[], sourceBars: OHLCVBar[], chartIndex: number, sourceIndex: number): boolean {
  const nextSourceTime = sourceIndex + 1 < sourceBars.length ? sourceBars[sourceIndex + 1].time : Infinity;
  const nextChartTime = chartIndex + 1 < chartBars.length ? chartBars[chartIndex + 1].time : Infinity;
  return nextChartTime >= nextSourceTime;
}

function simulateFvgOnChart(
  chartBars: OHLCVBar[],
  thresholdPercent: number,
  extendBars: number,
  requireNextBarReaction: boolean,
  sourceTimeframe: string = '',
): {
  bullTop: number[];
  bullBottom: number[];
  bearTop: number[];
  bearBottom: number[];
  bullPullback: number[];
  bullReject: number[];
  bearPullback: number[];
  bearReject: number[];
  activeZones: ActiveFvgZone[];
} {
  const len = chartBars.length;
  const bullTop = new Array<number>(len).fill(NaN);
  const bullBottom = new Array<number>(len).fill(NaN);
  const bearTop = new Array<number>(len).fill(NaN);
  const bearBottom = new Array<number>(len).fill(NaN);
  const bullPullback = new Array<number>(len).fill(NaN);
  const bullReject = new Array<number>(len).fill(NaN);
  const bearPullback = new Array<number>(len).fill(NaN);
  const bearReject = new Array<number>(len).fill(NaN);

  if (len === 0) {
    return { bullTop, bullBottom, bearTop, bearBottom, bullPullback, bullReject, bearPullback, bearReject, activeZones: [] };
  }

  const normalizedTf = normalizeFvgTimeframe(sourceTimeframe, chartBars);
  const sourceBars = normalizedTf ? resampleBarsForTimeframe(chartBars, normalizedTf) : chartBars;
  const sourceEvents = buildSourceFvgEvents(sourceBars, thresholdPercent);
  const eventsBySourceIndex = new Map<number, SourceFvgEvent[]>();
  for (const event of sourceEvents) {
    const bucket = eventsBySourceIndex.get(event.sourceIndex);
    if (bucket) bucket.push(event);
    else eventsBySourceIndex.set(event.sourceIndex, [event]);
  }

  const closes = chartBars.map((bar) => bar.close);
  const ema20 = ema(closes, 20);
  const ema200 = ema(closes, 200);
  const zones: FvgZoneState[] = [];

  for (let i = 0; i < len; i += 1) {
    const sourceIndex = findSourceIndexForTime(sourceBars, chartBars[i].time);
    if (sourceIndex >= 0 && isLastChartBarForSourceIndex(chartBars, sourceBars, i, sourceIndex)) {
      for (const event of eventsBySourceIndex.get(sourceIndex) ?? []) {
        // Block new FVG if an unfilled zone of the same direction already exists from the same day
        const eventDay = Math.floor(event.createdTime / 86_400_000);
        const unfilledSameDayExists = zones.some(
          (z) => z.isBull === event.isBull && Math.floor(z.createdTime / 86_400_000) === eventDay,
        );
        if (unfilledSameDayExists) continue;

        // Remove stale zones of the same direction (from a prior day)
        for (let zi = zones.length - 1; zi >= 0; zi -= 1) {
          if (zones[zi].isBull === event.isBull) {
            zones.splice(zi, 1);
          }
        }
        zones.push({
          top: event.top,
          bottom: event.bottom,
          isBull: event.isBull,
          createdIndex: i,
          createdTime: event.createdTime,
          rightTime: chartBars[i].time + (estimateBarMs(chartBars, i) * extendBars),
          touched: false,
          touchIndex: -1,
        });
      }
    }

    const bullMomentum = !Number.isNaN(ema20[i]) && !Number.isNaN(ema200[i]) && ema20[i] > ema200[i] && chartBars[i].close > ema20[i];
    const bearMomentum = !Number.isNaN(ema20[i]) && !Number.isNaN(ema200[i]) && ema20[i] < ema200[i] && chartBars[i].close < ema20[i];

    for (const zone of zones) {
      const inZone = chartBars[i].high >= zone.bottom && chartBars[i].low <= zone.top;
      const closeInZone = chartBars[i].close <= zone.top && chartBars[i].close >= zone.bottom;

      if (zone.isBull && bullMomentum) {
        if ((inZone || closeInZone) && (chartBars[i].close > chartBars[i].open || (i > 0 && chartBars[i].close > chartBars[i - 1].close))) {
          bullPullback[i] = chartBars[i].low;
        }
        if (inZone && chartBars[i].close > zone.top) {
          bullReject[i] = chartBars[i].low;
        }
      }

      if (!zone.isBull && bearMomentum) {
        if ((inZone || closeInZone) && (chartBars[i].close < chartBars[i].open || (i > 0 && chartBars[i].close < chartBars[i - 1].close))) {
          bearPullback[i] = chartBars[i].high;
        }
        if (inZone && chartBars[i].close < zone.bottom) {
          bearReject[i] = chartBars[i].high;
        }
      }
    }

    for (let zi = zones.length - 1; zi >= 0; zi -= 1) {
      const zone = zones[zi];
      const touchedNow = chartBars[i].low <= zone.top && chartBars[i].high >= zone.bottom && chartBars[i].time > zone.createdTime;
      if (touchedNow && !zone.touched) {
        zone.touched = true;
        zone.touchIndex = i;
      }

      const afterTouchOk = zone.touched && (!requireNextBarReaction || i > zone.touchIndex);
      const bullUsed = zone.isBull && afterTouchOk && chartBars[i].close > zone.top;
      const bearUsed = !zone.isBull && afterTouchOk && chartBars[i].close < zone.bottom;
      if (bullUsed || bearUsed) {
        zones.splice(zi, 1);
      }
    }

    let latestBull: FvgZoneState | undefined;
    let latestBear: FvgZoneState | undefined;
    for (const zone of zones) {
      if (zone.isBull) {
        if (!latestBull || zone.createdTime >= latestBull.createdTime) latestBull = zone;
      } else if (!latestBear || zone.createdTime >= latestBear.createdTime) {
        latestBear = zone;
      }
    }

    bullTop[i] = latestBull?.top ?? NaN;
    bullBottom[i] = latestBull?.bottom ?? NaN;
    bearTop[i] = latestBear?.top ?? NaN;
    bearBottom[i] = latestBear?.bottom ?? NaN;
  }

  return {
    bullTop,
    bullBottom,
    bearTop,
    bearBottom,
    bullPullback,
    bullReject,
    bearPullback,
    bearReject,
    activeZones: zones.map((zone) => ({
      leftIndex: zone.createdIndex,
      rightIndex: Math.min(len - 1, zone.createdIndex + extendBars),
      leftTime: zone.createdTime,
      rightTime: zone.rightTime,
      top: zone.top,
      bottom: zone.bottom,
      isBull: zone.isBull,
    })),
  };
}

export function detectActiveFvgZones(
  bars: OHLCVBar[],
  thresholdPercent: number,
  extendBars: number = 80,
  requireNextBarReaction: boolean = true,
  sourceTimeframe: string = '',
): ActiveFvgZone[] {
  return simulateFvgOnChart(bars, thresholdPercent, extendBars, requireNextBarReaction, sourceTimeframe).activeZones;
}

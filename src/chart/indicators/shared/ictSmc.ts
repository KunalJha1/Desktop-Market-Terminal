import type { OHLCVBar } from '../../types';

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
  const len = bars.length;
  const bullTop = new Array<number>(len).fill(NaN);
  const bullBottom = new Array<number>(len).fill(NaN);
  const bearTop = new Array<number>(len).fill(NaN);
  const bearBottom = new Array<number>(len).fill(NaN);
  const bullPullback = new Array<number>(len).fill(NaN);
  const bullReject = new Array<number>(len).fill(NaN);
  const bearPullback = new Array<number>(len).fill(NaN);
  const bearReject = new Array<number>(len).fill(NaN);

  let lastBullTop = NaN;
  let lastBullBottom = NaN;
  let lastBearTop = NaN;
  let lastBearBottom = NaN;
  let lastBullSize = NaN;
  let lastBearSize = NaN;
  const threshold = thresholdPercent / 100;
  const closes = bars.map((bar) => bar.close);
  const ema20 = ema(closes, 20);
  const ema200 = ema(closes, 200);

  for (let i = 2; i < len; i += 1) {
    const bullGap = bars[i].low > bars[i - 2].high
      && bars[i - 1].close > bars[i - 2].high
      && ((bars[i].low - bars[i - 2].high) / bars[i - 2].high) > threshold;

    const bearGap = bars[i].high < bars[i - 2].low
      && bars[i - 1].close < bars[i - 2].low
      && ((bars[i - 2].low - bars[i].high) / bars[i].high) > threshold;

    if (bullGap) {
      const nextBullTop = Math.max(bars[i].low, bars[i - 2].high);
      const nextBullBottom = Math.min(bars[i].low, bars[i - 2].high);
      const nextBullSize = nextBullTop - nextBullBottom;
      if (Number.isNaN(lastBullTop) || Number.isNaN(lastBullBottom) || nextBullSize >= lastBullSize) {
        lastBullTop = nextBullTop;
        lastBullBottom = nextBullBottom;
        lastBullSize = nextBullSize;
      }
    }
    if (bearGap) {
      const nextBearTop = Math.max(bars[i - 2].low, bars[i].high);
      const nextBearBottom = Math.min(bars[i - 2].low, bars[i].high);
      const nextBearSize = nextBearTop - nextBearBottom;
      if (Number.isNaN(lastBearTop) || Number.isNaN(lastBearBottom) || nextBearSize >= lastBearSize) {
        lastBearTop = nextBearTop;
        lastBearBottom = nextBearBottom;
        lastBearSize = nextBearSize;
      }
    }

    if (!Number.isNaN(lastBullBottom) && bars[i].low <= lastBullBottom) {
      lastBullTop = NaN;
      lastBullBottom = NaN;
      lastBullSize = NaN;
    }

    if (!Number.isNaN(lastBearTop) && bars[i].high >= lastBearTop) {
      lastBearTop = NaN;
      lastBearBottom = NaN;
      lastBearSize = NaN;
    }

    bullTop[i] = lastBullTop;
    bullBottom[i] = lastBullBottom;
    bearTop[i] = lastBearTop;
    bearBottom[i] = lastBearBottom;

    const bullMomentum = !Number.isNaN(ema20[i]) && !Number.isNaN(ema200[i]) && ema20[i] > ema200[i] && bars[i].close > ema20[i];
    const bearMomentum = !Number.isNaN(ema20[i]) && !Number.isNaN(ema200[i]) && ema20[i] < ema200[i] && bars[i].close < ema20[i];

    if (!Number.isNaN(lastBullTop) && !Number.isNaN(lastBullBottom) && bullMomentum) {
      const inZone = bars[i].high >= lastBullBottom && bars[i].low <= lastBullTop;
      if (inZone && (bars[i].close > bars[i].open || bars[i].close > bars[i - 1].close)) {
        bullPullback[i] = bars[i].low;
      }
      if (inZone && bars[i].close > lastBullTop) {
        bullReject[i] = bars[i].low;
      }
    }

    if (!Number.isNaN(lastBearTop) && !Number.isNaN(lastBearBottom) && bearMomentum) {
      const inZone = bars[i].high >= lastBearBottom && bars[i].low <= lastBearTop;
      if (inZone && (bars[i].close < bars[i].open || bars[i].close < bars[i - 1].close)) {
        bearPullback[i] = bars[i].high;
      }
      if (inZone && bars[i].close < lastBearBottom) {
        bearReject[i] = bars[i].high;
      }
    }
  }

  return { bullTop, bullBottom, bearTop, bearBottom, bullPullback, bullReject, bearPullback, bearReject };
}

export interface ActiveFvgZone {
  leftIndex: number;
  rightIndex: number;
  top: number;
  bottom: number;
  isBull: boolean;
}

export function detectActiveFvgZones(
  bars: OHLCVBar[],
  thresholdPercent: number,
  extendBars: number = 80,
  requireNextBarReaction: boolean = true,
): ActiveFvgZone[] {
  const zones: Array<{
    top: number;
    bottom: number;
    isBull: boolean;
    createdIndex: number;
    touched: boolean;
    touchIndex: number;
  }> = [];
  const threshold = thresholdPercent / 100;

  for (let i = 2; i < bars.length; i += 1) {
    const bullGap = bars[i].low > bars[i - 2].high
      && bars[i - 1].close > bars[i - 2].high
      && ((bars[i].low - bars[i - 2].high) / bars[i - 2].high) > threshold;

    const bearGap = bars[i].high < bars[i - 2].low
      && bars[i - 1].close < bars[i - 2].low
      && ((bars[i - 2].low - bars[i].high) / bars[i].high) > threshold;

    if (bullGap) {
      zones.push({
        top: Math.max(bars[i].low, bars[i - 2].high),
        bottom: Math.min(bars[i].low, bars[i - 2].high),
        isBull: true,
        createdIndex: i,
        touched: false,
        touchIndex: -1,
      });
    }

    if (bearGap) {
      zones.push({
        top: Math.max(bars[i - 2].low, bars[i].high),
        bottom: Math.min(bars[i - 2].low, bars[i].high),
        isBull: false,
        createdIndex: i,
        touched: false,
        touchIndex: -1,
      });
    }
  }

  const active = [...zones];
  for (let i = 0; i < bars.length; i += 1) {
    for (let zi = active.length - 1; zi >= 0; zi -= 1) {
      const zone = active[zi];
      if (i <= zone.createdIndex) continue;

      const touchedNow = bars[i].low <= zone.top && bars[i].high >= zone.bottom;
      if (touchedNow && !zone.touched) {
        zone.touched = true;
        zone.touchIndex = i;
      }

      const afterTouchOk = zone.touched && (!requireNextBarReaction || i > zone.touchIndex);
      const bullUsed = zone.isBull && afterTouchOk && bars[i].close > zone.top;
      const bearUsed = !zone.isBull && afterTouchOk && bars[i].close < zone.bottom;

      if (bullUsed || bearUsed) {
        active.splice(zi, 1);
      }
    }
  }

  return active.map((zone) => ({
    leftIndex: zone.createdIndex,
    rightIndex: Math.min(bars.length - 1, zone.createdIndex + extendBars),
    top: zone.top,
    bottom: zone.bottom,
    isBull: zone.isBull,
  }));
}

import type { OHLCVBar } from '../../types';

type AverageKind = 'EMA' | 'SMA';

function sma(data: number[], period: number): number[] {
  const len = data.length;
  const result = new Array<number>(len).fill(NaN);
  let sum = 0;

  for (let i = 0; i < len; i += 1) {
    sum += data[i];
    if (i < period - 1) continue;
    if (i >= period) sum -= data[i - period];
    result[i] = sum / period;
  }

  return result;
}

function ema(data: number[], period: number): number[] {
  const len = data.length;
  const result = new Array<number>(len).fill(NaN);
  const k = 2 / (period + 1);
  let sum = 0;

  for (let i = 0; i < len; i += 1) {
    if (i < period - 1) {
      sum += data[i];
    } else if (i === period - 1) {
      sum += data[i];
      result[i] = sum / period;
    } else {
      result[i] = data[i] * k + result[i - 1] * (1 - k);
    }
  }

  return result;
}

function normalizePeriods(params: Record<string, number>, fastDefault: number, slowDefault: number) {
  const fastPeriod = Math.max(1, Math.round(params.fastPeriod ?? fastDefault));
  const slowPeriod = Math.max(fastPeriod + 1, Math.round(params.slowPeriod ?? slowDefault));
  return { fastPeriod, slowPeriod };
}

function computeCrossoverSeries(
  bars: OHLCVBar[],
  averageKind: AverageKind,
  fastPeriod: number,
  slowPeriod: number,
): number[][] {
  const closes = bars.map((bar) => bar.close);
  const average = averageKind === 'EMA' ? ema : sma;
  const fast = average(closes, fastPeriod);
  const slow = average(closes, slowPeriod);
  const buySignals = new Array<number>(bars.length).fill(NaN);
  const sellSignals = new Array<number>(bars.length).fill(NaN);

  for (let i = 1; i < bars.length; i += 1) {
    const prevFast = fast[i - 1];
    const prevSlow = slow[i - 1];
    const currFast = fast[i];
    const currSlow = slow[i];
    if ([prevFast, prevSlow, currFast, currSlow].some((value) => Number.isNaN(value))) continue;

    if (prevFast <= prevSlow && currFast > currSlow) {
      buySignals[i] = bars[i].low;
    } else if (prevFast >= prevSlow && currFast < currSlow) {
      sellSignals[i] = bars[i].high;
    }
  }

  return [fast, slow, buySignals, sellSignals];
}

export function computeGoldenDeathCross(
  bars: OHLCVBar[],
  params: Record<string, number>,
): number[][] {
  const { fastPeriod, slowPeriod } = normalizePeriods(params, 50, 200);
  return computeCrossoverSeries(bars, 'SMA', fastPeriod, slowPeriod);
}

export function computeEMACrossover(
  bars: OHLCVBar[],
  params: Record<string, number>,
): number[][] {
  const { fastPeriod, slowPeriod } = normalizePeriods(params, 9, 14);
  return computeCrossoverSeries(bars, 'EMA', fastPeriod, slowPeriod);
}

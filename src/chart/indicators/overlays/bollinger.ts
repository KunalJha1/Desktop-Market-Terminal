import type { OHLCVBar } from '../../types';

export function computeBollinger(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 20;
  const mult = params.stdDev ?? 2;
  const len = bars.length;
  const middle = new Array<number>(len);
  const upper = new Array<number>(len);
  const lower = new Array<number>(len);

  for (let i = 0; i < len; i++) {
    if (i < period - 1) {
      middle[i] = NaN;
      upper[i] = NaN;
      lower[i] = NaN;
      continue;
    }

    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += bars[j].close;
    }
    const mean = sum / period;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = bars[j].close - mean;
      sqSum += diff * diff;
    }
    const sd = Math.sqrt(sqSum / period);

    middle[i] = mean;
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }

  return [middle, upper, lower];
}

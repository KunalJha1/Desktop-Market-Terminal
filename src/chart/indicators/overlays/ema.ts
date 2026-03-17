import type { OHLCVBar } from '../../types';

export function computeEMA(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 20;
  const len = bars.length;
  const result = new Array<number>(len);
  const k = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < len; i++) {
    if (i < period - 1) {
      sum += bars[i].close;
      result[i] = NaN;
    } else if (i === period - 1) {
      sum += bars[i].close;
      result[i] = sum / period;
    } else {
      result[i] = bars[i].close * k + result[i - 1] * (1 - k);
    }
  }

  return [result];
}

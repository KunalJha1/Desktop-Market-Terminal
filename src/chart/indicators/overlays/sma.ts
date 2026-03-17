import type { OHLCVBar } from '../../types';

export function computeSMA(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 20;
  const len = bars.length;
  const result = new Array<number>(len);

  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += bars[i].close;
    if (i < period - 1) {
      result[i] = NaN;
    } else {
      if (i >= period) {
        sum -= bars[i - period].close;
      }
      result[i] = sum / period;
    }
  }

  return [result];
}

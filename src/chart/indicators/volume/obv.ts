import type { OHLCVBar } from '../../types';

export function computeOBV(bars: OHLCVBar[], _params: Record<string, number>): number[][] {
  const len = bars.length;
  const result = new Array<number>(len);

  if (len === 0) return [result];

  result[0] = bars[0].volume;

  for (let i = 1; i < len; i++) {
    if (bars[i].close > bars[i - 1].close) {
      result[i] = result[i - 1] + bars[i].volume;
    } else if (bars[i].close < bars[i - 1].close) {
      result[i] = result[i - 1] - bars[i].volume;
    } else {
      result[i] = result[i - 1];
    }
  }

  return [result];
}

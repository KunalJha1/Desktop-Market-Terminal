import type { OHLCVBar } from '../../types';

export function computeWilliamsR(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 14;
  const len = bars.length;
  const result = new Array<number>(len).fill(NaN);

  for (let i = period - 1; i < len; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > highest) highest = bars[j].high;
      if (bars[j].low < lowest) lowest = bars[j].low;
    }
    const range = highest - lowest;
    result[i] = range > 0 ? ((highest - bars[i].close) / range) * -100 : 0;
  }

  return [result];
}

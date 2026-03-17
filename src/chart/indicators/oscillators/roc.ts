import type { OHLCVBar } from '../../types';

export function computeROC(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 12;
  const len = bars.length;
  const result = new Array<number>(len).fill(NaN);

  for (let i = period; i < len; i++) {
    const prev = bars[i - period].close;
    result[i] = prev !== 0 ? ((bars[i].close - prev) / prev) * 100 : 0;
  }

  return [result];
}

import type { OHLCVBar } from '../../types';

export function computeATR(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 14;
  const len = bars.length;
  const result = new Array<number>(len).fill(NaN);

  if (len < 2) return [result];

  // True Range array
  const tr = new Array<number>(len);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < len; i++) {
    const hl = bars[i].high - bars[i].low;
    const hc = Math.abs(bars[i].high - bars[i - 1].close);
    const lc = Math.abs(bars[i].low - bars[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }

  // First ATR: simple average of first `period` true ranges
  if (len < period) return [result];

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i];
  }
  result[period - 1] = sum / period;

  // Subsequent: Wilder's smoothing
  for (let i = period; i < len; i++) {
    result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
  }

  return [result];
}

import type { OHLCVBar } from '../../types';

export function computeMFI(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 14;
  const len = bars.length;
  const result = new Array<number>(len).fill(NaN);

  if (len < period + 1) return [result];

  // Typical price and raw money flow
  const tp = bars.map(b => (b.high + b.low + b.close) / 3);

  for (let i = period; i < len; i++) {
    let posFlow = 0;
    let negFlow = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * bars[j].volume;
      if (tp[j] > tp[j - 1]) {
        posFlow += flow;
      } else if (tp[j] < tp[j - 1]) {
        negFlow += flow;
      }
    }

    if (negFlow === 0) {
      result[i] = 100;
    } else {
      const mfr = posFlow / negFlow;
      result[i] = 100 - 100 / (1 + mfr);
    }
  }

  return [result];
}

import type { OHLCVBar } from '../../types';

export function computeEnvelope(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 20;
  const pct = (params.percent ?? 2.5) / 100;
  const len = bars.length;
  const middle = new Array<number>(len);
  const upper = new Array<number>(len);
  const lower = new Array<number>(len);

  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += bars[i].close;
    if (i < period - 1) {
      middle[i] = NaN;
      upper[i] = NaN;
      lower[i] = NaN;
    } else {
      if (i >= period) {
        sum -= bars[i - period].close;
      }
      const avg = sum / period;
      middle[i] = avg;
      upper[i] = avg * (1 + pct);
      lower[i] = avg * (1 - pct);
    }
  }

  return [middle, upper, lower];
}

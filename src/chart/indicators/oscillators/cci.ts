import type { OHLCVBar } from '../../types';

export function computeCCI(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 20;
  const len = bars.length;
  const result = new Array<number>(len).fill(NaN);

  const tp = bars.map(b => (b.high + b.low + b.close) / 3);

  for (let i = period - 1; i < len; i++) {
    // SMA of typical price
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += tp[j];
    }
    const mean = sum / period;

    // Mean deviation
    let devSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      devSum += Math.abs(tp[j] - mean);
    }
    const meanDev = devSum / period;

    result[i] = meanDev !== 0 ? (tp[i] - mean) / (0.015 * meanDev) : 0;
  }

  return [result];
}

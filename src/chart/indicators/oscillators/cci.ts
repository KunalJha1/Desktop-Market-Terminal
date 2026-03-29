import type { OHLCVBar } from '../../types';
import { sma, ema } from '../compute';

function rma(data: number[], period: number): number[] {
  const len = data.length;
  const result = new Array<number>(len).fill(NaN);
  let prev = NaN;

  for (let i = 0; i < len; i++) {
    if (isNaN(data[i])) continue;
    if (isNaN(prev)) {
      let sum = 0;
      let count = 0;
      for (let j = 0; j <= i && count < period; j++) {
        if (!isNaN(data[j])) {
          sum += data[j];
          count++;
        }
      }
      if (count === period) {
        prev = sum / period;
        result[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + data[i]) / period;
      result[i] = prev;
    }
  }

  return result;
}

export function computeCCI(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = Math.max(1, Math.round(params.period ?? 20));
  const maPeriod = Math.max(1, Math.round(params.maPeriod ?? 14));
  const maType = Math.round(params.maType ?? 1);
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

  let maResult = new Array<number>(len).fill(NaN);
  if (maType === 2) maResult = ema(result, maPeriod);
  else if (maType === 3) maResult = rma(result, maPeriod);
  else maResult = sma(result, maPeriod);

  return [result, maResult];
}

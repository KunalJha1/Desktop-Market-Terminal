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
        if (!isNaN(data[j])) { sum += data[j]; count++; }
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

export function computeRSI(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = Math.max(1, Math.round(params.period ?? 14));
  const maPeriod = Math.max(1, Math.round(params.maPeriod ?? 14));
  const maType = Math.round(params.maType ?? 1);
  const len = bars.length;
  const result = new Array<number>(len).fill(NaN);

  if (len < period + 1) return [result, new Array<number>(len).fill(NaN)];

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) {
    result[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    result[period] = 100 - 100 / (1 + rs);
  }

  for (let i = period + 1; i < len; i++) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  let maResult = new Array<number>(len).fill(NaN);
  if (maType === 2) maResult = ema(result, maPeriod);
  else if (maType === 3) maResult = rma(result, maPeriod);
  else maResult = sma(result, maPeriod);

  return [result, maResult];
}

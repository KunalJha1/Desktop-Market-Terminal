import type { OHLCVBar } from '../../types';

export function computeRSI(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const period = params.period ?? 14;
  const len = bars.length;
  const result = new Array<number>(len).fill(NaN);

  if (len < period + 1) return [result];

  let avgGain = 0;
  let avgLoss = 0;

  // First period: simple average of gains and losses
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

  // Subsequent periods: smoothed (Wilder's) moving average
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

  return [result];
}

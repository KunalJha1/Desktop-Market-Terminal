import type { OHLCVBar } from '../../types';
import { ema } from '../shared/ictSmc';

export function computeEMA520Strategy(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const closes = bars.map((bar) => bar.close);
  const fastPeriod = Math.max(1, Math.round(params.fastPeriod ?? 5));
  const slowPeriod = Math.max(fastPeriod + 1, Math.round(params.slowPeriod ?? 20));
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const buy = new Array<number>(bars.length).fill(NaN);
  const sell = new Array<number>(bars.length).fill(NaN);

  for (let i = 1; i < bars.length; i += 1) {
    if ([fast[i - 1], slow[i - 1], fast[i], slow[i]].some((value) => Number.isNaN(value))) continue;
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) buy[i] = bars[i].low;
    if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) sell[i] = bars[i].high;
  }

  return [fast, slow, buy, sell];
}

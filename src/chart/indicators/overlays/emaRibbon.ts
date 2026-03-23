import type { OHLCVBar } from '../../types';
import { ema } from '../shared/ictSmc';

export function computeEMARibbon(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const closes = bars.map((bar) => bar.close);
  const fast = ema(closes, Math.max(1, Math.round(params.fastPeriod ?? 5)));
  const mid = ema(closes, Math.max(1, Math.round(params.midPeriod ?? 20)));
  const slow = ema(closes, Math.max(1, Math.round(params.slowPeriod ?? 200)));
  return [fast, mid, slow];
}

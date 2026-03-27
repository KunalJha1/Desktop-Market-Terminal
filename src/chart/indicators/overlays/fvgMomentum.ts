import type { OHLCVBar } from '../../types';
import { detectFvg } from '../shared/ictSmc';

export function computeFVGMomentum(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const thresholdPercent = Math.max(0, params.thresholdPercent ?? 0);
  const requireNextBarReaction = (params.requireNextBarReaction ?? 1) !== 0;
  const sourceTimeframe = typeof (params as unknown as Record<string, unknown>).sourceTimeframe === 'string'
    ? String((params as unknown as Record<string, unknown>).sourceTimeframe ?? '').trim()
    : '';
  const result = detectFvg(bars, thresholdPercent, requireNextBarReaction, sourceTimeframe);
  const bull = new Array<number>(bars.length).fill(NaN);
  const bear = new Array<number>(bars.length).fill(NaN);

  for (let i = 0; i < bars.length; i += 1) {
    if (!Number.isNaN(result.bullPullback[i]) || !Number.isNaN(result.bullReject[i])) bull[i] = bars[i].low;
    if (!Number.isNaN(result.bearPullback[i]) || !Number.isNaN(result.bearReject[i])) bear[i] = bars[i].high;
  }

  return [bull, bear];
}

import type { OHLCVBar } from '../../types';
import { computeMarketSentimentComponents } from '../shared/marketSentiment';

export function computeBullBearPower(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const result = computeMarketSentimentComponents(bars, {
    bbpLength: params.period ?? 13,
  });

  return [result.bullBearPower];
}

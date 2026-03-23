import type { OHLCVBar } from '../../types';
import { computeMarketSentimentComponents } from '../shared/marketSentiment';

export function computeSupertrendSentiment(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const result = computeMarketSentimentComponents(bars, {
    supertrendAtrLength: params.atrPeriod ?? 10,
    supertrendFactor: params.factor ?? 3,
    trendSmooth: params.smooth ?? 3,
  });

  return [result.supertrend];
}

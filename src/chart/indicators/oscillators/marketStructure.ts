import type { OHLCVBar } from '../../types';
import { computeMarketSentimentComponents } from '../shared/marketSentiment';

export function computeMarketStructureSentiment(
  bars: OHLCVBar[],
  params: Record<string, number>,
): number[][] {
  const result = computeMarketSentimentComponents(bars, {
    marketStructureLength: params.period ?? 5,
    trendSmooth: params.smooth ?? 3,
  });

  return [result.marketStructure];
}

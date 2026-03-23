import type { OHLCVBar } from '../../types';
import { computeMarketSentimentComponents } from '../shared/marketSentiment';

export function computeStochasticRsi(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const result = computeMarketSentimentComponents(bars, {
    stochRsiLength: params.stochLength ?? 14,
    stochRsiSmooth: params.smooth ?? 3,
    stochRsiRsiLength: params.rsiPeriod ?? 14,
  });

  return [result.stochasticRsi];
}

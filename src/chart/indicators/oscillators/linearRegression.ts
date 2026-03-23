import type { OHLCVBar } from '../../types';
import { computeMarketSentimentComponents } from '../shared/marketSentiment';

export function computeLinearRegressionSentiment(
  bars: OHLCVBar[],
  params: Record<string, number>,
): number[][] {
  const result = computeMarketSentimentComponents(bars, {
    regressionLength: params.period ?? 25,
  });

  return [result.linearRegression];
}

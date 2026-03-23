import type { OHLCVBar } from '../../types';
import { computeMarketSentimentComponents } from '../shared/marketSentiment';

export function computeMarketSentiment(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const result = computeMarketSentimentComponents(bars, {
    rsiLength: params.rsiLength ?? 14,
    stochLength: params.stochLength ?? 14,
    stochSmooth: params.stochSmooth ?? 3,
    stochRsiLength: params.stochRsiLength ?? 14,
    stochRsiSmooth: params.stochRsiSmooth ?? 3,
    stochRsiRsiLength: params.stochRsiRsiLength ?? 14,
    cciLength: params.cciLength ?? 20,
    bbpLength: params.bbpLength ?? 13,
    maLength: params.maLength ?? 20,
    bbLength: params.bbLength ?? 20,
    bbStdDev: params.bbStdDev ?? 2,
    supertrendAtrLength: params.supertrendAtrLength ?? 10,
    supertrendFactor: params.supertrendFactor ?? 3,
    regressionLength: params.regressionLength ?? 25,
    marketStructureLength: params.marketStructureLength ?? 5,
    trendSmooth: params.trendSmooth ?? 3,
  });

  const buySignals = new Array<number>(bars.length).fill(NaN);
  const sellSignals = new Array<number>(bars.length).fill(NaN);

  for (let i = 1; i < bars.length; i += 1) {
    const prev = result.sentiment[i - 1];
    const curr = result.sentiment[i];
    if (prev <= 50 && curr > 50) buySignals[i] = 45;
    if (prev >= 50 && curr < 50) sellSignals[i] = 55;
  }

  return [result.sentiment, buySignals, sellSignals];
}

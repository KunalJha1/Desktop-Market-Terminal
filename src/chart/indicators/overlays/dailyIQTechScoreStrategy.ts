import type { OHLCVBar } from '../../types';
import { computeTechnicalScore } from '../oscillators/technicalScore';

export function computeDailyIQTechScoreStrategy(
  bars: OHLCVBar[],
  _params: Record<string, number>,
): number[][] {
  const [score] = computeTechnicalScore(bars, {});
  const buySignals = new Array<number>(bars.length).fill(NaN);
  const sellSignals = new Array<number>(bars.length).fill(NaN);

  for (let i = 1; i < bars.length; i += 1) {
    const prev = score[i - 1];
    const curr = score[i];
    if (Number.isNaN(prev) || Number.isNaN(curr)) continue;

    if (prev <= 50 && curr > 50) {
      buySignals[i] = bars[i].low;
    } else if (prev >= 50 && curr < 50) {
      sellSignals[i] = bars[i].high;
    }
  }

  return [buySignals, sellSignals];
}

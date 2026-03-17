import type { OHLCVBar } from '../../types';

/**
 * Volume Profile: distributes volume into price-level bins.
 * Returns two arrays:
 *   - prices[]: the center price of each bin (length = bins)
 *   - volumes[]: total volume accumulated in each bin (length = bins)
 *
 * Note: Unlike other indicators that return one value per bar,
 * Volume Profile returns fixed-length arrays (one entry per bin).
 * The renderer should handle this differently from per-bar indicators.
 */
export function computeVolumeProfile(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const bins = Math.max(1, Math.round(params.bins ?? 24));
  const len = bars.length;

  if (len === 0) {
    return [new Array<number>(bins).fill(NaN), new Array<number>(bins).fill(0)];
  }

  // Find price range across all bars
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (let i = 0; i < len; i++) {
    if (bars[i].low < minPrice) minPrice = bars[i].low;
    if (bars[i].high > maxPrice) maxPrice = bars[i].high;
  }

  // Edge case: all bars at same price
  if (maxPrice === minPrice) {
    const prices = new Array<number>(bins).fill(minPrice);
    const volumes = new Array<number>(bins).fill(0);
    let totalVol = 0;
    for (let i = 0; i < len; i++) totalVol += bars[i].volume;
    volumes[Math.floor(bins / 2)] = totalVol;
    return [prices, volumes];
  }

  const binSize = (maxPrice - minPrice) / bins;
  const prices = new Array<number>(bins);
  const volumes = new Array<number>(bins).fill(0);

  // Set bin center prices
  for (let b = 0; b < bins; b++) {
    prices[b] = minPrice + binSize * (b + 0.5);
  }

  // Distribute each bar's volume across the bins it spans
  for (let i = 0; i < len; i++) {
    const bar = bars[i];
    const barLow = bar.low;
    const barHigh = bar.high;
    const barVol = bar.volume;

    const startBin = Math.max(0, Math.floor((barLow - minPrice) / binSize));
    const endBin = Math.min(bins - 1, Math.floor((barHigh - minPrice) / binSize));

    if (startBin === endBin) {
      volumes[startBin] += barVol;
    } else {
      // Distribute proportionally across spanned bins
      const barRange = barHigh - barLow;
      if (barRange <= 0) {
        volumes[startBin] += barVol;
        continue;
      }

      for (let b = startBin; b <= endBin; b++) {
        const binLow = minPrice + b * binSize;
        const binHigh = binLow + binSize;
        const overlapLow = Math.max(barLow, binLow);
        const overlapHigh = Math.min(barHigh, binHigh);
        const fraction = (overlapHigh - overlapLow) / barRange;
        volumes[b] += barVol * fraction;
      }
    }
  }

  return [prices, volumes];
}

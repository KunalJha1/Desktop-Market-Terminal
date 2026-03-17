import type { OHLCVBar } from '../../types';

export function computeStochastic(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const kPeriod = params.kPeriod ?? 14;
  const dPeriod = params.dPeriod ?? 3;
  const smooth = params.smooth ?? 3;
  const len = bars.length;

  // Raw %K
  const rawK = new Array<number>(len).fill(NaN);
  for (let i = kPeriod - 1; i < len; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].high > highest) highest = bars[j].high;
      if (bars[j].low < lowest) lowest = bars[j].low;
    }
    const range = highest - lowest;
    rawK[i] = range > 0 ? ((bars[i].close - lowest) / range) * 100 : 50;
  }

  // Smoothed %K (SMA of rawK)
  const kLine = new Array<number>(len).fill(NaN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < len; i++) {
    if (isNaN(rawK[i])) continue;
    sum += rawK[i];
    count++;
    if (count >= smooth) {
      if (count > smooth) {
        // Find the value to subtract: it's rawK at position (i - smooth)
        // We need to walk back to find the smooth-th previous valid rawK
        sum -= rawK[i - smooth] !== undefined && !isNaN(rawK[i - smooth]) ? rawK[i - smooth] : 0;
      }
      kLine[i] = sum / smooth;
    }
  }

  // Recompute smoothed %K more carefully
  kLine.fill(NaN);
  for (let i = kPeriod - 1 + smooth - 1; i < len; i++) {
    let s = 0;
    let valid = true;
    for (let j = 0; j < smooth; j++) {
      if (isNaN(rawK[i - j])) { valid = false; break; }
      s += rawK[i - j];
    }
    if (valid) kLine[i] = s / smooth;
  }

  // %D is SMA of smoothed %K
  const dLine = new Array<number>(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    if (isNaN(kLine[i])) continue;
    let s = 0;
    let valid = true;
    for (let j = 0; j < dPeriod; j++) {
      const idx = i - j;
      if (idx < 0 || isNaN(kLine[idx])) { valid = false; break; }
      s += kLine[idx];
    }
    if (valid) dLine[i] = s / dPeriod;
  }

  return [kLine, dLine];
}

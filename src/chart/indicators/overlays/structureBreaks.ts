import type { OHLCVBar } from '../../types';

export function computeStructureBreaks(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const pivotLen = Math.max(1, Math.round(params.pivotLength ?? 5));
  const requireCloseBreak = (params.requireCloseBreak ?? 1) >= 0.5;
  const bull = new Array<number>(bars.length).fill(NaN);
  const bear = new Array<number>(bars.length).fill(NaN);

  let lastSwingHigh = NaN;
  let lastSwingLow = NaN;
  let highBroken = false;
  let lowBroken = false;

  for (let i = pivotLen; i < bars.length - pivotLen; i += 1) {
    let isPivotHigh = true;
    let isPivotLow = true;
    for (let j = i - pivotLen; j <= i + pivotLen; j += 1) {
      if (bars[j].high > bars[i].high) isPivotHigh = false;
      if (bars[j].low < bars[i].low) isPivotLow = false;
      if (!isPivotHigh && !isPivotLow) break;
    }

    if (isPivotHigh) {
      lastSwingHigh = bars[i].high;
      highBroken = false;
    }
    if (isPivotLow) {
      lastSwingLow = bars[i].low;
      lowBroken = false;
    }

    const breakAbove = !Number.isNaN(lastSwingHigh) && (requireCloseBreak ? bars[i].close > lastSwingHigh : bars[i].high > lastSwingHigh);
    const breakBelow = !Number.isNaN(lastSwingLow) && (requireCloseBreak ? bars[i].close < lastSwingLow : bars[i].low < lastSwingLow);

    if (breakAbove && !highBroken) {
      bull[i] = bars[i].low;
      highBroken = true;
    }
    if (breakBelow && !lowBroken) {
      bear[i] = bars[i].high;
      lowBroken = true;
    }
  }

  return [bull, bear];
}

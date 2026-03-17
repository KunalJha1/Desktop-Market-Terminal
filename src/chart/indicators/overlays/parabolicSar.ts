import type { OHLCVBar } from '../../types';

export function computeParabolicSAR(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const step = params.step ?? 0.02;
  const max = params.max ?? 0.2;
  const len = bars.length;
  const result = new Array<number>(len).fill(NaN);

  if (len < 2) return [result];

  let isLong = bars[1].close >= bars[0].close;
  let af = step;
  let ep = isLong ? bars[0].high : bars[0].low;
  let sar = isLong ? bars[0].low : bars[0].high;

  result[0] = sar;

  for (let i = 1; i < len; i++) {
    const prevSar = sar;

    // Update SAR
    sar = prevSar + af * (ep - prevSar);

    if (isLong) {
      // Make sure SAR is not above the prior two lows
      if (i >= 2) {
        sar = Math.min(sar, bars[i - 1].low, bars[i - 2].low);
      } else {
        sar = Math.min(sar, bars[i - 1].low);
      }

      // Check for reversal
      if (bars[i].low < sar) {
        isLong = false;
        sar = ep;
        ep = bars[i].low;
        af = step;
      } else {
        if (bars[i].high > ep) {
          ep = bars[i].high;
          af = Math.min(af + step, max);
        }
      }
    } else {
      // Make sure SAR is not below the prior two highs
      if (i >= 2) {
        sar = Math.max(sar, bars[i - 1].high, bars[i - 2].high);
      } else {
        sar = Math.max(sar, bars[i - 1].high);
      }

      // Check for reversal
      if (bars[i].high > sar) {
        isLong = true;
        sar = ep;
        ep = bars[i].high;
        af = step;
      } else {
        if (bars[i].low < ep) {
          ep = bars[i].low;
          af = Math.min(af + step, max);
        }
      }
    }

    result[i] = sar;
  }

  return [result];
}

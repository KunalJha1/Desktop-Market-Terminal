import type { OHLCVBar } from '../../types';

function periodHighLow(bars: OHLCVBar[], end: number, period: number): [number, number] {
  let high = -Infinity;
  let low = Infinity;
  const start = Math.max(0, end - period + 1);
  for (let i = start; i <= end; i++) {
    if (bars[i].high > high) high = bars[i].high;
    if (bars[i].low < low) low = bars[i].low;
  }
  return [high, low];
}

export function computeIchimoku(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const tenkanPeriod = params.tenkan ?? 9;
  const kijunPeriod = params.kijun ?? 26;
  const senkouBPeriod = params.senkou ?? 52;
  const len = bars.length;

  const tenkan = new Array<number>(len).fill(NaN);
  const kijun = new Array<number>(len).fill(NaN);
  const senkouA = new Array<number>(len).fill(NaN);
  const senkouB = new Array<number>(len).fill(NaN);
  const chikou = new Array<number>(len).fill(NaN);

  for (let i = 0; i < len; i++) {
    // Tenkan-sen (conversion line)
    if (i >= tenkanPeriod - 1) {
      const [h, l] = periodHighLow(bars, i, tenkanPeriod);
      tenkan[i] = (h + l) / 2;
    }

    // Kijun-sen (base line)
    if (i >= kijunPeriod - 1) {
      const [h, l] = periodHighLow(bars, i, kijunPeriod);
      kijun[i] = (h + l) / 2;
    }

    // Senkou Span A (leading span A): (tenkan + kijun) / 2, shifted forward by kijunPeriod
    // We store it at the current index but it represents kijunPeriod bars ahead
    if (i >= kijunPeriod - 1) {
      const tVal = tenkan[i];
      const kVal = kijun[i];
      if (!isNaN(tVal) && !isNaN(kVal)) {
        const targetIdx = i + kijunPeriod;
        if (targetIdx < len) {
          senkouA[targetIdx] = (tVal + kVal) / 2;
        }
      }
    }

    // Senkou Span B (leading span B): (highest + lowest) over senkouBPeriod, shifted forward by kijunPeriod
    if (i >= senkouBPeriod - 1) {
      const [h, l] = periodHighLow(bars, i, senkouBPeriod);
      const targetIdx = i + kijunPeriod;
      if (targetIdx < len) {
        senkouB[targetIdx] = (h + l) / 2;
      }
    }

    // Chikou Span (lagging span): close shifted back by kijunPeriod
    const chikouIdx = i - kijunPeriod;
    if (chikouIdx >= 0) {
      chikou[chikouIdx] = bars[i].close;
    }
  }

  return [tenkan, kijun, senkouA, senkouB, chikou];
}

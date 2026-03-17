import type { OHLCVBar } from '../../types';

export function computeVWAP(bars: OHLCVBar[], _params: Record<string, number>): number[][] {
  const len = bars.length;
  const result = new Array<number>(len);

  let cumTPV = 0;
  let cumVol = 0;

  for (let i = 0; i < len; i++) {
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumTPV += tp * bars[i].volume;
    cumVol += bars[i].volume;
    result[i] = cumVol > 0 ? cumTPV / cumVol : NaN;
  }

  return [result];
}

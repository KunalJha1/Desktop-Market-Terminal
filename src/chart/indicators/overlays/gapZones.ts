import type { OHLCVBar } from '../../types';

export function computeGapZones(bars: OHLCVBar[], _params: Record<string, number>): number[][] {
  const len = bars.length;
  const bullTop = new Array<number>(len).fill(NaN);
  const bullBottom = new Array<number>(len).fill(NaN);
  const bearTop = new Array<number>(len).fill(NaN);
  const bearBottom = new Array<number>(len).fill(NaN);
  const gapUp = new Array<number>(len).fill(NaN);
  const gapDown = new Array<number>(len).fill(NaN);

  let activeBullTop = NaN;
  let activeBullBottom = NaN;
  let activeBearTop = NaN;
  let activeBearBottom = NaN;

  for (let i = 1; i < len; i += 1) {
    const hasGapUp = bars[i].low > bars[i - 1].high;
    const hasGapDown = bars[i].high < bars[i - 1].low;

    if (hasGapUp) {
      activeBullTop = bars[i].low;
      activeBullBottom = bars[i - 1].high;
      activeBearTop = NaN;
      activeBearBottom = NaN;
      gapUp[i] = bars[i].low;
    } else if (!Number.isNaN(activeBullBottom) && bars[i].low <= activeBullBottom) {
      activeBullTop = NaN;
      activeBullBottom = NaN;
    }

    if (hasGapDown) {
      activeBearTop = bars[i - 1].low;
      activeBearBottom = bars[i].high;
      activeBullTop = NaN;
      activeBullBottom = NaN;
      gapDown[i] = bars[i].high;
    } else if (!Number.isNaN(activeBearTop) && bars[i].high >= activeBearTop) {
      activeBearTop = NaN;
      activeBearBottom = NaN;
    }

    bullTop[i] = activeBullTop;
    bullBottom[i] = activeBullBottom;
    bearTop[i] = activeBearTop;
    bearBottom[i] = activeBearBottom;
  }

  return [bullTop, bullBottom, bearTop, bearBottom, gapUp, gapDown];
}

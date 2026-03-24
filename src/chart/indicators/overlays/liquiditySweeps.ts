import type { OHLCVBar } from '../../types';
import { computeLiquidityLevels } from '../shared/ictSmc';

export function computeLiquiditySweeps(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const requireCloseConfirm = (params.requireCloseConfirm ?? 1) >= 0.5;
  const externalOnly = (params.externalOnly ?? 1) >= 0.5;
  const padTicks = Math.max(0, params.padTicks ?? 0);
  const pad = padTicks * 0.01;
  const tol = pad > 0 ? pad * 2 : 0.02;
  const levels = computeLiquidityLevels(bars);
  const buy = new Array<number>(bars.length).fill(NaN);
  const sell = new Array<number>(bars.length).fill(NaN);
  const bullBoxTop = new Array<number>(bars.length).fill(NaN);
  const bullBoxBottom = new Array<number>(bars.length).fill(NaN);
  const bearBoxTop = new Array<number>(bars.length).fill(NaN);
  const bearBoxBottom = new Array<number>(bars.length).fill(NaN);
  let activeBullStart = -1;
  let activeBullTop = NaN;
  let activeBullBottom = NaN;
  let activeBearStart = -1;
  let activeBearTop = NaN;
  let activeBearBottom = NaN;

  const flushBull = (endIndex: number) => {
    if (activeBullStart < 0 || endIndex < 0) return;
    buy[endIndex] = activeBullBottom;
    bullBoxTop[endIndex] = activeBullTop;
    bullBoxBottom[endIndex] = activeBullBottom;
    activeBullStart = -1;
    activeBullTop = NaN;
    activeBullBottom = NaN;
  };

  const flushBear = (endIndex: number) => {
    if (activeBearStart < 0 || endIndex < 0) return;
    sell[endIndex] = activeBearTop;
    bearBoxTop[endIndex] = activeBearTop;
    bearBoxBottom[endIndex] = activeBearBottom;
    activeBearStart = -1;
    activeBearTop = NaN;
    activeBearBottom = NaN;
  };

  for (let i = 1; i < bars.length; i += 1) {
    const baseHigh = levels.todayHigh[i - 1];
    const baseLow = levels.todayLow[i - 1];

    const allowBear = (level: number) => !externalOnly || (!Number.isNaN(level) && !Number.isNaN(baseHigh) && level >= baseHigh - tol);
    const allowBull = (level: number) => !externalOnly || (!Number.isNaN(level) && !Number.isNaN(baseLow) && level <= baseLow + tol);
    const bullSweep = (level: number) => !Number.isNaN(level)
      && bars[i].low < (level - pad)
      && (!requireCloseConfirm || bars[i].close > level);
    const bearSweep = (level: number) => !Number.isNaN(level)
      && bars[i].high > (level + pad)
      && (!requireCloseConfirm || bars[i].close < level);

    let bullLevel = NaN;
    if (bullSweep(baseLow)) bullLevel = baseLow;
    else if (allowBull(levels.prevDayLow[i]) && bullSweep(levels.prevDayLow[i])) bullLevel = levels.prevDayLow[i];
    else if (allowBull(levels.prevWeekLow[i]) && bullSweep(levels.prevWeekLow[i])) bullLevel = levels.prevWeekLow[i];
    else if (allowBull(levels.prevMonthLow[i]) && bullSweep(levels.prevMonthLow[i])) bullLevel = levels.prevMonthLow[i];

    let bearLevel = NaN;
    if (bearSweep(baseHigh)) bearLevel = baseHigh;
    else if (allowBear(levels.prevDayHigh[i]) && bearSweep(levels.prevDayHigh[i])) bearLevel = levels.prevDayHigh[i];
    else if (allowBear(levels.prevWeekHigh[i]) && bearSweep(levels.prevWeekHigh[i])) bearLevel = levels.prevWeekHigh[i];
    else if (allowBear(levels.prevMonthHigh[i]) && bearSweep(levels.prevMonthHigh[i])) bearLevel = levels.prevMonthHigh[i];

    const bullHit = !Number.isNaN(bullLevel);
    const bearHit = !Number.isNaN(bearLevel);

    if (bullHit && !bearHit) {
      flushBear(i - 1);
      if (activeBullStart < 0) {
        activeBullStart = i;
        activeBullTop = bullLevel;
        activeBullBottom = bars[i].low;
      } else {
        activeBullTop = Math.max(activeBullTop, bullLevel);
        activeBullBottom = Math.min(activeBullBottom, bars[i].low);
      }
      continue;
    }

    if (bearHit && !bullHit) {
      flushBull(i - 1);
      if (activeBearStart < 0) {
        activeBearStart = i;
        activeBearTop = bars[i].high;
        activeBearBottom = bearLevel;
      } else {
        activeBearTop = Math.max(activeBearTop, bars[i].high);
        activeBearBottom = Math.min(activeBearBottom, bearLevel);
      }
      continue;
    }

    flushBull(i - 1);
    flushBear(i - 1);
  }

  flushBull(bars.length - 1);
  flushBear(bars.length - 1);

  return [buy, sell, bullBoxTop, bullBoxBottom, bearBoxTop, bearBoxBottom];
}

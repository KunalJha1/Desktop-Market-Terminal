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

    const bullHit = bullSweep(baseLow)
      || (allowBull(levels.prevDayLow[i]) && bullSweep(levels.prevDayLow[i]))
      || (allowBull(levels.prevWeekLow[i]) && bullSweep(levels.prevWeekLow[i]))
      || (allowBull(levels.prevMonthLow[i]) && bullSweep(levels.prevMonthLow[i]));

    const bearHit = bearSweep(baseHigh)
      || (allowBear(levels.prevDayHigh[i]) && bearSweep(levels.prevDayHigh[i]))
      || (allowBear(levels.prevWeekHigh[i]) && bearSweep(levels.prevWeekHigh[i]))
      || (allowBear(levels.prevMonthHigh[i]) && bearSweep(levels.prevMonthHigh[i]));

    if (bullHit && !bearHit) buy[i] = bars[i].low;
    if (bearHit && !bullHit) sell[i] = bars[i].high;
  }

  return [buy, sell];
}

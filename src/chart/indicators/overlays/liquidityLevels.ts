import type { OHLCVBar } from '../../types';
import { computeLiquidityLevels } from '../shared/ictSmc';

export function computeLiquidityLevelLines(bars: OHLCVBar[], _params: Record<string, number>): number[][] {
  const levels = computeLiquidityLevels(bars);
  return [
    levels.todayHigh,
    levels.todayLow,
    levels.prevDayHigh,
    levels.prevDayLow,
    levels.prevWeekHigh,
    levels.prevWeekLow,
    levels.prevMonthHigh,
    levels.prevMonthLow,
  ];
}

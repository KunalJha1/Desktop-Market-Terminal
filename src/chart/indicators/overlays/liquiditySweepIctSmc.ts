import type { OHLCVBar } from '../../types';
import { computeLiquidityLevels } from '../shared/ictSmc';

function fillNaN(length: number): number[] {
  return new Array<number>(length).fill(NaN);
}

function estimateTickSize(bars: OHLCVBar[]): number {
  let best = Infinity;

  const consider = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const rounded = Math.round(value * 1e8) / 1e8;
    if (rounded > 0) best = Math.min(best, rounded);
  };

  for (let i = 1; i < bars.length; i += 1) {
    consider(Math.abs(bars[i].open - bars[i - 1].open));
    consider(Math.abs(bars[i].high - bars[i - 1].high));
    consider(Math.abs(bars[i].low - bars[i - 1].low));
    consider(Math.abs(bars[i].close - bars[i - 1].close));
    consider(Math.abs(bars[i].high - bars[i].low));
  }

  if (best !== Infinity) return best;
  const fallback = Math.abs((bars[0]?.close ?? 0) / 10000);
  return fallback > 0 ? fallback : 0.01;
}

interface SweepCandidate {
  level: number;
  code: number;
}

function buildSeries(enabled: boolean, source: number[]): number[] {
  return enabled ? source.slice() : fillNaN(source.length);
}

export function computeLiquiditySweepIctSmc(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const len = bars.length;
  const empty = Array.from({ length: 16 }, () => fillNaN(len));
  const liqOn = (params.liqOn ?? 1) >= 0.5;
  if (!liqOn || len === 0) return empty;

  const liqUseCloseConfirm = (params.liqUseCloseConfirm ?? 1) >= 0.5;
  const liqShowTodayHL = (params.liqShowTodayHL ?? 1) >= 0.5;
  const liqShowPDH_PDL = (params.liqShowPDH_PDL ?? 1) >= 0.5;
  const liqShowPWH_PWL = (params.liqShowPWH_PWL ?? 1) >= 0.5;
  const liqShowPMH_PML = (params.liqShowPMH_PML ?? 1) >= 0.5;
  const liqUseExternalOnly = (params.liqUseExternalOnly ?? 1) >= 0.5;
  const liqPadTicks = Math.max(0, Math.round(params.liqPadTicks ?? 0));

  const levels = computeLiquidityLevels(bars);
  const tickSize = estimateTickSize(bars);
  const pad = tickSize * liqPadTicks;
  const tol = tickSize * 2;

  const todayHigh = buildSeries(liqShowTodayHL, levels.todayHigh);
  const todayLow = buildSeries(liqShowTodayHL, levels.todayLow);
  const prevDayHigh = buildSeries(liqShowPDH_PDL, levels.prevDayHigh);
  const prevDayLow = buildSeries(liqShowPDH_PDL, levels.prevDayLow);
  const prevWeekHigh = buildSeries(liqShowPWH_PWL, levels.prevWeekHigh);
  const prevWeekLow = buildSeries(liqShowPWH_PWL, levels.prevWeekLow);
  const prevMonthHigh = buildSeries(liqShowPMH_PML, levels.prevMonthHigh);
  const prevMonthLow = buildSeries(liqShowPMH_PML, levels.prevMonthLow);
  const buy = fillNaN(len);
  const sell = fillNaN(len);
  const bullBoxTop = fillNaN(len);
  const bullBoxBottom = fillNaN(len);
  const bearBoxTop = fillNaN(len);
  const bearBoxBottom = fillNaN(len);
  const bullSourceCode = fillNaN(len);
  const bearSourceCode = fillNaN(len);

  const allowBear = (level: number, baseHigh: number) => !liqUseExternalOnly
    || (!Number.isNaN(level) && !Number.isNaN(baseHigh) && level >= (baseHigh - tol));
  const allowBull = (level: number, baseLow: number) => !liqUseExternalOnly
    || (!Number.isNaN(level) && !Number.isNaN(baseLow) && level <= (baseLow + tol));
  const bullSweep = (index: number, level: number) => !Number.isNaN(level)
    && bars[index].low < (level - pad)
    && (!liqUseCloseConfirm || bars[index].close > level);
  const bearSweep = (index: number, level: number) => !Number.isNaN(level)
    && bars[index].high > (level + pad)
    && (!liqUseCloseConfirm || bars[index].close < level);

  for (let i = 1; i < len; i += 1) {
    const baseHighForSweep = levels.todayHigh[i - 1];
    const baseLowForSweep = levels.todayLow[i - 1];

    let bull: SweepCandidate | null = null;
    if (liqShowTodayHL && bullSweep(i, baseLowForSweep)) {
      bull = { level: baseLowForSweep, code: 1 };
    } else if (liqShowPDH_PDL && allowBull(levels.prevDayLow[i], baseLowForSweep) && bullSweep(i, levels.prevDayLow[i])) {
      bull = { level: levels.prevDayLow[i], code: 2 };
    } else if (liqShowPWH_PWL && allowBull(levels.prevWeekLow[i], baseLowForSweep) && bullSweep(i, levels.prevWeekLow[i])) {
      bull = { level: levels.prevWeekLow[i], code: 3 };
    } else if (liqShowPMH_PML && allowBull(levels.prevMonthLow[i], baseLowForSweep) && bullSweep(i, levels.prevMonthLow[i])) {
      bull = { level: levels.prevMonthLow[i], code: 4 };
    }

    let bear: SweepCandidate | null = null;
    if (liqShowTodayHL && bearSweep(i, baseHighForSweep)) {
      bear = { level: baseHighForSweep, code: 1 };
    } else if (liqShowPDH_PDL && allowBear(levels.prevDayHigh[i], baseHighForSweep) && bearSweep(i, levels.prevDayHigh[i])) {
      bear = { level: levels.prevDayHigh[i], code: 2 };
    } else if (liqShowPWH_PWL && allowBear(levels.prevWeekHigh[i], baseHighForSweep) && bearSweep(i, levels.prevWeekHigh[i])) {
      bear = { level: levels.prevWeekHigh[i], code: 3 };
    } else if (liqShowPMH_PML && allowBear(levels.prevMonthHigh[i], baseHighForSweep) && bearSweep(i, levels.prevMonthHigh[i])) {
      bear = { level: levels.prevMonthHigh[i], code: 4 };
    }

    if (bull && !bear) {
      buy[i] = bars[i].low;
      bullBoxTop[i] = bull.level;
      bullBoxBottom[i] = bars[i].low;
      bullSourceCode[i] = bull.code;
    } else if (bear && !bull) {
      sell[i] = bars[i].high;
      bearBoxTop[i] = bars[i].high;
      bearBoxBottom[i] = bear.level;
      bearSourceCode[i] = bear.code;
    }
  }

  return [
    todayHigh,
    todayLow,
    prevDayHigh,
    prevDayLow,
    prevWeekHigh,
    prevWeekLow,
    prevMonthHigh,
    prevMonthLow,
    buy,
    sell,
    bullBoxTop,
    bullBoxBottom,
    bearBoxTop,
    bearBoxBottom,
    bullSourceCode,
    bearSourceCode,
  ];
}

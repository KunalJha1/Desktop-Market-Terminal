import { getTimeframeMs } from '../chart/constants';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TechnicalTableRowSnapshot {
  tf: string;
  trend: number;
  strength: number;
  chop: number;
  rsiNow: number;
  rsiPrev: number;
  macdNow: number;
  macdSignal: number;
  macdPrev: number;
  macdSignalPrev: number;
  emaCross: number;    // 2=Bull Cross, 1=Bull above, -1=Bear below, -2=Bear Cross, 0=Flat
  emaCrossGapDir: number; // 1=gap expanding, -1=gap shrinking, 0=flat
  volMom: number; // 1=SBM, -1=SSM, 2=BullDiv, -2=BearDiv, 0=Flat
}

export interface TechnicalTableSnapshot {
  rows: TechnicalTableRowSnapshot[];
  overallTrend: number;
  overallStrength: number;
  overallChop: number;
  overallRsi: number;
  overallMacdState: number;
  overallEmaCross: number; // 1=bull majority, -1=bear majority, 0=mixed
  overallVolMom: number; // 1=SBM dominates, -1=SSM dominates, 0=Mixed
}

export interface LiquidityTableRowSnapshot {
  highLabel: string;
  highPrice: number;
  highSwept: boolean;
  highTarget: number;
  highConfidencePrev?: number;
  lowLabel: string;
  lowPrice: number;
  lowSwept: boolean;
  lowTarget: number;
  lowConfidencePrev?: number;
}

export interface LiquidityTableSnapshot {
  rows: LiquidityTableRowSnapshot[];
  close: number;
  nearPct: number;
  highlightNearLevels: boolean;
  atrDaily: number;
  targetAtrMult: number;
  technicalRows?: TechnicalTableRowSnapshot[];
  overallBull?: number;
  overallBear?: number;
  overallRsiAvg?: number;
  overallMacdBull?: number;
  overallMacdBear?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

export const DIQ_TABLE_BULL_GREEN = '#166534';
export const DIQ_TABLE_BULL_GREEN_ALT = '#15803D';
export const TECH_TABLE_HEADER_HEIGHT = 24;
export const DIQ_TABLE_FETCH_LIMITS = {
  oneMin: 2_500,
  fiveMin: 2_000,
  fifteenMin: 3_000,
  daily: 1_500,
};

// ── Color / text helpers ───────────────────────────────────────────────────────

export function diqTrendText(value: number): string {
  if (value === 1) return 'Bullish';
  if (value === -1) return 'Bearish';
  return 'Neutral';
}

export function diqTrendColor(value: number): string {
  if (value === 1) return DIQ_TABLE_BULL_GREEN;
  if (value === -1) return '#FF3D71';
  return '#6B7280';
}

export function diqStrengthText(score: number): string {
  if (!Number.isFinite(score)) return '--';
  if (score >= 0.6) return 'High';
  if (score >= 0.25) return 'Medium';
  return 'Low';
}

export function diqStrengthColor(score: number): string {
  if (!Number.isFinite(score)) return '#6B7280';
  if (score >= 0.6) return DIQ_TABLE_BULL_GREEN;
  if (score >= 0.25) return '#F59E0B';
  return '#FB923C';
}

export function diqStrengthTextColor(score: number): string {
  if (!Number.isFinite(score)) return '#FFFFFF';
  if (score >= 0.6) return '#FFFFFF';
  return '#111827';
}

export function diqChopText(angle: number): string {
  if (!Number.isFinite(angle)) return '--';
  if (angle >= 5) return 'Strong Up';
  if (angle >= 3.57) return 'Up';
  if (angle >= 2.14) return 'Med Up';
  if (angle >= 0.71) return 'Weak Up';
  if (angle <= -5) return 'Strong Down';
  if (angle <= -3.57) return 'Down';
  if (angle <= -2.14) return 'Med Down';
  if (angle <= -0.71) return 'Weak Down';
  return 'Chop';
}

export function diqChopColor(angle: number): string {
  if (!Number.isFinite(angle)) return '#6B7280';
  if (angle >= 5) return '#26C6DA';
  if (angle >= 3.57) return '#43A047';
  if (angle >= 2.14) return '#A5D6A7';
  if (angle >= 0.71) return '#009688';
  if (angle <= -5) return '#D50000';
  if (angle <= -3.57) return '#E91E63';
  if (angle <= -2.14) return '#FF6D00';
  if (angle <= -0.71) return '#FFB74D';
  return '#FDD835';
}

export function diqChopTextColor(angle: number): string {
  if (!Number.isFinite(angle)) return '#FFFFFF';
  if (angle >= 3.57) return '#FFFFFF';
  if (angle <= -5) return '#FFFFFF';
  if (angle <= -3.57) return '#FFFFFF';
  return '#111827';
}

export function diqRsiText(now: number, prev: number): string {
  if (!Number.isFinite(now)) return '--';
  const diff = Number.isFinite(prev) ? now - prev : 0;
  const arrow = diff > 0.25 ? '↑' : diff < -0.25 ? '↓' : '→';
  return `${now.toFixed(1)} ${arrow}`;
}

export function diqRsiColor(now: number, prev: number): string {
  if (!Number.isFinite(now)) return '#6B7280';
  const diff = Number.isFinite(prev) ? now - prev : 0;
  if (diff > 0.25 && now >= 55) return DIQ_TABLE_BULL_GREEN;
  if (diff < -0.25 && now <= 45) return '#FF3D71';
  if (Math.abs(diff) <= 0.25) return '#6B7280';
  if (now > 60) return DIQ_TABLE_BULL_GREEN_ALT;
  if (now < 40) return '#991B1B';
  return '#F59E0B';
}

export function diqMacdText(macdNow: number, signalNow: number, macdPrev: number, signalPrev: number): string {
  if (!Number.isFinite(macdNow) || !Number.isFinite(signalNow)) return '--';
  const bullCross = Number.isFinite(macdPrev) && Number.isFinite(signalPrev) && macdPrev <= signalPrev && macdNow > signalNow;
  const bearCross = Number.isFinite(macdPrev) && Number.isFinite(signalPrev) && macdPrev >= signalPrev && macdNow < signalNow;
  const diff = Number.isFinite(macdPrev) ? macdNow - macdPrev : 0;
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  if (bullCross) return 'Bull X ↑';
  if (bearCross) return 'Bear X ↓';
  if (macdNow > signalNow) return `Bull ${arrow}`;
  if (macdNow < signalNow) return `Bear ${arrow}`;
  return 'Flat →';
}

export function diqMacdColor(macdNow: number, signalNow: number, macdPrev: number, signalPrev: number): string {
  if (!Number.isFinite(macdNow) || !Number.isFinite(signalNow)) return '#6B7280';
  const bullCross = Number.isFinite(macdPrev) && Number.isFinite(signalPrev) && macdPrev <= signalPrev && macdNow > signalNow;
  const bearCross = Number.isFinite(macdPrev) && Number.isFinite(signalPrev) && macdPrev >= signalPrev && macdNow < signalNow;
  if (bullCross) return DIQ_TABLE_BULL_GREEN;
  if (bearCross) return '#FF3D71';
  if (macdNow > signalNow) return DIQ_TABLE_BULL_GREEN;
  if (macdNow < signalNow) return '#FB923C';
  return '#6B7280';
}

export function diqEmaCrossText(v: number, gapDir: number): string {
  if (!Number.isFinite(v)) return '--';
  const gap = gapDir === 1 ? '↑' : gapDir === -1 ? '↓' : '→';
  if (v === 2) return `Bull X ${gap}`;
  if (v === 1) return `Bull ${gap}`;
  if (v === -1) return `Bear ${gap}`;
  if (v === -2) return `Bear X ${gap}`;
  return `Flat ${gap}`;
}

export function diqEmaCrossColor(v: number): string {
  if (!Number.isFinite(v)) return '#6B7280';
  if (v === 2) return '#00C853';
  if (v === 1) return DIQ_TABLE_BULL_GREEN;
  if (v === -1) return '#991B1B';
  if (v === -2) return '#FF3D71';
  return '#6B7280';
}

export function diqEmaCrossTextColor(v: number): string {
  if (v === 2) return '#000000';
  return '#FFFFFF';
}

export function diqVolMomText(v: number): string {
  if (!Number.isFinite(v)) return '--';
  if (v === 1) return 'SBM ↑';
  if (v === -1) return 'SSM ↓';
  if (v === 2) return 'Bull Div ↑';
  if (v === -2) return 'Bear Div ↓';
  return 'Flat →';
}

export function diqVolMomColor(v: number): string {
  if (!Number.isFinite(v)) return '#6B7280';
  if (v === 1) return '#00C853';
  if (v === -1) return '#FF3D71';
  if (v === 2) return '#00BCD4';
  if (v === -2) return '#FB923C';
  return '#6B7280';
}

export function diqVolMomTextColor(v: number): string {
  if (v === 1 || v === 2) return '#000000';
  return '#FFFFFF';
}

// ── Bar utilities ──────────────────────────────────────────────────────────────

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number; synthetic?: boolean };

export function yieldTechnicalTableWork(): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, 0); });
}

function normalizeHistoricalBarTimeMs(rawTime: number): number {
  if (!Number.isFinite(rawTime)) return NaN;
  return Math.abs(rawTime) < 100_000_000_000 ? Math.round(rawTime * 1000) : Math.round(rawTime);
}

function tableBucketFor(tsMs: number, timeframe: string): number {
  if (timeframe === '1W') {
    const mondayOffsetMs = 4 * 86_400_000;
    return Math.floor((tsMs - mondayOffsetMs) / 604_800_000) * 604_800_000 + mondayOffsetMs;
  }
  if (timeframe === '1M' || timeframe === '3M' || timeframe === '6M' || timeframe === '12M') {
    const d = new Date(tsMs);
    const monthsPerBucket = timeframe === '3M' ? 3 : timeframe === '6M' ? 6 : timeframe === '12M' ? 12 : 1;
    const bucketMonth = Math.floor(d.getUTCMonth() / monthsPerBucket) * monthsPerBucket;
    return Date.UTC(d.getUTCFullYear(), bucketMonth, 1);
  }
  const ms = getTimeframeMs(timeframe);
  return Math.floor(tsMs / ms) * ms;
}

export function tableResampleBars(bars: Bar[], timeframe: string): Bar[] {
  const result: Bar[] = [];
  let current: Bar | null = null;
  let currentBucket = -1;
  let bucketHasSynthetic = false;
  for (const bar of bars) {
    const bucket = tableBucketFor(bar.time, timeframe);
    if (bucket !== currentBucket || !current) {
      if (current) {
        if (bucketHasSynthetic) current.synthetic = true;
        result.push(current);
      }
      currentBucket = bucket;
      bucketHasSynthetic = !!bar.synthetic;
      current = { time: bucket, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
      if (bar.synthetic) bucketHasSynthetic = true;
    }
  }
  if (current) {
    if (bucketHasSynthetic) current.synthetic = true;
    result.push(current);
  }
  return result;
}

export async function fetchTableBars(
  sidecarPort: number,
  symbol: string,
  barSize: '1 min' | '5 mins' | '15 mins' | '1 day',
  duration: string,
  limit?: number,
): Promise<Bar[]> {
  const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('bar_size', barSize);
  url.searchParams.set('duration', duration);
  if (limit != null) url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const payload = await res.json() as { bars?: Array<Record<string, number | boolean>> };
  const bars = payload.bars ?? [];
  const byTime = new Map<number, Bar>();
  for (const raw of bars) {
    const time = normalizeHistoricalBarTimeMs(Number(raw.time));
    const open = Number(raw.open);
    const high = Number(raw.high);
    const low = Number(raw.low);
    const close = Number(raw.close);
    const volume = Number(raw.volume);
    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(volume)) continue;
    const existing = byTime.get(time);
    byTime.set(time, { time, open, high, low, close, volume, ...(Boolean(raw.synthetic) || Boolean(existing?.synthetic) ? { synthetic: true } : {}) });
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

// ── Technical table computation ────────────────────────────────────────────────

function tableEma(values: number[], period: number): number[] {
  const len = values.length;
  const result = new Array<number>(len).fill(NaN);
  const k = 2 / (period + 1);
  let seeded = false;
  let seedSum = 0;
  let seedCount = 0;
  let prev = NaN;
  for (let i = 0; i < len; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (!seeded) {
      seedSum += value;
      seedCount += 1;
      if (seedCount === period) { prev = seedSum / period; result[i] = prev; seeded = true; }
    } else {
      prev = (value * k) + (prev * (1 - k));
      result[i] = prev;
    }
  }
  return result;
}

function tableAtr(bars: { high: number; low: number; close: number }[], period: number): number[] {
  const tr = new Array<number>(bars.length).fill(NaN);
  const result = new Array<number>(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i += 1) {
    tr[i] = i === 0
      ? bars[i].high - bars[i].low
      : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  }
  if (bars.length < period) return result;
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += tr[i];
  result[period - 1] = seed / period;
  for (let i = period; i < bars.length; i += 1) result[i] = ((result[i - 1] * (period - 1)) + tr[i]) / period;
  return result;
}

function tableRsi(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff; else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }
  return result;
}

function tableRollingHighest(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let highest = -Infinity;
    for (let j = i - period + 1; j <= i; j += 1) highest = Math.max(highest, values[j]);
    result[i] = highest;
  }
  return result;
}

function tableVolSma(volumes: number[], period: number): number[] {
  const result = new Array<number>(volumes.length).fill(NaN);
  for (let i = period - 1; i < volumes.length; i += 1) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += volumes[j];
    result[i] = sum / period;
  }
  return result;
}

function tableRollingLowest(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) lowest = Math.min(lowest, values[j]);
    result[i] = lowest;
  }
  return result;
}

function tableChopAngle(ema34: number, ema34Prev: number, avg: number, highestHigh: number, lowestLow: number): number {
  const rangeVal = highestHigh - lowestLow;
  const safeRange = rangeVal === 0 ? 0.000001 : rangeVal;
  const safeAvg = avg === 0 ? 0.000001 : avg;
  const span = (25 / safeRange) * lowestLow;
  const y2 = ((ema34Prev - ema34) / safeAvg) * span;
  const c = Math.sqrt(1 + (y2 * y2));
  const angle1 = Math.round((180 * Math.acos(1 / c)) / Math.PI);
  return y2 > 0 ? -angle1 : angle1;
}

export function computeTechnicalTableRowFromBars(
  tf: string,
  bars: Bar[],
  fastLen: number,
  slowLen: number,
  trendLen: number,
): TechnicalTableRowSnapshot {
  const row: TechnicalTableRowSnapshot = { tf, trend: NaN, strength: NaN, chop: NaN, rsiNow: NaN, rsiPrev: NaN, macdNow: NaN, macdSignal: NaN, macdPrev: NaN, macdSignalPrev: NaN, emaCross: NaN, emaCrossGapDir: NaN, volMom: NaN };
  if (bars.length === 0) return row;

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);
  const avg = bars.map((b) => (b.high + b.low + b.close) / 3);
  const fast = tableEma(closes, fastLen);
  const slow = tableEma(closes, slowLen);
  const trend = tableEma(closes, trendLen);
  const atr14 = tableAtr(bars, 14);
  const rsi14 = tableRsi(closes, 14);
  const macdFast = tableEma(closes, 12);
  const macdSlow = tableEma(closes, 26);
  const macdLine = macdFast.map((v, i) => Number.isFinite(v) && Number.isFinite(macdSlow[i]) ? v - macdSlow[i] : NaN);
  const macdSignal = tableEma(macdLine, 9);
  const ema34 = tableEma(closes, 34);
  const high30 = tableRollingHighest(highs, 30);
  const low30 = tableRollingLowest(lows, 30);
  const volSma10 = tableVolSma(volumes, 10);

  const findLastFiniteIndex = (series: number[], startAt = series.length - 1): number => {
    for (let i = Math.min(startAt, series.length - 1); i >= 0; i -= 1) if (Number.isFinite(series[i])) return i;
    return -1;
  };
  const findPreviousFiniteIndex = (series: number[], beforeIndex: number): number => {
    for (let i = Math.min(beforeIndex - 1, series.length - 1); i >= 0; i -= 1) if (Number.isFinite(series[i])) return i;
    return -1;
  };

  const i = findLastFiniteIndex(closes);
  if (i < 0) return row;

  const trendIndex = (() => {
    for (let idx = i; idx >= 0; idx -= 1) {
      if (Number.isFinite(closes[idx]) && Number.isFinite(fast[idx]) && Number.isFinite(slow[idx]) && Number.isFinite(trend[idx])) return idx;
    }
    return -1;
  })();
  if (trendIndex >= 0) {
    row.trend = closes[trendIndex] > trend[trendIndex] && fast[trendIndex] > slow[trendIndex] ? 1
      : closes[trendIndex] < trend[trendIndex] && fast[trendIndex] < slow[trendIndex] ? -1 : 0;
  }

  const emaCrossIndex = (() => {
    for (let idx = i; idx >= 0; idx -= 1) if (Number.isFinite(fast[idx]) && Number.isFinite(slow[idx])) return idx;
    return -1;
  })();
  if (emaCrossIndex >= 0) {
    const fastNow = fast[emaCrossIndex];
    const slowNow = slow[emaCrossIndex];
    const prevIdx = findPreviousFiniteIndex(fast, emaCrossIndex);
    const fastPrev = prevIdx >= 0 ? fast[prevIdx] : NaN;
    const slowPrev = prevIdx >= 0 ? slow[prevIdx] : NaN;
    const bullCross = Number.isFinite(fastPrev) && Number.isFinite(slowPrev) && fastPrev <= slowPrev && fastNow > slowNow;
    const bearCross = Number.isFinite(fastPrev) && Number.isFinite(slowPrev) && fastPrev >= slowPrev && fastNow < slowNow;
    row.emaCross = bullCross ? 2 : bearCross ? -2 : fastNow > slowNow ? 1 : fastNow < slowNow ? -1 : 0;
    if (Number.isFinite(fastPrev) && Number.isFinite(slowPrev)) {
      const gapNow = Math.abs(fastNow - slowNow);
      const gapPrev = Math.abs(fastPrev - slowPrev);
      row.emaCrossGapDir = gapNow > gapPrev ? 1 : gapNow < gapPrev ? -1 : 0;
    } else {
      row.emaCrossGapDir = 0;
    }
  }

  const strengthIndex = (() => {
    for (let idx = i; idx >= 0; idx -= 1) {
      if (Number.isFinite(fast[idx]) && Number.isFinite(slow[idx]) && Number.isFinite(atr14[idx]) && atr14[idx] !== 0) return idx;
    }
    return -1;
  })();
  if (strengthIndex >= 0) row.strength = Math.abs(fast[strengthIndex] - slow[strengthIndex]) / atr14[strengthIndex];

  const rsiIdx = findLastFiniteIndex(rsi14, i);
  if (rsiIdx >= 0) row.rsiNow = rsi14[rsiIdx];
  const rsiPrevIdx = findPreviousFiniteIndex(rsi14, rsiIdx);
  if (rsiPrevIdx >= 0) row.rsiPrev = rsi14[rsiPrevIdx];

  const macdIdx = (() => {
    for (let idx = i; idx >= 0; idx -= 1) if (Number.isFinite(macdLine[idx]) && Number.isFinite(macdSignal[idx])) return idx;
    return -1;
  })();
  if (macdIdx >= 0) { row.macdNow = macdLine[macdIdx]; row.macdSignal = macdSignal[macdIdx]; }
  const macdPrevIdx = findPreviousFiniteIndex(macdLine, macdIdx);
  const macdSignalPrevIdx = findPreviousFiniteIndex(macdSignal, macdIdx);
  if (macdPrevIdx >= 0) row.macdPrev = macdLine[macdPrevIdx];
  if (macdSignalPrevIdx >= 0) row.macdSignalPrev = macdSignal[macdSignalPrevIdx];

  const chopIndex = (() => {
    for (let idx = i; idx > 0; idx -= 1) {
      if (Number.isFinite(ema34[idx]) && Number.isFinite(ema34[idx - 1]) && Number.isFinite(avg[idx]) && Number.isFinite(high30[idx]) && Number.isFinite(low30[idx])) return idx;
    }
    return -1;
  })();
  if (chopIndex >= 0) row.chop = tableChopAngle(ema34[chopIndex], ema34[chopIndex - 1], avg[chopIndex], high30[chopIndex], low30[chopIndex]);

  if (i >= 10 && Number.isFinite(closes[i]) && Number.isFinite(closes[i - 10]) && Number.isFinite(volumes[i]) && Number.isFinite(volSma10[i])) {
    const priceUp = closes[i] > closes[i - 10];
    const priceDown = closes[i] < closes[i - 10];
    const volUp = volumes[i] > volSma10[i];
    if (priceUp && volUp) row.volMom = 1;
    else if (priceDown && volUp) row.volMom = -1;
    else if (priceDown && !volUp) row.volMom = 2;
    else if (priceUp && !volUp) row.volMom = -2;
    else row.volMom = 0;
  }

  return row;
}

// ── Liquidity table computation ────────────────────────────────────────────────

function liquidityDayKey(time: number): string {
  const d = new Date(time);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function liquidityWeekKey(time: number): string {
  const d = new Date(time);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = new Date(utc).getUTCDay() || 7;
  const monday = new Date(utc - ((day - 1) * 86_400_000));
  return `${monday.getUTCFullYear()}-${monday.getUTCMonth()}-${monday.getUTCDate()}`;
}

function liquidityMonthKey(time: number): string {
  const d = new Date(time);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

function computeLiquidityPeriodSeries(bars: { time: number; high: number; low: number }[], getKey: (time: number) => string) {
  const currentHigh = new Array<number>(bars.length).fill(NaN);
  const currentLow = new Array<number>(bars.length).fill(NaN);
  const previousHigh = new Array<number>(bars.length).fill(NaN);
  const previousLow = new Array<number>(bars.length).fill(NaN);
  let activeKey = '';
  let periodHigh = NaN;
  let periodLow = NaN;
  let lastHigh = NaN;
  let lastLow = NaN;
  for (let i = 0; i < bars.length; i += 1) {
    const key = getKey(bars[i].time);
    if (key !== activeKey) {
      activeKey = key;
      if (Number.isFinite(periodHigh) && Number.isFinite(periodLow)) { lastHigh = periodHigh; lastLow = periodLow; }
      periodHigh = bars[i].high;
      periodLow = bars[i].low;
    } else {
      periodHigh = Math.max(periodHigh, bars[i].high);
      periodLow = Math.min(periodLow, bars[i].low);
    }
    currentHigh[i] = periodHigh;
    currentLow[i] = periodLow;
    previousHigh[i] = lastHigh;
    previousLow[i] = lastLow;
  }
  return { currentHigh, currentLow, previousHigh, previousLow };
}

function alignLiquiditySeries(chartBars: { time: number }[], sourceBars: { time: number }[], sourceSeries: number[]): number[] {
  const aligned = new Array<number>(chartBars.length).fill(NaN);
  if (sourceBars.length === 0) return aligned;
  let sourceIndex = 0;
  for (let i = 0; i < chartBars.length; i += 1) {
    const t = chartBars[i].time;
    while (sourceIndex + 1 < sourceBars.length && sourceBars[sourceIndex + 1].time <= t) sourceIndex += 1;
    aligned[i] = sourceSeries[sourceIndex] ?? NaN;
  }
  return aligned;
}

function previousFiniteValue(series: number[], startIndex: number): number {
  for (let i = Math.min(startIndex, series.length - 1); i >= 0; i -= 1) if (Number.isFinite(series[i])) return series[i];
  return NaN;
}

export function computeLiquidityTableSnapshot(
  intradayBars: Bar[],
  dailyBars: Bar[],
  atrLen: number,
  targetAtrMult: number,
  nearPctInput: number,
  highlightNearLevels: boolean,
): LiquidityTableSnapshot | null {
  if (intradayBars.length === 0) return null;

  const day = computeLiquidityPeriodSeries(intradayBars, liquidityDayKey);
  const week = computeLiquidityPeriodSeries(intradayBars, liquidityWeekKey);
  const month = computeLiquidityPeriodSeries(intradayBars, liquidityMonthKey);
  const weeklyBars = dailyBars.length > 0 ? tableResampleBars(dailyBars, '1W') : [];
  const weeklyHighs = weeklyBars.map((b) => b.high);
  const weeklyLows = weeklyBars.map((b) => b.low);
  const current52WeekHigh = tableRollingHighest(weeklyHighs, 52);
  const current52WeekLow = tableRollingLowest(weeklyLows, 52);
  const prev52WeekHigh = current52WeekHigh.map((_, i) => i > 0 ? current52WeekHigh[i - 1] : NaN);
  const prev52WeekLow = current52WeekLow.map((_, i) => i > 0 ? current52WeekLow[i - 1] : NaN);
  const aligned52WeekHigh = alignLiquiditySeries(intradayBars, weeklyBars, current52WeekHigh);
  const aligned52WeekLow = alignLiquiditySeries(intradayBars, weeklyBars, current52WeekLow);
  const aligned52WeekHighRef = alignLiquiditySeries(intradayBars, weeklyBars, prev52WeekHigh);
  const aligned52WeekLowRef = alignLiquiditySeries(intradayBars, weeklyBars, prev52WeekLow);
  const dailyAtr = tableAtr(dailyBars, atrLen);

  const lastIndex = intradayBars.length - 1;
  const currentDayKey = liquidityDayKey(intradayBars[lastIndex].time);
  let sessionStart = lastIndex;
  while (sessionStart > 0 && liquidityDayKey(intradayBars[sessionStart - 1].time) === currentDayKey) sessionStart -= 1;

  let dhSwept = false, dlSwept = false, pdhSwept = false, pdlSwept = false;
  let whSwept = false, wlSwept = false, mhSwept = false, mlSwept = false;
  let yhSwept = false, ylSwept = false;
  let dhSweepPrice = NaN, dlSweepPrice = NaN, pdhSweepPrice = NaN, pdlSweepPrice = NaN;
  let whSweepPrice = NaN, wlSweepPrice = NaN, mhSweepPrice = NaN, mlSweepPrice = NaN;
  let yhSweepPrice = NaN, ylSweepPrice = NaN;

  for (let i = sessionStart; i < intradayBars.length; i += 1) {
    if (i === 0) continue;
    const bar = intradayBars[i];
    const dhRef = day.currentHigh[i - 1]; const dlRef = day.currentLow[i - 1];
    const pdhRef = day.previousHigh[i]; const pdlRef = day.previousLow[i];
    const whRef = week.currentHigh[i - 1]; const wlRef = week.currentLow[i - 1];
    const mhRef = month.currentHigh[i - 1]; const mlRef = month.currentLow[i - 1];
    const yhRef = aligned52WeekHighRef[i]; const ylRef = aligned52WeekLowRef[i];
    if (Number.isFinite(dhRef) && bar.high > dhRef) { dhSwept = true; if (!Number.isFinite(dhSweepPrice)) dhSweepPrice = bar.high; }
    if (Number.isFinite(dlRef) && bar.low < dlRef) { dlSwept = true; if (!Number.isFinite(dlSweepPrice)) dlSweepPrice = bar.low; }
    if (Number.isFinite(pdhRef) && bar.high > pdhRef) { pdhSwept = true; if (!Number.isFinite(pdhSweepPrice)) pdhSweepPrice = bar.high; }
    if (Number.isFinite(pdlRef) && bar.low < pdlRef) { pdlSwept = true; if (!Number.isFinite(pdlSweepPrice)) pdlSweepPrice = bar.low; }
    if (Number.isFinite(whRef) && bar.high > whRef) { whSwept = true; if (!Number.isFinite(whSweepPrice)) whSweepPrice = bar.high; }
    if (Number.isFinite(wlRef) && bar.low < wlRef) { wlSwept = true; if (!Number.isFinite(wlSweepPrice)) wlSweepPrice = bar.low; }
    if (Number.isFinite(mhRef) && bar.high > mhRef) { mhSwept = true; if (!Number.isFinite(mhSweepPrice)) mhSweepPrice = bar.high; }
    if (Number.isFinite(mlRef) && bar.low < mlRef) { mlSwept = true; if (!Number.isFinite(mlSweepPrice)) mlSweepPrice = bar.low; }
    if (Number.isFinite(yhRef) && bar.high > yhRef) { yhSwept = true; if (!Number.isFinite(yhSweepPrice)) yhSweepPrice = bar.high; }
    if (Number.isFinite(ylRef) && bar.low < ylRef) { ylSwept = true; if (!Number.isFinite(ylSweepPrice)) ylSweepPrice = bar.low; }
  }

  const atrDaily = previousFiniteValue(dailyAtr, dailyAtr.length - 2);
  const targetOffset = Number.isFinite(atrDaily) ? atrDaily * targetAtrMult : NaN;

  const rows: LiquidityTableRowSnapshot[] = [
    { highLabel: 'DH', highPrice: day.currentHigh[lastIndex], highSwept: dhSwept, highTarget: Number.isFinite(dhSweepPrice) && Number.isFinite(targetOffset) ? dhSweepPrice - targetOffset : NaN, lowLabel: 'DL', lowPrice: day.currentLow[lastIndex], lowSwept: dlSwept, lowTarget: Number.isFinite(dlSweepPrice) && Number.isFinite(targetOffset) ? dlSweepPrice + targetOffset : NaN },
    { highLabel: 'PDH', highPrice: day.previousHigh[lastIndex], highSwept: pdhSwept, highTarget: Number.isFinite(pdhSweepPrice) && Number.isFinite(targetOffset) ? pdhSweepPrice - targetOffset : NaN, lowLabel: 'PDL', lowPrice: day.previousLow[lastIndex], lowSwept: pdlSwept, lowTarget: Number.isFinite(pdlSweepPrice) && Number.isFinite(targetOffset) ? pdlSweepPrice + targetOffset : NaN },
    { highLabel: 'WH', highPrice: week.currentHigh[lastIndex], highSwept: whSwept, highTarget: Number.isFinite(whSweepPrice) && Number.isFinite(targetOffset) ? whSweepPrice - targetOffset : NaN, lowLabel: 'WL', lowPrice: week.currentLow[lastIndex], lowSwept: wlSwept, lowTarget: Number.isFinite(wlSweepPrice) && Number.isFinite(targetOffset) ? wlSweepPrice + targetOffset : NaN },
    { highLabel: 'MH', highPrice: month.currentHigh[lastIndex], highSwept: mhSwept, highTarget: Number.isFinite(mhSweepPrice) && Number.isFinite(targetOffset) ? mhSweepPrice - targetOffset : NaN, lowLabel: 'ML', lowPrice: month.currentLow[lastIndex], lowSwept: mlSwept, lowTarget: Number.isFinite(mlSweepPrice) && Number.isFinite(targetOffset) ? mlSweepPrice + targetOffset : NaN },
    { highLabel: '52WH', highPrice: aligned52WeekHigh[lastIndex], highSwept: yhSwept, highTarget: Number.isFinite(yhSweepPrice) && Number.isFinite(targetOffset) ? yhSweepPrice - targetOffset : NaN, lowLabel: '52WL', lowPrice: aligned52WeekLow[lastIndex], lowSwept: ylSwept, lowTarget: Number.isFinite(ylSweepPrice) && Number.isFinite(targetOffset) ? ylSweepPrice + targetOffset : NaN },
  ];

  return {
    rows,
    close: intradayBars[lastIndex].close,
    nearPct: Math.max(0.001, nearPctInput) / 100,
    highlightNearLevels,
    atrDaily,
    targetAtrMult,
  };
}

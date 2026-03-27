/**
 * DailyIQ Script — Standard Library
 *
 * Two function tables:
 *   stdlib        — flat functions: sma(), ema(), crossover(), ... (backward compat)
 *   namespacedLib — namespaced functions: ta.rsi(), math.abs(), input.int(), ...
 *
 * Signature:
 *   (args: number[][], barCount: number, bars?: OHLCVBar[]) => number[]
 *
 * Convention: missing/not-yet-available values are NaN.
 */

import type { OHLCVBar } from '../types';

export type StdlibFunction = (
  args: number[][],
  barCount: number,
  bars?: OHLCVBar[],
) => number[];

// ─── Internal Helpers ─────────────────────────────────────────────────────

function fillNaN(len: number): number[] {
  return new Array(len).fill(NaN);
}

function toSeries(v: number[] | undefined, barCount: number): number[] {
  if (!v) return fillNaN(barCount);
  if (v.length === 1) return new Array(barCount).fill(v[0]);
  return v;
}

function scalar(v: number[] | undefined): number {
  return v?.[0] ?? NaN;
}

// ─── Moving Averages ──────────────────────────────────────────────────────

function sma(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round(scalar(args[1]) || 14);
  const out = fillNaN(barCount);
  for (let i = period - 1; i < barCount; i++) {
    let sum = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (isNaN(series[j])) { valid = false; break; }
      sum += series[j];
    }
    out[i] = valid ? sum / period : NaN;
  }
  return out;
}

function ema(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round(scalar(args[1]) || 14);
  const out = fillNaN(barCount);
  const k = 2 / (period + 1);
  let sum = 0;
  let seedReady = false;
  for (let i = 0; i < barCount; i++) {
    if (isNaN(series[i])) continue;
    if (!seedReady) {
      if (i < period - 1) { sum += series[i]; continue; }
      sum += series[i];
      out[i] = sum / period;
      seedReady = true;
    } else {
      out[i] = series[i] * k + out[i - 1] * (1 - k);
    }
  }
  return out;
}

/** Wilder's Running Moving Average (RMA / SMMA) */
function rma(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round(scalar(args[1]) || 14);
  const out = fillNaN(barCount);
  const alpha = 1 / period;
  // Seed with SMA of first `period` valid bars
  let seedSum = 0;
  let seedCount = 0;
  let seeded = false;
  for (let i = 0; i < barCount; i++) {
    if (isNaN(series[i])) continue;
    if (!seeded) {
      seedSum += series[i];
      seedCount++;
      if (seedCount === period) {
        out[i] = seedSum / period;
        seeded = true;
      }
    } else {
      out[i] = alpha * series[i] + (1 - alpha) * out[i - 1];
    }
  }
  return out;
}

// ─── RSI ──────────────────────────────────────────────────────────────────

function taRsi(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round(scalar(args[1]) || 14);
  const gains = new Array(barCount).fill(NaN);
  const losses = new Array(barCount).fill(NaN);
  for (let i = 1; i < barCount; i++) {
    if (!isNaN(series[i]) && !isNaN(series[i - 1])) {
      const diff = series[i] - series[i - 1];
      gains[i] = diff > 0 ? diff : 0;
      losses[i] = diff < 0 ? -diff : 0;
    }
  }
  const avgGain = rma([gains, [period]], barCount);
  const avgLoss = rma([losses, [period]], barCount);
  const out = fillNaN(barCount);
  for (let i = 0; i < barCount; i++) {
    if (!isNaN(avgGain[i]) && !isNaN(avgLoss[i])) {
      if (avgLoss[i] === 0) {
        out[i] = 100;
      } else {
        const rs = avgGain[i] / avgLoss[i];
        out[i] = 100 - 100 / (1 + rs);
      }
    }
  }
  return out;
}

// ─── ATR / True Range ─────────────────────────────────────────────────────

function taATR(args: number[][], barCount: number, bars?: OHLCVBar[]): number[] {
  const period = Math.round(scalar(args[0]) || 14);
  const tr = taTrFromBars(barCount, bars);
  return rma([[...tr], [period]], barCount);
}

function taTrFromBars(barCount: number, bars?: OHLCVBar[]): number[] {
  const tr = fillNaN(barCount);
  if (!bars) return tr;
  for (let i = 1; i < barCount; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  if (barCount > 0) {
    tr[0] = (bars?.[0]?.high ?? NaN) - (bars?.[0]?.low ?? NaN);
  }
  return tr;
}

function taTr(_args: number[][], barCount: number, bars?: OHLCVBar[]): number[] {
  return taTrFromBars(barCount, bars);
}

// ─── Stochastic ───────────────────────────────────────────────────────────

function taStoch(args: number[][], barCount: number, bars?: OHLCVBar[]): number[] {
  // ta.stoch(source, high, low, length) OR ta.stoch(length) using bars
  let src: number[];
  let hi: number[];
  let lo: number[];
  let period: number;

  if (args.length >= 4) {
    src = toSeries(args[0], barCount);
    hi = toSeries(args[1], barCount);
    lo = toSeries(args[2], barCount);
    period = Math.round(scalar(args[3]) || 14);
  } else {
    // Use bars OHLCV directly
    period = Math.round(scalar(args[0]) || 14);
    src = bars?.map(b => b.close) ?? fillNaN(barCount);
    hi = bars?.map(b => b.high) ?? fillNaN(barCount);
    lo = bars?.map(b => b.low) ?? fillNaN(barCount);
  }

  const out = fillNaN(barCount);
  for (let i = period - 1; i < barCount; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (!isNaN(hi[j]) && hi[j] > hh) hh = hi[j];
      if (!isNaN(lo[j]) && lo[j] < ll) ll = lo[j];
    }
    if (hh !== -Infinity && ll !== Infinity && hh !== ll) {
      out[i] = 100 * (src[i] - ll) / (hh - ll);
    }
  }
  return out;
}

// ─── Bollinger Bands ──────────────────────────────────────────────────────

function taBbBasis(args: number[][], barCount: number): number[] {
  return sma([args[0], args[1]], barCount);
}

function taBbUpper(args: number[][], barCount: number): number[] {
  const basis = sma([args[0], args[1]], barCount);
  const dev = stdev([args[0], args[1]], barCount);
  const mult = scalar(args[2]) || 2;
  return basis.map((b, i) => isNaN(b) || isNaN(dev[i]) ? NaN : b + mult * dev[i]);
}

function taBbLower(args: number[][], barCount: number): number[] {
  const basis = sma([args[0], args[1]], barCount);
  const dev = stdev([args[0], args[1]], barCount);
  const mult = scalar(args[2]) || 2;
  return basis.map((b, i) => isNaN(b) || isNaN(dev[i]) ? NaN : b - mult * dev[i]);
}

// ─── VWAP ─────────────────────────────────────────────────────────────────

function taVwap(_args: number[][], barCount: number, bars?: OHLCVBar[]): number[] {
  const out = fillNaN(barCount);
  if (!bars) return out;
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < barCount; i++) {
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumPV += tp * bars[i].volume;
    cumV += bars[i].volume;
    out[i] = cumV > 0 ? cumPV / cumV : NaN;
  }
  return out;
}

// ─── CCI ──────────────────────────────────────────────────────────────────

function taCCI(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round(scalar(args[1]) || 20);
  const out = fillNaN(barCount);
  for (let i = period - 1; i < barCount; i++) {
    let sum = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (isNaN(series[j])) { valid = false; break; }
      sum += series[j];
    }
    if (!valid) continue;
    const mean = sum / period;
    let madSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      madSum += Math.abs(series[j] - mean);
    }
    const mad = madSum / period;
    out[i] = mad === 0 ? 0 : (series[i] - mean) / (0.015 * mad);
  }
  return out;
}

// ─── Williams %R ──────────────────────────────────────────────────────────

function taWpr(args: number[][], barCount: number, bars?: OHLCVBar[]): number[] {
  const period = Math.round(scalar(args[0]) || 14);
  const hi = bars?.map(b => b.high) ?? fillNaN(barCount);
  const lo = bars?.map(b => b.low) ?? fillNaN(barCount);
  const cl = bars?.map(b => b.close) ?? fillNaN(barCount);
  const out = fillNaN(barCount);
  for (let i = period - 1; i < barCount; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (hi[j] > hh) hh = hi[j];
      if (lo[j] < ll) ll = lo[j];
    }
    if (hh !== ll) out[i] = -100 * (hh - cl[i]) / (hh - ll);
  }
  return out;
}

// ─── OBV ──────────────────────────────────────────────────────────────────

function taObv(_args: number[][], barCount: number, bars?: OHLCVBar[]): number[] {
  const out = fillNaN(barCount);
  if (!bars) return out;
  out[0] = 0;
  for (let i = 1; i < barCount; i++) {
    const diff = bars[i].close - bars[i - 1].close;
    const dir = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    out[i] = (out[i - 1] ?? 0) + dir * bars[i].volume;
  }
  return out;
}

// ─── MFI ──────────────────────────────────────────────────────────────────

function taMFI(args: number[][], barCount: number, bars?: OHLCVBar[]): number[] {
  const period = Math.round(scalar(args[0]) || 14);
  const out = fillNaN(barCount);
  if (!bars) return out;
  const tp = bars.map(b => (b.high + b.low + b.close) / 3);
  for (let i = period; i < barCount; i++) {
    let posFlow = 0;
    let negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const mf = tp[j] * bars[j].volume;
      if (tp[j] > tp[j - 1]) posFlow += mf;
      else negFlow += mf;
    }
    if (negFlow === 0) { out[i] = 100; continue; }
    const ratio = posFlow / negFlow;
    out[i] = 100 - 100 / (1 + ratio);
  }
  return out;
}

// ─── Chop Zone ────────────────────────────────────────────────────────────

function taChopZone(args: number[][], barCount: number, bars?: OHLCVBar[]): number[] {
  const period = Math.round(scalar(args[0]) || 30);
  const close = bars?.map(b => b.close) ?? fillNaN(barCount);
  const high = bars?.map(b => b.high) ?? fillNaN(barCount);
  const low = bars?.map(b => b.low) ?? fillNaN(barCount);
  const avg = bars?.map(b => (b.high + b.low + b.close) / 3) ?? fillNaN(barCount);
  const ema34 = ema([[...close], [34]], barCount);
  const out = fillNaN(barCount);
  for (let i = Math.max(period - 1, 34); i < barCount; i++) {
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (high[j] > highestHigh) highestHigh = high[j];
      if (low[j] < lowestLow) lowestLow = low[j];
    }
    const range = highestHigh - lowestLow;
    if (
      !Number.isFinite(highestHigh) ||
      !Number.isFinite(lowestLow) ||
      range === 0 ||
      avg[i] === 0 ||
      isNaN(ema34[i]) ||
      isNaN(ema34[i - 1])
    ) {
      continue;
    }
    const span = (25 / range) * lowestLow;
    const y2 = ((ema34[i - 1] - ema34[i]) / avg[i]) * span;
    const c = Math.sqrt(1 + y2 * y2);
    if (!Number.isFinite(c) || c === 0) continue;
    const angle1 = Math.round((180 * Math.acos(1 / c)) / Math.PI);
    out[i] = y2 > 0 ? -angle1 : angle1;
  }
  return out;
}

// ─── Supertrend (ta.supertrend returns direction signal -1/1) ─────────────

function taSupertrend(args: number[][], barCount: number, bars?: OHLCVBar[]): number[] {
  const factor = scalar(args[0]) || 3;
  const period = Math.round(scalar(args[1]) || 10);
  const atrVals = taATR([[period]], barCount, bars);
  const hl2 = bars?.map(b => (b.high + b.low) / 2) ?? fillNaN(barCount);
  const close = bars?.map(b => b.close) ?? fillNaN(barCount);

  const upperBasic = hl2.map((v, i) => isNaN(v) ? NaN : v + factor * (atrVals[i] ?? NaN));
  const lowerBasic = hl2.map((v, i) => isNaN(v) ? NaN : v - factor * (atrVals[i] ?? NaN));

  const upper = [...upperBasic];
  const lower = [...lowerBasic];
  const trend = new Array(barCount).fill(1);

  for (let i = 1; i < barCount; i++) {
    upper[i] = (upper[i] < upper[i - 1] || close[i - 1] > upper[i - 1])
      ? upper[i]
      : upper[i - 1];
    lower[i] = (lower[i] > lower[i - 1] || close[i - 1] < lower[i - 1])
      ? lower[i]
      : lower[i - 1];

    if (close[i] > upper[i - 1]) {
      trend[i] = 1;
    } else if (close[i] < lower[i - 1]) {
      trend[i] = -1;
    } else {
      trend[i] = trend[i - 1];
    }
  }
  return trend;
}

// ─── Pivot High / Low ─────────────────────────────────────────────────────

function taPivotHigh(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const left = Math.round(scalar(args[1]) || 5);
  const right = Math.round(scalar(args[2]) || 5);
  const out = fillNaN(barCount);
  for (let i = left; i < barCount - right; i++) {
    let isPivot = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j !== i && series[j] >= series[i]) { isPivot = false; break; }
    }
    if (isPivot) out[i] = series[i];
  }
  return out;
}

function taPivotLow(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const left = Math.round(scalar(args[1]) || 5);
  const right = Math.round(scalar(args[2]) || 5);
  const out = fillNaN(barCount);
  for (let i = left; i < barCount - right; i++) {
    let isPivot = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j !== i && series[j] <= series[i]) { isPivot = false; break; }
    }
    if (isPivot) out[i] = series[i];
  }
  return out;
}

// ─── Cross Detection ──────────────────────────────────────────────────────

function crossover(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  const b = toSeries(args[1], barCount);
  const out = fillNaN(barCount);
  out[0] = 0;
  for (let i = 1; i < barCount; i++) {
    if (isNaN(a[i]) || isNaN(b[i]) || isNaN(a[i - 1]) || isNaN(b[i - 1])) {
      out[i] = 0;
    } else {
      out[i] = a[i - 1] <= b[i - 1] && a[i] > b[i] ? 1 : 0;
    }
  }
  return out;
}

function crossunder(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  const b = toSeries(args[1], barCount);
  const out = fillNaN(barCount);
  out[0] = 0;
  for (let i = 1; i < barCount; i++) {
    if (isNaN(a[i]) || isNaN(b[i]) || isNaN(a[i - 1]) || isNaN(b[i - 1])) {
      out[i] = 0;
    } else {
      out[i] = a[i - 1] >= b[i - 1] && a[i] < b[i] ? 1 : 0;
    }
  }
  return out;
}

// ─── Rolling Window ───────────────────────────────────────────────────────

function highest(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round(scalar(args[1]) || 14);
  const out = fillNaN(barCount);
  for (let i = period - 1; i < barCount; i++) {
    let hi = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (!isNaN(series[j]) && series[j] > hi) hi = series[j];
    }
    out[i] = hi === -Infinity ? NaN : hi;
  }
  return out;
}

function lowest(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round(scalar(args[1]) || 14);
  const out = fillNaN(barCount);
  for (let i = period - 1; i < barCount; i++) {
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (!isNaN(series[j]) && series[j] < lo) lo = series[j];
    }
    out[i] = lo === Infinity ? NaN : lo;
  }
  return out;
}

function stdev(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round(scalar(args[1]) || 14);
  const out = fillNaN(barCount);
  for (let i = period - 1; i < barCount; i++) {
    let sum = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (isNaN(series[j])) { valid = false; break; }
      sum += series[j];
    }
    if (!valid) continue;
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sqSum += (series[j] - mean) ** 2;
    }
    out[i] = Math.sqrt(sqSum / period);
  }
  return out;
}

function rollingSum(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round(scalar(args[1]) || 14);
  const out = fillNaN(barCount);
  for (let i = period - 1; i < barCount; i++) {
    let s = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (isNaN(series[j])) { valid = false; break; }
      s += series[j];
    }
    out[i] = valid ? s : NaN;
  }
  return out;
}

// ─── Element-wise math ────────────────────────────────────────────────────

function elMax(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  const b = toSeries(args[1], barCount);
  return a.map((v, i) => (isNaN(v) || isNaN(b[i])) ? NaN : Math.max(v, b[i]));
}

function elMin(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  const b = toSeries(args[1], barCount);
  return a.map((v, i) => (isNaN(v) || isNaN(b[i])) ? NaN : Math.min(v, b[i]));
}

function absFunc(args: number[][], barCount: number): number[] {
  return toSeries(args[0], barCount).map(v => isNaN(v) ? NaN : Math.abs(v));
}

function sqrtFunc(args: number[][], barCount: number): number[] {
  return toSeries(args[0], barCount).map(v => isNaN(v) ? NaN : Math.sqrt(v));
}

function logFunc(args: number[][], barCount: number): number[] {
  return toSeries(args[0], barCount).map(v => (isNaN(v) || v <= 0) ? NaN : Math.log(v));
}

function powFunc(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  const b = toSeries(args[1], barCount);
  return a.map((v, i) => (isNaN(v) || isNaN(b[i])) ? NaN : Math.pow(v, b[i]));
}

function roundFunc(args: number[][], barCount: number): number[] {
  return toSeries(args[0], barCount).map(v => isNaN(v) ? NaN : Math.round(v));
}

function floorFunc(args: number[][], barCount: number): number[] {
  return toSeries(args[0], barCount).map(v => isNaN(v) ? NaN : Math.floor(v));
}

function ceilFunc(args: number[][], barCount: number): number[] {
  return toSeries(args[0], barCount).map(v => isNaN(v) ? NaN : Math.ceil(v));
}

// ─── NaN Utilities ────────────────────────────────────────────────────────

function nz(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const replacement = scalar(args[1]) ?? 0;
  return series.map(v => (isNaN(v) || v === undefined) ? replacement : v);
}

function naFunc(args: number[][], barCount: number): number[] {
  return toSeries(args[0], barCount).map(v => isNaN(v) ? 1 : 0);
}

function fixnan(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const out = [...series];
  let last = NaN;
  for (let i = 0; i < barCount; i++) {
    if (!isNaN(out[i])) last = out[i];
    else if (!isNaN(last)) out[i] = last;
  }
  return out;
}

// ─── input.* (return default value as scalar) ────────────────────────────

function inputInt(args: number[][]): number[] {
  return [scalar(args[0]) ?? 0];
}

function inputFloat(args: number[][]): number[] {
  return [scalar(args[0]) ?? 0];
}

function inputBool(args: number[][]): number[] {
  const v = scalar(args[0]);
  return [isNaN(v) ? 1 : v];
}

// ─── color.new ────────────────────────────────────────────────────────────

function colorNew(_args: number[][], _barCount: number): number[] {
  return [NaN]; // Color values are handled by the renderer, not numerically
}

// ─── Export: flat stdlib (backward compat) ────────────────────────────────

export const stdlib: Record<string, StdlibFunction> = {
  sma,
  ema,
  rma,
  crossover,
  crossunder,
  highest,
  lowest,
  stdev,
  sum: rollingSum,
  max: elMax,
  min: elMin,
  abs: absFunc,
  sqrt: sqrtFunc,
  log: logFunc,
  pow: powFunc,
  round: roundFunc,
  floor: floorFunc,
  ceil: ceilFunc,
  nz,
  na: naFunc,
  fixnan,
};

// ─── Export: namespaced stdlib ────────────────────────────────────────────

export const namespacedLib: Record<string, StdlibFunction> = {
  // ta.* — Technical Analysis
  'ta.sma': sma,
  'ta.ema': ema,
  'ta.rma': rma,
  'ta.rsi': taRsi,
  'ta.atr': taATR,
  'ta.tr': taTr,
  'ta.stoch': taStoch,
  'ta.cci': taCCI,
  'ta.wpr': taWpr,
  'ta.willy': taWpr,
  'ta.obv': taObv,
  'ta.mfi': taMFI,
  'ta.supertrend': taSupertrend,
  'ta.crossover': crossover,
  'ta.crossunder': crossunder,
  'ta.highest': highest,
  'ta.lowest': lowest,
  'ta.stdev': stdev,
  'ta.stdev_': stdev, // alias
  'ta.sum': rollingSum,
  'ta.bb.basis': taBbBasis,
  'ta.bb.upper': taBbUpper,
  'ta.bb.lower': taBbLower,
  'ta.chopzone': taChopZone,
  'ta.vwap': taVwap,
  'ta.pivothigh': taPivotHigh,
  'ta.pivotlow': taPivotLow,
  // math.*
  'math.abs': absFunc,
  'math.sqrt': sqrtFunc,
  'math.log': logFunc,
  'math.pow': powFunc,
  'math.round': roundFunc,
  'math.floor': floorFunc,
  'math.ceil': ceilFunc,
  'math.max': elMax,
  'math.min': elMin,
  // input.*
  'input.int': inputInt,
  'input.float': inputFloat,
  'input.bool': inputBool,
  'input.string': (_args) => [NaN],
  'input.source': (args, barCount) => toSeries(args[0], barCount),
  // color.*
  'color.new': colorNew,
};

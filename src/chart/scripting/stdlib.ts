/**
 * DailyIQ Script — Standard Library
 *
 * Every function receives an array of arguments (each is number[]) and
 * the total bar count.  It returns a number[] with one value per bar.
 *
 * Convention: missing / not-yet-available values are NaN.
 */

export type StdlibFunction = (
  args: number[][],
  barCount: number,
) => number[];

// ─── Helpers ──────────────────────────────────────────────────────────────

function fillNaN(len: number): number[] {
  return new Array(len).fill(NaN);
}

function toSeries(v: number[] | undefined, barCount: number): number[] {
  if (!v) return fillNaN(barCount);
  if (v.length === 1) {
    // Broadcast scalar
    return new Array(barCount).fill(v[0]);
  }
  return v;
}

// ─── SMA ──────────────────────────────────────────────────────────────────

function sma(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round((args[1]?.[0]) ?? 14);
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

// ─── EMA ──────────────────────────────────────────────────────────────────

function ema(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round((args[1]?.[0]) ?? 14);
  const out = fillNaN(barCount);
  const k = 2 / (period + 1);

  // Seed: SMA of first `period` bars
  let sum = 0;
  let seedReady = false;
  for (let i = 0; i < barCount; i++) {
    if (isNaN(series[i])) continue;
    if (!seedReady) {
      if (i < period - 1) {
        sum += series[i];
        continue;
      }
      sum += series[i];
      out[i] = sum / period;
      seedReady = true;
    } else {
      out[i] = series[i] * k + out[i - 1] * (1 - k);
    }
  }
  return out;
}

// ─── Crossover / Crossunder ───────────────────────────────────────────────

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

// ─── Highest / Lowest ─────────────────────────────────────────────────────

function highest(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round((args[1]?.[0]) ?? 14);
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
  const period = Math.round((args[1]?.[0]) ?? 14);
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

// ─── Stdev ────────────────────────────────────────────────────────────────

function stdev(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round((args[1]?.[0]) ?? 14);
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

// ─── Rolling Sum ──────────────────────────────────────────────────────────

function rollingSum(args: number[][], barCount: number): number[] {
  const series = toSeries(args[0], barCount);
  const period = Math.round((args[1]?.[0]) ?? 14);
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

// ─── Element-wise max / min ───────────────────────────────────────────────

function elMax(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  const b = toSeries(args[1], barCount);
  const out = new Array(barCount);
  for (let i = 0; i < barCount; i++) {
    if (isNaN(a[i]) || isNaN(b[i])) out[i] = NaN;
    else out[i] = a[i] > b[i] ? a[i] : b[i];
  }
  return out;
}

function elMin(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  const b = toSeries(args[1], barCount);
  const out = new Array(barCount);
  for (let i = 0; i < barCount; i++) {
    if (isNaN(a[i]) || isNaN(b[i])) out[i] = NaN;
    else out[i] = a[i] < b[i] ? a[i] : b[i];
  }
  return out;
}

// ─── Scalar math ──────────────────────────────────────────────────────────

function absFunc(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  return a.map((v) => (isNaN(v) ? NaN : Math.abs(v)));
}

function sqrtFunc(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  return a.map((v) => (isNaN(v) ? NaN : Math.sqrt(v)));
}

function logFunc(args: number[][], barCount: number): number[] {
  const a = toSeries(args[0], barCount);
  return a.map((v) => (isNaN(v) || v <= 0 ? NaN : Math.log(v)));
}

// ─── Export ───────────────────────────────────────────────────────────────

export const stdlib: Record<string, StdlibFunction> = {
  sma,
  ema,
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
};

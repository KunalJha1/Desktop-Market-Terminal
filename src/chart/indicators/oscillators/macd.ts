import type { OHLCVBar } from '../../types';

function emaArray(data: number[], period: number): number[] {
  const len = data.length;
  const result = new Array<number>(len).fill(NaN);
  const k = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < len; i++) {
    if (isNaN(data[i])) continue;
    if (i < period - 1) {
      sum += data[i];
    } else if (i === period - 1) {
      sum += data[i];
      result[i] = sum / period;
    } else {
      result[i] = data[i] * k + result[i - 1] * (1 - k);
    }
  }

  return result;
}

export function computeMACD(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const fast = params.fast ?? 12;
  const slow = params.slow ?? 26;
  const signalPeriod = params.signal ?? 9;
  const len = bars.length;

  const closes = bars.map(b => b.close);
  const fastEma = emaArray(closes, fast);
  const slowEma = emaArray(closes, slow);

  const macdLine = new Array<number>(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    if (!isNaN(fastEma[i]) && !isNaN(slowEma[i])) {
      macdLine[i] = fastEma[i] - slowEma[i];
    }
  }

  // Signal line is EMA of MACD line
  const signalLine = new Array<number>(len).fill(NaN);
  const k = 2 / (signalPeriod + 1);
  let count = 0;
  let sum = 0;
  let initialized = false;

  for (let i = 0; i < len; i++) {
    if (isNaN(macdLine[i])) continue;
    if (!initialized) {
      sum += macdLine[i];
      count++;
      if (count === signalPeriod) {
        signalLine[i] = sum / signalPeriod;
        initialized = true;
      }
    } else {
      signalLine[i] = macdLine[i] * k + signalLine[i - 1] * (1 - k);
    }
  }

  // Fix: carry forward signal for NaN gaps (shouldn't happen with contiguous data, but safe)
  // Histogram
  const histogram = new Array<number>(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    if (!isNaN(macdLine[i]) && !isNaN(signalLine[i])) {
      histogram[i] = macdLine[i] - signalLine[i];
    }
  }

  return [macdLine, signalLine, histogram];
}

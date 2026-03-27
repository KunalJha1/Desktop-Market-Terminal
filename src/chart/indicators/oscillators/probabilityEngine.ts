import type { OHLCVBar } from '../../types';
import { sma, ema, stdev, atr } from '../shared/ictSmc';

// Source param values:
// 0 = Trend Angle (EMA slope normalized by ATR, degrees)
// 1 = EMA5 - EMA20 (as % of close price)
// 2 = Close - EMA20 (as % of close price)
// 3 = RSI 14  (shifted: value - 50)
// 4 = BB Position ((close - basis) / (upper - lower) * 10)

function computeRSI(closes: number[], period: number): number[] {
  const n = closes.length;
  const result = new Array<number>(n).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period && i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  if (period < n) {
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }

  for (let i = period + 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }

  return result;
}

export function computeProbabilityEngine(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const n = bars.length;
  const source  = Math.max(0, Math.min(4, Math.round(params.source  ?? 0)));
  const buckets = Math.max(3, Math.min(50, Math.round(params.buckets ?? 9)));
  const alpha   = Math.max(0.01, Math.min(0.80, params.alpha   ?? 0.15));
  const minObs  = Math.max(1,  Math.round(params.minObs  ?? 30));
  const useBody = (params.useBody ?? 1) >= 1;

  const closes = bars.map(b => b.close);

  // ── Compute source series ──────────────────────────────────────────────────
  let areaValues: number[];
  let vmin: number;
  let vmax: number;

  if (source === 0) {
    // Trend Angle: EMA(21) slope normalised by ATR(10), expressed in degrees
    const emaLen = 21;
    const atrLen = 10;
    const lookback = 3;
    const emaSeries = ema(closes, emaLen);
    const atrSeries = atr(bars, atrLen);
    areaValues = new Array<number>(n).fill(NaN);
    for (let i = lookback; i < n; i++) {
      if (isNaN(emaSeries[i]) || isNaN(emaSeries[i - lookback]) || isNaN(atrSeries[i]) || atrSeries[i] === 0) continue;
      const slope = emaSeries[i] - emaSeries[i - lookback];
      areaValues[i] = Math.atan(slope / atrSeries[i]) * (180 / Math.PI);
    }
    vmin = -45; vmax = 45;

  } else if (source === 1) {
    // EMA5 - EMA20 expressed as % of close
    const ema5  = ema(closes, 5);
    const ema20 = ema(closes, 20);
    areaValues = new Array<number>(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (isNaN(ema5[i]) || isNaN(ema20[i]) || closes[i] === 0) continue;
      areaValues[i] = ((ema5[i] - ema20[i]) / closes[i]) * 100;
    }
    vmin = -5; vmax = 5;

  } else if (source === 2) {
    // Close - EMA20 expressed as % of close
    const ema20 = ema(closes, 20);
    areaValues = new Array<number>(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (isNaN(ema20[i]) || closes[i] === 0) continue;
      areaValues[i] = ((closes[i] - ema20[i]) / closes[i]) * 100;
    }
    vmin = -5; vmax = 5;

  } else if (source === 3) {
    // RSI(14) shifted to be centred at 0: value − 50
    const rsiSeries = computeRSI(closes, 14);
    areaValues = rsiSeries.map(v => (isNaN(v) ? NaN : v - 50));
    vmin = -50; vmax = 50;

  } else {
    // BB Position: (close − basis) / (upper − lower) × 10, clamped ±15
    const period = 20;
    const mult   = 2;
    const basis  = sma(closes, period);
    const sd     = stdev(closes, period);
    areaValues = new Array<number>(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (isNaN(basis[i]) || isNaN(sd[i])) continue;
      const upper = basis[i] + mult * sd[i];
      const lower = basis[i] - mult * sd[i];
      const range = upper - lower;
      areaValues[i] = range === 0 ? 0 : ((closes[i] - basis[i]) / range) * 10;
    }
    vmin = -15; vmax = 15;
  }

  // ── Bucket helper ──────────────────────────────────────────────────────────
  const getBucket = (v: number): number => {
    if (isNaN(v)) return -1;
    const clamped = Math.max(vmin, Math.min(v, vmax));
    const step = (vmax - vmin) / buckets;
    if (step === 0) return 0;
    const idx = Math.floor((clamped - vmin) / step);
    return Math.max(0, Math.min(buckets - 1, idx));
  };

  // ── Bull/Bear classification helpers ──────────────────────────────────────
  const isBullAt = (i: number): boolean =>
    useBody ? bars[i].close > bars[i].open
            : (i > 0 && bars[i].close > bars[i - 1].close);

  // ── EWMA state arrays ──────────────────────────────────────────────────────
  const p1State = new Array<number>(buckets).fill(NaN);
  const p3State = new Array<number>(buckets).fill(NaN);
  const n1State = new Array<number>(buckets).fill(0);
  const n3State = new Array<number>(buckets).fill(0);

  // ── Output arrays ──────────────────────────────────────────────────────────
  const out1    = new Array<number>(n).fill(NaN); // 1-candle bull prob  (0–100)
  const out3    = new Array<number>(n).fill(NaN); // 3-candle bull prob  (0–100)
  const outMid  = new Array<number>(n).fill(50);  // static 50-line reference

  // ── Incremental forward pass ───────────────────────────────────────────────
  for (let i = 1; i < n; i++) {

    // 1-candle update: area from bar i−1 predicts bar i direction
    const prev1 = areaValues[i - 1];
    if (!isNaN(prev1)) {
      const bkt = getBucket(prev1);
      if (bkt >= 0) {
        const x1 = isBullAt(i) ? 1.0 : 0.0;
        p1State[bkt] = isNaN(p1State[bkt]) ? x1 : alpha * x1 + (1 - alpha) * p1State[bkt];
        n1State[bkt]++;
      }
    }

    // 3-candle update: area from bar i−3 predicts majority direction of bars i−2, i−1, i
    if (i >= 3) {
      const prev3 = areaValues[i - 3];
      if (!isNaN(prev3)) {
        const bkt3 = getBucket(prev3);
        if (bkt3 >= 0) {
          const bullCount = (isBullAt(i) ? 1 : 0) + (isBullAt(i - 1) ? 1 : 0) + (isBullAt(i - 2) ? 1 : 0);
          const x3 = bullCount >= 2 ? 1.0 : 0.0;
          p3State[bkt3] = isNaN(p3State[bkt3]) ? x3 : alpha * x3 + (1 - alpha) * p3State[bkt3];
          n3State[bkt3]++;
        }
      }
    }

    // Readout for current bar using current area value
    const curArea = areaValues[i];
    if (!isNaN(curArea)) {
      const curBkt = getBucket(curArea);
      if (curBkt >= 0) {
        const p1  = p1State[curBkt];
        const p3  = p3State[curBkt];
        const o1  = n1State[curBkt];
        const o3  = n3State[curBkt];
        if (!isNaN(p1) && o1 >= minObs) out1[i] = p1 * 100;
        if (!isNaN(p3) && o3 >= minObs) out3[i] = p3 * 100;
      }
    }
  }

  return [out1, out3, outMid];
}

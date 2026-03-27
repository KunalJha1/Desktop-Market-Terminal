import type { OHLCVBar } from '../../types';
import { ema } from '../compute';

const CHOP_ZONE_BUCKETS = [
  { min: 5, max: Infinity },
  { min: 3.57, max: 5 },
  { min: 2.14, max: 3.57 },
  { min: 0.71, max: 2.14 },
  { min: -Infinity, max: -5 },
  { min: -5, max: -3.57 },
  { min: -3.57, max: -2.14 },
  { min: -2.14, max: -0.71 },
  { min: -0.71, max: 0.71 },
] as const;

function inBucket(angle: number, min: number, max: number): boolean {
  if (min === -Infinity) return angle <= max;
  if (max === Infinity) return angle >= min;
  return angle >= min && angle < max;
}

/** TradingView-style Chop Zone buckets using EMA34 slope angle over the selected lookback. */
export function computeChopZone(
  bars: OHLCVBar[],
  params: Record<string, number>,
): number[][] {
  const period = params.period ?? 30;
  const len = bars.length;
  const outputs = Array.from({ length: CHOP_ZONE_BUCKETS.length }, () =>
    new Array<number>(len).fill(NaN),
  );

  if (len < 34) return outputs;

  const close = bars.map((b) => b.close);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const avg = bars.map((b) => (b.high + b.low + b.close) / 3);
  const ema34 = ema(close, 34);

  for (let i = Math.max(period - 1, 34); i < len; i++) {
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
    const emaAngle = y2 > 0 ? -angle1 : angle1;
    const bucketIndex = CHOP_ZONE_BUCKETS.findIndex((bucket) =>
      inBucket(emaAngle, bucket.min, bucket.max),
    );

    if (bucketIndex >= 0) {
      outputs[bucketIndex][i] = 1;
    }
  }

  return outputs;
}

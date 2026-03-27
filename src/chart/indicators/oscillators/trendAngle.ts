import type { OHLCVBar } from '../../types';
import { atr, ema } from '../shared/ictSmc';

export function computeTrendAngle(bars: OHLCVBar[], params: Record<string, number>): number[][] {
  const emaLength = Math.max(1, Math.round(params.emaLength ?? 21));
  const atrLength = Math.max(1, Math.round(params.atrLength ?? 10));
  const lookback = Math.max(1, Math.round(params.lookback ?? 3));
  const threshold = params.threshold ?? 18;
  const rearmThreshold = Math.max(0, threshold * 0.5);
  const closes = bars.map((bar) => bar.close);
  const emaSeries = ema(closes, emaLength);
  const atrSeries = atr(bars, atrLength);
  const angle = new Array<number>(bars.length).fill(NaN);
  const longOk = new Array<number>(bars.length).fill(NaN);
  const strongDown = new Array<number>(bars.length).fill(NaN);
  let canTriggerLong = true;
  let canTriggerDown = true;

  for (let i = lookback; i < bars.length; i += 1) {
    if (Number.isNaN(emaSeries[i]) || Number.isNaN(emaSeries[i - lookback]) || Number.isNaN(atrSeries[i]) || atrSeries[i] === 0) continue;
    const slope = emaSeries[i] - emaSeries[i - lookback];
    angle[i] = Math.atan(slope / atrSeries[i]) * 180 / Math.PI;
    if (angle[i] <= rearmThreshold) canTriggerLong = true;
    if (angle[i] >= -rearmThreshold) canTriggerDown = true;

    if (canTriggerLong && angle[i] >= threshold) {
      longOk[i] = angle[i];
      canTriggerLong = false;
    }
    if (canTriggerDown && angle[i] <= -threshold) {
      strongDown[i] = angle[i];
      canTriggerDown = false;
    }
  }

  return [angle, longOk, strongDown];
}

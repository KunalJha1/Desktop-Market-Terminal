import type { OHLCVBar } from '../../types';
import { calculateVwapSeries } from '../shared/vwap';

export function computeVWAP(bars: OHLCVBar[], _params: Record<string, number>): number[][] {
  return [calculateVwapSeries(bars)];
}

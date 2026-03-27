import type { OHLCVBar } from '../types';

// --- Shared math helpers ---

/** Simple Moving Average over an array of numbers */
export function sma(data: number[], period: number): number[] {
  const len = data.length;
  const result = new Array<number>(len).fill(NaN);
  let sum = 0;

  for (let i = 0; i < len; i++) {
    sum += data[i];
    if (i < period - 1) continue;
    if (i >= period) sum -= data[i - period];
    result[i] = sum / period;
  }

  return result;
}

/** Exponential Moving Average over an array of numbers */
export function ema(data: number[], period: number): number[] {
  const len = data.length;
  const result = new Array<number>(len).fill(NaN);
  const k = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < len; i++) {
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

/** Population standard deviation over a rolling window */
export function stdev(data: number[], period: number): number[] {
  const len = data.length;
  const result = new Array<number>(len).fill(NaN);

  for (let i = period - 1; i < len; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    const mean = sum / period;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = data[j] - mean;
      sqSum += diff * diff;
    }
    result[i] = Math.sqrt(sqSum / period);
  }

  return result;
}

// --- Indicator imports ---

import { computeSMA } from './overlays/sma';
import { computeEMA } from './overlays/ema';
import { computeEMARibbon } from './overlays/emaRibbon';
import { computeBollinger } from './overlays/bollinger';
import { computeVWAP } from './overlays/vwap';
import { computeIchimoku } from './overlays/ichimoku';
import { computeParabolicSAR } from './overlays/parabolicSar';
import { computeEnvelope } from './overlays/envelope';
import { computeGoldenDeathCross, computeEMACrossover } from './overlays/crossoverStrategy';
import { computeRSIStrategy } from './overlays/rsiStrategy';
import { computeMACDCrossover } from './overlays/macdCrossoverStrategy';
import { computeEMA520Strategy } from './overlays/ema520Strategy';
import { computeDailyIQTechScoreStrategy } from './overlays/dailyIQTechScoreStrategy';
import { computeStructureBreaks } from './overlays/structureBreaks';
import { computeLiquidityLevelLines } from './overlays/liquidityLevels';
import { computeLiquiditySweeps } from './overlays/liquiditySweeps';
import { computeFVGMomentum } from './overlays/fvgMomentum';
import { computeGapZones } from './overlays/gapZones';
import { computeRSI } from './oscillators/rsi';
import { computeMACD } from './oscillators/macd';
import { computeStochastic } from './oscillators/stochastic';
import { computeATR } from './oscillators/atr';
import { computeCCI } from './oscillators/cci';
import { computeChopZone } from './oscillators/chopZone';
import { computeWilliamsR } from './oscillators/williamsR';
import { computeROC } from './oscillators/roc';
import { computeMFI } from './oscillators/mfi';
import { computeTechnicalScore } from './oscillators/technicalScore';
import { computeStochasticRsi } from './oscillators/stochasticRsi';
import { computeBullBearPower } from './oscillators/bullBearPower';
import { computeSupertrendSentiment } from './oscillators/supertrend';
import { computeLinearRegressionSentiment } from './oscillators/linearRegression';
import { computeMarketStructureSentiment } from './oscillators/marketStructure';
import { computeMarketSentiment } from './oscillators/marketSentiment';
import { computeTrendAngle } from './oscillators/trendAngle';
import { computeOBV } from './volume/obv';
import { computeVolume } from './volume/volume';
import { computeVolumeProfile } from './volume/volumeProfile';
import { computeMarketSentimentStrategy } from './overlays/marketSentimentStrategy';
import { computeADL } from './oscillators/adl';
import { computeADLCrossover } from './overlays/adlStrategy';

// --- Dispatch map ---

const computeFns: Record<string, (bars: OHLCVBar[], params: Record<string, number>) => number[][]> = {
  SMA: computeSMA,
  EMA: computeEMA,
  'EMA Ribbon 5/20/200': computeEMARibbon,
  'Bollinger Bands': computeBollinger,
  VWAP: computeVWAP,
  Ichimoku: computeIchimoku,
  'Parabolic SAR': computeParabolicSAR,
  Envelope: computeEnvelope,
  'RSI Strategy': computeRSIStrategy,
  'Golden/Death Cross': computeGoldenDeathCross,
  'EMA 9/14 Crossover': computeEMACrossover,
  'EMA 5/20 Crossover': computeEMA520Strategy,
  'DailyIQ Tech Score Signal': computeDailyIQTechScoreStrategy,
  'Structure Breaks': computeStructureBreaks,
  'Liquidity Levels': computeLiquidityLevelLines,
  'Liquidity Sweep Signal': computeLiquiditySweeps,
  'FVG Momentum': computeFVGMomentum,
  'Gap Zones': computeGapZones,
  RSI: computeRSI,
  MACD: computeMACD,
  Stochastic: computeStochastic,
  ATR: computeATR,
  CCI: computeCCI,
  'Chop Zone': computeChopZone,
  'Williams %R': computeWilliamsR,
  ROC: computeROC,
  MFI: computeMFI,
  'Technical Score': computeTechnicalScore,
  'Stochastic RSI': computeStochasticRsi,
  'Bull Bear Power': computeBullBearPower,
  Supertrend: computeSupertrendSentiment,
  'Linear Regression': computeLinearRegressionSentiment,
  'Market Structure': computeMarketStructureSentiment,
  'Market Sentiment': computeMarketSentiment,
  'MACD Crossover': computeMACDCrossover,
  'Market Sentiment Signal': computeMarketSentimentStrategy,
  'Trend Angle': computeTrendAngle,
  ADL: computeADL,
  'ADL Crossover': computeADLCrossover,
  Volume: computeVolume,
  OBV: computeOBV,
  'Volume Profile': computeVolumeProfile,
};

/**
 * Compute an indicator by name.
 * @param name - Indicator name matching a key in the registry
 * @param bars - OHLCV bar data
 * @param params - Parameter overrides (merged with defaults by caller)
 * @returns Array of number arrays, one per indicator output
 */
export function computeIndicator(
  name: string,
  bars: OHLCVBar[],
  params: Record<string, number>,
): number[][] {
  const fn = computeFns[name];
  if (!fn) {
    throw new Error(`Unknown indicator: "${name}"`);
  }
  return fn(bars, params);
}

/**
 * Recompute indicator outputs from changeOffset onward when prefix bars are unchanged.
 * Used for live tail merges. Falls back to full compute when prev is missing/misaligned
 * or the indicator does not support a cheap tail path.
 */
export function recomputeIndicatorTail(
  name: string,
  bars: OHLCVBar[],
  params: Record<string, number>,
  changeOffset: number,
  prev: number[][] | undefined,
): number[][] {
  const n = bars.length;
  if (
    changeOffset <= 0 ||
    changeOffset >= n ||
    !prev ||
    prev.length === 0 ||
    prev.some((row) => !row || row.length !== n)
  ) {
    return computeIndicator(name, bars, params);
  }

  if (name === 'Volume') {
    const next = prev.map((row) => row.slice());
    for (let i = changeOffset; i < n; i++) {
      next[0][i] = bars[i].volume;
    }
    return next;
  }

  if (name === 'SMA') {
    const period = Math.max(1, Math.floor(params.period ?? 20));
    const start = Math.max(0, changeOffset - period + 1);
    const sub = bars.slice(start);
    const fresh = computeSMA(sub, params)[0];
    const out = prev.map((row) => row.slice());
    for (let i = start; i < n; i++) {
      out[0][i] = fresh[i - start];
    }
    return out;
  }

  if (name === 'EMA') {
    const period = Math.max(1, Math.floor(params.period ?? 20));
    if (changeOffset <= period - 1) {
      return computeIndicator(name, bars, params);
    }
    const out = prev.map((row) => row.slice());
    const row = out[0].slice();
    const k = 2 / (period + 1);
    let emaVal = row[changeOffset - 1];
    if (!Number.isFinite(emaVal)) {
      return computeIndicator(name, bars, params);
    }
    for (let i = changeOffset; i < n; i++) {
      emaVal = bars[i].close * k + emaVal * (1 - k);
      row[i] = emaVal;
    }
    out[0] = row;
    return out;
  }

  return computeIndicator(name, bars, params);
}

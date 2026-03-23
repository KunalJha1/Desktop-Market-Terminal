import type { OHLCVBar } from '../../types';

interface MarketSentimentParams {
  rsiLength?: number;
  stochLength?: number;
  stochSmooth?: number;
  stochRsiLength?: number;
  stochRsiSmooth?: number;
  stochRsiRsiLength?: number;
  cciLength?: number;
  bbpLength?: number;
  maLength?: number;
  bbLength?: number;
  bbStdDev?: number;
  supertrendAtrLength?: number;
  supertrendFactor?: number;
  regressionLength?: number;
  marketStructureLength?: number;
  trendSmooth?: number;
}

export interface MarketSentimentResult {
  sentiment: number[];
  rsi: number[];
  stochastic: number[];
  stochasticRsi: number[];
  cci: number[];
  bullBearPower: number[];
  movingAverage: number[];
  vwap: number[];
  bollingerBands: number[];
  supertrend: number[];
  linearRegression: number[];
  marketStructure: number[];
}

const DEFAULTS = {
  rsiLength: 14,
  stochLength: 14,
  stochSmooth: 3,
  stochRsiLength: 14,
  stochRsiSmooth: 3,
  stochRsiRsiLength: 14,
  cciLength: 20,
  bbpLength: 13,
  maLength: 20,
  bbLength: 20,
  bbStdDev: 2,
  supertrendAtrLength: 10,
  supertrendFactor: 3,
  regressionLength: 25,
  marketStructureLength: 5,
  trendSmooth: 3,
} satisfies Required<MarketSentimentParams>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interpolate(
  value: number,
  valueHigh: number,
  valueLow: number,
  rangeHigh: number,
  rangeLow: number,
): number {
  if (valueHigh === valueLow) return (rangeHigh + rangeLow) / 2;
  return rangeLow + ((value - valueLow) * (rangeHigh - rangeLow)) / (valueHigh - valueLow);
}

function sma(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  let nanCount = 0;

  for (let i = 0; i < values.length; i += 1) {
    const curr = values[i];
    if (Number.isNaN(curr)) nanCount += 1;
    else sum += curr;

    if (i >= period) {
      const prev = values[i - period];
      if (Number.isNaN(prev)) nanCount -= 1;
      else sum -= prev;
    }

    if (i >= period - 1 && nanCount === 0) {
      result[i] = sum / period;
    }
  }

  return result;
}

function ema(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  const multiplier = 2 / (period + 1);
  let seedSum = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (Number.isNaN(value)) continue;

    if (i < period - 1) {
      seedSum += value;
      continue;
    }

    if (i === period - 1) {
      seedSum += value;
      result[i] = seedSum / period;
      continue;
    }

    if (Number.isNaN(result[i - 1])) continue;
    result[i] = (value * multiplier) + (result[i - 1] * (1 - multiplier));
  }

  return result;
}

function rollingMin(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let min = Infinity;
    let valid = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (Number.isNaN(values[j])) {
        valid = false;
        break;
      }
      min = Math.min(min, values[j]);
    }
    if (valid) result[i] = min;
  }
  return result;
}

function rollingMax(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let max = -Infinity;
    let valid = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (Number.isNaN(values[j])) {
        valid = false;
        break;
      }
      max = Math.max(max, values[j]);
    }
    if (valid) result[i] = max;
  }
  return result;
}

function rollingStd(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (Number.isNaN(values[j])) {
        valid = false;
        break;
      }
      sum += values[j];
    }
    if (!valid) continue;
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const diff = values[j] - mean;
      sqSum += diff * diff;
    }
    result[i] = Math.sqrt(sqSum / period);
  }
  return result;
}

function computeRsi(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (closes.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  return result;
}

function computeAtr(bars: OHLCVBar[], period: number): number[] {
  const tr = new Array<number>(bars.length).fill(NaN);
  const atr = new Array<number>(bars.length).fill(NaN);

  for (let i = 0; i < bars.length; i += 1) {
    if (i === 0) tr[i] = bars[i].high - bars[i].low;
    else {
      tr[i] = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      );
    }
  }

  if (bars.length < period) return atr;

  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += tr[i];
  atr[period - 1] = seed / period;

  for (let i = period; i < bars.length; i += 1) {
    atr[i] = ((atr[i - 1] * (period - 1)) + tr[i]) / period;
  }

  return atr;
}

function computeStochasticK(
  closes: number[],
  highs: number[],
  lows: number[],
  length: number,
  smooth: number,
): number[] {
  const lowest = rollingMin(lows, length);
  const highest = rollingMax(highs, length);
  const raw = new Array<number>(closes.length).fill(NaN);

  for (let i = 0; i < closes.length; i += 1) {
    if (Number.isNaN(lowest[i]) || Number.isNaN(highest[i])) continue;
    const range = highest[i] - lowest[i];
    raw[i] = range === 0 ? 50 : ((closes[i] - lowest[i]) / range) * 100;
  }

  return sma(raw, smooth);
}

function normalizeOscillator(value: number, kind: 'rsi' | 'stochastic' | 'cci' | 'bbp'): number {
  if (Number.isNaN(value)) return NaN;

  switch (kind) {
    case 'rsi':
    case 'stochastic':
      if (value > 80) return interpolate(value, 100, 80, 100, 75);
      if (value > 50) return interpolate(value, 80, 50, 75, 50);
      if (value > 20) return interpolate(value, 50, 20, 50, 25);
      return interpolate(clamp(value, 0, 20), 20, 0, 25, 0);
    case 'cci':
      if (value > 100) return value > 300 ? 100 : interpolate(value, 300, 100, 100, 75);
      if (value >= 0) return interpolate(value, 100, 0, 75, 50);
      if (value < -100) return value < -300 ? 0 : interpolate(value, -100, -300, 25, 0);
      return interpolate(value, 0, -100, 50, 25);
    case 'bbp':
      return clamp(value, 0, 100);
    default:
      return NaN;
  }
}

function normalizeTrendSignal(closes: number[], buy: boolean[], sell: boolean[], smooth: number): number[] {
  const state = new Array<number>(closes.length).fill(0);
  const ratio = new Array<number>(closes.length).fill(NaN);
  let max = NaN;
  let min = NaN;

  for (let i = 0; i < closes.length; i += 1) {
    const prevState = i > 0 ? state[i - 1] : 0;
    state[i] = buy[i] ? 1 : sell[i] ? -1 : prevState;

    if (i === 0 || state[i] > prevState) {
      max = closes[i];
    } else if (!Number.isNaN(max)) {
      max = Math.max(closes[i], max);
    }

    if (i === 0 || state[i] < prevState) {
      min = closes[i];
    } else if (!Number.isNaN(min)) {
      min = Math.min(closes[i], min);
    }

    const range = max - min;
    if (!Number.isNaN(range) && range !== 0) {
      ratio[i] = ((closes[i] - min) / range) * 100;
    } else if (state[i] > 0) {
      ratio[i] = 100;
    } else if (state[i] < 0) {
      ratio[i] = 0;
    } else {
      ratio[i] = 50;
    }
  }

  return sma(ratio, smooth).map((value) => (Number.isNaN(value) ? 50 : clamp(value, 0, 100)));
}

function computeCorrelation(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  const meanX = (period - 1) / 2;
  let denX = 0;
  for (let i = 0; i < period; i += 1) {
    const dx = i - meanX;
    denX += dx * dx;
  }

  for (let end = period - 1; end < values.length; end += 1) {
    let sumY = 0;
    let valid = true;
    for (let i = end - period + 1; i <= end; i += 1) {
      if (Number.isNaN(values[i])) {
        valid = false;
        break;
      }
      sumY += values[i];
    }
    if (!valid) continue;

    const meanY = sumY / period;
    let num = 0;
    let denY = 0;
    for (let i = 0; i < period; i += 1) {
      const y = values[end - period + 1 + i] - meanY;
      const x = i - meanX;
      num += x * y;
      denY += y * y;
    }
    const denom = Math.sqrt(denX * denY);
    result[end] = denom === 0 ? NaN : num / denom;
  }

  return result;
}

function computeSupertrendTrend(
  bars: OHLCVBar[],
  closes: number[],
  atrLength: number,
  factor: number,
  smooth: number,
): number[] {
  const atr = computeAtr(bars, atrLength);
  const upperBand = new Array<number>(bars.length).fill(NaN);
  const lowerBand = new Array<number>(bars.length).fill(NaN);
  const finalUpper = new Array<number>(bars.length).fill(NaN);
  const finalLower = new Array<number>(bars.length).fill(NaN);
  const trendLine = new Array<number>(bars.length).fill(NaN);
  const buy = new Array<boolean>(bars.length).fill(false);
  const sell = new Array<boolean>(bars.length).fill(false);

  let direction = 1;
  for (let i = 0; i < bars.length; i += 1) {
    if (Number.isNaN(atr[i])) continue;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    upperBand[i] = hl2 + (factor * atr[i]);
    lowerBand[i] = hl2 - (factor * atr[i]);

    if (i === 0 || Number.isNaN(finalUpper[i - 1])) {
      finalUpper[i] = upperBand[i];
      finalLower[i] = lowerBand[i];
      trendLine[i] = finalLower[i];
      buy[i] = true;
      direction = 1;
      continue;
    }

    finalUpper[i] = (upperBand[i] < finalUpper[i - 1] || closes[i - 1] > finalUpper[i - 1])
      ? upperBand[i]
      : finalUpper[i - 1];
    finalLower[i] = (lowerBand[i] > finalLower[i - 1] || closes[i - 1] < finalLower[i - 1])
      ? lowerBand[i]
      : finalLower[i - 1];

    const nextDirection = direction === 1
      ? (closes[i] < finalLower[i] ? -1 : 1)
      : (closes[i] > finalUpper[i] ? 1 : -1);

    if (nextDirection !== direction) {
      buy[i] = nextDirection === 1;
      sell[i] = nextDirection === -1;
    }

    direction = nextDirection;
    trendLine[i] = direction === 1 ? finalLower[i] : finalUpper[i];
  }

  return normalizeTrendSignal(closes, buy, sell, smooth);
}

function computeMarketStructureTrend(bars: OHLCVBar[], closes: number[], length: number, smooth: number): number[] {
  const pivotHigh = new Array<number>(bars.length).fill(NaN);
  const pivotLow = new Array<number>(bars.length).fill(NaN);
  const buy = new Array<boolean>(bars.length).fill(false);
  const sell = new Array<boolean>(bars.length).fill(false);

  let latestPivotHigh = NaN;
  let latestPivotLow = NaN;
  let pivotHighCrossed = false;
  let pivotLowCrossed = false;

  for (let i = length; i < bars.length - length; i += 1) {
    let isPivotHigh = true;
    let isPivotLow = true;

    for (let j = i - length; j <= i + length; j += 1) {
      if (bars[j].high > bars[i].high) isPivotHigh = false;
      if (bars[j].low < bars[i].low) isPivotLow = false;
      if (!isPivotHigh && !isPivotLow) break;
    }

    if (isPivotHigh) pivotHigh[i + length] = bars[i].high;
    if (isPivotLow) pivotLow[i + length] = bars[i].low;
  }

  for (let i = 0; i < bars.length; i += 1) {
    if (!Number.isNaN(pivotHigh[i])) {
      latestPivotHigh = pivotHigh[i];
      pivotHighCrossed = false;
    }
    if (!Number.isNaN(pivotLow[i])) {
      latestPivotLow = pivotLow[i];
      pivotLowCrossed = false;
    }

    if (!Number.isNaN(latestPivotHigh) && closes[i] > latestPivotHigh && !pivotHighCrossed) {
      buy[i] = true;
      pivotHighCrossed = true;
    }
    if (!Number.isNaN(latestPivotLow) && closes[i] < latestPivotLow && !pivotLowCrossed) {
      sell[i] = true;
      pivotLowCrossed = true;
    }
  }

  return normalizeTrendSignal(closes, buy, sell, smooth);
}

export function computeMarketSentimentComponents(
  bars: OHLCVBar[],
  params: MarketSentimentParams = {},
): MarketSentimentResult {
  const config = { ...DEFAULTS, ...params };
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const volumes = bars.map((bar) => bar.volume);
  const typicalPrice = bars.map((bar) => (bar.high + bar.low + bar.close) / 3);

  const rawRsi = computeRsi(closes, config.rsiLength);
  const rawRsiForStoch = computeRsi(closes, config.stochRsiRsiLength);
  const rsi = rawRsi.map((value) => normalizeOscillator(value, 'rsi'));

  const rawStochastic = computeStochasticK(closes, highs, lows, config.stochLength, config.stochSmooth);
  const stochastic = rawStochastic.map((value) => normalizeOscillator(value, 'stochastic'));

  const stochRsiRaw = computeStochasticK(
    rawRsiForStoch,
    rawRsiForStoch,
    rawRsiForStoch,
    config.stochRsiLength,
    config.stochRsiSmooth,
  );
  const stochasticRsi = stochRsiRaw.map((value) => normalizeOscillator(value, 'stochastic'));

  const tpSma = sma(typicalPrice, config.cciLength);
  const rawCci = new Array<number>(bars.length).fill(NaN);
  for (let i = config.cciLength - 1; i < bars.length; i += 1) {
    let devSum = 0;
    for (let j = i - config.cciLength + 1; j <= i; j += 1) {
      devSum += Math.abs(typicalPrice[j] - tpSma[i]);
    }
    const meanDev = devSum / config.cciLength;
    rawCci[i] = meanDev === 0 ? 0 : (typicalPrice[i] - tpSma[i]) / (0.015 * meanDev);
  }
  const cci = rawCci.map((value) => normalizeOscillator(value, 'cci'));

  const emaClose = ema(closes, config.bbpLength);
  const bbpSeries = highs.map((high, i) => high + lows[i] - (2 * emaClose[i]));
  const bbpBasis = sma(bbpSeries, 100);
  const bbpStd = rollingStd(bbpSeries, 100);
  const bullBearPower = new Array<number>(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i += 1) {
    const value = bbpSeries[i];
    const upper = Number.isNaN(bbpBasis[i]) || Number.isNaN(bbpStd[i]) ? NaN : bbpBasis[i] + (2 * bbpStd[i]);
    const lower = Number.isNaN(bbpBasis[i]) || Number.isNaN(bbpStd[i]) ? NaN : bbpBasis[i] - (2 * bbpStd[i]);
    if (Number.isNaN(value) || Number.isNaN(upper) || Number.isNaN(lower)) continue;
    if (value > upper) {
      bullBearPower[i] = value > (1.5 * upper) ? 100 : interpolate(value, 1.5 * upper, upper, 100, 75);
    } else if (value > 0) {
      bullBearPower[i] = interpolate(value, upper, 0, 75, 50);
    } else if (value < lower) {
      bullBearPower[i] = value < (1.5 * lower) ? 0 : interpolate(value, lower, 1.5 * lower, 25, 0);
    } else if (value < 0) {
      bullBearPower[i] = interpolate(value, 0, lower, 50, 25);
    } else {
      bullBearPower[i] = 50;
    }
  }

  const maBasis = sma(closes, config.maLength);
  const movingAverage = normalizeTrendSignal(
    closes,
    closes.map((close, i) => !Number.isNaN(maBasis[i]) && close > maBasis[i]),
    closes.map((close, i) => !Number.isNaN(maBasis[i]) && close < maBasis[i]),
    config.trendSmooth,
  );

  const vwapBasis = new Array<number>(bars.length).fill(NaN);
  let cumPV = 0;
  let cumVol = 0;
  for (let i = 0; i < bars.length; i += 1) {
    cumPV += typicalPrice[i] * volumes[i];
    cumVol += volumes[i];
    vwapBasis[i] = cumVol === 0 ? NaN : cumPV / cumVol;
  }
  const vwapStd = rollingStd(typicalPrice, config.bbLength);
  const vwap = normalizeTrendSignal(
    closes,
    closes.map((close, i) => !Number.isNaN(vwapBasis[i]) && !Number.isNaN(vwapStd[i]) && close > (vwapBasis[i] + (config.bbStdDev * vwapStd[i]))),
    closes.map((close, i) => !Number.isNaN(vwapBasis[i]) && !Number.isNaN(vwapStd[i]) && close < (vwapBasis[i] - (config.bbStdDev * vwapStd[i]))),
    config.trendSmooth,
  );

  const bbBasis = sma(closes, config.bbLength);
  const bbStd = rollingStd(closes, config.bbLength);
  const bollingerBands = normalizeTrendSignal(
    closes,
    closes.map((close, i) => !Number.isNaN(bbBasis[i]) && !Number.isNaN(bbStd[i]) && close > (bbBasis[i] + (config.bbStdDev * bbStd[i]))),
    closes.map((close, i) => !Number.isNaN(bbBasis[i]) && !Number.isNaN(bbStd[i]) && close < (bbBasis[i] - (config.bbStdDev * bbStd[i]))),
    config.trendSmooth,
  );

  const supertrend = computeSupertrendTrend(
    bars,
    closes,
    config.supertrendAtrLength,
    config.supertrendFactor,
    config.trendSmooth,
  );

  const correlation = computeCorrelation(closes, config.regressionLength);
  const linearRegression = correlation.map((value) => (Number.isNaN(value) ? 50 : clamp((50 * value) + 50, 0, 100)));

  const marketStructure = computeMarketStructureTrend(
    bars,
    closes,
    config.marketStructureLength,
    config.trendSmooth,
  );

  const sentiment = new Array<number>(bars.length).fill(50);
  for (let i = 0; i < bars.length; i += 1) {
    const parts = [
      rsi[i],
      stochastic[i],
      stochasticRsi[i],
      cci[i],
      bullBearPower[i],
      movingAverage[i],
      vwap[i],
      bollingerBands[i],
      supertrend[i],
      linearRegression[i],
      marketStructure[i],
    ].map((value) => (Number.isNaN(value) ? 50 : value));

    sentiment[i] = clamp(parts.reduce((sum, value) => sum + value, 0) / parts.length, 0, 100);
  }

  return {
    sentiment,
    rsi,
    stochastic,
    stochasticRsi,
    cci,
    bullBearPower,
    movingAverage,
    vwap,
    bollingerBands,
    supertrend,
    linearRegression,
    marketStructure,
  };
}

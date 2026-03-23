import type { OHLCVBar } from '../../types';

function sma(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

function rollingMin(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      min = Math.min(min, values[j]);
    }
    result[i] = min;
  }
  return result;
}

function rollingMax(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      max = Math.max(max, values[j]);
    }
    result[i] = max;
  }
  return result;
}

function rollingStd(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += values[j];
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const diff = values[j] - mean;
      sq += diff * diff;
    }
    result[i] = Math.sqrt(sq / period);
  }
  return result;
}

function computeRSIValues(closes: number[], period: number): number[] {
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
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

function computeATRValues(bars: OHLCVBar[], period: number): number[] {
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

function linearRegressionSlope(values: number[], endIndex: number, period: number): number {
  const start = endIndex - period + 1;
  const meanX = (period - 1) / 2;
  let sumY = 0;
  for (let i = 0; i < period; i += 1) sumY += values[start + i];
  const meanY = sumY / period;
  let num = 0;
  let den = 0;
  for (let i = 0; i < period; i += 1) {
    const dx = i - meanX;
    num += dx * (values[start + i] - meanY);
    den += dx * dx;
  }
  return den === 0 ? NaN : num / den;
}

function computeSupertrendSignals(bars: OHLCVBar[], atrLength: number, mult: number): number[] {
  const signals = new Array<number>(bars.length).fill(0);
  const atr = computeATRValues(bars, atrLength);
  const upperBand = new Array<number>(bars.length).fill(NaN);
  const lowerBand = new Array<number>(bars.length).fill(NaN);
  const finalUpper = new Array<number>(bars.length).fill(NaN);
  const finalLower = new Array<number>(bars.length).fill(NaN);
  const direction = new Array<number>(bars.length).fill(0);

  for (let i = 0; i < bars.length; i += 1) {
    if (Number.isNaN(atr[i])) continue;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    upperBand[i] = hl2 + mult * atr[i];
    lowerBand[i] = hl2 - mult * atr[i];
    if (i === 0 || Number.isNaN(finalUpper[i - 1])) {
      finalUpper[i] = upperBand[i];
      finalLower[i] = lowerBand[i];
      direction[i] = 1;
      signals[i] = 1;
      continue;
    }
    finalUpper[i] = (upperBand[i] < finalUpper[i - 1] || bars[i - 1].close > finalUpper[i - 1])
      ? upperBand[i]
      : finalUpper[i - 1];
    finalLower[i] = (lowerBand[i] > finalLower[i - 1] || bars[i - 1].close < finalLower[i - 1])
      ? lowerBand[i]
      : finalLower[i - 1];
    direction[i] = direction[i - 1] === 1
      ? (bars[i].close < finalLower[i] ? -1 : 1)
      : (bars[i].close > finalUpper[i] ? 1 : -1);
    signals[i] = direction[i];
  }

  return signals;
}

export function computeTechnicalScore(bars: OHLCVBar[], _params: Record<string, number>): number[][] {
  const len = bars.length;
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const volumes = bars.map((bar) => bar.volume);

  const score = new Array<number>(len).fill(50);
  const buySignals = new Array<number>(len).fill(NaN);
  const sellSignals = new Array<number>(len).fill(NaN);

  const rsi = computeRSIValues(closes, 14);
  const stochLow = rollingMin(lows, 14);
  const stochHigh = rollingMax(highs, 14);
  const rawK = new Array<number>(len).fill(NaN);
  for (let i = 13; i < len; i += 1) {
    const range = stochHigh[i] - stochLow[i];
    rawK[i] = range === 0 ? 50 : ((closes[i] - stochLow[i]) / range) * 100;
  }
  const stochK = sma(rawK, 3);

  const rsiLow = rollingMin(rsi, 14);
  const rsiHigh = rollingMax(rsi, 14);
  const stochRsiRaw = new Array<number>(len).fill(NaN);
  for (let i = 0; i < len; i += 1) {
    if (Number.isNaN(rsi[i]) || Number.isNaN(rsiLow[i]) || Number.isNaN(rsiHigh[i])) continue;
    const range = rsiHigh[i] - rsiLow[i];
    stochRsiRaw[i] = range === 0 ? 50 : ((rsi[i] - rsiLow[i]) / range) * 100;
  }
  const stochRsiK = sma(stochRsiRaw, 3);

  const typicalPrice = bars.map((bar) => (bar.high + bar.low + bar.close) / 3);
  const tpSma = sma(typicalPrice, 20);
  const cci = new Array<number>(len).fill(NaN);
  for (let i = 19; i < len; i += 1) {
    let devSum = 0;
    for (let j = i - 19; j <= i; j += 1) devSum += Math.abs(typicalPrice[j] - tpSma[i]);
    const meanDev = devSum / 20;
    cci[i] = meanDev === 0 ? 0 : (typicalPrice[i] - tpSma[i]) / (0.015 * meanDev);
  }

  const bbMid = sma(closes, 20);
  const bbStd = rollingStd(closes, 20);
  const bbUpper = new Array<number>(len).fill(NaN);
  const bbLower = new Array<number>(len).fill(NaN);
  const bbp = new Array<number>(len).fill(NaN);
  for (let i = 19; i < len; i += 1) {
    bbUpper[i] = bbMid[i] + 2 * bbStd[i];
    bbLower[i] = bbMid[i] - 2 * bbStd[i];
    const denom = bbUpper[i] - bbLower[i];
    bbp[i] = denom === 0 ? NaN : (closes[i] - bbLower[i]) / denom;
  }

  const ma20 = sma(closes, 20);
  const vwap = new Array<number>(len).fill(NaN);
  let cumPV = 0;
  let cumVol = 0;
  for (let i = 0; i < len; i += 1) {
    cumPV += typicalPrice[i] * volumes[i];
    cumVol += volumes[i];
    vwap[i] = cumVol === 0 ? NaN : cumPV / cumVol;
  }

  const supertrend = computeSupertrendSignals(bars, 10, 3);
  const regSlope = new Array<number>(len).fill(NaN);
  for (let i = 49; i < len; i += 1) regSlope[i] = linearRegressionSlope(closes, i, 50);
  const atr50 = computeATRValues(bars, 50);
  const ms = new Array<number>(len).fill(NaN);
  for (let i = 0; i < len; i += 1) {
    ms[i] = Number.isNaN(regSlope[i]) || Number.isNaN(atr50[i]) || atr50[i] === 0 ? NaN : regSlope[i] / atr50[i];
  }

  for (let i = 0; i < len; i += 1) {
    const signals = [
      !Number.isNaN(rsi[i]) ? (rsi[i] >= 55 ? 1 : rsi[i] <= 45 ? -1 : 0) : 0,
      !Number.isNaN(stochK[i]) ? (stochK[i] >= 60 ? 1 : stochK[i] <= 40 ? -1 : 0) : 0,
      !Number.isNaN(stochRsiK[i]) ? (stochRsiK[i] >= 60 ? 1 : stochRsiK[i] <= 40 ? -1 : 0) : 0,
      !Number.isNaN(cci[i]) ? (cci[i] >= 100 ? 1 : cci[i] <= -100 ? -1 : 0) : 0,
      !Number.isNaN(bbp[i]) ? (bbp[i] >= 0.6 ? 1 : bbp[i] <= 0.4 ? -1 : 0) : 0,
      !Number.isNaN(ma20[i]) ? (closes[i] > ma20[i] ? 1 : -1) : 0,
      !Number.isNaN(vwap[i]) ? (closes[i] > vwap[i] ? 1 : -1) : 0,
      !Number.isNaN(bbUpper[i]) && !Number.isNaN(bbLower[i])
        ? (closes[i] > bbUpper[i] ? 1 : closes[i] < bbLower[i] ? -1 : 0)
        : 0,
      supertrend[i],
      !Number.isNaN(regSlope[i]) ? (regSlope[i] > 0 ? 1 : -1) : 0,
      !Number.isNaN(ms[i]) ? (ms[i] > 0 ? 1 : -1) : 0,
    ];
    const avg = signals.reduce((sum, value) => sum + value, 0) / signals.length;
    score[i] = Math.max(0, Math.min(100, Math.round(50 + 50 * avg)));
    if (i > 0 && !Number.isNaN(score[i - 1])) {
      if (score[i - 1] <= 50 && score[i] > 50) {
        buySignals[i] = 50;
      } else if (score[i - 1] >= 50 && score[i] < 50) {
        sellSignals[i] = 50;
      }
    }
  }

  return [score, buySignals, sellSignals];
}

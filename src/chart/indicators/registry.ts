import type { IndicatorMeta } from '../types';
import { INDICATOR_COLORS } from '../constants';

const C = INDICATOR_COLORS;

export const indicatorRegistry: Record<string, IndicatorMeta> = {
  SMA: {
    name: 'Simple Moving Average',
    shortName: 'SMA',
    category: 'overlay',
    defaultParams: { period: 20 },
    paramLabels: { period: 'Period' },
    outputs: [
      { key: 'sma', label: 'SMA', color: C[0], style: 'line', lineWidth: 1.5 },
    ],
  },

  EMA: {
    name: 'Exponential Moving Average',
    shortName: 'EMA',
    category: 'overlay',
    defaultParams: { period: 20 },
    paramLabels: { period: 'Period' },
    outputs: [
      { key: 'ema', label: 'EMA', color: C[1], style: 'line', lineWidth: 1.5 },
    ],
  },

  'EMA Ribbon 5/20/200': {
    name: 'EMA Ribbon 5 / 20 / 200',
    shortName: 'EMA Ribbon',
    category: 'overlay',
    defaultParams: { fastPeriod: 5, midPeriod: 20, slowPeriod: 200 },
    paramLabels: { fastPeriod: 'EMA 5', midPeriod: 'EMA 20', slowPeriod: 'EMA 200' },
    outputs: [
      { key: 'fast', label: 'EMA 5', color: C[3], style: 'line', lineWidth: 1.5 },
      { key: 'mid', label: 'EMA 20', color: C[4], style: 'line', lineWidth: 1.5 },
      { key: 'slow', label: 'EMA 200', color: C[6], style: 'line', lineWidth: 1.5 },
    ],
  },

  'Bollinger Bands': {
    name: 'Bollinger Bands',
    shortName: 'BB',
    category: 'overlay',
    defaultParams: { period: 20, stdDev: 2 },
    paramLabels: { period: 'Period', stdDev: 'Std Dev' },
    outputs: [
      { key: 'middle', label: 'Middle', color: C[0], style: 'line', lineWidth: 1 },
      { key: 'upper', label: 'Upper', color: C[4], style: 'line', lineWidth: 1 },
      { key: 'lower', label: 'Lower', color: C[3], style: 'line', lineWidth: 1 },
    ],
  },

  VWAP: {
    name: 'Volume Weighted Average Price',
    shortName: 'VWAP',
    category: 'overlay',
    defaultParams: {},
    paramLabels: {},
    outputs: [
      { key: 'vwap', label: 'VWAP', color: C[4], style: 'line', lineWidth: 1.5 },
    ],
  },

  Ichimoku: {
    name: 'Ichimoku Cloud',
    shortName: 'Ichimoku',
    category: 'overlay',
    defaultParams: { tenkan: 9, kijun: 26, senkou: 52 },
    paramLabels: { tenkan: 'Tenkan', kijun: 'Kijun', senkou: 'Senkou B' },
    outputs: [
      { key: 'tenkan', label: 'Tenkan-sen', color: C[0], style: 'line', lineWidth: 1 },
      { key: 'kijun', label: 'Kijun-sen', color: C[4], style: 'line', lineWidth: 1 },
      { key: 'senkouA', label: 'Senkou A', color: C[3], style: 'line', lineWidth: 1 },
      { key: 'senkouB', label: 'Senkou B', color: C[1], style: 'line', lineWidth: 1 },
      { key: 'chikou', label: 'Chikou', color: C[5], style: 'line', lineWidth: 1 },
    ],
  },

  'Parabolic SAR': {
    name: 'Parabolic SAR',
    shortName: 'PSAR',
    category: 'overlay',
    defaultParams: { step: 0.02, max: 0.2 },
    paramLabels: { step: 'Step', max: 'Max' },
    outputs: [
      { key: 'sar', label: 'SAR', color: C[5], style: 'dots', lineWidth: 2 },
    ],
  },

  Envelope: {
    name: 'Envelope',
    shortName: 'ENV',
    category: 'overlay',
    defaultParams: { period: 20, percent: 2.5 },
    paramLabels: { period: 'Period', percent: 'Percent' },
    outputs: [
      { key: 'middle', label: 'Middle', color: C[0], style: 'line', lineWidth: 1 },
      { key: 'upper', label: 'Upper', color: C[3], style: 'line', lineWidth: 1 },
      { key: 'lower', label: 'Lower', color: C[4], style: 'line', lineWidth: 1 },
    ],
  },

  'Golden/Death Cross': {
    name: 'Golden / Death Cross',
    shortName: 'GDX',
    category: 'overlay',
    defaultParams: { fastPeriod: 50, slowPeriod: 200 },
    paramLabels: { fastPeriod: 'Fast SMA', slowPeriod: 'Slow SMA' },
    outputs: [
      { key: 'fast', label: 'Fast SMA', color: C[0], style: 'line', lineWidth: 1.5 },
      { key: 'slow', label: 'Slow SMA', color: C[6], style: 'line', lineWidth: 1.5 },
      { key: 'buy', label: 'BUY', color: C[3], style: 'markers' },
      { key: 'sell', label: 'SELL', color: C[4], style: 'markers' },
    ],
  },

  'EMA 9/14 Crossover': {
    name: 'EMA 9 / 14 Crossover',
    shortName: 'EMA X',
    category: 'overlay',
    defaultParams: { fastPeriod: 9, slowPeriod: 14 },
    paramLabels: { fastPeriod: 'Fast EMA', slowPeriod: 'Slow EMA' },
    outputs: [
      { key: 'fast', label: 'Fast EMA', color: C[1], style: 'line', lineWidth: 1.5 },
      { key: 'slow', label: 'Slow EMA', color: C[5], style: 'line', lineWidth: 1.5 },
      { key: 'buy', label: 'BUY', color: C[3], style: 'markers' },
      { key: 'sell', label: 'SELL', color: C[4], style: 'markers' },
    ],
  },

  'EMA 5/20 Crossover': {
    name: 'EMA 5 / 20 Crossover',
    shortName: 'EMA 5/20',
    category: 'overlay',
    defaultParams: { fastPeriod: 5, slowPeriod: 20 },
    paramLabels: { fastPeriod: 'Fast EMA', slowPeriod: 'Slow EMA' },
    outputs: [
      { key: 'fast', label: 'EMA 5', color: C[3], style: 'line', lineWidth: 1.5 },
      { key: 'slow', label: 'EMA 20', color: C[4], style: 'line', lineWidth: 1.5 },
      { key: 'buy', label: 'BUY', color: C[3], style: 'markers' },
      { key: 'sell', label: 'SELL', color: C[4], style: 'markers' },
    ],
  },

  'DailyIQ Tech Score Signal': {
    name: 'BUY / SELL DailyIQ Tech Score',
    shortName: 'DIQ Sig',
    category: 'overlay',
    defaultParams: { showScorePane: 1 },
    paramLabels: { showScorePane: 'Score Pane' },
    outputs: [
      { key: 'buy', label: 'BUY', color: C[3], style: 'markers' },
      { key: 'sell', label: 'SELL', color: C[4], style: 'markers' },
    ],
  },

  'Structure Breaks': {
    name: 'Structure Breaks',
    shortName: 'BOS/CHoCH',
    category: 'overlay',
    defaultParams: { pivotLength: 5, requireCloseBreak: 1 },
    paramLabels: { pivotLength: 'Pivot Length', requireCloseBreak: 'Close Break 1/0' },
    outputs: [
      { key: 'bull', label: 'BULL', color: C[3], style: 'markers' },
      { key: 'bear', label: 'BEAR', color: C[4], style: 'markers' },
    ],
  },

  'Liquidity Levels': {
    name: 'Liquidity Levels',
    shortName: 'Liq Lvls',
    category: 'overlay',
    defaultParams: {},
    paramLabels: {},
    outputs: [
      { key: 'todayHigh', label: 'DH', color: C[5], style: 'line', lineWidth: 1 },
      { key: 'todayLow', label: 'DL', color: C[5], style: 'line', lineWidth: 1 },
      { key: 'prevDayHigh', label: 'PDH', color: C[0], style: 'line', lineWidth: 1 },
      { key: 'prevDayLow', label: 'PDL', color: C[0], style: 'line', lineWidth: 1 },
      { key: 'prevWeekHigh', label: 'PWH', color: C[2], style: 'line', lineWidth: 1 },
      { key: 'prevWeekLow', label: 'PWL', color: C[2], style: 'line', lineWidth: 1 },
      { key: 'prevMonthHigh', label: 'PMH', color: C[6], style: 'line', lineWidth: 1 },
      { key: 'prevMonthLow', label: 'PML', color: C[6], style: 'line', lineWidth: 1 },
    ],
  },

  'Liquidity Sweep Signal': {
    name: 'Liquidity Sweep Signal',
    shortName: 'Liq Sweep',
    category: 'overlay',
    defaultParams: { requireCloseConfirm: 1, externalOnly: 1, padTicks: 0 },
    paramLabels: { requireCloseConfirm: 'Close Confirm 1/0', externalOnly: 'External Only 1/0', padTicks: 'Pad Ticks' },
    outputs: [
      { key: 'buy', label: 'BUY', color: C[5], style: 'markers' },
      { key: 'sell', label: 'SELL', color: C[7], style: 'markers' },
    ],
  },

  'FVG Momentum': {
    name: 'FVG Momentum',
    shortName: 'FVG',
    category: 'overlay',
    defaultParams: { thresholdPercent: 0 },
    paramLabels: { thresholdPercent: 'Gap Threshold %' },
    outputs: [
      { key: 'bullTop', label: 'Bull FVG Top', color: C[3], style: 'line', lineWidth: 1 },
      { key: 'bullBottom', label: 'Bull FVG Bot', color: C[3], style: 'line', lineWidth: 1 },
      { key: 'bearTop', label: 'Bear FVG Top', color: C[4], style: 'line', lineWidth: 1 },
      { key: 'bearBottom', label: 'Bear FVG Bot', color: C[4], style: 'line', lineWidth: 1 },
      { key: 'bull', label: 'BUY', color: C[3], style: 'markers' },
      { key: 'bear', label: 'SELL', color: C[4], style: 'markers' },
    ],
  },

  'Gap Zones': {
    name: 'Gap Zones',
    shortName: 'Gaps',
    category: 'overlay',
    defaultParams: {},
    paramLabels: {},
    outputs: [
      { key: 'bullTop', label: 'Gap Up Top', color: '#00C853', style: 'fill', lineWidth: 1 },
      { key: 'bullBottom', label: 'Gap Up Bottom', color: '#00C853', style: 'line', lineWidth: 1.25 },
      { key: 'bearTop', label: 'Gap Down Top', color: '#FF3D71', style: 'fill', lineWidth: 1 },
      { key: 'bearBottom', label: 'Gap Down Bottom', color: '#FF3D71', style: 'line', lineWidth: 1.25 },
      { key: 'gapUp', label: 'GAP UP', color: '#00C853', style: 'markers' },
      { key: 'gapDown', label: 'GAP DOWN', color: '#FF3D71', style: 'markers' },
    ],
  },

  'Market Sentiment Signal': {
    name: 'BUY / SELL Market Sentiment',
    shortName: 'MS Sig',
    category: 'overlay',
    defaultParams: {},
    paramLabels: {},
    outputs: [
      { key: 'buy', label: 'BUY', color: C[3], style: 'markers' },
      { key: 'sell', label: 'SELL', color: C[4], style: 'markers' },
    ],
  },

  RSI: {
    name: 'Relative Strength Index',
    shortName: 'RSI',
    category: 'oscillator',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
    guideLines: [
      { value: 70, color: '#FF3D71', style: 'dashed' },
      { value: 30, color: '#00C853', style: 'dashed' },
    ],
    outputs: [
      { key: 'rsi', label: 'RSI', color: C[2], style: 'line', lineWidth: 1.5 },
    ],
  },

  MACD: {
    name: 'Moving Average Convergence Divergence',
    shortName: 'MACD',
    category: 'oscillator',
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    paramLabels: { fast: 'Fast', slow: 'Slow', signal: 'Signal' },
    outputs: [
      { key: 'macd', label: 'MACD', color: C[0], style: 'line', lineWidth: 1.5 },
      { key: 'signal', label: 'Signal', color: C[6], style: 'line', lineWidth: 1.5 },
      { key: 'histogram', label: 'Histogram', color: C[3], style: 'histogram', lineWidth: 1 },
    ],
  },

  Stochastic: {
    name: 'Stochastic Oscillator',
    shortName: 'Stoch',
    category: 'oscillator',
    defaultParams: { kPeriod: 14, dPeriod: 3, smooth: 3 },
    paramLabels: { kPeriod: '%K Period', dPeriod: '%D Period', smooth: 'Smooth' },
    outputs: [
      { key: 'k', label: '%K', color: C[0], style: 'line', lineWidth: 1.5 },
      { key: 'd', label: '%D', color: C[6], style: 'line', lineWidth: 1.5 },
    ],
  },

  ATR: {
    name: 'Average True Range',
    shortName: 'ATR',
    category: 'oscillator',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
    outputs: [
      { key: 'atr', label: 'ATR', color: C[5], style: 'line', lineWidth: 1.5 },
    ],
  },

  CCI: {
    name: 'Commodity Channel Index',
    shortName: 'CCI',
    category: 'oscillator',
    defaultParams: { period: 20 },
    paramLabels: { period: 'Period' },
    outputs: [
      { key: 'cci', label: 'CCI', color: C[2], style: 'line', lineWidth: 1.5 },
    ],
  },

  'Williams %R': {
    name: 'Williams %R',
    shortName: 'W%R',
    category: 'oscillator',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
    outputs: [
      { key: 'wr', label: '%R', color: C[7], style: 'line', lineWidth: 1.5 },
    ],
  },

  ROC: {
    name: 'Rate of Change',
    shortName: 'ROC',
    category: 'oscillator',
    defaultParams: { period: 12 },
    paramLabels: { period: 'Period' },
    outputs: [
      { key: 'roc', label: 'ROC', color: C[6], style: 'line', lineWidth: 1.5 },
    ],
  },

  MFI: {
    name: 'Money Flow Index',
    shortName: 'MFI',
    category: 'oscillator',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
    outputs: [
      { key: 'mfi', label: 'MFI', color: C[1], style: 'line', lineWidth: 1.5 },
    ],
  },

  'Stochastic RSI': {
    name: 'Stochastic RSI',
    shortName: 'Stoch RSI',
    category: 'oscillator',
    defaultParams: { stochLength: 14, smooth: 3, rsiPeriod: 14 },
    paramLabels: { stochLength: 'Stoch Length', smooth: 'Smooth', rsiPeriod: 'RSI Length' },
    guideLines: [
      { value: 75, color: '#FF3D71', style: 'dashed' },
      { value: 50, color: '#8B949E', style: 'dashed' },
      { value: 25, color: '#00C853', style: 'dashed' },
    ],
    outputs: [
      { key: 'stochRsi', label: 'Stoch RSI', color: C[6], style: 'line', lineWidth: 1.5 },
    ],
  },

  'Bull Bear Power': {
    name: 'Bull Bear Power',
    shortName: 'BBP',
    category: 'oscillator',
    defaultParams: { period: 13 },
    paramLabels: { period: 'EMA Length' },
    guideLines: [
      { value: 75, color: '#FF3D71', style: 'dashed' },
      { value: 50, color: '#8B949E', style: 'dashed' },
      { value: 25, color: '#00C853', style: 'dashed' },
    ],
    outputs: [
      { key: 'bbp', label: 'BBP', color: C[5], style: 'line', lineWidth: 1.5 },
    ],
  },

  Supertrend: {
    name: 'Supertrend',
    shortName: 'Supertrend',
    category: 'oscillator',
    defaultParams: { atrPeriod: 10, factor: 3, smooth: 3 },
    paramLabels: { atrPeriod: 'ATR Length', factor: 'Factor', smooth: 'Smooth' },
    guideLines: [
      { value: 75, color: '#00C853', style: 'dashed' },
      { value: 50, color: '#8B949E', style: 'dashed' },
      { value: 25, color: '#FF3D71', style: 'dashed' },
    ],
    outputs: [
      { key: 'supertrend', label: 'Supertrend', color: C[3], style: 'line', lineWidth: 1.5 },
    ],
  },

  'Linear Regression': {
    name: 'Linear Regression',
    shortName: 'LinReg',
    category: 'oscillator',
    defaultParams: { period: 25 },
    paramLabels: { period: 'Length' },
    guideLines: [
      { value: 75, color: '#00C853', style: 'dashed' },
      { value: 50, color: '#8B949E', style: 'dashed' },
      { value: 25, color: '#FF3D71', style: 'dashed' },
    ],
    outputs: [
      { key: 'linearRegression', label: 'LinReg', color: C[7], style: 'line', lineWidth: 1.5 },
    ],
  },

  'Market Structure': {
    name: 'Market Structure',
    shortName: 'MS',
    category: 'oscillator',
    defaultParams: { period: 5, smooth: 3 },
    paramLabels: { period: 'Pivot Length', smooth: 'Smooth' },
    guideLines: [
      { value: 75, color: '#00C853', style: 'dashed' },
      { value: 50, color: '#8B949E', style: 'dashed' },
      { value: 25, color: '#FF3D71', style: 'dashed' },
    ],
    outputs: [
      { key: 'marketStructure', label: 'Market Structure', color: C[4], style: 'line', lineWidth: 1.5 },
    ],
  },

  'Market Sentiment': {
    name: 'Market Sentiment',
    shortName: 'Sentiment',
    category: 'oscillator',
    defaultParams: {},
    paramLabels: {},
    guideLines: [
      { value: 75, color: '#00C853', style: 'dashed' },
      { value: 50, color: '#8B949E', style: 'dashed' },
      { value: 25, color: '#FF3D71', style: 'dashed' },
    ],
    outputs: [
      { key: 'sentiment', label: 'Sentiment', color: C[0], style: 'line', lineWidth: 1.5 },
      { key: 'buy', label: 'BUY', color: C[3], style: 'markers' },
      { key: 'sell', label: 'SELL', color: C[4], style: 'markers' },
    ],
  },

  'Trend Angle': {
    name: 'Trend Angle',
    shortName: 'Angle',
    category: 'oscillator',
    defaultParams: { emaLength: 21, atrLength: 10, lookback: 3, threshold: 18 },
    paramLabels: { emaLength: 'EMA Length', atrLength: 'ATR Length', lookback: 'Lookback', threshold: 'Threshold' },
    guideLines: [
      { value: 18, color: '#00C853', style: 'dashed' },
      { value: 0, color: '#8B949E', style: 'dashed' },
      { value: -18, color: '#FF3D71', style: 'dashed' },
    ],
    outputs: [
      { key: 'angle', label: 'Angle', color: C[1], style: 'line', lineWidth: 1.5 },
      { key: 'longOk', label: 'LONG', color: C[3], style: 'markers' },
      { key: 'strongDown', label: 'DOWN', color: C[4], style: 'markers' },
    ],
  },

  'Technical Score': {
    name: 'DailyIQ Technical Score',
    shortName: 'DIQ Score',
    category: 'oscillator',
    defaultParams: {},
    paramLabels: {},
    outputs: [
      { key: 'score', label: 'Score', color: C[0], style: 'line', lineWidth: 1.5 },
      { key: 'buy', label: 'BUY', color: C[3], style: 'markers' },
      { key: 'sell', label: 'SELL', color: C[4], style: 'markers' },
    ],
  },

  OBV: {
    name: 'On Balance Volume',
    shortName: 'OBV',
    category: 'volume',
    defaultParams: {},
    paramLabels: {},
    outputs: [
      { key: 'obv', label: 'OBV', color: C[5], style: 'line', lineWidth: 1.5 },
    ],
  },

  'Volume Profile': {
    name: 'Volume Profile',
    shortName: 'VP',
    category: 'volume',
    defaultParams: { bins: 24 },
    paramLabels: { bins: 'Bins' },
    outputs: [
      { key: 'prices', label: 'Price Levels', color: C[0], style: 'histogram' },
      { key: 'volumes', label: 'Volume', color: C[5], style: 'histogram' },
    ],
  },
};

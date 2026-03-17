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

  RSI: {
    name: 'Relative Strength Index',
    shortName: 'RSI',
    category: 'oscillator',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
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

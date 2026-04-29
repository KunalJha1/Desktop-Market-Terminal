import type { IndicatorMeta } from '../types';
import { INDICATOR_COLORS } from '../constants';

// ─── Built-in script sources (viewable / duplicatable by users) ───────────
import smaScript from './scripts/sma.diq?raw';
import emaScript from './scripts/ema.diq?raw';
import emaRibbonScript from './scripts/emaRibbon.diq?raw';
import dailyIQTechnicalTableScript from './scripts/dailyIQTechnicalTable.diq?raw';
import bollingerScript from './scripts/bollinger.diq?raw';
import vwapScript from './scripts/vwap.diq?raw';
import envelopeScript from './scripts/envelope.diq?raw';
import rsiScript from './scripts/rsi.diq?raw';
import macdScript from './scripts/macd.diq?raw';
import stochasticScript from './scripts/stochastic.diq?raw';
import atrScript from './scripts/atr.diq?raw';
import cciScript from './scripts/cci.diq?raw';
import williamsRScript from './scripts/williamsR.diq?raw';
import rocScript from './scripts/roc.diq?raw';
import mfiScript from './scripts/mfi.diq?raw';
import stochasticRsiScript from './scripts/stochasticRsi.diq?raw';
import obvScript from './scripts/obv.diq?raw';
import volumeScript from './scripts/volume.diq?raw';
import adlScript from './scripts/adl.diq?raw';
import supertrendScript from './scripts/supertrend.diq?raw';
import linearRegressionScript from './scripts/linearRegression.diq?raw';
import chopZoneScript from './scripts/chopZone.diq?raw';
import crossoverStrategyScript from './scripts/crossoverStrategy.diq?raw';
import ema520StrategyScript from './scripts/ema520Strategy.diq?raw';
import rsiStrategyScript from './scripts/rsiStrategy.diq?raw';
import macdCrossoverStrategyScript from './scripts/macdCrossoverStrategy.diq?raw';
import fvgScript from './scripts/fvg.diq?raw';

const C = INDICATOR_COLORS;
const DAILYIQ_LIQUITITY_SWEEP_META: IndicatorMeta = {
  name: 'Dailyiq Liquitity Sweep',
  shortName: 'DIQ Sweep',
  category: 'overlay',
  legendOmitParamSummary: true,
  defaultParams: {
    liqUseCloseConfirm: 1,
    liqUseExternalOnly: 1,
    liqShowSweepLabel: 1,
    liqShowBullSweepText: 1,
    liqShowRange: 1,
    liqShowAction: 1,
  },
  paramLabels: {
    liqUseCloseConfirm: 'Close Confirm 1/0',
    liqUseExternalOnly: 'External Only 1/0',
    liqShowSweepLabel: 'Show Labels 1/0',
    liqShowBullSweepText: 'Show Bull Label 1/0',
    liqShowRange: 'Show Label Details 1/0',
    liqShowAction: 'Show Action Box 1/0',
  },
  outputs: [
    { key: 'buy', label: 'Bull sweep', color: '#009E48', style: 'markers' },
    { key: 'sell', label: 'Bear sweep', color: '#DB2958', style: 'markers' },
  ],
};

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
    scriptSource: smaScript,
    isBuiltIn: true,
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
    scriptSource: emaScript,
    isBuiltIn: true,
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
      { key: 'slow', label: 'EMA 200', color: '#3B82F6', style: 'line', lineWidth: 1.5 },
    ],
    scriptSource: emaRibbonScript,
    isBuiltIn: true,
  },

  'DailyIQ Technical Table': {
    name: 'DailyIQ Technical Table',
    shortName: 'DIQ Table',
    category: 'overlay',
    defaultParams: {
      fastLen: 5,
      slowLen: 20,
      trendLen: 50,
      useVolFilter: 0,
      volLen: 20,
      sweepLookback: 10,
      requireSweepEntry: 0,
      showTrendEma: 0,
      showEma200: 1,
    },
    paramLabels: {
      fastLen: 'Fast EMA',
      slowLen: 'Slow EMA',
      trendLen: 'Trend EMA',
      useVolFilter: 'Use Volume Filter (1/0)',
      volLen: 'Volume MA Length',
      sweepLookback: 'Sweep Lookback',
      requireSweepEntry: 'Require Sweep Entry (1/0)',
      showTrendEma: 'Show Trend EMA (1/0)',
      showEma200: 'Show EMA 200 (1/0)',
    },
    legendSwatchKeys: ['fast', 'slow', 'trend', 'ema200'],
    outputs: [
      { key: 'fast', label: 'EMA Fast', color: '#00C853', style: 'line', lineWidth: 1.8 },
      { key: 'slow', label: 'EMA Slow', color: '#FF3D71', style: 'line', lineWidth: 1.8 },
      { key: 'trend', label: 'EMA Trend', color: '#FFFFFF', style: 'line', lineWidth: 1.4 },
      { key: 'ema200', label: 'EMA 200', color: '#1A56DB', style: 'line', lineWidth: 1.8 },
      { key: 'buy', label: 'BUY', color: '#00C853', style: 'markers' },
      { key: 'sell', label: 'SELL', color: '#FF3D71', style: 'markers' },
      { key: 'bullSweep', label: 'Bull Sweep', color: '#22C55E', style: 'dots' },
      { key: 'bearSweep', label: 'Bear Sweep', color: '#EF4444', style: 'dots' },
    ],
    scriptSource: dailyIQTechnicalTableScript,
    isBuiltIn: true,
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
    scriptSource: bollingerScript,
    isBuiltIn: true,
  },

  VWAP: {
    name: 'Volume Weighted Average Price',
    shortName: 'VWAP',
    category: 'overlay',
    defaultParams: {},
    paramLabels: {},
    outputs: [
      { key: 'vwap', label: 'VWAP', color: '#FFFFFF', style: 'line', lineWidth: 1.5 },
    ],
    scriptSource: vwapScript,
    isBuiltIn: true,
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
    scriptSource: envelopeScript,
    isBuiltIn: true,
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
    scriptSource: crossoverStrategyScript,
    isBuiltIn: true,
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
    scriptSource: crossoverStrategyScript,
    isBuiltIn: true,
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
    scriptSource: ema520StrategyScript,
    isBuiltIn: true,
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
    defaultParams: { requireCloseConfirm: 1, externalOnly: 1, padTicks: 0, boxWidthPx: 56 },
    paramLabels: { requireCloseConfirm: 'Close Confirm 1/0', externalOnly: 'External Only 1/0', padTicks: 'Pad Ticks', boxWidthPx: 'Box Width Px' },
    outputs: [
      { key: 'buy', label: 'BUY', color: '#2563EB', style: 'markers' },
      { key: 'sell', label: 'SELL', color: '#DC2626', style: 'markers' },
    ],
  },

  'DailyIQ Liquidity Sweep Table': {
    name: 'DailyIQ Liquidity Sweep Table',
    shortName: 'DIQ Liq Tbl',
    category: 'overlay',
    defaultParams: {
      atrLen: 14,
      targetAtrMult: 1,
      highlightNearLevels: 1,
      nearLevelPct: 0.5,
    },
    paramLabels: {
      atrLen: 'Daily ATR Length',
      targetAtrMult: 'Target ATR Mult',
      highlightNearLevels: 'Highlight Near 1/0',
      nearLevelPct: 'Near Level %',
    },
    outputs: [],
  },

  'Dailyiq Liquitity Sweep': DAILYIQ_LIQUITITY_SWEEP_META,
  'Liquidity Sweep (ICT/SMC)': DAILYIQ_LIQUITITY_SWEEP_META,

  FVG: {
    name: 'FVG',
    shortName: 'FVG',
    category: 'overlay',
    defaultParams: { thresholdPercent: 0, extendBars: 30, requireNextBarReaction: 1, maxVisibleFvgs: 3 },
    defaultTextParams: { sourceTimeframe: '' },
    paramLabels: {
      thresholdPercent: 'Gap Threshold %',
      extendBars: 'Extend Bars',
      requireNextBarReaction: 'Require Next Bar Reaction 1/0',
      maxVisibleFvgs: 'Visible FVG Count',
    },
    textParamLabels: {
      sourceTimeframe: 'FVG Timeframe (blank = chart)',
    },
    outputs: [
      { key: 'bullZone', label: 'Bull FVG', color: C[3], style: 'markers' },
      { key: 'bearZone', label: 'Bear FVG', color: C[4], style: 'markers' },
    ],
    scriptSource: fvgScript,
  },

  'FVG Momentum': {
    name: 'FVG Momentum',
    shortName: 'FVG',
    category: 'overlay',
    defaultParams: { thresholdPercent: 0, extendBars: 30, requireNextBarReaction: 1, maxVisibleFvgs: 3 },
    defaultTextParams: { sourceTimeframe: '' },
    paramLabels: {
      thresholdPercent: 'Gap Threshold %',
      extendBars: 'Extend Bars',
      requireNextBarReaction: 'Require Next Bar Reaction 1/0',
      maxVisibleFvgs: 'Visible FVG Count',
    },
    textParamLabels: {
      sourceTimeframe: 'FVG Timeframe (blank = chart)',
    },
    scriptSource: fvgScript,
    outputs: [
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

  'MACD Crossover': {
    name: 'MACD Crossover',
    shortName: 'MACD X',
    category: 'overlay',
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    paramLabels: { fast: 'Fast', slow: 'Slow', signal: 'Signal' },
    outputs: [
      { key: 'buy', label: 'BUY', color: '#00C853', style: 'markers' },
      { key: 'sell', label: 'SELL', color: '#FF3D71', style: 'markers' },
    ],
    scriptSource: macdCrossoverStrategyScript,
    isBuiltIn: true,
  },

  'ADL Crossover': {
    name: 'ADL Crossover',
    shortName: 'ADL X',
    category: 'overlay',
    defaultParams: { smoothing: 20, normPeriod: 100 },
    paramLabels: { smoothing: 'Smoothing (SMA)', normPeriod: 'Norm Period' },
    outputs: [
      { key: 'buy', label: 'BUY', color: '#00C853', style: 'markers' },
      { key: 'sell', label: 'SELL', color: '#FF3D71', style: 'markers' },
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

  'RSI Strategy': {
    name: 'RSI Crossover Strategy',
    shortName: 'RSI Strat',
    category: 'overlay',
    defaultParams: { rsiPeriod: 14, maPeriod: 14, maType: 1, divergence: 0, lookbackLeft: 5, lookbackRight: 5 },
    paramLabels: {
      rsiPeriod: 'RSI Period',
      maPeriod: 'MA Period',
      maType: 'MA Type (1=SMA 2=EMA 3=RMA)',
      divergence: 'Divergence 1/0',
      lookbackLeft: 'Div Lookback L',
      lookbackRight: 'Div Lookback R',
    },
    outputs: [
      { key: 'buy', label: 'BUY', color: '#00C853', style: 'markers' },
      { key: 'sell', label: 'SELL', color: '#FF3D71', style: 'markers' },
    ],
    scriptSource: rsiStrategyScript,
    isBuiltIn: true,
  },

  RSI: {
    name: 'Relative Strength Index',
    shortName: 'RSI',
    category: 'oscillator',
    defaultParams: { period: 14, maPeriod: 14, maType: 1 },
    paramLabels: { period: 'Period', maPeriod: 'MA Period', maType: 'MA Type (1=SMA 2=EMA 3=RMA)' },
    guideLines: [
      { value: 70, color: '#FF3D71', style: 'dashed' },
      { value: 30, color: '#00C853', style: 'dashed' },
    ],
    outputs: [
      { key: 'rsi', label: 'RSI', color: '#00C853', style: 'line', lineWidth: 1.5 },
      { key: 'ma', label: 'RSI MA', color: '#FF3D71', style: 'line', lineWidth: 1.5 },
    ],
    scriptSource: rsiScript,
    isBuiltIn: true,
  },

  MACD: {
    name: 'Moving Average Convergence Divergence',
    shortName: 'MACD',
    category: 'oscillator',
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    paramLabels: { fast: 'Fast', slow: 'Slow', signal: 'Signal' },
    outputs: [
      { key: 'macd', label: 'MACD', color: '#00C853', style: 'line', lineWidth: 1.5 },
      { key: 'signal', label: 'Signal', color: '#FF3D71', style: 'line', lineWidth: 1.5 },
      { key: 'histogram', label: 'Histogram', color: C[3], style: 'histogram', lineWidth: 1 },
    ],
    scriptSource: macdScript,
    isBuiltIn: true,
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
    scriptSource: stochasticScript,
    isBuiltIn: true,
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
    scriptSource: atrScript,
    isBuiltIn: true,
  },

  CCI: {
    name: 'Commodity Channel Index',
    shortName: 'CCI',
    category: 'oscillator',
    defaultParams: { period: 20, maPeriod: 14, maType: 1 },
    paramLabels: { period: 'Period', maPeriod: 'MA Period', maType: 'MA Type (1=SMA 2=EMA 3=RMA)' },
    outputs: [
      { key: 'cci', label: 'CCI', color: C[2], style: 'line', lineWidth: 1.5 },
      { key: 'ma', label: 'CCI MA', color: '#FF3D71', style: 'line', lineWidth: 1.5 },
    ],
    scriptSource: cciScript,
    isBuiltIn: true,
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
    scriptSource: williamsRScript,
    isBuiltIn: true,
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
    scriptSource: rocScript,
    isBuiltIn: true,
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
    scriptSource: mfiScript,
    isBuiltIn: true,
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
    scriptSource: stochasticRsiScript,
    isBuiltIn: true,
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
    scriptSource: supertrendScript,
    isBuiltIn: true,
  },

  'Chop Zone': {
    name: 'Chop Zone',
    shortName: 'Chop Zone',
    category: 'oscillator',
    defaultParams: { period: 30 },
    paramLabels: { period: 'Length' },
    paneRange: { min: 0, max: 1 },
    hidePaneScaleControls: true,
    legendSwatchKeys: ['darkGreen', 'yellow', 'darkRed'],
    outputs: [
      { key: 'turquoise', label: 'Strong Bull', color: '#26C6DA', style: 'histogram', lineWidth: 1 },
      { key: 'darkGreen', label: 'Bull', color: '#43A047', style: 'histogram', lineWidth: 1 },
      { key: 'paleGreen', label: 'Mild Bull', color: '#A5D6A7', style: 'histogram', lineWidth: 1 },
      { key: 'lime', label: 'Weak Bull', color: '#009688', style: 'histogram', lineWidth: 1 },
      { key: 'darkRed', label: 'Strong Bear', color: '#D50000', style: 'histogram', lineWidth: 1 },
      { key: 'red', label: 'Bear', color: '#E91E63', style: 'histogram', lineWidth: 1 },
      { key: 'orange', label: 'Mild Bear', color: '#FF6D00', style: 'histogram', lineWidth: 1 },
      { key: 'lightOrange', label: 'Weak Bear', color: '#FFB74D', style: 'histogram', lineWidth: 1 },
      { key: 'yellow', label: 'Neutral', color: '#FDD835', style: 'histogram', lineWidth: 1 },
    ],
    scriptSource: chopZoneScript,
    isBuiltIn: true,
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
    scriptSource: linearRegressionScript,
    isBuiltIn: true,
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

  'Probability Engine': {
    name: 'Probability Engine',
    shortName: 'ProbEng',
    category: 'oscillator',
    legendOmitParamSummary: true,
    defaultParams: {
      source: 0,
      buckets: 9,
      alpha: 0.15,
      minObs: 30,
      useBody: 1,
      detailedStats: 0,
    },
    paramLabels: {
      source: 'Source',
      buckets: 'Buckets',
      alpha: 'EWMA Alpha',
      minObs: 'Min Observations',
      useBody: 'Use Body (1=body 0=close)',
      detailedStats: 'Detailed Stats',
    },
    paneRange: { min: 0, max: 100 },
    guideLines: [
      { value: 70, color: '#00C853', style: 'dashed' },
      { value: 50, color: '#8B949E', style: 'dashed' },
      { value: 30, color: '#FF3D71', style: 'dashed' },
    ],
    outputs: [
      { key: 'prob1', label: 'P(Bull) 1-bar',  color: '#00C853', style: 'line', lineWidth: 1.5 },
      { key: 'prob3', label: 'P(Bull) 3-bar',  color: '#1A56DB', style: 'line', lineWidth: 1.5 },
      { key: 'mid',   label: 'Midline (50)',    color: '#8B949E', style: 'line', lineWidth: 1 },
    ],
  },

  'Technical Score': {
    name: 'DailyIQ Technical Score',
    shortName: 'DailyIQ Score',
    category: 'oscillator',
    defaultParams: {},
    paramLabels: {},
    outputs: [
      { key: 'score', label: 'Score', color: '#FFFFFF', style: 'line', lineWidth: 1.5 },
    ],
  },

  Volume: {
    name: 'Volume',
    shortName: 'Vol',
    category: 'volume',
    defaultParams: {},
    paramLabels: {},
    outputs: [
      { key: 'volume', label: 'Volume', color: C[5], style: 'histogram' },
    ],
    scriptSource: volumeScript,
    isBuiltIn: true,
  },

  ADL: {
    name: 'Accumulation Distribution Line',
    shortName: 'ADL',
    category: 'oscillator',
    defaultParams: { smoothing: 20, normPeriod: 100 },
    paramLabels: { smoothing: 'Smoothing (SMA)', normPeriod: 'Norm Period' },
    outputs: [
      { key: 'adl', label: 'ADL', color: '#00C853', style: 'line', lineWidth: 1.5 },
      { key: 'sma', label: 'ADL SMA', color: '#FF3D71', style: 'line', lineWidth: 1.5 },
    ],
    scriptSource: adlScript,
    isBuiltIn: true,
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
    scriptSource: obvScript,
    isBuiltIn: true,
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
      { key: 'upVolume', label: 'Up Volume', color: '#00C853', style: 'histogram' },
      { key: 'downVolume', label: 'Down Volume', color: '#FF3D71', style: 'histogram' },
    ],
  },
};

import type { CustomStrategyDefinition } from "./customStrategies";

export const PRESET_STRATEGIES: CustomStrategyDefinition[] = [
  // ─── Score-mode presets (continuous 0-100 oscillators) ───────────────────
  // These work correctly with the score system: the oscillator value persistently
  // sits above/below the threshold so BUY/SELL states hold naturally.

  {
    id: "preset_dailyiq_score",
    name: "DailyIQ Score",
    mode: "score",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "Technical Score", params: {}, output: "score" },
        operator: "above",
        targetType: "value",
        threshold: 50,
      },
    ],
  },

  {
    id: "preset_supertrend",
    name: "Supertrend",
    mode: "score",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "Supertrend", params: { atrPeriod: 10, factor: 3, smooth: 3 }, output: "supertrend" },
        operator: "above",
        targetType: "value",
        threshold: 50,
      },
    ],
  },

  {
    id: "preset_market_structure",
    name: "Market Structure",
    mode: "score",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "Market Structure", params: { period: 5, smooth: 3 }, output: "marketStructure" },
        operator: "above",
        targetType: "value",
        threshold: 50,
      },
    ],
  },

  // ─── Signal-mode presets (crossover / marker-based) ──────────────────────
  // These emit discrete buy/sell marker signals. Signal mode latches state
  // between signals so position is held until the opposite signal fires.

  {
    id: "preset_dailyiq_signal",
    name: "DailyIQ BUY/SELL Signal",
    mode: "signal",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "DailyIQ Tech Score Signal", params: { showScorePane: 1 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "buy",
      },
      {
        left: { sourceKind: "indicator", indicatorKey: "DailyIQ Tech Score Signal", params: { showScorePane: 1 }, output: "sell" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "sell",
      },
    ],
  },

  {
    id: "preset_ema_9_14_crossover",
    name: "EMA 9/14 Crossover",
    mode: "signal",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "EMA 9/14 Crossover", params: { fastPeriod: 9, slowPeriod: 14 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "buy",
      },
      {
        left: { sourceKind: "indicator", indicatorKey: "EMA 9/14 Crossover", params: { fastPeriod: 9, slowPeriod: 14 }, output: "sell" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "sell",
      },
    ],
  },

  {
    id: "preset_ema_5_20_crossover",
    name: "EMA 5/20 Crossover",
    mode: "signal",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "EMA 5/20 Crossover", params: { fastPeriod: 5, slowPeriod: 20 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "buy",
      },
      {
        left: { sourceKind: "indicator", indicatorKey: "EMA 5/20 Crossover", params: { fastPeriod: 5, slowPeriod: 20 }, output: "sell" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "sell",
      },
    ],
  },

  {
    id: "preset_macd_crossover",
    name: "MACD Crossover",
    mode: "signal",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "MACD Crossover", params: { fast: 12, slow: 26, signal: 9 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "buy",
      },
      {
        left: { sourceKind: "indicator", indicatorKey: "MACD Crossover", params: { fast: 12, slow: 26, signal: 9 }, output: "sell" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "sell",
      },
    ],
  },

  {
    id: "preset_golden_cross",
    name: "Golden / Death Cross",
    mode: "signal",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "Golden/Death Cross", params: { fastPeriod: 50, slowPeriod: 200 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "buy",
      },
      {
        left: { sourceKind: "indicator", indicatorKey: "Golden/Death Cross", params: { fastPeriod: 50, slowPeriod: 200 }, output: "sell" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "sell",
      },
    ],
  },

  {
    id: "preset_rsi_crossover",
    name: "RSI Crossover",
    mode: "signal",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "RSI Strategy", params: { rsiPeriod: 14, maPeriod: 14, maType: 1, divergence: 0, lookbackLeft: 5, lookbackRight: 5 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "buy",
      },
      {
        left: { sourceKind: "indicator", indicatorKey: "RSI Strategy", params: { rsiPeriod: 14, maPeriod: 14, maType: 1, divergence: 0, lookbackLeft: 5, lookbackRight: 5 }, output: "sell" },
        operator: "above",
        targetType: "value",
        threshold: 0,
        conditionSide: "sell",
      },
    ],
  },

  {
    id: "preset_rsi_mean_reversion",
    name: "RSI Oversold/Overbought",
    mode: "signal",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "RSI", params: { period: 14, maPeriod: 14, maType: 1 }, output: "rsi" },
        operator: "below",
        targetType: "value",
        threshold: 30,
        conditionSide: "buy",
      },
      {
        left: { sourceKind: "indicator", indicatorKey: "RSI", params: { period: 14, maPeriod: 14, maType: 1 }, output: "rsi" },
        operator: "above",
        targetType: "value",
        threshold: 70,
        conditionSide: "sell",
      },
    ],
  },
];

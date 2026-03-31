import type { CustomStrategyDefinition } from "./customStrategies";

export const PRESET_STRATEGIES: CustomStrategyDefinition[] = [
  {
    id: "preset_dailyiq_score",
    name: "DailyIQ Score",
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
    id: "preset_dailyiq_signal",
    name: "DailyIQ BUY/SELL Signal",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "DailyIQ Tech Score Signal", params: { showScorePane: 1 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
      },
    ],
  },
  {
    id: "preset_ema_9_14_crossover",
    name: "EMA 9/14 Crossover",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "EMA 9/14 Crossover", params: { fastPeriod: 9, slowPeriod: 14 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
      },
    ],
  },
  {
    id: "preset_ema_5_20_crossover",
    name: "EMA 5/20 Crossover",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "EMA 5/20 Crossover", params: { fastPeriod: 5, slowPeriod: 20 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
      },
    ],
  },
  {
    id: "preset_rsi_momentum",
    name: "RSI Momentum",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "RSI", params: { period: 14 }, output: "value" },
        operator: "above",
        targetType: "value",
        threshold: 50,
      },
    ],
  },
  {
    id: "preset_macd_crossover",
    name: "MACD Crossover",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "MACD Crossover", params: { fast: 12, slow: 26, signal: 9 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
      },
    ],
  },
  {
    id: "preset_supertrend",
    name: "Supertrend",
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
  {
    id: "preset_golden_cross",
    name: "Golden / Death Cross",
    buyThreshold: 70,
    sellThreshold: 30,
    conditions: [
      {
        left: { sourceKind: "indicator", indicatorKey: "Golden/Death Cross", params: { fastPeriod: 50, slowPeriod: 200 }, output: "buy" },
        operator: "above",
        targetType: "value",
        threshold: 0,
      },
    ],
  },
];

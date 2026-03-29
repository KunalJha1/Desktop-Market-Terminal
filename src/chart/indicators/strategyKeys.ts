export const STRATEGY_KEYS_LIST = [
  'Golden/Death Cross',
  'EMA 9/14 Crossover',
  'EMA 5/20 Crossover',
  'DailyIQ Tech Score Signal',
  'FVG Momentum',
  'MACD Crossover',
  'ADL Crossover',
  'Market Sentiment Signal',
  'RSI Strategy',
  'Market Sentiment',
] as const;

export const STRATEGY_KEYS = new Set<string>(STRATEGY_KEYS_LIST);

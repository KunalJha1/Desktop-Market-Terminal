export const STRATEGY_KEYS_LIST = [
  'Golden/Death Cross',
  'EMA 9/14 Crossover',
  'DailyIQ Tech Score Signal',
] as const;

export const STRATEGY_KEYS = new Set<string>(STRATEGY_KEYS_LIST);

/** Canonical TA score horizons (watchlist column popover, screener, portfolio, heatmap, custom columns). */
export const TA_SCORE_TIMEFRAMES = [
  "5m",
  "15m",
  "1h",
  "1d",
  "1w",
] as const;

export type TaScoreTimeframe = (typeof TA_SCORE_TIMEFRAMES)[number];

export const TA_SCORE_TF_LABELS: Record<TaScoreTimeframe, string> = {
  "5m": "5M",
  "15m": "15M",
  "1h": "1H",
  "1d": "1D",
  "1w": "1W",
};

export const TA_SCORE_INTRADAY: readonly TaScoreTimeframe[] = [
  "5m",
  "15m",
  "1h",
];

export const TA_SCORE_INTRADAY_SET = new Set<TaScoreTimeframe>(TA_SCORE_INTRADAY);

const _TA_SCORE_TF_SET = new Set<string>(TA_SCORE_TIMEFRAMES);

export function isTaScoreTimeframe(s: string): s is TaScoreTimeframe {
  return _TA_SCORE_TF_SET.has(s);
}

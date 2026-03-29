import {
  TA_SCORE_TF_LABELS,
  TA_SCORE_TIMEFRAMES,
  type TaScoreTimeframe,
} from "./ta-score-timeframes";

/** Alias for heatmap UI — same horizons as watchlist TA score columns. */
export type HeatmapTechTimeframe = TaScoreTimeframe;

export type HeatmapMetricMode = "change" | `tech-${TaScoreTimeframe}`;

export const HEATMAP_TECH_TIMEFRAMES: { key: HeatmapTechTimeframe; label: string }[] =
  TA_SCORE_TIMEFRAMES.map((key) => ({ key, label: TA_SCORE_TF_LABELS[key] }));

export const HEATMAP_METRIC_OPTIONS: { value: HeatmapMetricMode; label: string }[] = [
  { value: "change", label: "Change" },
  { value: "tech-5m", label: "Tech Score 5M" },
  { value: "tech-15m", label: "Tech Score 15M" },
  { value: "tech-1h", label: "Tech Score 1H" },
{ value: "tech-1d", label: "Tech Score 1D" },
  { value: "tech-1w", label: "Tech Score 1W" },
];

export interface HeatmapTile {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  theme?: string;
  groups: string[];
  sp500Weight: number;
  last: number | null;
  changePct: number | null;
  status?: string | null;
  updatedAt?: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
  techScore1d: number | null;
  techScore1w: number | null;
  /** All cached horizons from `/heatmap/sp500` when sidecar provides them. */
  techScores?: Partial<Record<HeatmapTechTimeframe, number | null>>;
  // ScreenerPage extras (optional)
  week52High?: number | null;
  week52Low?: number | null;
  volume?: number | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutRect extends Rect {
  data: HeatmapTile;
}

export interface SectorBound extends Rect {
  sector: string;
  totalMarketCap: number;
  count: number;
  headerHeight: number;
}

export function resolveHeatmapTechScore(
  tile: HeatmapTile,
  key: HeatmapTechTimeframe,
): number | null {
  return (
    tile.techScores?.[key] ??
    (key === "1d" ? tile.techScore1d : key === "1w" ? tile.techScore1w : null)
  );
}

export function getTileMetricValue(
  tile: HeatmapTile,
  mode: HeatmapMetricMode,
): number | null {
  if (mode === "change") return tile.changePct;
  if (mode.startsWith("tech-")) {
    const tf = mode.slice(5) as TaScoreTimeframe;
    return resolveHeatmapTechScore(tile, tf);
  }
  return null;
}

export function getTileMetricColor(tile: HeatmapTile, mode: HeatmapMetricMode): string {
  const value = getTileMetricValue(tile, mode);
  if (mode === "change") return tileColor(value, tile.status);
  return technicalTileColor(value, tile.status);
}

export function formatTileMetricValue(
  value: number | null,
  mode: HeatmapMetricMode,
): string {
  if (mode === "change") return formatPct(value);
  return formatTechnicalScore(value);
}

export function squarify(
  items: { value: number; data: HeatmapTile }[],
  bounds: Rect,
): LayoutRect[] {
  if (items.length === 0) return [];
  const sorted = [...items]
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return [];

  function layoutPartition(
    subset: { value: number; data: HeatmapTile }[],
    rect: Rect,
  ): LayoutRect[] {
    if (subset.length === 0 || rect.w <= 0 || rect.h <= 0) return [];
    if (subset.length === 1) {
      return [{ ...rect, data: subset[0].data }];
    }

    const total = subset.reduce((sum, item) => sum + item.value, 0);
    let splitIndex = 1;
    let leftSum = subset[0].value;
    let bestDiff = Math.abs(total - leftSum * 2);

    for (let index = 1; index < subset.length - 1; index += 1) {
      leftSum += subset[index].value;
      const diff = Math.abs(total - leftSum * 2);
      if (diff <= bestDiff) {
        bestDiff = diff;
        splitIndex = index + 1;
      } else {
        break;
      }
    }

    const first = subset.slice(0, splitIndex);
    const second = subset.slice(splitIndex);
    const firstSum = first.reduce((sum, item) => sum + item.value, 0);
    const ratio = total > 0 ? firstSum / total : 0.5;

    if (rect.w >= rect.h) {
      const firstWidth = rect.w * ratio;
      return [
        ...layoutPartition(first, { x: rect.x, y: rect.y, w: firstWidth, h: rect.h }),
        ...layoutPartition(second, {
          x: rect.x + firstWidth,
          y: rect.y,
          w: rect.w - firstWidth,
          h: rect.h,
        }),
      ];
    }

    const firstHeight = rect.h * ratio;
    return [
      ...layoutPartition(first, { x: rect.x, y: rect.y, w: rect.w, h: firstHeight }),
      ...layoutPartition(second, {
        x: rect.x,
        y: rect.y + firstHeight,
        w: rect.w,
        h: rect.h - firstHeight,
      }),
    ];
  }

  return layoutPartition(sorted, bounds);
}

export function tileColor(changePct: number | null, status?: string | null): string {
  if (status === "pending" && changePct == null) return "#3a4350";
  if (changePct == null) return "#3a4350";

  if (changePct >= 4) return "#0b7a36";
  if (changePct >= 2) return "#138a40";
  if (changePct >= 0.5) return "#1fa34f";
  if (changePct > 0) return "#2a6e3f";
  if (changePct === 0) return "#4b5563";
  if (changePct > -0.5) return "#8a3344";
  if (changePct > -2) return "#c43d53";
  if (changePct > -4) return "#b52e43";
  return "#981b31";
}

export function technicalTileColor(score: number | null, status?: string | null): string {
  if (status === "pending" && score == null) return "#3a4350";
  if (score == null) return "#3a4350";

  if (score >= 85) return "#0b7a36";
  if (score >= 70) return "#138a40";
  if (score >= 55) return "#1fa34f";
  if (score >= 45) return "#4b5563";
  if (score >= 30) return "#c43d53";
  if (score >= 15) return "#b52e43";
  return "#981b31";
}

export function formatPct(changePct: number | null): string {
  if (changePct == null) return "\u2014";
  return `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
}

export function formatTechnicalScore(score: number | null): string {
  if (score == null) return "\u2014";
  return `${Math.round(score)}`;
}

export function formatPrice(last: number | null): string {
  if (last == null) return "\u2014";
  return `$${last.toFixed(2)}`;
}

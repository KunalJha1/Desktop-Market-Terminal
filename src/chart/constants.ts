import type { Timeframe, ChartType } from './types';

// Design system colors
export const COLORS = {
  bgBase: '#0D1117',
  bgPanel: '#161B22',
  bgHover: '#1C2128',
  border: '#21262D',
  borderActive: '#1A56DB',
  textPrimary: '#E6EDF3',
  textSecondary: '#8B949E',
  textMuted: '#484F58',
  green: '#00C853',
  red: '#FF3D71',
  amber: '#F59E0B',
  blue: '#1A56DB',
  purple: '#8B5CF6',
  crosshair: '#484F58',
  gridLine: 'rgba(33,38,45,0.5)',
  volumeUp: 'rgba(0,200,83,0.25)',
  volumeDown: 'rgba(255,61,113,0.25)',
  areaFill: 'rgba(26,86,219,0.12)',
  areaStroke: '#1A56DB',
} as const;

// Indicator palette for multiple overlays
export const INDICATOR_COLORS = [
  '#1A56DB', '#F59E0B', '#8B5CF6', '#00C853',
  '#FF3D71', '#06B6D4', '#F97316', '#EC4899',
] as const;

export const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1H', value: '1H' },
  { label: '4H', value: '4H' },
  { label: '1D', value: '1D' },
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
];

export const CHART_TYPES: { label: string; value: ChartType }[] = [
  { label: 'Candlestick', value: 'candlestick' },
  { label: 'Heikin-Ashi', value: 'heikin-ashi' },
  { label: 'Vol Weighted', value: 'volume-weighted' },
  { label: 'OHLC Bar', value: 'bar' },
  { label: 'Line', value: 'line' },
  { label: 'Area', value: 'area' },
];

// Timeframe durations in milliseconds
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1H': 3_600_000,
  '4H': 14_400_000,
  '1D': 86_400_000,
  '1W': 604_800_000,
  '1M': 2_592_000_000,
};

// Chart layout constants
export const PRICE_AXIS_WIDTH = 70;
export const TIME_AXIS_HEIGHT = 24;
export const SUB_PANE_HEIGHT = 120;
export const SUB_PANE_SEPARATOR = 1;
export const MIN_BARS_VISIBLE = 10;
export const MAX_BARS_VISIBLE = 500;
export const DEFAULT_BARS_VISIBLE = 100;
export const BAR_BODY_RATIO = 0.7;
export const VOLUME_PANE_RATIO = 0.2;

// Font
export const FONT_MONO = '11px "JetBrains Mono", monospace';
export const FONT_MONO_SMALL = '10px "JetBrains Mono", monospace';

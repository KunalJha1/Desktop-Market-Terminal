import type { PresetTimeframe, ChartType } from './types';

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
  premarket: 'rgba(245, 158, 11, 0.06)',
  aftermarket: 'rgba(26, 86, 219, 0.06)',
  syntheticBar: 'rgba(139, 92, 246, 0.10)',
} as const;

// Indicator palette for multiple overlays
export const INDICATOR_COLORS = [
  '#1A56DB', '#F59E0B', '#8B5CF6', '#00C853',
  '#FF3D71', '#06B6D4', '#F97316', '#EC4899',
] as const;

export const TIMEFRAMES: { label: string; value: PresetTimeframe }[] = [
  { label: '1m',  value: '1m'  },
  { label: '2m',  value: '2m'  },
  { label: '3m',  value: '3m'  },
  { label: '5m',  value: '5m'  },
  { label: '10m', value: '10m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1H',  value: '1H'  },
  { label: '2H',  value: '2H'  },
  { label: '3H',  value: '3H'  },
  { label: '4H',  value: '4H'  },
  { label: '1D',  value: '1D'  },
  { label: '3D',  value: '3D'  },
  { label: '1W',  value: '1W'  },
  { label: '1M',  value: '1M'  },
  { label: '3M',  value: '3M'  },
  { label: '6M',  value: '6M'  },
  { label: '12M', value: '12M' },
];

export const CHART_TYPES: { label: string; value: ChartType }[] = [
  { label: 'Candlestick', value: 'candlestick' },
  { label: 'Heikin-Ashi', value: 'heikin-ashi' },
  { label: 'Vol Weighted', value: 'volume-weighted' },
  { label: 'OHLC Bar', value: 'bar' },
  { label: 'Line', value: 'line' },
  { label: 'Area', value: 'area' },
];

// Timeframe durations in milliseconds (preset values only)
export const TIMEFRAME_MS: Record<PresetTimeframe, number> = {
  '1m':  60_000,
  '2m':  120_000,
  '3m':  180_000,
  '5m':  300_000,
  '10m': 600_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1H':  3_600_000,
  '2H':  7_200_000,
  '3H':  10_800_000,
  '4H':  14_400_000,
  '1D':  86_400_000,
  '3D':  259_200_000,
  '1W':  604_800_000,
  '1M':  2_592_000_000,
  '3M':  7_776_000_000,
  '6M':  15_552_000_000,
  '12M': 31_104_000_000,
};

/** Parse a custom timeframe string like "5M", "2H", "3D", "1W". Case-insensitive. */
export function parseCustomTimeframe(input: string): {
  valid: boolean; ms: number; label: string; isDaily: boolean; error?: string;
} {
  const trimmed = input.trim().toUpperCase();
  const match = trimmed.match(/^(\d+)([DHMW])$/);
  if (!match) return { valid: false, ms: 0, label: '', isDaily: false, error: 'Format: <number>M / H / D / W  (e.g. 5M, 2H, 3D)' };
  const num = parseInt(match[1], 10);
  if (num <= 0) return { valid: false, ms: 0, label: '', isDaily: false, error: 'Number must be greater than 0' };
  const unit = match[2] as 'D' | 'H' | 'M' | 'W';
  const unitMs: Record<string, number> = { M: 60_000, H: 3_600_000, D: 86_400_000, W: 604_800_000 };
  const ms = num * unitMs[unit];
  const isDaily = unit === 'D' || unit === 'W';
  return { valid: true, ms, label: `${num}${unit}`, isDaily };
}

/** Get duration in ms for any timeframe string (preset or custom). */
export function getTimeframeMs(tf: string): number {
  if (tf in TIMEFRAME_MS) return TIMEFRAME_MS[tf as PresetTimeframe];
  const parsed = parseCustomTimeframe(tf);
  return parsed.valid ? parsed.ms : 60_000;
}

// Chart layout constants
export const PRICE_AXIS_WIDTH = 56;
export const PRICE_AXIS_CONTROL_HEIGHT = 22;
export const TIME_AXIS_HEIGHT = 24;
export const SUB_PANE_HEIGHT = 120;
export const SUB_PANE_SEPARATOR = 1;
export const MIN_BARS_VISIBLE = 10;
export const MAX_BARS_VISIBLE = 500;
export const DEFAULT_BARS_VISIBLE = 100;
export const BAR_BODY_RATIO = 0.7;
export const VOLUME_PANE_RATIO = 0.07;

// Font
export const FONT_MONO = '11px "JetBrains Mono", monospace';
export const FONT_MONO_SMALL = '10px "JetBrains Mono", monospace';

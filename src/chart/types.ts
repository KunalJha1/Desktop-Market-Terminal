export interface OHLCVBar {
  time: number;       // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1H' | '4H' | '1D' | '1W' | '1M';

export type ChartType = 'candlestick' | 'heikin-ashi' | 'volume-weighted' | 'bar' | 'line' | 'area';

export type YScaleMode = 'auto' | 'log';

export type ChartBrandingMode = 'none' | 'fullLogo' | 'icon';

export interface IndicatorMeta {
  name: string;
  shortName: string;
  category: 'overlay' | 'oscillator' | 'volume';
  defaultParams: Record<string, number>;
  paramLabels: Record<string, string>;
  outputs: IndicatorOutput[];
  guideLines?: IndicatorGuideLine[];
}

export interface IndicatorGuideLine {
  value: number;
  color?: string;
  style?: 'solid' | 'dashed';
}

export interface IndicatorOutput {
  key: string;
  label: string;
  color: string;
  style?: 'line' | 'histogram' | 'fill' | 'dots' | 'markers';
  lineWidth?: number;
}

export interface ActiveIndicator {
  id: string;
  name: string;
  paneId: string;
  params: Record<string, number>;
  colors: Record<string, string>;  // per-output color overrides keyed by output.key
  lineWidths?: Record<string, number>;  // per-output lineWidth overrides
  lineStyles?: Record<string, 'solid' | 'dashed' | 'dotted'>;  // per-output line style
  visible: boolean;
  data: number[][];  // one array per output
}

export interface ChartLayout {
  mainTop: number;
  mainHeight: number;
  subPanes: SubPaneLayout[];
  priceAxisWidth: number;
  timeAxisHeight: number;
  width: number;
  height: number;
}

export interface SubPaneLayout {
  paneId: string;
  indicatorIds: string[];
  top: number;
  height: number;
}

export interface ScriptPlot {
  values: number[];
  label: string;
  color: string;
  lineWidth: number;
}

export interface ScriptHLine {
  value: number;
  color: string;
  style: 'solid' | 'dashed';
}

export interface ScriptFill {
  plotA: string;
  plotB: string;
  color: string;
}

export interface ScriptResult {
  plots: ScriptPlot[];
  hlines: ScriptHLine[];
  fills: ScriptFill[];
  inputs: Record<string, number>;
  errors: ScriptError[];
}

export interface ScriptError {
  line: number;
  message: string;
}

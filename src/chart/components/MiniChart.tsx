import { useRef, useEffect, useMemo, useState, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { interpretScript } from '../scripting/interpreter';
import { ChartEngine } from '../core/ChartEngine';
import { useChartData } from '../hooks/useChartData';
import { indicatorRegistry } from '../indicators/registry';
import { STRATEGY_KEYS } from '../indicators/strategyKeys';
import type { Timeframe, ChartType, ActiveIndicator, YScaleMode } from '../types';
import { PRICE_AXIS_CONTROL_HEIGHT, PRICE_AXIS_WIDTH } from '../constants';
import { useTws } from '../../lib/tws';
import { linkBus } from '../../lib/link-bus';
import { X, ChevronDown, ChevronUp, Search, TrendingUp, BrainCircuit, RotateCcw, Minus, Maximize2, ChevronsUpDown, Save, FolderOpen } from 'lucide-react';
import ComponentLinkMenu from '../../components/ComponentLinkMenu';
import IndicatorLegend from './IndicatorLegend';
import {
  dailyIqChartConfigToMiniChartConfig,
  miniChartConfigToDailyIqChartConfig,
} from '../../lib/chart-config';
import {
  exportChartConfigToFile,
  importChartConfigFromFile,
} from '../../lib/chart-config-storage';

interface MiniChartProps {
  config: Record<string, unknown>;
  onConfigChange: (cfg: Record<string, unknown>) => void;
  linkChannel: number | null;
  onSetLinkChannel: (ch: number | null) => void;
  onClose: () => void;
}

const MINI_TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1m',  value: '1m'  },
  { label: '2m',  value: '2m'  },
  { label: '5m',  value: '5m'  },
  { label: '10m', value: '10m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h',  value: '1H'  },
  { label: '4h',  value: '4H'  },
  { label: '1d',  value: '1D'  },
  { label: '1w',  value: '1W'  },
  { label: '1M',  value: '1M'  },
];

const CHART_TYPES: { label: string; short: string; value: ChartType }[] = [
  { label: 'Candlestick', short: 'Candle', value: 'candlestick' },
  { label: 'Heikin-Ashi', short: 'HA', value: 'heikin-ashi' },
  { label: 'Vol Weighted', short: 'VW', value: 'volume-weighted' },
  { label: 'OHLC Bar', short: 'Bar', value: 'bar' },
  { label: 'Line', short: 'Line', value: 'line' },
  { label: 'Area', short: 'Area', value: 'area' },
];

const SCRIPT_ID = 'mini_custom_script';

const INDICATOR_CATEGORIES = [
  { key: 'overlay' as const, label: 'Overlays' },
  { key: 'oscillator' as const, label: 'Oscillators' },
  { key: 'volume' as const, label: 'Volume' },
];

const HIDDEN_INDICATOR_KEYS = new Set<string>();

interface PersistedMiniIndicator {
  name: string;
  paneId: string;
  params: Record<string, number>;
  textParams?: Record<string, string>;
  colors: Record<string, string>;
  lineWidths?: Record<string, number>;
  lineStyles?: Record<string, 'solid' | 'dashed' | 'dotted'>;
  visible: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      result[key] = item;
    }
  }
  return result;
}

function sanitizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      result[key] = item;
    }
  }
  return result;
}

function sanitizeLineStyleRecord(
  value: unknown,
): Record<string, 'solid' | 'dashed' | 'dotted'> {
  if (!isRecord(value)) return {};
  const result: Record<string, 'solid' | 'dashed' | 'dotted'> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === 'solid' || item === 'dashed' || item === 'dotted') {
      result[key] = item;
    }
  }
  return result;
}

function parsePersistedIndicators(value: unknown): PersistedMiniIndicator[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== 'string') return [];
    return [{
      name: item.name,
      paneId: typeof item.paneId === 'string'
        ? item.paneId
        : (indicatorRegistry[item.name]?.category === 'overlay' ? 'main' : `pane:${item.name}`),
      params: sanitizeNumberRecord(item.params),
      textParams: sanitizeStringRecord(item.textParams),
      colors: sanitizeStringRecord(item.colors),
      lineWidths: sanitizeNumberRecord(item.lineWidths),
      lineStyles: sanitizeLineStyleRecord(item.lineStyles),
      visible: typeof item.visible === 'boolean' ? item.visible : true,
    }];
  });
}

function serializeIndicators(indicators: ActiveIndicator[]): PersistedMiniIndicator[] {
  return indicators.map((indicator) => ({
    name: indicator.name,
    paneId: indicator.paneId,
    params: { ...indicator.params },
    textParams: { ...indicator.textParams },
    colors: { ...indicator.colors },
    lineWidths: indicator.lineWidths ? { ...indicator.lineWidths } : undefined,
    lineStyles: indicator.lineStyles ? { ...indicator.lineStyles } : undefined,
    visible: indicator.visible,
  }));
}

function getDefaultMiniIndicators(): PersistedMiniIndicator[] {
  return [{
    name: 'Volume',
    paneId: 'main',
    params: {},
    textParams: {},
    colors: {},
    lineWidths: {},
    lineStyles: {},
    visible: true,
  }];
}

function recordsEqual(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  const aEntries = Object.entries(a ?? {}).sort(([ka], [kb]) => ka.localeCompare(kb));
  const bEntries = Object.entries(b ?? {}).sort(([ka], [kb]) => ka.localeCompare(kb));
  return JSON.stringify(aEntries) === JSON.stringify(bEntries);
}

function buildIndicatorFingerprint(indicators: PersistedMiniIndicator[]): string {
  return indicators
    .map((indicator) => (
      `${indicator.name}:${indicator.paneId}:${JSON.stringify(indicator.params)}:${JSON.stringify(indicator.textParams ?? {})}`
      + `:${JSON.stringify(indicator.colors)}:${JSON.stringify(indicator.lineWidths ?? {})}`
      + `:${JSON.stringify(indicator.lineStyles ?? {})}:${indicator.visible}`
    ))
    .join('|');
}

export default function MiniChart({
  config,
  onConfigChange,
  linkChannel,
  onSetLinkChannel,
  onClose,
}: MiniChartProps) {
  const makeDetachedPaneId = useCallback(() => `pane:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const hasHydratedIndicatorsRef = useRef(false);
  const lastRestoredFingerprintRef = useRef<string>('');
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  const symbol = typeof config.symbol === 'string' ? config.symbol.trim().toUpperCase() : '';

  // Subscribe to link channel so watchlist/other components can drive the symbol
  useEffect(() => {
    if (!linkChannel) return;
    return linkBus.subscribe(linkChannel, (sym) => {
      onConfigChange({ ...configRef.current, symbol: sym });
    });
  }, [linkChannel, onConfigChange]);

  const timeframe = (config.timeframe as Timeframe) || '5m';
  const chartType = (config.chartType as ChartType) || 'candlestick';
  const yScaleMode = (config.yScaleMode as YScaleMode) || 'auto';

  const [showChartTypeMenu, setShowChartTypeMenu] = useState(false);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const [showStrategyMenu, setShowStrategyMenu] = useState(false);
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState('');
  const [highlightedIndicatorIndex, setHighlightedIndicatorIndex] = useState(-1);
  const [highlightedStrategyIndex, setHighlightedStrategyIndex] = useState(-1);
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([]);
  /** Bumps when ChartEngine is (re)created so indicator reconcile runs against the new instance. */
  const [engineVersion, setEngineVersion] = useState(0);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [paneLayout, setPaneLayout] = useState<Array<{ paneId: string; top: number; height: number; yScaleMode: YScaleMode; showScaleControls: boolean; collapsed: boolean; maximized: boolean }>>([]);
  const [priceSectionHeight, setPriceSectionHeight] = useState(0);
  const [scriptSource, setScriptSource] = useState('');
  const [scriptErrors, setScriptErrors] = useState<string[]>([]);
  const [draggingIndicatorId, setDraggingIndicatorId] = useState<string | null>(null);
  const [yAxisHovered, setYAxisHovered] = useState(false);
  const [chartNotice, setChartNotice] = useState<string | null>(null);
  const dragStateRef = useRef<{
    paneId: string;
    startY: number;
    startHeight: number;
  } | null>(null);

  const chartTypeMenuRef = useRef<HTMLDivElement>(null);
  const indicatorMenuRef = useRef<HTMLDivElement>(null);
  const strategyMenuRef = useRef<HTMLDivElement>(null);
  const indicatorSearchRef = useRef<HTMLInputElement>(null);
  const strategySearchRef = useRef<HTMLInputElement>(null);

  // Pull real data from the sidecar (same path as ChartPage)
  const { sidecarPort } = useTws();
  const {
    bars,
    source,
    datasetKey,
    onViewportChange,
    pendingViewportShift,
    onViewportShiftApplied,
    updateMode,
    tailChangeOffset,
  } = useChartData({
    symbol,
    timeframe,
    sidecarPort,
  });
  const stopperPx = (config.stopperPx as number) ?? 40;
  const lastDatasetKeyRef = useRef<string | null>(null);

  const handleCanvasPointerMove = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const ne = event.nativeEvent;
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    if (typeof ne.offsetX === 'number' && typeof ne.offsetY === 'number') {
      x = ne.offsetX;
      y = ne.offsetY;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
    } else {
      const rect = canvas.getBoundingClientRect();
      x = ne.clientX - rect.left;
      y = ne.clientY - rect.top;
      w = rect.width;
      h = rect.height;
    }
    const overYAxis = x >= w - PRICE_AXIS_WIDTH && y >= 0 && y <= h;
    setYAxisHovered(prev => prev === overYAxis ? prev : overYAxis);
  }, []);

  const handleCanvasPointerLeave = useCallback(() => {
    setYAxisHovered(false);
  }, []);

  // Price info
  const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
  const lastPrice = lastBar?.close ?? 0;
  const priceChange = lastBar && prevBar ? lastBar.close - prevBar.close : 0;
  const pctChange = prevBar ? (priceChange / prevBar.close) * 100 : 0;
  const isPositive = priceChange >= 0;

  // Initialize ChartEngine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new ChartEngine(canvas);
    engineRef.current = engine;
    setEngineVersion((v) => v + 1);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Handle resize
  const handleResize = useCallback(() => {
    const container = containerRef.current;
    const engine = engineRef.current;
    if (!container || !engine) return;
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    engine.resize(width, height);
    // Layout may change after resize, sync divider positions
    requestAnimationFrame(() => {
      const layout = engineRef.current?.getLayout();
      if (layout) {
        setPaneLayout(layout.subPanes.map(p => ({ paneId: p.paneId, top: p.top, height: p.height, yScaleMode: p.yScaleMode, showScaleControls: p.showScaleControls, collapsed: p.collapsed, maximized: p.maximized })));
        setPriceSectionHeight(layout.mainHeight);
      }
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    handleResize();
    return () => ro.disconnect();
  }, [handleResize]);

  // Re-sync canvas DPR on browser zoom changes (window.resize fires; ResizeObserver may not)
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // Sync pane layout for resize handles
  const syncPaneLayout = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const layout = engine.getLayout();
    setPaneLayout(layout.subPanes.map(p => ({ paneId: p.paneId, top: p.top, height: p.height, yScaleMode: p.yScaleMode, showScaleControls: p.showScaleControls, collapsed: p.collapsed, maximized: p.maximized })));
    setPriceSectionHeight(layout.mainHeight);
  }, []);

  useEffect(() => {
    syncPaneLayout();
  }, [activeIndicators, syncPaneLayout]);

  const handlePaneDividerMouseDown = useCallback((e: React.MouseEvent, paneId: string) => {
    e.preventDefault();
    const engine = engineRef.current;
    if (!engine) return;
    const layout = engine.getLayout();
    const pane = layout.subPanes.find(p => p.paneId === paneId);
    if (!pane) return;
    dragStateRef.current = { paneId, startY: e.clientY, startHeight: pane.height };

    const onMouseMove = (ev: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      // Dragging up = bigger pane (delta is negative, so negate)
      const delta = drag.startY - ev.clientY;
      const newHeight = drag.startHeight + delta;
      engineRef.current?.setSubPaneHeight(drag.paneId, newHeight);
      // Sync after engine re-layout
      requestAnimationFrame(() => {
        const layout = engineRef.current?.getLayout();
        if (layout) {
          setPaneLayout(layout.subPanes.map(p => ({ paneId: p.paneId, top: p.top, height: p.height, yScaleMode: p.yScaleMode, showScaleControls: p.showScaleControls, collapsed: p.collapsed, maximized: p.maximized })));
          setPriceSectionHeight(layout.mainHeight);
        }
      });
    };

    const onMouseUp = () => {
      dragStateRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [syncPaneLayout]);

  // Push data to engine using the same incremental path as the full chart
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const datasetChanged = lastDatasetKeyRef.current !== datasetKey;
    lastDatasetKeyRef.current = datasetKey;
    if (!datasetChanged && updateMode === 'tail' && bars.length > 0) {
      engine.updateTail(bars, tailChangeOffset);
    } else {
      engine.setData(bars);
    }
    syncPaneLayout();
  }, [bars, datasetKey, updateMode, tailChangeOffset, syncPaneLayout]);

  // Wire viewport change notifications so intraday pan backfill stays anchored
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setOnViewportChange(onViewportChange);
    return () => {
      engine.setOnViewportChange(null);
    };
  }, [onViewportChange]);

  useEffect(() => {
    if (!pendingViewportShift) return;
    const engine = engineRef.current;
    if (!engine) return;
    engine.shiftViewportBy(pendingViewportShift);
    syncPaneLayout();
    onViewportShiftApplied();
  }, [pendingViewportShift, onViewportShiftApplied, syncPaneLayout]);

  // Push chart type to engine
  useEffect(() => {
    engineRef.current?.setChartType(chartType);
  }, [chartType]);

  // Push timeframe to engine
  useEffect(() => {
    engineRef.current?.resetViewport();
    engineRef.current?.setTimeframe(timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (lastDatasetKeyRef.current === null) {
      lastDatasetKeyRef.current = datasetKey;
      return;
    }
    engineRef.current?.resetViewport();
    onViewportShiftApplied();
  }, [datasetKey, onViewportShiftApplied]);

  // Push Y-scale mode to engine
  useEffect(() => {
    engineRef.current?.setYScaleMode(yScaleMode);
  }, [yScaleMode]);

  useEffect(() => {
    engineRef.current?.setBrandingMode('fullLogo');
  }, []);

  useEffect(() => {
    engineRef.current?.setBrandingSymbol(symbol);
    engineRef.current?.resetViewport();
  }, [symbol]);

  // Live mode + stopper
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setLiveMode(source === 'tws');
    engine.setStopperPx(stopperPx);
  }, [source, stopperPx]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (chartTypeMenuRef.current && !chartTypeMenuRef.current.contains(e.target as Node)) {
        setShowChartTypeMenu(false);
      }
      if (indicatorMenuRef.current && !indicatorMenuRef.current.contains(e.target as Node)) {
        setShowIndicatorMenu(false);
        setIndicatorSearch('');
      }
      if (strategyMenuRef.current && !strategyMenuRef.current.contains(e.target as Node)) {
        setShowStrategyMenu(false);
        setIndicatorSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus indicator search when opened
  useEffect(() => {
    if (showIndicatorMenu) {
      setTimeout(() => indicatorSearchRef.current?.focus(), 50);
    }
  }, [showIndicatorMenu]);

  useEffect(() => {
    if (showStrategyMenu) {
      setTimeout(() => strategySearchRef.current?.focus(), 50);
    }
  }, [showStrategyMenu]);

  const setTimeframeValue = (tf: Timeframe) => {
    onConfigChange({ ...configRef.current, timeframe: tf });
  };

  const setChartTypeValue = (ct: ChartType) => {
    onConfigChange({ ...configRef.current, chartType: ct });
    setShowChartTypeMenu(false);
  };

  const setYScaleModeValue = (mode: YScaleMode) => {
    onConfigChange({ ...configRef.current, yScaleMode: mode });
  };

  // Filtered indicators for search
  const allIndicators = useMemo(
    () => Object.entries(indicatorRegistry)
      .filter(([key]) => !HIDDEN_INDICATOR_KEYS.has(key))
      .map(([key, meta]) => ({ key, ...meta })),
    [],
  );
  const filteredIndicators = useMemo(() => {
    if (!indicatorSearch.trim()) return allIndicators;
    const q = indicatorSearch.toLowerCase();
    return allIndicators.filter(
      (ind) => ind.name.toLowerCase().includes(q) || ind.shortName.toLowerCase().includes(q),
    );
  }, [indicatorSearch, allIndicators]);
  const standardIndicators = useMemo(
    () => filteredIndicators.filter((ind) => !STRATEGY_KEYS.has(ind.key)),
    [filteredIndicators],
  );
  const strategyIndicators = useMemo(
    () => filteredIndicators.filter((ind) => STRATEGY_KEYS.has(ind.key)),
    [filteredIndicators],
  );
  const activeStrategyCount = useMemo(
    () => activeIndicators.filter((ind) => STRATEGY_KEYS.has(ind.name)).length,
    [activeIndicators],
  );
  const activeStandardIndicatorCount = useMemo(
    () => activeIndicators.filter((ind) => !STRATEGY_KEYS.has(ind.name)).length,
    [activeIndicators],
  );
  const activeToolbarTextColor = '#60A5FA';

  const currentChartType = CHART_TYPES.find((ct) => ct.value === chartType);
  const emptyScripts = useMemo(() => new Map(), []);
  const indicatorColorDefaults =
    (config.indicatorColorDefaults as Record<string, Record<string, string>> | undefined) ?? {};
  const persistedIndicators = useMemo(() => {
    if (!Object.prototype.hasOwnProperty.call(config, 'indicators')) {
      return getDefaultMiniIndicators();
    }
    return parsePersistedIndicators(config.indicators);
  }, [config]);

  const persistedScript = useMemo(() => {
    const scripts = config.scripts;
    if (!Array.isArray(scripts) || scripts.length === 0) return null;
    const s = scripts[0];
    if (!isRecord(s) || typeof s.source !== 'string') return null;
    return { id: typeof s.id === 'string' ? s.id : SCRIPT_ID, source: s.source };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.scripts]);

  const persistedIndicatorsFingerprint = useMemo(
    () => buildIndicatorFingerprint(persistedIndicators),
    [persistedIndicators],
  );

  useEffect(() => {
    setHighlightedIndicatorIndex(standardIndicators.length > 0 ? 0 : -1);
  }, [standardIndicators, showIndicatorMenu]);

  useEffect(() => {
    setHighlightedStrategyIndex(strategyIndicators.length > 0 ? 0 : -1);
  }, [strategyIndicators, showStrategyMenu]);

  useEffect(() => {
    if (!showIndicatorMenu || highlightedIndicatorIndex < 0) return;
    const item = indicatorMenuRef.current?.querySelector<HTMLElement>(
      `[data-indicator-option-index="${highlightedIndicatorIndex}"]`,
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [showIndicatorMenu, highlightedIndicatorIndex]);

  useEffect(() => {
    if (!showStrategyMenu || highlightedStrategyIndex < 0) return;
    const item = strategyMenuRef.current?.querySelector<HTMLElement>(
      `[data-strategy-option-index="${highlightedStrategyIndex}"]`,
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [showStrategyMenu, highlightedStrategyIndex]);

  const syncIndicatorsFromEngine = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return [] as ActiveIndicator[];
    const nextIndicators = [...engine.getActiveIndicators()];
    hasHydratedIndicatorsRef.current = true;
    setActiveIndicators(nextIndicators);
    return nextIndicators;
  }, []);

  const syncIndicators = useCallback((persist = true) => {
    const nextIndicators = syncIndicatorsFromEngine();
    if (persist) {
      onConfigChange({
        ...configRef.current,
        indicators: serializeIndicators(nextIndicators),
      });
    }
  }, [onConfigChange, syncIndicatorsFromEngine]);

  const applyPersistedIndicators = useCallback((
    engine: ChartEngine,
    indicatorsToApply: PersistedMiniIndicator[],
  ) => {
    for (const indicator of [...engine.getActiveIndicators()]) {
      engine.removeIndicator(indicator.id);
    }

    for (const indicator of indicatorsToApply) {
      const id = engine.addIndicator(indicator.name);
      if (!id) continue;
      engine.setIndicatorPane(
        id,
        indicator.name === 'Probability Engine' ? 'main' : indicator.paneId,
      );
      if (Object.keys(indicator.params).length > 0) {
        engine.updateIndicatorParams(id, indicator.params);
      }
      if (Object.keys(indicator.textParams ?? {}).length > 0) {
        engine.updateIndicatorTextParams(id, indicator.textParams ?? {});
      }
      const mergedColors = {
        ...(indicatorColorDefaults[indicator.name] ?? {}),
        ...indicator.colors,
      };
      for (const [outputKey, color] of Object.entries(mergedColors)) {
        engine.updateIndicatorColor(id, outputKey, color);
      }
      for (const [outputKey, width] of Object.entries(indicator.lineWidths ?? {})) {
        engine.updateIndicatorLineWidth(id, outputKey, width);
      }
      for (const [outputKey, style] of Object.entries(indicator.lineStyles ?? {})) {
        engine.updateIndicatorLineStyle(id, outputKey, style);
      }
      engine.setIndicatorVisibility(id, indicator.visible);
    }
  }, [indicatorColorDefaults]);

  const persistedIndicatorsMatch = useCallback((
    expectedIndicators: PersistedMiniIndicator[],
    engineIndicators: ActiveIndicator[],
  ) => {
    if (expectedIndicators.length !== engineIndicators.length) return false;
    return expectedIndicators.every((expectedIndicator, index) => {
      const engineIndicator = engineIndicators[index];
      if (!engineIndicator) return false;
      return expectedIndicator.name === engineIndicator.name
        && expectedIndicator.paneId === engineIndicator.paneId
        && expectedIndicator.visible === engineIndicator.visible
        && recordsEqual(expectedIndicator.params, engineIndicator.params)
        && recordsEqual(expectedIndicator.textParams, engineIndicator.textParams)
        && recordsEqual(expectedIndicator.colors, engineIndicator.colors)
        && recordsEqual(expectedIndicator.lineWidths, engineIndicator.lineWidths)
        && recordsEqual(expectedIndicator.lineStyles, engineIndicator.lineStyles);
    });
  }, []);

  const syncDailyIQScorePane = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const engineIndicators = engine.getActiveIndicators();
    const diqSignals = engineIndicators.filter((indicator) => indicator.name === 'DailyIQ Tech Score Signal');
    if (diqSignals.length === 0) return;

    const shouldShowPane = diqSignals.some(
      (indicator) => indicator.visible && (indicator.params.showScorePane ?? 1) > 0,
    );
    let changed = false;
    let scoreIndicator = engineIndicators.find((indicator) => indicator.name === 'Technical Score');

    if (shouldShowPane) {
      if (!scoreIndicator) {
        const id = engine.addIndicator('Technical Score');
        if (id) {
          const defaults =
            (configRef.current.indicatorColorDefaults as Record<string, Record<string, string>> | undefined)?.['Technical Score'];
          if (defaults) {
            for (const [outputKey, color] of Object.entries(defaults)) {
              engine.updateIndicatorColor(id, outputKey, color);
            }
          }
          engine.setIndicatorPane(id, makeDetachedPaneId());
          changed = true;
          scoreIndicator = engine.getActiveIndicators().find((indicator) => indicator.id === id);
        }
      } else if (!scoreIndicator.visible) {
        engine.setIndicatorVisibility(scoreIndicator.id, true);
        changed = true;
      }
    } else if (scoreIndicator?.visible) {
      engine.setIndicatorVisibility(scoreIndicator.id, false);
      changed = true;
    }

    if (changed) {
      syncIndicators();
    }
  }, [makeDetachedPaneId, syncIndicators]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || bars.length === 0) return;

    const engineIndicators = engine.getActiveIndicators();

    const fingerprintChanged = persistedIndicatorsFingerprint !== lastRestoredFingerprintRef.current;
    const needsRestore = engineIndicators.length === 0 && persistedIndicators.length > 0;
    if (fingerprintChanged || needsRestore) {
      if (!persistedIndicatorsMatch(persistedIndicators, engineIndicators)) {
        applyPersistedIndicators(engine, persistedIndicators);
      }
      lastRestoredFingerprintRef.current = persistedIndicatorsFingerprint;
      syncIndicatorsFromEngine();
    } else if (!hasHydratedIndicatorsRef.current && engineIndicators.length > 0) {
      syncIndicatorsFromEngine();
    } else if (persistedIndicators.length === 0 && engineIndicators.length === 0) {
      hasHydratedIndicatorsRef.current = true;
      setActiveIndicators([]);
    }

    if (persistedScript) {
      const result = interpretScript(persistedScript.source, bars);
      engine.setScriptResult(persistedScript.id, result);
      setScriptSource(persistedScript.source);
    } else if (scriptSource) {
      engine.clearAllScripts();
      setScriptSource('');
      setScriptErrors([]);
    }
  }, [
    bars,
    persistedIndicators,
    persistedIndicatorsFingerprint,
    persistedScript,
    scriptSource,
    persistedIndicatorsMatch,
    applyPersistedIndicators,
    syncIndicatorsFromEngine,
  ]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || bars.length === 0 || !hasHydratedIndicatorsRef.current) return;

    const desiredIndicators = serializeIndicators(activeIndicators);
    const engineIndicators = engine.getActiveIndicators();

    if (desiredIndicators.length === 0) {
      if (engineIndicators.length > 0) {
        applyPersistedIndicators(engine, desiredIndicators);
        syncIndicatorsFromEngine();
      }
      return;
    }

    if (persistedIndicatorsMatch(desiredIndicators, engineIndicators)) return;

    applyPersistedIndicators(engine, desiredIndicators);
    syncIndicatorsFromEngine();
  }, [
    bars,
    engineVersion,
    activeIndicators,
    persistedIndicatorsMatch,
    applyPersistedIndicators,
    syncIndicatorsFromEngine,
  ]);

  useEffect(() => {
    syncDailyIQScorePane();
  }, [activeIndicators, syncDailyIQScorePane]);

  const addIndicator = (name: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const id = engine.addIndicator(name);
    if (id) {
      const defaults =
        (config.indicatorColorDefaults as Record<string, Record<string, string>> | undefined)?.[name];
      if (defaults) {
        for (const [outputKey, color] of Object.entries(defaults)) {
          engine.updateIndicatorColor(id, outputKey, color);
        }
      }
    }
    syncIndicators();
  };

  const handleIndicatorMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setShowIndicatorMenu(false);
      setIndicatorSearch('');
      return;
    }

    if (standardIndicators.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndicatorIndex((prev) => (prev + 1) % standardIndicators.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndicatorIndex((prev) => (prev <= 0 ? standardIndicators.length - 1 : prev - 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const item = standardIndicators[highlightedIndicatorIndex];
      if (item) {
        addIndicator(item.key);
      }
    }
  }, [standardIndicators, highlightedIndicatorIndex]);

  const toggleStrategy = (name: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const matches = engine.getActiveIndicators().filter((indicator) => indicator.name === name);
    if (matches.length > 0) {
      for (const match of matches) {
        engine.removeIndicator(match.id);
      }
      syncIndicators();
      return;
    }

    const id = engine.addIndicator(name);
    if (id) {
      const defaults =
        (config.indicatorColorDefaults as Record<string, Record<string, string>> | undefined)?.[name];
      if (defaults) {
        for (const [outputKey, color] of Object.entries(defaults)) {
          engine.updateIndicatorColor(id, outputKey, color);
        }
      }
    }
    syncIndicators();
  };

  const handleStrategyMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setShowStrategyMenu(false);
      setIndicatorSearch('');
      return;
    }

    if (strategyIndicators.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedStrategyIndex((prev) => (prev + 1) % strategyIndicators.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedStrategyIndex((prev) => (prev <= 0 ? strategyIndicators.length - 1 : prev - 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const item = strategyIndicators[highlightedStrategyIndex];
      if (item) {
        toggleStrategy(item.key);
      }
    }
  }, [strategyIndicators, highlightedStrategyIndex]);

  const removeIndicator = (id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.removeIndicator(id);
    syncIndicators();
  };

  const updateIndicatorParams = (id: string, params: Record<string, number>) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorParams(id, params);
    syncIndicators();
  };

  const updateIndicatorTextParams = (id: string, textParams: Record<string, string>) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorTextParams(id, textParams);
    syncIndicators();
  };

  const updateIndicatorColor = (id: string, outputKey: string, color: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorColor(id, outputKey, color);
    syncIndicators();
  };

  const updateIndicatorLineWidth = (id: string, outputKey: string, width: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorLineWidth(id, outputKey, width);
    syncIndicators();
  };

  const updateIndicatorLineStyle = (
    id: string,
    outputKey: string,
    style: 'solid' | 'dashed' | 'dotted',
  ) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorLineStyle(id, outputKey, style);
    syncIndicators();
  };

  const toggleIndicatorVisibility = (id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.toggleVisibility(id);
    syncIndicators();
  };

  const moveIndicator = (id: string, direction: 'up' | 'down') => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.moveIndicator(id, direction);
    syncIndicators();
  };

  const moveIndicatorToPane = (id: string, paneId: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setIndicatorPane(id, paneId);
    if (paneId !== 'main') {
      engine.expandPane(paneId);
    }
    syncIndicators();
    syncPaneLayout();
  };

  const runScript = useCallback((source: string) => {
    const engine = engineRef.current;
    if (!engine || bars.length === 0) return;
    const result = interpretScript(source, bars);
    setScriptErrors(result.errors.map((e) => `Line ${e.line}: ${e.message}`));
    engine.setScriptResult(SCRIPT_ID, result);
    onConfigChange({ ...configRef.current, scripts: [{ id: SCRIPT_ID, source }] });
  }, [bars, onConfigChange]);

  const clearScript = useCallback(() => {
    engineRef.current?.clearAllScripts();
    setScriptSource('');
    setScriptErrors([]);
    onConfigChange({ ...configRef.current, scripts: [] });
  }, [onConfigChange]);

  useEffect(() => {
    if (!chartNotice) return;
    const timer = window.setTimeout(() => setChartNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [chartNotice]);

  const handleExportChart = useCallback(async () => {
    const ok = await exportChartConfigToFile(miniChartConfigToDailyIqChartConfig(configRef.current, linkChannel));
    if (!ok) {
      setChartNotice('Chart export failed.');
    } else {
      setChartNotice('Chart exported.');
    }
  }, [linkChannel]);

  const handleImportChart = useCallback(async () => {
    const result = await importChartConfigFromFile();
    if (result.status === 'canceled') {
      return;
    }
    if (result.status !== 'success') {
      setChartNotice(result.status === 'invalid' ? 'Invalid .diqc file.' : 'Chart import failed.');
      return;
    }

    const importedConfig = dailyIqChartConfigToMiniChartConfig(result.file.chart);
    lastRestoredFingerprintRef.current = '';
    hasHydratedIndicatorsRef.current = false;
    setActiveIndicators([]);
    setScriptSource('');
    setScriptErrors([]);
    onSetLinkChannel(result.file.chart.linkChannel);
    onConfigChange(importedConfig);
    setChartNotice('Chart imported.');
  }, [onConfigChange, onSetLinkChannel]);

  return (
    <div
      className="relative flex h-full w-full min-h-[200px] min-w-[240px] flex-col overflow-hidden rounded-none border border-white/[0.06] bg-panel"
    >
      {chartNotice && (
        <div className="pointer-events-none absolute left-1/2 top-8 z-20 -translate-x-1/2">
          <div
            style={{
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.08)',
              backgroundColor: '#161B22',
              padding: '5px 8px',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 9,
              color: 'rgba(255,255,255,0.8)',
              boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
            }}
          >
            {chartNotice}
          </div>
        </div>
      )}

      {/* Toolbar: symbol on the left, controls on the right */}
      <div
        className="flex h-9 shrink-0 select-none items-center justify-between border-b border-white/[0.10] bg-base px-2"
      >
        {/* Left: symbol + price */}
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 11,
              fontWeight: 600,
              color: '#E6EDF3',
              whiteSpace: 'nowrap',
            }}
          >
            {symbol}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 11,
              color: '#E6EDF3',
              whiteSpace: 'nowrap',
            }}
          >
            {lastPrice.toFixed(2)}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 11,
              color: isPositive ? '#00C853' : '#FF3D71',
              whiteSpace: 'nowrap',
            }}
          >
            {isPositive ? '+' : ''}{pctChange.toFixed(2)}%
          </span>
        </div>

        {/* Right: timeframes + chart tools + window controls + link */}
        <div className="flex items-center gap-0.5 shrink-0">
          {!toolbarCollapsed && (<>
          {/* Timeframe buttons */}
          {MINI_TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => { setTimeframeValue(tf.value); }}
              className="rounded-sm transition-colors duration-75 hover:bg-white/[0.06]"
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 11,
                padding: '2px 5px',
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: timeframe === tf.value ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                color: timeframe === tf.value ? '#3B82F6' : '#FFFFFF',
                lineHeight: 1,
              }}
            >
              {tf.label}
            </button>
          ))}

          <div className="mx-0.5 h-3 w-px bg-white/[0.08]" />

          {/* Chart type dropdown */}
          <div className="relative" ref={chartTypeMenuRef}>
            <button
              onClick={() => {
                setShowChartTypeMenu((v) => !v);
                setShowIndicatorMenu(false);
                setShowStrategyMenu(false);
              }}
              className="flex items-center gap-0.5 rounded-sm transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/60"
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 10,
                padding: '3px 7px',
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: showChartTypeMenu ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: '#FFFFFF',
                lineHeight: 1,
              }}
              title="Chart type"
            >
              {currentChartType?.short ?? 'Candle'}
              <ChevronDown size={8} />
            </button>

            {showChartTypeMenu && (
              <div
                className="absolute z-50"
                style={{
                  top: '100%',
                  right: 0,
                  marginTop: 2,
                  backgroundColor: '#161B22',
                  border: '1px solid #21262D',
                  borderRadius: 4,
                  padding: 2,
                  minWidth: 120,
                }}
              >
                {CHART_TYPES.map((ct) => (
                  <button
                    key={ct.value}
                    onClick={() => setChartTypeValue(ct.value)}
                    className="flex items-center justify-between w-full px-2 py-1 hover:bg-[#1C2128] text-left"
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10,
                      color: chartType === ct.value ? '#E6EDF3' : '#8B949E',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      borderRadius: 2,
                    }}
                  >
                    <span>{ct.label}</span>
                    {chartType === ct.value && (
                      <span style={{ color: '#1A56DB', fontSize: 8 }}>●</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Indicator button */}
          <div className="relative" ref={indicatorMenuRef}>
            <button
              onClick={() => {
                setShowIndicatorMenu((v) => !v);
                setShowStrategyMenu(false);
                setShowChartTypeMenu(false);
                setIndicatorSearch('');
              }}
              className="flex items-center gap-1 rounded-sm transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/60"
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 10,
                padding: '3px 7px',
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: showIndicatorMenu ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: activeStandardIndicatorCount > 0 ? activeToolbarTextColor : '#FFFFFF',
                lineHeight: 1,
              }}
              title="Indicators"
            >
              <TrendingUp size={10} />
              <span>Indicators</span>
              {activeStandardIndicatorCount > 0 && (
                <span style={{ fontSize: 8, color: '#60A5FA' }}>{activeStandardIndicatorCount}</span>
              )}
            </button>

            {showIndicatorMenu && (
              <div
                className="absolute z-50"
                style={{
                  top: '100%',
                  right: 0,
                  marginTop: 2,
                  backgroundColor: '#161B22',
                  border: '1px solid #21262D',
                  borderRadius: 4,
                  width: 220,
                }}
              >
                {/* Search */}
                <div
                  className="flex items-center gap-1.5 px-2 py-1.5"
                  style={{ borderBottom: '1px solid #21262D' }}
                >
                  <Search size={10} style={{ color: '#484F58', flexShrink: 0 }} />
                  <input
                    ref={indicatorSearchRef}
                    type="text"
                    value={indicatorSearch}
                    onChange={(e) => setIndicatorSearch(e.target.value)}
                    onKeyDown={handleIndicatorMenuKeyDown}
                    placeholder="Search indicators..."
                    spellCheck={false}
                    data-no-drag
                    style={{
                      flex: 1,
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10,
                      color: '#E6EDF3',
                    }}
                  />
                </div>

                {/* Indicator list */}
                <div className="scrollbar-panel" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {INDICATOR_CATEGORIES.map((cat) => {
                    const items = standardIndicators.filter((ind) => ind.category === cat.key);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat.key}>
                        <div
                          style={{
                            padding: '4px 8px 2px',
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: 8,
                            color: '#484F58',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {cat.label}
                        </div>
                        {items.map((ind) => {
                          const isActive = activeIndicators.some((ai) => ai.name === ind.key);
                          const optionIndex = standardIndicators.findIndex((item) => item.key === ind.key);
                          const isHighlighted = optionIndex === highlightedIndicatorIndex;
                          return (
                            <button
                              key={ind.key}
                              onClick={() => addIndicator(ind.key)}
                              data-indicator-option-index={optionIndex}
                              onMouseEnter={() => setHighlightedIndicatorIndex(optionIndex)}
                              className="flex items-center justify-between w-full px-2 py-1 hover:bg-[#1C2128] text-left"
                              style={{
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: 10,
                                color: isActive ? '#E6EDF3' : '#8B949E',
                                border: 'none',
                                background: isHighlighted ? '#1C2128' : 'none',
                                cursor: 'pointer',
                                borderRadius: 2,
                              }}
                            >
                              <span>{ind.name}</span>
                              <span style={{ fontSize: 8, color: '#484F58' }}>{ind.shortName}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                  {standardIndicators.length === 0 && (
                    <div style={{
                      padding: '12px 8px',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10,
                      color: '#484F58',
                      textAlign: 'center',
                    }}>
                      No indicators found
                    </div>
                  )}
                </div>
                {/* Custom script button */}
                <div style={{ borderTop: '1px solid #21262D', padding: '4px 6px 4px' }}>
                  <button
                    onClick={() => { setShowScriptEditor((v) => !v); setShowIndicatorMenu(false); }}
                    className="flex items-center justify-between w-full px-1 py-1 hover:bg-[#1C2128] rounded"
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10,
                      color: persistedScript ? '#8B5CF6' : '#8B949E',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      borderRadius: 2,
                    }}
                  >
                    <span>Custom Script</span>
                    {persistedScript && <span style={{ fontSize: 8, color: '#8B5CF6' }}>●</span>}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="relative" ref={strategyMenuRef}>
            <button
              onClick={() => {
                setShowStrategyMenu((v) => !v);
                setShowIndicatorMenu(false);
                setShowChartTypeMenu(false);
                setIndicatorSearch('');
              }}
              className="flex items-center gap-1 rounded-sm transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/60"
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 10,
                padding: '3px 7px',
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: showStrategyMenu ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: activeStrategyCount > 0 ? activeToolbarTextColor : '#FFFFFF',
                lineHeight: 1,
              }}
              title="Strategies"
            >
              <BrainCircuit size={10} />
              <span>Strategies</span>
              {activeStrategyCount > 0 && (
                <span style={{ fontSize: 8, color: '#1A56DB' }}>{activeStrategyCount}</span>
              )}
            </button>

            {showStrategyMenu && (
              <div
                className="absolute z-50"
                style={{
                  top: '100%',
                  right: 0,
                  marginTop: 2,
                  backgroundColor: '#161B22',
                  border: '1px solid #21262D',
                  borderRadius: 4,
                  width: 220,
                }}
              >
                <div
                  className="flex items-center gap-1.5 px-2 py-1.5"
                  style={{ borderBottom: '1px solid #21262D' }}
                >
                  <Search size={10} style={{ color: '#484F58', flexShrink: 0 }} />
                  <input
                    ref={strategySearchRef}
                    type="text"
                    value={indicatorSearch}
                    onChange={(e) => setIndicatorSearch(e.target.value)}
                    onKeyDown={handleStrategyMenuKeyDown}
                    placeholder="Search strategies..."
                    spellCheck={false}
                    data-no-drag
                    style={{
                      flex: 1,
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10,
                      color: '#E6EDF3',
                    }}
                  />
                </div>

                <div className="scrollbar-panel" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {strategyIndicators.map((ind) => {
                    const isActive = activeIndicators.some((ai) => ai.name === ind.key);
                    const optionIndex = strategyIndicators.findIndex((item) => item.key === ind.key);
                    const isHighlighted = optionIndex === highlightedStrategyIndex;
                    return (
                      <button
                        key={ind.key}
                        onClick={() => toggleStrategy(ind.key)}
                        data-strategy-option-index={optionIndex}
                        onMouseEnter={() => setHighlightedStrategyIndex(optionIndex)}
                        className="flex items-center justify-between w-full px-2 py-1 hover:bg-[#1C2128] text-left"
                        style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: 10,
                          color: isActive ? '#E6EDF3' : '#8B949E',
                          border: 'none',
                          background: isHighlighted ? '#1C2128' : 'none',
                          cursor: 'pointer',
                          borderRadius: 2,
                        }}
                      >
                        <span>{ind.name}</span>
                        <span style={{ fontSize: 8, color: '#484F58' }}>{ind.shortName}</span>
                      </button>
                    );
                  })}
                  {strategyIndicators.length === 0 && (
                    <div style={{
                      padding: '12px 8px',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10,
                      color: '#484F58',
                      textAlign: 'center',
                    }}>
                      No strategies found
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => engineRef.current?.resetZoom()}
            className="flex items-center justify-center rounded-sm text-white transition-colors duration-75 hover:bg-white/[0.06] hover:text-white"
            style={{
              width: 16,
              height: 16,
              borderRadius: 2,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
            title="Reset zoom"
          >
            <RotateCcw size={13} />
          </button>

          {source === 'tws' && (
            <div className="flex items-center gap-0.5 ml-1">
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 8,
                  color: '#8B949E',
                }}
              >
                Stop
              </span>
              <input
                type="number"
                min={0}
                max={200}
                value={stopperPx}
                onChange={(e) => {
                  const next = Math.max(0, Math.min(200, Number(e.target.value) || 0));
                  onConfigChange({ ...configRef.current, stopperPx: next });
                }}
                style={{
                  width: 36,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid #21262D',
                  outline: 'none',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 8,
                  color: '#8B949E',
                  textAlign: 'right',
                  padding: 0,
                }}
              />
            </div>
          )}

          </>)}

          {/* Compact mode toggle */}
          <button
            onClick={() => { void handleImportChart(); }}
            className="flex items-center justify-center rounded-sm text-white transition-colors duration-75 hover:bg-white/[0.06] hover:text-white"
            style={{
              width: 16,
              height: 16,
              borderRadius: 2,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
            title="Import .diqc"
          >
            <FolderOpen size={13} strokeWidth={2} />
          </button>
          <button
            onClick={() => { void handleExportChart(); }}
            className="flex items-center justify-center rounded-sm text-white transition-colors duration-75 hover:bg-white/[0.06] hover:text-white"
            style={{
              width: 16,
              height: 16,
              borderRadius: 2,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
            title="Export .diqc"
          >
            <Save size={13} strokeWidth={2} />
          </button>

          <button
            onClick={() => setToolbarCollapsed(v => !v)}
            className="rounded-sm p-0 text-white transition-colors duration-75 hover:bg-white/[0.06] hover:text-white"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, padding: 0, border: 'none', cursor: 'pointer',
              backgroundColor: toolbarCollapsed ? 'rgba(255,255,255,0.06)' : 'transparent',
              color: '#FFFFFF', borderRadius: 2,
            }}
            title={toolbarCollapsed ? 'Show controls' : 'Compact mode'}
          >
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, lineHeight: 1 }}>
              {toolbarCollapsed ? '▶' : '◀'}
            </span>
          </button>

          {/* Separator */}
          <div className="mx-px h-3 w-px bg-white/[0.08]" />

          <ComponentLinkMenu
            linkChannel={linkChannel}
            onSetLinkChannel={onSetLinkChannel}
          />

          {/* Close */}
          <button
            onClick={onClose}
            className="rounded-sm p-0 text-white transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              padding: 0,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: 'transparent',
              color: '#FFFFFF',
              borderRadius: 2,
            }}
            title="Close"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Script editor panel */}
      {showScriptEditor && (
        <div
          className="shrink-0"
          style={{
            backgroundColor: '#161B22',
            borderBottom: '1px solid #21262D',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <textarea
            value={scriptSource}
            onChange={(e) => setScriptSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                runScript(scriptSource);
              }
            }}
            spellCheck={false}
            data-no-drag
            placeholder={`// DailyIQ Script\n// Series: open, high, low, close, volume\nplot(sma(close, 20), title="SMA20", color=#1A56DB)`}
            style={{
              width: '100%',
              height: 80,
              resize: 'none',
              backgroundColor: '#0D1117',
              border: '1px solid #21262D',
              borderRadius: 4,
              outline: 'none',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10,
              color: '#E6EDF3',
              padding: '4px 6px',
              lineHeight: 1.5,
              boxSizing: 'border-box',
            }}
          />
          {scriptErrors.length > 0 && (
            <div style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 9,
              color: '#FF3D71',
              maxHeight: 36,
              overflowY: 'auto',
              lineHeight: 1.4,
            }}>
              {scriptErrors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => runScript(scriptSource)}
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 9,
                padding: '2px 8px',
                backgroundColor: '#1A56DB',
                color: '#E6EDF3',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Run
            </button>
            <button
              onClick={clearScript}
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 9,
                padding: '2px 8px',
                backgroundColor: 'transparent',
                color: '#8B949E',
                border: '1px solid #21262D',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
            <span style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 8,
              color: '#484F58',
              marginLeft: 'auto',
            }}>
              Ctrl+Enter to run
            </span>
          </div>
        </div>
      )}

      {/* Chart canvas area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          onMouseMove={handleCanvasPointerMove}
          onMouseLeave={handleCanvasPointerLeave}
          style={{ cursor: yAxisHovered ? 'ns-resize' : 'crosshair' }}
        />

        {draggingIndicatorId && (
          <>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                moveIndicatorToPane(draggingIndicatorId, 'main');
                setDraggingIndicatorId(null);
              }}
              style={{
                position: 'absolute',
                left: 0,
                right: PRICE_AXIS_WIDTH,
                top: 0,
                height: Math.max(0, (paneLayout[0]?.top ?? containerRef.current?.offsetHeight ?? 0) - 1),
                border: '1px dashed rgba(26,86,219,0.5)',
                backgroundColor: 'rgba(26,86,219,0.08)',
                color: '#8B949E',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 10,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'flex-end',
                padding: 6,
                zIndex: 30,
                pointerEvents: 'auto',
              }}
            >
              Overlay on Price
            </div>
            {paneLayout.map((pane) => (
              <div
                key={`${pane.paneId}-drop`}
                onDragEnter={() => {
                  const engine = engineRef.current;
                  if (!engine || !pane.collapsed) return;
                  engine.expandPane(pane.paneId);
                  syncPaneLayout();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  const engine = engineRef.current;
                  if (!engine || !pane.collapsed) return;
                  engine.expandPane(pane.paneId);
                  syncPaneLayout();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  moveIndicatorToPane(draggingIndicatorId, pane.paneId);
                  setDraggingIndicatorId(null);
                }}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: PRICE_AXIS_WIDTH,
                  top: pane.top,
                  height: pane.height,
                  border: '1px dashed rgba(139,148,158,0.35)',
                  backgroundColor: 'rgba(139,148,158,0.06)',
                  color: '#8B949E',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 6,
                  zIndex: 31,
                  pointerEvents: 'auto',
                }}
              >
                Merge Pane
              </div>
            ))}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                moveIndicatorToPane(draggingIndicatorId, makeDetachedPaneId());
                setDraggingIndicatorId(null);
              }}
              style={{
                position: 'absolute',
                left: 0,
                right: PRICE_AXIS_WIDTH,
                bottom: source === 'tws' ? 24 : 4,
                height: 20,
                borderTop: '1px dashed rgba(245,158,11,0.5)',
                backgroundColor: 'rgba(245,158,11,0.08)',
                color: '#F59E0B',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 30,
                pointerEvents: 'auto',
              }}
            >
              New Pane
            </div>
          </>
        )}
        {/* Per-sub-pane action buttons (top-right) */}
        {paneLayout.map((pane, idx) => (
          <div
            key={`pane-actions-${pane.paneId}`}
            style={{
              position: 'absolute',
              right: PRICE_AXIS_WIDTH + 4,
              top: pane.top + (pane.collapsed ? 1 : 6),
              display: 'flex',
              alignItems: 'center',
              gap: pane.collapsed ? 1 : 2,
              zIndex: 20,
              opacity: 0.4,
              transition: 'opacity 120ms ease-out',
              pointerEvents: draggingIndicatorId ? 'none' : 'auto',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
          >
            {(['up', 'down'] as const).map((dir) => {
              const disabled = dir === 'up' ? idx === 0 : idx === paneLayout.length - 1;
              return (
                <button
                  key={dir}
                  onClick={() => { engineRef.current?.movePane(pane.paneId, dir); syncPaneLayout(); }}
                  disabled={disabled}
                  title={dir === 'up' ? 'Move pane up' : 'Move pane down'}
                  style={{
                    width: pane.collapsed ? 16 : 18, height: pane.collapsed ? 16 : 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 3, border: 'none', background: 'transparent',
                    color: disabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)',
                    cursor: disabled ? 'default' : 'pointer',
                    padding: 0,
                  }}
                  onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  {dir === 'up' ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              );
            })}
            <button
              onClick={() => {
                if (pane.collapsed) engineRef.current?.expandPane(pane.paneId);
                else engineRef.current?.collapsePane(pane.paneId);
                syncPaneLayout();
              }}
              title={pane.collapsed ? 'Expand pane' : 'Collapse pane'}
              style={{
                width: pane.collapsed ? 16 : 18, height: pane.collapsed ? 16 : 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 3, border: 'none', background: 'transparent',
                color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {pane.collapsed ? <ChevronsUpDown size={11} /> : <Minus size={12} strokeWidth={2.25} />}
            </button>
            <button
              onClick={() => {
                if (pane.maximized) engineRef.current?.unmaximizePane();
                else engineRef.current?.maximizePane(pane.paneId);
                syncPaneLayout();
              }}
              title={pane.maximized ? 'Restore pane' : 'Maximize pane'}
              style={{
                width: pane.collapsed ? 16 : 18, height: pane.collapsed ? 16 : 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 3, border: 'none', background: 'transparent',
                color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Maximize2 size={11} />
            </button>
            <button
              onClick={() => { engineRef.current?.removePane(pane.paneId); syncPaneLayout(); }}
              title="Delete pane"
              style={{
                width: pane.collapsed ? 16 : 18, height: pane.collapsed ? 16 : 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 3, border: 'none', background: 'transparent',
                color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(248,113,113,0.7)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'; }}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        {/* Draggable sub-pane dividers */}
        {paneLayout.map((pane) => (
          <div
            key={pane.paneId}
            onMouseDown={(e) => handlePaneDividerMouseDown(e, pane.paneId)}
            onMouseEnter={(e) => {
              (e.currentTarget.firstElementChild as HTMLElement).style.backgroundColor = '#1A56DB';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget.firstElementChild as HTMLElement).style.backgroundColor = '#21262D';
            }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: pane.top - 3,
              height: 7,
              cursor: 'ns-resize',
              zIndex: 10,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 3,
                height: 1,
                backgroundColor: '#21262D',
              }}
            />
          </div>
        ))}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: priceSectionHeight > 0 ? priceSectionHeight - PRICE_AXIS_CONTROL_HEIGHT : undefined,
            bottom: priceSectionHeight > 0 ? undefined : 24,
            width: PRICE_AXIS_WIDTH,
            height: PRICE_AXIS_CONTROL_HEIGHT,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.08)',
              backgroundColor: 'rgba(0,0,0,0.2)',
              padding: '2px 6px',
              backdropFilter: 'blur(4px)',
            }}
          >
            <button
              onClick={() => setYScaleModeValue(yScaleMode === 'auto' ? 'manual' : 'auto')}
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 8,
                width: 16,
                height: 16,
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: yScaleMode === 'auto' ? '#ffffff' : 'transparent',
                color: yScaleMode === 'auto' ? '#000000' : 'rgba(255,255,255,0.78)',
                lineHeight: 1,
              }}
              title="Auto scale"
            >
              A
            </button>
            <button
              onClick={() => setYScaleModeValue(yScaleMode === 'log' ? 'manual' : 'log')}
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 8,
                width: 16,
                height: 16,
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: yScaleMode === 'log' ? '#ffffff' : 'transparent',
                color: yScaleMode === 'log' ? '#000000' : 'rgba(255,255,255,0.78)',
                lineHeight: 1,
              }}
              title="Log scale"
            >
              L
            </button>
          </div>
        </div>
        {/* Per-sub-pane A / L scale mode buttons */}
        {paneLayout.filter((pane) => pane.height > 24 && !pane.collapsed && pane.showScaleControls).map((pane) => (
          <div
            key={pane.paneId}
            style={{
              position: 'absolute',
              right: 0,
              top: pane.top + pane.height - PRICE_AXIS_CONTROL_HEIGHT,
              width: PRICE_AXIS_WIDTH,
              height: PRICE_AXIS_CONTROL_HEIGHT,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.08)',
                backgroundColor: 'rgba(0,0,0,0.2)',
                padding: '2px 6px',
                backdropFilter: 'blur(4px)',
              }}
            >
              <button
                onClick={() => {
                  const next = pane.yScaleMode === 'auto' ? 'manual' : 'auto';
                  engineRef.current?.setSubPaneScaleMode(pane.paneId, next);
                  syncPaneLayout();
                }}
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 8,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: pane.yScaleMode === 'auto' ? '#ffffff' : 'transparent',
                  color: pane.yScaleMode === 'auto' ? '#000000' : 'rgba(255,255,255,0.78)',
                  lineHeight: 1,
                }}
                title="Auto scale"
              >
                A
              </button>
              <button
                onClick={() => {
                  const next = pane.yScaleMode === 'log' ? 'manual' : 'log';
                  engineRef.current?.setSubPaneScaleMode(pane.paneId, next);
                  syncPaneLayout();
                }}
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 8,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: pane.yScaleMode === 'log' ? '#ffffff' : 'transparent',
                  color: pane.yScaleMode === 'log' ? '#000000' : 'rgba(255,255,255,0.78)',
                  lineHeight: 1,
                }}
                title="Log scale"
              >
                L
              </button>
            </div>
          </div>
        ))}
        {source === 'tws' && (
          <div
            style={{
              position: 'absolute',
              right: 6,
              bottom: 4,
              height: 16,
              padding: '0 6px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              backgroundColor: 'rgba(13,17,23,0.7)',
              border: '1px solid rgba(33,38,45,0.7)',
              borderRadius: 3,
              backdropFilter: 'blur(2px)',
            }}
          >
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 8,
                color: '#8B949E',
              }}
            >
              Stop
            </span>
            <input
              type="range"
              min={0}
              max={200}
              step={2}
              value={stopperPx}
              onChange={(e) => {
                onConfigChange({ ...configRef.current, stopperPx: Number(e.target.value) });
              }}
              style={{ width: 70 }}
            />
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 8,
                color: '#8B949E',
              }}
            >
              {stopperPx}px
            </span>
          </div>
        )}
        <IndicatorLegend
          indicators={activeIndicators}
          activeScripts={emptyScripts}
          onUpdateParams={updateIndicatorParams}
          onUpdateTextParams={updateIndicatorTextParams}
          onUpdateColor={updateIndicatorColor}
          onUpdateLineWidth={updateIndicatorLineWidth}
          onUpdateLineStyle={updateIndicatorLineStyle}
          onRemove={removeIndicator}
          onToggleVisibility={toggleIndicatorVisibility}
          onMoveUp={(id) => moveIndicator(id, 'up')}
          onMoveDown={(id) => moveIndicator(id, 'down')}
          onDragStart={setDraggingIndicatorId}
          onDragEnd={() => setDraggingIndicatorId(null)}
          onSetDefaultColor={(indicatorName, outputKey, color) => {
            onConfigChange({
              ...config,
              indicatorColorDefaults: {
                ...indicatorColorDefaults,
                [indicatorName]: {
                  ...(indicatorColorDefaults[indicatorName] ?? {}),
                  [outputKey]: color,
                },
              },
            });
          }}
        />
      </div>
    </div>
  );
}

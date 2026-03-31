import { useState, useRef, useCallback, useEffect, useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Lock, Unlock } from 'lucide-react';
import type { Timeframe, ChartType, ActiveIndicator, ScriptResult, YScaleMode, ChartLayout } from '../chart/types';
import { ChartEngine } from '../chart/core/ChartEngine';
import { useChartData } from '../chart/hooks/useChartData';
import { useTws } from '../lib/tws';
import { linkBus } from '../lib/link-bus';
import ChartCanvas from '../chart/components/ChartCanvas';
import ChartToolbar from '../chart/components/ChartToolbar';
import IndicatorLegend from '../chart/components/IndicatorLegend';
import ScriptEditor from '../chart/components/ScriptEditor';
import { interpretScript } from '../chart/scripting/interpreter';
import {
  createDefaultPersistedChartIndicators,
  createDefaultProbEngWidgetState,
  loadChartState,
  saveChartState,
  type PersistedChartIndicator,
  type PersistedChartScript,
  type ChartState,
  type ProbEngWidgetState,
} from '../lib/chart-state';
import {
  chartStateToDailyIqChartConfig,
  dailyIqChartConfigToChartState,
} from '../lib/chart-config';
// DISABLED: import/export not yet functional
// import {
//   exportChartConfigToFile,
//   importChartConfigFromFile,
// } from '../lib/chart-config-storage';
import { VOLUME_PANE_RATIO, getTimeframeMs } from '../chart/constants';
import CustomStrategyModal from '../chart/components/CustomStrategyModal';
import {
  createDefaultCustomStrategy,
  evaluateCustomStrategy,
  type CustomStrategyDefinition,
  type CustomStrategyEvaluation,
} from '../chart/customStrategies';
import {
  loadCustomStrategies,
  saveCustomStrategies,
} from '../chart/customStrategyStorage';

interface ChartPageProps {
  tabId?: string;
}

const PROBENG_WIDGET_WIDTH = 188;
const PROBENG_WIDGET_WIDTH_DETAILED = 230;
const PROBENG_WIDGET_HEADER_HEIGHT = 24;
const PROBENG_WIDGET_EDGE_PADDING = 10;
const PROBENG_WIDGET_DRAG_THRESHOLD = 4;

function clampProbEngWidgetPosition(
  widget: ProbEngWidgetState,
  chartLayout: ChartLayout | null,
  hostWidth: number,
  chartToolRailWidth: number,
): ProbEngWidgetState {
  if (!chartLayout) return widget;
  const width = widget.detailed ? PROBENG_WIDGET_WIDTH_DETAILED : PROBENG_WIDGET_WIDTH;
  const minX = chartToolRailWidth + PROBENG_WIDGET_EDGE_PADDING;
  const maxX = Math.max(minX, hostWidth - chartLayout.priceAxisWidth - width - PROBENG_WIDGET_EDGE_PADDING);
  const minY = chartLayout.mainTop + PROBENG_WIDGET_EDGE_PADDING;
  const maxY = Math.max(minY, chartLayout.mainTop + chartLayout.mainHeight - PROBENG_WIDGET_HEADER_HEIGHT - PROBENG_WIDGET_EDGE_PADDING);
  return {
    ...widget,
    x: Math.min(Math.max(widget.x, minX), maxX),
    y: Math.min(Math.max(widget.y, minY), maxY),
  };
}

function getDefaultProbEngWidgetPosition(
  detailed: boolean,
  chartLayout: ChartLayout,
  hostWidth: number,
  chartToolRailWidth: number,
): Pick<ProbEngWidgetState, 'x' | 'y'> {
  const width = detailed ? PROBENG_WIDGET_WIDTH_DETAILED : PROBENG_WIDGET_WIDTH;
  const x = Math.max(chartToolRailWidth + 8, hostWidth - chartLayout.priceAxisWidth - width - 12);
  const y = chartLayout.mainTop + 12;
  return { x, y };
}

function getProbEngSourceLabel(source: number): string {
  switch (Math.round(source)) {
    case 1: return 'EMA5-20 %';
    case 2: return 'Close-EMA20 %';
    case 3: return 'RSI 14';
    case 4: return 'BB Position';
    default: return 'Trend Angle';
  }
}

function formatProbEngValue(value: number | undefined): string {
  return value != null && Number.isFinite(value) ? `${value.toFixed(1)}%` : '--';
}

function mixChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t);
}

function getProbEngStatColor(value: number | undefined): string {
  if (!Number.isFinite(value)) return '#8B949E';
  const safeValue = Math.max(0, Math.min(100, value as number));
  if (safeValue >= 40 && safeValue <= 60) {
    const t = Math.abs(safeValue - 50) / 10;
    return `rgb(${mixChannel(245, 234, t)}, ${mixChannel(158, 179, t)}, ${mixChannel(11, 8, t)})`;
  }
  if (safeValue > 60) {
    const t = (safeValue - 60) / 40;
    return `rgb(${mixChannel(173, 0, t)}, ${mixChannel(213, 200, t)}, ${mixChannel(132, 83, t)})`;
  }
  const t = (40 - safeValue) / 40;
  return `rgb(${mixChannel(248, 255, t)}, ${mixChannel(163, 61, t)}, ${mixChannel(184, 113, t)})`;
}

function ProbEngFloatingWidget({
  indicator,
  widget,
  dragging,
  hovered,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
  onHeaderPointerCancel,
  onToggleLock,
  onMouseEnter,
  onMouseLeave,
}: {
  indicator: ActiveIndicator;
  widget: ProbEngWidgetState;
  dragging: boolean;
  hovered: boolean;
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHeaderPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHeaderPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHeaderPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleLock: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const latestProb1 = [...(indicator.data[0] ?? [])].reverse().find((value) => Number.isFinite(value));
  const latestProb3 = [...(indicator.data[1] ?? [])].reverse().find((value) => Number.isFinite(value));
  const width = widget.detailed ? PROBENG_WIDGET_WIDTH_DETAILED : PROBENG_WIDGET_WIDTH;
  const prob1Color = getProbEngStatColor(latestProb1);
  const prob3Color = getProbEngStatColor(latestProb3);
  const detailRows = [
    { label: 'Source', value: getProbEngSourceLabel(indicator.params.source ?? 0) },
    { label: 'Buckets', value: String(Math.round(indicator.params.buckets ?? 0)) },
    { label: 'Alpha', value: (indicator.params.alpha ?? 0).toFixed(2) },
    { label: 'Min Obs', value: String(Math.round(indicator.params.minObs ?? 0)) },
    { label: 'Use Body', value: (indicator.params.useBody ?? 1) > 0 ? 'Yes' : 'No' },
  ];

  return (
    <div
      title={widget.locked ? 'Placement locked' : 'Drag to reposition'}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'absolute',
        left: widget.x,
        top: widget.y,
        width,
        zIndex: 18,
        borderRadius: 8,
        overflow: 'hidden',
        border: dragging ? '1px solid rgba(140,180,255,0.38)' : '1px solid rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(0,0,0,0.92)',
        boxShadow: dragging ? '0 16px 36px rgba(0,0,0,0.52)' : '0 10px 24px rgba(0,0,0,0.42)',
        pointerEvents: 'auto',
        opacity: dragging ? 0.96 : 1,
        transform: dragging ? 'scale(1.01)' : 'scale(1)',
        transition: dragging ? 'none' : 'box-shadow 120ms ease-out, border-color 120ms ease-out, opacity 120ms ease-out, transform 120ms ease-out',
      }}
    >
      <div
        onPointerDown={widget.locked ? undefined : onHeaderPointerDown}
        onPointerMove={widget.locked ? undefined : onHeaderPointerMove}
        onPointerUp={widget.locked ? undefined : onHeaderPointerUp}
        onPointerCancel={widget.locked ? undefined : onHeaderPointerCancel}
        style={{
          minHeight: widget.locked ? 22 : 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: widget.locked ? '0 6px 0 8px' : '0 8px 0 6px',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          fontSize: 10,
          fontFamily: '"JetBrains Mono", monospace',
          color: '#E6EDF3',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          background: widget.locked
            ? '#000000'
            : dragging
              ? 'linear-gradient(180deg, rgba(39,56,82,0.98) 0%, rgba(19,28,43,0.98) 100%)'
              : 'linear-gradient(180deg, rgba(28,33,40,0.98) 0%, rgba(15,23,32,0.98) 100%)',
          cursor: widget.locked ? 'default' : dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        title={widget.locked ? 'Placement locked' : 'Drag from header to reposition'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {!widget.locked && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                borderRadius: 4,
                color: dragging ? '#C7D2FE' : '#8B949E',
                background: dragging ? 'rgba(140,180,255,0.16)' : 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                flexShrink: 0,
              }}
            >
              <GripHorizontal size={10} strokeWidth={1.7} />
            </span>
          )}
          <span style={{ color: '#8B949E' }}>{widget.locked ? '1-bar (Up)' : 'Probability Table'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {widget.locked && (
            <span style={{ color: prob1Color, fontWeight: 700 }}>{formatProbEngValue(latestProb1)}</span>
          )}
          {(!widget.locked || hovered) && (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleLock();
              }}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                background: 'transparent',
                color: '#E6EDF3',
                width: 20,
                height: 20,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                fontSize: 11,
                fontFamily: '"JetBrains Mono", monospace',
                padding: 0,
                cursor: 'pointer',
              }}
              title={widget.locked ? 'Unlock placement' : 'Lock placement'}
              aria-label={widget.locked ? 'Unlock placement' : 'Lock placement'}
            >
              {widget.locked ? <Lock size={12} strokeWidth={1.5} /> : <Unlock size={12} strokeWidth={1.5} />}
            </button>
          )}
        </div>
      </div>

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 10,
          fontFamily: '"JetBrains Mono", monospace',
          color: '#E6EDF3',
          backgroundColor: '#000000',
        }}
      >
        <tbody>
          {!widget.locked && (
            <tr>
              <td style={{ padding: '6px 8px', color: '#8B949E', backgroundColor: '#000000' }}>1-bar (Up)</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: prob1Color, fontWeight: 700, backgroundColor: '#000000' }}>{formatProbEngValue(latestProb1)}</td>
            </tr>
          )}
          <tr>
            <td style={{ padding: '6px 8px', color: '#8B949E', borderTop: widget.locked ? 'none' : '1px solid rgba(255,255,255,0.06)', backgroundColor: '#000000' }}>
              {widget.locked ? '3-bar (Up)' : '3-bar (Up)'}
            </td>
            <td style={{ padding: '6px 8px', textAlign: 'right', color: prob3Color, fontWeight: 700, borderTop: widget.locked ? 'none' : '1px solid rgba(255,255,255,0.06)', backgroundColor: '#000000' }}>
              {formatProbEngValue(latestProb3)}
            </td>
          </tr>
          {!widget.locked && widget.detailed && (
            <>
              {detailRows.map((row) => (
                <tr key={row.label}>
                  <td style={{ padding: '6px 8px', color: '#8B949E', borderTop: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#000000' }}>{row.label}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', borderTop: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#000000' }}>
                    {row.value}
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ChartPage({ tabId }: ChartPageProps) {
  const chartToolRailWidth = 56;
  const defaultIndicatorsRef = useRef<PersistedChartIndicator[]>(createDefaultPersistedChartIndicators());
  const chartOverlayRef = useRef<HTMLDivElement>(null);
  const makeDetachedPaneId = useCallback(() => `pane:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, []);
  const defaultChartState: ChartState = {
    symbol: '',
    timeframe: '1D',
    chartType: 'candlestick',
    yScaleMode: 'auto',
    linkChannel: 1,
    indicators: defaultIndicatorsRef.current,
    stopperPx: 0,
    indicatorColorDefaults: {},
    scripts: [],
    customStrategies: [],
    activeCustomStrategyIds: [],
    probEngWidget: createDefaultProbEngWidgetState(),
    tooltipFields: { O: true, H: true, L: true, C: true, V: true, Δ: true },
  };
  const [persisted, setPersisted] = useState<ChartState | null>(() => (tabId ? loadChartState(tabId) : null));
  const initialState = persisted ?? defaultChartState;
  const restoredIndicators = persisted?.indicators ?? defaultIndicatorsRef.current;

  const [symbol, setSymbol] = useState(initialState.symbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialState.timeframe);
  const [chartType, setChartType] = useState<ChartType>(initialState.chartType);
  const [linkChannel, setLinkChannel] = useState<number | null>(initialState.linkChannel);
  const [stopperPx, setStopperPx] = useState<number>(initialState.stopperPx);
  const [tooltipFields, setTooltipFields] = useState<Record<string, boolean>>(
    initialState.tooltipFields ?? { O: true, H: true, L: true, C: true, V: true, Δ: true },
  );
  const [indicatorColorDefaults, setIndicatorColorDefaults] = useState<Record<string, Record<string, string>>>(
    initialState.indicatorColorDefaults,
  );
  const [yScaleMode, setYScaleMode] = useState<YScaleMode>(initialState.yScaleMode ?? 'auto');
  const [indicatorPanelOpen, setIndicatorPanelOpen] = useState(initialState.indicatorPanelOpen ?? false);
  const [strategyPanelOpen, setStrategyPanelOpen] = useState(initialState.strategyPanelOpen ?? false);
  const [legendCollapsed, setLegendCollapsed] = useState(initialState.legendCollapsed ?? false);
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const [builtInScriptViewer, setBuiltInScriptViewer] = useState<{ name: string; source: string } | null>(null);
  const [scriptEditorWidth, setScriptEditorWidth] = useState(320);
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([]);
  const [activeScripts, setActiveScripts] = useState<Map<string, ScriptResult>>(new Map());
  const [activeScriptSources, setActiveScriptSources] = useState<PersistedChartScript[]>(initialState.scripts ?? []);
  const [customStrategies, setCustomStrategies] = useState<CustomStrategyDefinition[]>(() => {
    const persistedStrategies = initialState.customStrategies ?? [];
    const localStrategies = loadCustomStrategies();
    const merged = [...localStrategies];
    for (const strategy of persistedStrategies) {
      if (!merged.some((item) => item.id === strategy.id)) merged.push(strategy);
    }
    return merged;
  });
  const [activeCustomStrategyIds, setActiveCustomStrategyIds] = useState<string[]>(initialState.activeCustomStrategyIds ?? []);
  const [customStrategyEditor, setCustomStrategyEditor] = useState<CustomStrategyDefinition | null>(null);
  const [probEngWidget, setProbEngWidget] = useState<ProbEngWidgetState>(
    initialState.probEngWidget ?? createDefaultProbEngWidgetState(),
  );
  const [chartNotice, setChartNotice] = useState<string | null>(null);
  const [chartLayout, setChartLayout] = useState<ChartLayout | null>(null);
  const [dragState, setDragState] = useState<{ indicatorId: string; sourcePaneId: string } | null>(null);
  const [draggingMouse, setDraggingMouse] = useState<{ x: number; y: number } | null>(null);
  const [dragHoverPaneId, setDragHoverPaneId] = useState<string | null>(null);
  const [probEngDragging, setProbEngDragging] = useState(false);
  const [probEngHovered, setProbEngHovered] = useState(false);
  const restoredIndicatorsRef = useRef(false);
  const paneDividerDragRef = useRef<{ paneId: string; startY: number; startHeight: number } | null>(null);
  const scriptDividerDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const probEngDragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);

  const engineRef = useRef<ChartEngine | null>(null);
  const [engineVersion, setEngineVersion] = useState(0);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const drag = scriptDividerDragRef.current;
      if (!drag) return;
      const nextWidth = Math.min(720, Math.max(240, drag.startWidth - (event.clientX - drag.startX)));
      setScriptEditorWidth(nextWidth);
    };

    const handleMouseUp = () => {
      scriptDividerDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    saveCustomStrategies(customStrategies);
  }, [customStrategies]);

  // TWS data hook
  const { sidecarPort } = useTws();
  const { bars, loading, source, datasetKey, onViewportChange, pendingViewportShift, onViewportShiftApplied, updateMode, tailChangeOffset } = useChartData({
    symbol,
    timeframe,
    sidecarPort,
  });
  const customStrategyResults = useMemo(() => {
    const next = new Map<string, CustomStrategyEvaluation>();
    for (const strategy of customStrategies) {
      next.set(strategy.id, evaluateCustomStrategy(strategy, bars));
    }
    return next;
  }, [bars, customStrategies]);
  const customStrategySummaryById = useMemo(
    () => Object.fromEntries(
      customStrategies.map((strategy) => {
        const result = customStrategyResults.get(strategy.id);
        return [strategy.id, { score: result?.latestScore ?? null, state: result?.latestState ?? 'NEUTRAL' }];
      }),
    ) as Record<string, { score: number | null; state: CustomStrategyEvaluation['latestState'] }>,
    [customStrategies, customStrategyResults],
  );
  const renderedScripts = useMemo(() => {
    const next = new Map(activeScripts);
    for (const strategyId of activeCustomStrategyIds) {
      const result = customStrategyResults.get(strategyId);
      if (result) {
        next.set(`custom_strategy:${strategyId}`, result.scriptResult);
      }
    }
    return next;
  }, [activeScripts, activeCustomStrategyIds, customStrategyResults]);

  const serializeIndicators = useCallback((indicators: ActiveIndicator[]): PersistedChartIndicator[] => (
    indicators.map((indicator) => ({
      name: indicator.name,
      paneId: indicator.paneId,
      params: { ...indicator.params },
      textParams: { ...indicator.textParams },
      colors: { ...indicator.colors },
      lineWidths: indicator.lineWidths ? { ...indicator.lineWidths } : undefined,
      lineStyles: indicator.lineStyles ? { ...indicator.lineStyles } : undefined,
      visible: indicator.visible,
    }))
  ), []);

  const applySerializedIndicators = useCallback((
    engine: ChartEngine,
    serializedIndicators: PersistedChartIndicator[],
    colorDefaults: Record<string, Record<string, string>> = indicatorColorDefaults,
  ) => {
    for (const indicator of [...engine.getActiveIndicators()]) {
      engine.removeIndicator(indicator.id);
    }

    for (const serializedIndicator of serializedIndicators) {
      const id = engine.addIndicator(serializedIndicator.name);
      if (!id) continue;
      engine.setIndicatorPane(
        id,
        serializedIndicator.name === 'Probability Engine' ? 'main' : serializedIndicator.paneId,
      );
      if (Object.keys(serializedIndicator.params).length > 0) {
        engine.updateIndicatorParams(id, serializedIndicator.params);
      }
      if (Object.keys(serializedIndicator.textParams ?? {}).length > 0) {
        engine.updateIndicatorTextParams(id, serializedIndicator.textParams ?? {});
      }
      const mergedColors = {
        ...(colorDefaults[serializedIndicator.name] ?? {}),
        ...serializedIndicator.colors,
      };
      for (const [outputKey, color] of Object.entries(mergedColors)) {
        engine.updateIndicatorColor(id, outputKey, color);
      }
      for (const [outputKey, width] of Object.entries(serializedIndicator.lineWidths ?? {})) {
        engine.updateIndicatorLineWidth(id, outputKey, width);
      }
      for (const [outputKey, style] of Object.entries(serializedIndicator.lineStyles ?? {})) {
        engine.updateIndicatorLineStyle(id, outputKey, style);
      }
      if (!serializedIndicator.visible) {
        engine.setIndicatorVisibility(id, false);
      }
    }
  }, [indicatorColorDefaults]);

  const applyChartState = useCallback((nextState: ChartState) => {
    setPersisted(nextState);
    setSymbol(nextState.symbol);
    setTimeframe(nextState.timeframe);
    setChartType(nextState.chartType);
    setYScaleMode(nextState.yScaleMode ?? 'auto');
    setLinkChannel(nextState.linkChannel);
    setStopperPx(nextState.stopperPx);
    setTooltipFields(nextState.tooltipFields ?? { O: true, H: true, L: true, C: true, V: true, Δ: true });
    setIndicatorColorDefaults(nextState.indicatorColorDefaults);
    setActiveScriptSources(nextState.scripts ?? []);
    if ((nextState.customStrategies ?? []).length > 0) {
      setCustomStrategies((prev) => {
        const merged = [...prev];
        for (const strategy of nextState.customStrategies ?? []) {
          const index = merged.findIndex((item) => item.id === strategy.id);
          if (index >= 0) merged[index] = strategy;
          else merged.push(strategy);
        }
        return merged;
      });
    }
    setActiveCustomStrategyIds(nextState.activeCustomStrategyIds ?? []);
    setProbEngWidget(nextState.probEngWidget ?? createDefaultProbEngWidgetState());
    setActiveScripts(new Map());
    setChartLayout(null);
    setDragState(null);
    setDraggingMouse(null);
    setDragHoverPaneId(null);
    setProbEngDragging(false);
    setProbEngHovered(false);
    const engine = engineRef.current;
    if (!engine) {
      restoredIndicatorsRef.current = false;
      setActiveIndicators([]);
      return;
    }

    restoredIndicatorsRef.current = true;
    for (const indicator of [...engine.getActiveIndicators()]) {
      engine.removeIndicator(indicator.id);
    }
    engine.clearAllScripts();
    applySerializedIndicators(engine, nextState.indicators, nextState.indicatorColorDefaults);
    setActiveIndicators([...engine.getActiveIndicators()]);
    setChartLayout(engine.getLayout());
  }, [applySerializedIndicators]);

  const serializedIndicatorsMatch = useCallback((
    serializedIndicators: PersistedChartIndicator[],
    engineIndicators: ActiveIndicator[],
  ) => {
    if (serializedIndicators.length !== engineIndicators.length) return false;
    return serializedIndicators.every((serializedIndicator, index) => {
      const engineIndicator = engineIndicators[index];
      if (!engineIndicator) return false;
      if (serializedIndicator.name !== engineIndicator.name) return false;
      if (serializedIndicator.paneId !== engineIndicator.paneId) return false;
      if (serializedIndicator.visible !== engineIndicator.visible) return false;

      const compareRecord = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined) => {
        const aEntries = Object.entries(a ?? {}).sort(([ka], [kb]) => ka.localeCompare(kb));
        const bEntries = Object.entries(b ?? {}).sort(([ka], [kb]) => ka.localeCompare(kb));
        return JSON.stringify(aEntries) === JSON.stringify(bEntries);
      };

      return compareRecord(serializedIndicator.params, engineIndicator.params)
        && compareRecord(serializedIndicator.textParams, engineIndicator.textParams)
        && compareRecord(serializedIndicator.colors, engineIndicator.colors)
        && compareRecord(serializedIndicator.lineWidths, engineIndicator.lineWidths)
        && compareRecord(serializedIndicator.lineStyles, engineIndicator.lineStyles);
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
          const defaults = indicatorColorDefaults['Technical Score'];
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
      setActiveIndicators([...engine.getActiveIndicators()]);
    }
  }, [indicatorColorDefaults, makeDetachedPaneId]);

  const syncMACDPane = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const engineIndicators = engine.getActiveIndicators();
    const macdSignals = engineIndicators.filter((indicator) => indicator.name === 'MACD Crossover');
    if (macdSignals.length === 0) return;

    const shouldShowPane = macdSignals.some((indicator) => indicator.visible);
    let changed = false;
    let macdIndicator = engineIndicators.find((indicator) => indicator.name === 'MACD');

    if (shouldShowPane) {
      if (!macdIndicator) {
        const id = engine.addIndicator('MACD');
        if (id) {
          // Sync params from strategy on initial creation
          const { fast, slow, signal } = macdSignals[0].params;
          engine.updateIndicatorParams(id, { fast, slow, signal });
          engine.setIndicatorPane(id, makeDetachedPaneId());
          changed = true;
        }
      } else if (!macdIndicator.visible) {
        engine.setIndicatorVisibility(macdIndicator.id, true);
        changed = true;
      }
    } else if (macdIndicator?.visible) {
      engine.setIndicatorVisibility(macdIndicator.id, false);
      changed = true;
    }

    if (changed) {
      setActiveIndicators([...engine.getActiveIndicators()]);
    }
  }, [makeDetachedPaneId]);

  useEffect(() => {
    const nextPersisted = tabId ? loadChartState(tabId) : null;
    const nextState = nextPersisted ?? defaultChartState;

    setPersisted(nextPersisted);
    setSymbol(nextState.symbol);
    setTimeframe(nextState.timeframe);
    setChartType(nextState.chartType);
    setYScaleMode(nextState.yScaleMode ?? 'auto');
    setLinkChannel(nextState.linkChannel);
    setStopperPx(nextState.stopperPx);
    setTooltipFields(nextState.tooltipFields ?? { O: true, H: true, L: true, C: true, V: true, Δ: true });
    setIndicatorColorDefaults(nextState.indicatorColorDefaults);
    setActiveIndicators([]);
    setActiveScripts(new Map());
    setActiveScriptSources(nextState.scripts ?? []);
    if ((nextState.customStrategies ?? []).length > 0) {
      setCustomStrategies((prev) => {
        const merged = [...prev];
        for (const strategy of nextState.customStrategies ?? []) {
          const index = merged.findIndex((item) => item.id === strategy.id);
          if (index >= 0) merged[index] = strategy;
          else merged.push(strategy);
        }
        return merged;
      });
    }
    setActiveCustomStrategyIds(nextState.activeCustomStrategyIds ?? []);
    setProbEngWidget(nextState.probEngWidget ?? createDefaultProbEngWidgetState());
    setIndicatorPanelOpen(nextState.indicatorPanelOpen ?? false);
    setStrategyPanelOpen(nextState.strategyPanelOpen ?? false);
    setLegendCollapsed(nextState.legendCollapsed ?? false);
    setChartLayout(null);
    setDragState(null);
    setDraggingMouse(null);
    setDragHoverPaneId(null);
    setProbEngDragging(false);
    setProbEngHovered(false);
    restoredIndicatorsRef.current = false;

    const engine = engineRef.current;
    if (engine) {
      for (const indicator of [...engine.getActiveIndicators()]) {
        engine.removeIndicator(indicator.id);
      }
      engine.clearAllScripts();
    }
  }, [tabId]);

  // Subscribe to link bus for symbol changes
  useEffect(() => {
    if (linkChannel === null) return;
    const unsub = linkBus.subscribe(linkChannel, (newSymbol) => {
      setSymbol(newSymbol);
    });
    return unsub;
  }, [linkChannel]);

  // Persist chart state on changes
  useEffect(() => {
    if (!tabId) return;
    if (activeIndicators.length === 0 && !restoredIndicatorsRef.current) return;
    saveChartState(tabId, {
      symbol,
      timeframe,
      chartType,
      yScaleMode,
      linkChannel,
      indicators: serializeIndicators(activeIndicators),
      stopperPx,
      indicatorColorDefaults,
      scripts: activeScriptSources,
      customStrategies,
      activeCustomStrategyIds,
      probEngWidget,
      tooltipFields,
      indicatorPanelOpen,
      strategyPanelOpen,
      legendCollapsed,
    });
  }, [tabId, symbol, timeframe, chartType, yScaleMode, linkChannel, activeIndicators, stopperPx, indicatorColorDefaults, activeScriptSources, customStrategies, activeCustomStrategyIds, probEngWidget, tooltipFields, indicatorPanelOpen, strategyPanelOpen, legendCollapsed, serializeIndicators]);

  // Re-add persisted indicators once engine is ready
  useEffect(() => {
    if (restoredIndicatorsRef.current || !engineRef.current || restoredIndicators.length === 0) return;
    restoredIndicatorsRef.current = true;
    const engine = engineRef.current;
    applySerializedIndicators(engine, restoredIndicators);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, [bars, restoredIndicators, applySerializedIndicators]);

  // Reconcile React/persisted indicator state back into the engine whenever
  // zoom/layout churn or fast refresh leaves the engine incomplete.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || bars.length === 0) return;
    const desiredIndicators = activeIndicators.length > 0
      ? serializeIndicators(activeIndicators)
      : restoredIndicators;
    if (desiredIndicators.length === 0) return;

    const engineIndicators = engine.getActiveIndicators();
    if (serializedIndicatorsMatch(desiredIndicators, engineIndicators)) return;

    applySerializedIndicators(engine, desiredIndicators);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, [
    bars,
    engineVersion,
    activeIndicators,
    restoredIndicators,
    serializeIndicators,
    applySerializedIndicators,
    serializedIndicatorsMatch,
  ]);

  useEffect(() => {
    syncDailyIQScorePane();
    syncMACDPane();
  }, [activeIndicators, syncDailyIQScorePane, syncMACDPane]);

  useEffect(() => {
    if (!engineRef.current) return;
    setChartLayout(engineRef.current.getLayout());
  }, [activeIndicators, activeScripts, bars, stopperPx]);

  const activeProbEngIndicator = activeIndicators.find(
    (indicator) => indicator.name === 'Probability Engine' && indicator.visible,
  );

  useEffect(() => {
    if (!activeProbEngIndicator) return;
    const detailed = (activeProbEngIndicator.params.detailedStats ?? 0) > 0;
    setProbEngWidget((prev) => (
      prev.detailed === detailed && prev.visible
        ? prev
        : { ...prev, detailed, visible: true }
    ));
  }, [activeProbEngIndicator]);

  useEffect(() => {
    if (!chartLayout) return;
    const hostWidth = chartOverlayRef.current?.clientWidth ?? chartLayout.width;
    setProbEngWidget((prev) => {
      const next = clampProbEngWidgetPosition(prev, chartLayout, hostWidth, chartToolRailWidth);
      return next.x === prev.x && next.y === prev.y ? prev : next;
    });
  }, [chartLayout, chartToolRailWidth]);

  useEffect(() => {
    if (!chartLayout || !activeProbEngIndicator) return;
    const hostWidth = chartOverlayRef.current?.clientWidth ?? chartLayout.width;
    setProbEngWidget((prev) => {
      const defaultLike = (prev.x === 16 && prev.y === 44) || (prev.x === 96 && prev.y === 64);
      if (!defaultLike) return prev;
      const pos = getDefaultProbEngWidgetPosition(prev.detailed, chartLayout, hostWidth, chartToolRailWidth);
      return { ...prev, ...pos, visible: true };
    });
  }, [chartLayout, activeProbEngIndicator, chartToolRailWidth]);

  const handleSymbolChange = useCallback((newSymbol: string) => {
    setSymbol(newSymbol);
    // Publish to link bus so other linked components update too
    if (linkChannel !== null) {
      linkBus.publish(linkChannel, newSymbol);
    }
  }, [linkChannel]);

  const handleTimeframeChange = useCallback((tf: Timeframe) => {
    setTimeframe(tf);
  }, []);

  const handleChartTypeChange = useCallback((ct: ChartType) => {
    setChartType(ct);
  }, []);

  const handleYScaleModeChange = useCallback((mode: YScaleMode) => {
    setYScaleMode(mode);
    engineRef.current?.setYScaleMode(mode);
  }, []);

  const handleLinkChannelChange = useCallback((ch: number | null) => {
    setLinkChannel(ch);
  }, []);

  const handleAddIndicator = useCallback((name: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const id = engine.addIndicator(name);
    if (id) {
      if (name === 'Probability Engine') {
        engine.setIndicatorPane(id, 'main');
      }
      const defaults = indicatorColorDefaults[name];
      if (defaults) {
        for (const [outputKey, color] of Object.entries(defaults)) {
          engine.updateIndicatorColor(id, outputKey, color);
        }
      }
      setActiveIndicators([...engine.getActiveIndicators()]);
    }
  }, [indicatorColorDefaults]);

  const handleToggleStrategy = useCallback((name: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const matches = engine.getActiveIndicators().filter((indicator) => indicator.name === name);
    if (matches.length > 0) {
      for (const match of matches) {
        engine.removeIndicator(match.id);
      }
      setActiveIndicators([...engine.getActiveIndicators()]);
      return;
    }

    const id = engine.addIndicator(name);
    if (id) {
      const defaults = indicatorColorDefaults[name];
      if (defaults) {
        for (const [outputKey, color] of Object.entries(defaults)) {
          engine.updateIndicatorColor(id, outputKey, color);
        }
      }
    }
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, [indicatorColorDefaults]);

  const handleToggleCustomStrategy = useCallback((id: string) => {
    setActiveCustomStrategyIds((prev) => (
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    ));
  }, []);

  const handleSaveCustomStrategy = useCallback((strategy: CustomStrategyDefinition) => {
    setCustomStrategies((prev) => {
      const index = prev.findIndex((item) => item.id === strategy.id);
      if (index >= 0) {
        const next = [...prev];
        next[index] = strategy;
        return next;
      }
      return [...prev, strategy];
    });
    setCustomStrategyEditor(null);
  }, []);

  const handleDuplicateCustomStrategy = useCallback((id: string) => {
    setCustomStrategies((prev) => {
      const source = prev.find((item) => item.id === id);
      if (!source) return prev;
      return [
        ...prev,
        {
          ...source,
          id: `custom_strategy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: `${source.name} Copy`,
          conditions: source.conditions.map((condition) => ({ ...condition })),
        },
      ];
    });
  }, []);

  const handleDeleteCustomStrategy = useCallback((id: string) => {
    setCustomStrategies((prev) => prev.filter((item) => item.id !== id));
    setActiveCustomStrategyIds((prev) => prev.filter((item) => item !== id));
    setCustomStrategyEditor((prev) => (prev?.id === id ? null : prev));
  }, []);

  const handleRemoveIndicator = useCallback((id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.removeIndicator(id);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, []);

  const handleUpdateParams = useCallback((id: string, params: Record<string, number>) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorParams(id, params);
    const indicator = engine.getActiveIndicators().find((entry) => entry.id === id);
    if (indicator?.name === 'Probability Engine' && Object.prototype.hasOwnProperty.call(params, 'detailedStats')) {
      setProbEngWidget((prev) => ({ ...prev, detailed: (params.detailedStats ?? 0) > 0 }));
    }
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, []);

  const handleUpdateTextParams = useCallback((id: string, textParams: Record<string, string>) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorTextParams(id, textParams);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, []);

  const handleToggleVisibility = useCallback((id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.toggleVisibility(id);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, []);

  const handleMoveIndicator = useCallback((id: string, direction: 'up' | 'down') => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.moveIndicator(id, direction);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, []);

  const handleMoveIndicatorToPane = useCallback((id: string, paneId: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setIndicatorPane(id, paneId);
    if (paneId !== 'main') {
      engine.expandPane(paneId);
    }
    setActiveIndicators([...engine.getActiveIndicators()]);
    setChartLayout(engine.getLayout());
  }, []);

  const handleUpdateColor = useCallback((id: string, outputKey: string, color: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorColor(id, outputKey, color);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, []);

  const handleUpdateLineWidth = useCallback((id: string, outputKey: string, width: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorLineWidth(id, outputKey, width);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, []);

  const handleUpdateLineStyle = useCallback((id: string, outputKey: string, style: 'solid' | 'dashed' | 'dotted') => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorLineStyle(id, outputKey, style);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, []);

  const handleSetDefaultColor = useCallback((indicatorName: string, outputKey: string, color: string) => {
    setIndicatorColorDefaults((prev) => ({
      ...prev,
      [indicatorName]: {
        ...(prev[indicatorName] ?? {}),
        [outputKey]: color,
      },
    }));
  }, []);

  const handleRunScript = useCallback((id: string, src: string): ScriptResult => {
    const result = interpretScript(src, bars);
    if (result.errors.length === 0) {
      setActiveScripts(prev => {
        const next = new Map(prev);
        next.set(id, result);
        return next;
      });
      setActiveScriptSources((prev) => {
        const next = prev.filter((script) => script.id !== id);
        next.push({ id, source: src });
        return next;
      });
    }
    return result;
  }, [bars]);

  const handleStopScript = useCallback((id: string) => {
    setActiveScripts(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setActiveScriptSources((prev) => prev.filter((script) => script.id !== id));
  }, []);

  useEffect(() => {
    if (activeScriptSources.length === 0) {
      setActiveScripts(new Map());
      return;
    }

    const nextScripts = new Map<string, ScriptResult>();
    for (const script of activeScriptSources) {
      const result = interpretScript(script.source, bars);
      if (result.errors.length === 0) {
        nextScripts.set(script.id, result);
      }
    }
    setActiveScripts(nextScripts);
  }, [bars, activeScriptSources]);

  useEffect(() => {
    if (!chartNotice) return;
    const timer = window.setTimeout(() => setChartNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [chartNotice]);

  // DISABLED: import/export not yet functional
  // const handleExportChart = useCallback(async () => {
  //   const ok = await exportChartConfigToFile(chartStateToDailyIqChartConfig({
  //     symbol, timeframe, chartType, yScaleMode, linkChannel,
  //     indicators: serializeIndicators(activeIndicators), stopperPx,
  //     indicatorColorDefaults, scripts: activeScriptSources, customStrategies,
  //     activeCustomStrategyIds, probEngWidget, tooltipFields,
  //   }));
  //   if (!ok) { setChartNotice('Chart export failed.'); } else { setChartNotice('Chart exported.'); }
  // }, [symbol, timeframe, chartType, yScaleMode, linkChannel, activeIndicators, stopperPx,
  //   indicatorColorDefaults, activeScriptSources, customStrategies, activeCustomStrategyIds,
  //   probEngWidget, tooltipFields, serializeIndicators]);

  // const handleImportChart = useCallback(async () => {
  //   const result = await importChartConfigFromFile();
  //   if (result.status === 'canceled') return;
  //   if (result.status !== 'success') {
  //     setChartNotice(result.status === 'invalid' ? 'Invalid .diqc file.' : 'Chart import failed.');
  //     return;
  //   }
  //   const importedState = dailyIqChartConfigToChartState(result.file.chart);
  //   applyChartState(importedState);
  //   if (tabId) { saveChartState(tabId, importedState); }
  //   setChartNotice('Chart imported.');
  // }, [applyChartState, tabId]);

  const handleEngineReady = useCallback(() => {
    setEngineVersion(v => v + 1);
  }, []);

  // Apply tooltip fields when engine is ready or fields change
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setTooltipFields(tooltipFields);
  }, [tooltipFields]);

  const handlePaneDividerMouseDown = useCallback((e: React.MouseEvent, paneId: string) => {
    e.preventDefault();
    const engine = engineRef.current;
    if (!engine) return;
    const layout = engine.getLayout();
    const pane = layout.subPanes.find(p => p.paneId === paneId);
    if (!pane) return;
    paneDividerDragRef.current = { paneId, startY: e.clientY, startHeight: pane.height };

    const onMouseMove = (ev: MouseEvent) => {
      const drag = paneDividerDragRef.current;
      if (!drag) return;
      const delta = drag.startY - ev.clientY;
      const newHeight = drag.startHeight + delta;
      engineRef.current?.setSubPaneHeight(drag.paneId, newHeight);
      requestAnimationFrame(() => {
        const updated = engineRef.current?.getLayout();
        if (updated) setChartLayout(updated);
      });
    };

    const onMouseUp = () => {
      paneDividerDragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const beginIndicatorDrag = useCallback((indicatorId: string, sourcePaneId: string, clientX: number, clientY: number) => {
    setDragState({ indicatorId, sourcePaneId });
    const host = chartOverlayRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setDraggingMouse({
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }, []);

  useEffect(() => {
    if (!dragState || !chartLayout) return;

    const updateDragState = (clientX: number, clientY: number) => {
      const host = chartOverlayRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      setDraggingMouse({ x, y });

      const leftBound = chartToolRailWidth;
      const rightBound = rect.width - chartLayout.priceAxisWidth;
      if (x < leftBound || x > rightBound) {
        setDragHoverPaneId(null);
        return;
      }

      const newPaneHeight = 36;
      const newPaneTop = rect.height - chartLayout.timeAxisHeight - newPaneHeight;
      if (y >= newPaneTop && y <= newPaneTop + newPaneHeight) {
        setDragHoverPaneId('__new__');
        return;
      }

      const hoveredPane = chartLayout.subPanes.find(
        (pane) => y >= pane.top && y <= pane.top + pane.height,
      );
      if (hoveredPane) {
        if (hoveredPane.collapsed) {
          const engine = engineRef.current;
          if (engine) {
            engine.expandPane(hoveredPane.paneId);
            setChartLayout(engine.getLayout());
          }
        }
        setDragHoverPaneId(hoveredPane.paneId === dragState.sourcePaneId ? null : hoveredPane.paneId);
        return;
      }

      if (y >= chartLayout.mainTop && y <= chartLayout.mainTop + chartLayout.mainHeight) {
        setDragHoverPaneId(dragState.sourcePaneId === 'main' ? null : 'main');
        return;
      }

      setDragHoverPaneId(null);
    };

    const handleMouseMove = (event: MouseEvent) => {
      updateDragState(event.clientX, event.clientY);
    };

    const handleMouseUp = () => {
      if (dragHoverPaneId) {
        if (dragHoverPaneId === '__new__') {
          handleMoveIndicatorToPane(dragState.indicatorId, makeDetachedPaneId());
        } else {
          handleMoveIndicatorToPane(dragState.indicatorId, dragHoverPaneId);
        }
      }
      setDragState(null);
      setDraggingMouse(null);
      setDragHoverPaneId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragHoverPaneId, dragState, chartLayout, handleMoveIndicatorToPane, makeDetachedPaneId]);

  const clearProbEngDrag = useCallback((target?: HTMLDivElement | null) => {
    const drag = probEngDragRef.current;
    if (drag && target?.hasPointerCapture?.(drag.pointerId)) {
      target.releasePointerCapture(drag.pointerId);
    }
    probEngDragRef.current = null;
    setProbEngDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const handleProbEngPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (probEngWidget.locked || event.button !== 0) return;
    const host = chartOverlayRef.current;
    const widgetEl = event.currentTarget.parentElement as HTMLDivElement | null;
    if (!host || !widgetEl || !chartLayout) return;
    const hostRect = host.getBoundingClientRect();
    const widgetRect = widgetEl.getBoundingClientRect();
    probEngDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - widgetRect.left,
      offsetY: event.clientY - widgetRect.top,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grab';
    const unclamped = {
      ...probEngWidget,
      x: widgetRect.left - hostRect.left,
      y: widgetRect.top - hostRect.top,
    };
    setProbEngWidget(clampProbEngWidgetPosition(unclamped, chartLayout, hostRect.width, chartToolRailWidth));
  }, [probEngWidget, chartLayout, chartToolRailWidth]);

  const handleProbEngPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = probEngDragRef.current;
    const host = chartOverlayRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !host || !chartLayout) return;
    const moveDistance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
    if (!drag.moved && moveDistance < PROBENG_WIDGET_DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      setProbEngDragging(true);
      document.body.style.cursor = 'grabbing';
    }
    const rect = host.getBoundingClientRect();
    const unclamped = {
      ...probEngWidget,
      x: event.clientX - rect.left - drag.offsetX,
      y: event.clientY - rect.top - drag.offsetY,
    };
    setProbEngWidget(clampProbEngWidgetPosition(unclamped, chartLayout, rect.width, chartToolRailWidth));
  }, [probEngWidget, chartLayout, chartToolRailWidth]);

  const handleProbEngPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = probEngDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clearProbEngDrag(event.currentTarget);
  }, [clearProbEngDrag]);

  const handleProbEngPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = probEngDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clearProbEngDrag(event.currentTarget);
  }, [clearProbEngDrag]);

  useEffect(() => () => {
    probEngDragRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const draggableVolumePanes = chartLayout
    ? chartLayout.subPanes.flatMap((pane) => {
        const volumeIndicator = activeIndicators.find(
          (indicator) => pane.indicatorIds.includes(indicator.id) && indicator.name === 'Volume',
        );
        return volumeIndicator ? [{ pane, indicatorId: volumeIndicator.id }] : [];
      })
    : [];
  const mainVolumeIndicator = activeIndicators.find(
    (indicator) => indicator.name === 'Volume' && indicator.visible && indicator.paneId === 'main',
  );

  const draggableMACDPanes = chartLayout
    ? chartLayout.subPanes.flatMap((pane) => {
        const macdIndicator = activeIndicators.find(
          (indicator) => pane.indicatorIds.includes(indicator.id) && indicator.name === 'MACD',
        );
        return macdIndicator ? [{ pane, indicatorId: macdIndicator.id }] : [];
      })
    : [];
  const mainMACDIndicator = activeIndicators.find(
    (indicator) => indicator.name === 'MACD' && indicator.visible && indicator.paneId === 'main',
  );

  const draggableTechScorePanes = chartLayout
    ? chartLayout.subPanes.flatMap((pane) => {
        const tsIndicator = activeIndicators.find(
          (indicator) => pane.indicatorIds.includes(indicator.id) && indicator.name === 'Technical Score',
        );
        return tsIndicator ? [{ pane, indicatorId: tsIndicator.id }] : [];
      })
    : [];
  const mainTechScoreIndicator = activeIndicators.find(
    (indicator) => indicator.name === 'Technical Score' && indicator.visible && indicator.paneId === 'main',
  );

  const draggedIndicatorName = dragState
    ? (activeIndicators.find((ind) => ind.id === dragState.indicatorId)?.name ?? '')
    : '';
  const isIntradayChart = getTimeframeMs(timeframe) < 86_400_000;
  const liveFollowEnabled = isIntradayChart && source !== 'offline';

  return (
    <div className="flex flex-col h-full bg-base relative">
      <ChartToolbar
        symbol={symbol}
        onSymbolChange={handleSymbolChange}
        timeframe={timeframe}
        onTimeframeChange={handleTimeframeChange}
        chartType={chartType}
        onChartTypeChange={handleChartTypeChange}
        onIndicatorPanelToggle={() => {
          setStrategyPanelOpen(false);
          setIndicatorPanelOpen(!indicatorPanelOpen);
        }}
        onStrategyPanelToggle={() => {
          setIndicatorPanelOpen(false);
          setStrategyPanelOpen(!strategyPanelOpen);
        }}
        onScriptEditorToggle={() => {
          setBuiltInScriptViewer(null);
          setScriptEditorOpen(!scriptEditorOpen);
        }}
        indicatorPanelOpen={indicatorPanelOpen}
        strategyPanelOpen={strategyPanelOpen}
        onIndicatorPanelClose={() => setIndicatorPanelOpen(false)}
        onStrategyPanelClose={() => setStrategyPanelOpen(false)}
        onAddIndicator={handleAddIndicator}
        onToggleStrategy={handleToggleStrategy}
        customStrategies={customStrategies}
        activeCustomStrategyIds={activeCustomStrategyIds}
        customStrategySummaryById={customStrategySummaryById}
        onToggleCustomStrategy={handleToggleCustomStrategy}
        onCreateCustomStrategy={() => setCustomStrategyEditor(createDefaultCustomStrategy(`Custom Strategy ${customStrategies.length + 1}`))}
        onEditCustomStrategy={(id) => setCustomStrategyEditor(customStrategies.find((strategy) => strategy.id === id) ?? null)}
        onDuplicateCustomStrategy={handleDuplicateCustomStrategy}
        onDeleteCustomStrategy={handleDeleteCustomStrategy}
        activeIndicators={activeIndicators}
        dataSource={source}
        loading={loading}
        linkChannel={linkChannel}
        onLinkChannelChange={handleLinkChannelChange}
        stopperPx={stopperPx}
        onStopperPxChange={setStopperPx}
        onZoomIn={() => engineRef.current?.zoomIn()}
        onZoomOut={() => engineRef.current?.zoomOut()}
        onZoomReset={() => engineRef.current?.resetZoom()}
        // onExportChart={() => { void handleExportChart(); }}
        // onImportChart={() => { void handleImportChart(); }}
      />

      {chartNotice && (
        <div className="pointer-events-none absolute left-1/2 top-[42px] z-20 -translate-x-1/2">
          <div className="rounded-md border border-white/[0.08] bg-[#161B22] px-3 py-1.5 text-[10px] font-mono text-white/80 shadow-lg shadow-black/40">
            {chartNotice}
          </div>
        </div>
      )}

      <div ref={chartOverlayRef} className="flex flex-1 overflow-hidden relative">
        <ChartCanvas
          bars={bars}
          datasetKey={datasetKey}
          symbol={symbol}
          chartType={chartType}
          timeframe={timeframe}
          engineRef={engineRef}
          brandingMode="fullLogo"
          activeScripts={renderedScripts}
          liveMode={liveFollowEnabled}
          stopperPx={stopperPx}
          onStopperPxChange={setStopperPx}
          onViewportChange={onViewportChange}
          onLayoutChange={setChartLayout}
          onEngineReady={handleEngineReady}
          yScaleMode={yScaleMode}
          onYScaleModeChange={handleYScaleModeChange}
          pendingViewportShift={pendingViewportShift}
          onViewportShiftApplied={onViewportShiftApplied}
          updateMode={updateMode}
          tailChangeOffset={tailChangeOffset}
        >
          {chartLayout && mainVolumeIndicator && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                beginIndicatorDrag(mainVolumeIndicator.id, 'main', e.clientX, e.clientY);
              }}
              title="Drag volume out to its own pane"
              style={{
                position: 'absolute',
                left: chartToolRailWidth,
                right: chartLayout.priceAxisWidth,
                top: chartLayout.mainTop + chartLayout.mainHeight * (1 - VOLUME_PANE_RATIO),
                height: Math.max(48, chartLayout.mainHeight * VOLUME_PANE_RATIO),
                cursor: 'grab',
                pointerEvents: dragState ? 'none' : 'auto',
                background: 'transparent',
                zIndex: 4,
              }}
            />
          )}
          {draggableVolumePanes.map(({ pane, indicatorId }) => (
            <div
              key={`${pane.paneId}-volume-drag`}
              onMouseDown={(e) => {
                e.preventDefault();
                beginIndicatorDrag(indicatorId, pane.paneId, e.clientX, e.clientY);
              }}
              title="Drag volume onto chart"
              style={{
                position: 'absolute',
                left: chartToolRailWidth,
                right: chartLayout?.priceAxisWidth ?? 70,
                top: pane.top,
                height: pane.height,
                cursor: 'grab',
                pointerEvents: dragState ? 'none' : 'auto',
                background: 'transparent',
                zIndex: 4,
              }}
            />
          ))}
          {chartLayout && mainMACDIndicator && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                beginIndicatorDrag(mainMACDIndicator.id, 'main', e.clientX, e.clientY);
              }}
              title="Drag MACD out to its own pane"
              style={{
                position: 'absolute',
                left: chartToolRailWidth,
                right: chartLayout.priceAxisWidth,
                top: chartLayout.mainTop + chartLayout.mainHeight * (1 - VOLUME_PANE_RATIO),
                height: Math.max(48, chartLayout.mainHeight * VOLUME_PANE_RATIO),
                cursor: 'grab',
                pointerEvents: dragState ? 'none' : 'auto',
                background: 'transparent',
                zIndex: 5,
              }}
            />
          )}
          {draggableMACDPanes.map(({ pane, indicatorId }) => (
            <div
              key={`${pane.paneId}-macd-drag`}
              onMouseDown={(e) => {
                e.preventDefault();
                beginIndicatorDrag(indicatorId, pane.paneId, e.clientX, e.clientY);
              }}
              title="Drag MACD onto chart"
              style={{
                position: 'absolute',
                left: chartToolRailWidth,
                right: chartLayout?.priceAxisWidth ?? 70,
                top: pane.top,
                height: pane.height,
                cursor: 'grab',
                pointerEvents: dragState ? 'none' : 'auto',
                background: 'transparent',
                zIndex: 4,
              }}
            />
          ))}
          {chartLayout && mainTechScoreIndicator && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                beginIndicatorDrag(mainTechScoreIndicator.id, 'main', e.clientX, e.clientY);
              }}
              title="Drag Tech Score out to its own pane"
              style={{
                position: 'absolute',
                left: chartToolRailWidth,
                right: chartLayout.priceAxisWidth,
                top: chartLayout.mainTop + chartLayout.mainHeight * 0.67,
                height: Math.max(48, chartLayout.mainHeight * 0.3),
                cursor: 'grab',
                pointerEvents: dragState ? 'none' : 'auto',
                background: 'transparent',
                zIndex: 5,
              }}
            />
          )}
          {draggableTechScorePanes.map(({ pane, indicatorId }) => (
            <div
              key={`${pane.paneId}-techscore-drag`}
              onMouseDown={(e) => {
                e.preventDefault();
                beginIndicatorDrag(indicatorId, pane.paneId, e.clientX, e.clientY);
              }}
              title="Drag Tech Score onto chart"
              style={{
                position: 'absolute',
                left: chartToolRailWidth,
                right: chartLayout?.priceAxisWidth ?? 70,
                top: pane.top,
                height: pane.height,
                cursor: 'grab',
                pointerEvents: dragState ? 'none' : 'auto',
                background: 'transparent',
                zIndex: 4,
              }}
            />
          ))}
          {dragState && chartLayout && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: chartToolRailWidth,
                  right: chartLayout.priceAxisWidth,
                  top: chartLayout.mainTop,
                  height: chartLayout.mainHeight,
                  border: dragHoverPaneId === 'main'
                    ? '1px solid rgba(26,86,219,0.8)'
                    : '1px dashed rgba(26,86,219,0.5)',
                  backgroundColor: dragHoverPaneId === 'main'
                    ? 'rgba(26,86,219,0.14)'
                    : 'rgba(26,86,219,0.08)',
                  color: '#8B949E',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                }}
              >
                Drop on Chart
              </div>
              {chartLayout.subPanes.map((pane) => (
                <div
                  key={pane.paneId}
                  style={{
                    position: 'absolute',
                    left: chartToolRailWidth,
                    right: chartLayout.priceAxisWidth,
                    top: pane.top,
                    height: pane.height,
                    border: dragHoverPaneId === pane.paneId
                      ? '1px solid rgba(139,148,158,0.65)'
                      : '1px dashed rgba(139,148,158,0.35)',
                    backgroundColor: dragHoverPaneId === pane.paneId
                      ? 'rgba(139,148,158,0.12)'
                      : 'rgba(139,148,158,0.06)',
                    color: '#8B949E',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 6,
                    pointerEvents: 'none',
                  }}
                >
                  Merge Pane
                </div>
              ))}
              <div
                style={{
                  position: 'absolute',
                  left: chartToolRailWidth,
                  right: chartLayout.priceAxisWidth,
                  bottom: chartLayout.timeAxisHeight,
                  height: 36,
                  borderTop: dragHoverPaneId === '__new__'
                    ? '1px solid rgba(245,158,11,0.8)'
                    : '1px dashed rgba(245,158,11,0.5)',
                  backgroundColor: dragHoverPaneId === '__new__'
                    ? 'rgba(245,158,11,0.14)'
                    : 'rgba(245,158,11,0.08)',
                  color: '#F59E0B',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                }}
              >
                New Pane
              </div>
              {draggingMouse && (
                <div
                  style={{
                    position: 'absolute',
                    left: draggingMouse.x + 12,
                    top: draggingMouse.y + 12,
                    zIndex: 30,
                    pointerEvents: 'none',
                    border: '1px solid rgba(255,255,255,0.12)',
                    backgroundColor: 'rgba(22,27,34,0.95)',
                    color: '#E6EDF3',
                    borderRadius: 4,
                    padding: '4px 6px',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 10,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {draggedIndicatorName}
                </div>
              )}
            </>
          )}
          {chartLayout && !dragState && chartLayout.subPanes.map((pane) => (
            <div
              key={`divider-${pane.paneId}`}
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
                  transition: 'background-color 120ms ease-out',
                }}
              />
            </div>
          ))}
        </ChartCanvas>

        {chartLayout && activeProbEngIndicator && probEngWidget.visible && (
          <ProbEngFloatingWidget
            indicator={activeProbEngIndicator}
            widget={probEngWidget}
            dragging={probEngDragging}
            hovered={probEngHovered}
            onHeaderPointerDown={handleProbEngPointerDown}
            onHeaderPointerMove={handleProbEngPointerMove}
            onHeaderPointerUp={handleProbEngPointerUp}
            onHeaderPointerCancel={handleProbEngPointerCancel}
            onMouseEnter={() => setProbEngHovered(true)}
            onMouseLeave={() => setProbEngHovered(false)}
            onToggleLock={() => {
              setProbEngWidget((prev) => ({ ...prev, locked: !prev.locked }));
            }}
          />
        )}

        <IndicatorLegend
          indicators={activeIndicators}
          activeScripts={activeScripts}
          leftOffset={64}
          onUpdateParams={handleUpdateParams}
          onUpdateTextParams={handleUpdateTextParams}
          onUpdateColor={handleUpdateColor}
          onUpdateLineWidth={handleUpdateLineWidth}
          onUpdateLineStyle={handleUpdateLineStyle}
          onRemove={handleRemoveIndicator}
          onToggleVisibility={handleToggleVisibility}
          onSetDefaultColor={handleSetDefaultColor}
          onMoveUp={(id) => handleMoveIndicator(id, 'up')}
          onMoveDown={(id) => handleMoveIndicator(id, 'down')}
          onDragStart={(id) => {
            const indicator = activeIndicators.find((entry) => entry.id === id);
            if (!indicator) return;
            setDragState({ indicatorId: id, sourcePaneId: indicator.paneId });
          }}
          onDragEnd={() => {
            setDragState(null);
            setDraggingMouse(null);
            setDragHoverPaneId(null);
          }}
          onOpenBuiltInScript={({ name, source }) => {
            setBuiltInScriptViewer({ name, source });
            setScriptEditorOpen(true);
          }}
          allCollapsed={legendCollapsed}
          onCollapsedChange={setLegendCollapsed}
        />


        {scriptEditorOpen && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              scriptDividerDragRef.current = {
                startX: e.clientX,
                startWidth: scriptEditorWidth,
              };
              document.body.style.cursor = 'ew-resize';
              document.body.style.userSelect = 'none';
            }}
            style={{
              width: 7,
              cursor: 'ew-resize',
              position: 'relative',
              flexShrink: 0,
              backgroundColor: 'transparent',
            }}
            title="Resize script panel"
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 3,
                width: 1,
                backgroundColor: '#21262D',
              }}
            />
          </div>
        )}

      <ScriptEditor
          open={scriptEditorOpen}
          onClose={() => {
            setBuiltInScriptViewer(null);
            setScriptEditorOpen(false);
          }}
          onRunScript={handleRunScript}
          onStopScript={handleStopScript}
          onScriptsChange={setActiveScriptSources}
          builtInViewer={builtInScriptViewer}
          onBuiltInViewerChange={setBuiltInScriptViewer}
          width={scriptEditorWidth}
      />
      <CustomStrategyModal
        open={customStrategyEditor !== null}
        strategy={customStrategyEditor}
        onSave={handleSaveCustomStrategy}
        onClose={() => setCustomStrategyEditor(null)}
      />
      </div>
    </div>
  );
}

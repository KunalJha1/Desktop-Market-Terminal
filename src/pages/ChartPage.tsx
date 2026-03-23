import { useState, useRef, useCallback, useEffect } from 'react';
import type { Timeframe, ChartType, ActiveIndicator, ScriptResult, YScaleMode, ChartLayout } from '../chart/types';
import { ChartEngine } from '../chart/core/ChartEngine';
import { useChartData } from '../chart/hooks/useChartData';
import { useTws } from '../lib/tws';
import { linkBus } from '../lib/link-bus';
import ChartCanvas from '../chart/components/ChartCanvas';
import ChartToolbar from '../chart/components/ChartToolbar';
import IndicatorPanel from '../chart/components/IndicatorPanel';
import IndicatorLegend from '../chart/components/IndicatorLegend';
import ScriptEditor from '../chart/components/ScriptEditor';
import { interpretScript } from '../chart/scripting/interpreter';
import { loadChartState, saveChartState, type PersistedChartIndicator, type ChartState } from '../lib/chart-state';

interface ChartPageProps {
  tabId?: string;
}

export default function ChartPage({ tabId }: ChartPageProps) {
  const makeDetachedPaneId = useCallback(() => `pane:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, []);
  const defaultChartState: ChartState = {
    symbol: 'AAPL',
    timeframe: '1D',
    chartType: 'candlestick',
    linkChannel: null,
    indicators: [],
    stopperPx: 80,
    indicatorColorDefaults: {},
  };
  const [persisted, setPersisted] = useState<ChartState | null>(() => (tabId ? loadChartState(tabId) : null));
  const initialState = persisted ?? defaultChartState;

  const [symbol, setSymbol] = useState(initialState.symbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialState.timeframe);
  const [chartType, setChartType] = useState<ChartType>(initialState.chartType);
  const [linkChannel, setLinkChannel] = useState<number | null>(initialState.linkChannel);
  const [stopperPx, setStopperPx] = useState<number>(initialState.stopperPx);
  const [indicatorColorDefaults, setIndicatorColorDefaults] = useState<Record<string, Record<string, string>>>(
    initialState.indicatorColorDefaults,
  );
  const [yScaleMode, setYScaleMode] = useState<YScaleMode>('auto');
  const [indicatorPanelOpen, setIndicatorPanelOpen] = useState(false);
  const [strategyPanelOpen, setStrategyPanelOpen] = useState(false);
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([]);
  const [activeScripts, setActiveScripts] = useState<Map<string, ScriptResult>>(new Map());
  const [chartLayout, setChartLayout] = useState<ChartLayout | null>(null);
  const [draggingIndicatorId, setDraggingIndicatorId] = useState<string | null>(null);
  const restoredIndicatorsRef = useRef(false);

  const engineRef = useRef<ChartEngine | null>(null);

  // TWS data hook
  const { sidecarPort } = useTws();
  const { bars, loading, source, onViewportChange } = useChartData({
    symbol,
    timeframe,
    sidecarPort,
  });

  const serializeIndicators = useCallback((indicators: ActiveIndicator[]): PersistedChartIndicator[] => (
    indicators.map((indicator) => ({
      name: indicator.name,
      paneId: indicator.paneId,
      params: { ...indicator.params },
      colors: { ...indicator.colors },
      lineWidths: indicator.lineWidths ? { ...indicator.lineWidths } : undefined,
      lineStyles: indicator.lineStyles ? { ...indicator.lineStyles } : undefined,
      visible: indicator.visible,
    }))
  ), []);

  const applySerializedIndicators = useCallback((
    engine: ChartEngine,
    serializedIndicators: PersistedChartIndicator[],
  ) => {
    for (const indicator of [...engine.getActiveIndicators()]) {
      engine.removeIndicator(indicator.id);
    }

    for (const serializedIndicator of serializedIndicators) {
      const id = engine.addIndicator(serializedIndicator.name);
      if (!id) continue;
      engine.setIndicatorPane(id, serializedIndicator.paneId);
      if (Object.keys(serializedIndicator.params).length > 0) {
        engine.updateIndicatorParams(id, serializedIndicator.params);
      }
      const mergedColors = {
        ...(indicatorColorDefaults[serializedIndicator.name] ?? {}),
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

  useEffect(() => {
    const nextPersisted = tabId ? loadChartState(tabId) : null;
    setPersisted(nextPersisted);
    const nextState = nextPersisted ?? defaultChartState;
    setSymbol(nextState.symbol);
    setTimeframe(nextState.timeframe);
    setChartType(nextState.chartType);
    setLinkChannel(nextState.linkChannel);
    setStopperPx(nextState.stopperPx);
    setIndicatorColorDefaults(nextState.indicatorColorDefaults);
    setActiveIndicators([]);
    setActiveScripts(new Map());
    setChartLayout(null);
    setDraggingIndicatorId(null);
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
    saveChartState(tabId, {
      symbol,
      timeframe,
      chartType,
      linkChannel,
      indicators: serializeIndicators(activeIndicators),
      stopperPx,
      indicatorColorDefaults,
    });
  }, [tabId, symbol, timeframe, chartType, linkChannel, activeIndicators, stopperPx, indicatorColorDefaults, serializeIndicators]);

  // Re-add persisted indicators once engine is ready
  useEffect(() => {
    if (restoredIndicatorsRef.current || !engineRef.current || !persisted?.indicators?.length) return;
    restoredIndicatorsRef.current = true;
    const engine = engineRef.current;
    applySerializedIndicators(engine, persisted.indicators);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, [bars, persisted, applySerializedIndicators]);

  // Reconcile React/persisted indicator state back into the engine whenever
  // zoom/layout churn or fast refresh leaves the engine incomplete.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || bars.length === 0) return;
    const desiredIndicators = activeIndicators.length > 0
      ? serializeIndicators(activeIndicators)
      : (persisted?.indicators ?? []);
    if (desiredIndicators.length === 0) return;

    const engineIndicators = engine.getActiveIndicators();
    if (serializedIndicatorsMatch(desiredIndicators, engineIndicators)) return;

    applySerializedIndicators(engine, desiredIndicators);
    setActiveIndicators([...engine.getActiveIndicators()]);
  }, [
    bars,
    activeIndicators,
    persisted,
    serializeIndicators,
    applySerializedIndicators,
    serializedIndicatorsMatch,
  ]);

  useEffect(() => {
    syncDailyIQScorePane();
  }, [activeIndicators, syncDailyIQScorePane]);

  useEffect(() => {
    if (!engineRef.current) return;
    setChartLayout(engineRef.current.getLayout());
  }, [activeIndicators, activeScripts, bars, stopperPx]);

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
    }
    return result;
  }, [bars]);

  const handleStopScript = useCallback((id: string) => {
    setActiveScripts(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

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
        onScriptEditorToggle={() => setScriptEditorOpen(!scriptEditorOpen)}
        dataSource={source}
        loading={loading}
        linkChannel={linkChannel}
        onLinkChannelChange={handleLinkChannelChange}
        stopperPx={stopperPx}
        onStopperPxChange={setStopperPx}
        onZoomIn={() => engineRef.current?.zoomIn()}
        onZoomOut={() => engineRef.current?.zoomOut()}
        onZoomReset={() => engineRef.current?.resetZoom()}
        yScaleMode={yScaleMode}
        onYScaleModeChange={handleYScaleModeChange}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <ChartCanvas
          bars={bars}
          chartType={chartType}
          timeframe={timeframe}
          engineRef={engineRef}
          brandingMode="fullLogo"
          activeScripts={activeScripts}
          liveMode={source === 'tws'}
          stopperPx={stopperPx}
          onStopperPxChange={setStopperPx}
          onViewportChange={onViewportChange}
          onLayoutChange={setChartLayout}
        >
          {draggingIndicatorId && chartLayout && (
            <>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleMoveIndicatorToPane(draggingIndicatorId, 'main');
                  setDraggingIndicatorId(null);
                }}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: chartLayout.priceAxisWidth,
                  top: chartLayout.mainTop,
                  height: chartLayout.mainHeight,
                  border: '1px dashed rgba(26,86,219,0.5)',
                  backgroundColor: 'rgba(26,86,219,0.08)',
                  color: '#8B949E',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-end',
                  padding: 6,
                  pointerEvents: 'auto',
                }}
              >
                Overlay on Price
              </div>
              {chartLayout.subPanes.map((pane) => (
                <div
                  key={pane.paneId}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleMoveIndicatorToPane(draggingIndicatorId, pane.paneId);
                    setDraggingIndicatorId(null);
                  }}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: chartLayout.priceAxisWidth,
                    top: pane.top,
                    height: pane.height,
                    border: '1px dashed rgba(139,148,158,0.35)',
                    backgroundColor: 'rgba(139,148,158,0.06)',
                    color: '#8B949E',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 10,
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'flex-end',
                    padding: 6,
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
                  handleMoveIndicatorToPane(draggingIndicatorId, makeDetachedPaneId());
                  setDraggingIndicatorId(null);
                }}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: chartLayout.priceAxisWidth,
                  bottom: chartLayout.timeAxisHeight,
                  height: 24,
                  borderTop: '1px dashed rgba(245,158,11,0.5)',
                  backgroundColor: 'rgba(245,158,11,0.08)',
                  color: '#F59E0B',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'auto',
                }}
              >
                New Pane
              </div>
            </>
          )}
        </ChartCanvas>

        <IndicatorLegend
          indicators={activeIndicators}
          activeScripts={activeScripts}
          onUpdateParams={handleUpdateParams}
          onUpdateColor={handleUpdateColor}
          onUpdateLineWidth={handleUpdateLineWidth}
          onUpdateLineStyle={handleUpdateLineStyle}
          onRemove={handleRemoveIndicator}
          onToggleVisibility={handleToggleVisibility}
          onSetDefaultColor={handleSetDefaultColor}
          onMoveUp={(id) => handleMoveIndicator(id, 'up')}
          onMoveDown={(id) => handleMoveIndicator(id, 'down')}
          onDragStart={setDraggingIndicatorId}
          onDragEnd={() => setDraggingIndicatorId(null)}
        />

        <IndicatorPanel
          open={indicatorPanelOpen}
          onClose={() => setIndicatorPanelOpen(false)}
          onAddIndicator={handleAddIndicator}
          activeIndicators={activeIndicators}
        />

        <IndicatorPanel
          open={strategyPanelOpen}
          onClose={() => setStrategyPanelOpen(false)}
          onAddIndicator={handleAddIndicator}
          onToggleIndicator={handleToggleStrategy}
          activeIndicators={activeIndicators}
          mode="strategy"
        />

        <ScriptEditor
          open={scriptEditorOpen}
          onClose={() => setScriptEditorOpen(false)}
          onRunScript={handleRunScript}
          onStopScript={handleStopScript}
          onScriptsChange={() => {}}
        />
      </div>
    </div>
  );
}

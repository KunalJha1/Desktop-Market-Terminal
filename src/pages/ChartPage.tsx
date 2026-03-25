import { useState, useRef, useCallback, useEffect } from 'react';
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
  loadChartState,
  saveChartState,
  type PersistedChartIndicator,
  type ChartState,
} from '../lib/chart-state';
import { VOLUME_PANE_RATIO } from '../chart/constants';

interface ChartPageProps {
  tabId?: string;
}

export default function ChartPage({ tabId }: ChartPageProps) {
  const chartToolRailWidth = 56;
  const defaultIndicatorsRef = useRef<PersistedChartIndicator[]>(createDefaultPersistedChartIndicators());
  const chartOverlayRef = useRef<HTMLDivElement>(null);
  const makeDetachedPaneId = useCallback(() => `pane:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, []);
  const defaultChartState: ChartState = {
    symbol: 'AAPL',
    timeframe: '1D',
    chartType: 'candlestick',
    linkChannel: 1,
    indicators: defaultIndicatorsRef.current,
    stopperPx: 80,
    indicatorColorDefaults: {},
  };
  const [persisted, setPersisted] = useState<ChartState | null>(() => (tabId ? loadChartState(tabId) : null));
  const initialState = persisted ?? defaultChartState;
  const restoredIndicators = persisted?.indicators ?? defaultIndicatorsRef.current;

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
  const [dragState, setDragState] = useState<{ indicatorId: string; sourcePaneId: string } | null>(null);
  const [draggingMouse, setDraggingMouse] = useState<{ x: number; y: number } | null>(null);
  const [dragHoverPaneId, setDragHoverPaneId] = useState<string | null>(null);
  const restoredIndicatorsRef = useRef(false);
  const paneDividerDragRef = useRef<{ paneId: string; startY: number; startHeight: number } | null>(null);

  const engineRef = useRef<ChartEngine | null>(null);
  const [engineVersion, setEngineVersion] = useState(0);

  // TWS data hook
  const { sidecarPort } = useTws();
  const { bars, loading, source, onViewportChange, pendingViewportShift, onViewportShiftApplied, updateMode, tailChangeOffset } = useChartData({
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
    setDragState(null);
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
      linkChannel,
      indicators: serializeIndicators(activeIndicators),
      stopperPx,
      indicatorColorDefaults,
    });
  }, [tabId, symbol, timeframe, chartType, linkChannel, activeIndicators, stopperPx, indicatorColorDefaults, serializeIndicators]);

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

  const handleEngineReady = useCallback(() => {
    setEngineVersion(v => v + 1);
  }, []);

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
        indicatorPanelOpen={indicatorPanelOpen}
        strategyPanelOpen={strategyPanelOpen}
        onIndicatorPanelClose={() => setIndicatorPanelOpen(false)}
        onStrategyPanelClose={() => setStrategyPanelOpen(false)}
        onAddIndicator={handleAddIndicator}
        onToggleStrategy={handleToggleStrategy}
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
      />

      <div ref={chartOverlayRef} className="flex flex-1 overflow-hidden relative">
        <ChartCanvas
          bars={bars}
          symbol={symbol}
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
                    alignItems: 'flex-start',
                    justifyContent: 'flex-end',
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

        <IndicatorLegend
          indicators={activeIndicators}
          activeScripts={activeScripts}
          leftOffset={64}
          onUpdateParams={handleUpdateParams}
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

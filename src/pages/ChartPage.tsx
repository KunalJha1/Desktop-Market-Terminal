import { useState, useRef, useCallback, useEffect } from 'react';
import type { Timeframe, ChartType, ActiveIndicator, ScriptResult } from '../chart/types';
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
import { loadChartState, saveChartState } from '../lib/chart-state';

interface ChartPageProps {
  tabId?: string;
}

export default function ChartPage({ tabId }: ChartPageProps) {
  // Load persisted state
  const persisted = tabId ? loadChartState(tabId) : null;

  const [symbol, setSymbol] = useState(persisted?.symbol ?? 'AAPL');
  const [timeframe, setTimeframe] = useState<Timeframe>(persisted?.timeframe ?? '1D');
  const [chartType, setChartType] = useState<ChartType>(persisted?.chartType ?? 'candlestick');
  const [linkChannel, setLinkChannel] = useState<number | null>(persisted?.linkChannel ?? null);
  const [stopperPx, setStopperPx] = useState<number>(persisted?.stopperPx ?? 80);
  const [indicatorColorDefaults, setIndicatorColorDefaults] = useState<Record<string, Record<string, string>>>(
    persisted?.indicatorColorDefaults ?? {},
  );
  const [indicatorPanelOpen, setIndicatorPanelOpen] = useState(false);
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([]);
  const [activeScripts, setActiveScripts] = useState<Map<string, ScriptResult>>(new Map());
  const restoredIndicatorsRef = useRef(false);

  const engineRef = useRef<ChartEngine | null>(null);

  // TWS data hook
  const { sidecarPort } = useTws();
  const { bars, loading, source } = useChartData({
    symbol,
    timeframe,
    sidecarPort,
  });

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
      indicators: activeIndicators.map((indicator) => indicator.name),
      stopperPx,
      indicatorColorDefaults,
    });
  }, [tabId, symbol, timeframe, chartType, linkChannel, activeIndicators, stopperPx, indicatorColorDefaults]);

  // Re-add persisted indicators once engine is ready
  useEffect(() => {
    if (restoredIndicatorsRef.current || !engineRef.current || !persisted?.indicators?.length) return;
    restoredIndicatorsRef.current = true;
    const engine = engineRef.current;
    for (const indName of persisted.indicators) {
      const id = engine.addIndicator(indName);
      if (id) {
        const defaults = indicatorColorDefaults[indName];
        if (defaults) {
          for (const [outputKey, color] of Object.entries(defaults)) {
            engine.updateIndicatorColor(id, outputKey, color);
          }
        }
      }
    }
    setActiveIndicators([...engine.getActiveIndicators()]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars]); // fires once engine has data

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

  const handleUpdateColor = useCallback((id: string, outputKey: string, color: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorColor(id, outputKey, color);
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
        onIndicatorPanelToggle={() => setIndicatorPanelOpen(!indicatorPanelOpen)}
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
      />

      <div className="flex flex-1 overflow-hidden relative">
        <ChartCanvas
          bars={bars}
          chartType={chartType}
          timeframe={timeframe}
          engineRef={engineRef}
          activeScripts={activeScripts}
          liveMode={source === 'tws'}
          stopperPx={stopperPx}
          onStopperPxChange={setStopperPx}
        />

        <IndicatorLegend
          indicators={activeIndicators}
          activeScripts={activeScripts}
          onUpdateParams={handleUpdateParams}
          onUpdateColor={handleUpdateColor}
          onRemove={handleRemoveIndicator}
          onToggleVisibility={handleToggleVisibility}
          onSetDefaultColor={handleSetDefaultColor}
        />

        <ScriptEditor
          open={scriptEditorOpen}
          onClose={() => setScriptEditorOpen(false)}
          onRunScript={handleRunScript}
          onStopScript={handleStopScript}
          onScriptsChange={() => {}}
        />
      </div>

      <IndicatorPanel
        open={indicatorPanelOpen}
        onClose={() => setIndicatorPanelOpen(false)}
        onAddIndicator={handleAddIndicator}
      />
    </div>
  );
}

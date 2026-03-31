import { useState, useRef, useEffect } from 'react';
import type { Timeframe, ChartType } from '../types';
import type { ActiveIndicator } from '../types';
import { TIMEFRAMES, CHART_TYPES } from '../constants';
import {
  ChevronDown,
  BarChart3,
  LineChart,
  TrendingUp,
  BrainCircuit,
  Activity,
  Code,
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import ComponentLinkMenu from '../../components/ComponentLinkMenu';
import SymbolSearchModal from '../../components/SymbolSearchModal';
import IndicatorPanel from './IndicatorPanel';
import type { CustomStrategyDefinition, StrategyState } from '../customStrategies';
import type { PersistedChartScript } from '../../lib/chart-state';

interface ChartToolbarProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  chartType: ChartType;
  onChartTypeChange: (ct: ChartType) => void;
  onIndicatorPanelToggle: () => void;
  onStrategyPanelToggle: () => void;
  onScriptEditorToggle: () => void;
  indicatorPanelOpen?: boolean;
  strategyPanelOpen?: boolean;
  onIndicatorPanelClose?: () => void;
  onStrategyPanelClose?: () => void;
  onAddIndicator?: (name: string) => void;
  onToggleStrategy?: (name: string) => void;
  customStrategies?: CustomStrategyDefinition[];
  activeCustomStrategyIds?: string[];
  customStrategySummaryById?: Record<string, { score: number | null; state: StrategyState }>;
  onToggleCustomStrategy?: (id: string) => void;
  onCreateCustomStrategy?: () => void;
  onEditCustomStrategy?: (id: string) => void;
  onDuplicateCustomStrategy?: (id: string) => void;
  onDeleteCustomStrategy?: (id: string) => void;
  savedScripts?: PersistedChartScript[];
  activeScriptIds?: string[];
  onToggleScript?: (id: string) => void;
  onEditScript?: (id: string) => void;
  onDeleteScript?: (id: string) => void;
  onCreateCodeStrategy?: () => void;
  onCopyMasterPrompt?: () => void;
  activeIndicators?: ActiveIndicator[];
  dataSource?: 'tws' | 'yahoo' | 'cache' | 'offline';
  loading?: boolean;
  linkChannel?: number | null;
  onLinkChannelChange?: (ch: number | null) => void;
  stopperPx?: number;
  onStopperPxChange?: (px: number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  onExportChart?: () => void;
  onImportChart?: () => void;
}

export default function ChartToolbar({
  symbol,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  chartType,
  onChartTypeChange,
  onIndicatorPanelToggle,
  onStrategyPanelToggle,
  onScriptEditorToggle,
  indicatorPanelOpen = false,
  strategyPanelOpen = false,
  onIndicatorPanelClose,
  onStrategyPanelClose,
  onAddIndicator,
  onToggleStrategy,
  customStrategies = [],
  activeCustomStrategyIds = [],
  customStrategySummaryById = {},
  onToggleCustomStrategy,
  onCreateCustomStrategy,
  onEditCustomStrategy,
  onDuplicateCustomStrategy,
  onDeleteCustomStrategy,
  savedScripts = [],
  activeScriptIds = [],
  onToggleScript,
  onEditScript,
  onDeleteScript,
  onCreateCodeStrategy,
  onCopyMasterPrompt,
  activeIndicators = [],
  dataSource = 'offline',
  loading = false,
  linkChannel = null,
  onLinkChannelChange,
  stopperPx: _stopperPx = 0,
  onStopperPxChange: _onStopperPxChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onExportChart: _onExportChart,
  onImportChart: _onImportChart,
}: ChartToolbarProps) {
  const [chartTypeOpen, setChartTypeOpen] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setChartTypeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const chartTypeIcon = () => {
    switch (chartType) {
      case 'candlestick': return <BarChart3 size={14} />;
      case 'bar': return <BarChart3 size={14} />;
      case 'line': return <LineChart size={14} />;
      case 'area': return <TrendingUp size={14} />;
      case 'heikin-ashi': return <Activity size={14} />;
      case 'volume-weighted': return <BarChart3 size={14} />;
    }
  };

  return (
    <div className="flex items-center gap-1 px-2 h-[36px] border-b border-border-default bg-panel shrink-0">
      {/* Symbol button — opens search modal */}
      <button
        onClick={() => setSymbolSearchOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-btn hover:bg-white/[0.06] transition-colors duration-120 mr-2"
        title="Click to search for a different symbol"
      >
        <Search size={12} className="text-text-muted" />
        <span className="font-mono text-[11px] text-text-primary">
          {symbol}
        </span>
      </button>

      <SymbolSearchModal
        isOpen={symbolSearchOpen}
        onClose={() => setSymbolSearchOpen(false)}
        onSelectSymbol={onSymbolChange}
        excludeSymbol={symbol}
      />

      {/* Separator */}
      <div className="w-px h-4 bg-border-default" />

      {/* Timeframes */}
      <div className="flex items-center gap-0.5 mx-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => onTimeframeChange(tf.value)}
            className={`px-1.5 py-0.5 text-[10px] font-mono rounded-btn transition-colors duration-120
              ${timeframe === tf.value
                ? 'text-[#3B82F6] bg-[#3B82F6]/10'
                : 'text-text-primary hover:text-white hover:bg-hover'
              }`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-border-default" />

      {/* Chart type dropdown */}
      <div className="relative mx-1" ref={dropdownRef}>
        <button
          onClick={() => setChartTypeOpen(!chartTypeOpen)}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-white
                     hover:text-white hover:bg-hover rounded-btn transition-colors duration-120"
        >
          {chartTypeIcon()}
          <span className="font-mono">{CHART_TYPES.find(ct => ct.value === chartType)?.label}</span>
          <ChevronDown size={10} />
        </button>
        {chartTypeOpen && (
          <div className="absolute top-full left-0 mt-1 bg-panel border border-border-default rounded-btn py-1 z-50 min-w-[120px]">
            {CHART_TYPES.map((ct) => (
              <button
                key={ct.value}
                onClick={() => { onChartTypeChange(ct.value); setChartTypeOpen(false); }}
                className={`w-full text-left px-3 py-1 text-[10px] font-mono transition-colors duration-120
                  ${chartType === ct.value
                    ? 'text-blue bg-blue/10'
                    : 'text-text-secondary hover:text-text-primary hover:bg-hover'
                  }`}
              >
                {ct.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-border-default" />

      {/* Indicators button */}
      <div className="relative mx-1">
        <button
          onClick={onIndicatorPanelToggle}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-white
                     hover:text-white hover:bg-hover rounded-btn transition-colors duration-120"
        >
          <Activity size={12} />
          <span className="font-mono">Indicators</span>
        </button>
        <IndicatorPanel
          open={indicatorPanelOpen}
          onClose={() => onIndicatorPanelClose?.()}
          onAddIndicator={onAddIndicator ?? (() => {})}
          activeIndicators={activeIndicators}
        />
      </div>

      <div className="w-px h-4 bg-border-default" />

      <div className="relative">
        <button
          onClick={onStrategyPanelToggle}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-white
                     hover:text-white hover:bg-hover rounded-btn transition-colors duration-120"
        >
          <BrainCircuit size={13} />
          <span className="font-mono">Strategies</span>
        </button>
        <IndicatorPanel
          open={strategyPanelOpen}
          onClose={() => onStrategyPanelClose?.()}
          onAddIndicator={onAddIndicator ?? (() => {})}
          onToggleIndicator={onToggleStrategy}
          customStrategies={customStrategies}
          activeCustomStrategyIds={activeCustomStrategyIds}
          customStrategySummaryById={customStrategySummaryById}
          onToggleCustomStrategy={onToggleCustomStrategy}
          onCreateCustomStrategy={onCreateCustomStrategy}
          onEditCustomStrategy={onEditCustomStrategy}
          onDuplicateCustomStrategy={onDuplicateCustomStrategy}
          onDeleteCustomStrategy={onDeleteCustomStrategy}
          savedScripts={savedScripts}
          activeScriptIds={activeScriptIds}
          onToggleScript={onToggleScript}
          onEditScript={onEditScript}
          onDeleteScript={onDeleteScript}
          onCreateCodeStrategy={onCreateCodeStrategy}
          onCopyMasterPrompt={onCopyMasterPrompt}
          activeIndicators={activeIndicators}
          mode="strategy"
        />
      </div>

      <div className="w-px h-4 bg-border-default" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1 mx-1">
        <button
          onClick={onZoomOut}
          className="p-1 text-white hover:text-white hover:bg-hover rounded-btn transition-colors duration-120"
          title="Zoom out"
        >
          <ZoomOut size={12} />
        </button>
        <button
          onClick={onZoomIn}
          className="p-1 text-white hover:text-white hover:bg-hover rounded-btn transition-colors duration-120"
          title="Zoom in"
        >
          <ZoomIn size={12} />
        </button>
        <button
          onClick={onZoomReset}
          className="p-1 text-white hover:text-white hover:bg-hover rounded-btn transition-colors duration-120"
          title="Reset zoom"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      <div className="w-px h-4 bg-border-default" />

      {/* Script button */}
      <button
        onClick={onScriptEditorToggle}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-purple
                   hover:text-purple hover:bg-purple/10 rounded-btn transition-colors duration-120"
      >
        <Code size={12} />
        <span>Script</span>
      </button>

      <div className="w-px h-4 bg-border-default" />

      {/* DISABLED: import/export not yet functional
      <div className="flex items-center gap-1 mx-1">
        <button
          onClick={onImportChart}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-secondary
                     hover:text-text-primary hover:bg-hover rounded-btn transition-colors duration-120"
          title="Import .diqc"
        >
          <FolderOpen size={12} />
          <span className="font-mono">Import</span>
        </button>
        <button
          onClick={onExportChart}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-secondary
                     hover:text-text-primary hover:bg-hover rounded-btn transition-colors duration-120"
          title="Export .diqc"
        >
          <Save size={12} />
          <span className="font-mono">Export</span>
        </button>
      </div>

      <div className="w-px h-4 bg-border-default" />
      */}

      {/* Link channel */}
      <ComponentLinkMenu
        linkChannel={linkChannel ?? null}
        onSetLinkChannel={(ch) => onLinkChannelChange?.(ch)}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Data source indicator */}
      <div className="flex items-center gap-1.5 mr-1">
        {loading && (
          <div className="w-2 h-2 rounded-full bg-amber animate-pulse" />
        )}
        <span className={`text-[9px] font-mono ${
          dataSource === 'tws' ? 'text-green'
            : dataSource === 'yahoo' ? 'text-blue'
            : dataSource === 'cache' ? 'text-amber'
            : 'text-text-muted'
        }`}>
          {dataSource === 'tws' ? 'LIVE'
            : dataSource === 'yahoo' ? 'YAHOO'
            : dataSource === 'cache' ? 'CACHED'
            : 'OFFLINE'}
        </span>
      </div>

    </div>
  );
}

import React, { useState, useRef, useEffect } from 'react';
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
  Settings2,
  Clock,
} from 'lucide-react';
import ComponentLinkMenu from '../../components/ComponentLinkMenu';
import SymbolSearchModal from '../../components/SymbolSearchModal';
import IndicatorPanel from './IndicatorPanel';
import type { CustomStrategyDefinition, StrategyState } from '../customStrategies';
import type { PersistedChartScript } from '../../lib/chart-state';

const COMPACT_TIMEFRAME_DROPDOWN_VALUES = new Set<Timeframe>(['3D', '1W', '1M', '3M', '6M', '12M']);

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
  dataSource?: 'tws' | 'dailyiq' | 'yahoo' | 'cache' | 'offline';
  loading?: boolean;
  isStale?: boolean;
  linkChannel?: number | null;
  onLinkChannelChange?: (ch: number | null) => void;
  stopperPx?: number;
  onStopperPxChange?: (px: number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  onExportChart?: () => void;
  onImportChart?: () => void;
  rightSlot?: React.ReactNode;
  compact?: boolean;
  tickerQuote?: { price: number; dollar: number; pct: number };
  volumeWeightedColors?: { up: string; down: string };
  onVolumeWeightedColorsChange?: (colors: { up: string; down: string }) => void;
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
  isStale = false,
  linkChannel = null,
  onLinkChannelChange,
  stopperPx: _stopperPx = 0,
  onStopperPxChange: _onStopperPxChange,
  onZoomIn: _onZoomIn,
  onZoomOut: _onZoomOut,
  onZoomReset: _onZoomReset,
  onExportChart: _onExportChart,
  onImportChart: _onImportChart,
  rightSlot,
  compact = false,
  tickerQuote,
  volumeWeightedColors = { up: '#00C853', down: '#FF3D71' },
  onVolumeWeightedColorsChange,
}: ChartToolbarProps) {
  const [chartTypeOpen, setChartTypeOpen] = useState(false);
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [volSettingsOpen, setVolSettingsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const timeframeRef = useRef<HTMLDivElement>(null);
  const volSettingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setChartTypeOpen(false);
      }
      if (timeframeRef.current && !timeframeRef.current.contains(e.target as Node)) {
        setTimeframeOpen(false);
      }
      if (volSettingsRef.current && !volSettingsRef.current.contains(e.target as Node)) {
        setVolSettingsOpen(false);
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
  const visibleTimeframes = compact
    ? TIMEFRAMES.filter((tf) => !COMPACT_TIMEFRAME_DROPDOWN_VALUES.has(tf.value))
    : TIMEFRAMES;
  const hiddenTimeframes = compact
    ? TIMEFRAMES.filter((tf) => COMPACT_TIMEFRAME_DROPDOWN_VALUES.has(tf.value))
    : [];
  const hiddenTimeframeActive = hiddenTimeframes.some((tf) => tf.value === timeframe);

  return (
    <div className="flex items-center gap-1 px-2 h-[36px] border-b border-border-default bg-panel shrink-0">
      {/* Symbol button — opens search modal */}
      <button
        onClick={() => setSymbolSearchOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-btn hover:bg-white/[0.06] transition-colors duration-120 mr-2"
        title="Click to search for a different symbol"
      >
        <Search size={12} className="text-text-muted" />
        <span className="font-mono text-[11px] text-text-primary font-semibold">
          {symbol}
        </span>
        {tickerQuote && (
          <>
            <span className="font-mono text-[11px] text-text-primary ml-1">
              {tickerQuote.price.toFixed(2)}
            </span>
            <span className={`font-mono text-[10px] ml-0.5 ${tickerQuote.dollar >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
              {tickerQuote.dollar >= 0 ? '+' : ''}{tickerQuote.dollar.toFixed(2)}
            </span>
            <span className={`font-mono text-[10px] ${tickerQuote.pct >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
              ({tickerQuote.pct >= 0 ? '+' : ''}{tickerQuote.pct.toFixed(2)}%)
            </span>
          </>
        )}
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
        {visibleTimeframes.map((tf) => (
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
        {hiddenTimeframes.length > 0 && (
          <div className="relative" ref={timeframeRef}>
            <button
              onClick={() => setTimeframeOpen((open) => !open)}
              className={`px-1.5 py-0.5 text-[10px] font-mono rounded-btn transition-colors duration-120
                ${hiddenTimeframeActive || timeframeOpen
                  ? 'text-[#3B82F6] bg-[#3B82F6]/10'
                  : 'text-text-primary hover:text-white hover:bg-hover'
                }`}
              title="More timeframes"
            >
              <Clock size={14} />
            </button>
            {timeframeOpen && (
              <div className="absolute top-full right-0 mt-1 bg-panel border border-border-default rounded-btn py-1 z-50 min-w-[64px]">
                {hiddenTimeframes.map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => {
                      onTimeframeChange(tf.value);
                      setTimeframeOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-2 py-1 text-left text-[10px] font-mono transition-colors duration-120
                      ${timeframe === tf.value
                        ? 'text-blue bg-blue/10'
                        : 'text-text-secondary hover:text-text-primary hover:bg-hover'
                      }`}
                  >
                    <span>{tf.label}</span>
                    {timeframe === tf.value && <span className="text-[8px] text-blue">●</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-border-default" />

      {/* Chart type dropdown */}
      <div className="relative mx-1" ref={dropdownRef}>
        <button
          onClick={() => setChartTypeOpen(!chartTypeOpen)}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-white
                     hover:text-white hover:bg-hover rounded-btn transition-colors duration-120"
          title={CHART_TYPES.find(ct => ct.value === chartType)?.label}
        >
          {chartTypeIcon()}
          {!compact && <span className="font-mono">{CHART_TYPES.find(ct => ct.value === chartType)?.label}</span>}
          {!compact && <ChevronDown size={10} />}
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

      {/* Vol Weighted settings gear — only shown when that chart type is active */}
      {chartType === 'volume-weighted' && (
        <div className="relative" ref={volSettingsRef}>
          <button
            onClick={() => setVolSettingsOpen((v) => !v)}
            className={`flex items-center justify-center w-6 h-6 rounded-btn transition-colors duration-120 ${
              volSettingsOpen
                ? 'text-blue bg-blue/10'
                : 'text-text-muted hover:text-text-primary hover:bg-hover'
            }`}
            title="Vol Weighted settings"
          >
            <Settings2 size={12} />
          </button>
          {volSettingsOpen && (
            <div className="absolute top-full left-0 mt-1 bg-panel border border-border-default rounded-md py-2 px-3 z-50 w-[188px] shadow-lg">
              <p className="text-[9px] font-mono text-text-muted uppercase tracking-wider mb-2">Vol Weighted</p>
              <div className="flex flex-col gap-2.5">
                {/* Value Up */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-text-secondary">Value Up</span>
                  <label className="flex items-center gap-1.5 cursor-pointer group">
                    <span className="text-[9px] font-mono text-text-muted group-hover:text-text-secondary transition-colors">
                      {volumeWeightedColors.up.toUpperCase()}
                    </span>
                    <div
                      className="w-5 h-5 rounded border border-white/20 group-hover:border-white/40 transition-colors overflow-hidden"
                      style={{ background: volumeWeightedColors.up }}
                    >
                      <input
                        type="color"
                        value={volumeWeightedColors.up}
                        onChange={(e) => onVolumeWeightedColorsChange?.({ ...volumeWeightedColors, up: e.target.value })}
                        className="opacity-0 w-full h-full cursor-pointer"
                        style={{ transform: 'scale(2)' }}
                      />
                    </div>
                  </label>
                </div>
                {/* Value Down */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-text-secondary">Value Down</span>
                  <label className="flex items-center gap-1.5 cursor-pointer group">
                    <span className="text-[9px] font-mono text-text-muted group-hover:text-text-secondary transition-colors">
                      {volumeWeightedColors.down.toUpperCase()}
                    </span>
                    <div
                      className="w-5 h-5 rounded border border-white/20 group-hover:border-white/40 transition-colors overflow-hidden"
                      style={{ background: volumeWeightedColors.down }}
                    >
                      <input
                        type="color"
                        value={volumeWeightedColors.down}
                        onChange={(e) => onVolumeWeightedColorsChange?.({ ...volumeWeightedColors, down: e.target.value })}
                        className="opacity-0 w-full h-full cursor-pointer"
                        style={{ transform: 'scale(2)' }}
                      />
                    </div>
                  </label>
                </div>
                <div className="border-t border-border-default pt-1.5">
                  <button
                    onClick={() => onVolumeWeightedColorsChange?.({ up: '#00C853', down: '#FF3D71' })}
                    className="text-[9px] font-mono text-text-muted hover:text-text-secondary transition-colors"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="w-px h-4 bg-border-default" />

      {/* Indicators button */}
      <div className="relative mx-1">
        <button
          onClick={onIndicatorPanelToggle}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-white
                     hover:text-white hover:bg-hover rounded-btn transition-colors duration-120"
          title="Indicators"
        >
          <Activity size={12} />
          {!compact && <span className="font-mono">Indicators</span>}
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
          title="Strategies"
        >
          <BrainCircuit size={13} />
          {!compact && <span className="font-mono">Strategies</span>}
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

      {/* Script button */}
      <button
        onClick={onScriptEditorToggle}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-purple
                   hover:text-purple hover:bg-purple/10 rounded-btn transition-colors duration-120"
        title="Script"
      >
        <Code size={12} />
        {!compact && <span>Script</span>}
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

      {rightSlot}

      {/* Data source indicator */}
      <div className="flex items-center gap-1.5 mr-1">
        {loading && (
          <div className="w-2 h-2 rounded-full bg-amber animate-pulse" />
        )}
        {isStale && !loading && (
          <div className="w-2 h-2 rounded-full bg-amber opacity-40" title="Refreshing data…" />
        )}
      </div>

    </div>
  );
}

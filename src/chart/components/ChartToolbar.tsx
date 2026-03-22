import { useState, useRef, useEffect } from 'react';
import type { Timeframe, ChartType } from '../types';
import { TIMEFRAMES, CHART_TYPES } from '../constants';
import {
  ChevronDown,
  BarChart3,
  LineChart,
  TrendingUp,
  Activity,
  Code,
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import { SEARCHABLE_SYMBOLS } from '../../lib/market-data';
import ComponentLinkMenu from '../../components/ComponentLinkMenu';

interface ChartToolbarProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  chartType: ChartType;
  onChartTypeChange: (ct: ChartType) => void;
  onIndicatorPanelToggle: () => void;
  onScriptEditorToggle: () => void;
  dataSource?: 'tws' | 'yahoo' | 'cache' | 'mock';
  loading?: boolean;
  linkChannel?: number | null;
  onLinkChannelChange?: (ch: number | null) => void;
  stopperPx?: number;
  onStopperPxChange?: (px: number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

export default function ChartToolbar({
  symbol,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  chartType,
  onChartTypeChange,
  onIndicatorPanelToggle,
  onScriptEditorToggle,
  dataSource = 'mock',
  loading = false,
  linkChannel = null,
  onLinkChannelChange,
  stopperPx = 0,
  onStopperPxChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: ChartToolbarProps) {
  const [symbolInput, setSymbolInput] = useState(symbol);
  const [chartTypeOpen, setChartTypeOpen] = useState(false);
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const symbolContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setChartTypeOpen(false);
      }
      if (symbolContainerRef.current && !symbolContainerRef.current.contains(e.target as Node)) {
        setSymbolDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter suggestions
  const sq = symbolInput.toLowerCase();
  const symbolSuggestions = symbolInput && symbolInput !== symbol
    ? SEARCHABLE_SYMBOLS.filter(
        (s) =>
          s.symbol.toLowerCase().includes(sq) ||
          s.name.toLowerCase().includes(sq) ||
          s.sector.toLowerCase().includes(sq) ||
          s.industry.toLowerCase().includes(sq),
      ).slice(0, 8)
    : [];

  // Sync symbolInput when symbol changes externally (e.g. via link bus)
  useEffect(() => {
    setSymbolInput(symbol);
  }, [symbol]);

  // Reset highlight when input changes
  useEffect(() => {
    setHighlightIdx(-1);
  }, [symbolInput]);

  const commitSymbol = (sym: string) => {
    const trimmed = sym.trim().toUpperCase();
    if (trimmed) {
      setSymbolInput(trimmed);
      onSymbolChange(trimmed);
    }
    setSymbolDropdownOpen(false);
    setHighlightIdx(-1);
  };

  const handleSymbolSubmit = () => {
    const trimmed = symbolInput.trim().toUpperCase();
    if (trimmed && trimmed !== symbol) {
      onSymbolChange(trimmed);
    }
    setSymbolDropdownOpen(false);
    setHighlightIdx(-1);
  };

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
      {/* Symbol input with autocomplete */}
      <div className="relative flex items-center gap-1 mr-2" ref={symbolContainerRef}>
        <Search size={12} className="text-text-muted" />
        <input
          type="text"
          value={symbolInput}
          onChange={(e) => {
            setSymbolInput(e.target.value.toUpperCase());
            setSymbolDropdownOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && symbolDropdownOpen && symbolSuggestions.length > 0) {
              e.preventDefault();
              setHighlightIdx((prev) => Math.min(prev + 1, symbolSuggestions.length - 1));
            } else if (e.key === 'ArrowUp' && symbolDropdownOpen && symbolSuggestions.length > 0) {
              e.preventDefault();
              setHighlightIdx((prev) => Math.max(prev - 1, -1));
            } else if (e.key === 'Enter') {
              if (highlightIdx >= 0 && highlightIdx < symbolSuggestions.length) {
                commitSymbol(symbolSuggestions[highlightIdx].symbol);
              } else {
                handleSymbolSubmit();
              }
            } else if (e.key === 'Escape') {
              setSymbolDropdownOpen(false);
              setHighlightIdx(-1);
            }
          }}
          onFocus={() => {
            if (symbolInput && symbolInput !== symbol) setSymbolDropdownOpen(true);
          }}
          onBlur={() => {
            // Delay to allow click on suggestion
            setTimeout(() => {
              handleSymbolSubmit();
            }, 150);
          }}
          className="bg-transparent text-text-primary text-[11px] font-mono w-[72px] outline-none
                     border-b border-transparent focus:border-blue transition-colors duration-120"
          spellCheck={false}
        />
        {symbolDropdownOpen && symbolSuggestions.length > 0 && (
          <div className="absolute left-0 top-full z-[130] mt-1 w-[260px] rounded-md border border-white/[0.08] bg-[#1C2128] py-0.5 shadow-xl shadow-black/40">
            {symbolSuggestions.map((s, i) => (
              <button
                key={s.symbol}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitSymbol(s.symbol);
                }}
                onMouseEnter={() => setHighlightIdx(i)}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left transition-colors duration-75 ${
                  i === highlightIdx
                    ? 'bg-white/[0.08] text-white/90'
                    : 'hover:bg-white/[0.06]'
                }`}
              >
                <span className={`w-12 shrink-0 font-mono text-[10px] font-medium ${
                  i === highlightIdx ? 'text-white/90' : 'text-white/70'
                }`}>
                  {s.symbol}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`truncate text-[9px] ${
                    i === highlightIdx ? 'text-white/50' : 'text-white/30'
                  }`}>
                    {s.name}
                  </span>
                  {s.sector && (
                    <span className={`truncate text-[8px] ${
                      i === highlightIdx ? 'text-white/30' : 'text-white/15'
                    }`}>
                      {s.sector}{s.industry ? ` · ${s.industry}` : ''}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

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
                ? 'text-blue bg-blue/10'
                : 'text-text-muted hover:text-text-secondary hover:bg-hover'
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
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-secondary
                     hover:text-text-primary hover:bg-hover rounded-btn transition-colors duration-120"
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
      <button
        onClick={onIndicatorPanelToggle}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-secondary
                   hover:text-text-primary hover:bg-hover rounded-btn transition-colors duration-120 mx-1"
      >
        <Activity size={12} />
        <span>Indicators</span>
      </button>

      <div className="w-px h-4 bg-border-default" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1 mx-1">
        <button
          onClick={onZoomOut}
          className="p-1 text-text-secondary hover:text-text-primary hover:bg-hover rounded-btn transition-colors duration-120"
          title="Zoom out"
        >
          <ZoomOut size={12} />
        </button>
        <button
          onClick={onZoomIn}
          className="p-1 text-text-secondary hover:text-text-primary hover:bg-hover rounded-btn transition-colors duration-120"
          title="Zoom in"
        >
          <ZoomIn size={12} />
        </button>
        <button
          onClick={onZoomReset}
          className="p-1 text-text-secondary hover:text-text-primary hover:bg-hover rounded-btn transition-colors duration-120"
          title="Reset zoom"
        >
          <RotateCcw size={12} />
        </button>
      </div>

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
            : 'MOCK'}
        </span>
      </div>

      {dataSource === 'tws' && (
        <div className="flex items-center gap-1 mr-1">
          <span className="text-[9px] font-mono text-text-muted">Stop</span>
          <input
            type="number"
            min={0}
            max={200}
            value={stopperPx}
            onChange={(e) => {
              const next = Math.max(0, Math.min(200, Number(e.target.value) || 0));
              onStopperPxChange?.(next);
            }}
            className="w-[40px] bg-transparent text-[9px] font-mono text-text-secondary outline-none
                       border-b border-transparent focus:border-blue transition-colors duration-120"
          />
          <span className="text-[9px] font-mono text-text-muted">px</span>
        </div>
      )}
    </div>
  );
}

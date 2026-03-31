import { useState, useMemo, useRef, useEffect } from 'react';
import { indicatorRegistry } from '../indicators/registry';
import { STRATEGY_KEYS } from '../indicators/strategyKeys';
import type { ActiveIndicator } from '../types';
import { Search, X, Check, Plus, Pencil, Copy, Trash2, Code, ClipboardCopy } from 'lucide-react';
import type { CustomStrategyDefinition, StrategyState } from '../customStrategies';
import type { PersistedChartScript } from '../../lib/chart-state';

interface IndicatorPanelProps {
  open: boolean;
  onClose: () => void;
  onAddIndicator: (name: string) => void;
  onToggleIndicator?: (name: string) => void;
  activeIndicators?: ActiveIndicator[];
  mode?: 'indicator' | 'strategy';
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
}

const categories = [
  { key: 'overlay' as const, label: 'Overlays' },
  { key: 'oscillator' as const, label: 'Oscillators' },
  { key: 'volume' as const, label: 'Volume' },
];

const HIDDEN_INDICATOR_KEYS = new Set<string>();

const INDICATOR_DESCRIPTIONS: Record<string, string> = {
  SMA: 'Trend-following moving average',
  EMA: 'Faster-reacting moving average',
  'EMA Ribbon 5/20/200': 'Three-line EMA structure ribbon',
  'Bollinger Bands': 'Volatility bands around a moving average',
  VWAP: 'Average price weighted by volume',
  Ichimoku: 'Multi-component trend & momentum system',
  'Parabolic SAR': 'Trailing stop & reversal indicator',
  Envelope: 'Percentage bands around a moving average',
  'RSI Strategy': 'RSI/MA crossover BUY and SELL signals with optional divergence detection',
  'Golden/Death Cross': '50/200 SMA crossover with BUY and SELL markers',
  'EMA 9/14 Crossover': 'Fast/slow EMA crossover with BUY and SELL markers',
  'EMA 5/20 Crossover': 'ICT-style EMA crossover with BUY and SELL markers',
  'DailyIQ Tech Score Signal': 'BUY above 50 crossover, SELL below 50 crossover',
  'Market Sentiment Signal': 'BUY above 50 sentiment crossover, SELL below 50 crossover',
  'MACD Crossover': 'Buy/sell on MACD-signal line crossovers',
  'ADL Crossover': 'Buy/sell when ADL crosses above/below its SMA smoothing line',
  'Structure Breaks': 'Pivot break markers for bullish and bearish structure breaks',
  'Liquidity Sweep (ICT/SMC)': 'Combined DH/DL and prior-period liquidity lines with ICT/SMC sweep zones and labels',
  FVG: 'Standalone fair value gap rectangles with auto-clear when used',
  'FVG Momentum': 'Latest fair value gap boundaries with pullback/rejection markers',
  'Gap Zones': 'Highlights simple gap-up and gap-down price voids on the chart',
  RSI: 'Momentum oscillator (0–100)',
  MACD: 'Trend momentum via moving average crossover',
  Stochastic: 'Compares close to high-low range',
  'Stochastic RSI': 'Normalized stochastic of RSI',
  ATR: 'Measures market volatility',
  CCI: 'Identifies cyclical price trends',
  'Bull Bear Power': 'Bull/bear pressure normalized to sentiment scale',
  Supertrend: 'Trend state normalized to sentiment scale',
  'Chop Zone': 'Color-coded trend slope and market chop',
  'Linear Regression': 'Correlation-based trend score',
  'Market Structure': 'Pivot break structure score',
  'Williams %R': 'Overbought/oversold momentum',
  ROC: 'Speed of price change',
  MFI: 'Volume-weighted RSI',
  'Market Sentiment': 'Composite sentiment from oscillator and trend components',
  'Trend Angle': 'EMA/ATR-based trend angle in degrees',
  'Technical Score': 'DailyIQ technical score plotted through time',
  Volume: 'Raw traded volume histogram',
  ADL: 'Cumulative volume-weighted supply/demand pressure with SMA smoothing',
  OBV: 'Cumulative volume flow',
  'Volume Profile': 'Volume distribution by price level',
};

export default function IndicatorPanel({
  open,
  onClose,
  onAddIndicator,
  onToggleIndicator,
  activeIndicators = [],
  mode = 'indicator',
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
}: IndicatorPanelProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeNames = useMemo(
    () => new Set(activeIndicators.map(ind => ind.name)),
    [activeIndicators],
  );
  const activeCustomNames = useMemo(
    () => new Set(activeCustomStrategyIds),
    [activeCustomStrategyIds],
  );

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onClose]);

  const indicators = useMemo(
    () => Object.entries(indicatorRegistry)
      .filter(([key]) => !HIDDEN_INDICATOR_KEYS.has(key))
      .map(([key, meta]) => ({ key, ...meta })),
    [],
  );

  const filtered = useMemo(() => {
    const base = indicators.filter((ind) =>
      mode === 'strategy' ? STRATEGY_KEYS.has(ind.key) : !STRATEGY_KEYS.has(ind.key),
    );
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(
      (ind) =>
        ind.name.toLowerCase().includes(q) ||
        ind.shortName.toLowerCase().includes(q),
    );
  }, [search, indicators, mode]);
  const filteredCustomStrategies = useMemo(() => {
    if (mode !== 'strategy') return [];
    if (!search.trim()) return customStrategies;
    const q = search.toLowerCase();
    return customStrategies.filter((strategy) => strategy.name.toLowerCase().includes(q));
  }, [customStrategies, mode, search]);

  const filteredSavedScripts = useMemo(() => {
    if (mode !== 'strategy') return [];
    const named = savedScripts.filter((s) => s.name);
    if (!search.trim()) return named;
    const q = search.toLowerCase();
    return named.filter((s) => s.name!.toLowerCase().includes(q));
  }, [savedScripts, mode, search]);

  const [promptCopied, setPromptCopied] = useState(false);
  const handleCopyMasterPrompt = () => {
    onCopyMasterPrompt?.();
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  const renderBuiltInStrategyRow = (ind: typeof filtered[number]) => {
    const isActive = activeNames.has(ind.key);
    return (
      <button
        key={ind.key}
        onClick={() => (onToggleIndicator ?? onAddIndicator)(ind.key)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '6px 12px',
          fontSize: 11,
          color: isActive ? '#8B949E' : '#E6EDF3',
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          transition: 'background-color 120ms ease-out',
          fontFamily: "'Geist Sans', Inter, system-ui, sans-serif",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#1C2128';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{ind.name}</span>
            {isActive && (
              <Check size={11} color="#00C853" style={{ flexShrink: 0 }} />
            )}
          </div>
          {INDICATOR_DESCRIPTIONS[ind.key] && (
            <span
              style={{
                fontSize: 9,
                color: '#484F58',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {INDICATOR_DESCRIPTIONS[ind.key]}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 9,
            color: '#484F58',
            fontFamily: "'JetBrains Mono', monospace",
            flexShrink: 0,
          }}
        >
          {ind.shortName}
        </span>
      </button>
    );
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 4,
        zIndex: 50,
        width: 320,
        backgroundColor: '#161B22',
        border: '1px solid #21262D',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}
    >
      {/* Search */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid #21262D',
        }}
      >
        <Search size={13} color="#484F58" style={{ flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={mode === 'strategy' ? 'Search strategies...' : 'Search indicators...'}
          spellCheck={false}
          style={{
            flex: 1,
            backgroundColor: 'transparent',
            fontSize: 12,
            color: '#E6EDF3',
            outline: 'none',
            border: 'none',
            fontFamily: "'Geist Sans', Inter, system-ui, sans-serif",
          }}
        />
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#484F58',
            padding: 2,
            display: 'flex',
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Categories */}
      <div
        className="scrollbar-panel"
        style={{
          maxHeight: 380,
          overflowY: 'auto',
        }}
      >
        {mode === 'strategy' ? (
          <>
            {/* Copy Master Prompt */}
            <div
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid #21262D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 9, color: '#6E7681', fontFamily: "'JetBrains Mono', monospace" }}>
                Use an LLM to generate indicators
              </span>
              <button
                onClick={handleCopyMasterPrompt}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: promptCopied ? 'rgba(0,200,83,0.12)' : 'transparent',
                  border: `1px solid ${promptCopied ? '#00C853' : '#30363D'}`,
                  color: promptCopied ? '#00C853' : '#C9D1D9',
                  borderRadius: 4,
                  fontSize: 9,
                  padding: '2px 7px',
                  cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: 'all 120ms ease-out',
                }}
              >
                <ClipboardCopy size={10} />
                {promptCopied ? 'Copied!' : 'Copy Master Prompt'}
              </button>
            </div>

            {/* Built-in strategies */}
            <div
              style={{
                padding: '8px 12px 6px',
                borderBottom: '1px solid #21262D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 9, color: '#8B949E', fontFamily: "'JetBrains Mono', monospace" }}>Built-In</span>
            </div>
            {filtered.map(renderBuiltInStrategyRow)}

            {/* Custom (builder) strategies */}
            <div
              style={{
                padding: '8px 12px 6px',
                borderTop: '1px solid #21262D',
                borderBottom: '1px solid #21262D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 9, color: '#8B949E', fontFamily: "'JetBrains Mono', monospace" }}>Custom</span>
              <button
                onClick={onCreateCustomStrategy}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'transparent',
                  border: '1px solid #30363D',
                  color: '#C9D1D9',
                  borderRadius: 4,
                  fontSize: 9,
                  padding: '2px 6px',
                  cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                <Plus size={10} />
                New
              </button>
            </div>
            {filteredCustomStrategies.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 10, color: '#6E7681', fontFamily: "'JetBrains Mono', monospace" }}>
                No custom strategies yet.
              </div>
            ) : filteredCustomStrategies.map((strategy) => {
              const isActive = activeCustomNames.has(strategy.id);
              const summary = customStrategySummaryById[strategy.id];
              const scoreText = typeof summary?.score === 'number' ? `${summary.score}` : 'n/a';
              const stateColor = summary?.state === 'BUY'
                ? '#38BDF8'
                : summary?.state === 'SELL'
                  ? '#FB923C'
                  : '#8B949E';
              return (
                <div
                  key={strategy.id}
                  style={{
                    padding: '7px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <button
                    onClick={() => onToggleCustomStrategy?.(strategy.id)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: isActive ? '#E6EDF3' : '#C9D1D9',
                      padding: 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11 }}>{strategy.name}</span>
                      {isActive && <Check size={11} color="#00C853" />}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
                      <span style={{ color: '#6E7681' }}>Score {scoreText}</span>
                      <span style={{ color: stateColor }}>{summary?.state ?? 'NEUTRAL'}</span>
                    </div>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => onEditCustomStrategy?.(strategy.id)}
                      style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer', display: 'flex' }}
                      title="Edit strategy"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => onDuplicateCustomStrategy?.(strategy.id)}
                      style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer', display: 'flex' }}
                      title="Duplicate strategy"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      onClick={() => onDeleteCustomStrategy?.(strategy.id)}
                      style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer', display: 'flex' }}
                      title="Delete strategy"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Saved Scripts (code-based) */}
            <div
              style={{
                padding: '8px 12px 6px',
                borderTop: '1px solid #21262D',
                borderBottom: '1px solid #21262D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 9, color: '#8B949E', fontFamily: "'JetBrains Mono', monospace" }}>Saved Scripts</span>
              <button
                onClick={onCreateCodeStrategy}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'transparent',
                  border: '1px solid #30363D',
                  color: '#C9D1D9',
                  borderRadius: 4,
                  fontSize: 9,
                  padding: '2px 6px',
                  cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                <Code size={10} />
                New Script
              </button>
            </div>
            {filteredSavedScripts.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 10, color: '#6E7681', fontFamily: "'JetBrains Mono', monospace" }}>
                No saved scripts yet. Click "New Script" or use an LLM with the master prompt.
              </div>
            ) : filteredSavedScripts.map((script) => {
              const isActive = activeScriptIds.includes(script.id);
              return (
                <div
                  key={script.id}
                  style={{
                    padding: '7px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <button
                    onClick={() => onToggleScript?.(script.id)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: isActive ? '#E6EDF3' : '#C9D1D9',
                      padding: 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Code size={10} color="#8B5CF6" style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 11 }}>{script.name}</span>
                      {isActive && <Check size={11} color="#00C853" />}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 9, color: '#484F58', fontFamily: "'JetBrains Mono', monospace" }}>
                      Script
                    </div>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => onEditScript?.(script.id)}
                      style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer', display: 'flex' }}
                      title="Edit script"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => onDeleteScript?.(script.id)}
                      style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer', display: 'flex' }}
                      title="Delete script"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        ) : categories.map((cat) => {
          const items = filtered.filter((ind) => ind.category === cat.key);
          if (items.length === 0) return null;
          return (
            <div key={cat.key}>
              <div
                style={{
                  padding: '8px 12px 4px',
                  fontSize: 9,
                  color: '#484F58',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {cat.label}
              </div>
              {items.map((ind) => {
                const isActive = activeNames.has(ind.key);
                return (
                  <button
                    key={ind.key}
                    onClick={() => onAddIndicator(ind.key)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 12px',
                      fontSize: 11,
                      color: isActive ? '#8B949E' : '#E6EDF3',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      transition: 'background-color 120ms ease-out',
                      fontFamily: "'Geist Sans', Inter, system-ui, sans-serif",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#1C2128';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{ind.name}</span>
                        {isActive && (
                          <Check size={11} color="#00C853" style={{ flexShrink: 0 }} />
                        )}
                      </div>
                      {INDICATOR_DESCRIPTIONS[ind.key] && (
                        <span
                          style={{
                            fontSize: 9,
                            color: '#484F58',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {INDICATOR_DESCRIPTIONS[ind.key]}
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        color: '#484F58',
                        fontFamily: "'JetBrains Mono', monospace",
                        flexShrink: 0,
                      }}
                    >
                      {ind.shortName}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div
            style={{
              padding: '16px 12px',
              fontSize: 11,
              color: '#484F58',
              textAlign: 'center',
            }}
          >
            No indicators found
          </div>
        )}
      </div>
    </div>
  );
}

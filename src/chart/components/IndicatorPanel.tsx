import { useState, useMemo, useRef, useEffect } from 'react';
import { indicatorRegistry } from '../indicators/registry';
import type { ActiveIndicator } from '../types';
import { Search, X, Check } from 'lucide-react';

interface IndicatorPanelProps {
  open: boolean;
  onClose: () => void;
  onAddIndicator: (name: string) => void;
  onToggleIndicator?: (name: string) => void;
  activeIndicators?: ActiveIndicator[];
  mode?: 'indicator' | 'strategy';
}

const STRATEGY_KEYS = new Set([
  'Golden/Death Cross',
  'EMA 9/14 Crossover',
  'EMA 5/20 Crossover',
  'DailyIQ Tech Score Signal',
  'Market Sentiment Signal',
  'Liquidity Sweep Signal',
]);

const categories = [
  { key: 'overlay' as const, label: 'Overlays' },
  { key: 'oscillator' as const, label: 'Oscillators' },
  { key: 'volume' as const, label: 'Volume' },
];

const INDICATOR_DESCRIPTIONS: Record<string, string> = {
  SMA: 'Trend-following moving average',
  EMA: 'Faster-reacting moving average',
  'EMA Ribbon 5/20/200': 'Three-line EMA structure ribbon',
  'Bollinger Bands': 'Volatility bands around a moving average',
  VWAP: 'Average price weighted by volume',
  Ichimoku: 'Multi-component trend & momentum system',
  'Parabolic SAR': 'Trailing stop & reversal indicator',
  Envelope: 'Percentage bands around a moving average',
  'Golden/Death Cross': '50/200 SMA crossover with BUY and SELL markers',
  'EMA 9/14 Crossover': 'Fast/slow EMA crossover with BUY and SELL markers',
  'EMA 5/20 Crossover': 'ICT-style EMA crossover with BUY and SELL markers',
  'DailyIQ Tech Score Signal': 'BUY above 50 crossover, SELL below 50 crossover',
  'Market Sentiment Signal': 'BUY above 50 sentiment crossover, SELL below 50 crossover',
  'Structure Breaks': 'Pivot break markers for bullish and bearish structure breaks',
  'Liquidity Levels': 'Today, previous day, week, and month liquidity lines',
  'Liquidity Sweep Signal': 'Buy/sell markers when liquidity levels are swept and reclaimed/rejected',
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
  'Linear Regression': 'Correlation-based trend score',
  'Market Structure': 'Pivot break structure score',
  'Williams %R': 'Overbought/oversold momentum',
  ROC: 'Speed of price change',
  MFI: 'Volume-weighted RSI',
  'Market Sentiment': 'Composite sentiment from oscillator and trend components',
  'Trend Angle': 'EMA/ATR-based trend angle in degrees',
  'Technical Score': 'DailyIQ technical score plotted through time',
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
}: IndicatorPanelProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeNames = useMemo(
    () => new Set(activeIndicators.map(ind => ind.name)),
    [activeIndicators],
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
    () => Object.entries(indicatorRegistry).map(([key, meta]) => ({ key, ...meta })),
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

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
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
        className="scrollbar-dark"
        style={{
          maxHeight: 380,
          overflowY: 'auto',
        }}
      >
        {mode === 'strategy' ? (
          filtered.map((ind) => {
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
          })
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

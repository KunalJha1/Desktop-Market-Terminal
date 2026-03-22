import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { ChartEngine } from '../core/ChartEngine';
import { useChartData } from '../hooks/useChartData';
import { indicatorRegistry } from '../indicators/registry';
import type { Timeframe, ChartType, ActiveIndicator, YScaleMode } from '../types';
import { useTws } from '../../lib/tws';
import { X, ChevronDown, Search, TrendingUp, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import IndicatorLegend from './IndicatorLegend';

interface MiniChartProps {
  config: Record<string, unknown>;
  onConfigChange: (cfg: Record<string, unknown>) => void;
  linkChannel: number | null;
  onSetLinkChannel: (ch: number | null) => void;
  onClose: () => void;
}

const MINI_TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1H', value: '1H' },
  { label: '1D', value: '1D' },
];

const CHART_TYPES: { label: string; short: string; value: ChartType }[] = [
  { label: 'Candlestick', short: 'Candle', value: 'candlestick' },
  { label: 'Heikin-Ashi', short: 'HA', value: 'heikin-ashi' },
  { label: 'Vol Weighted', short: 'VW', value: 'volume-weighted' },
  { label: 'OHLC Bar', short: 'Bar', value: 'bar' },
  { label: 'Line', short: 'Line', value: 'line' },
  { label: 'Area', short: 'Area', value: 'area' },
];

const LINK_CHANNEL_COLORS: Record<number, string> = {
  1: '#1A56DB',
  2: '#00C853',
  3: '#F59E0B',
  4: '#FF3D71',
  5: '#8B5CF6',
};

const INDICATOR_CATEGORIES = [
  { key: 'overlay' as const, label: 'Overlays' },
  { key: 'oscillator' as const, label: 'Oscillators' },
  { key: 'volume' as const, label: 'Volume' },
];

export default function MiniChart({
  config,
  onConfigChange,
  linkChannel,
  onSetLinkChannel,
  onClose,
}: MiniChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);

  const symbol = (config.symbol as string) || 'AAPL';
  const timeframe = (config.timeframe as Timeframe) || '5m';
  const chartType = (config.chartType as ChartType) || 'candlestick';
  const yScaleMode = (config.yScaleMode as YScaleMode) || 'auto';

  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const [showChartTypeMenu, setShowChartTypeMenu] = useState(false);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState('');
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([]);

  const chartTypeMenuRef = useRef<HTMLDivElement>(null);
  const indicatorMenuRef = useRef<HTMLDivElement>(null);
  const indicatorSearchRef = useRef<HTMLInputElement>(null);

  // Pull real data from the sidecar (same path as ChartPage)
  const { sidecarPort } = useTws();
  const { bars, source } = useChartData({
    symbol,
    timeframe,
    sidecarPort,
  });
  const stopperPx = (config.stopperPx as number) ?? 80;

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
    const { width, height } = container.getBoundingClientRect();
    engine.resize(Math.floor(width), Math.floor(height));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    handleResize();
    return () => ro.disconnect();
  }, [handleResize]);

  // Push data to engine
  useEffect(() => {
    engineRef.current?.setData(bars);
  }, [bars]);

  // Push chart type to engine
  useEffect(() => {
    engineRef.current?.setChartType(chartType);
  }, [chartType]);

  // Push timeframe to engine
  useEffect(() => {
    engineRef.current?.setTimeframe(timeframe);
  }, [timeframe]);

  // Push Y-scale mode to engine
  useEffect(() => {
    engineRef.current?.setYScaleMode(yScaleMode);
  }, [yScaleMode]);

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

  // Sync active indicators from engine
  const syncIndicators = useCallback(() => {
    const engine = engineRef.current;
    if (engine) setActiveIndicators([...engine.getActiveIndicators()]);
  }, []);

  const setTimeframeValue = (tf: Timeframe) => {
    onConfigChange({ ...config, timeframe: tf });
  };

  const setChartTypeValue = (ct: ChartType) => {
    onConfigChange({ ...config, chartType: ct });
    setShowChartTypeMenu(false);
  };

  const setYScaleModeValue = (mode: YScaleMode) => {
    onConfigChange({ ...config, yScaleMode: mode });
  };

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

  const updateIndicatorColor = (id: string, outputKey: string, color: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateIndicatorColor(id, outputKey, color);
    syncIndicators();
  };

  const toggleIndicatorVisibility = (id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.toggleVisibility(id);
    syncIndicators();
  };

  const toggleLinkMenu = () => setShowLinkMenu((v) => !v);
  const selectLinkChannel = (ch: number | null) => {
    onSetLinkChannel(ch);
    setShowLinkMenu(false);
  };

  // Filtered indicators for search
  const allIndicators = useMemo(
    () => Object.entries(indicatorRegistry).map(([key, meta]) => ({ key, ...meta })),
    [],
  );
  const filteredIndicators = useMemo(() => {
    if (!indicatorSearch.trim()) return allIndicators;
    const q = indicatorSearch.toLowerCase();
    return allIndicators.filter(
      (ind) => ind.name.toLowerCase().includes(q) || ind.shortName.toLowerCase().includes(q),
    );
  }, [indicatorSearch, allIndicators]);

  const currentChartType = CHART_TYPES.find((ct) => ct.value === chartType);
  const emptyScripts = useMemo(() => new Map(), []);
  const indicatorColorDefaults =
    (config.indicatorColorDefaults as Record<string, Record<string, string>> | undefined) ?? {};

  return (
    <div
      className="flex flex-col h-full w-full overflow-hidden"
      style={{
        backgroundColor: '#0D1117',
        border: '1px solid #21262D',
        borderRadius: 0,
        minWidth: 240,
        minHeight: 200,
      }}
    >
      {/* Toolbar row 1: symbol, timeframes, chart type, indicators, close */}
      <div
        className="flex items-center justify-between shrink-0 select-none"
        style={{
          height: 28,
          padding: '0 4px',
          borderBottom: '1px solid #21262D',
          backgroundColor: '#161B22',
        }}
      >
        {/* Left: link + symbol + price */}
        <div className="flex items-center gap-1 overflow-hidden" style={{ minWidth: 0 }}>
          {/* Link channel indicator */}
          <button
            onClick={toggleLinkMenu}
            className="relative shrink-0 flex items-center justify-center"
            style={{
              width: 14,
              height: 14,
              borderRadius: 2,
              backgroundColor: linkChannel !== null
                ? (LINK_CHANNEL_COLORS[linkChannel] || '#484F58')
                : '#484F58',
              opacity: linkChannel !== null ? 1 : 0.4,
              cursor: 'pointer',
              border: 'none',
              padding: 0,
            }}
            title={linkChannel !== null ? `Link channel ${linkChannel}` : 'Not linked'}
          >
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 8,
                color: '#E6EDF3',
                lineHeight: 1,
              }}
            >
              {linkChannel ?? '—'}
            </span>
          </button>

          {/* Link channel dropdown */}
          {showLinkMenu && (
            <div
              className="absolute z-50"
              style={{
                top: 28,
                left: 4,
                backgroundColor: '#161B22',
                border: '1px solid #21262D',
                borderRadius: 4,
                padding: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <button
                onClick={() => selectLinkChannel(null)}
                className="flex items-center gap-1 px-2 py-0.5 hover:bg-[#1C2128] text-left"
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 9,
                  color: '#8B949E',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              >
                None
              </button>
              {[1, 2, 3, 4, 5].map((ch) => (
                <button
                  key={ch}
                  onClick={() => selectLinkChannel(ch)}
                  className="flex items-center gap-1 px-2 py-0.5 hover:bg-[#1C2128] text-left"
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 9,
                    color: LINK_CHANNEL_COLORS[ch],
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    borderRadius: 2,
                  }}
                >
                  Ch {ch}
                </button>
              ))}
            </div>
          )}

          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10,
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
              fontSize: 10,
              color: '#E6EDF3',
              whiteSpace: 'nowrap',
            }}
          >
            {lastPrice.toFixed(2)}
          </span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 9,
              color: isPositive ? '#00C853' : '#FF3D71',
              whiteSpace: 'nowrap',
            }}
          >
            {isPositive ? '+' : ''}{pctChange.toFixed(2)}%
          </span>
        </div>

        {/* Right: timeframes + chart type + indicators + close */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Timeframe buttons */}
          {MINI_TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframeValue(tf.value)}
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 9,
                padding: '1px 3px',
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: timeframe === tf.value ? '#1A56DB' : 'transparent',
                color: timeframe === tf.value ? '#E6EDF3' : '#8B949E',
                lineHeight: 1,
              }}
            >
              {tf.label}
            </button>
          ))}

          {/* Separator */}
          <div style={{ width: 1, height: 12, backgroundColor: '#21262D', margin: '0 2px' }} />

          {/* Chart type dropdown */}
          <div className="relative" ref={chartTypeMenuRef}>
            <button
              onClick={() => { setShowChartTypeMenu((v) => !v); setShowIndicatorMenu(false); }}
              className="flex items-center gap-0.5 hover:bg-[#1C2128]"
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 9,
                padding: '1px 3px',
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: showChartTypeMenu ? '#1C2128' : 'transparent',
                color: '#8B949E',
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
              onClick={() => { setShowIndicatorMenu((v) => !v); setShowChartTypeMenu(false); setIndicatorSearch(''); }}
              className="flex items-center gap-0.5 hover:bg-[#1C2128]"
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 9,
                padding: '1px 3px',
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: showIndicatorMenu ? '#1C2128' : 'transparent',
                color: activeIndicators.length > 0 ? '#1A56DB' : '#8B949E',
                lineHeight: 1,
              }}
              title="Indicators"
            >
              <TrendingUp size={10} />
              {activeIndicators.length > 0 && (
                <span style={{ fontSize: 8, color: '#1A56DB' }}>{activeIndicators.length}</span>
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
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {INDICATOR_CATEGORIES.map((cat) => {
                    const items = filteredIndicators.filter((ind) => ind.category === cat.key);
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
                          return (
                            <button
                              key={ind.key}
                              onClick={() => addIndicator(ind.key)}
                              className="flex items-center justify-between w-full px-2 py-1 hover:bg-[#1C2128] text-left"
                              style={{
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: 10,
                                color: isActive ? '#E6EDF3' : '#8B949E',
                                border: 'none',
                                background: 'none',
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
                  {filteredIndicators.length === 0 && (
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
              </div>
            )}
          </div>

          {/* Zoom controls */}
          <button
            onClick={() => engineRef.current?.zoomOut()}
            className="flex items-center justify-center hover:bg-[#1C2128]"
            style={{
              width: 16,
              height: 16,
              borderRadius: 2,
              border: 'none',
              background: 'transparent',
              color: '#8B949E',
              cursor: 'pointer',
            }}
            title="Zoom out"
          >
            <ZoomOut size={10} />
          </button>
          <button
            onClick={() => engineRef.current?.zoomIn()}
            className="flex items-center justify-center hover:bg-[#1C2128]"
            style={{
              width: 16,
              height: 16,
              borderRadius: 2,
              border: 'none',
              background: 'transparent',
              color: '#8B949E',
              cursor: 'pointer',
            }}
            title="Zoom in"
          >
            <ZoomIn size={10} />
          </button>
          <button
            onClick={() => engineRef.current?.resetZoom()}
            className="flex items-center justify-center hover:bg-[#1C2128]"
            style={{
              width: 16,
              height: 16,
              borderRadius: 2,
              border: 'none',
              background: 'transparent',
              color: '#8B949E',
              cursor: 'pointer',
            }}
            title="Reset zoom"
          >
            <RotateCcw size={10} />
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
                  onConfigChange({ ...config, stopperPx: next });
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

          {/* Separator */}
          <div style={{ width: 1, height: 12, backgroundColor: '#21262D', margin: '0 1px' }} />

          {/* Close */}
          <button
            onClick={onClose}
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
              color: '#484F58',
              borderRadius: 2,
            }}
            className="hover:bg-[#1C2128] hover:text-[#E6EDF3]"
            title="Close"
          >
            <X size={10} />
          </button>
        </div>
      </div>

      {/* Active indicator pills — only shown when indicators are active */}
      {activeIndicators.length > 0 && (
        <div
          className="flex items-center gap-1 shrink-0 overflow-x-auto"
          style={{
            height: 20,
            padding: '0 4px',
            borderBottom: '1px solid #21262D',
            backgroundColor: '#0D1117',
          }}
        >
          {activeIndicators.map((ind) => {
            const meta = indicatorRegistry[ind.name];
            const color = meta?.outputs[0]?.color ?? '#8B949E';
            return (
              <div
                key={ind.id}
                className="flex items-center gap-0.5 shrink-0"
                style={{
                  padding: '1px 4px',
                  borderRadius: 2,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    backgroundColor: color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 8,
                    color: '#8B949E',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {meta?.shortName ?? ind.name}
                  {Object.keys(ind.params).length > 0 && (
                    <span style={{ color: '#484F58' }}>
                      ({Object.values(ind.params).join(',')})
                    </span>
                  )}
                </span>
                <button
                  onClick={() => removeIndicator(ind.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 10,
                    height: 10,
                    padding: 0,
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: 'transparent',
                    color: '#484F58',
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                  className="hover:text-[#FF3D71]"
                  title={`Remove ${meta?.shortName ?? ind.name}`}
                >
                  <X size={7} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Chart canvas area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ cursor: 'crosshair' }}
        />
        <div
          style={{
            position: 'absolute',
            right: 6,
            bottom: source === 'tws' ? 24 : 4,
            display: 'flex',
            gap: 4,
            padding: '1px 3px',
            backgroundColor: 'rgba(13,17,23,0.7)',
            border: '1px solid rgba(33,38,45,0.7)',
            borderRadius: 3,
            backdropFilter: 'blur(2px)',
          }}
        >
          <button
            onClick={() => setYScaleModeValue('auto')}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 8,
              padding: '1px 3px',
              borderRadius: 2,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: yScaleMode === 'auto' ? '#1A56DB' : 'transparent',
              color: yScaleMode === 'auto' ? '#E6EDF3' : '#8B949E',
              lineHeight: 1,
            }}
            title="Auto scale"
          >
            A
          </button>
          <button
            onClick={() => setYScaleModeValue('log')}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 8,
              padding: '1px 3px',
              borderRadius: 2,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: yScaleMode === 'log' ? '#1A56DB' : 'transparent',
              color: yScaleMode === 'log' ? '#E6EDF3' : '#8B949E',
              lineHeight: 1,
            }}
            title="Log scale"
          >
            L
          </button>
        </div>
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
                onConfigChange({ ...config, stopperPx: Number(e.target.value) });
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
          onUpdateColor={updateIndicatorColor}
          onRemove={removeIndicator}
          onToggleVisibility={toggleIndicatorVisibility}
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

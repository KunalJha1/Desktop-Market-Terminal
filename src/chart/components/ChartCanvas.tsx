import { useRef, useEffect, useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ChartEngine } from '../core/ChartEngine';
import type {
  OHLCVBar,
  ChartType,
  Timeframe,
  ScriptResult,
  ChartBrandingMode,
  ChartLayout,
  DrawingTool,
  DrawingAnchor,
  DrawingSelection,
  YScaleMode,
} from '../types';
import { PRICE_AXIS_CONTROL_HEIGHT, PRICE_AXIS_WIDTH } from '../constants';
import { Brush, Crosshair, Lock, LockOpen, RotateCcw, Trash2, Type, ZoomIn, ZoomOut, Check, ChevronUp, ChevronDown, Minus, Maximize2, ChevronsUpDown } from 'lucide-react';

const DRAWING_COLOR_PALETTE = [
  '#60A5FA',
  '#00C853',
  '#FF3D71',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#22D3EE',
  '#FFFFFF',
];

interface DrawingContextMenu {
  drawingId: string;
  color: string;
  x: number;
  y: number;
}

interface ChartCanvasProps {
  bars: OHLCVBar[];
  datasetKey: string;
  symbol?: string;
  chartType: ChartType;
  timeframe: Timeframe;
  engineRef: React.MutableRefObject<ChartEngine | null>;
  activeScripts?: Map<string, ScriptResult>;
  liveMode?: boolean;
  stopperPx?: number;
  onStopperPxChange?: (px: number) => void;
  brandingMode?: ChartBrandingMode;
  onViewportChange?: (startIdx: number, endIdx: number) => void;
  onLayoutChange?: (layout: ChartLayout) => void;
  onEngineReady?: () => void;
  yScaleMode?: YScaleMode;
  onYScaleModeChange?: (mode: YScaleMode) => void;
  pendingViewportShift?: number;
  onViewportShiftApplied?: () => void;
  updateMode?: 'full' | 'tail';
  tailChangeOffset?: number;
  children?: React.ReactNode;
}

export default function ChartCanvas({
  bars,
  datasetKey,
  symbol,
  chartType,
  timeframe,
  engineRef,
  activeScripts,
  liveMode = false,
  stopperPx = 0,
  onStopperPxChange: _onStopperPxChange,
  brandingMode = 'none',
  onViewportChange,
  onLayoutChange,
  onEngineReady,
  yScaleMode = 'auto',
  onYScaleModeChange,
  pendingViewportShift = 0,
  onViewportShiftApplied,
  updateMode = 'full',
  tailChangeOffset = 0,
  children,
}: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const lastDatasetKeyRef = useRef<string | null>(null);
  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [yAxisHovered, setYAxisHovered] = useState(false);
  const [xAxisHovered, setXAxisHovered] = useState(false);
  const [drawingHovered, setDrawingHovered] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<DrawingSelection | null>(null);
  const [pendingTextAnchor, setPendingTextAnchor] = useState<DrawingAnchor | null>(null);
  const [pendingTextValue, setPendingTextValue] = useState('');
  const [ctxMenu, setCtxMenu] = useState<DrawingContextMenu | null>(null);
  const [priceSectionHeight, setPriceSectionHeight] = useState(0);
  const [paneLayout, setPaneLayout] = useState<Array<{ paneId: string; top: number; height: number; yScaleMode: YScaleMode; showScaleControls: boolean; collapsed: boolean; maximized: boolean }>>([]);

  const notifyLayout = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const layout = engine.getLayout();
    setPriceSectionHeight(layout.mainHeight);
    setPaneLayout(layout.subPanes.map(p => ({ paneId: p.paneId, top: p.top, height: p.height, yScaleMode: p.yScaleMode, showScaleControls: p.showScaleControls, collapsed: p.collapsed, maximized: p.maximized })));
    onLayoutChange?.(layout);
  }, [engineRef, onLayoutChange]);

  // Initialize engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new ChartEngine(canvas);
    engineRef.current = engine;
    engine.setDrawingTool('none');
    onEngineReady?.();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [engineRef, onEngineReady]);

  // ResizeObserver
  const handleResize = useCallback(() => {
    const container = containerRef.current;
    const engine = engineRef.current;
    if (!container || !engine) return;

    const width = container.offsetWidth;
    const height = container.offsetHeight;
    engine.resize(width, height);
    notifyLayout();
  }, [engineRef, notifyLayout]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    handleResize();

    return () => ro.disconnect();
  }, [handleResize]);

  // Update data — use incremental path for poll-driven tail updates
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const datasetChanged = lastDatasetKeyRef.current !== datasetKey;
    lastDatasetKeyRef.current = datasetKey;
    if (!datasetChanged && updateMode === 'tail' && bars.length > 0) {
      engine.updateTail(bars, tailChangeOffset);
    } else {
      engine.setData(bars);
    }
    notifyLayout();
  }, [bars, datasetKey, updateMode, tailChangeOffset, engineRef, onLayoutChange, notifyLayout]);

  useEffect(() => {
    if (!pendingViewportShift) return;
    const engine = engineRef.current;
    if (!engine) return;
    engine.shiftViewportBy(pendingViewportShift);
    notifyLayout();
    onViewportShiftApplied?.();
  }, [pendingViewportShift, engineRef, onLayoutChange, onViewportShiftApplied]);

  // Update chart type
  useEffect(() => {
    engineRef.current?.setChartType(chartType);
  }, [chartType, engineRef]);

  // Update timeframe
  useEffect(() => {
    engineRef.current?.resetViewport();
    engineRef.current?.setTimeframe(timeframe);
  }, [timeframe, engineRef]);

  useEffect(() => {
    if (lastDatasetKeyRef.current === null) {
      lastDatasetKeyRef.current = datasetKey;
      return;
    }
    engineRef.current?.resetViewport();
    onViewportShiftApplied?.();
  }, [datasetKey, engineRef, onViewportShiftApplied]);

  useEffect(() => {
    engineRef.current?.setBrandingMode(brandingMode);
  }, [brandingMode, engineRef]);

  useEffect(() => {
    engineRef.current?.setBrandingSymbol(symbol ?? '');
    engineRef.current?.resetViewport();
  }, [symbol, engineRef]);

  // Wire viewport change callback
  useEffect(() => {
    engineRef.current?.setOnViewportChange(onViewportChange ?? null);
  }, [onViewportChange, engineRef]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setOnTextPlacementRequest((anchor) => {
      setPendingTextAnchor(anchor);
      setPendingTextValue('');
    });
    engine.setOnDrawingSelectionChange(setSelectedDrawing);
    engine.setOnDrawingContextMenu((info) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      setCtxMenu({
        drawingId: info.drawingId,
        color: info.color,
        x: Math.min(info.screenX - containerRect.left, containerRect.width - 160),
        y: Math.min(info.screenY - containerRect.top, containerRect.height - 140),
      });
    });
    engine.setOnDrawingHoverChange((hoveredId) => {
      setDrawingHovered(!!hoveredId);
    });
    return () => {
      engine.setOnTextPlacementRequest(null);
      engine.setOnDrawingSelectionChange(null);
      engine.setOnDrawingContextMenu(null);
      engine.setOnDrawingHoverChange(null);
    };
  }, [engineRef]);

  // Update live mode / stopper
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setLiveMode(liveMode);
    engine.setStopperPx(stopperPx);
    notifyLayout();
  }, [liveMode, stopperPx, engineRef, onLayoutChange]);

  // Update script results (multi-script)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.clearAllScripts();
    if (activeScripts) {
      for (const [id, result] of activeScripts) {
        engine.setScriptResult(id, result);
      }
    }
    notifyLayout();
  }, [activeScripts, engineRef, onLayoutChange]);

  const handleSelectTool = useCallback((tool: DrawingTool) => {
    const nextTool = activeTool === tool ? 'none' : tool;
    setPendingTextAnchor(null);
    setPendingTextValue('');
    setActiveTool(nextTool);
    engineRef.current?.setDrawingTool(nextTool);
  }, [activeTool, engineRef]);

  const handleClearDrawings = useCallback(() => {
    engineRef.current?.clearDrawings();
    setActiveTool('none');
    engineRef.current?.setDrawingTool('none');
    setPendingTextAnchor(null);
    setPendingTextValue('');
  }, [engineRef]);

  const handleZoomIn = useCallback(() => {
    engineRef.current?.zoomIn();
  }, [engineRef]);

  const handleZoomOut = useCallback(() => {
    engineRef.current?.zoomOut();
  }, [engineRef]);

  const handleZoomReset = useCallback(() => {
    engineRef.current?.resetZoom();
  }, [engineRef]);

  const handleToggleSelectedLock = useCallback(() => {
    if (!selectedDrawing) return;
    engineRef.current?.setDrawingLocked(selectedDrawing.id, !selectedDrawing.locked);
  }, [engineRef, selectedDrawing]);

  const handleCommitText = useCallback(() => {
    if (!pendingTextAnchor) return;
    const value = pendingTextValue.trim();
    if (!value) {
      setPendingTextAnchor(null);
      setPendingTextValue('');
      return;
    }
    engineRef.current?.addTextDrawing(pendingTextAnchor, value);
    setPendingTextAnchor(null);
    setPendingTextValue('');
  }, [engineRef, pendingTextAnchor, pendingTextValue]);

  const handleCancelText = useCallback(() => {
    setPendingTextAnchor(null);
    setPendingTextValue('');
  }, []);

  const handleCtxDelete = useCallback(() => {
    if (!ctxMenu) return;
    engineRef.current?.deleteDrawing(ctxMenu.drawingId);
    setCtxMenu(null);
  }, [engineRef, ctxMenu]);

  const handleCtxColor = useCallback((color: string) => {
    if (!ctxMenu) return;
    engineRef.current?.setDrawingColor(ctxMenu.drawingId, color);
    setCtxMenu(prev => prev ? { ...prev, color } : null);
  }, [engineRef, ctxMenu]);

  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y'))) {
        setCtxMenu(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctxMenu]);

  const toolButtonClass = (tool: DrawingTool) => [
    'w-9 h-9 rounded-md border transition-colors flex items-center justify-center',
    activeTool === tool
      ? 'bg-[#3B82F6]/10 border-[#3B82F6]/40 text-[#3B82F6]'
      : 'bg-base/80 border-border-default text-text-secondary hover:bg-hover hover:text-text-primary',
  ].join(' ');

  const handleCanvasPointerMove = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const ne = event.nativeEvent;
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    if (typeof ne.offsetX === 'number' && typeof ne.offsetY === 'number') {
      x = ne.offsetX;
      y = ne.offsetY;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
    } else {
      const rect = canvas.getBoundingClientRect();
      x = ne.clientX - rect.left;
      y = ne.clientY - rect.top;
      w = rect.width;
      h = rect.height;
    }
    const overYAxis = x >= w - PRICE_AXIS_WIDTH && y >= 0 && y <= h;
    const axisTop = h - 24;
    const overXAxis = x < w - PRICE_AXIS_WIDTH && y >= axisTop && y <= h;
    setYAxisHovered(prev => prev === overYAxis ? prev : overYAxis);
    setXAxisHovered(prev => prev === overXAxis ? prev : overXAxis);
    const hovered = !!engineRef.current?.getHoveredDrawingId();
    setDrawingHovered(prev => prev === hovered ? prev : hovered);
  }, [engineRef]);

  const handleCanvasPointerLeave = useCallback(() => {
    setYAxisHovered(false);
    setXAxisHovered(false);
    setDrawingHovered(false);
  }, []);

  useEffect(() => {
    if (!pendingTextAnchor) return;
    textInputRef.current?.focus();
  }, [pendingTextAnchor]);

  const pendingTextPosition = pendingTextAnchor
    ? engineRef.current?.anchorToCanvasPoint(pendingTextAnchor) ?? null
    : null;
  const actionablePanes = paneLayout.filter((pane) => !pane.paneId.startsWith('__script_'));

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border-default bg-panel/95 px-2 py-3">
        <div className="mb-1 text-[9px] font-mono uppercase tracking-[0.18em] text-text-muted [writing-mode:vertical-rl] rotate-180">
          Draw
        </div>
        <button
          type="button"
          className={toolButtonClass('none')}
          onClick={() => handleSelectTool('none')}
          title="Crosshair / selection"
        >
          <Crosshair size={16} />
        </button>
        <button
          type="button"
          className={toolButtonClass('trendline')}
          onClick={() => handleSelectTool('trendline')}
          title="Trendline"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="2.5" cy="13" r="1.5" fill="currentColor" stroke="none" />
            <line x1="3.5" y1="12" x2="12.5" y2="3" />
            <circle cx="13.5" cy="3" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button
          type="button"
          className={toolButtonClass('fibRetracement')}
          onClick={() => handleSelectTool('fibRetracement')}
          title="Fibonacci retracement"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeLinecap="round">
            <line x1="2" y1="2"    x2="14" y2="2"    stroke="#9CA3AF" strokeWidth="1.5" />
            <line x1="2" y1="4.5"  x2="14" y2="4.5"  stroke="#1A56DB" strokeWidth="1.5" />
            <line x1="2" y1="7"    x2="14" y2="7"    stroke="#00C853" strokeWidth="1.5" />
            <line x1="2" y1="9.5"  x2="14" y2="9.5"  stroke="#4ADE80" strokeWidth="1.5" />
            <line x1="2" y1="12"   x2="14" y2="12"   stroke="#F59E0B" strokeWidth="1.5" />
            <line x1="2" y1="14.5" x2="14" y2="14.5" stroke="#FF3D71" strokeWidth="1.5" />
          </svg>
        </button>
        <button
          type="button"
          className={toolButtonClass('brush')}
          onClick={() => handleSelectTool('brush')}
          title="Brush"
        >
          <Brush size={16} />
        </button>
        <button
          type="button"
          className={toolButtonClass('text')}
          onClick={() => handleSelectTool('text')}
          title="Text"
        >
          <Type size={16} />
        </button>
        <div className="my-1 h-px w-8 bg-border-default" />
        <button
          type="button"
          className="w-9 h-9 rounded-md border border-border-default bg-base/80 text-text-secondary hover:bg-hover hover:text-text-primary flex items-center justify-center transition-colors"
          onClick={handleZoomIn}
          title="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          className="w-9 h-9 rounded-md border border-border-default bg-base/80 text-text-secondary hover:bg-hover hover:text-text-primary flex items-center justify-center transition-colors"
          onClick={handleZoomOut}
          title="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          className="w-9 h-9 rounded-md border border-border-default bg-base/80 text-text-secondary hover:bg-hover hover:text-text-primary flex items-center justify-center transition-colors"
          onClick={handleZoomReset}
          title="Reset zoom"
        >
          <RotateCcw size={16} />
        </button>
        <div className="my-1 h-px w-8 bg-border-default" />
        <button
          type="button"
          className={`w-9 h-9 rounded-md border flex items-center justify-center transition-colors ${
            selectedDrawing
              ? 'border-border-default bg-base/80 text-text-secondary hover:bg-hover hover:text-text-primary'
              : 'border-border-default/60 bg-base/40 text-text-muted/50'
          }`}
          onClick={handleToggleSelectedLock}
          title={selectedDrawing ? (selectedDrawing.locked ? 'Unlock drawing' : 'Lock drawing') : 'Select a drawing to lock'}
          disabled={!selectedDrawing}
        >
          {selectedDrawing?.locked ? <Lock size={16} /> : <LockOpen size={16} />}
        </button>
        <button
          type="button"
          className="w-9 h-9 rounded-md border border-border-default bg-base/80 text-text-secondary hover:bg-hover hover:text-red flex items-center justify-center transition-colors"
          onClick={handleClearDrawings}
          title="Clear drawings"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          onMouseMove={handleCanvasPointerMove}
          onMouseLeave={handleCanvasPointerLeave}
          style={{ cursor: yAxisHovered ? 'ns-resize' : xAxisHovered ? 'ew-resize' : activeTool !== 'none' ? 'copy' : drawingHovered ? 'move' : 'crosshair' }}
        />
        {/* A / L scale mode buttons pinned to bottom of price section y-axis */}
        <div
          className="pointer-events-auto absolute z-10 flex items-center justify-center"
          style={{
            right: 0,
            top: priceSectionHeight > 0 ? priceSectionHeight - PRICE_AXIS_CONTROL_HEIGHT : undefined,
            bottom: priceSectionHeight > 0 ? undefined : 24,
            width: PRICE_AXIS_WIDTH,
            height: PRICE_AXIS_CONTROL_HEIGHT,
          }}
        >
          <div className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-black/20 px-1.5 py-0.5 shadow-sm backdrop-blur-sm">
            <button
              onClick={() => onYScaleModeChange?.(yScaleMode === 'auto' ? 'manual' : 'auto')}
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-mono transition-colors duration-[120ms] ${
                yScaleMode === 'auto'
                  ? 'bg-white text-black'
                  : 'text-white/78 hover:bg-white/[0.08] hover:text-white'
              }`}
              title="Auto scale"
            >
              A
            </button>
            <button
              onClick={() => onYScaleModeChange?.(yScaleMode === 'log' ? 'manual' : 'log')}
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-mono transition-colors duration-[120ms] ${
                yScaleMode === 'log'
                  ? 'bg-white text-black'
                  : 'text-white/78 hover:bg-white/[0.08] hover:text-white'
              }`}
              title="Logarithmic scale"
            >
              L
            </button>
          </div>
        </div>
        {/* Per-sub-pane action buttons (top-right) */}
        {actionablePanes.map((pane, idx) => (
          <div
            key={`pane-actions-${pane.paneId}`}
            className={`pointer-events-auto absolute z-20 flex items-center rounded-md border border-white/[0.08] bg-[#0d1117]/90 shadow-lg backdrop-blur-sm transition-colors duration-[120ms] hover:border-white/[0.16] ${
              pane.collapsed ? 'gap-0.5 px-1 py-0.5' : 'gap-1 px-1.5 py-1'
            }`}
            style={{
              right: PRICE_AXIS_WIDTH + 6,
              top: pane.top + (pane.collapsed ? 1 : 5),
            }}
          >
            <button
              onClick={() => { engineRef.current?.movePane(pane.paneId, 'down'); notifyLayout(); }}
              disabled={idx === actionablePanes.length - 1}
              className={`flex items-center justify-center rounded-sm text-white/40 transition-colors duration-[120ms] hover:bg-white/[0.06] hover:text-white/80 disabled:pointer-events-none disabled:opacity-20 ${
                pane.collapsed ? 'h-4 w-4' : 'h-[18px] w-[18px]'
              }`}
              title="Move pane down"
            >
              <ChevronDown size={11} />
            </button>
            <button
              onClick={() => { engineRef.current?.movePane(pane.paneId, 'up'); notifyLayout(); }}
              disabled={idx === 0}
              className={`flex items-center justify-center rounded-sm text-white/40 transition-colors duration-[120ms] hover:bg-white/[0.06] hover:text-white/80 disabled:pointer-events-none disabled:opacity-20 ${
                pane.collapsed ? 'h-4 w-4' : 'h-[18px] w-[18px]'
              }`}
              title="Move pane up"
            >
              <ChevronUp size={11} />
            </button>
            <button
              onClick={() => { engineRef.current?.removePane(pane.paneId); notifyLayout(); }}
              className={`flex items-center justify-center rounded-sm text-white/40 transition-colors duration-[120ms] hover:bg-white/[0.06] hover:text-red-400/80 ${
                pane.collapsed ? 'h-4 w-4' : 'h-[18px] w-[18px]'
              }`}
              title="Delete pane"
            >
              <Trash2 size={11} />
            </button>
            <button
              onClick={() => {
                if (pane.collapsed) {
                  engineRef.current?.expandPane(pane.paneId);
                } else {
                  engineRef.current?.collapsePane(pane.paneId);
                }
                notifyLayout();
              }}
              className={`flex items-center justify-center rounded-sm text-white/40 transition-colors duration-[120ms] hover:bg-white/[0.06] hover:text-white/80 ${
                pane.collapsed ? 'h-4 w-4' : 'h-[18px] w-[18px]'
              }`}
              title={pane.collapsed ? 'Expand pane' : 'Collapse pane'}
            >
              {pane.collapsed ? <ChevronsUpDown size={11} /> : <Minus size={12} strokeWidth={2.25} />}
            </button>
            <button
              onClick={() => {
                if (pane.maximized) {
                  engineRef.current?.unmaximizePane();
                } else {
                  engineRef.current?.maximizePane(pane.paneId);
                }
                notifyLayout();
              }}
              className={`flex items-center justify-center rounded-sm text-white/40 transition-colors duration-[120ms] hover:bg-white/[0.06] hover:text-white/80 ${
                pane.collapsed ? 'h-4 w-4' : 'h-[18px] w-[18px]'
              }`}
              title={pane.maximized ? 'Restore pane' : 'Maximize pane'}
            >
              <Maximize2 size={11} />
            </button>
          </div>
        ))}
        {/* Per-sub-pane A / L scale mode buttons */}
        {paneLayout.filter((pane) => pane.height > 24 && !pane.collapsed && pane.showScaleControls).map((pane) => (
          <div
            key={pane.paneId}
            className="pointer-events-auto absolute z-10 flex items-center justify-center"
            style={{
              right: 0,
              top: pane.top + pane.height - PRICE_AXIS_CONTROL_HEIGHT,
              width: PRICE_AXIS_WIDTH,
              height: PRICE_AXIS_CONTROL_HEIGHT,
            }}
          >
            <div className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-black/20 px-1.5 py-0.5 shadow-sm backdrop-blur-sm">
              <button
                onClick={() => {
                  const next = pane.yScaleMode === 'auto' ? 'manual' : 'auto';
                  engineRef.current?.setSubPaneScaleMode(pane.paneId, next);
                  notifyLayout();
                }}
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-mono transition-colors duration-[120ms] ${
                  pane.yScaleMode === 'auto'
                    ? 'bg-white text-black'
                    : 'text-white/78 hover:bg-white/[0.08] hover:text-white'
                }`}
                title="Auto scale"
              >
                A
              </button>
              <button
                onClick={() => {
                  const next = pane.yScaleMode === 'log' ? 'manual' : 'log';
                  engineRef.current?.setSubPaneScaleMode(pane.paneId, next);
                  notifyLayout();
                }}
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-mono transition-colors duration-[120ms] ${
                  pane.yScaleMode === 'log'
                    ? 'bg-white text-black'
                    : 'text-white/78 hover:bg-white/[0.08] hover:text-white'
                }`}
                title="Logarithmic scale"
              >
                L
              </button>
            </div>
          </div>
        ))}
        {pendingTextAnchor && pendingTextPosition && (
          <div
            className="absolute z-30 flex w-52 flex-col gap-2 rounded-md border border-white/[0.08] bg-[#161B22]/95 p-2 shadow-xl shadow-black/40 backdrop-blur-sm"
            style={{
              left: Math.min(Math.max(8, pendingTextPosition.x + 12), Math.max(8, (containerRef.current?.offsetWidth ?? 220) - 216)),
              top: Math.min(Math.max(8, pendingTextPosition.y + 12), Math.max(8, (containerRef.current?.offsetHeight ?? 120) - 88)),
            }}
          >
            <div className="text-[9px] font-mono uppercase tracking-[0.16em] text-text-muted">Chart Text</div>
            <input
              ref={textInputRef}
              value={pendingTextValue}
              onChange={(e) => setPendingTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCommitText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelText();
                }
              }}
              placeholder="Add note"
              className="h-8 w-full rounded-sm border border-white/[0.08] bg-black/20 px-2 text-[11px] text-white/75 outline-none placeholder:text-white/20"
            />
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                className="rounded-sm px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-primary"
                onClick={handleCancelText}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-sm bg-blue/15 px-2 py-1 text-[10px] text-blue transition-colors hover:bg-blue/25"
                onClick={handleCommitText}
              >
                Place
              </button>
            </div>
          </div>
        )}
        {ctxMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
            <div
              className="absolute z-50 flex flex-col rounded-md border border-white/[0.1] bg-[#161B22]/95 shadow-xl shadow-black/50 backdrop-blur-sm"
              style={{ left: ctxMenu.x, top: ctxMenu.y, minWidth: 148 }}
            >
              <div className="px-3 pt-2.5 pb-1.5 text-[9px] font-mono uppercase tracking-[0.16em] text-text-muted">Drawing</div>
              <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                {DRAWING_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleCtxColor(c)}
                    className="relative h-5 w-5 rounded-full border border-white/[0.12] transition-transform hover:scale-110"
                    style={{ backgroundColor: c }}
                    title={c}
                  >
                    {ctxMenu.color === c && (
                      <Check size={11} className="absolute inset-0 m-auto" style={{ color: c === '#FFFFFF' ? '#000' : '#fff' }} />
                    )}
                  </button>
                ))}
              </div>
              <div className="h-px bg-white/[0.08]" />
              <button
                type="button"
                className="flex items-center gap-2 px-3 py-2 text-[11px] text-red transition-colors hover:bg-red/10"
                onClick={handleCtxDelete}
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          </>
        )}
        <div style={{ pointerEvents: (drawingHovered || activeTool !== 'none' || selectedDrawing) ? 'none' : undefined }}>
          {children}
        </div>
      </div>
    </div>
  );
}

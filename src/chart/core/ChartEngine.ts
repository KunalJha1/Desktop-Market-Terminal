import type {
  OHLCVBar,
  ChartType,
  ActiveIndicator,
  ChartLayout,
  SubPaneLayout,
  YScaleMode,
  ChartBrandingMode,
  DrawingTool,
  DrawingAnchor,
  DrawingShape,
  DrawingSelection,
} from '../types';
import { COLORS, PRICE_AXIS_CONTROL_HEIGHT, PRICE_AXIS_WIDTH, TIME_AXIS_HEIGHT, SUB_PANE_HEIGHT, SUB_PANE_SEPARATOR, FONT_MONO_SMALL, VOLUME_PANE_RATIO, DEFAULT_BARS_VISIBLE, getTimeframeMs } from '../constants';
import { Viewport } from './Viewport';
import { Renderer } from './Renderer';
import { ScaleY } from './ScaleY';
import { ScaleX } from './ScaleX';
import { HitTest } from './HitTest';
import { CandlestickRenderer } from '../renderers/CandlestickRenderer';
import { HeikinAshiRenderer } from '../renderers/HeikinAshiRenderer';
import { BarRenderer } from '../renderers/BarRenderer';
import { LineRenderer } from '../renderers/LineRenderer';
import { AreaRenderer } from '../renderers/AreaRenderer';
import { VolumeBarRenderer } from '../renderers/VolumeBarRenderer';
import { VolumeWeightedRenderer } from '../renderers/VolumeWeightedRenderer';
import { PanZoom } from '../interaction/PanZoom';
import { Crosshair } from '../interaction/Crosshair';
import { Tooltip } from '../interaction/Tooltip';
import { indicatorRegistry } from '../indicators/registry';
import { computeIndicator, recomputeIndicatorTail } from '../indicators/compute';
import { detectActiveFvgZones } from '../indicators/shared/ictSmc';
import type { ScriptResult } from '../types';
import type { Timeframe } from '../types';

const BRANDING_ASSETS: Record<Exclude<ChartBrandingMode, 'none'>, { src: string; opacity: number }> = {
  fullLogo: {
    src: '/dailyiq-brand-resources/daily-iq-topbar-logo.svg',
    opacity: 0.34,
  },
  icon: {
    src: '/dailyiq-brand-resources/daily-iq-topbar-favicon.svg',
    opacity: 0.4,
  },
};

const brandingImageCache = new Map<string, HTMLImageElement>();
const brandingImageFailures = new Set<string>();

function isProbEngWidgetIndicator(indicator: ActiveIndicator): boolean {
  return indicator.name === 'Probability Engine';
}

/** Single formatter for session tinting — avoid constructing Intl.DateTimeFormat per bar per frame. */
const CHART_ET_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function etDatePartsFromMs(tsMs: number): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = CHART_ET_DATE_FORMAT.formatToParts(new Date(tsMs));
  const getPart = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value ?? '0';
    return parseInt(value, 10);
  };
  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
  };
}

function sameUtcDay(a: number, b: number): boolean {
  const left = new Date(a);
  const right = new Date(b);
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

function formatLiquidityPrice(price: number): string {
  if (!Number.isFinite(price)) return 'n/a';
  if (Math.abs(price) >= 10000) return price.toFixed(0);
  if (Math.abs(price) >= 1000) return price.toFixed(2);
  if (Math.abs(price) >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

export class ChartEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: Renderer;
  private viewport: Viewport;
  private scaleY: ScaleY;
  private scaleX: ScaleX;
  private hitTest: HitTest;
  private panZoom: PanZoom;
  private crosshair: Crosshair;
  private tooltip: Tooltip;

  // Renderers
  private candlestick = new CandlestickRenderer();
  private heikinAshi = new HeikinAshiRenderer();
  private barRenderer = new BarRenderer();
  private lineRenderer = new LineRenderer();
  private areaRenderer = new AreaRenderer();
  private volumeWeightedRenderer = new VolumeWeightedRenderer();
  private volumeRenderer = new VolumeBarRenderer();

  // State
  private bars: OHLCVBar[] = [];
  private chartType: ChartType = 'candlestick';
  private activeIndicators: ActiveIndicator[] = [];
  private scriptResults: Map<string, ScriptResult> = new Map();
  private dirty = true;
  private rafId = 0;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private destroyed = false;
  private liveMode = false;
  private stopperPx = 0;
  private subPaneHeightOverrides: Map<string, number> = new Map();
  private subPaneScaleModes: Map<string, YScaleMode> = new Map();
  private collapsedPanes: Set<string> = new Set();
  private maximizedPaneId: string | null = null;
  private brandingMode: ChartBrandingMode = 'none';
  private brandingImage: HTMLImageElement | null = null;
  private symbolBrandingSymbol = '';
  private symbolBrandingImage: HTMLImageElement | null = null;
  private _onViewportChange: ((startIdx: number, endIdx: number) => void) | null = null;
  private activeDrawingTool: DrawingTool = 'none';
  private drawings: DrawingShape[] = [];
  private drawingUndoStack: DrawingShape[][] = [];
  private drawingRedoStack: DrawingShape[][] = [];
  private drawingStart: DrawingAnchor | null = null;
  private drawingCurrent: DrawingAnchor | null = null;
  private drawingBrushPoints: DrawingAnchor[] = [];
  private drawingPointerActive = false;
  private draggedDrawingId: string | null = null;
  private dragMouseOrigin: DrawingAnchor | null = null;
  private dragDrawingOriginStart: DrawingAnchor | null = null;
  private dragDrawingOriginEnd: DrawingAnchor | null = null;
  private dragEndpoint: 'start' | 'end' | 'whole' = 'whole';
  private hoveredDrawingId: string | null = null;
  private selectedDrawingId: string | null = null;
  private _onTextPlacementRequest: ((anchor: DrawingAnchor) => void) | null = null;
  private _onDrawingSelectionChange: ((selection: DrawingSelection | null) => void) | null = null;
  private _onDrawingContextMenu: ((info: { drawingId: string; color: string; screenX: number; screenY: number }) => void) | null = null;
  private _onDrawingHoverChange: ((hoveredId: string | null) => void) | null = null;
  onYScaleModeChange: ((mode: YScaleMode) => void) | null = null;
  private lastNotifiedViewportStart: number | null = null;
  private lastNotifiedViewportEnd: number | null = null;
  private pendingMouseEvent: MouseEvent | null = null;
  /** When false, no rAF loop runs until resume() or scheduleFrame() via input. */
  private suspended = false;
  /** True while a frame callback is queued (idle loop stops when false and no work pending). */
  private renderLoopScheduled = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.renderer = new Renderer(this.ctx);
    this.viewport = new Viewport();
    this.scaleY = new ScaleY();
    this.scaleX = new ScaleX();
    this.hitTest = new HitTest();
    this.crosshair = new Crosshair();
    this.tooltip = new Tooltip();
    this.panZoom = new PanZoom(this.viewport, () => this.markDirty());
    this.panZoom.setCanvasEl(canvas);
    this.panZoom.onDetachAutoY = () => {
      this.viewport.setYScaleMode('manual');
      this.onYScaleModeChange?.('manual');
      this.markDirty();
    };

    this.bindEvents();
    this.scheduleFrame();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.renderLoopScheduled = false;
    this.unbindEvents();
  }

  /** Stop the render loop (e.g. widget off-screen). Canvas stays static until resume(). */
  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.renderLoopScheduled = false;
  }

  /** Restart rendering; schedules a frame if the chart is dirty or has pending input. */
  resume() {
    if (this.destroyed || !this.suspended) return;
    this.suspended = false;
    this.dirty = true;
    this.scheduleFrame();
  }

  // --- Public API ---

  resetViewport() {
    this.viewport.reset();
    this.markDirty();
  }

  setData(bars: OHLCVBar[]) {
    const prevLength = this.bars.length;
    const wasNearEnd = this.liveMode && this.viewport.isLastBarVisible();
    this.bars = bars;
    this.lastNotifiedViewportStart = null;
    this.lastNotifiedViewportEnd = null;
    this.viewport.setRightOffsetBars(this.computeRightOffsetBars());
    this.viewport.setTotalBars(bars.length);
    this.recomputeIndicators(false);
    if (wasNearEnd && bars.length > prevLength) {
      this.viewport.scrollToEnd();
    }
    this.markDirty();
  }

  /**
   * Incremental tail update: replaces bars from changeOffset onward.
   * Skips onViewportChange to avoid triggering pan-fetch cascades.
   */
  updateTail(bars: OHLCVBar[], changeOffset: number) {
    if (!this.canApplyTailUpdate(bars, changeOffset)) {
      this.setData(bars);
      return;
    }
    const prevLength = this.bars.length;
    const wasNearEnd = this.liveMode && this.viewport.isLastBarVisible();
    this.bars = bars;

    this.viewport.setRightOffsetBars(this.computeRightOffsetBars());
    if (bars.length !== prevLength) {
      this.viewport.setTotalBars(bars.length);
    }

    this.recomputeIndicators(true, changeOffset);

    if (wasNearEnd && bars.length > prevLength) {
      this.viewport.scrollToEnd();
    }

    this.dirty = true;
    this.scheduleFrame();
  }

  private canApplyTailUpdate(nextBars: OHLCVBar[], changeOffset: number): boolean {
    if (this.bars.length === 0 || nextBars.length === 0) return false;
    if (!Number.isFinite(changeOffset) || changeOffset < 0) return false;
    if (changeOffset > this.bars.length || changeOffset > nextBars.length) return false;
    if (nextBars.length < this.bars.length) return false;
    for (let i = 0; i < changeOffset; i++) {
      if (this.bars[i]?.time !== nextBars[i]?.time) return false;
    }
    return true;
  }

  setOnViewportChange(cb: ((startIdx: number, endIdx: number) => void) | null) {
    this._onViewportChange = cb;
    this.lastNotifiedViewportStart = null;
    this.lastNotifiedViewportEnd = null;
  }

  getViewportRange(): { startIndex: number; endIndex: number } {
    return {
      startIndex: Math.max(0, Math.floor(this.viewport.startIndex)),
      endIndex: Math.min(this.bars.length, Math.ceil(this.viewport.endIndex)),
    };
  }

  shiftViewportBy(deltaBars: number) {
    if (!Number.isFinite(deltaBars) || deltaBars === 0) return;
    this.viewport.shiftStartBy(deltaBars);
    this.markDirty();
  }

  setChartType(type: ChartType) {
    this.chartType = type;
    this.markDirty();
  }

  setTimeframe(tf: Timeframe) {
    this.scaleX.timeframe = tf;
    this.markDirty();
  }

  setYScaleMode(mode: YScaleMode) {
    this.viewport.setYScaleMode(mode);
    this.markDirty();
  }

  setBrandingMode(mode: ChartBrandingMode) {
    if (this.brandingMode === mode) return;
    this.brandingMode = mode;
    this.brandingImage = null;

    if (mode !== 'none') {
      const asset = BRANDING_ASSETS[mode];
      const cached = brandingImageCache.get(asset.src);
      if (cached) {
        this.brandingImage = cached;
        if (!cached.complete) {
          cached.addEventListener('load', () => this.markDirty(), { once: true });
        }
      } else {
        const image = new Image();
        image.decoding = 'async';
        image.src = asset.src;
        image.addEventListener('load', () => this.markDirty(), { once: true });
        brandingImageCache.set(asset.src, image);
        this.brandingImage = image;
      }
    }

    this.markDirty();
  }

  setBrandingSymbol(symbol: string) {
    const normalized = symbol.trim().toUpperCase();
    if (this.symbolBrandingSymbol === normalized) return;
    this.symbolBrandingSymbol = normalized;
    this.symbolBrandingImage = null;

    if (!normalized) {
      this.markDirty();
      return;
    }

    const src = `/dailyiq-brand-resources/logosvg/${normalized}.svg`;
    if (brandingImageFailures.has(src)) {
      this.markDirty();
      return;
    }
    const cached = brandingImageCache.get(src);
    if (cached) {
      this.symbolBrandingImage = cached;
      if (!cached.complete) {
        cached.addEventListener('load', () => this.markDirty(), { once: true });
      }
    } else {
      const image = new Image();
      image.decoding = 'async';
      image.src = src;
      image.addEventListener('load', () => this.markDirty(), { once: true });
      image.addEventListener('error', () => {
        brandingImageFailures.add(src);
        if (this.symbolBrandingSymbol === normalized) {
          this.symbolBrandingImage = null;
          this.markDirty();
        }
      }, { once: true });
      brandingImageCache.set(src, image);
      this.symbolBrandingImage = image;
    }

    this.markDirty();
  }

  setLiveMode(isLive: boolean) {
    this.liveMode = isLive;
    const rightOffsetBars = this.computeRightOffsetBars();
    this.viewport.setRightOffsetBars(rightOffsetBars);
    if (isLive && this.bars.length > 0) {
      this.viewport.scrollToEnd();
    }
    this.markDirty();
  }

  setStopperPx(px: number) {
    const wasNearEnd = this.liveMode && this.viewport.isLastBarVisible();
    this.stopperPx = Math.max(0, px);
    const rightOffsetBars = this.computeRightOffsetBars();
    this.viewport.setRightOffsetBars(rightOffsetBars);
    if (wasNearEnd) {
      this.viewport.scrollToEnd();
    }
    this.markDirty();
  }

  setTooltipFields(fields: Record<string, boolean>) {
    this.tooltip.setVisibleFields(fields);
    this.markDirty();
  }

  setDrawingTool(tool: DrawingTool) {
    this.activeDrawingTool = tool;
    this.cancelDraftDrawing();
    this.markDirty();
  }

  getDrawingTool(): DrawingTool {
    return this.activeDrawingTool;
  }

  clearDrawings() {
    if (this.drawings.length > 0) this.pushDrawingUndo();
    this.drawings = [];
    this.setSelectedDrawingId(null);
    this.cancelDraftDrawing();
    this.markDirty();
  }

  setOnTextPlacementRequest(cb: ((anchor: DrawingAnchor) => void) | null) {
    this._onTextPlacementRequest = cb;
  }

  setOnDrawingSelectionChange(cb: ((selection: DrawingSelection | null) => void) | null) {
    this._onDrawingSelectionChange = cb;
    this.notifyDrawingSelectionChange();
  }

  addTextDrawing(anchor: DrawingAnchor, text: string) {
    const value = text.trim();
    if (!value) return;
    this.pushDrawingUndo();
    const drawing: DrawingShape = {
      id: `drawing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'text',
      anchor: { ...anchor },
      text: value,
      locked: false,
    };
    this.drawings.push(drawing);
    this.setSelectedDrawingId(drawing.id);
    this.markDirty();
  }

  setDrawingLocked(id: string, locked: boolean) {
    const drawing = this.drawings.find((item) => item.id === id);
    if (!drawing || drawing.locked === locked) return;
    this.pushDrawingUndo();
    drawing.locked = locked;
    this.notifyDrawingSelectionChange();
    this.markDirty();
  }

  setOnDrawingContextMenu(cb: ((info: { drawingId: string; color: string; screenX: number; screenY: number }) => void) | null) {
    this._onDrawingContextMenu = cb;
  }

  setOnDrawingHoverChange(cb: ((hoveredId: string | null) => void) | null) {
    this._onDrawingHoverChange = cb;
  }

  private cloneDrawings(): DrawingShape[] {
    return this.drawings.map((d): DrawingShape => {
      switch (d.type) {
        case 'trendline':
        case 'fibRetracement':
          return { ...d, start: { ...d.start }, end: { ...d.end } };
        case 'brush':
          return { ...d, points: d.points.map(p => ({ ...p })) };
        case 'text':
          return { ...d, anchor: { ...d.anchor } };
      }
    });
  }

  private pushDrawingUndo() {
    this.drawingUndoStack.push(this.cloneDrawings());
    this.drawingRedoStack = [];
    if (this.drawingUndoStack.length > 50) this.drawingUndoStack.shift();
  }

  undo() {
    if (this.drawingUndoStack.length === 0) return;
    this.drawingRedoStack.push(this.cloneDrawings());
    this.drawings = this.drawingUndoStack.pop()!;
    this.setSelectedDrawingId(null);
    this.hoveredDrawingId = null;
    this._onDrawingHoverChange?.(null);
    this.markDirty();
  }

  redo() {
    if (this.drawingRedoStack.length === 0) return;
    this.drawingUndoStack.push(this.cloneDrawings());
    this.drawings = this.drawingRedoStack.pop()!;
    this.setSelectedDrawingId(null);
    this.hoveredDrawingId = null;
    this._onDrawingHoverChange?.(null);
    this.markDirty();
  }

  deleteDrawing(id: string) {
    this.pushDrawingUndo();
    this.drawings = this.drawings.filter(d => d.id !== id);
    if (this.selectedDrawingId === id) this.setSelectedDrawingId(null);
    this.markDirty();
  }

  setDrawingColor(id: string, color: string) {
    const drawing = this.drawings.find(d => d.id === id);
    if (!drawing) return;
    this.pushDrawingUndo();
    drawing.color = color;
    this.markDirty();
  }

  getSelectedDrawing(): DrawingSelection | null {
    const drawing = this.selectedDrawingId
      ? this.drawings.find((item) => item.id === this.selectedDrawingId) ?? null
      : null;
    if (!drawing) return null;
    return {
      id: drawing.id,
      type: drawing.type,
      locked: drawing.locked,
    };
  }

  anchorToCanvasPoint(anchor: DrawingAnchor): { x: number; y: number } {
    return {
      x: this.viewport.barToPixelX(anchor.barIndex),
      y: this.viewport.priceToPixelY(anchor.price),
    };
  }

  zoomIn() {
    const anchor = this.viewport.chartLeft + this.viewport.chartWidth / 2;
    this.viewport.zoom(1, anchor);
    this.markDirty();
  }

  zoomOut() {
    const anchor = this.viewport.chartLeft + this.viewport.chartWidth / 2;
    this.viewport.zoom(-1, anchor);
    this.markDirty();
  }

  resetZoom() {
    this.viewport.setBarsVisible(DEFAULT_BARS_VISIBLE);
    this.viewport.scrollToEnd();
    this.markDirty();
  }

  addIndicator(name: string): string {
    const meta = indicatorRegistry[name];
    if (!meta) return '';
    if (name === 'Volume') {
      const existing = this.activeIndicators.find((indicator) => indicator.name === 'Volume');
      if (existing) {
        existing.visible = true;
        this.markDirty();
        return existing.id;
      }
    }
    const id = `ind_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const paneId = meta.category === 'overlay' ? 'main' : `pane:${id}`;
    const colors: Record<string, string> = {};
    const lineWidths: Record<string, number> = {};
    const lineStyles: Record<string, 'solid' | 'dashed' | 'dotted'> = {};
    for (const output of meta.outputs) {
      colors[output.key] = output.color;
      lineWidths[output.key] = output.lineWidth ?? 1.5;
      lineStyles[output.key] = 'solid';
    }
    const indicator: ActiveIndicator = {
      id,
      name,
      paneId,
      params: { ...meta.defaultParams },
      textParams: { ...(meta.defaultTextParams ?? {}) },
      colors,
      lineWidths,
      lineStyles,
      visible: true,
      data: [],
    };
    this.activeIndicators.push(indicator);
    this.computeSingleIndicator(indicator);
    this.markDirty();
    return id;
  }

  removeIndicator(id: string) {
    this.activeIndicators = this.activeIndicators.filter(ind => ind.id !== id);
    this.markDirty();
  }

  updateIndicatorParams(id: string, params: Record<string, number>) {
    const ind = this.activeIndicators.find(i => i.id === id);
    if (!ind) return;
    ind.params = { ...ind.params, ...params };
    this.computeSingleIndicator(ind);
    this.markDirty();
  }

  updateIndicatorTextParams(id: string, textParams: Record<string, string>) {
    const ind = this.activeIndicators.find(i => i.id === id);
    if (!ind) return;
    ind.textParams = { ...ind.textParams, ...textParams };
    this.computeSingleIndicator(ind);
    this.markDirty();
  }

  updateIndicatorColor(id: string, outputKey: string, color: string) {
    const ind = this.activeIndicators.find(i => i.id === id);
    if (!ind) return;
    ind.colors[outputKey] = color;
    this.markDirty();
  }

  updateIndicatorLineWidth(id: string, outputKey: string, width: number) {
    const ind = this.activeIndicators.find(i => i.id === id);
    if (!ind) return;
    if (!ind.lineWidths) ind.lineWidths = {};
    ind.lineWidths[outputKey] = width;
    this.markDirty();
  }

  updateIndicatorLineStyle(id: string, outputKey: string, style: 'solid' | 'dashed' | 'dotted') {
    const ind = this.activeIndicators.find(i => i.id === id);
    if (!ind) return;
    if (!ind.lineStyles) ind.lineStyles = {};
    ind.lineStyles[outputKey] = style;
    this.markDirty();
  }

  toggleVisibility(id: string) {
    const ind = this.activeIndicators.find(i => i.id === id);
    if (!ind) return;
    ind.visible = !ind.visible;
    this.markDirty();
  }

  setIndicatorVisibility(id: string, visible: boolean) {
    const ind = this.activeIndicators.find(i => i.id === id);
    if (!ind || ind.visible === visible) return;
    ind.visible = visible;
    this.markDirty();
  }

  moveIndicator(id: string, direction: 'up' | 'down') {
    const index = this.activeIndicators.findIndex(ind => ind.id === id);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= this.activeIndicators.length) return;
    const next = [...this.activeIndicators];
    const [item] = next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    this.activeIndicators = next;
    this.markDirty();
  }

  setIndicatorPane(id: string, paneId: string) {
    const ind = this.activeIndicators.find(i => i.id === id);
    if (!ind || ind.paneId === paneId) return;
    ind.paneId = paneId;
    this.markDirty();
  }

  getActiveIndicators(): ActiveIndicator[] {
    return this.activeIndicators;
  }

  getLayout(): ChartLayout {
    return this.computeLayout();
  }

  setSubPaneHeight(paneId: string, height: number) {
    const clamped = Math.max(60, Math.min(400, height));
    this.subPaneHeightOverrides.set(paneId, clamped);
    this.markDirty();
  }

  setSubPaneScaleMode(paneId: string, mode: YScaleMode) {
    this.subPaneScaleModes.set(paneId, mode);
    this.markDirty();
  }

  getSubPaneScaleMode(paneId: string): YScaleMode {
    return this.subPaneScaleModes.get(paneId) ?? 'auto';
  }

  movePane(paneId: string, direction: 'up' | 'down') {
    const panes = this.getAssignedSubPanes();
    const paneIndex = panes.findIndex(p => p.paneId === paneId);
    if (paneIndex === -1) return;
    const targetIndex = direction === 'up' ? paneIndex - 1 : paneIndex + 1;
    if (targetIndex < 0 || targetIndex >= panes.length) return;

    // Swap two pane groups in the flat indicators array
    const newPaneOrder = [...panes];
    [newPaneOrder[paneIndex], newPaneOrder[targetIndex]] = [newPaneOrder[targetIndex], newPaneOrder[paneIndex]];

    const mainInds = this.activeIndicators.filter(i => i.paneId === 'main');
    const subPaneInds = newPaneOrder.flatMap(p =>
      this.activeIndicators.filter(i => i.paneId === p.paneId)
    );
    const rest = this.activeIndicators.filter(
      i => i.paneId !== 'main' && !panes.some(p => p.paneId === i.paneId)
    );
    this.activeIndicators = [...mainInds, ...subPaneInds, ...rest];
    this.markDirty();
  }

  removePane(paneId: string) {
    this.activeIndicators = this.activeIndicators.filter(ind => ind.paneId !== paneId);
    this.collapsedPanes.delete(paneId);
    this.subPaneHeightOverrides.delete(paneId);
    this.subPaneScaleModes.delete(paneId);
    if (this.maximizedPaneId === paneId) this.maximizedPaneId = null;
    this.markDirty();
  }

  collapsePane(paneId: string) {
    this.collapsedPanes.add(paneId);
    this.markDirty();
  }

  expandPane(paneId: string) {
    this.collapsedPanes.delete(paneId);
    this.markDirty();
  }

  isPaneCollapsed(paneId: string): boolean {
    return this.collapsedPanes.has(paneId);
  }

  maximizePane(paneId: string) {
    this.maximizedPaneId = paneId;
    this.markDirty();
  }

  unmaximizePane() {
    this.maximizedPaneId = null;
    this.markDirty();
  }

  getMaximizedPane(): string | null {
    return this.maximizedPaneId;
  }

  /** Set result for a single script by id. Pass null to remove. */
  setScriptResult(id: string, result: ScriptResult | null) {
    if (result) {
      this.scriptResults.set(id, result);
    } else {
      this.scriptResults.delete(id);
    }
    this.markDirty();
  }

  /** Clear all script results. */
  clearAllScripts() {
    this.scriptResults.clear();
    this.markDirty();
  }

  resize(width: number, height: number) {
    this.dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.panZoom.setCanvasWidth(width);
    this.panZoom.setCanvasHeight(height);
    this.markDirty();
  }

  // --- Layout ---

  private computeLayout(): ChartLayout {
    const assignedPanes = this.getAssignedSubPanes();
    const scriptPanes = this.getScriptSubPanes();
    const COLLAPSED_HEIGHT = 28;

    const getEffectiveHeight = (paneId: string): number => {
      if (this.collapsedPanes.has(paneId)) return COLLAPSED_HEIGHT;
      if (this.maximizedPaneId !== null && this.maximizedPaneId !== paneId) return COLLAPSED_HEIGHT;
      return this.subPaneHeightOverrides.get(paneId) ?? SUB_PANE_HEIGHT;
    };

    const allPaneIds = [
      ...assignedPanes.map(p => p.paneId),
      ...scriptPanes.map(id => `__script_${id}__`),
    ];
    const nonMaximizedHeight = allPaneIds.reduce((sum, id) => {
      if (this.maximizedPaneId && id === this.maximizedPaneId) return sum;
      const h = getEffectiveHeight(id);
      return sum + (h > 0 ? h + SUB_PANE_SEPARATOR : 0);
    }, 0);

    const assignedPaneHeights = assignedPanes.map(pane => {
      const h = getEffectiveHeight(pane.paneId);
      return (h > 0 ? h + SUB_PANE_SEPARATOR : 0);
    });
    const scriptHeights = scriptPanes.map(id => {
      const key = `__script_${id}__`;
      const h = getEffectiveHeight(key);
      return (h > 0 ? h + SUB_PANE_SEPARATOR : 0);
    });
    const totalSubPaneHeight = [...assignedPaneHeights, ...scriptHeights].reduce((a, b) => a + b, 0);
    const mainHeight = this.maximizedPaneId
      ? 0
      : this.height - TIME_AXIS_HEIGHT - totalSubPaneHeight;

    const subPanes: SubPaneLayout[] = [];
    let currentTop = mainHeight;

    for (const pane of assignedPanes) {
      const panePresentation = this.getSubPanePresentation(pane.indicatorIds);
      const isCollapsed = this.collapsedPanes.has(pane.paneId);
      const isMaximized = this.maximizedPaneId === pane.paneId;
      const isCompressed = this.maximizedPaneId !== null && !isMaximized;
      const h = isCompressed ? COLLAPSED_HEIGHT : isCollapsed ? COLLAPSED_HEIGHT : (this.subPaneHeightOverrides.get(pane.paneId) ?? SUB_PANE_HEIGHT);
      const maxH = isMaximized ? Math.max(COLLAPSED_HEIGHT, this.height - TIME_AXIS_HEIGHT - nonMaximizedHeight - mainHeight) : h;

      subPanes.push({
        paneId: pane.paneId,
        indicatorIds: pane.indicatorIds,
        top: currentTop + SUB_PANE_SEPARATOR,
        height: maxH,
        yScaleMode: this.subPaneScaleModes.get(pane.paneId) ?? 'auto',
        showScaleControls: panePresentation.showScaleControls,
        collapsed: isCollapsed,
        maximized: isMaximized,
      });
      currentTop += maxH + SUB_PANE_SEPARATOR;
    }

    for (const scriptId of scriptPanes) {
      const key = `__script_${scriptId}__`;
      const isCollapsed = this.collapsedPanes.has(key);
      const isMaximized = this.maximizedPaneId === key;
      const isCompressed = this.maximizedPaneId !== null && !isMaximized;
      const h = isCompressed ? COLLAPSED_HEIGHT : isCollapsed ? COLLAPSED_HEIGHT : (this.subPaneHeightOverrides.get(key) ?? SUB_PANE_HEIGHT);
      const maxH = isMaximized ? Math.max(COLLAPSED_HEIGHT, this.height - TIME_AXIS_HEIGHT - nonMaximizedHeight - mainHeight) : h;

      subPanes.push({
        paneId: key,
        indicatorIds: [key],
        top: currentTop + SUB_PANE_SEPARATOR,
        height: maxH,
        yScaleMode: this.subPaneScaleModes.get(key) ?? 'auto',
        showScaleControls: true,
        collapsed: isCollapsed,
        maximized: isMaximized,
      });
      currentTop += maxH + SUB_PANE_SEPARATOR;
    }

    return {
      mainTop: 0,
      mainHeight: Math.max(0, mainHeight),
      subPanes,
      priceAxisWidth: PRICE_AXIS_WIDTH,
      timeAxisHeight: TIME_AXIS_HEIGHT,
      width: this.width,
      height: this.height,
    };
  }

  private getAssignedSubPanes(): Array<{ paneId: string; indicatorIds: string[] }> {
    const paneOrder: string[] = [];
    const paneMap = new Map<string, string[]>();

    for (const ind of this.activeIndicators) {
      if (!ind.visible || ind.paneId === 'main' || isProbEngWidgetIndicator(ind)) continue;
      if (!paneMap.has(ind.paneId)) {
        paneMap.set(ind.paneId, []);
        paneOrder.push(ind.paneId);
      }
      paneMap.get(ind.paneId)!.push(ind.id);
    }

    return paneOrder.map((paneId) => ({
      paneId,
      indicatorIds: paneMap.get(paneId) ?? [],
    }));
  }

  private getSubPanePresentation(indicatorIds: string[]): {
    min?: number;
    max?: number;
    showScaleControls: boolean;
  } {
    if (indicatorIds.length !== 1) {
      return { showScaleControls: true };
    }

    const indicator = this.activeIndicators.find((entry) => entry.id === indicatorIds[0]);
    if (!indicator) {
      return { showScaleControls: true };
    }

    const meta = indicatorRegistry[indicator.name];
    return {
      min: meta?.paneRange?.min,
      max: meta?.paneRange?.max,
      showScaleControls: !meta?.hidePaneScaleControls,
    };
  }

  private getScriptSubPanes(): string[] {
    const ids: string[] = [];
    for (const [id, result] of this.scriptResults) {
      if (result.plots.length > 0) {
        // Check if any plots are non-overlay (values not in price range)
        const hasSubPanePlot = result.plots.some(plot => {
          const vals = plot.values.filter(v => !isNaN(v));
          if (vals.length === 0) return false;
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          return !(avg > this.viewport.priceMin * 0.5 && avg < this.viewport.priceMax * 2);
        });
        if (hasSubPanePlot || result.hlines.length > 0) {
          ids.push(id);
        }
      }
    }
    return ids;
  }

  // --- Indicators ---

  private recomputeIndicators(tailOnly = false, changeOffset = 0) {
    for (const ind of this.activeIndicators) {
      if (
        tailOnly &&
        ind.name !== 'FVG Momentum' &&
        changeOffset > 0 &&
        changeOffset < this.bars.length &&
        ind.data?.length
      ) {
        ind.data = recomputeIndicatorTail(ind.name, this.bars, ind.params, changeOffset, ind.data);
      } else {
        this.computeSingleIndicator(ind);
      }
    }
  }

  private computeSingleIndicator(ind: ActiveIndicator) {
    ind.data = computeIndicator(ind.name, this.bars, { ...ind.params, ...ind.textParams } as Record<string, number>);
  }

  // --- Render ---

  private markDirty() {
    this.dirty = true;
    this.notifyViewportChange();
    this.scheduleFrame();
  }

  // Lightweight dirty flag for crosshair-only updates — skips viewport change notification
  private markCrosshairDirty() {
    this.dirty = true;
    this.scheduleFrame();
  }

  private notifyViewportChange() {
    if (!this._onViewportChange || this.bars.length === 0) return;
    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));
    if (start !== this.lastNotifiedViewportStart || end !== this.lastNotifiedViewportEnd) {
      this.lastNotifiedViewportStart = start;
      this.lastNotifiedViewportEnd = end;
      this._onViewportChange(start, end);
    }
  }

  private scheduleFrame() {
    if (this.destroyed || this.suspended) return;
    if (this.renderLoopScheduled) return;
    this.renderLoopScheduled = true;
    this.rafId = requestAnimationFrame(() => this.runRenderFrame());
  }

  private runRenderFrame() {
    this.renderLoopScheduled = false;
    if (this.destroyed || this.suspended) return;
    if (this.pendingMouseEvent) {
      this.processMouseMove(this.pendingMouseEvent);
      this.pendingMouseEvent = null;
    }
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
    const needsAnotherFrame =
      this.dirty ||
      this.pendingMouseEvent !== null ||
      this.drawingPointerActive ||
      this.draggedDrawingId !== null;
    if (needsAnotherFrame) {
      this.scheduleFrame();
    }
  }

  private render() {
    const layout = this.computeLayout();
    const chartAreaWidth = this.width - PRICE_AXIS_WIDTH;

    this.viewport.setRegion(0, layout.mainTop, chartAreaWidth, layout.mainHeight);
    if (this.chartType === 'volume-weighted') {
      this.volumeWeightedRenderer.updateViewportLayout(this.viewport, this.bars);
    } else {
      this.viewport.clearVariableBarLayout();
    }

    // Auto-fit price (skipped if manualYScale)
    if (this.bars.length > 0) {
      this.viewport.fitPriceRange(this.bars);
    }

    // Clear
    this.renderer.clear(this.width, this.height);

    // Clip to chart area for main rendering
    this.renderer.clip(0, 0, chartAreaWidth, layout.mainHeight, () => {
      // Grid lines (behind chart)
      this.scaleY.renderGrid(this.renderer, this.viewport, this.width);
      this.scaleX.renderGrid(this.renderer, this.viewport, this.bars, this.height, this.width);

      // Pre/post-market session background tints (intraday only)
      this.renderSessionHighlights();
      // Purple tint behind off-hours synthetic bars built from quote ticks
      this.renderSyntheticHighlights();

      // Main-chart volume overlays render behind price action
      this.renderMainVolumeOverlays();
      this.renderMainMACDOverlay();
      this.renderMainTechScoreOverlay();

      // Price action
      switch (this.chartType) {
        case 'candlestick':
          this.candlestick.render(this.renderer, this.viewport, this.bars);
          break;
        case 'heikin-ashi':
          this.heikinAshi.render(this.renderer, this.viewport, this.bars);
          break;
        case 'volume-weighted':
          this.volumeWeightedRenderer.render(this.renderer, this.viewport, this.bars);
          break;
        case 'bar':
          this.barRenderer.render(this.renderer, this.viewport, this.bars);
          break;
        case 'line':
          this.lineRenderer.render(this.renderer, this.viewport, this.bars);
          break;
        case 'area':
          this.areaRenderer.render(this.renderer, this.viewport, this.bars);
          break;
      }

      // Overlay indicators
      this.renderOverlays();

      // User drawings
      this.renderDrawings();

      // Branding watermark
      this.renderBranding(chartAreaWidth, layout.mainHeight);
    });

    if (this.liveMode && this.stopperPx > 0 && this.bars.length > 0) {
      const lastIndex = this.bars.length - 1;
      const stopperX = this.viewport.barToPixelX(lastIndex);
      const bottom = this.height - TIME_AXIS_HEIGHT;
      this.renderer.line(stopperX, 0, stopperX, bottom, COLORS.border);
    }

    // Sub-panes (oscillators + scripts)
    for (const pane of layout.subPanes) {
      this.renderSubPane(pane, chartAreaWidth);
    }

    // Axes
    this.scaleY.render(this.renderer, this.viewport, this.width);
    this.scaleX.render(this.renderer, this.viewport, this.bars, this.height, this.width);

    // Manual Y-scale indicator
    if (this.viewport.manualYScale) {
      this.renderer.textSmall('Manual Scale (dbl-click to reset)', chartAreaWidth - 200, layout.mainTop + 12, COLORS.amber, 'left');
    }

    // Sub-pane separators
    for (const pane of layout.subPanes) {
      this.renderer.line(0, pane.top, chartAreaWidth, pane.top, COLORS.border);
    }

    // Last price label on y-axis (persistent, colored by day direction)
    this.renderVisibleRangeExtremeMarkers();
    this.renderLastPriceLabel();

    // Crosshair & tooltip (with indicator labels)
    this.crosshair.render(this.renderer, this.viewport, this.scaleX, this.width, this.height);
    this.tooltip.render(this.renderer, this.viewport, this.crosshair.hit);

    // Sub-pane headers always render last so nothing can overlap them.
    for (const pane of layout.subPanes) {
      this.renderSubPaneHeaderOverlay(pane, chartAreaWidth);
    }
  }

  private renderLastPriceLabel() {
    if (this.bars.length === 0) return;
    const lastBar = this.bars[this.bars.length - 1];
    const lastPrice = lastBar.close;

    const pixelY = this.viewport.priceToPixelY(lastPrice);
    if (pixelY < this.viewport.chartTop || pixelY > this.viewport.chartTop + this.viewport.chartHeight) return;
    const labelY = this.clampMainAxisLabelY(pixelY);
    if (labelY == null) return;

    // Determine day direction: find first bar of the same calendar day as the last bar
    const tf = this.scaleX.timeframe;
    let dayOpen: number;
    if (tf === '1D' || tf === '1W' || tf === '1M') {
      // For daily+ timeframes, compare to the last bar's own open
      dayOpen = lastBar.open;
    } else {
      const lastDate = new Date(lastBar.time);
      const lastDay = `${lastDate.getUTCFullYear()}-${lastDate.getUTCMonth()}-${lastDate.getUTCDate()}`;
      let firstBarOfDay = lastBar;
      for (let i = this.bars.length - 1; i >= 0; i--) {
        const d = new Date(this.bars[i].time);
        const day = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
        if (day !== lastDay) break;
        firstBarOfDay = this.bars[i];
      }
      dayOpen = firstBarOfDay.open;
    }

    const isUp = lastPrice >= dayOpen;
    const boxColor = isUp ? COLORS.green : COLORS.red;
    const priceAxisX = this.width - PRICE_AXIS_WIDTH;

    // Draw a dashed line across the chart area at last price
    this.renderer.dashedLine(this.viewport.chartLeft, pixelY, priceAxisX, pixelY, isUp ? 'rgba(0,200,83,0.35)' : 'rgba(255,61,113,0.35)', 1, [4, 4]);

    // Draw the price box on the y-axis (same layout as crosshair label)
    this.renderer.rect(priceAxisX, labelY - 10, PRICE_AXIS_WIDTH, 20, boxColor);
    this.renderer.text(this.formatAxisPrice(lastPrice), priceAxisX + 6, labelY, '#FFFFFF', 'left');
  }

  private renderVisibleRangeExtremeMarkers() {
    const extremes = this.getVisibleRangeExtremes();
    if (!extremes) return;

    const priceAxisX = this.width - PRICE_AXIS_WIDTH;
    const highPixelY = this.viewport.priceToPixelY(extremes.high.price);
    const lowPixelY = this.viewport.priceToPixelY(extremes.low.price);
    if (
      highPixelY < this.viewport.chartTop ||
      highPixelY > this.viewport.chartTop + this.viewport.chartHeight ||
      lowPixelY < this.viewport.chartTop ||
      lowPixelY > this.viewport.chartTop + this.viewport.chartHeight
    ) {
      return;
    }

    const highBaseLabelY = this.clampMainAxisLabelY(highPixelY);
    const lowBaseLabelY = this.clampMainAxisLabelY(lowPixelY);
    if (highBaseLabelY == null || lowBaseLabelY == null) return;

    const minGap = 22;
    let highLabelY = highBaseLabelY;
    let lowLabelY = lowBaseLabelY;
    if (Math.abs(highLabelY - lowLabelY) < minGap) {
      const midpoint = (highLabelY + lowLabelY) / 2;
      highLabelY = this.clampMainAxisLabelY(midpoint - minGap / 2) ?? highLabelY;
      lowLabelY = this.clampMainAxisLabelY(midpoint + minGap / 2) ?? lowLabelY;
      if (Math.abs(highLabelY - lowLabelY) < minGap) {
        highLabelY = this.clampMainAxisLabelY(highLabelY - minGap / 2) ?? highLabelY;
        lowLabelY = this.clampMainAxisLabelY(highLabelY + minGap) ?? lowLabelY;
      }
    }

    this.renderVisibleExtremeMarker({
      price: extremes.high.price,
      barIndex: extremes.high.index,
      pixelY: highPixelY,
      labelY: highLabelY,
      lineColor: 'rgba(245,158,11,0.78)',
      boxColor: '#31230F',
      textColor: '#FCD34D',
      priceAxisX,
    });
    this.renderVisibleExtremeMarker({
      price: extremes.low.price,
      barIndex: extremes.low.index,
      pixelY: lowPixelY,
      labelY: lowLabelY,
      lineColor: 'rgba(96,165,250,0.78)',
      boxColor: '#10263A',
      textColor: '#BFDBFE',
      priceAxisX,
    });
  }

  private renderVisibleExtremeMarker(params: {
    price: number;
    barIndex: number;
    pixelY: number;
    labelY: number;
    lineColor: string;
    boxColor: string;
    textColor: string;
    priceAxisX: number;
  }) {
    const { price, barIndex, pixelY, labelY, lineColor, boxColor, textColor, priceAxisX } = params;
    const startX = Math.max(this.viewport.chartLeft, Math.min(priceAxisX, this.viewport.barToPixelX(barIndex)));

    this.renderer.dashedLine(startX, pixelY, priceAxisX, pixelY, lineColor, 1, [1, 3]);
    this.renderer.rect(priceAxisX, labelY - 10, PRICE_AXIS_WIDTH, 20, boxColor);
    this.renderer.textSmall(this.formatAxisPrice(price), priceAxisX + 6, labelY, textColor, 'left');
  }

  private getVisibleRangeExtremes(): { high: { price: number; index: number }; low: { price: number; index: number } } | null {
    if (this.bars.length === 0) return null;

    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.startIndex + this.viewport.barsVisible));
    if (start >= end) return null;

    let highPrice = -Infinity;
    let lowPrice = Infinity;
    let highIndex = -1;
    let lowIndex = -1;

    for (let i = start; i < end; i++) {
      const bar = this.bars[i];
      if (!bar) continue;

      if (Number.isFinite(bar.high) && bar.high > highPrice) {
        highPrice = bar.high;
        highIndex = i;
      }
      if (Number.isFinite(bar.low) && bar.low < lowPrice) {
        lowPrice = bar.low;
        lowIndex = i;
      }
    }

    if (!Number.isFinite(highPrice) || !Number.isFinite(lowPrice) || highIndex < 0 || lowIndex < 0) {
      return null;
    }

    return {
      high: { price: highPrice, index: highIndex },
      low: { price: lowPrice, index: lowIndex },
    };
  }

  private clampMainAxisLabelY(pixelY: number): number | null {
    const labelMinY = this.viewport.chartTop + 10;
    const labelMaxY = this.viewport.chartTop + this.viewport.chartHeight - PRICE_AXIS_CONTROL_HEIGHT - 10;
    if (labelMaxY <= labelMinY) return null;
    return Math.min(Math.max(pixelY, labelMinY), labelMaxY);
  }

  private formatAxisPrice(price: number): string {
    if (price >= 10000) return price.toFixed(0);
    return price.toFixed(2);
  }

  private renderSessionHighlights() {
    const tf = this.scaleX.timeframe;
    if (tf === '1D' || tf === '1W' || tf === '1M') return;
    if (this.bars.length === 0) return;

    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));
    if (start >= end) return;

    const chartTop = this.viewport.chartTop;
    const chartHeight = this.viewport.chartHeight;
    const halfBar = this.viewport.barWidth / 2;
    const barDurationMs = getTimeframeMs(tf);

    type Session = 'pre' | 'post' | null;
    let runSession: Session = null;
    let runLeft = 0;

    const flush = (rightX: number) => {
      if (!runSession) return;
      const color = runSession === 'pre' ? COLORS.premarket : COLORS.aftermarket;
      this.renderer.rect(runLeft, chartTop, rightX - runLeft, chartHeight, color);
      runSession = null;
    };

    for (let i = start; i < end; i++) {
      const bar = this.bars[i];
      const session = this.getExtendedSessionForBar(bar.time, barDurationMs);

      const cx = this.viewport.barToPixelX(i);

      if (session !== runSession) {
        flush(cx - halfBar);
        if (session) {
          runLeft = cx - halfBar;
        }
        runSession = session;
      }
    }

    if (runSession) {
      const lastCx = this.viewport.barToPixelX(end - 1);
      flush(lastCx + halfBar);
    }
  }

  private renderSyntheticHighlights() {
    if (this.bars.length === 0) return;
    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));
    if (start >= end) return;

    const chartTop = this.viewport.chartTop;
    const chartHeight = this.viewport.chartHeight;
    const halfBar = this.viewport.barWidth / 2;

    let runLeft = 0;
    let inRun = false;

    const flush = (rightX: number) => {
      if (!inRun) return;
      this.renderer.rect(runLeft, chartTop, rightX - runLeft, chartHeight, COLORS.syntheticBar);
      inRun = false;
    };

    for (let i = start; i < end; i++) {
      const bar = this.bars[i];
      const cx = this.viewport.barToPixelX(i);
      if (bar.synthetic) {
        if (!inRun) {
          runLeft = cx - halfBar;
          inRun = true;
        }
      } else {
        flush(cx - halfBar);
      }
    }

    if (inRun) {
      const lastCx = this.viewport.barToPixelX(end - 1);
      flush(lastCx + halfBar);
    }
  }

  private getExtendedSessionForBar(startTimeMs: number, durationMs: number): 'pre' | 'post' | null {
    const startEt = etDatePartsFromMs(startTimeMs);
    const endEt = etDatePartsFromMs(Math.max(startTimeMs, startTimeMs + Math.max(1, durationMs) - 1));
    if (startEt.year !== endEt.year || startEt.month !== endEt.month || startEt.day !== endEt.day) {
      return null;
    }

    const startMinute = startEt.hour * 60 + startEt.minute;
    const endMinuteExclusive = endEt.hour * 60 + endEt.minute + 1;
    if (startMinute < 570 && endMinuteExclusive > 240) return 'pre';
    if (startMinute < 1200 && endMinuteExclusive > 960) return 'post';
    return null;
  }

  private renderMainVolumeOverlays() {
    for (const ind of this.activeIndicators) {
      if (!ind.visible || ind.paneId !== 'main' || ind.name !== 'Volume') continue;
      this.volumeRenderer.render(this.renderer, this.viewport, this.bars, {
        upColor: COLORS.volumeUp,
        downColor: COLORS.volumeDown,
      });
    }
  }

  private renderMainMACDOverlay() {
    for (const ind of this.activeIndicators) {
      if (!ind.visible || ind.paneId !== 'main' || ind.name !== 'MACD') continue;

      const [macdData, signalData, histData] = ind.data;
      if (!macdData || !signalData || !histData) continue;

      const start = Math.max(0, Math.floor(this.viewport.startIndex));
      const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));

      let min = Infinity;
      let max = -Infinity;
      for (let i = start; i < end; i++) {
        if (!isNaN(macdData[i])) { min = Math.min(min, macdData[i]); max = Math.max(max, macdData[i]); }
        if (!isNaN(signalData[i])) { min = Math.min(min, signalData[i]); max = Math.max(max, signalData[i]); }
        if (!isNaN(histData[i])) { min = Math.min(min, histData[i]); max = Math.max(max, histData[i]); }
      }
      if (!isFinite(min) || !isFinite(max)) continue;

      const paneTop = this.viewport.chartTop + this.viewport.chartHeight * (1 - VOLUME_PANE_RATIO);
      const paneHeight = this.viewport.chartHeight * VOLUME_PANE_RATIO;

      const range = max - min || 1;
      const padding = range * 0.1;
      const effectiveMin = min - padding;
      const effectiveMax = max + padding;
      const effectiveRange = effectiveMax - effectiveMin;

      const toY = (value: number) =>
        paneTop + paneHeight - ((value - effectiveMin) / effectiveRange) * paneHeight;
      const zeroY = toY(0);

      this.renderer.clip(0, paneTop, this.width, paneHeight, () => {
        // Histogram bars
        for (let i = start; i < end; i++) {
          if (i >= histData.length || isNaN(histData[i])) continue;
          const x = this.viewport.barToPixelX(i);
          const barW = Math.max(1, this.viewport.getBarSlotWidth(i) * 0.6);
          const y = toY(histData[i]);
          const color = histData[i] >= 0 ? 'rgba(0,200,83,0.45)' : 'rgba(255,61,113,0.45)';
          this.renderer.rect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(y - zeroY), color);
        }

        // MACD line
        const macdPoints: [number, number][] = [];
        for (let i = start; i < end; i++) {
          if (i >= macdData.length || isNaN(macdData[i])) continue;
          macdPoints.push([this.viewport.barToPixelX(i), toY(macdData[i])]);
        }
        if (macdPoints.length > 1) {
          this.renderer.polyline(macdPoints, ind.colors?.['macd'] ?? '#00C853', 1);
        }

        // Signal line
        const sigPoints: [number, number][] = [];
        for (let i = start; i < end; i++) {
          if (i >= signalData.length || isNaN(signalData[i])) continue;
          sigPoints.push([this.viewport.barToPixelX(i), toY(signalData[i])]);
        }
        if (sigPoints.length > 1) {
          this.renderer.polyline(sigPoints, ind.colors?.['signal'] ?? '#FF3D71', 1);
        }
      });
    }
  }

  private renderMainTechScoreOverlay() {
    for (const ind of this.activeIndicators) {
      if (!ind.visible || ind.paneId !== 'main' || ind.name !== 'Technical Score') continue;

      const scoreData = ind.data[0];
      if (!scoreData) continue;

      const start = Math.max(0, Math.floor(this.viewport.startIndex));
      const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));

      const paneTop = this.viewport.chartTop + this.viewport.chartHeight * 0.82;
      const paneHeight = this.viewport.chartHeight * 0.15;

      const fakePaneLayout = {
        paneId: 'main',
        indicatorIds: [ind.id],
        top: paneTop,
        height: paneHeight,
        yScaleMode: 'auto',
        showScaleControls: true,
        collapsed: false,
        maximized: false,
      } as SubPaneLayout;

      this.renderer.clip(0, paneTop, this.width, paneHeight, () => {
        this.renderTechnicalScoreSeries(scoreData, start, end, fakePaneLayout, 0, 100);
      });
    }
  }

  private computeRightOffsetBars(): number {
    if (!this.liveMode || this.stopperPx <= 0) return 0;
    const barWidth = this.viewport.barWidth;
    if (barWidth <= 0) return 0;
    return Math.round(this.stopperPx / barWidth);
  }

  private renderBranding(chartAreaWidth: number, mainHeight: number) {
    if (this.brandingMode === 'none' || !this.brandingImage?.complete) return;

    const asset = BRANDING_ASSETS[this.brandingMode];
    const intrinsicWidth = this.brandingImage.naturalWidth || this.brandingImage.width;
    const intrinsicHeight = this.brandingImage.naturalHeight || this.brandingImage.height;
    if (!intrinsicWidth || !intrinsicHeight) return;

    const padding = this.brandingMode === 'fullLogo' ? 12 : 8;
    const maxWidth = this.brandingMode === 'fullLogo'
      ? Math.min(140, Math.max(72, chartAreaWidth * 0.14))
      : Math.min(24, Math.max(18, chartAreaWidth * 0.045));
    const width = Math.min(maxWidth, chartAreaWidth - padding * 2);
    const height = width * (intrinsicHeight / intrinsicWidth);
    const maxHeight = Math.max(0, mainHeight - padding * 2);
    if (width <= 0 || height <= 0 || height > maxHeight) return;

    let companyLogoWidth = 0;
    let companyLogoHeight = 0;
    const companyLogoGap = 8;
    if (this.symbolBrandingImage?.complete && this.symbolBrandingImage.naturalWidth > 0) {
      companyLogoWidth = Math.min(width * 0.24, 28);
      companyLogoHeight = companyLogoWidth;
    }

    const totalWidth = width + (companyLogoWidth > 0 ? companyLogoGap + companyLogoWidth : 0);
    const x = chartAreaWidth - padding - totalWidth;
    const y = padding;
    if (companyLogoWidth > 0) {
      const logoY = y + Math.max(0, (height - companyLogoHeight) / 2) - companyLogoHeight * 0.15;
      this.renderer.image(this.symbolBrandingImage!, x, logoY, companyLogoWidth, companyLogoHeight, 0.22);
    }
    const dailyIqX = x + (companyLogoWidth > 0 ? companyLogoWidth + companyLogoGap : 0);
    this.renderer.image(this.brandingImage, dailyIqX, y, width, height, asset.opacity);
  }

  private renderOverlays() {
    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));

    for (const ind of this.activeIndicators) {
      if (
        !ind.visible ||
        ind.paneId !== 'main' ||
        ind.name === 'Volume' ||
        ind.name === 'MACD' ||
        ind.name === 'Technical Score' ||
        isProbEngWidgetIndicator(ind)
      ) continue;
      this.renderIndicatorSeries(
        ind,
        (value) => this.viewport.priceToPixelY(value),
        0,
        this.height - TIME_AXIS_HEIGHT,
        start,
        end,
      );
    }

    // Script overlay plots/shapes
    for (const [, result] of this.scriptResults) {
      for (const plot of result.plots) {
        const points: [number, number][] = [];
        for (let i = start; i < end; i++) {
          if (i < plot.values.length && !isNaN(plot.values[i])) {
            points.push([this.viewport.barToPixelX(i), this.viewport.priceToPixelY(plot.values[i])]);
          }
        }
        if (points.length > 1) {
          const vals = plot.values.filter(v => !isNaN(v));
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          if (avg > this.viewport.priceMin * 0.5 && avg < this.viewport.priceMax * 2) {
            this.renderer.polyline(points, plot.color, plot.lineWidth);
          }
        }
      }

      for (const shape of result.shapes) {
        const direction = shape.text.toUpperCase().includes('BUY') ? 'up' : 'down';
        for (let i = start; i < end; i += 1) {
          if (i >= shape.values.length || isNaN(shape.values[i])) continue;
          const x = this.viewport.barToPixelX(i);
          const y = this.viewport.priceToPixelY(shape.values[i]);
          if (y < this.viewport.chartTop - 32 || y > this.viewport.chartTop + this.viewport.chartHeight + 32) continue;
          this.renderSignalMarker(x, y, shape.text, shape.color, direction);
        }
      }
    }
  }

  private renderDrawings() {
    for (const drawing of this.drawings) {
      this.renderDrawing(drawing, false);
    }

    if (this.drawingStart && this.drawingCurrent && this.activeDrawingTool !== 'none') {
      const draft: DrawingShape = this.activeDrawingTool === 'trendline'
        ? {
            id: '__draft__',
            type: 'trendline',
            start: this.drawingStart,
            end: this.drawingCurrent,
            locked: false,
          }
        : this.activeDrawingTool === 'fibRetracement'
          ? {
              id: '__draft__',
              type: 'fibRetracement',
              start: this.drawingStart,
              end: this.drawingCurrent,
              locked: false,
            }
          : this.activeDrawingTool === 'brush'
            ? {
                id: '__draft__',
                type: 'brush',
                points: this.drawingBrushPoints.length > 0 ? this.drawingBrushPoints : [this.drawingStart, this.drawingCurrent],
                locked: false,
              }
            : {
                id: '__draft__',
                type: 'text',
                anchor: this.drawingStart,
                text: 'Text',
                locked: false,
              };
      this.renderDrawing(draft, true);
    }
  }

  private renderDrawing(drawing: DrawingShape, isDraft: boolean) {
    const isSelected = !isDraft && drawing.id === this.selectedDrawingId;
    const isHovered = !isDraft && drawing.id === this.hoveredDrawingId && drawing.id !== this.draggedDrawingId;
    const isDragged = !isDraft && drawing.id === this.draggedDrawingId;
    const isActive = isHovered || isDragged;
    const baseColor = drawing.color || '#60A5FA';
    const lineAccent = isDraft ? 'rgba(96,165,250,0.7)' : isSelected ? '#F59E0B' : isActive ? '#93C5FD' : baseColor;

    if (drawing.type === 'trendline') {
      const x1 = this.viewport.barToPixelX(drawing.start.barIndex);
      const y1 = this.viewport.priceToPixelY(drawing.start.price);
      const x2 = this.viewport.barToPixelX(drawing.end.barIndex);
      const y2 = this.viewport.priceToPixelY(drawing.end.price);
      const lineWidth = isActive ? 2.5 : 2;
      if (isDraft) {
        this.renderer.dashedLine(x1, y1, x2, y2, lineAccent, 1.5, [6, 4]);
      } else {
        const ext = this.extendLineToChartBounds(x1, y1, x2, y2);
        if (ext) {
          this.renderer.dashedLine(ext[0], ext[1], ext[2], ext[3], lineAccent, lineWidth * 0.65, [4, 4]);
        }
        this.renderer.line(x1, y1, x2, y2, lineAccent, lineWidth);
      }
      const handleSize = isActive ? 5 : 3;
      this.renderer.rect(x1 - handleSize, y1 - handleSize, handleSize * 2, handleSize * 2, lineAccent);
      this.renderer.rect(x2 - handleSize, y2 - handleSize, handleSize * 2, handleSize * 2, lineAccent);
      if (drawing.locked && !isDraft) {
        this.renderer.textSmall('L', x2 + 8, y2, '#F59E0B', 'center');
      }
      return;
    }

    if (drawing.type === 'brush') {
      const points = drawing.points.map((point) => {
        const pixel = this.anchorToCanvasPoint(point);
        return [pixel.x, pixel.y] as [number, number];
      });
      if (isDraft) {
        this.renderer.dashedPolyline(points, lineAccent, 1.75, [5, 4]);
      } else {
        this.renderer.polyline(points, lineAccent, 2);
      }
      if (points.length > 0) {
        const [x, y] = points[points.length - 1];
        this.renderer.rect(x - 2, y - 2, 4, 4, lineAccent);
        if (drawing.locked && !isDraft) {
          this.renderer.textSmall('L', x + 8, y, '#F59E0B', 'center');
        }
      }
      return;
    }

    if (drawing.type === 'text') {
      const { x, y } = this.anchorToCanvasPoint(drawing.anchor);
      this.ctx.save();
      this.ctx.font = FONT_MONO_SMALL;
      const width = Math.max(28, this.ctx.measureText(drawing.text).width + 10);
      this.ctx.restore();
      const height = 20;
      const border = isDraft ? 'rgba(96,165,250,0.7)' : isSelected ? '#F59E0B' : '#60A5FA';
      const fill = isDraft ? 'rgba(96,165,250,0.14)' : 'rgba(13,17,23,0.88)';
      this.renderer.rect(x, y - height / 2, width, height, fill);
      this.renderer.rectStroke(x, y - height / 2, width, height, border, 1);
      this.renderer.textSmall(drawing.text, x + 5, y, drawing.locked && !isDraft ? '#FCD34D' : '#E6EDF3', 'left');
      if (drawing.locked && !isDraft) {
        this.renderer.textSmall('L', x + width - 7, y, '#F59E0B', 'center');
      }
      return;
    }

    const startX = this.viewport.barToPixelX(drawing.start.barIndex);
    const endX = this.viewport.barToPixelX(drawing.end.barIndex);
    const left = Math.min(startX, endX);
    const high = Math.max(drawing.start.price, drawing.end.price);
    const low = Math.min(drawing.start.price, drawing.end.price);
    const range = high - low || 1;
    const x2 = this.width - PRICE_AXIS_WIDTH;
    // Level line colors: grey, blue, green, light-green, orange, red, grey
    const levelColors: [number, string][] = [
      [0,     '#9CA3AF'],
      [0.236, '#1A56DB'],
      [0.382, '#00C853'],
      [0.5,   '#4ADE80'],
      [0.618, '#F59E0B'],
      [0.786, '#FF3D71'],
      [1,     '#9CA3AF'],
    ];

    // Draw per-zone fills — each band filled with the upper level's color
    for (let i = 0; i < levelColors.length - 1; i++) {
      const [topLevel, zoneColor] = levelColors[i];
      const [bottomLevel] = levelColors[i + 1];
      const priceTop = high - range * topLevel;
      const priceBot = high - range * bottomLevel;
      const yTop = this.viewport.priceToPixelY(priceTop);
      const yBot = this.viewport.priceToPixelY(priceBot);
      const hr = parseInt(zoneColor.slice(1, 3), 16);
      const hg = parseInt(zoneColor.slice(3, 5), 16);
      const hb = parseInt(zoneColor.slice(5, 7), 16);
      const alpha = isDraft ? 0.06 : isActive ? 0.18 : 0.12;
      this.renderer.rect(left, Math.min(yTop, yBot), Math.max(2, x2 - left), Math.abs(yBot - yTop), `rgba(${hr},${hg},${hb},${alpha})`);
    }

    for (const [level, hex] of levelColors) {
      const price = high - range * level;
      const y = this.viewport.priceToPixelY(price);
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const lineColor = isDraft ? `rgba(${r},${g},${b},0.5)` : hex;
      const lw = level === 0 || level === 1 ? 1.25 : 1;
      if (isDraft) {
        this.renderer.dashedLine(left, y, x2, y, lineColor, lw, [4, 4]);
      } else {
        this.renderer.line(left, y, x2, y, lineColor, isActive ? lw + 0.75 : lw);
      }
      this.renderer.textSmall(level.toFixed(3), x2 - 6, y - 8, lineColor, 'right');
    }
    // Anchor handles for fib when hovered/dragged
    if (isActive) {
      const sx = this.viewport.barToPixelX(drawing.start.barIndex);
      const sy = this.viewport.priceToPixelY(drawing.start.price);
      const ex = this.viewport.barToPixelX(drawing.end.barIndex);
      const ey = this.viewport.priceToPixelY(drawing.end.price);
      this.renderer.rect(sx - 5, sy - 5, 10, 10, '#9CA3AF');
      this.renderer.rect(ex - 5, ey - 5, 10, 10, '#9CA3AF');
    }
  }

  private getCanvasPoint(e: MouseEvent): { mx: number; my: number; rect: DOMRect } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.width;
    const scaleY = rect.height / this.height;
    return {
      mx: (e.clientX - rect.left) / scaleX,
      my: (e.clientY - rect.top) / scaleY,
      rect,
    };
  }

  private isInMainChart(mx: number, my: number): boolean {
    const chartAreaWidth = this.width - PRICE_AXIS_WIDTH;
    const chartAreaHeight = this.height - TIME_AXIS_HEIGHT;
    return mx >= 0 && mx <= chartAreaWidth && my >= 0 && my <= chartAreaHeight;
  }

  private anchorFromMouse(mx: number, my: number): DrawingAnchor {
    const snappedBarIndex = Math.max(0, Math.min(this.bars.length - 1, Math.round(this.viewport.pixelXToBar(mx))));
    return {
      barIndex: snappedBarIndex,
      price: this.viewport.pixelYToPrice(my),
    };
  }

  private distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  private extendLineToChartBounds(x1: number, y1: number, x2: number, y2: number): [number, number, number, number] | null {
    const left = this.viewport.chartLeft;
    const right = this.width - PRICE_AXIS_WIDTH;
    const top = this.viewport.chartTop;
    const bottom = this.viewport.chartTop + this.viewport.chartHeight;

    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return null;

    let tMin = -1e6;
    let tMax = 1e6;

    if (dx !== 0) {
      const t1 = (left - x1) / dx;
      const t2 = (right - x1) / dx;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
    } else if (x1 < left || x1 > right) {
      return null;
    }

    if (dy !== 0) {
      const t1 = (top - y1) / dy;
      const t2 = (bottom - y1) / dy;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
    } else if (y1 < top || y1 > bottom) {
      return null;
    }

    if (tMin >= tMax) return null;
    return [x1 + dx * tMin, y1 + dy * tMin, x1 + dx * tMax, y1 + dy * tMax];
  }

  private isNearDrawing(drawing: DrawingShape, mx: number, my: number): boolean {
    if (drawing.type === 'trendline') {
      const x1 = this.viewport.barToPixelX(drawing.start.barIndex);
      const y1 = this.viewport.priceToPixelY(drawing.start.price);
      const x2 = this.viewport.barToPixelX(drawing.end.barIndex);
      const y2 = this.viewport.priceToPixelY(drawing.end.price);
      const ext = this.extendLineToChartBounds(x1, y1, x2, y2);
      if (ext) return this.distToSegment(mx, my, ext[0], ext[1], ext[2], ext[3]) < 8;
      return this.distToSegment(mx, my, x1, y1, x2, y2) < 8;
    }
    if (drawing.type === 'brush') {
      const points = drawing.points.map((point) => this.anchorToCanvasPoint(point));
      if (points.length === 1) {
        return Math.hypot(mx - points[0].x, my - points[0].y) < 8;
      }
      for (let i = 1; i < points.length; i++) {
        if (this.distToSegment(mx, my, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y) < 8) {
          return true;
        }
      }
      return false;
    }
    if (drawing.type === 'text') {
      const { x, y } = this.anchorToCanvasPoint(drawing.anchor);
      this.ctx.save();
      this.ctx.font = FONT_MONO_SMALL;
      const width = Math.max(28, this.ctx.measureText(drawing.text).width + 10);
      this.ctx.restore();
      const height = 20;
      return mx >= x && mx <= x + width && my >= y - height / 2 && my <= y + height / 2;
    }
    // fibRetracement
    const startX = this.viewport.barToPixelX(drawing.start.barIndex);
    const endX = this.viewport.barToPixelX(drawing.end.barIndex);
    const left = Math.min(startX, endX);
    const high = Math.max(drawing.start.price, drawing.end.price);
    const low = Math.min(drawing.start.price, drawing.end.price);
    const topY = this.viewport.priceToPixelY(high);
    const bottomY = this.viewport.priceToPixelY(low);
    const x2 = this.width - PRICE_AXIS_WIDTH;
    return mx >= left && mx <= x2 && my >= Math.min(topY, bottomY) && my <= Math.max(topY, bottomY);
  }

  private hitTestDrawing(mx: number, my: number): DrawingShape | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      if (this.isNearDrawing(this.drawings[i], mx, my)) return this.drawings[i];
    }
    return null;
  }

  private hitTestDrawingEndpoint(
    mx: number,
    my: number,
  ): { drawing: Extract<DrawingShape, { start: DrawingAnchor; end: DrawingAnchor }>; endpoint: 'start' | 'end' } | null {
    const HANDLE_RADIUS = 10;
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d.type !== 'trendline' && d.type !== 'fibRetracement') continue;
      const sx = this.viewport.barToPixelX(d.start.barIndex);
      const sy = this.viewport.priceToPixelY(d.start.price);
      const ex = this.viewport.barToPixelX(d.end.barIndex);
      const ey = this.viewport.priceToPixelY(d.end.price);
      if (Math.hypot(mx - sx, my - sy) <= HANDLE_RADIUS) return { drawing: d, endpoint: 'start' };
      if (Math.hypot(mx - ex, my - ey) <= HANDLE_RADIUS) return { drawing: d, endpoint: 'end' };
    }
    return null;
  }

  getHoveredDrawingId(): string | null {
    return this.hoveredDrawingId;
  }

  private createDrawingSelection(drawing: DrawingShape): DrawingSelection {
    return {
      id: drawing.id,
      type: drawing.type,
      locked: drawing.locked,
    };
  }

  private notifyDrawingSelectionChange() {
    if (!this._onDrawingSelectionChange) return;
    const selection = this.selectedDrawingId
      ? this.drawings.find((item) => item.id === this.selectedDrawingId) ?? null
      : null;
    this._onDrawingSelectionChange(selection ? this.createDrawingSelection(selection) : null);
  }

  private setSelectedDrawingId(id: string | null) {
    if (this.selectedDrawingId === id) return;
    this.selectedDrawingId = id;
    this.notifyDrawingSelectionChange();
  }

  private translateAnchor(anchor: DrawingAnchor, dBar: number, dPrice: number): DrawingAnchor {
    return {
      barIndex: Math.max(0, Math.min(this.bars.length - 1, anchor.barIndex + dBar)),
      price: anchor.price + dPrice,
    };
  }

  private cancelDraftDrawing() {
    this.drawingStart = null;
    this.drawingCurrent = null;
    this.drawingBrushPoints = [];
    this.drawingPointerActive = false;
  }

  private renderSubPane(pane: SubPaneLayout, chartAreaWidth: number) {
    // Background
    this.renderer.rect(0, pane.top, chartAreaWidth, pane.height, COLORS.bgBase);

    // Script sub-pane
    if (pane.paneId.startsWith('__script_')) {
      const scriptId = pane.paneId.replace('__script_', '').replace('__', '');
      const result = this.scriptResults.get(scriptId);
      if (result) {
        this.renderScriptSubPane(pane, chartAreaWidth, result, scriptId);
      }
      return;
    }

    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));
    const indicators = pane.indicatorIds
      .map((indicatorId) => this.activeIndicators.find((indicator) => indicator.id === indicatorId))
      .filter((indicator): indicator is ActiveIndicator => !!indicator);
    if (indicators.length === 0) return;

    const volumeIndicators = indicators.filter((indicator) => indicator.name === 'Volume');

    if (volumeIndicators.length > 0) {
      this.renderer.clip(0, pane.top, chartAreaWidth, pane.height, () => {
        this.volumeRenderer.render(this.renderer, this.viewport, this.bars, {
          top: pane.top,
          height: pane.height,
          upColor: 'rgba(0,200,83,0.45)',
          downColor: 'rgba(255,61,113,0.45)',
          widthRatio: 0.82,
        });
      });
    }

    const ranges = this.getSubPaneRanges(pane, start, end);

    if (ranges.length === 0) return;

    const panePresentation = this.getSubPanePresentation(pane.indicatorIds);
    const primary = ranges[0];
    const primaryMin = panePresentation.min ?? primary.min;
    const primaryMax = panePresentation.max ?? primary.max;
    const paneScaleMode = this.subPaneScaleModes.get(pane.paneId) ?? 'auto';
    this.scaleY.renderSubPane(
      this.renderer,
      pane.top,
      pane.height,
      primaryMin,
      primaryMax,
      this.width,
      paneScaleMode,
      pane.height > 24,
      pane.showScaleControls && pane.height > 24,
    );

    const makeValueToY = (min: number, max: number) => {
      if (paneScaleMode === 'log' && min > 0 && max > 0) {
        const logMin = Math.log10(min);
        const logMax = Math.log10(max);
        const logRange = logMax - logMin || 1;
        return (value: number) => value > 0
          ? pane.top + ((logMax - Math.log10(value)) / logRange) * pane.height
          : pane.top + pane.height;
      }
      const range = max - min || 1;
      return (value: number) => pane.top + ((max - value) / range) * pane.height;
    };

    this.renderer.clip(0, pane.top, chartAreaWidth, pane.height, () => {
      if (ranges.length === 1) {
        const [{ ind, meta, min, max }] = ranges;
        const effectiveMin = panePresentation.min ?? min;
        const effectiveMax = panePresentation.max ?? max;
        const range = effectiveMax - effectiveMin || 1;
        const isTechnicalScore = ind.name === 'Technical Score';

        if (isTechnicalScore) {
          for (const level of [30, 50, 70]) {
            const y = pane.top + ((effectiveMax - level) / (effectiveMax - effectiveMin)) * pane.height;
            this.renderer.dashedLine(0, y, chartAreaWidth, y, level === 50 ? COLORS.textMuted : COLORS.border, 1, [4, 4]);
          }
        } else if (meta.guideLines?.length) {
          for (const guideLine of meta.guideLines) {
            const y = pane.top + ((effectiveMax - guideLine.value) / range) * pane.height;
            if (guideLine.style === 'solid') {
              this.renderer.line(0, y, chartAreaWidth, y, guideLine.color ?? COLORS.border, 1);
            } else {
              this.renderer.dashedLine(0, y, chartAreaWidth, y, guideLine.color ?? COLORS.border, 1, [4, 4]);
            }
          }
        }
      }

      for (const { ind, min, max } of ranges) {
        const effectiveMin = panePresentation.min ?? min;
        const effectiveMax = panePresentation.max ?? max;
        const valueToY = makeValueToY(effectiveMin, effectiveMax);
        this.renderIndicatorSeries(
          ind,
          valueToY,
          pane.top,
          pane.top + pane.height,
          start,
          end,
          pane,
          effectiveMin,
          effectiveMax,
        );
      }
    });

  }

  private renderSubPaneHeaderOverlay(pane: SubPaneLayout, chartAreaWidth: number) {
    if (pane.paneId.startsWith('__script_')) return;

    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));
    const ranges = this.getSubPaneRanges(pane, start, end);
    if (ranges.length === 0) return;

    this.renderSubPaneHeader(pane, ranges, start, end, chartAreaWidth);
  }

  private renderSubPaneHeader(
    pane: SubPaneLayout,
    ranges: Array<{ ind: ActiveIndicator; meta: typeof indicatorRegistry[string]; min: number; max: number }>,
    start: number,
    end: number,
    chartAreaWidth: number,
  ) {
    if (pane.height <= 18 || ranges.length === 0) return;

    const hoverIndex = this.crosshair.hit?.inChart ? this.crosshair.hit.barIndex : null;
    const fallbackIndex = Math.max(start, end - 1);
    const barIndex = Math.max(0, Math.min(this.bars.length - 1, hoverIndex ?? fallbackIndex));

    const lines = ranges
      .map(({ ind, meta }) => {
        const segments: Array<{ text: string; color: string }> = [
          { text: meta.shortName, color: COLORS.textPrimary },
        ];

        for (let outputIndex = 0; outputIndex < meta.outputs.length; outputIndex += 1) {
          const output = meta.outputs[outputIndex];
          const series = ind.data[outputIndex];
          if (!output || !series || barIndex >= series.length) continue;
          const value = series[barIndex];
          if (!Number.isFinite(value)) continue;
          const valueColor = ind.name === 'Technical Score' && output.key === 'score'
            ? this.technicalScoreStrokeColor(value)
            : ind.name === 'MACD' && output.key === 'histogram'
              ? (value >= 0 ? '#00C853' : '#FF3D71')
              : (ind.colors?.[output.key] ?? output.color);

          const prefix = output.label ? ` ${output.label} ` : ' ';
          segments.push({ text: prefix, color: COLORS.textMuted });
          segments.push({
            text: this.formatIndicatorValue(value),
            color: valueColor,
          });
        }

        return segments;
      })
      .filter((segments) => segments.length > 0);

    if (lines.length === 0) return;

    this.ctx.save();
    this.ctx.font = FONT_MONO_SMALL;

    const lineHeight = 12;
    const contentWidth = Math.max(
      ...lines.map((segments) =>
        segments.reduce((sum, segment) => sum + this.ctx.measureText(segment.text).width, 0),
      ),
    );
    const contentHeight = lines.length * lineHeight;
    const boxX = 4;
    const boxY = pane.top + 4;
    const boxWidth = Math.min(chartAreaWidth - 8, Math.ceil(contentWidth) + 12);
    const boxHeight = Math.min(pane.height - 8, contentHeight + 8);
    const boxFill = '#000000';

    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    this.ctx.shadowBlur = 10;
    this.ctx.shadowOffsetY = 3;
    this.renderer.rect(boxX, boxY, boxWidth, boxHeight, boxFill);
    this.ctx.restore();

    this.renderer.rectStroke(boxX, boxY, boxWidth, boxHeight, 'rgba(255,255,255,0.08)');

    let lineY = boxY + (boxHeight - contentHeight) / 2 + lineHeight / 2;
    for (const segments of lines) {
      let textX = boxX + 6;
      for (const segment of segments) {
        this.renderer.textSmall(segment.text, textX, lineY, segment.color, 'left');
        textX += this.ctx.measureText(segment.text).width;
      }
      lineY += lineHeight;
      if (lineY > boxY + boxHeight - 4) break;
    }
  }

  private formatIndicatorValue(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 10000) return value.toFixed(0);
    if (abs >= 100) return value.toFixed(2);
    if (abs >= 1) return value.toFixed(2);
    if (abs >= 0.01) return value.toFixed(4);
    return value.toFixed(6);
  }

  private getSubPaneRanges(
    pane: SubPaneLayout,
    start: number,
    end: number,
  ): Array<{ ind: ActiveIndicator; meta: typeof indicatorRegistry[string]; min: number; max: number }> {
    const indicators = pane.indicatorIds
      .map((indicatorId) => this.activeIndicators.find((indicator) => indicator.id === indicatorId))
      .filter((indicator): indicator is ActiveIndicator => !!indicator);
    const nonVolumeIndicators = indicators.filter((indicator) => indicator.name !== 'Volume');

    return nonVolumeIndicators
      .map((ind) => {
        const meta = indicatorRegistry[ind.name];
        if (!meta) return null;
        if (ind.name === 'Technical Score' || ind.name === 'RSI') {
          return { ind, meta, min: 0, max: 100 };
        }
        if (ind.name === 'Volume Profile') {
          const prices = ind.data[0] ?? [];
          let min = Infinity;
          let max = -Infinity;
          for (let i = 0; i < prices.length; i++) {
            if (!isNaN(prices[i])) {
              if (prices[i] < min) min = prices[i];
              if (prices[i] > max) max = prices[i];
            }
          }
          if (!isFinite(min) || !isFinite(max)) {
            min = 0;
            max = 100;
          } else {
            const pad = (max - min) * 0.05 || 1;
            min -= pad;
            max += pad;
          }
          return { ind, meta, min, max };
        }

        let min = Infinity;
        let max = -Infinity;
        for (const series of ind.data) {
          for (let i = start; i < end; i++) {
            if (i < series.length && !isNaN(series[i])) {
              if (series[i] < min) min = series[i];
              if (series[i] > max) max = series[i];
            }
          }
        }

        if (ind.name === 'Volume') {
          min = 0;
          max = Math.max(max, 1) * 1.1;
        } else if (!isFinite(min) || !isFinite(max)) {
          min = 0;
          max = 100;
        } else {
          const pad = (max - min) * 0.1 || 1;
          min -= pad;
          max += pad;
        }
        return { ind, meta, min, max };
      })
      .filter((entry): entry is { ind: ActiveIndicator; meta: typeof indicatorRegistry[string]; min: number; max: number } => !!entry);
  }

  private renderIndicatorSeries(
    ind: ActiveIndicator,
    toY: (value: number) => number,
    clipTop: number,
    clipBottom: number,
    start: number,
    end: number,
    pane?: SubPaneLayout,
    min?: number,
    max?: number,
  ) {
    const meta = indicatorRegistry[ind.name];
    if (!meta || isProbEngWidgetIndicator(ind)) return;

    if (ind.name === 'Volume Profile') {
      this.renderVolumeProfile(ind, toY, clipTop, clipBottom);
      return;
    }

    if (ind.name === 'Liquidity Sweep (ICT/SMC)') {
      this.renderLiquiditySweepIctSmc(ind, toY, clipTop, clipBottom);
      return;
    }
    if (ind.name === 'Liquidity Sweep Signal') {
      this.renderLiquiditySweepBox(ind, toY, clipTop, clipBottom);
    }
    if (ind.name === 'FVG Momentum' || ind.name === 'FVG') {
      this.renderFvgBoxes(ind, toY, clipTop, clipBottom);
    }

    for (let oi = 0; oi < ind.data.length; oi++) {
      const series = ind.data[oi];
      const output = meta.outputs[oi];
      if (!output || !series) continue;

      const drawColor = ind.colors?.[output.key] ?? output.color;

      if (output.style === 'fill' && oi + 1 < ind.data.length) {
        const nextSeries = ind.data[oi + 1];
        const fillPoints: [number, number][] = [];
        const fillPoints2: [number, number][] = [];
        for (let i = start; i < end; i++) {
          if (i >= series.length || i >= nextSeries.length || isNaN(series[i]) || isNaN(nextSeries[i])) continue;
          const x = this.viewport.barToPixelX(i);
          fillPoints.push([x, toY(series[i])]);
          fillPoints2.push([x, toY(nextSeries[i])]);
        }
        if (fillPoints.length > 1) {
          const alpha = ind.name === 'Gap Zones' ? 0.28 : 0.12;
          this.renderer.fillArea([...fillPoints, ...fillPoints2.reverse()], this.withAlpha(drawColor, alpha));
        }
      }

      if (output.style === 'dots') {
        for (let i = start; i < end; i++) {
          if (i >= series.length || isNaN(series[i])) continue;
          const x = this.viewport.barToPixelX(i);
          const y = toY(series[i]);
          if (y < clipTop || y > clipBottom) continue;
          this.renderer.rect(x - 2, y - 2, 4, 4, drawColor);
        }
        continue;
      }

      if (output.style === 'markers') {
        const direction = output.key.toLowerCase().includes('buy') ? 'up' : 'down';
        for (let i = start; i < end; i++) {
          if (i >= series.length || isNaN(series[i])) continue;
          const x = this.viewport.barToPixelX(i);
          const y = toY(series[i]);
          if (y < clipTop - 20 || y > clipBottom + 20) continue;
          this.renderSignalMarker(x, y, output.label, drawColor, direction);
        }
        continue;
      }

      if (output.style === 'histogram') {
        if (ind.name === 'Volume') {
          continue;
        }
        const isMACDHistogram = ind.name === 'MACD' && output.key === 'histogram';
        const zeroY = toY(0);
        for (let i = start; i < end; i++) {
          if (i >= series.length || isNaN(series[i])) continue;
          const x = this.viewport.barToPixelX(i);
          const barW = Math.max(1, Math.min(this.viewport.getBarSlotWidth(i) * 0.6, this.viewport.getBarSlotWidth(i) - 1));
          const y = toY(series[i]);
          const barColor = isMACDHistogram
            ? (series[i] >= 0 ? '#00C853' : '#FF3D71')
            : drawColor;
          this.renderer.rect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(y - zeroY), barColor);
        }
        continue;
      }

      if (ind.name === 'Technical Score' && output.key === 'score' && pane && min != null && max != null) {
        this.renderTechnicalScoreSeries(series, start, end, pane, min, max);
        continue;
      }

      const points: [number, number][] = [];
      for (let i = start; i < end; i++) {
        if (i >= series.length || isNaN(series[i])) continue;
        points.push([this.viewport.barToPixelX(i), toY(series[i])]);
      }
      if (points.length > 1) {
        const lw = ind.lineWidths?.[output.key] ?? output.lineWidth ?? 1.5;
        const ls = ind.lineStyles?.[output.key] ?? 'solid';
        if (ls === 'dashed') {
          this.renderer.dashedPolyline(points, drawColor, lw, [6, 4]);
        } else if (ls === 'dotted') {
          this.renderer.dashedPolyline(points, drawColor, lw, [2, 3]);
        } else {
          this.renderer.polyline(points, drawColor, lw);
        }
      }
    }
  }

  private renderVolumeProfile(
    ind: ActiveIndicator,
    toY: (value: number) => number,
    clipTop: number,
    clipBottom: number,
  ) {
    const prices = ind.data[0] ?? [];
    const volumes = ind.data[1] ?? [];
    const bins = Math.min(prices.length, volumes.length);
    if (bins === 0) return;

    let maxVolume = 0;
    for (let i = 0; i < bins; i++) {
      if (!isNaN(volumes[i]) && volumes[i] > maxVolume) maxVolume = volumes[i];
    }
    if (!(maxVolume > 0)) return;

    const chartAreaWidth = this.width - PRICE_AXIS_WIDTH;
    const rightX = chartAreaWidth - 8;
    const maxProfileWidth = Math.max(24, Math.min(chartAreaWidth * 0.28, 140));
    const drawColor = ind.colors?.volumes ?? indicatorRegistry[ind.name].outputs[1]?.color ?? COLORS.blue;
    const binHeight = Math.max(2, Math.floor((clipBottom - clipTop) / Math.max(bins, 1) * 0.9));

    for (let i = 0; i < bins; i++) {
      const price = prices[i];
      const volume = volumes[i];
      if (isNaN(price) || isNaN(volume) || volume <= 0) continue;

      const y = toY(price);
      if (y < clipTop - binHeight || y > clipBottom + binHeight) continue;

      const width = Math.max(1, (volume / maxVolume) * maxProfileWidth);
      this.renderer.rect(rightX - width, y - binHeight / 2, width, binHeight, drawColor);
    }
  }

  private estimateLiquidityTickSize(): number {
    let best = Infinity;
    const consider = (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const rounded = Math.round(value * 1e8) / 1e8;
      if (rounded > 0) best = Math.min(best, rounded);
    };

    for (let i = 1; i < this.bars.length; i += 1) {
      consider(Math.abs(this.bars[i].open - this.bars[i - 1].open));
      consider(Math.abs(this.bars[i].high - this.bars[i - 1].high));
      consider(Math.abs(this.bars[i].low - this.bars[i - 1].low));
      consider(Math.abs(this.bars[i].close - this.bars[i - 1].close));
      consider(Math.abs(this.bars[i].high - this.bars[i].low));
    }

    if (best !== Infinity) return best;
    const fallback = Math.abs((this.bars[0]?.close ?? 0) / 10000);
    return fallback > 0 ? fallback : 0.01;
  }

  private getCurrentDayStartIndex(): number {
    if (this.bars.length === 0) return 0;
    const lastTime = this.bars[this.bars.length - 1].time;
    let start = this.bars.length - 1;
    while (start > 0 && sameUtcDay(this.bars[start - 1].time, lastTime)) {
      start -= 1;
    }
    return start;
  }

  private liquiditySourceName(code: number, isBull: boolean): string {
    if (code === 1) return isBull ? 'DL' : 'DH';
    if (code === 2) return isBull ? 'PDL' : 'PDH';
    if (code === 3) return isBull ? 'PWL' : 'PWH';
    if (code === 4) return isBull ? 'PML' : 'PMH';
    return isBull ? 'DL' : 'DH';
  }

  private drawLiquidityTextBox(
    lines: string[],
    x: number,
    y: number,
    bgColor: string,
    textColor: string,
    clipTop: number,
    clipBottom: number,
  ): { left: number; top: number; right: number; bottom: number } | null {
    const rect = this.measureLiquidityTextBox(lines, x, y, clipTop, clipBottom);
    if (!rect) return null;
    const paddingX = 8;
    const lineHeight = 13;
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    this.renderer.rect(rect.left, rect.top, width, height, this.withAlpha(bgColor, 0.88));
    this.renderer.rectStroke(rect.left, rect.top, width, height, this.withAlpha(bgColor, 1), 1);
    this.renderer.textBlock(lines, rect.left + paddingX, rect.top + (height / 2), textColor, 'left', FONT_MONO_SMALL, lineHeight);
    return rect;
  }

  private measureLiquidityTextBox(
    lines: string[],
    x: number,
    y: number,
    clipTop: number,
    clipBottom: number,
  ): { left: number; top: number; right: number; bottom: number } | null {
    if (lines.length === 0) return null;
    const paddingX = 8;
    const paddingY = 6;
    const lineHeight = 13;
    const width = lines.reduce((max, line) => Math.max(max, this.renderer.measureText(line, FONT_MONO_SMALL).width), 0) + paddingX * 2;
    const height = (lines.length * lineHeight) + paddingY * 2;
    const chartLeft = this.viewport.chartLeft + 4;
    const chartRight = this.viewport.chartLeft + this.viewport.chartWidth - 4;
    const left = Math.min(Math.max(x, chartLeft), Math.max(chartLeft, chartRight - width));
    const top = Math.min(Math.max(y - height / 2, clipTop), Math.max(clipTop, clipBottom - height));
    return { left, top, right: left + width, bottom: top + height };
  }

  private boxesOverlap(
    a: { left: number; top: number; right: number; bottom: number } | null,
    b: { left: number; top: number; right: number; bottom: number } | null,
  ): boolean {
    if (!a || !b) return false;
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }

  private shiftLiquidityBoxY(
    desiredY: number,
    lines: string[],
    x: number,
    clipTop: number,
    clipBottom: number,
    avoid: { left: number; top: number; right: number; bottom: number } | null,
    preferBelow: boolean,
  ): number {
    if (!avoid || lines.length === 0) return desiredY;

    const current = this.measureLiquidityTextBox(lines, x, desiredY, clipTop, clipBottom);
    if (!current) return desiredY;
    if (!this.boxesOverlap(current, avoid)) return desiredY;

    const gap = 8;
    const height = current.bottom - current.top;
    const belowCenter = avoid.bottom + gap + (height / 2);
    const aboveCenter = avoid.top - gap - (height / 2);
    const candidates = preferBelow ? [belowCenter, aboveCenter] : [aboveCenter, belowCenter];

    for (const candidate of candidates) {
      const shifted = this.measureLiquidityTextBox(lines, x, candidate, clipTop, clipBottom);
      if (!shifted) continue;
      if (!this.boxesOverlap(shifted, avoid)) {
        return (shifted.top + shifted.bottom) / 2;
      }
    }

    return desiredY;
  }

  private renderLiquiditySweepIctSmc(
    ind: ActiveIndicator,
    toY: (value: number) => number,
    clipTop: number,
    clipBottom: number,
  ) {
    if (this.bars.length === 0) return;

    const currentDayStart = this.getCurrentDayStartIndex();
    const tickSize = this.estimateLiquidityTickSize();
    const textColor = '#111827';

    const buy = ind.data[8] ?? [];
    const sell = ind.data[9] ?? [];
    const bullTop = ind.data[10] ?? [];
    const bullBottom = ind.data[11] ?? [];
    const bearTop = ind.data[12] ?? [];
    const bearBottom = ind.data[13] ?? [];
    const bullSourceCode = ind.data[14] ?? [];
    const bearSourceCode = ind.data[15] ?? [];

    const showSweepLabel = (ind.params.liqShowSweepLabel ?? 1) >= 0.5;
    const showAction = (ind.params.liqShowAction ?? 1) >= 0.5;
    const showRange = (ind.params.liqShowRange ?? 1) >= 0.5;
    const extendBars = Math.max(10, Math.round(ind.params.liqExtend ?? 120));
    const labelXBars = Math.max(0, Math.round(ind.params.liqLabelXBars ?? 8));
    const labelYOffsetTicks = Math.max(0, Math.round(ind.params.liqLabelYOffsetTicks ?? 20));
    const actionXBars = Math.max(0, Math.round(ind.params.liqActionXBars ?? 2));
    const actionYOffsetTicks = Math.max(0, Math.round(ind.params.liqActionYOffsetTicks ?? 10));

    let latestBullIndex = -1;
    for (let i = this.bars.length - 1; i >= currentDayStart; i -= 1) {
      if (!Number.isNaN(bullTop[i]) && !Number.isNaN(bullBottom[i])) {
        latestBullIndex = i;
        break;
      }
    }

    let latestBearIndex = -1;
    for (let i = this.bars.length - 1; i >= currentDayStart; i -= 1) {
      if (!Number.isNaN(bearTop[i]) && !Number.isNaN(bearBottom[i])) {
        latestBearIndex = i;
        break;
      }
    }

    const latestIndex = Math.max(latestBullIndex, latestBearIndex);
    if (latestIndex >= 0) {
      const visibleStart = Math.floor(this.viewport.startIndex);
      const visibleEnd = Math.ceil(this.viewport.endIndex);
      if (latestIndex < visibleStart || latestIndex >= visibleEnd) {
        return;
      }

      const isBull = latestIndex === latestBullIndex && latestBullIndex >= latestBearIndex;
      const top = isBull ? bullTop[latestIndex] : bearTop[latestIndex];
      const bottom = isBull ? bullBottom[latestIndex] : bearBottom[latestIndex];
      const baseColor = isBull
        ? (ind.colors?.buy ?? indicatorRegistry[ind.name].outputs.find((output) => output.key === 'buy')?.color ?? '#009E48')
        : (ind.colors?.sell ?? indicatorRegistry[ind.name].outputs.find((output) => output.key === 'sell')?.color ?? '#DB2958');

      const leftX = this.viewport.barToPixelX(latestIndex);
      const rightX = this.viewport.barToPixelX(latestIndex + extendBars);
      const yTop = toY(Math.max(top, bottom));
      const yBottom = toY(Math.min(top, bottom));
      const rectTop = Math.max(clipTop, Math.min(yTop, yBottom));
      const rectBottom = Math.min(clipBottom, Math.max(yTop, yBottom));
      const rectHeight = rectBottom - rectTop;

      if (rectHeight > 0) {
        this.renderer.rect(leftX, rectTop, Math.max(1, rightX - leftX), rectHeight, this.withAlpha(baseColor, 0.25));
        this.renderer.rectStroke(leftX, rectTop, Math.max(1, rightX - leftX), rectHeight, this.withAlpha(baseColor, 0.9), 1.5);
      }

      const sweepRange = top - bottom;
      const sourceCode = isBull ? bullSourceCode[latestIndex] : bearSourceCode[latestIndex];
      const sourceName = this.liquiditySourceName(sourceCode, isBull);
      const labelX = this.viewport.barToPixelX(latestIndex + labelXBars);
      const actionX = this.viewport.barToPixelX(latestIndex + actionXBars);
      const actionLines = isBull
        ? [
          'ACTION: BUY',
          `Entry: ${formatLiquidityPrice(top)}`,
          `Stop Loss: ${formatLiquidityPrice(this.bars[latestIndex].low)}`,
        ]
        : [
          'ACTION: SELL',
          `Entry: ${formatLiquidityPrice(bottom)}`,
          `Stop Loss: ${formatLiquidityPrice(this.bars[latestIndex].high)}`,
        ];
      const actionAnchorY = isBull
        ? toY(bottom - (tickSize * actionYOffsetTicks))
        : toY(top + (tickSize * actionYOffsetTicks));
      let actionRect: { left: number; top: number; right: number; bottom: number } | null = null;

      if (showSweepLabel) {
        const pctBase = isBull ? top : bottom;
        const sweepPct = pctBase !== 0 ? (sweepRange / pctBase) * 100 : NaN;
        const lines = showRange
          ? [
            `${isBull ? 'Bullish' : 'Bearish'} Liquidity Sweep (${sourceName})`,
            `Sweep Range: ${formatLiquidityPrice(sweepRange)}`,
            `${isBull ? 'Sweep Low' : 'Sweep High'}: ${formatLiquidityPrice(isBull ? bottom : top)}`,
            `${isBull ? 'Reclaim Level' : 'Reject Level'}: ${formatLiquidityPrice(isBull ? top : bottom)}`,
            `Sweep %: ${Number.isFinite(sweepPct) ? sweepPct.toFixed(2) : 'n/a'}%`,
          ]
          : [`${isBull ? 'Bullish' : 'Bearish'} Liquidity Sweep (${sourceName})`];
        const anchorY = isBull
          ? toY(top + (tickSize * labelYOffsetTicks))
          : toY(bottom - (tickSize * labelYOffsetTicks));
        if (showAction) {
          actionRect = this.measureLiquidityTextBox(actionLines, actionX, actionAnchorY, clipTop, clipBottom);
          const adjustedAnchorY = this.shiftLiquidityBoxY(
            anchorY,
            lines,
            labelX,
            clipTop,
            clipBottom,
            actionRect,
            !isBull,
          );
          this.drawLiquidityTextBox(actionLines, actionX, actionAnchorY, baseColor, textColor, clipTop, clipBottom);
          this.drawLiquidityTextBox(lines, labelX, adjustedAnchorY, baseColor, textColor, clipTop, clipBottom);
        } else {
          this.drawLiquidityTextBox(lines, labelX, anchorY, baseColor, textColor, clipTop, clipBottom);
        }
      } else if (showAction) {
        this.drawLiquidityTextBox(actionLines, actionX, actionAnchorY, baseColor, textColor, clipTop, clipBottom);
      }
    }

    void buy;
    void sell;
  }

  private renderLiquiditySweepBox(
    ind: ActiveIndicator,
    toY: (value: number) => number,
    clipTop: number,
    clipBottom: number,
  ) {
    const bullTop = ind.data[2];
    const bullBottom = ind.data[3];
    const bearTop = ind.data[4];
    const bearBottom = ind.data[5];
    if (!bullTop || !bullBottom || !bearTop || !bearBottom) return;

    const sweepEvents: Array<{ index: number; top: number; bottom: number; color: string }> = [];
    const buyColor = '#2563EB';
    const sellColor = '#DC2626';

    for (let i = 0; i < ind.data[0]?.length; i += 1) {
      if (!Number.isNaN(bullTop[i]) && !Number.isNaN(bullBottom[i])) {
        sweepEvents.push({
          index: i,
          top: bullTop[i],
          bottom: bullBottom[i],
          color: buyColor,
        });
      }
      if (!Number.isNaN(bearTop[i]) && !Number.isNaN(bearBottom[i])) {
        sweepEvents.push({
          index: i,
          top: bearTop[i],
          bottom: bearBottom[i],
          color: sellColor,
        });
      }
    }

    if (sweepEvents.length === 0) return;

    const recentSweeps = sweepEvents.slice(-5);
    const extraWidth = Math.max(12, ind.params.boxWidthPx ?? 56);

    for (const sweep of recentSweeps) {
      const x = this.viewport.barToPixelX(sweep.index);
      const left = x;
      const right = Math.max(left + extraWidth, this.viewport.chartLeft + this.viewport.chartWidth);
      const yTop = toY(Math.max(sweep.top, sweep.bottom));
      const yBottom = toY(Math.min(sweep.top, sweep.bottom));
      const rectTop = Math.max(clipTop, Math.min(yTop, yBottom));
      const rectBottom = Math.min(clipBottom, Math.max(yTop, yBottom));
      const rectHeight = rectBottom - rectTop;
      if (rectHeight <= 0) continue;

      this.renderer.rect(left, rectTop, right - left, rectHeight, this.withAlpha(sweep.color, 0.24));
      this.renderer.rectStroke(left, rectTop, right - left, rectHeight, this.withAlpha(sweep.color, 0.9), 1.5);
    }
  }

  private renderFvgBoxes(
    ind: ActiveIndicator,
    toY: (value: number) => number,
    clipTop: number,
    clipBottom: number,
  ) {
    const thresholdPercent = Math.max(0, ind.params.thresholdPercent ?? 0);
    const extendBars = Math.max(5, Math.round(ind.params.extendBars ?? 80));
    const requireNextBarReaction = (ind.params.requireNextBarReaction ?? 1) !== 0;
    const maxVisibleFvgs = Math.max(1, Math.round(ind.params.maxVisibleFvgs ?? 3));
    const sourceTimeframe = ind.textParams.sourceTimeframe ?? '';
    const zones = detectActiveFvgZones(this.bars, thresholdPercent, extendBars, requireNextBarReaction, sourceTimeframe);
    const visibleZones = zones.slice(-maxVisibleFvgs);

    for (const zone of visibleZones) {
      const leftX = this.timeToPixelX(zone.leftTime);
      const rightX = this.timeToPixelX(zone.rightTime);
      const yTop = toY(zone.top);
      const yBottom = toY(zone.bottom);
      const rectTop = Math.max(clipTop, Math.min(yTop, yBottom));
      const rectBottom = Math.min(clipBottom, Math.max(yTop, yBottom));
      const rectHeight = rectBottom - rectTop;
      if (rectHeight <= 0) continue;

      const baseColor = zone.isBull
        ? (
          ind.colors?.bullZone
          ?? ind.colors?.bullTop
          ?? indicatorRegistry[ind.name].outputs.find((output) => output.key === 'bullZone' || output.key === 'bullTop')?.color
          ?? '#089981'
        )
        : (
          ind.colors?.bearZone
          ?? ind.colors?.bearTop
          ?? indicatorRegistry[ind.name].outputs.find((output) => output.key === 'bearZone' || output.key === 'bearTop')?.color
          ?? '#f23645'
        );

      this.renderer.rect(leftX, rectTop, Math.max(1, rightX - leftX), rectHeight, this.withAlpha(baseColor, 0.18));
      this.renderer.rectStroke(leftX, rectTop, Math.max(1, rightX - leftX), rectHeight, this.withAlpha(baseColor, 0.55), 1);
    }
  }

  private timeToPixelX(timeMs: number): number {
    const len = this.bars.length;
    if (len === 0) return this.viewport.chartLeft;

    const estimateLastMs = () => {
      if (len > 1) {
        const diff = this.bars[len - 1].time - this.bars[len - 2].time;
        if (Number.isFinite(diff) && diff > 0) return diff;
      }
      return getTimeframeMs(String(this.scaleX.timeframe));
    };

    if (len === 1) {
      const barMs = estimateLastMs() || 60_000;
      const frac = (timeMs - this.bars[0].time) / barMs;
      return this.viewport.barToPixelX(frac);
    }

    if (timeMs <= this.bars[0].time) {
      const firstMs = this.bars[1].time - this.bars[0].time || estimateLastMs() || 60_000;
      return this.viewport.barToPixelX((timeMs - this.bars[0].time) / firstMs);
    }

    if (timeMs >= this.bars[len - 1].time) {
      const lastMs = estimateLastMs() || 60_000;
      return this.viewport.barToPixelX((len - 1) + ((timeMs - this.bars[len - 1].time) / lastMs));
    }

    let lo = 0;
    let hi = len - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const midTime = this.bars[mid].time;
      if (midTime === timeMs) return this.viewport.barToPixelX(mid);
      if (midTime < timeMs) lo = mid + 1;
      else hi = mid - 1;
    }

    const lower = Math.max(0, hi);
    const upper = Math.min(len - 1, lo);
    if (lower === upper) return this.viewport.barToPixelX(lower);

    const lowerTime = this.bars[lower].time;
    const upperTime = this.bars[upper].time;
    const frac = upperTime === lowerTime ? 0 : (timeMs - lowerTime) / (upperTime - lowerTime);
    return this.viewport.barToPixelX(lower + frac);
  }

  private renderTechnicalScoreSeries(
    series: number[],
    start: number,
    end: number,
    pane: SubPaneLayout,
    min: number,
    max: number,
  ) {
    const range = max - min;
    const toY = (v: number) => pane.top + ((max - v) / range) * pane.height;
    const baseline = 50;
    const baselineY = toY(baseline);

    const validPoints: Array<{ x: number; y: number; value: number }> = [];
    for (let i = start; i < end; i++) {
      if (i >= series.length || isNaN(series[i])) continue;
      validPoints.push({
        x: this.viewport.barToPixelX(i),
        y: toY(series[i]),
        value: series[i],
      });
    }
    if (validPoints.length < 2) return;

    for (let i = 1; i < validPoints.length; i++) {
      const prev = validPoints[i - 1];
      const curr = validPoints[i];
      const avgValue = (prev.value + curr.value) / 2;
      const fillColor = this.technicalScoreFillColor(avgValue);
      const strokeColor = this.technicalScoreStrokeColor(avgValue);

      this.ctx.beginPath();
      this.ctx.moveTo(prev.x, baselineY);
      this.ctx.lineTo(prev.x, prev.y);
      this.ctx.lineTo(curr.x, curr.y);
      this.ctx.lineTo(curr.x, baselineY);
      this.ctx.closePath();
      this.ctx.fillStyle = fillColor;
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.moveTo(prev.x, prev.y);
      this.ctx.lineTo(curr.x, curr.y);
      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }
  }

  private technicalScoreFillColor(value: number): string {
    if (value >= 50) {
      const intensity = Math.min(1, Math.max(0, (value - 50) / 50));
      const alpha = 0.12 + intensity * 0.28;
      return `rgba(0, 200, 83, ${alpha.toFixed(3)})`;
    }
    const intensity = Math.min(1, Math.max(0, (50 - value) / 50));
    const alpha = 0.12 + intensity * 0.28;
    return `rgba(190, 24, 56, ${alpha.toFixed(3)})`;
  }

  private technicalScoreStrokeColor(value: number): string {
    if (value >= 50) {
      const intensity = Math.min(1, Math.max(0, (value - 50) / 50));
      const channel = Math.round(128 + intensity * 72);
      return `rgb(0, ${channel}, 53)`;
    }
    const intensity = Math.min(1, Math.max(0, (50 - value) / 50));
    const greenBlue = Math.round(82 - intensity * 52);
    return `rgb(220, ${greenBlue}, ${greenBlue})`;
  }

  private withAlpha(color: string, alpha: number): string {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const normalized = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
      const r = parseInt(normalized.slice(0, 2), 16);
      const g = parseInt(normalized.slice(2, 4), 16);
      const b = parseInt(normalized.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    if (color.startsWith('rgb(')) {
      return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
    }

    return color;
  }

  private renderSignalMarker(
    x: number,
    y: number,
    label: string,
    color: string,
    direction: 'up' | 'down',
  ) {
    const defaultStroke = direction === 'up' ? '#38BDF8' : '#FB923C';
    const badgeStroke = (color && color !== '#888888') ? color : defaultStroke;
    const badgeFill = this.withAlpha(badgeStroke, 0.15);
    const textColor = '#F8FAFC';
    const stemLen = 14;
    const boxHeight = 14;
    const barGap = 6;
    // BUY (up arrow): label+stem go BELOW the bar's low (larger y in canvas space)
    // SELL (down arrow): label+stem go ABOVE the bar's high (smaller y in canvas space)
    const sign = direction === 'up' ? 1 : -1;
    const stemStartY = y + sign * barGap;
    const stemEndY = stemStartY + sign * stemLen;
    const textY = stemEndY + sign * (boxHeight / 2 + 2);
    const textWidth = Math.max(28, Math.ceil(this.renderer.measureText(label, FONT_MONO_SMALL).width) + 12);
    const boxX = x - textWidth / 2;
    const boxY = textY - boxHeight / 2;
    const minY = this.viewport.chartTop + 4;
    const maxY = this.viewport.chartTop + this.viewport.chartHeight - PRICE_AXIS_CONTROL_HEIGHT - boxHeight - 4;
    const clampedBoxY = Math.min(Math.max(boxY, minY), Math.max(minY, maxY));
    const clampedTextY = clampedBoxY + boxHeight / 2;

    this.renderer.line(x, stemStartY, x, stemEndY, badgeStroke, 1.25);
    this.renderer.rect(boxX, clampedBoxY, textWidth, boxHeight, badgeFill);
    this.renderer.rectStroke(boxX, clampedBoxY, textWidth, boxHeight, badgeStroke, 1);
    this.renderer.textSmall(label, x, clampedTextY, textColor, 'center');
  }

  private renderScriptSubPane(pane: SubPaneLayout, chartAreaWidth: number, result: ScriptResult, _scriptId: string) {
    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));

    let min = Infinity, max = -Infinity;
    for (const plot of result.plots) {
      for (let i = start; i < end; i++) {
        if (i < plot.values.length && !isNaN(plot.values[i])) {
          if (plot.values[i] < min) min = plot.values[i];
          if (plot.values[i] > max) max = plot.values[i];
        }
      }
    }

    if (!isFinite(min)) { min = 0; max = 100; }
    const pad = (max - min) * 0.1 || 1;
    min -= pad;
    max += pad;

    this.scaleY.renderSubPane(this.renderer, pane.top, pane.height, min, max, this.width, 'auto', pane.height > 24, pane.height > 24);

    const range = max - min;
    const toY = (v: number) => pane.top + ((max - v) / range) * pane.height;

    this.renderer.clip(0, pane.top, chartAreaWidth, pane.height, () => {
      for (const hl of result.hlines) {
        const y = toY(hl.value);
        if (hl.style === 'dashed') {
          this.renderer.dashedLine(0, y, chartAreaWidth, y, hl.color, 1, [4, 4]);
        } else {
          this.renderer.line(0, y, chartAreaWidth, y, hl.color, 1);
        }
      }

      for (const plot of result.plots) {
        const vals = plot.values.filter(v => !isNaN(v));
        const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        if (avg > this.viewport.priceMin * 0.5 && avg < this.viewport.priceMax * 2) continue;

        if (plot.style === 'histogram') {
          const zeroY = toY(0);
          for (let i = start; i < end; i++) {
            if (i >= plot.values.length || isNaN(plot.values[i])) continue;
            const x = this.viewport.barToPixelX(i);
            const barW = Math.max(1, Math.min(this.viewport.getBarSlotWidth(i) * 0.6, this.viewport.getBarSlotWidth(i) - 1));
            const y = toY(plot.values[i]);
            const barColor = plot.values[i] >= 0 ? '#00C853' : '#FF3D71';
            this.renderer.rect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(y - zeroY), barColor);
          }
          continue;
        }

        const points: [number, number][] = [];
        for (let i = start; i < end; i++) {
          if (i < plot.values.length && !isNaN(plot.values[i])) {
            points.push([this.viewport.barToPixelX(i), toY(plot.values[i])]);
          }
        }
        if (points.length > 1) {
          this.renderer.polyline(points, plot.color, plot.lineWidth);
        }
      }
    });
  }

  // --- Events ---

  private onMouseDown = (e: MouseEvent) => {
    const { mx, my } = this.getCanvasPoint(e);
    if (e.button !== 0) return;
    if (this.activeDrawingTool !== 'none' && this.isInMainChart(mx, my) && !this.viewport.isInPriceAxis(mx, this.width, PRICE_AXIS_WIDTH)) {
      this.drawingStart = this.anchorFromMouse(mx, my);
      this.drawingCurrent = this.drawingStart;
      this.drawingBrushPoints = this.activeDrawingTool === 'brush' ? [this.drawingStart] : [];
      this.drawingPointerActive = true;
      this.setSelectedDrawingId(null);
      this.markDirty();
      return;
    }
    if (this.activeDrawingTool === 'none') {
      // Check endpoint handles first (higher priority than whole-drawing drag)
      const endpointHit = this.hitTestDrawingEndpoint(mx, my);
      if (endpointHit && !endpointHit.drawing.locked) {
        this.pushDrawingUndo();
        this.setSelectedDrawingId(endpointHit.drawing.id);
        this.draggedDrawingId = endpointHit.drawing.id;
        this.dragMouseOrigin = this.anchorFromMouse(mx, my);
        this.dragDrawingOriginStart = { ...endpointHit.drawing.start };
        this.dragDrawingOriginEnd = { ...endpointHit.drawing.end };
        this.dragEndpoint = endpointHit.endpoint;
        this.markDirty();
        return;
      }
      const hit = this.hitTestDrawing(mx, my);
      if (hit) {
        this.setSelectedDrawingId(hit.id);
        if (!hit.locked) {
          this.pushDrawingUndo();
          this.draggedDrawingId = hit.id;
          this.dragMouseOrigin = this.anchorFromMouse(mx, my);
          if (hit.type === 'trendline' || hit.type === 'fibRetracement') {
            this.dragDrawingOriginStart = { ...hit.start };
            this.dragDrawingOriginEnd = { ...hit.end };
          } else if (hit.type === 'text') {
            this.dragDrawingOriginStart = { ...hit.anchor };
            this.dragDrawingOriginEnd = { ...hit.anchor };
          } else if (hit.points.length > 0) {
            this.dragDrawingOriginStart = { ...hit.points[0] };
            this.dragDrawingOriginEnd = { ...hit.points[hit.points.length - 1] };
          } else {
            this.dragDrawingOriginStart = null;
            this.dragDrawingOriginEnd = null;
          }
          this.dragEndpoint = 'whole';
        }
        this.markDirty();
        return;
      }
      this.setSelectedDrawingId(null);
    }
    this.panZoom.onMouseDown(e);
  };

  // Coalesced into RAF loop for crosshair — drawing/drag paths still run per-event for responsiveness
  private onMouseMove = (e: MouseEvent) => {
    // Drawing and drag operations need immediate response — bypass the RAF coalescing
    if (this.drawingPointerActive || this.draggedDrawingId) {
      this.processMouseMove(e);
      return;
    }
    this.pendingMouseEvent = e;
    this.scheduleFrame();
  };

  private processMouseMove = (e: MouseEvent) => {
    const { mx, my, rect } = this.getCanvasPoint(e);

    if (this.drawingPointerActive && this.drawingStart) {
      this.drawingCurrent = this.anchorFromMouse(mx, my);
      if (this.activeDrawingTool === 'brush') {
        const lastPoint = this.drawingBrushPoints[this.drawingBrushPoints.length - 1];
        if (!lastPoint || lastPoint.barIndex !== this.drawingCurrent.barIndex || Math.abs(lastPoint.price - this.drawingCurrent.price) > 0.0001) {
          this.drawingBrushPoints.push(this.drawingCurrent);
        }
      }
      const hit = this.hitTest.test(this.viewport, this.bars, mx, my);
      this.crosshair.visible = hit.inChart;
      this.crosshair.hit = hit;
      this.markDirty();
      return;
    }

    if (this.draggedDrawingId && this.dragMouseOrigin && this.dragDrawingOriginStart && this.dragDrawingOriginEnd) {
      const cur = this.anchorFromMouse(mx, my);
      const dBar = cur.barIndex - this.dragMouseOrigin.barIndex;
      const dPrice = cur.price - this.dragMouseOrigin.price;
      const idx = this.drawings.findIndex(d => d.id === this.draggedDrawingId);
      if (idx !== -1) {
        const drawing = this.drawings[idx];
        if (drawing.type === 'text') {
          this.drawings[idx] = {
            ...drawing,
            anchor: this.translateAnchor(this.dragDrawingOriginStart!, dBar, dPrice),
          };
        } else if (drawing.type === 'brush') {
          this.drawings[idx] = {
            ...drawing,
            points: drawing.points.map((point) => this.translateAnchor(point, dBar, dPrice)),
          };
          this.dragMouseOrigin = cur;
        } else if (this.dragEndpoint === 'start') {
          this.drawings[idx] = {
            ...drawing,
            start: { barIndex: this.dragDrawingOriginStart.barIndex + dBar, price: this.dragDrawingOriginStart.price + dPrice },
          };
        } else if (this.dragEndpoint === 'end') {
          this.drawings[idx] = {
            ...drawing,
            end: { barIndex: this.dragDrawingOriginEnd.barIndex + dBar, price: this.dragDrawingOriginEnd.price + dPrice },
          };
        } else {
          this.drawings[idx] = {
            ...drawing,
            start: { barIndex: this.dragDrawingOriginStart.barIndex + dBar, price: this.dragDrawingOriginStart.price + dPrice },
            end:   { barIndex: this.dragDrawingOriginEnd.barIndex   + dBar, price: this.dragDrawingOriginEnd.price   + dPrice },
          };
        }
      }
      this.markDirty();
      return;
    }

    this.panZoom.onMouseMove(e, rect);

    // Update hover state for drawings (when no tool active and not dragging)
    if (this.activeDrawingTool === 'none') {
      const hovered = this.hitTestDrawing(mx, my);
      const newHoveredId = hovered?.id ?? null;
      if (newHoveredId !== this.hoveredDrawingId) {
        this.hoveredDrawingId = newHoveredId;
        this._onDrawingHoverChange?.(newHoveredId);
        this.markDirty();
      }
    }

    // Crosshair — only redraw if the bar index or chart-presence changed
    const hit = this.hitTest.test(this.viewport, this.bars, mx, my);
    const prev = this.crosshair.hit;
    this.crosshair.visible = hit.inChart;
    this.crosshair.hit = hit;
    if (!prev || hit.barIndex !== prev.barIndex || hit.inChart !== prev.inChart || Math.abs(hit.pixelY - prev.pixelY) > 0.5) {
      this.markCrosshairDirty();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (this.drawingPointerActive && this.drawingStart && this.drawingCurrent && this.activeDrawingTool !== 'none') {
      const start = this.drawingStart;
      const end = this.drawingCurrent;
      const movedEnough = Math.abs(end.barIndex - start.barIndex) >= 1 || Math.abs(end.price - start.price) > 0.0001;
      let createdDrawingId: string | null = null;
      if (this.activeDrawingTool === 'text') {
        this._onTextPlacementRequest?.(start);
      } else if (this.activeDrawingTool === 'brush') {
        if (this.drawingBrushPoints.length >= 2) {
          this.pushDrawingUndo();
          createdDrawingId = `drawing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          this.drawings.push({
            id: createdDrawingId,
            type: 'brush',
            points: this.drawingBrushPoints.map((point) => ({ ...point })),
            locked: false,
          });
        }
      } else if (movedEnough) {
        this.pushDrawingUndo();
        createdDrawingId = `drawing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.drawings.push(
          this.activeDrawingTool === 'trendline'
            ? {
                id: createdDrawingId,
                type: 'trendline',
                start,
                end,
                locked: false,
              }
            : {
                id: createdDrawingId,
                type: 'fibRetracement',
                start,
                end,
                locked: false,
              },
        );
      }
      if (createdDrawingId) this.setSelectedDrawingId(createdDrawingId);
      this.cancelDraftDrawing();
      this.markDirty();
      return;
    }
    if (this.draggedDrawingId) {
      this.draggedDrawingId = null;
      this.dragMouseOrigin = null;
      this.dragDrawingOriginStart = null;
      this.dragDrawingOriginEnd = null;
      this.dragEndpoint = 'whole';
      return;
    }
    this.panZoom.onMouseUp(e);
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const { mx, my } = this.getCanvasPoint(e);
    const hit = this.hitTestDrawing(mx, my);
    if (hit) {
      this.setSelectedDrawingId(hit.id);
      this.markDirty();
      if (this._onDrawingContextMenu) {
        this._onDrawingContextMenu({
          drawingId: hit.id,
          color: hit.color || '#60A5FA',
          screenX: e.clientX,
          screenY: e.clientY,
        });
      }
    }
  };

  private onMouseLeave = () => {
    this.crosshair.visible = false;
    this.crosshair.hit = null;
    this.hoveredDrawingId = null;
    this.markDirty();
  };

  private onWheel = (e: WheelEvent) => {
    this.panZoom.onWheel(e);
  };

  private onDoubleClick = (e: MouseEvent) => {
    this.panZoom.onDoubleClick(e);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      this.redo();
    } else if (e.key === 'y') {
      e.preventDefault();
      this.redo();
    }
  };

  private bindEvents() {
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mouseleave', this.onMouseLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  private unbindEvents() {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
  }
}

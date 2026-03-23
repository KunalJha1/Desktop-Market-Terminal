import type { OHLCVBar, ChartType, ActiveIndicator, ChartLayout, SubPaneLayout, YScaleMode, ChartBrandingMode } from '../types';
import { COLORS, PRICE_AXIS_WIDTH, TIME_AXIS_HEIGHT, SUB_PANE_HEIGHT, SUB_PANE_SEPARATOR } from '../constants';
import { DEFAULT_BARS_VISIBLE } from '../constants';
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
import { computeIndicator } from '../indicators/compute';
import type { ScriptResult } from '../types';
import type { Timeframe } from '../types';

const BRANDING_ASSETS: Record<Exclude<ChartBrandingMode, 'none'>, { src: string; opacity: number }> = {
  fullLogo: {
    src: '/dailyiq-brand-resources/daily-iq-topbar-logo.svg',
    opacity: 0.2,
  },
  icon: {
    src: '/dailyiq-brand-resources/daily-iq-topbar-favicon.svg',
    opacity: 0.26,
  },
};

const brandingImageCache = new Map<string, HTMLImageElement>();

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
  private brandingMode: ChartBrandingMode = 'none';
  private brandingImage: HTMLImageElement | null = null;
  private _onViewportChange: ((startIdx: number, endIdx: number) => void) | null = null;

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

    this.bindEvents();
    this.startRenderLoop();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.unbindEvents();
  }

  // --- Public API ---

  setData(bars: OHLCVBar[]) {
    const wasNearEnd = this.liveMode && this.viewport.isNearEnd(2);
    this.bars = bars;
    this.viewport.setTotalBars(bars.length);
    this.recomputeIndicators();
    if (wasNearEnd) {
      this.viewport.scrollToEnd();
    }
    this.markDirty();
  }

  setOnViewportChange(cb: ((startIdx: number, endIdx: number) => void) | null) {
    this._onViewportChange = cb;
  }

  getViewportRange(): { startIndex: number; endIndex: number } {
    return {
      startIndex: Math.max(0, Math.floor(this.viewport.startIndex)),
      endIndex: Math.min(this.bars.length, Math.ceil(this.viewport.endIndex)),
    };
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
    const wasNearEnd = this.liveMode && this.viewport.isNearEnd(2);
    this.stopperPx = Math.max(0, px);
    const rightOffsetBars = this.computeRightOffsetBars();
    this.viewport.setRightOffsetBars(rightOffsetBars);
    if (wasNearEnd) {
      this.viewport.scrollToEnd();
    }
    this.markDirty();
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
    this.markDirty();
  }

  // --- Layout ---

  private computeLayout(): ChartLayout {
    const assignedPanes = this.getAssignedSubPanes();
    const scriptPanes = this.getScriptSubPanes();

    const assignedPaneHeights = assignedPanes.map(pane =>
      (this.subPaneHeightOverrides.get(pane.paneId) ?? SUB_PANE_HEIGHT) + SUB_PANE_SEPARATOR
    );
    const scriptHeights = scriptPanes.map(id => {
      const key = `__script_${id}__`;
      return (this.subPaneHeightOverrides.get(key) ?? SUB_PANE_HEIGHT) + SUB_PANE_SEPARATOR;
    });
    const totalSubPaneHeight = [...assignedPaneHeights, ...scriptHeights].reduce((a, b) => a + b, 0);
    const mainHeight = this.height - TIME_AXIS_HEIGHT - totalSubPaneHeight;

    const subPanes: SubPaneLayout[] = [];
    let currentTop = mainHeight;

    for (const pane of assignedPanes) {
      const h = this.subPaneHeightOverrides.get(pane.paneId) ?? SUB_PANE_HEIGHT;
      subPanes.push({
        paneId: pane.paneId,
        indicatorIds: pane.indicatorIds,
        top: currentTop + SUB_PANE_SEPARATOR,
        height: h,
      });
      currentTop += h + SUB_PANE_SEPARATOR;
    }

    for (const scriptId of scriptPanes) {
      const key = `__script_${scriptId}__`;
      const h = this.subPaneHeightOverrides.get(key) ?? SUB_PANE_HEIGHT;
      subPanes.push({
        paneId: key,
        indicatorIds: [key],
        top: currentTop + SUB_PANE_SEPARATOR,
        height: h,
      });
      currentTop += h + SUB_PANE_SEPARATOR;
    }

    return {
      mainTop: 0,
      mainHeight,
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
      if (!ind.visible || ind.paneId === 'main') continue;
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

  private recomputeIndicators() {
    for (const ind of this.activeIndicators) {
      this.computeSingleIndicator(ind);
    }
  }

  private computeSingleIndicator(ind: ActiveIndicator) {
    ind.data = computeIndicator(ind.name, this.bars, ind.params);
  }

  // --- Render ---

  private markDirty() {
    this.dirty = true;
    if (this._onViewportChange && this.bars.length > 0) {
      const start = Math.max(0, Math.floor(this.viewport.startIndex));
      const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));
      this._onViewportChange(start, end);
    }
  }

  private startRenderLoop() {
    const loop = () => {
      if (this.destroyed) return;
      if (this.dirty) {
        this.dirty = false;
        this.render();
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private render() {
    const rightOffsetBars = this.computeRightOffsetBars();
    this.viewport.setRightOffsetBars(rightOffsetBars);

    const layout = this.computeLayout();
    const chartAreaWidth = this.width - PRICE_AXIS_WIDTH;

    this.viewport.setRegion(0, layout.mainTop, chartAreaWidth, layout.mainHeight);

    // Auto-fit price (skipped if manualYScale)
    if (this.bars.length > 0) {
      const lows = this.bars.map(b => b.low);
      const highs = this.bars.map(b => b.high);
      this.viewport.fitPriceRange(lows, highs);
    }

    // Clear
    this.renderer.clear(this.width, this.height);

    // Clip to chart area for main rendering
    this.renderer.clip(0, 0, chartAreaWidth, layout.mainHeight, () => {
      // Grid lines (behind chart)
      this.scaleY.renderGrid(this.renderer, this.viewport, this.width);
      this.scaleX.renderGrid(this.renderer, this.viewport, this.bars, this.height, this.width);

      // Volume bars (behind price action)
      this.volumeRenderer.render(this.renderer, this.viewport, this.bars);

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

    // Crosshair & tooltip (with indicator labels)
    this.crosshair.render(this.renderer, this.viewport, this.scaleX, this.width, this.height);
    this.tooltip.render(this.renderer, this.viewport, this.crosshair.hit);
  }

  private computeRightOffsetBars(): number {
    if (!this.liveMode || this.stopperPx <= 0) return 0;
    const barWidth = this.viewport.barWidth;
    if (barWidth <= 0) return 0;
    return this.stopperPx / barWidth;
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

    const x = chartAreaWidth - padding - width;
    const y = padding;
    this.renderer.image(this.brandingImage, x, y, width, height, asset.opacity);
  }

  private renderOverlays() {
    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));

    for (const ind of this.activeIndicators) {
      if (!ind.visible || ind.paneId !== 'main') continue;
      this.renderIndicatorSeries(
        ind,
        (value) => this.viewport.priceToPixelY(value),
        0,
        this.height - TIME_AXIS_HEIGHT,
        start,
        end,
      );
    }

    // Script overlay plots
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
    }
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

    const ranges = indicators
      .map((ind) => {
        const meta = indicatorRegistry[ind.name];
        if (!meta) return null;
        if (ind.name === 'Technical Score') {
          return { ind, meta, min: 0, max: 100 };
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

        if (!isFinite(min) || !isFinite(max)) {
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

    if (ranges.length === 0) return;

    const primary = ranges[0];
    this.scaleY.renderSubPane(this.renderer, pane.top, pane.height, primary.min, primary.max, this.width);
    this.renderer.textSmall(ranges.map(({ meta }) => meta.shortName).join(' + '), 4, pane.top + 12, COLORS.textMuted, 'left');

    this.renderer.clip(0, pane.top, chartAreaWidth, pane.height, () => {
      if (ranges.length === 1) {
        const [{ ind, meta, min, max }] = ranges;
        const range = max - min || 1;
        const isTechnicalScore = ind.name === 'Technical Score';

        if (isTechnicalScore) {
          for (const level of [30, 50, 70]) {
            const y = pane.top + ((max - level) / (max - min)) * pane.height;
            this.renderer.dashedLine(0, y, chartAreaWidth, y, level === 50 ? COLORS.textMuted : COLORS.border, 1, [4, 4]);
          }
        } else if (meta.guideLines?.length) {
          for (const guideLine of meta.guideLines) {
            const y = pane.top + ((max - guideLine.value) / range) * pane.height;
            if (guideLine.style === 'solid') {
              this.renderer.line(0, y, chartAreaWidth, y, guideLine.color ?? COLORS.border, 1);
            } else {
              this.renderer.dashedLine(0, y, chartAreaWidth, y, guideLine.color ?? COLORS.border, 1, [4, 4]);
            }
          }
        }
      }

      for (const { ind, min, max } of ranges) {
        const range = max - min || 1;
        this.renderIndicatorSeries(
          ind,
          (value) => pane.top + ((max - value) / range) * pane.height,
          pane.top,
          pane.top + pane.height,
          start,
          end,
          pane,
          min,
          max,
        );
      }
    });

    ranges.forEach(({ ind, meta, min, max }, index) => {
      const output = meta.outputs[0];
      const color = output ? (ind.colors?.[output.key] ?? output.color) : COLORS.textMuted;
      this.renderer.textSmall(
        `${meta.shortName} ${min.toFixed(1)}-${max.toFixed(1)}`,
        chartAreaWidth - 8,
        pane.top + 12 + index * 12,
        color,
        'right',
      );
    });
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
    if (!meta) return;

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
        const zeroY = toY(0);
        const barW = Math.max(1, this.viewport.barWidth * 0.6);
        for (let i = start; i < end; i++) {
          if (i >= series.length || isNaN(series[i])) continue;
          const x = this.viewport.barToPixelX(i);
          const y = toY(series[i]);
          const color = series[i] >= 0 ? COLORS.green : COLORS.red;
          this.renderer.rect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(y - zeroY), color);
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
      return `rgba(16, 58, 138, ${alpha.toFixed(3)})`;
    }
    const intensity = Math.min(1, Math.max(0, (50 - value) / 50));
    const alpha = 0.12 + intensity * 0.28;
    return `rgba(190, 24, 56, ${alpha.toFixed(3)})`;
  }

  private technicalScoreStrokeColor(value: number): string {
    if (value >= 50) {
      const intensity = Math.min(1, Math.max(0, (value - 50) / 50));
      const channel = Math.round(96 + intensity * 74);
      return `rgb(29, 78, ${channel})`;
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
    const verticalOffset = direction === 'up' ? -18 : 18;
    const stemEndY = y + (direction === 'up' ? -6 : 6);
    const textY = y + verticalOffset;
    const textWidth = Math.max(18, this.ctx.measureText(label).width + 8);
    const boxX = x - textWidth / 2;
    const boxY = textY - 5;

    this.renderer.line(x, y, x, stemEndY, color);
    this.renderer.rect(boxX, boxY, textWidth, 10, color);
    this.renderer.textSmall(label, x, textY, COLORS.bgBase, 'center');
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

    this.scaleY.renderSubPane(this.renderer, pane.top, pane.height, min, max, this.width);
    this.renderer.textSmall('Script', 4, pane.top + 12, COLORS.purple, 'left');

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
    this.panZoom.onMouseDown(e);
  };

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    // rect is in viewport pixels; canvas draws in CSS pixels.
    // Ancestor CSS transforms (e.g. layout zoom) make these differ — divide by scale.
    const scaleX = rect.width / this.width;
    const scaleY = rect.height / this.height;
    const mx = (e.clientX - rect.left) / scaleX;
    const my = (e.clientY - rect.top) / scaleY;

    this.panZoom.onMouseMove(e, rect);

    // Crosshair
    const hit = this.hitTest.test(this.viewport, this.bars, mx, my);
    this.crosshair.visible = hit.inChart;
    this.crosshair.hit = hit;
    this.markDirty();
  };

  private onMouseUp = (e: MouseEvent) => {
    this.panZoom.onMouseUp(e);
  };

  private onMouseLeave = () => {
    this.crosshair.visible = false;
    this.crosshair.hit = null;
    this.markDirty();
  };

  private onWheel = (e: WheelEvent) => {
    this.panZoom.onWheel(e);
  };

  private onDoubleClick = (e: MouseEvent) => {
    this.panZoom.onDoubleClick(e);
  };

  private bindEvents() {
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mouseleave', this.onMouseLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
  }

  private unbindEvents() {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
  }
}

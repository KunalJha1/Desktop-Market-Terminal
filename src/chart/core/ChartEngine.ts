import type { OHLCVBar, ChartType, ActiveIndicator, ChartLayout, SubPaneLayout } from '../types';
import { COLORS, PRICE_AXIS_WIDTH, TIME_AXIS_HEIGHT, SUB_PANE_HEIGHT, SUB_PANE_SEPARATOR } from '../constants';
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
    this.bars = bars;
    this.viewport.setTotalBars(bars.length);
    this.recomputeIndicators();
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

  addIndicator(name: string): string {
    const meta = indicatorRegistry[name];
    if (!meta) return '';
    const id = `ind_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const colors: Record<string, string> = {};
    for (const output of meta.outputs) {
      colors[output.key] = output.color;
    }
    const indicator: ActiveIndicator = {
      id,
      name,
      params: { ...meta.defaultParams },
      colors,
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

  toggleVisibility(id: string) {
    const ind = this.activeIndicators.find(i => i.id === id);
    if (!ind) return;
    ind.visible = !ind.visible;
    this.markDirty();
  }

  getActiveIndicators(): ActiveIndicator[] {
    return this.activeIndicators;
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
    const oscillatorPanes = this.getOscillatorPanes();
    const scriptPanes = this.getScriptSubPanes();

    const subPaneCount = oscillatorPanes.length + scriptPanes.length;
    const totalSubPaneHeight = subPaneCount * (SUB_PANE_HEIGHT + SUB_PANE_SEPARATOR);
    const mainHeight = this.height - TIME_AXIS_HEIGHT - totalSubPaneHeight;

    const subPanes: SubPaneLayout[] = [];
    let currentTop = mainHeight;

    for (const ind of oscillatorPanes) {
      subPanes.push({
        indicatorId: ind.id,
        top: currentTop + SUB_PANE_SEPARATOR,
        height: SUB_PANE_HEIGHT,
      });
      currentTop += SUB_PANE_HEIGHT + SUB_PANE_SEPARATOR;
    }

    for (const scriptId of scriptPanes) {
      subPanes.push({
        indicatorId: `__script_${scriptId}__`,
        top: currentTop + SUB_PANE_SEPARATOR,
        height: SUB_PANE_HEIGHT,
      });
      currentTop += SUB_PANE_HEIGHT + SUB_PANE_SEPARATOR;
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

  private getOscillatorPanes(): ActiveIndicator[] {
    return this.activeIndicators.filter(ind => {
      const meta = indicatorRegistry[ind.name];
      return meta && (meta.category === 'oscillator' || meta.category === 'volume') && ind.visible;
    });
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
    });

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

  private renderOverlays() {
    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));

    for (const ind of this.activeIndicators) {
      const meta = indicatorRegistry[ind.name];
      if (!meta || meta.category !== 'overlay' || !ind.visible) continue;

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
            if (isNaN(series[i]) || isNaN(nextSeries[i])) continue;
            const x = this.viewport.barToPixelX(i);
            fillPoints.push([x, this.viewport.priceToPixelY(series[i])]);
            fillPoints2.push([x, this.viewport.priceToPixelY(nextSeries[i])]);
          }
          if (fillPoints.length > 1) {
            const areaPoints = [...fillPoints, ...fillPoints2.reverse()];
            this.renderer.fillArea(areaPoints, drawColor + '20');
          }
        }

        if (output.style === 'dots') {
          for (let i = start; i < end; i++) {
            if (isNaN(series[i])) continue;
            const x = this.viewport.barToPixelX(i);
            const y = this.viewport.priceToPixelY(series[i]);
            this.renderer.rect(x - 2, y - 2, 4, 4, drawColor);
          }
          continue;
        }

        // Default: line
        const points: [number, number][] = [];
        for (let i = start; i < end; i++) {
          if (isNaN(series[i])) continue;
          points.push([this.viewport.barToPixelX(i), this.viewport.priceToPixelY(series[i])]);
        }
        if (points.length > 1) {
          this.renderer.polyline(points, drawColor, output.lineWidth || 1);
        }
      }
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
    if (pane.indicatorId.startsWith('__script_')) {
      const scriptId = pane.indicatorId.replace('__script_', '').replace('__', '');
      const result = this.scriptResults.get(scriptId);
      if (result) {
        this.renderScriptSubPane(pane, chartAreaWidth, result, scriptId);
      }
      return;
    }

    const ind = this.activeIndicators.find(i => i.id === pane.indicatorId);
    if (!ind) return;
    const meta = indicatorRegistry[ind.name];
    if (!meta) return;

    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this.bars.length, Math.ceil(this.viewport.endIndex));

    // Find range across all outputs
    let min = Infinity, max = -Infinity;
    for (const series of ind.data) {
      for (let i = start; i < end; i++) {
        if (i < series.length && !isNaN(series[i])) {
          if (series[i] < min) min = series[i];
          if (series[i] > max) max = series[i];
        }
      }
    }

    if (!isFinite(min)) { min = 0; max = 100; }
    const pad = (max - min) * 0.1 || 1;
    min -= pad;
    max += pad;

    // Render Y scale for sub-pane
    this.scaleY.renderSubPane(this.renderer, pane.top, pane.height, min, max, this.width);

    // Label
    this.renderer.textSmall(meta.shortName, 4, pane.top + 12, COLORS.textMuted, 'left');

    // Draw series
    this.renderer.clip(0, pane.top, chartAreaWidth, pane.height, () => {
      for (let oi = 0; oi < ind.data.length; oi++) {
        const series = ind.data[oi];
        const output = meta.outputs[oi];
        if (!output || !series) continue;

        const range = max - min;
        const toY = (v: number) => pane.top + ((max - v) / range) * pane.height;

        const subDrawColor = ind.colors?.[output.key] ?? output.color;

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

        const points: [number, number][] = [];
        for (let i = start; i < end; i++) {
          if (i >= series.length || isNaN(series[i])) continue;
          points.push([this.viewport.barToPixelX(i), toY(series[i])]);
        }
        if (points.length > 1) {
          this.renderer.polyline(points, subDrawColor, output.lineWidth || 1);
        }
      }
    });
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
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

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

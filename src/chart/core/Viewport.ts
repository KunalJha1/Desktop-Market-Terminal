import {
  MIN_BARS_VISIBLE,
  MAX_BARS_VISIBLE,
  DEFAULT_BARS_VISIBLE,
} from '../constants';
import type { YScaleMode } from '../types';

// How many bars of empty space to allow scrolling past the right edge
const FRONT_MARGIN_BARS = 50;

export class Viewport {
  startIndex: number = 0;
  barsVisible: number = DEFAULT_BARS_VISIBLE;
  totalBars: number = 0;
  rightOffsetBars: number = 0;

  // Computed layout region for the main chart area
  chartLeft: number = 0;
  chartTop: number = 0;
  chartWidth: number = 0;
  chartHeight: number = 0;

  // Price range
  priceMin: number = 0;
  priceMax: number = 0;
  yScaleMode: YScaleMode = 'auto';

  // Manual Y-axis scale mode
  // When true, auto-fit is disabled and user drags to scale
  manualYScale: boolean = false;
  private yScaleAnchorY: number = 0;
  private yScaleDragging: boolean = false;

  get barWidth(): number {
    if (this.barsVisible === 0) return 0;
    return this.chartWidth / this.barsVisible;
  }

  get endIndex(): number {
    const extra = Math.max(FRONT_MARGIN_BARS, Math.ceil(this.rightOffsetBars));
    return Math.min(this.startIndex + this.barsVisible, this.totalBars + extra);
  }

  setRegion(left: number, top: number, width: number, height: number) {
    this.chartLeft = left;
    this.chartTop = top;
    this.chartWidth = width;
    this.chartHeight = height;
  }

  setTotalBars(total: number) {
    this.totalBars = total;
    // On first load, scroll to end
    if (this.startIndex === 0 && total > 0) {
      this.scrollToEnd();
    }
  }

  setRightOffsetBars(bars: number) {
    this.rightOffsetBars = Math.max(0, bars);
  }

  setBarsVisible(bars: number) {
    const next = Math.max(MIN_BARS_VISIBLE, Math.min(MAX_BARS_VISIBLE, Math.round(bars)));
    if (next === this.barsVisible) return;
    const anchorBar = this.startIndex + this.barsVisible / 2;
    this.barsVisible = next;
    this.startIndex = this.clampStart(anchorBar - this.barsVisible / 2);
  }

  getMaxStart(): number {
    const extra = Math.max(FRONT_MARGIN_BARS, Math.ceil(this.rightOffsetBars));
    return Math.max(0, this.totalBars + extra - this.barsVisible);
  }

  isNearEnd(thresholdBars: number): boolean {
    return this.startIndex >= this.getMaxStart() - thresholdBars;
  }

  scrollToEnd() {
    this.startIndex = this.getMaxStart();
  }

  pan(pixelDelta: number) {
    if (this.barWidth === 0) return;
    const barDelta = pixelDelta / this.barWidth;
    this.startIndex = this.clampStart(this.startIndex - barDelta);
  }

  zoom(delta: number, anchorPixelX: number) {
    const anchorRatio = (anchorPixelX - this.chartLeft) / this.chartWidth;
    const anchorBar = this.startIndex + this.barsVisible * anchorRatio;

    const zoomFactor = delta > 0 ? 0.9 : 1.1;
    const newBarsVisible = Math.round(
      Math.max(MIN_BARS_VISIBLE, Math.min(MAX_BARS_VISIBLE, this.barsVisible * zoomFactor))
    );

    if (newBarsVisible === this.barsVisible) return;

    this.barsVisible = newBarsVisible;
    this.startIndex = this.clampStart(anchorBar - this.barsVisible * anchorRatio);
  }

  /**
   * Auto-fit price range to visible data with padding.
   * Skipped when manualYScale is true.
   */
  fitPriceRange(lows: number[], highs: number[]) {
    if (this.manualYScale) return;

    const start = Math.max(0, Math.floor(this.startIndex));
    const end = Math.min(lows.length, Math.ceil(this.startIndex + this.barsVisible));

    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i < end; i++) {
      if (lows[i] < min) min = lows[i];
      if (highs[i] > max) max = highs[i];
    }

    if (!isFinite(min) || !isFinite(max)) {
      min = 0;
      max = 100;
    }

    if (this.yScaleMode === 'log') {
      let minPos = min;
      if (minPos <= 0) {
        minPos = Infinity;
        for (let i = start; i < end; i++) {
          const low = lows[i];
          if (low > 0 && low < minPos) minPos = low;
        }
        if (!isFinite(minPos)) minPos = 1;
      }
      const maxPos = Math.max(max, minPos * 1.01);
      const padFactor = 0.05;
      this.priceMin = minPos / (1 + padFactor);
      this.priceMax = maxPos * (1 + padFactor);
      return;
    }

    const padding = (max - min) * 0.05 || 1;
    this.priceMin = min - padding;
    this.priceMax = max + padding;
  }

  // --- Y-axis manual scale (drag on price axis) ---

  startYScaleDrag(mouseY: number) {
    this.manualYScale = true;
    this.yScaleDragging = true;
    this.yScaleAnchorY = mouseY;
  }

  updateYScaleDrag(mouseY: number) {
    if (!this.yScaleDragging) return;
    const dy = mouseY - this.yScaleAnchorY;
    // Scale factor: dragging down zooms in (shrinks range), up zooms out
    const scaleFactor = Math.pow(1.005, dy);
    if (this.yScaleMode === 'log') {
      const safeMin = Math.max(this.priceMin, 1e-8);
      const safeMax = Math.max(this.priceMax, safeMin * 1.01);
      const logMin = Math.log10(safeMin);
      const logMax = Math.log10(safeMax);
      const range = logMax - logMin;
      const newRange = range * scaleFactor;
      const center = (logMax + logMin) / 2;
      const nextLogMin = center - newRange / 2;
      const nextLogMax = center + newRange / 2;
      this.priceMin = Math.pow(10, nextLogMin);
      this.priceMax = Math.pow(10, nextLogMax);
    } else {
      const range = this.priceMax - this.priceMin;
      const newRange = range * scaleFactor;
      const center = (this.priceMax + this.priceMin) / 2;
      this.priceMin = center - newRange / 2;
      this.priceMax = center + newRange / 2;
    }
    this.yScaleAnchorY = mouseY;
  }

  endYScaleDrag() {
    this.yScaleDragging = false;
  }

  resetYScale() {
    this.manualYScale = false;
  }

  setYScaleMode(mode: YScaleMode) {
    if (this.yScaleMode === mode) return;
    this.yScaleMode = mode;
    this.manualYScale = false;
  }

  get isYScaleDragging(): boolean {
    return this.yScaleDragging;
  }

  /** Convert bar index to pixel X (center of bar). */
  barToPixelX(index: number): number {
    return this.chartLeft + (index - this.startIndex) * this.barWidth + this.barWidth / 2;
  }

  /** Convert price to pixel Y. */
  priceToPixelY(price: number): number {
    if (this.yScaleMode === 'log') {
      const safeMin = Math.max(this.priceMin, 1e-8);
      const safeMax = Math.max(this.priceMax, safeMin * 1.01);
      const logMin = Math.log10(safeMin);
      const logMax = Math.log10(safeMax);
      const range = logMax - logMin;
      if (range === 0) return this.chartTop + this.chartHeight / 2;
      const logPrice = Math.log10(Math.max(price, safeMin));
      const ratio = (logMax - logPrice) / range;
      return this.chartTop + ratio * this.chartHeight;
    }

    const range = this.priceMax - this.priceMin;
    if (range === 0) return this.chartTop + this.chartHeight / 2;
    const ratio = (this.priceMax - price) / range;
    return this.chartTop + ratio * this.chartHeight;
  }

  /** Convert pixel X to bar index. */
  pixelXToBar(px: number): number {
    return this.startIndex + (px - this.chartLeft) / this.barWidth;
  }

  /** Convert pixel Y to price. */
  pixelYToPrice(py: number): number {
    if (this.yScaleMode === 'log') {
      const safeMin = Math.max(this.priceMin, 1e-8);
      const safeMax = Math.max(this.priceMax, safeMin * 1.01);
      const logMin = Math.log10(safeMin);
      const logMax = Math.log10(safeMax);
      const ratio = (py - this.chartTop) / this.chartHeight;
      const logPrice = logMax - ratio * (logMax - logMin);
      return Math.pow(10, logPrice);
    }

    const ratio = (py - this.chartTop) / this.chartHeight;
    return this.priceMax - ratio * (this.priceMax - this.priceMin);
  }

  /** Check if a pixel X is in the price axis region. */
  isInPriceAxis(px: number, canvasWidth: number, priceAxisWidth: number): boolean {
    return px >= canvasWidth - priceAxisWidth;
  }

  private clampStart(v: number): number {
    // Allow scrolling past the right edge by FRONT_MARGIN_BARS
    const maxStart = this.getMaxStart();
    return Math.max(0, Math.min(maxStart, v));
  }
}

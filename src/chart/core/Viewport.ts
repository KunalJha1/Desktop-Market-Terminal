import {
  MIN_BARS_VISIBLE,
  MAX_BARS_VISIBLE,
  DEFAULT_BARS_VISIBLE,
} from '../constants';
import type { YScaleMode } from '../types';

// How many bars of empty space to allow scrolling past the right edge
const FRONT_MARGIN_BARS = 25;

export class Viewport {
  startIndex: number = 0;
  barsVisible: number = DEFAULT_BARS_VISIBLE;
  totalBars: number = 0;
  rightOffsetBars: number = 0;
  private initialized: boolean = false;

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
  private variableBarLayoutStart: number = 0;
  private variableBarLayoutLefts: Float64Array = new Float64Array(0);
  private variableBarLayoutWidths: Float64Array = new Float64Array(0);

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

  setVariableBarLayout(startIndex: number, lefts: Float64Array, widths: Float64Array) {
    this.variableBarLayoutStart = startIndex;
    this.variableBarLayoutLefts = lefts;
    this.variableBarLayoutWidths = widths;
  }

  clearVariableBarLayout() {
    this.variableBarLayoutStart = 0;
    this.variableBarLayoutLefts = new Float64Array(0);
    this.variableBarLayoutWidths = new Float64Array(0);
  }

  getBarSlotWidth(index: number): number {
    const slot = this.getVariableBarSlot(index);
    return slot ? slot.width : this.barWidth;
  }

  /**
   * Reset the viewport so the next setTotalBars call will auto-scroll to end.
   * Call this when switching symbols to avoid staying stuck at old scroll position.
   */
  reset() {
    this.initialized = false;
    this.startIndex = 0;
    this.manualYScale = false;
  }

  setTotalBars(total: number) {
    this.totalBars = total;
    if (total === 0) {
      // Don't reset initialized or startIndex — transient empty states
      // (fetch errors, poll gaps) shouldn't wipe the user's scroll position.
      // Symbol changes use reset() explicitly which handles that case.
      return;
    }
    // On first non-empty load, scroll to end
    if (!this.initialized) {
      this.initialized = true;
      this.scrollToEnd();
      return;
    }
    this.startIndex = this.clampStart(this.startIndex);
  }

  setRightOffsetBars(bars: number) {
    const next = Math.max(0, bars);
    if (next === this.rightOffsetBars) return;
    this.rightOffsetBars = next;
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

  shiftStartBy(deltaBars: number) {
    if (!Number.isFinite(deltaBars) || deltaBars === 0) return;
    this.startIndex = this.clampStart(this.startIndex + deltaBars);
  }

  pan(pixelDelta: number) {
    if (this.barWidth === 0) return;
    if (this.variableBarLayoutWidths.length > 0) {
      const anchorPx = this.chartLeft + this.chartWidth / 2;
      const currentBar = this.pixelXToBar(anchorPx);
      const shiftedBar = this.pixelXToBar(anchorPx - pixelDelta);
      const barDelta = shiftedBar - currentBar;
      if (!Number.isFinite(barDelta)) return;
      this.startIndex = this.clampStart(this.startIndex + barDelta);
      return;
    }
    const barDelta = pixelDelta / this.barWidth;
    this.startIndex = this.clampStart(this.startIndex - barDelta);
  }

  zoom(delta: number, anchorPixelX: number) {
    if (this.chartWidth <= 0) return;
    const anchorRatio = (anchorPixelX - this.chartLeft) / this.chartWidth;
    const anchorBar = this.pixelXToBar(anchorPixelX);

    const zoomFactor = delta > 0 ? 0.9 : 1.1;
    const newBarsVisible =
      Math.max(MIN_BARS_VISIBLE, Math.min(MAX_BARS_VISIBLE, this.barsVisible * zoomFactor));

    if (newBarsVisible === this.barsVisible) return;

    this.barsVisible = newBarsVisible;
    this.startIndex = this.clampStart(anchorBar - this.barsVisible * anchorRatio);
  }

  /** Zoom by an explicit multiplicative factor (e.g. 1.05 = 5% more bars visible). */
  zoomBy(factor: number, anchorPixelX: number) {
    if (this.chartWidth <= 0) return;
    const anchorRatio = (anchorPixelX - this.chartLeft) / this.chartWidth;
    const anchorBar = this.pixelXToBar(anchorPixelX);

    const newBarsVisible =
      Math.max(MIN_BARS_VISIBLE, Math.min(MAX_BARS_VISIBLE, this.barsVisible * factor));

    if (Math.abs(newBarsVisible - this.barsVisible) < 0.001) return;

    this.barsVisible = newBarsVisible;
    this.startIndex = this.clampStart(anchorBar - this.barsVisible * anchorRatio);
  }

  /**
   * Auto-fit price range to visible data with padding.
   * Skipped when manualYScale is true.
   */
  fitPriceRange(bars: Array<{ low: number; high: number }>) {
    if (this.manualYScale) return;

    const start = Math.max(0, Math.floor(this.startIndex));
    const end = Math.min(bars.length, Math.ceil(this.startIndex + this.barsVisible));

    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i < end; i++) {
      const bar = bars[i];
      if (!bar) continue;
      if (bar.low < min) min = bar.low;
      if (bar.high > max) max = bar.high;
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
          const low = bars[i]?.low;
          if (low == null) continue;
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
    if (mode === 'manual') {
      this.manualYScale = true;
    } else {
      this.manualYScale = false;
    }
  }

  /** Pan the price axis vertically by a pixel delta (positive = scroll down = prices shift up). */
  panY(pixelDelta: number) {
    if (this.chartHeight === 0) return;
    const range = this.priceMax - this.priceMin;
    const pricePerPixel = range / this.chartHeight;
    const priceDelta = pixelDelta * pricePerPixel;
    this.priceMin += priceDelta;
    this.priceMax += priceDelta;
    this.manualYScale = true;
  }

  get isYScaleDragging(): boolean {
    return this.yScaleDragging;
  }

  /** Convert bar index to pixel X (center of bar). */
  barToPixelX(index: number): number {
    const slot = this.getVariableBarSlot(index);
    if (slot) {
      return slot.left + slot.width / 2;
    }

    if (this.variableBarLayoutWidths.length > 0) {
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      if (lower !== upper) {
        const lowerSlot = this.getVariableBarSlot(lower);
        const upperSlot = this.getVariableBarSlot(upper);
        if (lowerSlot && upperSlot) {
          const frac = index - lower;
          const lowerCenter = lowerSlot.left + lowerSlot.width / 2;
          const upperCenter = upperSlot.left + upperSlot.width / 2;
          return lowerCenter + (upperCenter - lowerCenter) * frac;
        }
      }
    }

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
    const count = this.variableBarLayoutWidths.length;
    if (count > 0) {
      const firstLeft = this.variableBarLayoutLefts[0];
      const lastIndex = count - 1;
      const lastLeft = this.variableBarLayoutLefts[lastIndex];
      const lastWidth = this.variableBarLayoutWidths[lastIndex];

      if (px <= firstLeft) {
        const firstWidth = this.variableBarLayoutWidths[0] || this.barWidth || 1;
        return this.variableBarLayoutStart + (px - firstLeft) / firstWidth;
      }
      if (px >= lastLeft + lastWidth) {
        const width = lastWidth || this.barWidth || 1;
        return this.variableBarLayoutStart + lastIndex + 1 + (px - (lastLeft + lastWidth)) / width;
      }

      let lo = 0;
      let hi = lastIndex;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const left = this.variableBarLayoutLefts[mid];
        const right = left + this.variableBarLayoutWidths[mid];
        if (px < left) {
          hi = mid - 1;
        } else if (px > right) {
          lo = mid + 1;
        } else {
          const width = this.variableBarLayoutWidths[mid] || 1;
          return this.variableBarLayoutStart + mid + (px - left) / width;
        }
      }
    }

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
    return Math.max(0, Math.min(this.getMaxStart(), v));
  }

  private getVariableBarSlot(index: number): { left: number; width: number } | null {
    if (!Number.isInteger(index) || this.variableBarLayoutWidths.length === 0) return null;
    const offset = index - this.variableBarLayoutStart;
    if (offset < 0 || offset >= this.variableBarLayoutWidths.length) return null;
    return {
      left: this.variableBarLayoutLefts[offset],
      width: this.variableBarLayoutWidths[offset],
    };
  }
}

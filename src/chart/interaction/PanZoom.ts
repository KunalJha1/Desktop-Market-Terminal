import { Viewport } from '../core/Viewport';
import { PRICE_AXIS_WIDTH, TIME_AXIS_HEIGHT } from '../constants';

export class PanZoom {
  private dragging = false;
  private yScaling = false;
  private xScaling = false;
  private xScaleStartX = 0;
  private xScaleAnchorX = 0;
  private xScaleStartBarsVisible = 0;
  private lastX = 0;
  private lastY = 0;
  private dragVx = 0;
  private lastDragTime = 0;
  private onDirty: () => void;
  private viewport: Viewport;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private canvasEl: HTMLCanvasElement | null = null;
  onDetachAutoY: (() => void) | null = null;

  constructor(viewport: Viewport, onDirty: () => void) {
    this.viewport = viewport;
    this.onDirty = onDirty;
  }

  setCanvasWidth(w: number) {
    this.canvasWidth = w;
  }

  setCanvasHeight(h: number) {
    this.canvasHeight = h;
  }

  setCanvasEl(el: HTMLCanvasElement) {
    this.canvasEl = el;
  }

  /** Returns the CSS→viewport scale from any ancestor CSS transform. */
  private getScale(): { sx: number; sy: number } {
    if (!this.canvasEl || this.canvasWidth === 0) return { sx: 1, sy: 1 };
    const rect = this.canvasEl.getBoundingClientRect();
    return {
      sx: rect.width / this.canvasWidth,
      sy: rect.height / (this.canvasEl.offsetHeight || this.canvasWidth),
    };
  }

  private isInTimeAxis(mx: number, my: number): boolean {
    const axisTop = this.canvasHeight - TIME_AXIS_HEIGHT;
    const axisBottom = this.canvasHeight;
    return my >= axisTop && my <= axisBottom && !this.viewport.isInPriceAxis(mx, this.canvasWidth, PRICE_AXIS_WIDTH);
  }

  onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const { sx, sy } = this.getScale();
    const mx = (e.clientX - rect.left) / sx;
    const my = (e.clientY - rect.top) / sy;

    // If clicking on price axis, start Y-scale drag; auto mode detaches first
    if (this.viewport.isInPriceAxis(mx, this.canvasWidth, PRICE_AXIS_WIDTH)) {
      if (this.viewport.yScaleMode === 'auto') {
        this.onDetachAutoY?.();
      }
      this.yScaling = true;
      this.viewport.startYScaleDrag((e.clientY - rect.top) / sy);
      return;
    }

    if (this.isInTimeAxis(mx, my)) {
      this.xScaling = true;
      this.xScaleStartX = mx;
      this.xScaleAnchorX = mx;
      this.xScaleStartBarsVisible = this.viewport.barsVisible;
      return;
    }

    this.viewport.cancelAllAnimations();
    this.dragging = true;
    this.dragVx = 0;
    this.lastDragTime = performance.now();
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  onMouseMove(e: MouseEvent, canvasRect?: DOMRect) {
    if (this.yScaling && canvasRect) {
      const { sy } = this.getScale();
      const my = (e.clientY - canvasRect.top) / sy;
      this.viewport.updateYScaleDrag(my);
      this.onDirty();
      return;
    }

    if (this.xScaling && canvasRect) {
      const { sx } = this.getScale();
      const mouseX = (e.clientX - canvasRect.left) / sx;
      const dx = mouseX - this.xScaleStartX;
      const zoomFactor = Math.exp(-dx / 140);
      const nextBarsVisible = this.xScaleStartBarsVisible * zoomFactor;
      this.viewport.setBarsVisibleAround(nextBarsVisible, this.xScaleAnchorX);
      this.onDirty();
      return;
    }

    if (!this.dragging) return;
    const { sx, sy } = this.getScale();
    // dx is in viewport pixels — divide by scale to get CSS pixel delta
    const dx = (e.clientX - this.lastX) / sx;
    const dy = (e.clientY - this.lastY) / sy;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.viewport.pan(dx);
    // Track drag velocity for inertia on release
    const now = performance.now();
    const elapsed = now - this.lastDragTime;
    if (elapsed > 0 && elapsed < 100 && this.viewport.barWidth > 0) {
      const barDelta = -(dx / this.viewport.barWidth);
      const alpha = 0.7;
      this.dragVx = alpha * (barDelta / elapsed) + (1 - alpha) * this.dragVx;
    }
    this.lastDragTime = now;
    if (this.viewport.yScaleMode === 'manual') {
      this.viewport.panY(dy);
    }
    this.onDirty();
  }

  onMouseUp(_e: MouseEvent) {
    if (this.yScaling) {
      this.viewport.endYScaleDrag();
      this.yScaling = false;
    }
    this.xScaling = false;
    if (this.dragging) {
      this.dragging = false;
      if (Math.abs(this.dragVx) > 0.0001) {
        this.viewport.beginInertia(this.dragVx);
        this.onDirty();
      }
      this.dragVx = 0;
    }
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const { sx } = this.getScale();
    const mouseX = (e.clientX - rect.left) / sx;

    // Normalize delta to CSS pixels regardless of deltaMode
    let deltaY = e.deltaY;
    let deltaX = e.deltaX;
    if (e.deltaMode === 1) {
      // line mode (Firefox default) — ~20px per line
      deltaY *= 20;
      deltaX *= 20;
    } else if (e.deltaMode === 2) {
      // page mode
      deltaY *= 400;
      deltaX *= 400;
    }

    // Wheel on price axis: scale Y; auto mode detaches first
    if (this.viewport.isInPriceAxis(mouseX, this.canvasWidth, PRICE_AXIS_WIDTH)) {
      if (this.viewport.yScaleMode === 'auto') {
        this.onDetachAutoY?.();
      }
      this.viewport.manualYScale = true;
      const range = this.viewport.priceMax - this.viewport.priceMin;
      // Smooth exponential scale proportional to actual scroll amount
      const scaleFactor = Math.exp(deltaY * 0.0008);
      const newRange = range * scaleFactor;
      const center = (this.viewport.priceMax + this.viewport.priceMin) / 2;
      this.viewport.priceMin = center - newRange / 2;
      this.viewport.priceMax = center + newRange / 2;
      this.onDirty();
      return;
    }

    // Trackpad horizontal scroll → pan
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      this.viewport.pan(-deltaX);
      this.onDirty();
      return;
    }

    // Vertical scroll → smooth animated zoom
    const zoomFactor = Math.exp(deltaY * 0.0012);
    this.viewport.beginZoomTo(zoomFactor, mouseX);
    this.onDirty();
  }

  // Double-click on price axis resets to auto-fit
  onDoubleClick(e: MouseEvent) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const { sx } = this.getScale();
    const mx = (e.clientX - rect.left) / sx;
    if (this.viewport.isInPriceAxis(mx, this.canvasWidth, PRICE_AXIS_WIDTH)) {
      this.viewport.resetYScale();
      this.onDirty();
    }
  }

  get isDragging() {
    return this.dragging || this.yScaling || this.xScaling;
  }
}

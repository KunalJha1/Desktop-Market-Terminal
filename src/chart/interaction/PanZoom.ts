import { Viewport } from '../core/Viewport';
import { PRICE_AXIS_WIDTH } from '../constants';

export class PanZoom {
  private dragging = false;
  private yScaling = false;
  private lastX = 0;
  private onDirty: () => void;
  private viewport: Viewport;
  private canvasWidth = 0;

  constructor(viewport: Viewport, onDirty: () => void) {
    this.viewport = viewport;
    this.onDirty = onDirty;
  }

  setCanvasWidth(w: number) {
    this.canvasWidth = w;
  }

  onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;

    // If clicking on price axis, start Y-scale drag
    if (this.viewport.isInPriceAxis(mx, this.canvasWidth, PRICE_AXIS_WIDTH)) {
      this.yScaling = true;
      this.viewport.startYScaleDrag(e.clientY - rect.top);
      return;
    }

    this.dragging = true;
    this.lastX = e.clientX;
  }

  onMouseMove(e: MouseEvent, canvasRect?: DOMRect) {
    if (this.yScaling && canvasRect) {
      const my = e.clientY - canvasRect.top;
      this.viewport.updateYScaleDrag(my);
      this.onDirty();
      return;
    }

    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    this.viewport.pan(dx);
    this.onDirty();
  }

  onMouseUp(_e: MouseEvent) {
    if (this.yScaling) {
      this.viewport.endYScaleDrag();
      this.yScaling = false;
    }
    this.dragging = false;
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // Wheel on price axis: scale Y
    if (this.viewport.isInPriceAxis(mouseX, this.canvasWidth, PRICE_AXIS_WIDTH)) {
      this.viewport.manualYScale = true;
      const range = this.viewport.priceMax - this.viewport.priceMin;
      const scaleFactor = e.deltaY > 0 ? 1.05 : 0.95;
      const newRange = range * scaleFactor;
      const center = (this.viewport.priceMax + this.viewport.priceMin) / 2;
      this.viewport.priceMin = center - newRange / 2;
      this.viewport.priceMax = center + newRange / 2;
      this.onDirty();
      return;
    }

    this.viewport.zoom(e.deltaY > 0 ? -1 : 1, mouseX);
    this.onDirty();
  }

  // Double-click on price axis resets to auto-fit
  onDoubleClick(e: MouseEvent) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (this.viewport.isInPriceAxis(mx, this.canvasWidth, PRICE_AXIS_WIDTH)) {
      this.viewport.resetYScale();
      this.onDirty();
    }
  }

  get isDragging() {
    return this.dragging || this.yScaling;
  }
}

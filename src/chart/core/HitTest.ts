import { Viewport } from './Viewport';
import type { OHLCVBar } from '../types';

export interface HitResult {
  barIndex: number;
  bar: OHLCVBar | null;
  price: number;
  pixelX: number;     // raw mouse X — used for vertical crosshair line
  barPixelX: number;  // snapped bar center — used for time label centering
  pixelY: number;
  inChart: boolean;
}

/**
 * Maps mouse/pointer coordinates to data coordinates.
 */
export class HitTest {
  test(viewport: Viewport, bars: OHLCVBar[], mouseX: number, mouseY: number): HitResult {
    const barIndex = Math.round(viewport.pixelXToBar(mouseX) - 0.5);
    const clampedIndex = Math.max(0, Math.min(bars.length - 1, barIndex));
    const bar = bars.length > 0 ? bars[clampedIndex] : null;
    const price = viewport.pixelYToPrice(mouseY);

    const inChart =
      mouseX >= viewport.chartLeft &&
      mouseX <= viewport.chartLeft + viewport.chartWidth &&
      mouseY >= viewport.chartTop &&
      mouseY <= viewport.chartTop + viewport.chartHeight;

    return {
      barIndex: clampedIndex,
      bar,
      price,
      pixelX: mouseX,
      barPixelX: bar ? viewport.barToPixelX(clampedIndex) : mouseX,
      pixelY: mouseY,
      inChart,
    };
  }
}

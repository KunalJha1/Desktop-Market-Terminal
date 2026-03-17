import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS } from '../constants';

export class LineRenderer {
  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[]) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));
    if (end - start < 2) return;

    const points: [number, number][] = [];
    for (let i = start; i < end; i++) {
      points.push([viewport.barToPixelX(i), viewport.priceToPixelY(bars[i].close)]);
    }

    renderer.polyline(points, COLORS.areaStroke, 1.5);
  }
}

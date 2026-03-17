import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS } from '../constants';

export class AreaRenderer {
  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[]) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));
    if (end - start < 2) return;

    const linePoints: [number, number][] = [];
    for (let i = start; i < end; i++) {
      linePoints.push([viewport.barToPixelX(i), viewport.priceToPixelY(bars[i].close)]);
    }

    // Fill area
    const bottom = viewport.chartTop + viewport.chartHeight;
    const areaPoints: [number, number][] = [
      [linePoints[0][0], bottom],
      ...linePoints,
      [linePoints[linePoints.length - 1][0], bottom],
    ];

    // Gradient fill
    const ctx = renderer.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(areaPoints[0][0], areaPoints[0][1]);
    for (let i = 1; i < areaPoints.length; i++) {
      ctx.lineTo(areaPoints[i][0], areaPoints[i][1]);
    }
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, viewport.chartTop, 0, bottom);
    grad.addColorStop(0, COLORS.areaFill);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // Stroke line on top
    renderer.polyline(linePoints, COLORS.areaStroke, 1.5);
  }
}

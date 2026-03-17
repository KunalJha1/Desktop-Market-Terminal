import { Renderer } from './Renderer';
import { Viewport } from './Viewport';
import { COLORS, PRICE_AXIS_WIDTH } from '../constants';

/**
 * Price axis: computes nice-number tick marks and renders labels.
 */
export class ScaleY {
  /**
   * Compute nice price ticks for the visible range.
   */
  computeTicks(viewport: Viewport, maxTicks: number = 10): number[] {
    const range = viewport.priceMax - viewport.priceMin;
    if (range <= 0) return [];

    const rawStep = range / maxTicks;
    const step = niceNumber(rawStep, false);

    const start = Math.ceil(viewport.priceMin / step) * step;
    const ticks: number[] = [];
    for (let v = start; v <= viewport.priceMax; v += step) {
      ticks.push(Math.round(v * 1e8) / 1e8); // avoid floating point drift
    }
    return ticks;
  }

  render(renderer: Renderer, viewport: Viewport, canvasWidth: number) {
    const ticks = this.computeTicks(viewport);
    const axisX = canvasWidth - PRICE_AXIS_WIDTH;

    // Background for price axis
    renderer.rect(axisX, viewport.chartTop, PRICE_AXIS_WIDTH, viewport.chartHeight, COLORS.bgPanel);

    // Separator line
    renderer.line(axisX, viewport.chartTop, axisX, viewport.chartTop + viewport.chartHeight, COLORS.border);

    for (const tick of ticks) {
      const y = viewport.priceToPixelY(tick);
      if (y < viewport.chartTop || y > viewport.chartTop + viewport.chartHeight) continue;

      // Grid line
      renderer.line(viewport.chartLeft, y, axisX, y, COLORS.gridLine);

      // Label
      const label = formatPrice(tick);
      renderer.text(label, axisX + 6, y, COLORS.textSecondary, 'left');
    }
  }

  renderSubPane(
    renderer: Renderer,
    top: number,
    height: number,
    min: number,
    max: number,
    canvasWidth: number,
  ) {
    const axisX = canvasWidth - PRICE_AXIS_WIDTH;
    const range = max - min;
    if (range <= 0) return;

    // BG
    renderer.rect(axisX, top, PRICE_AXIS_WIDTH, height, COLORS.bgPanel);
    renderer.line(axisX, top, axisX, top + height, COLORS.border);

    const step = niceNumber(range / 4, false);
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max; v += step) {
      const ratio = (max - v) / range;
      const y = top + ratio * height;
      if (y < top + 5 || y > top + height - 5) continue;
      renderer.line(0, y, axisX, y, COLORS.gridLine);
      renderer.textSmall(v.toFixed(1), axisX + 4, y, COLORS.textMuted, 'left');
    }
  }
}

function niceNumber(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice: number;
  if (round) {
    nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  } else {
    nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  }
  return nice * Math.pow(10, exp);
}

function formatPrice(price: number): string {
  if (price >= 10000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(1);
  return price.toFixed(2);
}

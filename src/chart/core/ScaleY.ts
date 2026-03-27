import { Renderer } from './Renderer';
import { Viewport } from './Viewport';
import { COLORS, PRICE_AXIS_CONTROL_HEIGHT, PRICE_AXIS_WIDTH } from '../constants';
import type { YScaleMode } from '../types';

/**
 * Price axis: computes nice-number tick marks and renders labels.
 */
export class ScaleY {
  /**
   * Compute nice price ticks for the visible range.
   */
  computeTicks(viewport: Viewport, maxTicks: number = 10): number[] {
    if (viewport.yScaleMode === 'log') {
      const min = viewport.priceMin;
      const max = viewport.priceMax;
      if (min <= 0 || max <= 0) return [];
      const logMin = Math.log10(min);
      const logMax = Math.log10(max);
      const range = logMax - logMin;
      if (range <= 0) return [];

      const rawStep = range / maxTicks;
      const step = niceNumber(rawStep, false);
      const start = Math.ceil(logMin / step) * step;
      const ticks: number[] = [];
      for (let v = start; v <= logMax; v += step) {
        ticks.push(Math.pow(10, v));
      }
      return ticks;
    }

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
    const footerTop = viewport.chartTop + viewport.chartHeight - PRICE_AXIS_CONTROL_HEIGHT;

    // Background for price axis
    renderer.rect(axisX, viewport.chartTop, PRICE_AXIS_WIDTH, viewport.chartHeight, COLORS.bgPanel);
    renderer.rect(axisX, footerTop, PRICE_AXIS_WIDTH, PRICE_AXIS_CONTROL_HEIGHT, '#10161E');

    // Separator line
    renderer.line(axisX, viewport.chartTop, axisX, viewport.chartTop + viewport.chartHeight, COLORS.border);
    renderer.line(axisX, footerTop, canvasWidth, footerTop, COLORS.border);

    for (const tick of ticks) {
      const y = viewport.priceToPixelY(tick);
      if (y < viewport.chartTop || y > footerTop - 6) continue;

      // Label
      const label = formatPrice(tick);
      renderer.text(label, axisX + 6, y, COLORS.textPrimary, 'left');
    }
  }

  renderGrid(renderer: Renderer, viewport: Viewport, canvasWidth: number) {
    const ticks = this.computeTicks(viewport);
    const axisX = canvasWidth - PRICE_AXIS_WIDTH;

    for (const tick of ticks) {
      const y = viewport.priceToPixelY(tick);
      if (y < viewport.chartTop || y > viewport.chartTop + viewport.chartHeight) continue;
      renderer.line(viewport.chartLeft, y, axisX, y, COLORS.gridLine);
    }
  }

  renderSubPane(
    renderer: Renderer,
    top: number,
    height: number,
    min: number,
    max: number,
    canvasWidth: number,
    mode: YScaleMode = 'auto',
    showTicks: boolean = true,
    reserveFooter: boolean = true,
  ) {
    const axisX = canvasWidth - PRICE_AXIS_WIDTH;
    const footerTop = reserveFooter ? top + height - PRICE_AXIS_CONTROL_HEIGHT : top + height;

    // BG
    renderer.rect(axisX, top, PRICE_AXIS_WIDTH, height, COLORS.bgPanel);
    if (reserveFooter) {
      renderer.rect(axisX, footerTop, PRICE_AXIS_WIDTH, PRICE_AXIS_CONTROL_HEIGHT, '#10161E');
    }
    renderer.line(axisX, top, axisX, top + height, COLORS.border);
    if (reserveFooter) {
      renderer.line(axisX, footerTop, canvasWidth, footerTop, COLORS.border);
    }
    if (!showTicks) return;

    if (mode === 'log' && min > 0 && max > 0) {
      const logMin = Math.log10(min);
      const logMax = Math.log10(max);
      const logRange = logMax - logMin;
      if (logRange <= 0) return;

      const rawStep = logRange / 4;
      const step = niceNumber(rawStep, false);
      const start = Math.ceil(logMin / step) * step;
      for (let lv = start; lv <= logMax; lv += step) {
        const v = Math.pow(10, lv);
        const ratio = (logMax - lv) / logRange;
        const y = top + ratio * height;
        if (y < top + 5 || y > footerTop - 5) continue;
        renderer.line(0, y, axisX, y, COLORS.gridLine);
        renderer.textSmall(formatPrice(v), axisX + 4, y, COLORS.textPrimary, 'left');
      }
      return;
    }

    const range = max - min;
    if (range <= 0) return;

    const step = niceNumber(range / 4, false);
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max; v += step) {
      const ratio = (max - v) / range;
      const y = top + ratio * height;
      if (y < top + 5 || y > footerTop - 5) continue;
      renderer.line(0, y, axisX, y, COLORS.gridLine);
      renderer.textSmall(formatPrice(v), axisX + 4, y, COLORS.textPrimary, 'left');
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
  return price.toFixed(2);
}

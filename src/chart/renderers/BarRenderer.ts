import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO } from '../constants';

/**
 * OHLC bar chart: vertical line high-low, left tick open, right tick close.
 */
export class BarRenderer {
  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[]) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));
    const tickWidth = Math.max(2, viewport.barWidth * BAR_BODY_RATIO * 0.5);

    for (let i = start; i < end; i++) {
      const bar = bars[i];
      const cx = viewport.barToPixelX(i);
      const bullish = bar.close >= bar.open;
      const color = bullish ? COLORS.green : COLORS.red;

      const yHigh = viewport.priceToPixelY(bar.high);
      const yLow = viewport.priceToPixelY(bar.low);
      const yOpen = viewport.priceToPixelY(bar.open);
      const yClose = viewport.priceToPixelY(bar.close);

      // Vertical line
      renderer.line(cx, yHigh, cx, yLow, color, 1);
      // Open tick (left)
      renderer.line(cx - tickWidth, yOpen, cx, yOpen, color, 1);
      // Close tick (right)
      renderer.line(cx, yClose, cx + tickWidth, yClose, color, 1);
    }
  }
}

import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO } from '../constants';

export class CandlestickRenderer {
  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[]) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));
    const bodyWidth = Math.max(1, viewport.barWidth * BAR_BODY_RATIO);

    for (let i = start; i < end; i++) {
      const bar = bars[i];
      const cx = viewport.barToPixelX(i);
      const bullish = bar.close >= bar.open;
      const color = bullish ? COLORS.green : COLORS.red;

      const yHigh = viewport.priceToPixelY(bar.high);
      const yLow = viewport.priceToPixelY(bar.low);
      const yOpen = viewport.priceToPixelY(bar.open);
      const yClose = viewport.priceToPixelY(bar.close);

      // Wick
      renderer.line(cx, yHigh, cx, yLow, color, 1);

      // Body
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yOpen - yClose));
      renderer.rect(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyH, color);
    }
  }
}

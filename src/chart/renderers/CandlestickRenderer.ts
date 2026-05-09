import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO } from '../constants';
import { isWeekendGap } from '../core/timeUtils';

export class CandlestickRenderer {
  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[]) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));
    const bodyWidth = Math.max(1, viewport.barWidth * BAR_BODY_RATIO);

    for (let i = start; i < end; i++) {
      const bar = bars[i];
      if (isWeekendGap(bar.time)) continue;
      const cx = viewport.barToPixelX(i);
      const bullish = bar.close >= bar.open;
      const color = bullish ? COLORS.green : COLORS.red;

      const yHigh = viewport.priceToPixelY(bar.high);
      const yLow = viewport.priceToPixelY(bar.low);
      const yOpen = viewport.priceToPixelY(bar.open);
      const yClose = viewport.priceToPixelY(bar.close);

      // Draw wicks as separate hairlines so very small upper/lower wicks do
      // not turn into square 1px caps at the candle extremes.
      const wickX = Math.round(cx) + 0.5;
      const bodyTop = Math.min(yOpen, yClose);
      const bodyBottom = Math.max(yOpen, yClose);
      const upperWickEnd = Math.min(bodyTop, yLow);
      const lowerWickStart = Math.max(bodyBottom, yHigh);
      renderer.ctx.fillStyle = color;
      renderer.ctx.strokeStyle = color;
      renderer.ctx.lineWidth = 1;
      renderer.ctx.lineCap = 'butt';
      renderer.ctx.beginPath();
      if (upperWickEnd - yHigh >= 1) {
        renderer.ctx.moveTo(wickX, Math.round(yHigh) + 0.5);
        renderer.ctx.lineTo(wickX, Math.round(upperWickEnd) + 0.5);
      }
      if (yLow - lowerWickStart >= 1) {
        renderer.ctx.moveTo(wickX, Math.round(lowerWickStart) + 0.5);
        renderer.ctx.lineTo(wickX, Math.round(yLow) + 0.5);
      }
      renderer.ctx.stroke();

      // Body
      const bodyH = Math.max(1, Math.abs(yOpen - yClose));
      renderer.rect(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyH, color);
    }
  }
}

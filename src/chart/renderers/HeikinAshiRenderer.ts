import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO } from '../constants';

export class HeikinAshiRenderer {
  /**
   * Compute Heikin-Ashi bars from regular OHLCV.
   */
  static computeHA(bars: OHLCVBar[]): OHLCVBar[] {
    if (bars.length === 0) return [];
    const ha: OHLCVBar[] = [];

    let prevOpen = bars[0].open;
    let prevClose = (bars[0].open + bars[0].high + bars[0].low + bars[0].close) / 4;

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const haClose = (b.open + b.high + b.low + b.close) / 4;
      const haOpen = (prevOpen + prevClose) / 2;
      const haHigh = Math.max(b.high, haOpen, haClose);
      const haLow = Math.min(b.low, haOpen, haClose);

      ha.push({
        time: b.time,
        open: haOpen,
        high: haHigh,
        low: haLow,
        close: haClose,
        volume: b.volume,
      });

      prevOpen = haOpen;
      prevClose = haClose;
    }

    return ha;
  }

  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[]) {
    const ha = HeikinAshiRenderer.computeHA(bars);
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(ha.length, Math.ceil(viewport.endIndex));
    const bodyWidth = Math.max(1, viewport.barWidth * BAR_BODY_RATIO);

    for (let i = start; i < end; i++) {
      const bar = ha[i];
      const cx = viewport.barToPixelX(i);
      const bullish = bar.close >= bar.open;
      const color = bullish ? COLORS.green : COLORS.red;

      const yHigh = viewport.priceToPixelY(bar.high);
      const yLow = viewport.priceToPixelY(bar.low);
      const yOpen = viewport.priceToPixelY(bar.open);
      const yClose = viewport.priceToPixelY(bar.close);

      renderer.line(cx, yHigh, cx, yLow, color, 1);

      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yOpen - yClose));
      renderer.rect(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyH, color);
    }
  }
}

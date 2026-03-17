import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO } from '../constants';

/**
 * Volume-Weighted Candlestick Renderer.
 *
 * Body width scales with relative volume — high-volume bars are wider,
 * low-volume bars are thinner. This gives an instant visual read on
 * which price moves had conviction behind them.
 */
export class VolumeWeightedRenderer {
  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[]) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));
    if (start >= end) return;

    // Find max volume in visible range for normalization
    let maxVol = 0;
    for (let i = start; i < end; i++) {
      if (bars[i].volume > maxVol) maxVol = bars[i].volume;
    }
    if (maxVol === 0) maxVol = 1;

    const baseWidth = viewport.barWidth * BAR_BODY_RATIO;

    for (let i = start; i < end; i++) {
      const bar = bars[i];
      const cx = viewport.barToPixelX(i);
      const bullish = bar.close >= bar.open;
      const color = bullish ? COLORS.green : COLORS.red;

      const yHigh = viewport.priceToPixelY(bar.high);
      const yLow = viewport.priceToPixelY(bar.low);
      const yOpen = viewport.priceToPixelY(bar.open);
      const yClose = viewport.priceToPixelY(bar.close);

      // Scale body width: min 20% of base, max 100% of base
      const volRatio = bar.volume / maxVol;
      const bodyWidth = Math.max(1, baseWidth * (0.2 + 0.8 * volRatio));

      // Wick (always 1px)
      renderer.line(cx, yHigh, cx, yLow, color, 1);

      // Body — width proportional to volume
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yOpen - yClose));
      renderer.rect(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyH, color);
    }
  }
}

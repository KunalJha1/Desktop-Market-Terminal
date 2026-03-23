import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO } from '../constants';

/** Convert hex color (#RRGGBB) to rgba string. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

/**
 * Volume-Weighted Candlestick Renderer.
 *
 * Encodes volume through visual channels that scale with zoom level:
 *   1. Opacity — high-volume bars are fully opaque, low-volume bars fade
 *   2. Border thickness — scales proportionally with both volume and barWidth
 *   3. Glow — top-20% volume bars get a capped soft halo
 *   4. Hollow bodies — low-volume candles render as outlines when zoomed in
 *
 * Body width stays constant (same as regular candlesticks) so there are no gaps.
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

    // Constant body width — identical spacing to regular candlesticks
    const barW = viewport.barWidth;
    const bodyWidth = Math.max(1, barW * BAR_BODY_RATIO);

    for (let i = start; i < end; i++) {
      const bar = bars[i];
      const cx = viewport.barToPixelX(i);
      const bullish = bar.close >= bar.open;
      const color = bullish ? COLORS.green : COLORS.red;

      const yHigh = viewport.priceToPixelY(bar.high);
      const yLow = viewport.priceToPixelY(bar.low);
      const yOpen = viewport.priceToPixelY(bar.open);
      const yClose = viewport.priceToPixelY(bar.close);

      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yOpen - yClose));

      const volRatio = bar.volume / maxVol;

      // Channel 1: Opacity — fades low-volume bars
      const alpha = 0.3 + 0.7 * volRatio;
      const colorRgba = hexToRgba(color, alpha);

      // Channel 3: Glow — soft halo behind high-volume bars (top 20%)
      // Pad is capped so it never bleeds into neighboring bars
      if (volRatio > 0.8 && bodyWidth >= 4) {
        const glowPad = Math.min(bodyWidth * 0.2, barW * 0.4);
        const glowAlpha = 0.08 + 0.12 * ((volRatio - 0.8) / 0.2);
        // Gradient fade: colored at top → transparent at bottom for soft halo
        renderer.gradientRect(
          cx - bodyWidth / 2 - glowPad,
          bodyTop - glowPad,
          bodyWidth + glowPad * 2,
          bodyH + glowPad * 2,
          hexToRgba(color, glowAlpha),
          hexToRgba(color, glowAlpha * 0.2),
        );
      }

      // Wick — scales with zoom so it stays proportional to body
      const wickWidth = Math.max(1, bodyWidth * 0.04);
      renderer.line(cx, yHigh, cx, yLow, colorRgba, wickWidth);

      // Border thickness — scales with both zoom level and volume
      const baseBorder = Math.max(0.5, bodyWidth * 0.015);
      const borderWidth = baseBorder + baseBorder * 2 * volRatio;

      // Channel 4: Hollow bodies for low-volume candles when zoomed in enough
      if (bodyWidth >= 12 && volRatio < 0.3) {
        // Hollow — outline only, no fill → reads as "quiet / no conviction"
        renderer.rectStroke(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyH, hexToRgba(color, 0.5), borderWidth);
      } else {
        // Solid body fill + scaled border
        renderer.rect(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyH, colorRgba);
        renderer.rectStroke(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyH, color, borderWidth);
      }
    }
  }
}

import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO, VOLUME_PANE_RATIO } from '../constants';

export class VolumeBarRenderer {
  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[]) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));

    // Volume occupies bottom 20% of main chart area
    const volHeight = viewport.chartHeight * VOLUME_PANE_RATIO;
    const volBottom = viewport.chartTop + viewport.chartHeight;

    // Find max volume in visible range
    let maxVol = 0;
    for (let i = start; i < end; i++) {
      if (bars[i].volume > maxVol) maxVol = bars[i].volume;
    }
    if (maxVol === 0) return;

    const bodyWidth = Math.max(1, viewport.barWidth * BAR_BODY_RATIO);

    for (let i = start; i < end; i++) {
      const bar = bars[i];
      const cx = viewport.barToPixelX(i);
      const ratio = bar.volume / maxVol;
      const h = ratio * volHeight;
      const bullish = bar.close >= bar.open;
      const color = bullish ? COLORS.volumeUp : COLORS.volumeDown;

      renderer.rect(cx - bodyWidth / 2, volBottom - h, bodyWidth, h, color);
    }
  }
}

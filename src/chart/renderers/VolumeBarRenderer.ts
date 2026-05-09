import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO, VOLUME_PANE_RATIO } from '../constants';
import { isWeekendGap } from '../core/timeUtils';

interface VolumeBarRenderOptions {
  top?: number;
  height?: number;
  upColor?: string;
  downColor?: string;
  widthRatio?: number;
}

export class VolumeBarRenderer {
  render(
    renderer: Renderer,
    viewport: Viewport,
    bars: OHLCVBar[],
    options: VolumeBarRenderOptions = {},
  ) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));
    if (start >= end) return;

    const top = options.top ?? (viewport.chartTop + viewport.chartHeight * (1 - VOLUME_PANE_RATIO));
    const volHeight = options.height ?? (viewport.chartHeight * VOLUME_PANE_RATIO);
    const volBottom = top + volHeight;
    const upColor = options.upColor ?? COLORS.volumeUp;
    const downColor = options.downColor ?? COLORS.volumeDown;
    const widthRatio = options.widthRatio ?? BAR_BODY_RATIO;

    let maxVol = 0;
    for (let i = start; i < end; i++) {
      if (!isWeekendGap(bars[i].time) && bars[i].volume > maxVol) maxVol = bars[i].volume;
    }
    if (maxVol === 0) return;

    for (let i = start; i < end; i++) {
      const bar = bars[i];
      if (isWeekendGap(bar.time)) continue;
      const slotWidth = viewport.getBarSlotWidth(i);
      const bodyWidth = Math.max(1, Math.min(slotWidth * widthRatio, slotWidth - 1));
      const cx = viewport.barToPixelX(i);
      const ratio = bar.volume / maxVol;
      const h = ratio * volHeight;
      const bullish = bar.close >= bar.open;
      const color = bullish ? upColor : downColor;

      renderer.rect(cx - bodyWidth / 2, volBottom - h, bodyWidth, h, color);
    }
  }
}

import type { Renderer } from '../core/Renderer';
import type { Viewport } from '../core/Viewport';
import type { HitResult } from '../core/HitTest';
import { COLORS } from '../constants';

/**
 * OHLCV data box rendered on the canvas top-left on hover.
 * Indicator labels are handled by the IndicatorLegend HTML overlay.
 */
export class Tooltip {
  render(
    renderer: Renderer,
    viewport: Viewport,
    hit: HitResult | null,
  ) {
    if (!hit?.bar) return;

    const bar = hit.bar;
    const bullish = bar.close >= bar.open;
    const color = bullish ? COLORS.green : COLORS.red;
    const x = viewport.chartLeft + 8;
    const y = viewport.chartTop + 14;
    const spacing = 90;

    const items = [
      { label: 'O', value: bar.open.toFixed(2) },
      { label: 'H', value: bar.high.toFixed(2) },
      { label: 'L', value: bar.low.toFixed(2) },
      { label: 'C', value: bar.close.toFixed(2) },
      { label: 'V', value: formatVolume(bar.volume) },
    ];

    for (let i = 0; i < items.length; i++) {
      const ix = x + i * spacing;
      renderer.text(items[i].label, ix, y, COLORS.textMuted, 'left');
      renderer.text(items[i].value, ix + 14, y, color, 'left');
    }
  }
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toString();
}

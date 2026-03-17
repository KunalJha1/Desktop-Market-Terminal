import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { HitResult } from '../core/HitTest';
import type { ActiveIndicator } from '../types';
import { indicatorRegistry } from '../indicators/registry';
import { COLORS } from '../constants';

/**
 * OHLCV data box + active indicator labels, all in the top-left corner.
 */
export class Tooltip {
  render(
    renderer: Renderer,
    viewport: Viewport,
    hit: HitResult | null,
    activeIndicators: ActiveIndicator[] = [],
  ) {
    const x = viewport.chartLeft + 8;
    let y = viewport.chartTop + 14;

    // OHLCV data
    if (hit?.bar) {
      const bar = hit.bar;
      const bullish = bar.close >= bar.open;
      const color = bullish ? COLORS.green : COLORS.red;
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
      y += 16;
    }

    // Active indicator labels (overlays only — oscillators show in sub-pane)
    for (const ind of activeIndicators) {
      const meta = indicatorRegistry[ind.name];
      if (!meta || !ind.visible) continue;
      if (meta.category !== 'overlay') continue;

      // Indicator name + params
      const paramStr = Object.entries(ind.params)
        .map(([, v]) => v)
        .join(', ');
      const label = `${meta.shortName} (${paramStr})`;

      // Current values at hovered bar
      let valStr = '';
      if (hit?.bar) {
        const barIdx = hit.barIndex;
        const vals = ind.data
          .map((series) => {
            if (barIdx < series.length && !isNaN(series[barIdx])) {
              return series[barIdx].toFixed(2);
            }
            return null;
          })
          .filter(Boolean);
        if (vals.length > 0) valStr = ' ' + vals.join(' / ');
      }

      // Draw with the first output's color
      const color = meta.outputs[0]?.color || COLORS.textSecondary;
      renderer.textSmall(label + valStr, x, y, color, 'left');
      y += 14;
    }
  }
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toString();
}

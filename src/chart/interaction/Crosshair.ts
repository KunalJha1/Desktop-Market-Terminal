import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import { ScaleX } from '../core/ScaleX';
import type { HitResult } from '../core/HitTest';
import { COLORS, PRICE_AXIS_WIDTH, TIME_AXIS_HEIGHT } from '../constants';

export class Crosshair {
  visible = false;
  hit: HitResult | null = null;

  render(renderer: Renderer, viewport: Viewport, scaleX: ScaleX, canvasWidth: number, canvasHeight: number) {
    if (!this.visible || !this.hit || !this.hit.bar) return;
    const { pixelX, barPixelX, pixelY, bar } = this.hit;

    const priceAxisX = canvasWidth - PRICE_AXIS_WIDTH;
    const timeAxisY = canvasHeight - TIME_AXIS_HEIGHT;

    // Vertical line — follows raw cursor position
    renderer.dashedLine(pixelX, viewport.chartTop, pixelX, timeAxisY, COLORS.crosshair, 1, [3, 3]);

    // Horizontal line
    renderer.dashedLine(viewport.chartLeft, pixelY, priceAxisX, pixelY, COLORS.crosshair, 1, [3, 3]);

    // Price label on Y axis
    const price = viewport.pixelYToPrice(pixelY);
    const priceLabel = price.toFixed(2);
    renderer.rect(priceAxisX, pixelY - 10, PRICE_AXIS_WIDTH, 20, COLORS.borderActive);
    renderer.text(priceLabel, priceAxisX + 6, pixelY, COLORS.textPrimary, 'left');

    // Time label on X axis — centered on bar center (snapped)
    const timeLabel = scaleX.formatTimeFull(bar.time);
    const textWidth = timeLabel.length * 7;
    renderer.rect(barPixelX - textWidth / 2 - 4, timeAxisY, textWidth + 8, TIME_AXIS_HEIGHT, COLORS.borderActive);
    renderer.textSmall(timeLabel, barPixelX, timeAxisY + TIME_AXIS_HEIGHT / 2, COLORS.textPrimary, 'center');
  }
}

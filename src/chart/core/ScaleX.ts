import { Renderer } from './Renderer';
import { Viewport } from './Viewport';
import type { OHLCVBar, Timeframe } from '../types';
import { COLORS, TIME_AXIS_HEIGHT } from '../constants';

/**
 * Time axis: renders time labels below the chart.
 */
export class ScaleX {
  timeframe: Timeframe = '1D';

  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[], canvasHeight: number, canvasWidth: number) {
    const axisTop = canvasHeight - TIME_AXIS_HEIGHT;
    const priceAxisX = canvasWidth - 70;

    // Background
    renderer.rect(0, axisTop, canvasWidth, TIME_AXIS_HEIGHT, COLORS.bgPanel);
    renderer.line(0, axisTop, canvasWidth, axisTop, COLORS.border);

    // Determine label spacing: at least 80px between labels
    const minPixelSpacing = 80;
    const barsPerLabel = Math.max(1, Math.ceil(minPixelSpacing / viewport.barWidth));

    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));

    for (let i = start; i < end; i++) {
      if ((i - start) % barsPerLabel !== 0) continue;

      const x = viewport.barToPixelX(i);
      if (x < viewport.chartLeft || x > priceAxisX) continue;

      const label = this.formatTime(bars[i].time);
      renderer.textSmall(label, x, axisTop + TIME_AXIS_HEIGHT / 2, COLORS.textMuted, 'center');
    }
  }

  renderGrid(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[], canvasHeight: number, canvasWidth: number) {
    const axisTop = canvasHeight - TIME_AXIS_HEIGHT;
    const priceAxisX = canvasWidth - 70;

    const minPixelSpacing = 80;
    const barsPerLabel = Math.max(1, Math.ceil(minPixelSpacing / viewport.barWidth));

    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));

    for (let i = start; i < end; i++) {
      if ((i - start) % barsPerLabel !== 0) continue;
      const x = viewport.barToPixelX(i);
      if (x < viewport.chartLeft || x > priceAxisX) continue;
      renderer.line(x, viewport.chartTop, x, axisTop, COLORS.gridLine);
    }
  }

  formatTime(ms: number): string {
    const d = new Date(ms);
    const tf = this.timeframe;

    if (tf === '1D' || tf === '1W' || tf === '1M') {
      const month = d.toLocaleString('en', { month: 'short' });
      return `${month} ${d.getDate()}`;
    }
    if (tf === '4H' || tf === '1H') {
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    // Intraday
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  formatTimeFull(ms: number): string {
    const d = new Date(ms);
    const month = d.toLocaleString('en', { month: 'short' });
    return `${month} ${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

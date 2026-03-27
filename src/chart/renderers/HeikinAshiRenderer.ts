import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO } from '../constants';

export class HeikinAshiRenderer {
  private _ha: OHLCVBar[] = [];
  private _srcLen = 0;
  private _firstSrcTime = 0;
  private _barAtTrackedMinus1Time = 0;
  private _lastBarFingerprint = '';

  private static barFingerprint(b: OHLCVBar): string {
    return `${b.time}:${b.open}:${b.high}:${b.low}:${b.close}`;
  }

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

  private fullRecompute(bars: OHLCVBar[]) {
    this._ha = HeikinAshiRenderer.computeHA(bars);
    this._srcLen = bars.length;
    if (bars.length > 0) {
      this._firstSrcTime = bars[0].time;
      this._barAtTrackedMinus1Time = bars[bars.length - 1].time;
      this._lastBarFingerprint = HeikinAshiRenderer.barFingerprint(bars[bars.length - 1]);
    } else {
      this._firstSrcTime = 0;
      this._barAtTrackedMinus1Time = 0;
      this._lastBarFingerprint = '';
    }
  }

  private extendHa(bars: OHLCVBar[], from: number, to: number) {
    let prevOpen = this._ha[from - 1].open;
    let prevClose = this._ha[from - 1].close;
    for (let i = from; i < to; i++) {
      const b = bars[i];
      const haClose = (b.open + b.high + b.low + b.close) / 4;
      const haOpen = (prevOpen + prevClose) / 2;
      const haHigh = Math.max(b.high, haOpen, haClose);
      const haLow = Math.min(b.low, haOpen, haClose);
      this._ha.push({
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
    this._srcLen = to;
    this._barAtTrackedMinus1Time = bars[this._srcLen - 1].time;
    this._lastBarFingerprint = HeikinAshiRenderer.barFingerprint(bars[bars.length - 1]);
  }

  private patchLastHa(bars: OHLCVBar[]) {
    const n = bars.length;
    if (n === 0 || this._ha.length !== n) {
      this.fullRecompute(bars);
      return;
    }
    const i = n - 1;
    const b = bars[i];
    let prevOpen: number;
    let prevClose: number;
    if (i === 0) {
      prevOpen = b.open;
      prevClose = (b.open + b.high + b.low + b.close) / 4;
    } else {
      prevOpen = this._ha[i - 1].open;
      prevClose = this._ha[i - 1].close;
    }
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = (prevOpen + prevClose) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);
    this._ha[i] = {
      time: b.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: b.volume,
    };
    this._lastBarFingerprint = HeikinAshiRenderer.barFingerprint(b);
  }

  private ensureHa(bars: OHLCVBar[]) {
    if (bars.length === 0) {
      this._ha = [];
      this._srcLen = 0;
      this._firstSrcTime = 0;
      this._barAtTrackedMinus1Time = 0;
      this._lastBarFingerprint = '';
      return;
    }

    const prefixOk = this._srcLen > 0 && bars[0].time === this._firstSrcTime;

    if (!prefixOk || bars.length < this._srcLen || this._ha.length !== this._srcLen) {
      this.fullRecompute(bars);
      return;
    }

    if (bars.length > this._srcLen) {
      if (this._srcLen === 0) {
        this.fullRecompute(bars);
        return;
      }
      if (bars[this._srcLen - 1].time !== this._barAtTrackedMinus1Time) {
        this.fullRecompute(bars);
        return;
      }
      this.extendHa(bars, this._srcLen, bars.length);
      return;
    }

    const last = bars[bars.length - 1];
    const fp = HeikinAshiRenderer.barFingerprint(last);
    if (fp !== this._lastBarFingerprint) {
      this.patchLastHa(bars);
    }
  }

  render(renderer: Renderer, viewport: Viewport, bars: OHLCVBar[]) {
    this.ensureHa(bars);
    const ha = this._ha;
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

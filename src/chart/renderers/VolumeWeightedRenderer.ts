import { Renderer } from '../core/Renderer';
import { Viewport } from '../core/Viewport';
import type { OHLCVBar } from '../types';
import { COLORS, BAR_BODY_RATIO } from '../constants';
import { isWeekendGap } from '../core/timeUtils';

const VOLUME_EMA_PERIOD = 200;
const MIN_WIDTH_SCALE = 0.2;
const MAX_WIDTH_SCALE = 2.0;
const MIN_CANDLE_GAP_PX = 1;
const MAX_CANDLE_GAP_PX = 3;

/**
 * Volume-Weighted Candlestick Renderer.
 *
 * Encodes volume through candle body WIDTH relative to a 200-period EMA of volume:
 *   - Volume at EMA → normal width (same as regular candlestick)
 *   - Volume above EMA → proportionally wider
 *   - Volume below EMA → proportionally narrower
 *
 * Width is clamped to [20%, 200%] of the normal body width, then capped to the
 * available bar slot so neighboring candles do not overlap.
 * Colors are solid green/red (bullish/bearish) with no alpha modulation.
 */
export class VolumeWeightedRenderer {
  private _volumeEma = new Float64Array(0);
  private _trackedLen = 0;
  private _firstSrcTime = 0;
  private _barAtTrackedMinus1Time = 0;
  private _lastVolFingerprint = '';

  private computeVolumeEmaFull(bars: OHLCVBar[]): Float64Array {
    const len = bars.length;
    const ema = new Float64Array(len);
    const k = 2 / (VOLUME_EMA_PERIOD + 1);
    let sum = 0;

    for (let i = 0; i < len; i++) {
      const vol = bars[i].volume;
      if (i < VOLUME_EMA_PERIOD - 1) {
        sum += vol;
        ema[i] = sum / (i + 1);
      } else if (i === VOLUME_EMA_PERIOD - 1) {
        sum += vol;
        ema[i] = sum / VOLUME_EMA_PERIOD;
      } else {
        ema[i] = vol * k + ema[i - 1] * (1 - k);
      }
    }

    this._volumeEma = ema;
    this._trackedLen = len;
    if (len > 0) {
      this._firstSrcTime = bars[0].time;
      this._barAtTrackedMinus1Time = bars[len - 1].time;
      const last = bars[len - 1];
      this._lastVolFingerprint = `${last.time}:${last.volume}`;
    } else {
      this._firstSrcTime = 0;
      this._barAtTrackedMinus1Time = 0;
      this._lastVolFingerprint = '';
    }
    return ema;
  }

  private extendVolumeEma(bars: OHLCVBar[], oldLen: number, newLen: number): Float64Array {
    const k = 2 / (VOLUME_EMA_PERIOD + 1);
    const next = new Float64Array(newLen);
    next.set(this._volumeEma.subarray(0, oldLen));

    if (oldLen < VOLUME_EMA_PERIOD) {
      return this.computeVolumeEmaFull(bars);
    }

    for (let i = oldLen; i < newLen; i++) {
      const vol = bars[i].volume;
      next[i] = vol * k + next[i - 1] * (1 - k);
    }

    this._volumeEma = next;
    this._trackedLen = newLen;
    this._barAtTrackedMinus1Time = bars[newLen - 1].time;
    const last = bars[newLen - 1];
    this._lastVolFingerprint = `${last.time}:${last.volume}`;
    return this._volumeEma;
  }

  private patchLastVolumeEma(bars: OHLCVBar[]) {
    const i = bars.length - 1;
    const k = 2 / (VOLUME_EMA_PERIOD + 1);
    const vol = bars[i].volume;

    if (i < VOLUME_EMA_PERIOD - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) {
        sum += bars[j].volume;
        this._volumeEma[j] = sum / (j + 1);
      }
    } else if (i === VOLUME_EMA_PERIOD - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += bars[j].volume;
      this._volumeEma[i] = sum / VOLUME_EMA_PERIOD;
    } else {
      this._volumeEma[i] = vol * k + this._volumeEma[i - 1] * (1 - k);
    }

    const last = bars[i];
    this._lastVolFingerprint = `${last.time}:${last.volume}`;
  }

  private ensureVolumeEma(bars: OHLCVBar[]): Float64Array {
    const len = bars.length;
    if (len === 0) {
      this._volumeEma = new Float64Array(0);
      this._trackedLen = 0;
      this._firstSrcTime = 0;
      this._barAtTrackedMinus1Time = 0;
      this._lastVolFingerprint = '';
      return this._volumeEma;
    }

    const prefixOk = this._trackedLen > 0 && bars[0].time === this._firstSrcTime;

    if (!prefixOk || len < this._trackedLen || this._volumeEma.length < this._trackedLen) {
      return this.computeVolumeEmaFull(bars);
    }

    if (len > this._trackedLen) {
      if (bars[this._trackedLen - 1].time !== this._barAtTrackedMinus1Time) {
        return this.computeVolumeEmaFull(bars);
      }
      return this.extendVolumeEma(bars, this._trackedLen, len);
    }

    const last = bars[len - 1];
    const fp = `${last.time}:${last.volume}`;
    if (fp !== this._lastVolFingerprint) {
      if (this._volumeEma.length !== len) {
        return this.computeVolumeEmaFull(bars);
      }
      this.patchLastVolumeEma(bars);
    }

    return this._volumeEma;
  }

  updateViewportLayout(viewport: Viewport, bars: OHLCVBar[]) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));
    const blankBarsOnRight = Math.max(0, viewport.endIndex - bars.length);

    if (start >= end || viewport.chartWidth <= 0) {
      viewport.clearVariableBarLayout();
      return;
    }

    const volumeEma = this.ensureVolumeEma(bars);
    const widths = new Float64Array(end - start);
    let visibleWeight = 0;

    for (let i = start; i < end; i++) {
      const emaVol = volumeEma[i] > 0 ? volumeEma[i] : 1;
      const ratio = bars[i].volume / emaVol;
      const weight = Math.max(MIN_WIDTH_SCALE, Math.min(MAX_WIDTH_SCALE, ratio));
      widths[i - start] = weight;
      visibleWeight += weight;
    }

    if (visibleWeight <= 0) {
      viewport.clearVariableBarLayout();
      return;
    }

    const leftTrim = Math.max(0, viewport.startIndex - start);
    const rightTrim = Math.max(0, end - viewport.endIndex);
    visibleWeight -= widths[0] * leftTrim;
    visibleWeight -= widths[widths.length - 1] * rightTrim;

    if (visibleWeight <= 0) {
      viewport.clearVariableBarLayout();
      return;
    }

    // Scale blank space by average visible bar weight so the front buffer occupies
    // the same proportion of the chart as it does for regular candles, regardless
    // of whether current volume is above or below the EMA.
    const numVisibleSlots = (end - start) - leftTrim - rightTrim;
    const avgVisibleWeight = numVisibleSlots > 0 ? visibleWeight / numVisibleSlots : 1;
    const totalWeight = visibleWeight + blankBarsOnRight * avgVisibleWeight;
    if (totalWeight <= 0) {
      viewport.clearVariableBarLayout();
      return;
    }

    const scale = viewport.chartWidth / totalWeight;
    const lefts = new Float64Array(widths.length);
    let cursor = viewport.chartLeft - widths[0] * leftTrim * scale;

    for (let i = 0; i < widths.length; i++) {
      const width = widths[i] * scale;
      lefts[i] = cursor;
      widths[i] = width;
      cursor += width;
    }

    viewport.setVariableBarLayout(start, lefts, widths);
  }

  render(
    renderer: Renderer,
    viewport: Viewport,
    bars: OHLCVBar[],
    options: { upColor?: string; downColor?: string } = {},
  ) {
    const start = Math.max(0, Math.floor(viewport.startIndex));
    const end = Math.min(bars.length, Math.ceil(viewport.endIndex));
    if (start >= end) return;

    const upColor = options.upColor ?? COLORS.green;
    const downColor = options.downColor ?? COLORS.red;

    const barW = viewport.barWidth;
    const candleGap = Math.min(MAX_CANDLE_GAP_PX, Math.max(MIN_CANDLE_GAP_PX, barW * 0.12));

    for (let i = start; i < end; i++) {
      const bar = bars[i];
      if (isWeekendGap(bar.time)) continue;
      const cx = viewport.barToPixelX(i);
      const slotWidth = viewport.getBarSlotWidth(i);
      const bullish = bar.close >= bar.open;
      const color = bullish ? upColor : downColor;

      const yHigh = viewport.priceToPixelY(bar.high);
      const yLow = viewport.priceToPixelY(bar.low);
      const yOpen = viewport.priceToPixelY(bar.open);
      const yClose = viewport.priceToPixelY(bar.close);

      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yOpen - yClose));
      const bodyWidth = Math.max(1, Math.min(slotWidth * BAR_BODY_RATIO, slotWidth - candleGap));
      const halfW = bodyWidth / 2;

      // Wick — crisp 1px line
      renderer.line(cx, yHigh, cx, yLow, color, 1);

      // Body fill — semi-transparent so wicks through wide bars stay readable
      const fillAlpha = 0.82;
      renderer.rect(cx - halfW, bodyTop, bodyWidth, bodyH, hexToRgba(color, fillAlpha));

      // Crisp border on the body for definition at all widths
      if (bodyWidth >= 3) {
        renderer.rectStroke(cx - halfW, bodyTop, bodyWidth, bodyH, color, 1);
      }
    }
  }
}

function hexToRgba(color: string, alpha: number): string {
  // Already rgba — rewrite the alpha component
  const rgbaMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbaMatch) return `rgba(${rgbaMatch[1]},${rgbaMatch[2]},${rgbaMatch[3]},${alpha})`;

  // 6-digit hex
  const hex = color.replace('#', '');
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

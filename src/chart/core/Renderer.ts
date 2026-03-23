import { FONT_MONO, FONT_MONO_SMALL, COLORS } from '../constants';

/**
 * Low-level canvas drawing primitives.
 */
export class Renderer {
  ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  clear(width: number, height: number) {
    this.ctx.fillStyle = COLORS.bgBase;
    this.ctx.fillRect(0, 0, width, height);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width: number = 1) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
    ctx.stroke();
  }

  dashedLine(x1: number, y1: number, x2: number, y2: number, color: string, width: number = 1, dash: number[] = [4, 4]) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  rectStroke(x: number, y: number, w: number, h: number, stroke: string, lineWidth: number = 1) {
    const ctx = this.ctx;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }

  text(text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', font?: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = font || FONT_MONO;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  textSmall(text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left') {
    this.text(text, x, y, color, align, FONT_MONO_SMALL);
  }

  fillArea(points: [number, number][], fillColor: string) {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  polyline(points: [number, number][], color: string, width: number = 1.5) {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.stroke();
  }

  dashedPolyline(points: [number, number][], color: string, width: number = 1.5, dash: number[] = [6, 4]) {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.setLineDash([]);
  }

  clip(x: number, y: number, w: number, h: number, fn: () => void) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    fn();
    ctx.restore();
  }

  gradientRect(x: number, y: number, w: number, h: number, colorTop: string, colorBottom: string) {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, colorTop);
    grad.addColorStop(1, colorBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  image(image: CanvasImageSource, x: number, y: number, w: number, h: number, opacity: number = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(image, x, y, w, h);
    ctx.restore();
  }
}

/** Normalized 0–1 position inside the draggable rect so the Probability Table survives window resize. */

export function clampProbEng01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

export function probEngNormFromPixel(
  x: number,
  y: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): { normX: number; normY: number } {
  const rx = maxX - minX;
  const ry = maxY - minY;
  return {
    normX: rx > 1e-6 ? clampProbEng01((x - minX) / rx) : 0.5,
    normY: ry > 1e-6 ? clampProbEng01((y - minY) / ry) : 0.5,
  };
}

export function probEngPixelFromNorm(
  normX: number,
  normY: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): { x: number; y: number } {
  const rx = maxX - minX;
  const ry = maxY - minY;
  const x = minX + normX * rx;
  const y = minY + normY * ry;
  return {
    x: Math.round(Math.min(Math.max(x, minX), maxX)),
    y: Math.round(Math.min(Math.max(y, minY), maxY)),
  };
}

export function probEngHasNorm(widget: { normX?: number; normY?: number }): boolean {
  return typeof widget.normX === 'number' && Number.isFinite(widget.normX)
    && typeof widget.normY === 'number' && Number.isFinite(widget.normY);
}

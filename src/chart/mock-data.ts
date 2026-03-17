import type { OHLCVBar, Timeframe } from './types';
import { TIMEFRAME_MS } from './constants';

/**
 * Generate mock OHLCV data using geometric Brownian motion.
 * Produces realistic-looking price action for development.
 */
export function generateMockData(
  symbol: string,
  timeframe: Timeframe,
  barCount: number = 2000,
): OHLCVBar[] {
  // Seed based on symbol for reproducibility
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) {
    seed = ((seed << 5) - seed + symbol.charCodeAt(i)) | 0;
  }

  const rng = mulberry32(Math.abs(seed) || 42);

  // Starting price varies by symbol
  const basePrice = 100 + (Math.abs(seed) % 400);
  const dt = TIMEFRAME_MS[timeframe];
  const isIntraday = dt < 86_400_000;

  // GBM parameters
  const mu = 0.0001;     // slight upward drift
  const sigma = 0.015;   // volatility per bar

  const bars: OHLCVBar[] = [];
  let price = basePrice;
  let time = getStartTime(timeframe, barCount);

  for (let i = 0; i < barCount; i++) {
    // Skip weekends for intraday
    if (isIntraday) {
      const day = new Date(time).getUTCDay();
      if (day === 0) time += 86_400_000;
      if (day === 6) time += 2 * 86_400_000;
    }

    // GBM step
    const z = boxMuller(rng);
    const ret = mu + sigma * z;
    const open = price;
    const close = open * Math.exp(ret);

    // Intra-bar volatility for high/low
    const intraVol = sigma * (0.5 + rng() * 0.8);
    const high = Math.max(open, close) * (1 + Math.abs(boxMuller(rng)) * intraVol * 0.5);
    const low = Math.min(open, close) * (1 - Math.abs(boxMuller(rng)) * intraVol * 0.5);

    // Volume with some randomness and mean reversion
    const baseVol = 500_000 + (Math.abs(seed) % 2_000_000);
    const volMultiplier = 0.5 + rng() * 1.5 + Math.abs(z) * 0.5;
    const volume = Math.round(baseVol * volMultiplier);

    bars.push({
      time,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume,
    });

    price = close;
    time += dt;
  }

  return bars;
}

function getStartTime(timeframe: Timeframe, barCount: number): number {
  const dt = TIMEFRAME_MS[timeframe];
  const now = Date.now();
  return now - barCount * dt;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// Seedable PRNG
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform for normal distribution
function boxMuller(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
}

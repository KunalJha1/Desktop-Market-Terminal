import type { OHLCVBar } from '../../types';

const VWAP_ET_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function etDayKey(tsMs: number): string {
  const parts = VWAP_ET_DATE_FORMAT.formatToParts(new Date(tsMs));
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  return `${year}-${month}-${day}`;
}

function isIntradaySeries(bars: OHLCVBar[]): boolean {
  for (let i = 1; i < bars.length; i++) {
    const delta = bars[i].time - bars[i - 1].time;
    if (Number.isFinite(delta) && delta > 0) {
      return delta < 24 * 60 * 60 * 1000;
    }
  }
  return false;
}

export function calculateVwapSeries(bars: OHLCVBar[]): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  const resetDaily = isIntradaySeries(bars);

  let currentDay = '';
  let cumPV = 0;
  let cumV = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const day = etDayKey(bar.time);
    if (resetDaily && day !== currentDay) {
      currentDay = day;
      cumPV = 0;
      cumV = 0;
    } else if (!currentDay) {
      currentDay = day;
    }

    const volume = Number.isFinite(bar.volume) ? bar.volume : 0;
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumPV += typicalPrice * volume;
    cumV += volume;
    out[i] = cumV > 0 ? cumPV / cumV : NaN;
  }

  return out;
}

const ET_WEEKEND_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  hour12: false,
});

/**
 * Returns true if the timestamp falls in the weekend market closure window:
 * Friday 20:00 ET → Sunday 20:00 ET (US equity + futures overnight closed).
 */
export function isWeekendGap(tsMs: number): boolean {
  const parts = ET_WEEKEND_FORMAT.formatToParts(new Date(tsMs));
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);

  if (weekday === 'Sat') return true;
  if (weekday === 'Fri' && hour >= 20) return true;
  if (weekday === 'Sun' && hour < 20) return true;
  return false;
}

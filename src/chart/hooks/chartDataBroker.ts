import type { OHLCVBar } from '../types';
import type { RawBarSize, IbkrBarSizeParam } from '../../lib/historical-request';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PollResult {
  bars: OHLCVBar[];
  source: 'tws' | 'dailyiq' | 'yahoo' | 'cache';
  tsMin: number | null;
  tsMax: number | null;
}

export type PollCallback = (result: PollResult) => void;

export interface PollConfig {
  sidecarPort: number;
  barSizeParam: IbkrBarSizeParam;
  rawBarSize: RawBarSize;
  stepMs: number;
  useDaily: boolean;
}

interface PollEntry {
  callbacks: Map<number, PollCallback>;
  nextId: number;
  timer: ReturnType<typeof setTimeout> | null;
  lastBarTs: number;
  tsMin: number | null;
  tsMax: number | null;
  config: PollConfig;
  fetching: boolean;
}

// ── Module-level state ────────────────────────────────────────────────────────

const IN_FLIGHT = new Map<string, Promise<unknown>>();
const POLL_ENTRIES = new Map<string, PollEntry>();

const BROKER_INTRADAY_POLL_MS = 10_000;
const BROKER_DAILY_POLL_MS = 60_000;
const BROKER_CLOSED_SESSION_POLL_MS = 90_000;

// ── Market session helpers (ET, no external deps) ─────────────────────────────

function _isDst(utcMs: number): boolean {
  const year = new Date(utcMs).getUTCFullYear();
  // DST: 2nd Sunday of March 02:00 EST → 1st Sunday of November 02:00 EDT
  const mar1 = Date.UTC(year, 2, 1);
  const dstStart = mar1 + ((7 - new Date(mar1).getUTCDay()) % 7 + 7) * 86_400_000 + 7 * 3_600_000;
  const nov1 = Date.UTC(year, 10, 1);
  const dstEnd = nov1 + ((7 - new Date(nov1).getUTCDay()) % 7) * 86_400_000 + 6 * 3_600_000;
  return utcMs >= dstStart && utcMs < dstEnd;
}

function _isExtendedOrLiveSession(): boolean {
  const utcMs = Date.now();
  const etMs = utcMs - (_isDst(utcMs) ? 4 : 5) * 3_600_000;
  const et = new Date(etMs);
  if (et.getUTCDay() === 0 || et.getUTCDay() === 6) return false; // weekend
  const hhmm = et.getUTCHours() * 60 + et.getUTCMinutes();
  return hhmm >= 4 * 60 && hhmm < 20 * 60; // 4:00am–8:00pm ET covers pre-market+regular+AH
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function brokerKey(
  symbol: string,
  rawBarSize: RawBarSize,
  sidecarPort: number,
): string {
  return `${symbol}::${rawBarSize}::${sidecarPort}`;
}

function _parseBars(
  payload: { bars: Array<Record<string, number | boolean>> },
): OHLCVBar[] {
  return payload.bars.map(b => ({
    time:   b.time   as number,
    open:   b.open   as number,
    high:   b.high   as number,
    low:    b.low    as number,
    close:  b.close  as number,
    volume: b.volume as number,
    ...(b.synthetic ? { synthetic: true } : {}),
  }));
}

// ── Fetch deduplication ───────────────────────────────────────────────────────

export function dedupFetch<T>(
  key: string,
  fetchFn: () => Promise<T | null>,
): Promise<T | null> {
  const existing = IN_FLIGHT.get(key) as Promise<T | null> | undefined;
  if (existing !== undefined) return existing;

  const promise = fetchFn().finally(() => {
    if (IN_FLIGHT.get(key) === (promise as unknown as Promise<unknown>)) {
      IN_FLIGHT.delete(key);
    }
  });

  IN_FLIGHT.set(key, promise as Promise<unknown>);
  return promise;
}

// ── Poll coordinator ──────────────────────────────────────────────────────────

export function pollSubscribe(
  key: string,
  cfg: PollConfig,
  callback: PollCallback,
): () => void {
  let entry = POLL_ENTRIES.get(key);
  if (!entry) {
    entry = {
      callbacks: new Map(),
      nextId: 0,
      timer: null,
      lastBarTs: 0,
      tsMin: null,
      tsMax: null,
      config: cfg,
      fetching: false,
    };
    POLL_ENTRIES.set(key, entry);
  }

  const id = entry.nextId++;
  entry.callbacks.set(id, callback);

  if (entry.callbacks.size === 1 && entry.timer === null) {
    _scheduleNextPoll(key);
  }

  return () => _unsubscribe(key, id);
}

export function pollUpdateState(
  key: string,
  lastBarTs: number,
  tsMin: number | null,
  tsMax: number | null,
): void {
  const entry = POLL_ENTRIES.get(key);
  if (!entry) return;
  if (lastBarTs > entry.lastBarTs) entry.lastBarTs = lastBarTs;
  if (tsMin !== null && (entry.tsMin === null || tsMin < entry.tsMin)) entry.tsMin = tsMin;
  if (tsMax !== null && (entry.tsMax === null || tsMax > entry.tsMax)) entry.tsMax = tsMax;
}

function _unsubscribe(key: string, id: number): void {
  const entry = POLL_ENTRIES.get(key);
  if (!entry) return;

  entry.callbacks.delete(id);

  if (entry.callbacks.size === 0) {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    POLL_ENTRIES.delete(key);
  }
}

function _pollIntervalMs(entry: PollEntry): number {
  if (entry.config.useDaily) return BROKER_DAILY_POLL_MS;
  return _isExtendedOrLiveSession() ? BROKER_INTRADAY_POLL_MS : BROKER_CLOSED_SESSION_POLL_MS;
}

function _scheduleNextPoll(key: string): void {
  const entry = POLL_ENTRIES.get(key);
  if (!entry || entry.callbacks.size === 0) return;

  entry.timer = setTimeout(() => {
    entry.timer = null;
    _runPoll(key);
  }, _pollIntervalMs(entry));
}

async function _runPoll(key: string): Promise<void> {
  const entry = POLL_ENTRIES.get(key);
  if (!entry || entry.callbacks.size === 0) return;

  if (entry.fetching) {
    _scheduleNextPoll(key);
    return;
  }

  // No bars reported yet — hooks haven't completed their initial fetch. Skip tick.
  if (entry.lastBarTs === 0) {
    _scheduleNextPoll(key);
    return;
  }

  entry.fetching = true;
  try {
    const { sidecarPort, barSizeParam, stepMs } = entry.config;
    const symbol = key.split('::')[0];

    const url = new URL(`http://127.0.0.1:${sidecarPort}/historical`);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('bar_size', barSizeParam);
    url.searchParams.set('prefer_live_refresh', '1');
    url.searchParams.set('ts_start', String(Math.max(0, entry.lastBarTs - stepMs)));

    const res = await fetch(url.toString());
    if (!res.ok) return;

    const payload = await res.json() as {
      bars: Array<Record<string, number | boolean>>;
      source?: string;
      ts_min?: number;
      ts_max?: number;
    };

    // Re-check entry is still alive after the await
    const liveEntry = POLL_ENTRIES.get(key);
    if (!liveEntry || liveEntry.callbacks.size === 0) return;

    const newBars = _parseBars(payload);

    if (newBars.length > 0) {
      const latestTs = newBars[newBars.length - 1].time;
      if (latestTs > liveEntry.lastBarTs) liveEntry.lastBarTs = latestTs;
    }
    if (payload.ts_min != null && (liveEntry.tsMin === null || payload.ts_min < liveEntry.tsMin)) {
      liveEntry.tsMin = payload.ts_min;
    }
    if (payload.ts_max != null && (liveEntry.tsMax === null || payload.ts_max > liveEntry.tsMax)) {
      liveEntry.tsMax = payload.ts_max;
    }

    if (newBars.length > 0) {
      _dispatchPollResult(key, {
        bars: newBars,
        source: (payload.source as PollResult['source']) ?? 'yahoo',
        tsMin: payload.ts_min ?? null,
        tsMax: payload.ts_max ?? null,
      });
    }
  } catch {
    // Swallow — next tick retries
  } finally {
    const liveEntry = POLL_ENTRIES.get(key);
    if (liveEntry) liveEntry.fetching = false;
    _scheduleNextPoll(key);
  }
}

function _dispatchPollResult(key: string, result: PollResult): void {
  const entry = POLL_ENTRIES.get(key);
  if (!entry) return;
  for (const cb of Array.from(entry.callbacks.values())) {
    try { cb(result); } catch { /* never let one subscriber kill others */ }
  }
}

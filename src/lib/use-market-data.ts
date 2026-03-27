import { useEffect, useSyncExternalStore, useMemo } from "react";
import { type QuoteData, ALL_SYMBOLS } from "./market-data";
import { useTws } from "./tws";
import tickersJson from "../../data/tickers.json";

export type Quote = QuoteData;
export type SymbolStatus = "ok" | "pending" | "error";

const KNOWN_SYMBOLS: Set<string> = new Set([
  ...tickersJson.companies.map((c: { symbol: string }) => c.symbol),
  ...ALL_SYMBOLS.map((s) => s.symbol),
]);

const liveQuotes = new Map<string, QuoteData>();
const storeListeners = new Set<() => void>();
let storeVersion = 0;
const SNAPSHOT_POLL_MS = 5_000;
const ACTIVE_SYMBOLS_REFRESH_MS = 90_000;
const ACTIVE_SYMBOLS_STALE_MS = 90_000;
const POLLER_STOP_GRACE_MS = 1_000;

type PollerState = {
  symbols: Map<string, number>;
  snapshotIntervalId: number | null;
  activeSymbolsIntervalId: number | null;
  stopTimeoutId: number | null;
  subscriberCount: number;
  snapshotInFlight: boolean;
  activeSymbolsInFlight: boolean;
  lastSnapshotRequestKey: string;
  lastActiveSymbolsKey: string;
  lastActiveSymbolsPostedAt: number;
};

const pollersByPort = new Map<number, PollerState>();

function notifyStore() {
  storeVersion++;
  for (const listener of storeListeners) {
    listener();
  }
}

function subscribeToStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

function getStoreVersion(): number {
  return storeVersion;
}

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function getOrCreatePoller(sidecarPort: number): PollerState {
  const existing = pollersByPort.get(sidecarPort);
  if (existing) return existing;
  const created: PollerState = {
    symbols: new Map(),
    snapshotIntervalId: null,
    activeSymbolsIntervalId: null,
    stopTimeoutId: null,
    subscriberCount: 0,
    snapshotInFlight: false,
    activeSymbolsInFlight: false,
    lastSnapshotRequestKey: "",
    lastActiveSymbolsKey: "",
    lastActiveSymbolsPostedAt: 0,
  };
  pollersByPort.set(sidecarPort, created);
  return created;
}

function getTrackedSymbols(poller: PollerState): string[] {
  return Array.from(poller.symbols.keys());
}

function getTrackedSymbolsKey(poller: PollerState): string {
  return getTrackedSymbols(poller).join(",");
}

async function fetchSnapshots(sidecarPort: number, poller: PollerState): Promise<void> {
  const symbols = getTrackedSymbols(poller);
  if (symbols.length === 0 || poller.snapshotInFlight) return;

  poller.snapshotInFlight = true;
  try {
    poller.lastSnapshotRequestKey = symbols.join(",");
    const qs = encodeURIComponent(symbols.join(","));
    const res = await fetch(`http://127.0.0.1:${sidecarPort}/market/snapshots?symbols=${qs}`);
    if (!res.ok) return;
    const payload = await res.json();
    const quotes = (payload.snapshots as Array<Record<string, unknown>>) || [];
    for (const q of quotes) {
      const sym = q.symbol as string;
      if (sym) updateLiveQuote(sym, q);
    }
  } catch {
    // Ignore transient errors
  } finally {
    poller.snapshotInFlight = false;
  }
}

async function registerActiveSymbols(sidecarPort: number, poller: PollerState): Promise<void> {
  const symbols = getTrackedSymbols(poller);
  if (symbols.length === 0 || poller.activeSymbolsInFlight) return;

  poller.activeSymbolsInFlight = true;
  try {
    await fetch(`http://127.0.0.1:${sidecarPort}/active-symbols`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols }),
    });
    poller.lastActiveSymbolsKey = symbols.join(",");
    poller.lastActiveSymbolsPostedAt = Date.now();
  } catch {
    // Ignore transient errors
  } finally {
    poller.activeSymbolsInFlight = false;
  }
}

function ensurePollerRunning(sidecarPort: number, poller: PollerState): void {
  if (poller.stopTimeoutId !== null) {
    window.clearTimeout(poller.stopTimeoutId);
    poller.stopTimeoutId = null;
  }

  if (poller.snapshotIntervalId === null) {
    void fetchSnapshots(sidecarPort, poller);
    poller.snapshotIntervalId = window.setInterval(() => {
      void fetchSnapshots(sidecarPort, poller);
    }, SNAPSHOT_POLL_MS);
  }

  if (poller.activeSymbolsIntervalId === null) {
    void registerActiveSymbols(sidecarPort, poller);
    poller.activeSymbolsIntervalId = window.setInterval(() => {
      const currentKey = getTrackedSymbolsKey(poller);
      const isStale = Date.now() - poller.lastActiveSymbolsPostedAt >= ACTIVE_SYMBOLS_STALE_MS;
      if (currentKey && (currentKey !== poller.lastActiveSymbolsKey || isStale)) {
        void registerActiveSymbols(sidecarPort, poller);
      }
    }, ACTIVE_SYMBOLS_REFRESH_MS);
  }
}

function stopPoller(sidecarPort: number, poller: PollerState): void {
  if (poller.snapshotIntervalId !== null) {
    window.clearInterval(poller.snapshotIntervalId);
    poller.snapshotIntervalId = null;
  }
  if (poller.activeSymbolsIntervalId !== null) {
    window.clearInterval(poller.activeSymbolsIntervalId);
    poller.activeSymbolsIntervalId = null;
  }
  if (poller.stopTimeoutId !== null) {
    window.clearTimeout(poller.stopTimeoutId);
    poller.stopTimeoutId = null;
  }
  pollersByPort.delete(sidecarPort);
}

function subscribeSymbols(sidecarPort: number, symbols: string[]): () => void {
  const normalizedSymbols = normalizeSymbols(symbols);
  if (normalizedSymbols.length === 0) {
    return () => {};
  }

  const poller = getOrCreatePoller(sidecarPort);
  const previousKey = getTrackedSymbolsKey(poller);
  poller.subscriberCount += 1;
  for (const symbol of normalizedSymbols) {
    poller.symbols.set(symbol, (poller.symbols.get(symbol) ?? 0) + 1);
  }
  const currentKey = getTrackedSymbolsKey(poller);

  ensurePollerRunning(sidecarPort, poller);
  if (currentKey !== previousKey && currentKey !== poller.lastSnapshotRequestKey) {
    void fetchSnapshots(sidecarPort, poller);
  }
  if (
    currentKey &&
    (currentKey !== poller.lastActiveSymbolsKey ||
      Date.now() - poller.lastActiveSymbolsPostedAt >= ACTIVE_SYMBOLS_STALE_MS)
  ) {
    void registerActiveSymbols(sidecarPort, poller);
  }

  return () => {
    for (const symbol of normalizedSymbols) {
      const nextCount = (poller.symbols.get(symbol) ?? 0) - 1;
      if (nextCount > 0) {
        poller.symbols.set(symbol, nextCount);
      } else {
        poller.symbols.delete(symbol);
      }
    }

    poller.subscriberCount = Math.max(0, poller.subscriberCount - 1);

    if (poller.symbols.size === 0 && poller.subscriberCount === 0) {
      poller.stopTimeoutId = window.setTimeout(() => {
        if (poller.symbols.size === 0 && poller.subscriberCount === 0) {
          stopPoller(sidecarPort, poller);
        }
      }, POLLER_STOP_GRACE_MS);
    }
  };
}

function _posNum(v: unknown): number | null {
  if (typeof v === "number" && v > 0) return v;
  return null;
}

export function updateLiveQuote(symbol: string, data: Record<string, unknown>): void {
  const existing = liveQuotes.get(symbol);
  const quote: QuoteData = {
    symbol,
    name: (data.name as string) ?? existing?.name ?? symbol,
    last: (data.last as number) ?? existing?.last ?? 0,
    change: (data.change as number) ?? existing?.change ?? 0,
    changePct: (data.changePct as number) ?? existing?.changePct ?? 0,
    bid: _posNum(data.bid) ?? existing?.bid ?? null,
    mid: _posNum(data.mid) ?? existing?.mid ?? null,
    ask: _posNum(data.ask) ?? existing?.ask ?? null,
    open: (data.open as number) ?? existing?.open ?? 0,
    high: (data.high as number) ?? existing?.high ?? 0,
    low: (data.low as number) ?? existing?.low ?? 0,
    prevClose: (data.prevClose as number) ?? existing?.prevClose ?? 0,
    volume: (data.volume as number) ?? existing?.volume ?? 0,
    spread: _posNum(data.spread) ?? existing?.spread ?? null,
    week52High: _posNum(data.week52High) ?? existing?.week52High ?? null,
    week52Low: _posNum(data.week52Low) ?? existing?.week52Low ?? null,
    trailingPE: _posNum(data.trailingPE) ?? existing?.trailingPE ?? null,
    forwardPE: _posNum(data.forwardPE) ?? existing?.forwardPE ?? null,
    marketCap: _posNum(data.marketCap) ?? existing?.marketCap ?? null,
  };
  liveQuotes.set(symbol, quote);
  notifyStore();
}

export interface WatchlistDataResult {
  quotes: Map<string, Quote>;
  status: Map<string, SymbolStatus>;
}

export function useWatchlistData(symbols: string[]): WatchlistDataResult {
  const { sidecarPort } = useTws();
  useEffect(() => {
    if (!sidecarPort) return;
    return subscribeSymbols(sidecarPort, symbols);
  }, [sidecarPort, symbols]);

  const version = useSyncExternalStore(subscribeToStore, getStoreVersion);

  return useMemo(() => {
    const quotes = new Map<string, Quote>();
    const status = new Map<string, SymbolStatus>();

    for (const sym of symbols) {
      if (!sym) continue;
      const live = liveQuotes.get(sym);

      if (live) {
        quotes.set(sym, live);
        status.set(sym, "ok");
      } else if (KNOWN_SYMBOLS.has(sym)) {
        status.set(sym, "pending");
      } else {
        status.set(sym, "error");
      }
    }

    return { quotes, status };
  }, [symbols, version]);
}

export function useQuoteData(_quoteId: string, symbol: string): Quote | null {
  const { sidecarPort } = useTws();

  useEffect(() => {
    if (!sidecarPort) return;
    return subscribeSymbols(sidecarPort, [symbol]);
  }, [sidecarPort, symbol]);

  const version = useSyncExternalStore(subscribeToStore, getStoreVersion);

  return useMemo(() => {
    return liveQuotes.get(symbol) ?? null;
  }, [symbol, version]);
}

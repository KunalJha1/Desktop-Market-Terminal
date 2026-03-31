import { useEffect, useSyncExternalStore, useMemo } from "react";
import { type QuoteData, ALL_SYMBOLS } from "./market-data";
import { isPerfDiagnosticsEnabled } from "./perf-diagnostics";
import { useSidecarPort } from "./tws";
import tickersJson from "../../data/tickers.json";

export type Quote = QuoteData;
export type SymbolStatus = "ok" | "pending" | "error";

const KNOWN_SYMBOLS: Set<string> = new Set([
  ...tickersJson.companies.map((c: { symbol: string }) => c.symbol),
  ...ALL_SYMBOLS.map((s) => s.symbol),
]);

const liveQuotes = new Map<string, QuoteData>();
const symbolListeners = new Map<string, Set<() => void>>();
const sourceListeners = new Set<() => void>();
let globalVersion = 0;
let globalSourceVersion = 0;
let latestObservedSource: string | null = null;
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

function subscribeToSymbols(symbols: string[], listener: () => void): () => void {
  const normalizedSymbols = normalizeSymbols(symbols);
  if (normalizedSymbols.length === 0) {
    return () => {};
  }

  for (const symbol of normalizedSymbols) {
    let listeners = symbolListeners.get(symbol);
    if (!listeners) {
      listeners = new Set();
      symbolListeners.set(symbol, listeners);
    }
    listeners.add(listener);
  }

  return () => {
    for (const symbol of normalizedSymbols) {
      const listeners = symbolListeners.get(symbol);
      if (!listeners) continue;
      listeners.delete(listener);
      if (listeners.size === 0) {
        symbolListeners.delete(symbol);
      }
    }
  };
}

function notifySymbols(symbols: Iterable<string>) {
  globalVersion++;
  const listeners = new Set<() => void>();
  for (const symbol of symbols) {
    const symbolSet = symbolListeners.get(symbol);
    if (!symbolSet) continue;
    for (const listener of symbolSet) {
      listeners.add(listener);
    }
  }
  if (import.meta.env.DEV && isPerfDiagnosticsEnabled() && listeners.size > 0) {
    const symArr = Array.from(new Set(symbols));
    if (symArr.length > 0) {
      const snapshotChars = getSymbolsSnapshot(symArr).length;
      // eslint-disable-next-line no-console
      console.info("[perf] notifySymbols", {
        symbolCount: symArr.length,
        listenerCount: listeners.size,
        snapshotChars,
      });
    }
  }
  for (const listener of listeners) {
    listener();
  }
}

function notifySourceListeners() {
  globalSourceVersion++;
  for (const listener of sourceListeners) {
    listener();
  }
}

function setLatestObservedSource(source: unknown) {
  const normalized = typeof source === "string" && source.trim() ? source.trim().toLowerCase() : null;
  if (normalized === latestObservedSource) return;
  latestObservedSource = normalized;
  notifySourceListeners();
}

function getSymbolsSnapshot(symbols: string[]): string {
  const normalizedSymbols = normalizeSymbols(symbols);
  if (normalizedSymbols.length === 0) {
    return `empty:${globalVersion}`;
  }
  return normalizedSymbols
    .map((symbol) => {
      const quote = liveQuotes.get(symbol);
      if (!quote) return `${symbol}:missing`;
      return [
        symbol,
        quote.last,
        quote.change,
        quote.changePct,
        quote.bid,
        quote.ask,
        quote.mid,
        quote.volume,
        quote.prevClose,
        quote.high,
        quote.low,
        quote.open,
        quote.spread,
        quote.week52High,
        quote.week52Low,
        quote.trailingPE,
        quote.forwardPE,
        quote.marketCap,
        quote.source,
      ].join(":");
    })
    .join("|");
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
  const nextSource = typeof data.source === "string" && data.source.trim()
    ? data.source.trim().toLowerCase()
    : existing?.source ?? null;
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
    source: nextSource,
  };
  if (
    existing &&
    existing.name === quote.name &&
    existing.last === quote.last &&
    existing.change === quote.change &&
    existing.changePct === quote.changePct &&
    existing.bid === quote.bid &&
    existing.mid === quote.mid &&
    existing.ask === quote.ask &&
    existing.open === quote.open &&
    existing.high === quote.high &&
    existing.low === quote.low &&
    existing.prevClose === quote.prevClose &&
    existing.volume === quote.volume &&
    existing.spread === quote.spread &&
    existing.week52High === quote.week52High &&
    existing.week52Low === quote.week52Low &&
    existing.trailingPE === quote.trailingPE &&
    existing.forwardPE === quote.forwardPE &&
    existing.marketCap === quote.marketCap &&
    existing.source === quote.source
  ) {
    return;
  }
  liveQuotes.set(symbol, quote);
  setLatestObservedSource(nextSource);
  notifySymbols([symbol]);
}

export function useObservedMarketDataSource(): string | null {
  useSyncExternalStore(
    (listener) => {
      sourceListeners.add(listener);
      return () => {
        sourceListeners.delete(listener);
      };
    },
    () => `${globalSourceVersion}:${latestObservedSource ?? ""}`,
  );

  return latestObservedSource;
}

export interface WatchlistDataResult {
  quotes: Map<string, Quote>;
  status: Map<string, SymbolStatus>;
}

export function useWatchlistData(symbols: string[]): WatchlistDataResult {
  const sidecarPort = useSidecarPort();
  useEffect(() => {
    if (!sidecarPort) return;
    return subscribeSymbols(sidecarPort, symbols);
  }, [sidecarPort, symbols]);

  const snapshot = useSyncExternalStore(
    (listener) => subscribeToSymbols(symbols, listener),
    () => getSymbolsSnapshot(symbols),
  );

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
  }, [symbols, snapshot]);
}

export function useQuoteData(_quoteId: string, symbol: string): Quote | null {
  const sidecarPort = useSidecarPort();

  useEffect(() => {
    if (!sidecarPort) return;
    return subscribeSymbols(sidecarPort, [symbol]);
  }, [sidecarPort, symbol]);

  const snapshot = useSyncExternalStore(
    (listener) => subscribeToSymbols([symbol], listener),
    () => getSymbolsSnapshot([symbol]),
  );

  return useMemo(() => {
    return liveQuotes.get(symbol) ?? null;
  }, [symbol, snapshot]);
}

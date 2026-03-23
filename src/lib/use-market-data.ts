import { useEffect, useRef, useSyncExternalStore, useMemo } from "react";
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

function deleteLiveQuote(symbol: string): void {
  if (liveQuotes.delete(symbol)) {
    notifyStore();
  }
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
  const prevSymbolsRef = useRef<string>("");

  useEffect(() => {
    if (!sidecarPort) return;
    const key = symbols.join(",");
    if (key === prevSymbolsRef.current) return;
    prevSymbolsRef.current = key;
  }, [sidecarPort, symbols]);

  // Register symbols as active so the watchlist worker subscribes them for live quotes.
  // Re-registers every 90s to stay within the worker's 120s TTL.
  useEffect(() => {
    if (!sidecarPort || symbols.length === 0) return;
    const register = () => {
      fetch(`http://127.0.0.1:${sidecarPort}/active-symbols`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      }).catch(() => {});
    };
    register();
    const id = setInterval(register, 90_000);
    return () => clearInterval(id);
  }, [sidecarPort, symbols]);

  useEffect(() => {
    if (!sidecarPort || symbols.length === 0) return;

    let cancelled = false;

    async function fetchQuotes() {
      try {
        const qs = encodeURIComponent(symbols.join(","));
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/market/snapshots?symbols=${qs}`);
        if (!res.ok) return;
        const payload = await res.json();
        const quotes = (payload.snapshots as Array<Record<string, unknown>>) || [];
        if (cancelled) return;
        const returned = new Set<string>();
        for (const q of quotes) {
          const sym = q.symbol as string;
          if (sym) {
            returned.add(sym);
            updateLiveQuote(sym, q);
          }
        }
        for (const sym of symbols) {
          if (!returned.has(sym)) {
            deleteLiveQuote(sym);
          }
        }
      } catch {
        // Ignore transient errors
      }
    }

    fetchQuotes();
    const id = setInterval(fetchQuotes, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
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

export function useQuoteData(quoteId: string, symbol: string): Quote | null {
  const { sidecarPort } = useTws();

  useEffect(() => {
    if (!sidecarPort || !symbol) return;

    let cancelled = false;

    async function fetchQuote() {
      try {
        const qs = encodeURIComponent(symbol);
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/market/snapshots?symbols=${qs}`);
        if (!res.ok) return;
        const payload = await res.json();
        const quotes = (payload.snapshots as Array<Record<string, unknown>>) || [];
        if (cancelled) return;
        for (const q of quotes) {
          const sym = q.symbol as string;
          if (sym) updateLiveQuote(sym, q);
        }
      } catch {
        // Ignore transient errors
      }
    }

    fetchQuote();
    const id = setInterval(fetchQuote, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sidecarPort, symbol, quoteId]);

  const version = useSyncExternalStore(subscribeToStore, getStoreVersion);

  return useMemo(() => {
    return liveQuotes.get(symbol) ?? null;
  }, [symbol, version]);
}

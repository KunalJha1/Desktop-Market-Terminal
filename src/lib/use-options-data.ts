import { useEffect, useMemo, useState } from "react";
import { SEARCHABLE_SYMBOLS, filterRankSymbolSearch } from "./market-data";
import { useSidecarPort } from "./tws";
import { useWatchlist } from "./watchlist";

export interface OptionsExpiration {
  expiration: number;
  label: string;
  contractCount: number;
}

export interface OptionsMonthGroup {
  monthKey: string;
  monthLabel: string;
  expirations: OptionsExpiration[];
}

export type MarketSession = "REGULAR" | "PRE_MARKET" | "AFTER_HOURS" | "CLOSED";

export interface OptionsSummary {
  symbol: string;
  hasData: boolean;
  underlyingPrice: number | null;
  capturedAt: number | null;
  source: string | null;
  session: MarketSession | null;
  months: OptionsMonthGroup[];
}

export interface OptionSide {
  contractId: string;
  underlyingPrice: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  mid: number | null;
  lastPrice: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean | null;
  lastTradeDate: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  intrinsicValue: number | null;
  extrinsicValue: number | null;
  daysToExpiration: number | null;
  riskFreeRate: number | null;
  greeksSource: string | null;
  ivSource: string | null;
  calcError: string | null;
  source: string | null;
}

export interface OptionsChainRow {
  strike: number;
  call: OptionSide | null;
  put: OptionSide | null;
}

export interface OptionsEstimateRow {
  strike: number;
  call: { estPrice: number | null; error: string | null } | null;
  put:  { estPrice: number | null; error: string | null } | null;
}

export interface OptionsEstimate {
  session: string | null;
  available: boolean;
  extendedSpot: number | null;
  rows: OptionsEstimateRow[];
}

export interface OptionsChain {
  symbol: string;
  hasData: boolean;
  expiration: number | null;
  expirationLabel: string | null;
  capturedAt: number | null;
  rows: OptionsChainRow[];
}

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export function useDefaultOptionsSymbol(): string {
  const { symbols } = useWatchlist();
  return useMemo(() => {
    const firstWatchlist = symbols.find((symbol) => symbol.trim());
    return normalizeSymbol(firstWatchlist || "");
  }, [symbols]);
}

export function useOptionsSymbolSuggestions(query: string): typeof SEARCHABLE_SYMBOLS {
  return useMemo(() => {
    const normalized = normalizeSymbol(query);
    if (!normalized) {
      return SEARCHABLE_SYMBOLS.slice(0, 12);
    }
    return filterRankSymbolSearch(SEARCHABLE_SYMBOLS, normalized, { limit: 12 });
  }, [query]);
}

export function useOptionsSummary(symbol: string): {
  summary: OptionsSummary | null;
  loading: boolean;
  error: string | null;
} {
  const sidecarPort = useSidecarPort();
  const [summary, setSummary] = useState<OptionsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const normalized = normalizeSymbol(symbol);
    if (!sidecarPort || !normalized) {
      setSummary(null);
      setLoading(false);
      setError(sidecarPort ? null : "Sidecar disconnected");
      return;
    }

    let cancelled = false;
    let hasFetched = false;
    async function fetchSummary() {
      if (!hasFetched) setLoading(true);
      try {
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/options/summary?symbol=${encodeURIComponent(normalized)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json() as OptionsSummary;
        if (!cancelled) {
          hasFetched = true;
          setSummary(payload);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Options summary unavailable");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSummary();
    const id = setInterval(fetchSummary, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sidecarPort, symbol]);

  return { summary, loading, error };
}

export function useOptionsChain(symbol: string, expiration: number | null): {
  chain: OptionsChain | null;
  loading: boolean;
  error: string | null;
} {
  const sidecarPort = useSidecarPort();
  const [chain, setChain] = useState<OptionsChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const normalized = normalizeSymbol(symbol);
    if (!sidecarPort || !normalized || !expiration) {
      setChain(null);
      setLoading(false);
      setError(sidecarPort ? null : "Sidecar disconnected");
      return;
    }

    let cancelled = false;
    let hasFetched = false;
    async function fetchChain() {
      if (!hasFetched) setLoading(true);
      try {
        const url = `http://127.0.0.1:${sidecarPort}/options/chain?symbol=${encodeURIComponent(normalized)}&expiration=${expiration}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json() as OptionsChain;
        if (!cancelled) {
          hasFetched = true;
          setChain(payload);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Options chain unavailable");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchChain();
    const id = setInterval(fetchChain, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sidecarPort, symbol, expiration]);

  return { chain, loading, error };
}

export function useOptionsEstimate(
  symbol: string,
  expiration: number | null,
  session: string | null,
): OptionsEstimate | null {
  const sidecarPort = useSidecarPort();
  const [estimate, setEstimate] = useState<OptionsEstimate | null>(null);
  const active = session === "PRE_MARKET" || session === "AFTER_HOURS" || session === "CLOSED";

  useEffect(() => {
    const normalized = normalizeSymbol(symbol);
    if (!sidecarPort || !normalized || !expiration || !active) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    async function fetchEstimate() {
      try {
        const url = `http://127.0.0.1:${sidecarPort}/options/estimate?symbol=${encodeURIComponent(normalized)}&expiration=${expiration}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const payload = await res.json();
        if (!cancelled) setEstimate(payload as OptionsEstimate);
      } catch { /* silent */ }
    }
    fetchEstimate();
    const id = setInterval(fetchEstimate, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sidecarPort, symbol, expiration, active]);

  return active ? estimate : null;
}

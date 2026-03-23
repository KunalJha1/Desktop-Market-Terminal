import { useEffect, useMemo, useState } from "react";
import { useTws } from "./tws";

export interface PortfolioPosition {
  account: string;
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  primaryExchange?: string | null;
  secType: string;
  quantity: number;
  avgCost: number;
  costBasis: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
}

export interface CashBalance {
  account: string;
  currency: string;
  balance: number;
}

export interface PortfolioSnapshot {
  connected: boolean;
  host: string;
  port: number | null;
  positions: PortfolioPosition[];
  cashBalances: CashBalance[];
  updatedAt: number;
  error?: string;
}

const EMPTY_SNAPSHOT: PortfolioSnapshot = {
  connected: false,
  host: "127.0.0.1",
  port: null,
  positions: [],
  cashBalances: [],
  updatedAt: 0,
};

const CACHE_KEY = "portfolio_snapshot";

// Module-level cache so data survives component unmount/remount (page navigation)
let cachedSnapshot: PortfolioSnapshot | null = null;

function loadCachedSnapshot(): PortfolioSnapshot | null {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PortfolioSnapshot;
      cachedSnapshot = parsed;
      return parsed;
    }
  } catch { /* ignore parse errors */ }
  return null;
}

function saveCachedSnapshot(snap: PortfolioSnapshot) {
  cachedSnapshot = snap;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch { /* ignore quota errors */ }
}

export function usePortfolioData(): PortfolioSnapshot & { loading: boolean } {
  const { sidecarPort } = useTws();
  const initial = loadCachedSnapshot();
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot>(initial ?? EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (!sidecarPort) {
      setSnapshot((prev) => prev.positions.length ? prev : EMPTY_SNAPSHOT);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchPortfolio() {
      try {
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/portfolio/positions`);
        if (!res.ok) return;
        const raw = (await res.json()) as Partial<PortfolioSnapshot> & Omit<PortfolioSnapshot, "cashBalances">;
        const payload: PortfolioSnapshot = { ...raw, cashBalances: raw.cashBalances ?? [] };
        if (!cancelled) {
          setSnapshot(payload);
          saveCachedSnapshot(payload);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchPortfolio();
    const id = setInterval(() => {
      void fetchPortfolio();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sidecarPort]);

  return useMemo(() => ({ ...snapshot, loading }), [snapshot, loading]);
}

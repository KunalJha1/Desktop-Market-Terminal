import { useCallback, useEffect, useMemo, useState } from "react";
import { useSidecarPort } from "./tws";

export type PortfolioSource = "ibkr" | "manual";

export interface PortfolioAccount {
  id: string;
  name: string;
  source: PortfolioSource;
  editable: boolean;
  accountCode?: string | null;
  groupIds: string[];
  groupNames: string[];
}

export interface PortfolioGroup {
  id: string;
  name: string;
  accountIds: string[];
  accountNames: string[];
}

export interface PortfolioPosition {
  id?: string;
  accountId: string;
  account: string;
  accountCode?: string | null;
  source: PortfolioSource;
  editable: boolean;
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
  id?: string;
  accountId: string;
  account: string;
  accountCode?: string | null;
  source: PortfolioSource;
  editable: boolean;
  currency: string;
  balance: number;
}

export interface PortfolioSnapshot {
  connected: boolean;
  stale?: boolean;
  staleSince?: number;
  host: string;
  port: number | null;
  accounts: PortfolioAccount[];
  groups: PortfolioGroup[];
  positions: PortfolioPosition[];
  cashBalances: CashBalance[];
  updatedAt: number;
  error?: string;
}

const EMPTY_SNAPSHOT: PortfolioSnapshot = {
  connected: false,
  host: "127.0.0.1",
  port: null,
  accounts: [],
  groups: [],
  positions: [],
  cashBalances: [],
  updatedAt: 0,
};

const CACHE_KEY = "portfolio_snapshot_v3";

let cachedSnapshot: PortfolioSnapshot | null = null;

function loadCachedSnapshot(): PortfolioSnapshot | null {
  if (cachedSnapshot) return cachedSnapshot;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PortfolioSnapshot>;
    const snapshot: PortfolioSnapshot = {
      ...EMPTY_SNAPSHOT,
      ...parsed,
      accounts: parsed.accounts ?? [],
      groups: parsed.groups ?? [],
      positions: parsed.positions ?? [],
      cashBalances: parsed.cashBalances ?? [],
    };
    cachedSnapshot = snapshot;
    return snapshot;
  } catch {
    return null;
  }
}

function saveCachedSnapshot(snapshot: PortfolioSnapshot) {
  cachedSnapshot = snapshot;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures.
  }
}

export interface ManualAccountPayload {
  name: string;
  groupIds: string[];
}

export interface ManualPositionPayload {
  symbol: string;
  quantity: number;
  avgCost: number;
  currency: string;
  name?: string;
  exchange?: string;
  primaryExchange?: string | null;
  secType?: string;
}

export interface ManualCashPayload {
  currency: string;
  balance: number;
}

export interface PortfolioGroupPayload {
  name: string;
  accountIds: string[];
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body && typeof (body as { detail?: unknown }).detail === "string"
        ? (body as { detail: string }).detail
        : `Request failed (${res.status})`;
    throw new Error(detail);
  }
  return body as T;
}

export function usePortfolioData(): PortfolioSnapshot & {
  loading: boolean;
  refresh: () => Promise<void>;
  createManualAccount: (payload: ManualAccountPayload) => Promise<void>;
  updateManualAccount: (accountId: string, payload: ManualAccountPayload) => Promise<void>;
  deleteManualAccount: (accountId: string) => Promise<void>;
  createManualPosition: (accountId: string, payload: ManualPositionPayload) => Promise<void>;
  updateManualPosition: (positionId: string, payload: ManualPositionPayload) => Promise<void>;
  deleteManualPosition: (positionId: string) => Promise<void>;
  createManualCashBalance: (accountId: string, payload: ManualCashPayload) => Promise<void>;
  updateManualCashBalance: (cashId: string, payload: ManualCashPayload) => Promise<void>;
  deleteManualCashBalance: (cashId: string) => Promise<void>;
  createGroup: (payload: PortfolioGroupPayload) => Promise<void>;
  updateGroup: (groupId: string, payload: PortfolioGroupPayload) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
} {
  const sidecarPort = useSidecarPort();
  const initial = loadCachedSnapshot();
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot>(initial ?? EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(!initial);

  const fetchSnapshot = useCallback(async (force = false) => {
    if (!sidecarPort) {
      setLoading(false);
      setSnapshot((prev) => (prev.accounts.length || prev.positions.length || prev.cashBalances.length ? prev : EMPTY_SNAPSHOT));
      return;
    }
    try {
      const url = force
        ? `http://127.0.0.1:${sidecarPort}/portfolio?force=true`
        : `http://127.0.0.1:${sidecarPort}/portfolio`;
      const res = await fetch(url);
      const payload = await parseJsonOrThrow<Partial<PortfolioSnapshot>>(res);

      const hasData =
        (payload.positions?.length ?? 0) > 0 ||
        (payload.accounts?.length ?? 0) > 0 ||
        (payload.cashBalances?.length ?? 0) > 0;

      setSnapshot((prev) => {
        if (hasData) {
          const next: PortfolioSnapshot = {
            ...EMPTY_SNAPSHOT,
            ...payload,
            accounts: payload.accounts ?? [],
            groups: payload.groups ?? [],
            positions: payload.positions ?? [],
            cashBalances: payload.cashBalances ?? [],
            stale: payload.stale ?? false,
            staleSince: payload.staleSince,
          };
          saveCachedSnapshot(next);
          return next;
        }
        // Disconnected or empty — keep previous real data, just update connection status
        if (prev.positions.length > 0 || prev.accounts.length > 0 || prev.cashBalances.length > 0) {
          return {
            ...prev,
            connected: payload.connected ?? false,
            stale: payload.stale ?? true,
            staleSince: payload.staleSince ?? prev.staleSince,
            error: payload.error,
          };
        }
        // No previous data either
        return {
          ...EMPTY_SNAPSHOT,
          ...payload,
          accounts: payload.accounts ?? [],
          groups: payload.groups ?? [],
          positions: payload.positions ?? [],
          cashBalances: payload.cashBalances ?? [],
        };
      });
    } catch {
      // Network error: preserve existing data entirely
    } finally {
      setLoading(false);
    }
  }, [sidecarPort]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      await fetchSnapshot();
    }

    void poll();
    // Matches backend PORTFOLIO_CACHE_TTL_S (~1 TWS refresh per minute).
    const id = window.setInterval(() => {
      void poll();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [fetchSnapshot]);

  const runMutation = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!sidecarPort) throw new Error("Portfolio sidecar is not available.");
      const res = await fetch(`http://127.0.0.1:${sidecarPort}${path}`, init);
      await parseJsonOrThrow<unknown>(res);
      await fetchSnapshot(true);
    },
    [fetchSnapshot, sidecarPort],
  );

  return useMemo(
    () => ({
      ...snapshot,
      loading,
      refresh: () => fetchSnapshot(true),
      createManualAccount: (payload: ManualAccountPayload) =>
        runMutation("/portfolio/manual/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      updateManualAccount: (accountId: string, payload: ManualAccountPayload) =>
        runMutation(`/portfolio/manual/accounts/${accountId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      deleteManualAccount: (accountId: string) =>
        runMutation(`/portfolio/manual/accounts/${accountId}`, { method: "DELETE" }),
      createManualPosition: (accountId: string, payload: ManualPositionPayload) =>
        runMutation(`/portfolio/manual/accounts/${accountId}/positions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      updateManualPosition: (positionId: string, payload: ManualPositionPayload) =>
        runMutation(`/portfolio/manual/positions/${positionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      deleteManualPosition: (positionId: string) =>
        runMutation(`/portfolio/manual/positions/${positionId}`, { method: "DELETE" }),
      createManualCashBalance: (accountId: string, payload: ManualCashPayload) =>
        runMutation(`/portfolio/manual/accounts/${accountId}/cash-balances`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      updateManualCashBalance: (cashId: string, payload: ManualCashPayload) =>
        runMutation(`/portfolio/manual/cash-balances/${cashId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      deleteManualCashBalance: (cashId: string) =>
        runMutation(`/portfolio/manual/cash-balances/${cashId}`, { method: "DELETE" }),
      createGroup: (payload: PortfolioGroupPayload) =>
        runMutation("/portfolio/manual/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      updateGroup: (groupId: string, payload: PortfolioGroupPayload) =>
        runMutation(`/portfolio/manual/groups/${groupId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      deleteGroup: (groupId: string) =>
        runMutation(`/portfolio/manual/groups/${groupId}`, { method: "DELETE" }),
    }),
    [fetchSnapshot, loading, runMutation, snapshot],
  );
}

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSidecarPort } from "./tws";
import type { HeatmapTile } from "./heatmap-utils";

const HEATMAP_POLL_MS = 5_000;

type HeatmapStore = {
  tiles: HeatmapTile[];
  asOf: number | null;
  intervalId: number | null;
  inFlight: boolean;
  subscriberCount: number;
};

// Per-URL singleton stores so multiple components polling the same URL share one request.
const storesByUrl = new Map<string, HeatmapStore>();

// Per-URL listener sets — components only re-render when their specific URL's data changes.
const listenersByUrl = new Map<string, Set<() => void>>();
const versionsByUrl = new Map<string, number>();

function notifyUrl(url: string): void {
  versionsByUrl.set(url, (versionsByUrl.get(url) ?? 0) + 1);
  const set = listenersByUrl.get(url);
  if (set) {
    for (const listener of set) listener();
  }
}

function getOrCreateStore(url: string): HeatmapStore {
  const existing = storesByUrl.get(url);
  if (existing) return existing;

  const created: HeatmapStore = {
    tiles: [],
    asOf: null,
    intervalId: null,
    inFlight: false,
    subscriberCount: 0,
  };
  storesByUrl.set(url, created);
  return created;
}

async function fetchHeatmapUrl(url: string, store: HeatmapStore): Promise<void> {
  if (store.inFlight) return;

  store.inFlight = true;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const payload = await res.json();
    store.tiles = (payload.tiles as HeatmapTile[]) ?? [];
    store.asOf = typeof payload.asOf === "number" ? payload.asOf : null;
    notifyUrl(url);
  } catch {
    // Ignore transport failures; next poll retries.
  } finally {
    store.inFlight = false;
  }
}

function ensurePolling(url: string, store: HeatmapStore): void {
  if (store.intervalId !== null) return;

  void fetchHeatmapUrl(url, store);
  store.intervalId = window.setInterval(() => {
    void fetchHeatmapUrl(url, store);
  }, HEATMAP_POLL_MS);
}

function stopPolling(url: string, store: HeatmapStore): void {
  if (store.intervalId !== null) {
    window.clearInterval(store.intervalId);
    store.intervalId = null;
  }
  storesByUrl.delete(url);
  listenersByUrl.delete(url);
  versionsByUrl.delete(url);
}

function subscribeHeatmapUrl(url: string): () => void {
  const store = getOrCreateStore(url);
  store.subscriberCount += 1;
  ensurePolling(url, store);

  return () => {
    store.subscriberCount -= 1;
    if (store.subscriberCount <= 0) {
      stopPolling(url, store);
    }
  };
}

/**
 * Generic heatmap data hook — polls any heatmap endpoint URL every 5s.
 * Pass `null` to skip fetching (e.g. when port is not yet known).
 */
export function useHeatmapData(url: string | null): { tiles: HeatmapTile[]; asOf: number | null } {
  useEffect(() => {
    if (!url) return;
    return subscribeHeatmapUrl(url);
  }, [url]);

  const subscribe = useMemo(() => {
    if (!url) return (_listener: () => void) => () => {};
    return (listener: () => void) => {
      let set = listenersByUrl.get(url);
      if (!set) {
        set = new Set();
        listenersByUrl.set(url, set);
      }
      set.add(listener);
      return () => { set!.delete(listener); };
    };
  }, [url]);

  const getSnapshot = useMemo(() => {
    if (!url) return () => 0;
    return () => versionsByUrl.get(url) ?? 0;
  }, [url]);

  const version = useSyncExternalStore(subscribe, getSnapshot);

  return useMemo(() => {
    if (!url) return { tiles: [], asOf: null };
    const store = storesByUrl.get(url);
    return {
      tiles: store?.tiles ?? [],
      asOf: store?.asOf ?? null,
    };
  }, [url, version]);
}

// ── Backward-compatible exports (used by existing code) ───────────────────────

export function useSp500HeatmapData(): HeatmapTile[] {
  return useSp500HeatmapStore().tiles;
}

export function useSp500HeatmapStore(): { tiles: HeatmapTile[]; asOf: number | null } {
  const sidecarPort = useSidecarPort();
  const url = sidecarPort ? `http://127.0.0.1:${sidecarPort}/heatmap/sp500` : null;
  return useHeatmapData(url);
}

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useTws } from "./tws";
import type { HeatmapTile } from "./heatmap-utils";

const HEATMAP_POLL_MS = 5_000;

type HeatmapStore = {
  tiles: HeatmapTile[];
  asOf: number | null;
  intervalId: number | null;
  inFlight: boolean;
  subscriberCount: number;
};

const storesByPort = new Map<number, HeatmapStore>();
const listeners = new Set<() => void>();
let storeVersion = 0;

function subscribeToStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getStoreVersion(): number {
  return storeVersion;
}

function notifyStore() {
  storeVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

function getOrCreateStore(sidecarPort: number): HeatmapStore {
  const existing = storesByPort.get(sidecarPort);
  if (existing) return existing;

  const created: HeatmapStore = {
    tiles: [],
    asOf: null,
    intervalId: null,
    inFlight: false,
    subscriberCount: 0,
  };
  storesByPort.set(sidecarPort, created);
  return created;
}

async function fetchHeatmap(sidecarPort: number, store: HeatmapStore): Promise<void> {
  if (store.inFlight) return;

  store.inFlight = true;
  try {
    const res = await fetch(`http://127.0.0.1:${sidecarPort}/heatmap/sp500`);
    if (!res.ok) return;
    const payload = await res.json();
    store.tiles = (payload.tiles as HeatmapTile[]) ?? [];
    store.asOf = typeof payload.asOf === "number" ? payload.asOf : null;
    notifyStore();
  } catch {
    // Ignore transport failures; next poll retries.
  } finally {
    store.inFlight = false;
  }
}

function ensurePolling(sidecarPort: number, store: HeatmapStore): void {
  if (store.intervalId !== null) return;

  void fetchHeatmap(sidecarPort, store);
  store.intervalId = window.setInterval(() => {
    void fetchHeatmap(sidecarPort, store);
  }, HEATMAP_POLL_MS);
}

function stopPolling(sidecarPort: number, store: HeatmapStore): void {
  if (store.intervalId !== null) {
    window.clearInterval(store.intervalId);
    store.intervalId = null;
  }
  storesByPort.delete(sidecarPort);
}

function subscribeHeatmap(sidecarPort: number): () => void {
  const store = getOrCreateStore(sidecarPort);
  store.subscriberCount += 1;
  ensurePolling(sidecarPort, store);

  return () => {
    store.subscriberCount -= 1;
    if (store.subscriberCount <= 0) {
      stopPolling(sidecarPort, store);
    }
  };
}

export function useSp500HeatmapData(): HeatmapTile[] {
  return useSp500HeatmapStore().tiles;
}

export function useSp500HeatmapStore(): { tiles: HeatmapTile[]; asOf: number | null } {
  const { sidecarPort } = useTws();

  useEffect(() => {
    if (!sidecarPort) return;
    return subscribeHeatmap(sidecarPort);
  }, [sidecarPort]);

  const version = useSyncExternalStore(subscribeToStore, getStoreVersion);

  return useMemo(() => {
    if (!sidecarPort) return { tiles: [], asOf: null };
    const store = storesByPort.get(sidecarPort);
    return {
      tiles: store?.tiles ?? [],
      asOf: store?.asOf ?? null,
    };
  }, [sidecarPort, version]);
}

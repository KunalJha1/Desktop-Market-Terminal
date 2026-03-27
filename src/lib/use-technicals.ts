import { useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api";
import type { Timeframe } from "../chart/types";
import { TwsContext } from "./tws";

const POLL_INTERVAL_MS = 60_000;
const POLLER_STOP_GRACE_MS = 1_000;

export type TechScoreStatus =
  | "ok"
  | "insufficient_bars"
  | "unsupported_timeframe"
  | "error"
  | null;

export interface TechScoreCell {
  score: number | null;
  status: TechScoreStatus;
  barCount: number | null;
  requiredBars: number | null;
}

export type TechScoreMap = Map<string, Map<string, TechScoreCell>>;

type PollerState = {
  symbols: Map<string, number>;
  timeframes: Map<string, number>;
  intervalId: number | null;
  stopTimeoutId: number | null;
  subscriberCount: number;
  inFlight: boolean;
  lastRequestKey: string;
};

const scoreStore = new Map<string, Map<string, TechScoreCell>>();
const pollersByPort = new Map<number, PollerState>();
const symbolListeners = new Map<string, Set<() => void>>();
let globalVersion = 0;

function notifySymbols(symbols: Iterable<string>): void {
  globalVersion += 1;
  const listeners = new Set<() => void>();
  for (const symbol of symbols) {
    const symbolSet = symbolListeners.get(symbol);
    if (!symbolSet) continue;
    for (const listener of symbolSet) {
      listeners.add(listener);
    }
  }
  for (const listener of listeners) {
    listener();
  }
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

function normalizeTimeframes(timeframes: string[]): string[] {
  return Array.from(
    new Set(
      timeframes
        .map((timeframe) => timeframe.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function createEmptyCell(): TechScoreCell {
  return {
    score: null,
    status: null,
    barCount: null,
    requiredBars: null,
  };
}

function cellsEqual(a: TechScoreCell | undefined, b: TechScoreCell): boolean {
  return (
    a?.score === b.score &&
    a?.status === b.status &&
    a?.barCount === b.barCount &&
    a?.requiredBars === b.requiredBars
  );
}

function getOrCreatePoller(sidecarPort: number): PollerState {
  const existing = pollersByPort.get(sidecarPort);
  if (existing) return existing;
  const created: PollerState = {
    symbols: new Map(),
    timeframes: new Map(),
    intervalId: null,
    stopTimeoutId: null,
    subscriberCount: 0,
    inFlight: false,
    lastRequestKey: "",
  };
  pollersByPort.set(sidecarPort, created);
  return created;
}

function getTrackedSymbols(poller: PollerState): string[] {
  return Array.from(poller.symbols.keys());
}

function getTrackedTimeframes(poller: PollerState): string[] {
  return Array.from(poller.timeframes.keys());
}

function getTrackedKey(poller: PollerState): string {
  return `${getTrackedSymbols(poller).join(",")}::${getTrackedTimeframes(poller).join(",")}`;
}

async function fetchScores(sidecarPort: number, poller: PollerState): Promise<void> {
  const symbols = getTrackedSymbols(poller);
  const timeframes = getTrackedTimeframes(poller);
  if (!sidecarPort || symbols.length === 0 || timeframes.length === 0 || poller.inFlight) return;

  poller.inFlight = true;
  try {
    poller.lastRequestKey = getTrackedKey(poller);
    const res = await fetch(
      `http://127.0.0.1:${sidecarPort}/technicals/scores?symbols=${symbols.join(",")}&timeframes=${timeframes.join(",")}`,
    );
    if (!res.ok) return;
    const rows = (await res.json()) as Array<Record<string, unknown>>;

    const nextBySymbol = new Map<string, Map<string, TechScoreCell>>();
    for (const symbol of symbols) {
      const inner = new Map<string, TechScoreCell>();
      for (const timeframe of timeframes) {
        inner.set(timeframe, createEmptyCell());
      }
      nextBySymbol.set(symbol, inner);
    }

    for (const row of rows) {
      const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : "";
      const inner = nextBySymbol.get(symbol);
      if (!inner) continue;
      for (const timeframe of timeframes) {
        const score = typeof row[timeframe] === "number" ? (row[timeframe] as number) : null;
        const statusValue = row[`status_${timeframe}`];
        const barsValue = row[`bars_${timeframe}`];
        const requiredValue = row[`required_bars_${timeframe}`];
        inner.set(timeframe, {
          score,
          status:
            typeof statusValue === "string"
              ? (statusValue as TechScoreStatus)
              : (score !== null ? "ok" : null),
          barCount: typeof barsValue === "number" ? barsValue : null,
          requiredBars: typeof requiredValue === "number" ? requiredValue : null,
        });
      }
    }

    const changedSymbols = new Set<string>();
    for (const symbol of symbols) {
      const nextInner = nextBySymbol.get(symbol) ?? new Map<string, TechScoreCell>();
      const existingInner = scoreStore.get(symbol);
      let changed = !existingInner;
      if (!changed) {
        for (const timeframe of timeframes) {
          const nextCell = nextInner.get(timeframe) ?? createEmptyCell();
          if (!cellsEqual(existingInner?.get(timeframe), nextCell)) {
            changed = true;
            break;
          }
        }
      }
      scoreStore.set(symbol, nextInner);
      if (changed) changedSymbols.add(symbol);
    }

    if (changedSymbols.size > 0) {
      notifySymbols(changedSymbols);
    }
  } catch {
    // Sidecar not ready, or transient request failure.
  } finally {
    poller.inFlight = false;
  }
}

function ensurePollerRunning(sidecarPort: number, poller: PollerState): void {
  if (poller.stopTimeoutId !== null) {
    window.clearTimeout(poller.stopTimeoutId);
    poller.stopTimeoutId = null;
  }

  if (poller.intervalId !== null) return;

  void fetchScores(sidecarPort, poller);
  poller.intervalId = window.setInterval(() => {
    void fetchScores(sidecarPort, poller);
  }, POLL_INTERVAL_MS);
}

function stopPoller(sidecarPort: number, poller: PollerState): void {
  if (poller.intervalId !== null) {
    window.clearInterval(poller.intervalId);
    poller.intervalId = null;
  }
  if (poller.stopTimeoutId !== null) {
    window.clearTimeout(poller.stopTimeoutId);
    poller.stopTimeoutId = null;
  }
  pollersByPort.delete(sidecarPort);
}

function subscribeScores(
  sidecarPort: number,
  symbols: string[],
  timeframes: string[],
): () => void {
  const normalizedSymbols = normalizeSymbols(symbols);
  const normalizedTimeframes = normalizeTimeframes(timeframes);
  if (normalizedSymbols.length === 0 || normalizedTimeframes.length === 0) {
    return () => {};
  }

  const poller = getOrCreatePoller(sidecarPort);
  const previousKey = getTrackedKey(poller);
  poller.subscriberCount += 1;
  for (const symbol of normalizedSymbols) {
    poller.symbols.set(symbol, (poller.symbols.get(symbol) ?? 0) + 1);
  }
  for (const timeframe of normalizedTimeframes) {
    poller.timeframes.set(timeframe, (poller.timeframes.get(timeframe) ?? 0) + 1);
  }

  ensurePollerRunning(sidecarPort, poller);
  if (getTrackedKey(poller) !== previousKey) {
    void fetchScores(sidecarPort, poller);
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
    for (const timeframe of normalizedTimeframes) {
      const nextCount = (poller.timeframes.get(timeframe) ?? 0) - 1;
      if (nextCount > 0) {
        poller.timeframes.set(timeframe, nextCount);
      } else {
        poller.timeframes.delete(timeframe);
      }
    }
    poller.subscriberCount = Math.max(0, poller.subscriberCount - 1);
    if (poller.symbols.size === 0 || poller.timeframes.size === 0 || poller.subscriberCount === 0) {
      poller.stopTimeoutId = window.setTimeout(() => {
        if (poller.symbols.size === 0 || poller.timeframes.size === 0 || poller.subscriberCount === 0) {
          stopPoller(sidecarPort, poller);
        }
      }, POLLER_STOP_GRACE_MS);
    }
  };
}

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

function getSymbolsSnapshot(symbols: string[], timeframes: string[]): string {
  const normalizedSymbols = normalizeSymbols(symbols);
  const normalizedTimeframes = normalizeTimeframes(timeframes);
  if (normalizedSymbols.length === 0 || normalizedTimeframes.length === 0) {
    return `empty:${globalVersion}`;
  }
  return normalizedSymbols
    .map((symbol) => {
      const inner = scoreStore.get(symbol);
      return normalizedTimeframes
        .map((timeframe) => {
          const cell = inner?.get(timeframe);
          return `${symbol}:${timeframe}:${cell?.score ?? ""}:${cell?.status ?? ""}:${cell?.barCount ?? ""}:${cell?.requiredBars ?? ""}`;
        })
        .join("|");
    })
    .join("||");
}

export function resolveTechnicalScoreTimeframe(
  timeframe: Timeframe,
): { requestTimeframe: string | null; label: string } {
  switch (timeframe) {
    case "1m":
      return { requestTimeframe: "1m", label: "1m" };
    case "5m":
      return { requestTimeframe: "5m", label: "5m" };
    case "10m":
      return { requestTimeframe: "15m", label: "15m proxy" };
    case "15m":
      return { requestTimeframe: "15m", label: "15m" };
    case "30m":
      return { requestTimeframe: "1h", label: "1H proxy" };
    case "1H":
      return { requestTimeframe: "1h", label: "1H" };
    case "4H":
      return { requestTimeframe: "4h", label: "4H" };
    case "1D":
      return { requestTimeframe: "1d", label: "1D" };
    case "1W":
      return { requestTimeframe: "1w", label: "1W" };
    case "1M":
      return { requestTimeframe: "1w", label: "1W proxy" };
    default:
      return { requestTimeframe: null, label: timeframe };
  }
}

export function describeTechScoreCell(
  timeframe: string,
  cell: { score: number | null; status: string | null; barCount: number | null; requiredBars: number | null } | null | undefined,
): string {
  const prefix = `${timeframe} technical score`;
  if (!cell) return `${prefix}: no data`;
  if (typeof cell.score === "number") return `${prefix}: ${cell.score}`;
  if (cell.status === "insufficient_bars") {
    const bars = cell.barCount ?? 0;
    const required = cell.requiredBars ?? 60;
    return `${prefix}: not enough bars (${bars}/${required})`;
  }
  if (cell.status === "unsupported_timeframe") {
    return `${prefix}: unsupported timeframe`;
  }
  if (cell.status === "error") {
    return `${prefix}: unavailable`;
  }
  return `${prefix}: no data`;
}

export function useTechScores(
  symbols: string[],
  timeframes: string[],
): TechScoreMap {
  const tws = useContext(TwsContext);
  const [fallbackPort, setFallbackPort] = useState<number | null>(null);
  const normalizedSymbols = useMemo(() => normalizeSymbols(symbols), [symbols]);
  const normalizedTimeframes = useMemo(() => normalizeTimeframes(timeframes), [timeframes]);

  useEffect(() => {
    if (tws) return;
    invoke<number | null>("get_sidecar_port")
      .then((port) => setFallbackPort(port))
      .catch(() => {});
  }, [tws]);

  const sidecarPort = tws?.sidecarPort ?? fallbackPort;

  useEffect(() => {
    if (!sidecarPort) return;
    return subscribeScores(sidecarPort, normalizedSymbols, normalizedTimeframes);
  }, [sidecarPort, normalizedSymbols, normalizedTimeframes]);

  const snapshot = useSyncExternalStore(
    (listener) => subscribeToSymbols(normalizedSymbols, listener),
    () => getSymbolsSnapshot(normalizedSymbols, normalizedTimeframes),
  );

  return useMemo(() => {
    const outer = new Map<string, Map<string, TechScoreCell>>();
    for (const symbol of normalizedSymbols) {
      const existing = scoreStore.get(symbol);
      const inner = new Map<string, TechScoreCell>();
      for (const timeframe of normalizedTimeframes) {
        inner.set(timeframe, existing?.get(timeframe) ?? createEmptyCell());
      }
      outer.set(symbol, inner);
    }
    return outer;
  }, [normalizedSymbols, normalizedTimeframes, snapshot]);
}

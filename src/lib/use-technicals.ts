import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api";
import type { Timeframe } from "../chart/types";

const POLL_INTERVAL_MS = 60_000;

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

/**
 * Polls `GET /technicals/scores` on the Python sidecar every 60s.
 * Returns a Map<symbol, Map<timeframe, score | null>>.
 */
export function useTechScores(
  symbols: string[],
  timeframes: string[],
): Map<string, Map<string, number | null>> {
  const [scores, setScores] = useState<Map<string, Map<string, number | null>>>(new Map());
  const portRef = useRef<number | null>(null);
  const [portReady, setPortReady] = useState(false);
  const symbolsRef = useRef(symbols);
  const timeframesRef = useRef(timeframes);
  symbolsRef.current = symbols;
  timeframesRef.current = timeframes;

  // Resolve sidecar port once
  useEffect(() => {
    invoke<number | null>("get_sidecar_port").then((p) => {
      portRef.current = p;
      setPortReady(Boolean(p));
    }).catch(() => {});
  }, []);

  const fetchScores = useCallback(async () => {
    const port = portRef.current;
    const syms = symbolsRef.current;
    const tfs = timeframesRef.current;
    if (!port || syms.length === 0 || tfs.length === 0) return;

    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/technicals/scores?symbols=${syms.join(",")}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as Array<Record<string, unknown>>;

      const outer = new Map<string, Map<string, number | null>>();
      // Initialize all symbols with nulls
      for (const sym of syms) {
        const inner = new Map<string, number | null>();
        for (const tf of tfs) inner.set(tf, null);
        outer.set(sym, inner);
      }
      // Fill in actual scores
      for (const row of data) {
        const sym = row.symbol as string;
        const inner = outer.get(sym);
        if (!inner) continue;
        for (const tf of tfs) {
          const val = row[tf];
          if (typeof val === "number") inner.set(tf, val);
        }
      }
      setScores(outer);
    } catch {
      // Sidecar not ready — silently return
    }
  }, []);

  useEffect(() => {
    fetchScores();
    const id = setInterval(fetchScores, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchScores]);

  // Also refetch when symbols or timeframes change
  useEffect(() => {
    fetchScores();
  }, [symbols.join(","), timeframes.join(","), portReady, fetchScores]);

  return scores;
}

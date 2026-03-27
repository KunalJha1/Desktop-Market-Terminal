import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api";
import type { Timeframe } from "../chart/types";
import { TwsContext } from "./tws";

const POLL_INTERVAL_MS = 60_000;

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

/**
 * Polls `GET /technicals/scores` on the Python sidecar every 60s.
 * Returns a Map<symbol, Map<timeframe, { score, status, ... }>>.
 */
export function useTechScores(
  symbols: string[],
  timeframes: string[],
): TechScoreMap {
  const tws = useContext(TwsContext);
  const [fallbackPort, setFallbackPort] = useState<number | null>(null);
  const [scores, setScores] = useState<TechScoreMap>(new Map());
  const symbolsRef = useRef(symbols);
  const timeframesRef = useRef(timeframes);
  symbolsRef.current = symbols;
  timeframesRef.current = timeframes;

  useEffect(() => {
    if (tws) return;
    invoke<number | null>("get_sidecar_port")
      .then((p) => setFallbackPort(p))
      .catch(() => {});
  }, [tws]);

  const sidecarPort = tws?.sidecarPort ?? fallbackPort;

  const fetchScores = useCallback(async () => {
    const port = sidecarPort;
    const syms = symbolsRef.current;
    const tfs = timeframesRef.current;
    if (!port || syms.length === 0 || tfs.length === 0) return;

    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/technicals/scores?symbols=${syms.join(",")}&timeframes=${tfs.join(",")}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as Array<Record<string, unknown>>;

      const outer = new Map<string, Map<string, TechScoreCell>>();
      for (const sym of syms) {
        const inner = new Map<string, TechScoreCell>();
        for (const tf of tfs) {
          inner.set(tf, {
            score: null,
            status: null,
            barCount: null,
            requiredBars: null,
          });
        }
        outer.set(sym, inner);
      }

      for (const row of data) {
        const sym = row.symbol as string;
        const inner = outer.get(sym);
        if (!inner) continue;
        for (const tf of tfs) {
          const score = typeof row[tf] === "number" ? (row[tf] as number) : null;
          const statusValue = row[`status_${tf}`];
          const barsValue = row[`bars_${tf}`];
          const requiredValue = row[`required_bars_${tf}`];
          inner.set(tf, {
            score,
            status: typeof statusValue === "string" ? (statusValue as TechScoreStatus) : (score !== null ? "ok" : null),
            barCount: typeof barsValue === "number" ? barsValue : null,
            requiredBars: typeof requiredValue === "number" ? requiredValue : null,
          });
        }
      }

      setScores(outer);
    } catch {
      // Sidecar not ready, or transient request failure.
    }
  }, [sidecarPort]);

  useEffect(() => {
    fetchScores();
    const id = setInterval(fetchScores, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchScores]);

  useEffect(() => {
    fetchScores();
  }, [symbols.join(","), timeframes.join(","), sidecarPort, fetchScores]);

  return scores;
}

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api";
import {
  CustomColumnDef,
  extractIndicatorRequests,
  indicatorKey,
} from "./custom-column-types";
import type { Quote } from "./market-data";
import { TwsContext } from "./tws";

const POLL_INTERVAL_MS = 60_000;

/**
 * Fetches individual indicator values from the backend for non-expression custom columns.
 * Polls GET /technicals/indicators every 60s.
 *
 * Returns Map<symbol, Map<columnId, computed value>>.
 * - Indicator columns: raw numeric value
 * - Crossover columns: "BUY" | "SELL" | "NEUTRAL"
 * - Score columns: 0-100 score
 */
export function useIndicatorValues(
  symbols: string[],
  columns: CustomColumnDef[],
  quotes: Map<string, Quote>,
): Map<string, Map<string, number | string | null>> {
  const tws = useContext(TwsContext);
  const [fallbackPort, setFallbackPort] = useState<number | null>(null);
  const [values, setValues] = useState<Map<string, Map<string, number | string | null>>>(
    new Map(),
  );
  const symbolsRef = useRef(symbols);
  const columnsRef = useRef(columns);
  const quotesRef = useRef(quotes);
  symbolsRef.current = symbols;
  columnsRef.current = columns;
  quotesRef.current = quotes;

  useEffect(() => {
    if (tws) return;
    invoke<number | null>("get_sidecar_port")
      .then((p) => setFallbackPort(p))
      .catch(() => {});
  }, [tws]);

  const sidecarPort = tws?.sidecarPort ?? fallbackPort;

  const fetchIndicators = useCallback(async () => {
    const port = sidecarPort;
    const syms = symbolsRef.current;
    const cols = columnsRef.current;
    const currentQuotes = quotesRef.current;
    if (syms.length === 0) return;

    // Only fetch for non-expression columns
    const nonExprCols = cols.filter((c) => c.kind !== "expression");
    if (nonExprCols.length === 0) return;

    const requests = extractIndicatorRequests(nonExprCols);
    let data: Record<string, Record<string, number | null>> = {};

    try {
      if (requests.length > 0) {
        if (!port) return;
        const res = await fetch(
          `http://127.0.0.1:${port}/technicals/indicators?symbols=${syms.join(",")}&indicators=${encodeURIComponent(JSON.stringify(requests))}`,
        );
        if (!res.ok) return;
        data = (await res.json()) as Record<string, Record<string, number | null>>;
      }

      const outer = new Map<string, Map<string, number | string | null>>();
      for (const sym of syms) {
        const inner = new Map<string, number | string | null>();
        const symData = data[sym] ?? {};
        const quote = currentQuotes.get(sym) ?? null;

        const getRefValue = (
          ref: { type: string; params: Record<string, number>; output?: string },
          timeframe: string,
        ) => {
          if (ref.type === "PRICE") {
            if (!quote) return null;
            const priceField = ref.output ?? "last";
            const value = quote[priceField as keyof Quote];
            return typeof value === "number" ? value : null;
          }
          const key = indicatorKey({
            type: ref.type as never,
            timeframe,
            params: ref.params,
            output: ref.output,
          });
          return symData[key];
        };

        for (const col of nonExprCols) {
          switch (col.kind) {
            case "indicator": {
              if (col.indicatorType === "PRICE") {
                const priceField = col.output ?? "last";
                const priceValue = quote?.[priceField as keyof Quote];
                inner.set(col.id, typeof priceValue === "number" ? priceValue : null);
                break;
              }
              const key = indicatorKey({
                type: col.indicatorType,
                timeframe: col.timeframe,
                params: col.params,
                output: col.output,
              });
              inner.set(col.id, symData[key] ?? null);
              break;
            }
            case "crossover": {
              if (col.combos.length === 0) {
                inner.set(col.id, null);
                break;
              }

              let allAbove = true;
              let allBelow = true;
              let hasValue = false;

              for (const combo of col.combos) {
                const valA = getRefValue(combo.indicatorA, col.timeframe);
                const valB = getRefValue(combo.indicatorB, col.timeframe);
                if (valA == null || valB == null) {
                  hasValue = false;
                  allAbove = false;
                  allBelow = false;
                  break;
                }
                hasValue = true;
                if (!(valA > valB)) allAbove = false;
                if (!(valA < valB)) allBelow = false;
              }

              if (!hasValue) {
                inner.set(col.id, null);
              } else if (allAbove) {
                inner.set(col.id, "BUY");
              } else if (allBelow) {
                inner.set(col.id, "SELL");
              } else {
                inner.set(col.id, "NEUTRAL");
              }
              break;
            }
            case "score": {
              if (col.conditions.length === 0) {
                inner.set(col.id, null);
                break;
              }
              let matches = 0;
              let total = 0;
              for (const cond of col.conditions) {
                if (cond.indicatorType === "PRICE") {
                  const priceField = cond.output ?? "last";
                  const value = quote?.[priceField as keyof Quote];
                  if (typeof value !== "number") {
                    continue;
                  }
                  total++;
                  const passes =
                    cond.comparison === "above" ? value > cond.threshold : value < cond.threshold;
                  if (passes) matches++;
                  continue;
                }
                const key = indicatorKey({
                  type: cond.indicatorType,
                  timeframe: col.timeframe,
                  params: cond.params,
                  output: cond.output,
                });
                const val = symData[key];
                if (val == null) {
                  continue;
                }
                total++;
                const passes =
                  cond.comparison === "above" ? val > cond.threshold : val < cond.threshold;
                if (passes) matches++;
              }
              if (total === 0) {
                inner.set(col.id, null);
              } else {
                inner.set(col.id, Math.round((matches / total) * 100));
              }
              break;
            }
          }
        }
        outer.set(sym, inner);
      }
      setValues(outer);
    } catch {
      // Sidecar not ready
    }
  }, [sidecarPort]);

  useEffect(() => {
    fetchIndicators();
    const id = setInterval(fetchIndicators, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchIndicators]);

  // Refetch when symbols or columns change
  const colKey = JSON.stringify(columns);
  const quoteKey = JSON.stringify(symbols.map((sym) => {
    const quote = quotes.get(sym);
    return quote ? [sym, quote.last, quote.open, quote.high, quote.low, quote.prevClose, quote.mid, quote.bid, quote.ask] : [sym, null];
  }));
  useEffect(() => {
    fetchIndicators();
  }, [symbols.join(","), colKey, quoteKey, fetchIndicators]);

  return values;
}

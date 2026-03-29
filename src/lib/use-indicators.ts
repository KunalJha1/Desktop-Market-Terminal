import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api";
import {
  type CustomColumnDef,
  type ValueSource,
  extractIndicatorRequests,
  indicatorKey,
} from "./custom-column-types";
import { SEARCHABLE_SYMBOLS, getEtfInfo } from "./market-data";
import type { Quote } from "./market-data";
import { TwsContext } from "./tws";

const POLL_INTERVAL_MS = 60_000;
const SYMBOL_META_MAP = new Map(SEARCHABLE_SYMBOLS.map((item) => [item.symbol, item]));

function getValueFromSource(
  source: ValueSource | undefined,
  quote: Quote | null,
  symbol: string,
  symData: Record<string, number | null>,
): number | string | null {
  if (!source) return null;

  if (source.sourceKind === "indicator") {
    const key = indicatorKey({
      type: source.indicatorType,
      timeframe: source.timeframe,
      params: source.params,
      output: source.output,
    });
    return symData[key] ?? null;
  }

  if (source.sourceKind === "quote") {
    const value = quote?.[source.field as keyof Quote];
    return typeof value === "number" ? value : value == null ? null : String(value);
  }

  const meta = SYMBOL_META_MAP.get(symbol);
  if (source.sourceKind === "meta") {
    const value = meta?.[source.field];
    return typeof value === "number" ? value : typeof value === "string" ? value : null;
  }

  const etf = getEtfInfo(symbol);
  switch (source.field) {
    case "isEtf":
      return etf ? 1 : 0;
    case "holdingCount":
      return etf?.top_holdings.length ?? 0;
    case "topHoldingWeight":
      return etf?.top_holdings[0]?.weight_pct ?? null;
    case "topHoldingSymbol":
      return etf?.top_holdings[0]?.symbol ?? null;
    case "topHoldingName":
      return etf?.top_holdings[0]?.name ?? null;
    default:
      return null;
  }
}

function asNumber(value: number | string | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compareValues(
  left: number | string | null,
  right: number | string | null,
  operator: "above" | "below" | "equal" | "notEqual",
): boolean | null {
  if (operator === "equal" || operator === "notEqual") {
    if (left == null || right == null) return null;
    const result = left === right;
    return operator === "equal" ? result : !result;
  }

  const numericLeft = asNumber(left);
  const numericRight = asNumber(right);
  if (numericLeft == null || numericRight == null) return null;
  return operator === "above" ? numericLeft > numericRight : numericLeft < numericRight;
}

/**
 * Fetches individual indicator values from the backend for non-expression custom columns.
 * Polls GET /technicals/indicators every 60s.
 *
 * Returns Map<symbol, Map<columnId, computed value>>.
 */
export function useIndicatorValues(
  symbols: string[],
  columns: CustomColumnDef[],
  quotes: Map<string, Quote>,
): Map<string, Map<string, number | string | null>> {
  const tws = useContext(TwsContext);
  const [fallbackPort, setFallbackPort] = useState<number | null>(null);
  const [values, setValues] = useState<Map<string, Map<string, number | string | null>>>(new Map());
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

        for (const col of nonExprCols) {
          switch (col.kind) {
            case "indicator": {
              inner.set(col.id, getValueFromSource(col.source, quote, sym, symData));
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
                const left = asNumber(getValueFromSource(combo.left, quote, sym, symData));
                const right = asNumber(getValueFromSource(combo.right, quote, sym, symData));
                if (left == null || right == null) {
                  hasValue = false;
                  allAbove = false;
                  allBelow = false;
                  break;
                }
                hasValue = true;
                if (!(left > right)) allAbove = false;
                if (!(left < right)) allBelow = false;
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
                const left = getValueFromSource(cond.left, quote, sym, symData);
                const right =
                  cond.targetType === "source"
                    ? getValueFromSource(cond.right, quote, sym, symData)
                    : cond.threshold;
                const passes = compareValues(left, right, cond.operator);
                if (passes == null) continue;
                total++;
                if (passes) matches++;
              }
              inner.set(col.id, total === 0 ? null : Math.round((matches / total) * 100));
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

  const colKey = JSON.stringify(columns);
  const quoteKey = JSON.stringify(
    symbols.map((sym) => {
      const quote = quotes.get(sym);
      return quote
        ? [sym, quote.last, quote.open, quote.high, quote.low, quote.prevClose, quote.mid, quote.bid, quote.ask]
        : [sym, null];
    }),
  );
  useEffect(() => {
    fetchIndicators();
  }, [symbols.join(","), colKey, quoteKey, fetchIndicators]);

  return values;
}

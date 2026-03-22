import { useState, useRef, useCallback, useEffect, useMemo, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { X, GripVertical } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import { getChannelById } from "../lib/link-channels";
import { linkBus } from "../lib/link-bus";
import { getSymbolName, SEARCHABLE_SYMBOLS, getEtfInfo } from "../lib/market-data";
import type { Quote, EtfHolding } from "../lib/market-data";
import { useWatchlistData, type SymbolStatus } from "../lib/use-market-data";
import { useTechScores } from "../lib/use-technicals";
import { useIndicatorValues } from "../lib/use-indicators";
import { useWatchlist } from "../lib/watchlist";
import {
  type CustomColumnDef,
  type ExpressionColumn,
  migrateColumn,
} from "../lib/custom-column-types";
import ColumnPopover from "./watchlist/ColumnPopover";
import ColumnBuilderModal from "./watchlist/ColumnBuilderModal";

// ─── Column definitions ────────────────────────────────────────────
interface ColDef {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  align: "left" | "right";
}

const COLUMNS: ColDef[] = [
  { key: "symbol", label: "Symbol", defaultWidth: 72, minWidth: 50, align: "left" },
  { key: "last", label: "Last", defaultWidth: 68, minWidth: 44, align: "right" },
  { key: "change", label: "Chg", defaultWidth: 58, minWidth: 40, align: "right" },
  { key: "changePct", label: "Chg%", defaultWidth: 58, minWidth: 42, align: "right" },
];

const ROW_H = 24;
const HEADER_H = 22;
const TA_COL_W = 44;
const ROW_GRIP_W = 16;
const PANE_CHROME_W = 8;
const PANE_GAP = 6;
const HEADER_TINT_PRESETS: ReadonlyArray<{ label: string; value: string | null }> = [
  { label: "Default", value: null },
  { label: "Blue", value: "#7cc7ff" },
  { label: "Green", value: "#7ee787" },
  { label: "Amber", value: "#f2cc60" },
  { label: "Red", value: "#ff7b72" },
  { label: "Pink", value: "#f778ba" },
];
type ColHeaderMenuState =
  | { x: number; y: number; type: "custom"; colId: string }
  | { x: number; y: number; type: "ta"; tf: string };

type HeaderTintConfig = {
  custom?: Record<string, string>;
  ta?: Record<string, string>;
};

function evalCustomColumn(expr: string, quote: Quote | null, symbol: string): number | string | null {
  if (!quote) return null;
  try {
    // Build a sandbox with quote fields as local vars
    const fn = new Function(
      "last", "bid", "ask", "mid", "open", "high", "low",
      "prevClose", "change", "changePct", "volume", "spread", "symbol",
      `"use strict"; return (${expr});`,
    );
    const result = fn(
      quote.last, quote.bid, quote.ask, quote.mid, quote.open, quote.high, quote.low,
      quote.prevClose, quote.change, quote.changePct, quote.volume, quote.spread, symbol,
    );
    if (result === undefined || result === null) return null;
    return typeof result === "number" ? result : String(result);
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────
function changeColor(v: number): string {
  if (v > 0) return "text-green";
  if (v < 0) return "text-red";
  return "text-white/40";
}

function changeBg(v: number): string {
  if (v > 0) return "bg-green/[0.06]";
  if (v < 0) return "bg-red/[0.06]";
  return "";
}

// ─── Context menu item classes ──────────────────────────────────────
const ctxItemClass =
  "block w-full text-left px-3 py-1.5 text-[11px] text-white/60 hover:bg-white/[0.06] hover:text-white/80 transition-colors duration-75";

// ─── Props ──────────────────────────────────────────────────────────
interface WatchlistCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  onSymbolSelect?: (symbol: string) => void;
}

export default function WatchlistCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  config,
  onConfigChange,
  onSymbolSelect,
}: WatchlistCardProps) {
  const {
    symbols,
    setSymbols,
    insertSymbolAt: insertGlobalSymbolAt,
  } = useWatchlist();
  const savedColWidths = config.columnWidths as number[] | undefined;
  const savedTaColWidths = config.taColumnWidths as Record<string, number> | undefined;
  const taTimeframes: string[] = (config.taTimeframes as string[]) ?? [];
  const savedHeaderTints = (config.headerTints as HeaderTintConfig | undefined) ?? {};
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const nonEmptySymbols = useMemo(() => symbols.filter((sym) => sym.trim() !== ""), [symbols]);

  // Live market data
  const { quotes: watchlistData, status: symbolStatus } = useWatchlistData(nonEmptySymbols);

  // Technical analysis scores (polled every 60s)
  const techScores = useTechScores(nonEmptySymbols, taTimeframes);

  // TA timeframe selector popover
  const [taPopoverOpen, setTaPopoverOpen] = useState(false);
  const taPopoverRef = useRef<HTMLDivElement>(null);
  const taPopoverPanelRef = useRef<HTMLDivElement>(null);

  // ── Sorting ──
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectionAnchorIdx, setSelectionAnchorIdx] = useState<number | null>(null);

  const handleSort = useCallback((key: string) => {
    if (sortCol === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(key);
      setSortDir(key === "symbol" ? "asc" : "desc"); // numbers default desc
    }
  }, [sortCol]);

  const clearSort = useCallback(() => {
    setSortCol(null);
    setSortDir("asc");
  }, []);

  const sortedSymbols = useMemo(() => {
    if (!sortCol) return symbols;
    const sorted = [...nonEmptySymbols].sort((a, b) => {
      if (sortCol === "symbol") return a.localeCompare(b);
      const qa = watchlistData.get(a);
      const qb = watchlistData.get(b);
      const va = qa ? (sortCol === "last" ? qa.last : sortCol === "change" ? qa.change : qa.changePct) : 0;
      const vb = qb ? (sortCol === "last" ? qb.last : sortCol === "change" ? qb.change : qb.changePct) : 0;
      return va - vb;
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [nonEmptySymbols, sortCol, sortDir, watchlistData, symbols]);

  // ── Drag-to-reorder (mouse-event based, no HTML5 DnD) ──
  const rowsAreaRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    srcIdx: number;
    symbol: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [insertBeforeIdx, setInsertBeforeIdx] = useState<number | null>(null);
  // Synchronous mutable refs — updated directly (not via React state) so onUp always reads fresh values
  const dragSrcIdxRef = useRef<number | null>(null);
  const dragInsertBeforeRef = useRef<number | null>(null);
  const paneScrollRefs = useRef<Array<HTMLDivElement | null>>([]);
  const symbolsPerPaneRef = useRef(0);
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const moveSymbolToSlot = useCallback(
    (current: string[], srcIdx: number, dstIdx: number) => {
      if (srcIdx < 0 || srcIdx >= current.length) return current;
      const item = current[srcIdx];
      if (!item) return current;

      const next = [...current];
      const targetHasSymbol = dstIdx < next.length && next[dstIdx]?.trim() !== "";

      if (!targetHasSymbol) {
        if (dstIdx === srcIdx) return current;
        next[srcIdx] = "";
        if (dstIdx >= next.length) {
          for (let i = next.length; i < dstIdx; i += 1) {
            next[i] = "";
          }
        }
        next[dstIdx] = item;
        return next;
      }

      if (dstIdx === srcIdx) return current;

      next[srcIdx] = "";

      let carry = item;
      let insertIdx = dstIdx;
      while (true) {
        if (insertIdx >= next.length) {
          next.push(carry);
          break;
        }

        const displaced = next[insertIdx];
        next[insertIdx] = carry;

        if (!displaced) break;

        carry = displaced;
        insertIdx += 1;
      }

      return next;
    },
    [],
  );

  const startRowDrag = useCallback(
    (e: React.MouseEvent, srcIdx: number, symbol: string) => {
      if (sortCol) return; // no drag when sorted
      e.preventDefault();
      e.stopPropagation();

      dragSrcIdxRef.current = srcIdx;
      dragInsertBeforeRef.current = srcIdx;

      setDragState({ srcIdx, symbol, mouseX: e.clientX, mouseY: e.clientY });
      setInsertBeforeIdx(srcIdx);

      const onMove = (ev: MouseEvent) => {
        setDragState((prev) =>
          prev ? { ...prev, mouseX: ev.clientX, mouseY: ev.clientY } : null,
        );

        const activePane = paneScrollRefs.current.find((paneEl) => {
          if (!paneEl) return false;
          const rect = paneEl.getBoundingClientRect();
          return ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
        });

        const fallbackPane = rowsAreaRef.current;
        const area = activePane ?? fallbackPane;
        if (!area) return;

        const paneIdx = paneScrollRefs.current.findIndex((paneEl) => paneEl === area);
        const resolvedPaneIdx = paneIdx >= 0 ? paneIdx : 0;
        const rect = area.getBoundingClientRect();
        const relY = ev.clientY - rect.top + area.scrollTop;
        const symbolsPerPane = Math.max(1, symbolsPerPaneRef.current);
        const localIdx = Math.max(0, Math.min(Math.round(relY / ROW_H), symbolsPerPane));
        const idx = resolvedPaneIdx * symbolsPerPane + localIdx;
        // Update synchronous ref first — guaranteed fresh in onUp
        dragInsertBeforeRef.current = idx;
        setInsertBeforeIdx(idx);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const src = dragSrcIdxRef.current;
        const dst = dragInsertBeforeRef.current;
        dragSrcIdxRef.current = null;
        dragInsertBeforeRef.current = null;
        setDragState(null);
        setInsertBeforeIdx(null);
        if (src === null || dst === null) return;
        const syms = symbolsRef.current;
        if (src < 0 || src >= syms.length) return;
        // Clamp dst to valid range (empty rows beyond end → append at end)
        const clampedDst = Math.min(dst, syms.length);
        const next = moveSymbolToSlot(syms, src, clampedDst);
        if (next === syms) return;
        setSymbols(next);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sortCol, setSymbols, moveSymbolToSlot],
  );

  // ── Context menu state ──
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    globalIdx: number;
    isEmpty: boolean;
    symbol: string;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // ── Auto-edit after insert ──
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  // ── ETF holdings prompt ──
  const [etfPrompt, setEtfPrompt] = useState<{
    etfSymbol: string;
    etfName: string;
    holdings: EtfHolding[];
    selected: Set<string>;
  } | null>(null);

  // ── Custom scripted columns ──
  const savedCustomCols = ((config.customColumns as Record<string, unknown>[] | undefined) ?? []).map(migrateColumn);
  const [customColumns, setCustomColumns] = useState<CustomColumnDef[]>(savedCustomCols);
  const [columnEditor, setColumnEditor] = useState<CustomColumnDef | null>(null);
  const [columnEditorIsNew, setColumnEditorIsNew] = useState(false);
  const [builderKind, setBuilderKind] = useState<"score" | "crossover" | "indicator" | "expression">("score");

  // ── TA column widths ──
  const [taColWidths, setTaColWidths] = useState<Record<string, number>>(
    savedTaColWidths ?? {},
  );
  const [headerTints, setHeaderTints] = useState<HeaderTintConfig>(savedHeaderTints);

  // ── Column header context menu ──
  const [colHeaderMenu, setColHeaderMenu] = useState<ColHeaderMenuState | null>(null);
  const colHeaderMenuRef = useRef<HTMLDivElement>(null);

  // ── Dismiss context menu ──
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // ── Dismiss column header context menu ──
  useEffect(() => {
    if (!colHeaderMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (colHeaderMenuRef.current && !colHeaderMenuRef.current.contains(e.target as Node))
        setColHeaderMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColHeaderMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [colHeaderMenu]);

  // ── Dismiss TA popover on outside click / Escape ──
  useEffect(() => {
    if (!taPopoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        taPopoverRef.current
        && !taPopoverRef.current.contains(target)
        && !taPopoverPanelRef.current?.contains(target)
      )
        setTaPopoverOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTaPopoverOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [taPopoverOpen]);

  // ── Observe container width for multi-pane layout ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Column widths (resizable) ──
  const [colWidths, setColWidths] = useState<number[]>(
    savedColWidths ?? COLUMNS.map((c) => c.defaultWidth),
  );

  const persistConfig = useCallback(
    (updates: Record<string, unknown>) => {
      onConfigChange({ ...config, ...updates });
    },
    [config, onConfigChange],
  );

  const persistCustomColumns = useCallback(
    (cols: CustomColumnDef[]) => {
      setCustomColumns(cols);
      persistConfig({ columnWidths: colWidths, customColumns: cols, taColumnWidths: taColWidths, headerTints });
    },
    [colWidths, taColWidths, headerTints, persistConfig],
  );

  const persistHeaderTints = useCallback(
    (next: HeaderTintConfig) => {
      setHeaderTints(next);
      persistConfig({ columnWidths: colWidths, customColumns, taColumnWidths: taColWidths, headerTints: next });
    },
    [colWidths, customColumns, taColWidths, persistConfig],
  );

  // Fetch indicator values for non-expression custom columns
  const indicatorValues = useIndicatorValues(nonEmptySymbols, customColumns, watchlistData);

  // Compute custom column values for all symbols
  const customColValues = useMemo(() => {
    const result: Record<string, Record<string, number | string | null>> = {};
    for (const sym of symbols) {
      const quote = watchlistData.get(sym) ?? null;
      const vals: Record<string, number | string | null> = {};
      const indVals = indicatorValues.get(sym);
      for (const col of customColumns) {
        if (col.kind === "expression") {
          vals[col.id] = evalCustomColumn((col as ExpressionColumn).expression, quote, sym);
        } else {
          // indicator, crossover, score — values come from useIndicatorValues
          vals[col.id] = indVals?.get(col.id) ?? null;
        }
      }
      result[sym] = vals;
    }
    return result;
  }, [symbols, watchlistData, customColumns, indicatorValues]);

  // Persist column widths on change
  const persistColWidths = useCallback(
    (widths: number[]) => {
      persistConfig({ columnWidths: widths });
    },
    [persistConfig],
  );

  // ── Column resize drag (built-in columns) ──
  const handleColResize = useCallback(
    (colIdx: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = colWidths[colIdx];

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const newW = Math.max(COLUMNS[colIdx].minWidth, startW + dx);
        setColWidths((prev) => {
          const next = [...prev];
          next[colIdx] = newW;
          return next;
        });
      };

      const onUp = () => {
        setColWidths((prev) => {
          persistColWidths(prev);
          return prev;
        });
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [colWidths, persistColWidths],
  );

  // ── Custom column resize drag ──
  const handleCustomColResize = useCallback(
    (colId: string, startWidth: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const newW = Math.max(40, startWidth + dx);
        setCustomColumns((prev) =>
          prev.map((c) => (c.id === colId ? { ...c, width: newW } : c)),
        );
      };

      const onUp = () => {
        setCustomColumns((prev) => {
          persistConfig({ columnWidths: colWidths, customColumns: prev, taColumnWidths: taColWidths, headerTints });
          return prev;
        });
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [colWidths, taColWidths, headerTints, persistConfig],
  );

  // ── TA column resize drag ──
  const handleTaColResize = useCallback(
    (tf: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = taColWidths[tf] ?? TA_COL_W;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const newW = Math.max(36, startW + dx);
        setTaColWidths((prev) => ({ ...prev, [tf]: newW }));
      };

      const onUp = () => {
        setTaColWidths((prev) => {
          persistConfig({ columnWidths: colWidths, customColumns, taColumnWidths: prev, headerTints });
          return prev;
        });
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [colWidths, customColumns, taColWidths, headerTints, persistConfig],
  );

  // ── How many panes fit side-by-side? ──
  const paneWidth = useMemo(() => {
    const builtInWidth = colWidths.reduce((sum, width) => sum + width, 0);
    const customWidth = customColumns.reduce((sum, col) => sum + col.width, 0);
    const taWidth = taTimeframes.reduce((sum, tf) => sum + (taColWidths[tf] ?? TA_COL_W), 0);
    const gripWidth = sortCol ? 0 : ROW_GRIP_W;
    return builtInWidth + customWidth + taWidth + gripWidth + PANE_CHROME_W + PANE_GAP;
  }, [colWidths, customColumns, taColWidths, taTimeframes, sortCol]);
  const paneGridTemplate = useMemo(() => {
    const tracks: string[] = [];
    if (!sortCol) tracks.push(`${ROW_GRIP_W}px`);
    tracks.push(...colWidths.map((width) => `${width}px`));
    tracks.push(...customColumns.map((col) => `${col.width}px`));
    tracks.push(...taTimeframes.map((tf) => `${taColWidths[tf] ?? TA_COL_W}px`));
    return tracks.join(" ");
  }, [colWidths, customColumns, taColWidths, taTimeframes, sortCol]);
  const paneCount = Math.max(1, Math.floor(containerWidth / paneWidth));

  // ── TA timeframe mutations ──
  const updateTaTimeframes = useCallback(
    (next: string[]) => {
      persistConfig({ columnWidths: colWidths, taTimeframes: next, customColumns, taColumnWidths: taColWidths, headerTints });
    },
    [colWidths, customColumns, taColWidths, headerTints, persistConfig],
  );

  const setCustomHeaderTint = useCallback(
    (colId: string, value: string | null) => {
      const nextCustom = { ...(headerTints.custom ?? {}) };
      if (value) nextCustom[colId] = value;
      else delete nextCustom[colId];
      persistHeaderTints({ ...headerTints, custom: nextCustom });
    },
    [headerTints, persistHeaderTints],
  );

  const setTaHeaderTint = useCallback(
    (tf: string, value: string | null) => {
      const nextTa = { ...(headerTints.ta ?? {}) };
      if (value) nextTa[tf] = value;
      else delete nextTa[tf];
      persistHeaderTints({ ...headerTints, ta: nextTa });
    },
    [headerTints, persistHeaderTints],
  );

  // ── Symbol mutations ──
  const updateSymbols = useCallback(
    (next: string[]) => {
      setSymbols(next);
    },
    [setSymbols],
  );

  const clearSelection = useCallback(() => {
    setSelectedRows(new Set());
    setSelectionAnchorIdx(null);
  }, []);

  const removeSymbol = useCallback(
    (idx: number, sym: string) => {
      const current = symbolsRef.current;
      let targetIdx = idx;
      if (
        targetIdx < 0
        || targetIdx >= current.length
        || current[targetIdx] !== sym
      ) {
        const found = current.indexOf(sym);
        if (found === -1) return;
        targetIdx = found;
      }
      if (targetIdx < 0 || targetIdx >= current.length) return;
      const next = [...current];
      next[targetIdx] = "";
      setSelectedRows((prev) => {
        if (!prev.has(targetIdx)) return prev;
        const updated = new Set(prev);
        updated.delete(targetIdx);
        return updated;
      });
      setSymbols(next);
    },
    [setSymbols],
  );

  const removeSelectedRows = useCallback(() => {
    if (selectedRows.size === 0) return;
    const current = symbolsRef.current;
    let changed = false;
    const next = current.map((sym, idx) => {
      if (selectedRows.has(idx)) {
        changed = true;
        return "";
      }
      return sym;
    });
    if (!changed) return;
    setSymbols(next);
    clearSelection();
  }, [clearSelection, selectedRows, setSymbols]);

  const deleteRowAt = useCallback(
    (idx: number) => {
      const current = symbolsRef.current;
      if (idx < 0 || idx >= current.length) return;
      const next = [...current];
      next.splice(idx, 1);
      setSymbols(next);
      setSelectedRows((prev) => {
        if (prev.size === 0) return prev;
        const updated = new Set<number>();
        for (const selectedIdx of prev) {
          if (selectedIdx === idx) continue;
          updated.add(selectedIdx > idx ? selectedIdx - 1 : selectedIdx);
        }
        return updated;
      });
      setSelectionAnchorIdx((prev) => {
        if (prev === null) return prev;
        if (prev === idx) return null;
        return prev > idx ? prev - 1 : prev;
      });
    },
    [setSymbols],
  );

  const maybePromptEtf = useCallback((sym: string, nextSymbols: string[]) => {
    const etf = getEtfInfo(sym);
    if (!etf || etf.top_holdings.length === 0) return;
    const currentSet = new Set(nextSymbols.filter(Boolean));
    const available = etf.top_holdings.filter((h) => !currentSet.has(h.symbol));
    if (available.length === 0) return;
    setEtfPrompt({
      etfSymbol: etf.symbol,
      etfName: etf.name,
      holdings: available,
      selected: new Set(available.map((h) => h.symbol)),
    });
  }, []);

  const replaceSymbol = useCallback(
    (idx: number, oldSym: string, newSym: string) => {
      const upper = newSym.trim().toUpperCase();
      if (!upper) return;
      const current = symbolsRef.current;
      if (current.includes(upper) && current[idx] !== upper) return;
      let targetIdx = idx;
      if (
        targetIdx < 0
        || targetIdx >= current.length
        || current[targetIdx] !== oldSym
      ) {
        const found = current.indexOf(oldSym);
        if (found !== -1) {
          targetIdx = found;
        }
      }
      if (targetIdx < 0) return;
      const next = [...current];
      if (next.includes(upper) && next[targetIdx] !== upper) return;
      if (targetIdx >= next.length) {
        for (let i = next.length; i < targetIdx; i += 1) {
          next[i] = "";
        }
      }
      if (next[targetIdx] === upper) return;
      next[targetIdx] = upper;
      setSymbols(next);
      maybePromptEtf(upper, next);
    },
    [setSymbols, maybePromptEtf],
  );

  const insertSymbolAt = useCallback(
    (idx: number, sym: string) => {
      insertGlobalSymbolAt(idx, sym);
    },
    [insertGlobalSymbolAt],
  );

  const handleSelectSymbol = useCallback(
    (symbol: string, globalIdx: number, e: React.MouseEvent) => {
      if (e.shiftKey && selectionAnchorIdx !== null) {
        const start = Math.min(selectionAnchorIdx, globalIdx);
        const end = Math.max(selectionAnchorIdx, globalIdx);
        const next = new Set<number>();
        for (let i = start; i <= end; i += 1) {
          next.add(i);
        }
        setSelectedRows(next);
      } else if (e.metaKey || e.ctrlKey) {
        setSelectedRows((prev) => {
          const next = new Set(prev);
          if (next.has(globalIdx)) next.delete(globalIdx);
          else next.add(globalIdx);
          return next;
        });
        setSelectionAnchorIdx(globalIdx);
      } else {
        setSelectedRows(new Set([globalIdx]));
        setSelectionAnchorIdx(globalIdx);
      }
      onSymbolSelect?.(symbol);
      if (linkChannel) linkBus.publish(linkChannel, symbol);
    },
    [linkChannel, onSymbolSelect, selectionAnchorIdx],
  );

  useEffect(() => {
    setSelectedRows((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx >= 0 && idx < symbols.length) next.add(idx);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [symbols]);

  useEffect(() => {
    if (selectedRows.size === 0) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target?.isContentEditable
      ) {
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        for (const idx of [...selectedRows].sort((a, b) => b - a)) {
          if (!symbolsRef.current[idx]?.trim()) {
            deleteRowAt(idx);
          }
        }
        removeSelectedRows();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteRowAt, removeSelectedRows, selectedRows]);

  // ── How many visible rows per pane? ──
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState(300);
  const [rowsScrollbarWidth, setRowsScrollbarWidth] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setBodyHeight(entry.contentRect.height);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const el = rowsAreaRef.current;
    if (!el) return;
    const updateScrollbarWidth = () => {
      setRowsScrollbarWidth(el.offsetWidth - el.clientWidth);
    };
    updateScrollbarWidth();
    const obs = new ResizeObserver(() => updateScrollbarWidth());
    obs.observe(el);
    return () => obs.disconnect();
  }, [paneCount]);

  const rowsPerPane = Math.max(4, Math.floor((bodyHeight - HEADER_H) / ROW_H));

  // ── Include ALL symbols + at least 2 empty rows, then pad to fill visible space ──
  const displaySymbols = sortCol ? sortedSymbols : symbols;
  const minRows = displaySymbols.length + 2;
  const totalSlots = Math.max(minRows, rowsPerPane * paneCount);
  const paddedSymbols = [
    ...displaySymbols,
    ...Array.from({ length: Math.max(2, totalSlots - displaySymbols.length) }, () => ""),
  ];

  // Split into panes
  const symbolsPerPane = Math.ceil(paddedSymbols.length / paneCount);
  const panes: string[][] = [];
  for (let i = 0; i < paneCount; i++) {
    panes.push(paddedSymbols.slice(i * symbolsPerPane, (i + 1) * symbolsPerPane));
  }
  symbolsPerPaneRef.current = symbolsPerPane;

  const channelInfo = getChannelById(linkChannel);

  // ── Context menu actions ──
  const handleContextMenuAction = (action: "delete" | "insertAbove" | "insertBelow" | "insert") => {
    if (!contextMenu) return;
    const idx = contextMenu.globalIdx;
    const currentSymbols = symbolsRef.current;
    const resolvedRowIdx = contextMenu.symbol
      ? currentSymbols.indexOf(contextMenu.symbol)
      : -1;

    switch (action) {
      case "delete":
        if (contextMenu.isEmpty) deleteRowAt(idx);
        else if (idx < symbols.length) removeSymbol(idx, contextMenu.symbol);
        break;
      case "insertAbove": {
        const baseIdx = resolvedRowIdx !== -1 ? resolvedRowIdx : idx;
        const insertIdx = Math.min(baseIdx, currentSymbols.length);
        if (sortCol) setSortCol(null);
        insertSymbolAt(insertIdx, "");
        setEditingIdx(insertIdx);
        break;
      }
      case "insertBelow": {
        const baseIdx = resolvedRowIdx !== -1 ? resolvedRowIdx + 1 : idx + 1;
        const insertIdx = Math.min(baseIdx, currentSymbols.length);
        if (sortCol) setSortCol(null);
        insertSymbolAt(insertIdx, "");
        setEditingIdx(insertIdx);
        break;
      }
      case "insert": {
        const insertIdx = sortCol
          ? currentSymbols.length
          : Math.min(idx, currentSymbols.length);
        if (sortCol) setSortCol(null);
        insertSymbolAt(insertIdx, "");
        setEditingIdx(insertIdx);
        break;
      }
    }
    setContextMenu(null);
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel"
    >
      {/* Header */}
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-white/60">Watchlist</span>
          <span className="font-mono text-[9px] text-white/25">
            {nonEmptySymbols.length} symbol{nonEmptySymbols.length !== 1 ? "s" : ""}
          </span>
          {sortCol && (
            <button
              onClick={clearSort}
              className="flex h-3.5 items-center gap-1 rounded-sm border border-white/[0.08] px-1 text-[9px] text-white/45 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/70"
              title="Clear sort"
            >
              <span>{sortCol}</span>
              <X className="h-2.5 w-2.5" strokeWidth={1.75} />
            </button>
          )}
          {channelInfo && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: channelInfo.color }}
            />
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {/* Combined columns popover — TA scores + custom columns */}
          <div ref={taPopoverRef} className="relative">
            <button
              onClick={() => setTaPopoverOpen((v) => !v)}
              className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[10px] font-medium leading-none transition-colors duration-75 ${
                taTimeframes.length > 0 || customColumns.length > 0
                  ? "bg-blue/20 text-blue hover:bg-blue/30"
                  : "text-white/30 hover:bg-white/[0.06] hover:text-white/50"
              }`}
              title="Columns"
            >
              +
            </button>
            {taPopoverOpen && (
              <ColumnPopover
                anchorRef={taPopoverRef}
                panelRef={taPopoverPanelRef}
                taTimeframes={taTimeframes}
                customColumns={customColumns}
                onUpdateTaTimeframes={updateTaTimeframes}
                onAddPresetColumn={(col) => persistCustomColumns([...customColumns, col])}
                onOpenBuilder={(kind) => {
                  setBuilderKind(kind);
                  setColumnEditor(null);
                  setColumnEditorIsNew(true);
                }}
                onClose={() => setTaPopoverOpen(false)}
              />
            )}
          </div>
          <ComponentLinkMenu
            linkChannel={linkChannel}
            onSetLinkChannel={onSetLinkChannel}
          />
          <button
            onClick={onClose}
            className="rounded-sm p-0.5 text-white/30 transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
          >
            <X className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Body — data-no-drag prevents GridLayout from starting a component move on row mousedown */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden" data-no-drag>
        <div ref={bodyRef} className="flex h-full w-full gap-[6px]">
          {panes.map((pane, paneIdx) => (
            <div
              key={paneIdx}
              className="flex min-h-0 flex-1 flex-col overflow-hidden border border-white/[0.06]"
              style={{ minWidth: 0 }}
            >
              {/* Column headers — click to sort */}
              <div
                className="grid shrink-0 items-center border-b border-white/[0.06] bg-[#0D1117]"
                style={{
                  height: HEADER_H,
                  gridTemplateColumns: paneGridTemplate,
                  paddingRight: rowsScrollbarWidth,
                }}
              >
                {!sortCol && <div />}
                {COLUMNS.map((col, ci) => (
                  <div
                    key={col.key}
                    className={`relative min-w-0 select-none truncate px-1.5 text-[9px] font-medium uppercase tracking-wider cursor-pointer transition-colors duration-75 ${
                      sortCol === col.key ? "text-white/70" : "text-white/40 hover:text-white/55"
                    } ${ci < COLUMNS.length - 1 || customColumns.length > 0 || taTimeframes.length > 0 ? "border-r border-white/[0.06]" : ""}`}
                    style={{
                      textAlign: col.align,
                    }}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {sortCol === col.key && (
                      <span className="ml-0.5 text-[8px] text-white/50">
                        {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                      </span>
                    )}
                    {/* Resize handle — overlaps the column border */}
                    <div
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue/[0.15]"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleColResize(ci, e);
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    />
                  </div>
                ))}
                {/* Custom column headers */}
                {customColumns.map((col, ci) => (
                  <div
                    key={col.id}
                    className={`relative min-w-0 select-none truncate px-1.5 text-[9px] font-medium uppercase tracking-wider text-purple/70 cursor-pointer transition-colors duration-75 hover:text-purple ${
                      ci < customColumns.length - 1 || taTimeframes.length > 0 ? "border-r border-white/[0.06]" : ""
                    }`}
                    style={{
                      textAlign: "right",
                      color: headerTints.custom?.[col.id],
                      backgroundColor: headerTints.custom?.[col.id] ? `${headerTints.custom[col.id]}14` : undefined,
                    }}
                    onDoubleClick={() => {
                      setColumnEditor({ ...col });
                      setColumnEditorIsNew(false);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setColHeaderMenu({ x: e.clientX, y: e.clientY, type: "custom", colId: col.id });
                    }}
                    title="Double-click to edit · Right-click for options"
                  >
                    {col.label}
                    <div
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-purple/[0.15]"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleCustomColResize(col.id, col.width, e);
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    />
                  </div>
                ))}
                {/* TA Score column headers */}
                {taTimeframes.map((tf, ti) => (
                  <div
                    key={`tah-${tf}`}
                    className={`relative min-w-0 select-none truncate px-1 text-center text-[9px] font-medium uppercase tracking-wider text-blue/50 cursor-default ${
                      ti < taTimeframes.length - 1 ? "border-r border-white/[0.06]" : ""
                    }`}
                    style={{
                      color: headerTints.ta?.[tf],
                      backgroundColor: headerTints.ta?.[tf] ? `${headerTints.ta[tf]}14` : undefined,
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setColHeaderMenu({ x: e.clientX, y: e.clientY, type: "ta", tf });
                    }}
                    title={`Technical score ${tf} · Right-click to remove`}
                  >
                    {tf}
                    <div
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue/[0.15]"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleTaColResize(tf, e);
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    />
                  </div>
                ))}

              </div>

              <WatchlistPaneRows
                pane={pane}
                paneIdx={paneIdx}
                symbolsPerPane={symbolsPerPane}
                onRowsAreaRef={(el) => {
                  paneScrollRefs.current[paneIdx] = el;
                }}
                watchlistData={watchlistData}
                symbolStatus={symbolStatus}
                rowsAreaRef={paneIdx === 0 ? rowsAreaRef : undefined}
                onRowsScrollbarWidthChange={paneIdx === 0 ? setRowsScrollbarWidth : undefined}
                onContextMenu={(x, y, globalIdx, sym) =>
                  setContextMenu({
                    x,
                    y,
                    globalIdx,
                    isEmpty: !sym,
                    symbol: sym,
                  })
                }
                onReplace={replaceSymbol}
                onRemove={removeSymbol}
                onDeleteBlankRow={deleteRowAt}
                selectedRows={selectedRows}
                onSelectSymbol={handleSelectSymbol}
                onSymbolSelect={onSymbolSelect}
                editingIdx={editingIdx}
                onForceEditConsumed={() => setEditingIdx(null)}
                customColumns={customColumns}
                customColValues={customColValues}
                taTimeframes={taTimeframes}
                techScores={techScores}
                gridTemplateColumns={paneGridTemplate}
                showGrip={!sortCol}
                insertBeforeIdx={insertBeforeIdx}
                startRowDrag={startRowDrag}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[100] min-w-[140px] rounded-md border border-white/[0.08] bg-[#1C2128] py-1 shadow-xl shadow-black/40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.isEmpty ? (
            <>
              <button className={ctxItemClass} onClick={() => handleContextMenuAction("insert")}>
                Insert Row
              </button>
              <button className={`${ctxItemClass} text-red/60 hover:text-red`} onClick={() => handleContextMenuAction("delete")}>
                Delete Row
              </button>
            </>
          ) : (
            <>
              <button className={ctxItemClass} onClick={() => handleContextMenuAction("delete")}>
                Delete Row
              </button>
              <button className={ctxItemClass} onClick={() => handleContextMenuAction("insertAbove")}>
                Insert Row Above
              </button>
              <button className={ctxItemClass} onClick={() => handleContextMenuAction("insertBelow")}>
                Insert Row Below
              </button>
            </>
          )}
        </div>
      )}

      {/* Drag ghost — floats at cursor */}
      {dragState && (
        <div
          className="pointer-events-none fixed z-[300] flex items-center gap-1.5 rounded border border-blue/40 bg-base/90 px-2 py-0.5 font-mono text-[10px] text-white/70 shadow-lg backdrop-blur-sm"
          style={{ left: dragState.mouseX + 12, top: dragState.mouseY - 10 }}
        >
          <GripVertical className="h-2.5 w-2.5 text-white/30" strokeWidth={1.5} />
          {dragState.symbol}
        </div>
      )}

      {/* Column Header Context Menu */}
      {colHeaderMenu && (
        <div
          ref={colHeaderMenuRef}
          className="fixed z-[100] min-w-[140px] rounded-md border border-white/[0.08] bg-[#1C2128] py-1 shadow-xl shadow-black/40"
          style={{ left: colHeaderMenu.x, top: colHeaderMenu.y }}
        >
          {colHeaderMenu.type === "custom" && (() => {
            const col = customColumns.find((c) => c.id === colHeaderMenu.colId);
            if (!col) return null;
            return (
              <>
                <button
                  className={ctxItemClass}
                  onClick={() => {
                    setColumnEditor({ ...col });
                    setColumnEditorIsNew(false);
                    setColHeaderMenu(null);
                  }}
                >
                  Edit Column
                </button>
                <div className="px-2 py-1">
                  <div className="mb-1 text-[9px] uppercase tracking-wider text-white/25">Header Color</div>
                  <div className="grid grid-cols-2 gap-1">
                    {HEADER_TINT_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[10px] text-white/60 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/85"
                        onClick={() => {
                          setCustomHeaderTint(col.id, preset.value);
                          setColHeaderMenu(null);
                        }}
                      >
                        <span
                          className="h-2 w-2 rounded-full border border-white/10"
                          style={{ backgroundColor: preset.value ?? "transparent" }}
                        />
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  className={`${ctxItemClass} text-red/60 hover:text-red`}
                  onClick={() => {
                    persistCustomColumns(customColumns.filter((c) => c.id !== col.id));
                    setColHeaderMenu(null);
                  }}
                >
                  Delete Column
                </button>
              </>
            );
          })()}
          {colHeaderMenu.type === "ta" && (
            <>
              <div className="px-2 py-1">
                <div className="mb-1 text-[9px] uppercase tracking-wider text-white/25">Header Color</div>
                <div className="grid grid-cols-2 gap-1">
                  {HEADER_TINT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[10px] text-white/60 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/85"
                      onClick={() => {
                        setTaHeaderTint(colHeaderMenu.tf, preset.value);
                        setColHeaderMenu(null);
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full border border-white/10"
                        style={{ backgroundColor: preset.value ?? "transparent" }}
                      />
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className={`${ctxItemClass} text-red/60 hover:text-red`}
                onClick={() => {
                  updateTaTimeframes(taTimeframes.filter((tf) => tf !== colHeaderMenu.tf));
                  setColHeaderMenu(null);
                }}
              >
                Remove Timeframe
              </button>
            </>
          )}
        </div>
      )}

      {/* Custom Column Builder Modal */}
      {(columnEditor !== null || columnEditorIsNew) && (
        <ColumnBuilderModal
          editColumn={columnEditor}
          initialKind={builderKind}
          onSave={(col) => {
            if (columnEditorIsNew) {
              persistCustomColumns([...customColumns, col]);
            } else {
              persistCustomColumns(
                customColumns.map((c) => (c.id === col.id ? col : c)),
              );
            }
            setColumnEditor(null);
            setColumnEditorIsNew(false);
          }}
          onDelete={columnEditorIsNew ? undefined : (colId) => {
            persistCustomColumns(customColumns.filter((c) => c.id !== colId));
            setColumnEditor(null);
            setColumnEditorIsNew(false);
          }}
          onCancel={() => {
            setColumnEditor(null);
            setColumnEditorIsNew(false);
          }}
        />
      )}

      {/* ETF Holdings Prompt */}
      {etfPrompt && createPortal(
        <div className="fixed inset-0 z-[340] flex items-center justify-center bg-black/50">
          <div className="w-[340px] rounded-lg border border-white/[0.10] bg-[#161B22] shadow-2xl shadow-black/60">
            {/* Header */}
            <div className="border-b border-white/[0.08] px-4 pt-4 pb-3">
              <p className="text-[12px] font-semibold text-white/90">
                Add top holdings?
              </p>
              <p className="mt-1 text-[10px] text-white/40">
                <span className="font-mono text-white/60">{etfPrompt.etfSymbol}</span>
                {" "}({etfPrompt.etfName}) has {etfPrompt.holdings.length} holdings not in your watchlist.
              </p>
            </div>

            {/* Holdings list */}
            <div className="max-h-[240px] overflow-y-auto scrollbar-none px-2 py-2">
              {etfPrompt.holdings.map((h) => (
                <label
                  key={h.symbol}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white/[0.04]"
                >
                  <input
                    type="checkbox"
                    checked={etfPrompt.selected.has(h.symbol)}
                    onChange={() => {
                      setEtfPrompt((prev) => {
                        if (!prev) return prev;
                        const next = new Set(prev.selected);
                        if (next.has(h.symbol)) next.delete(h.symbol);
                        else next.add(h.symbol);
                        return { ...prev, selected: next };
                      });
                    }}
                    className="h-3 w-3 rounded border-white/20 bg-transparent accent-blue"
                  />
                  <span className="w-12 shrink-0 font-mono text-[10px] font-medium text-white/80">
                    {h.symbol}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[9px] text-white/40">
                    {h.name}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-white/25">
                    {h.weight_pct.toFixed(1)}%
                  </span>
                </label>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between border-t border-white/[0.08] px-4 py-3">
              <button
                onClick={() => {
                  // Toggle all / none
                  setEtfPrompt((prev) => {
                    if (!prev) return prev;
                    const allSelected = prev.selected.size === prev.holdings.length;
                    return {
                      ...prev,
                      selected: allSelected
                        ? new Set<string>()
                        : new Set(prev.holdings.map((h) => h.symbol)),
                    };
                  });
                }}
                className="text-[10px] text-white/30 hover:text-white/50"
              >
                {etfPrompt.selected.size === etfPrompt.holdings.length ? "Deselect all" : "Select all"}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEtfPrompt(null)}
                  className="rounded px-3 py-1.5 text-[10px] font-medium text-white/40 hover:bg-white/[0.06] hover:text-white/60"
                >
                  Skip
                </button>
                <button
                  onClick={() => {
                    if (etfPrompt.selected.size > 0) {
                      const toAdd = etfPrompt.holdings
                        .filter((h) => etfPrompt.selected.has(h.symbol))
                        .map((h) => h.symbol)
                        .filter((s) => !symbols.includes(s));
                      if (toAdd.length > 0) {
                        updateSymbols([...symbols, ...toAdd]);
                      }
                    }
                    setEtfPrompt(null);
                  }}
                  className="rounded bg-blue/80 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-blue"
                >
                  Add {etfPrompt.selected.size} holding{etfPrompt.selected.size !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Row component ──────────────────────────────────────────────────
interface WatchlistRowProps {
  symbol: string;
  quote: Quote | null;
  status: SymbolStatus | null;
  globalIdx: number;
  rowIdx: number;
  selected: boolean;
  onReplace: (newSym: string) => void;
  onRemove: () => void;
  onDeleteBlankRow: () => void;
  onSymbolSelect?: (symbol: string, globalIdx: number, e: React.MouseEvent) => void;
  forceEdit: boolean;
  onForceEditConsumed: () => void;
  onContextMenu: (x: number, y: number) => void;
  customColumns: CustomColumnDef[];
  customValues: Record<string, number | string | null>;
  taTimeframes: string[];
  taScores: Record<string, number | null>;
  gridTemplateColumns: string;
  showGrip: boolean;
  reserveGripSpace: boolean;
  insertLineBefore: boolean;
  onGripMouseDown: (e: React.MouseEvent) => void;
}

interface WatchlistPaneRowsProps {
  pane: string[];
  paneIdx: number;
  symbolsPerPane: number;
  onRowsAreaRef?: (el: HTMLDivElement | null) => void;
  watchlistData: Map<string, Quote>;
  symbolStatus: Map<string, SymbolStatus>;
  rowsAreaRef?: MutableRefObject<HTMLDivElement | null>;
  onRowsScrollbarWidthChange?: (width: number) => void;
  onContextMenu: (x: number, y: number, globalIdx: number, symbol: string) => void;
  onReplace: (globalIdx: number, symbol: string, newSym: string) => void;
  onRemove: (globalIdx: number, symbol: string) => void;
  onDeleteBlankRow: (globalIdx: number) => void;
  selectedRows: Set<number>;
  onSelectSymbol: (symbol: string, globalIdx: number, e: React.MouseEvent) => void;
  onSymbolSelect?: (symbol: string) => void;
  editingIdx: number | null;
  onForceEditConsumed: () => void;
  customColumns: CustomColumnDef[];
  customColValues: Record<string, Record<string, number | string | null>>;
  taTimeframes: string[];
  techScores: Map<string, Map<string, number | null>>;
  gridTemplateColumns: string;
  showGrip: boolean;
  insertBeforeIdx: number | null;
  startRowDrag: (e: React.MouseEvent, globalIdx: number, symbol: string) => void;
}

function WatchlistPaneRows({
  pane,
  paneIdx,
  symbolsPerPane,
  onRowsAreaRef,
  watchlistData,
  symbolStatus,
  rowsAreaRef,
  onRowsScrollbarWidthChange,
  onContextMenu,
  onReplace,
  onRemove,
  onDeleteBlankRow,
  selectedRows,
  onSelectSymbol,
  onSymbolSelect,
  editingIdx,
  onForceEditConsumed,
  customColumns,
  customColValues,
  taTimeframes,
  techScores,
  gridTemplateColumns,
  showGrip,
  insertBeforeIdx,
  startRowDrag,
}: WatchlistPaneRowsProps) {
  const localRowsRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = rowsAreaRef ?? localRowsRef;
  const [scrollMetrics, setScrollMetrics] = useState({
    hasOverflow: false,
    thumbHeight: 0,
    thumbOffset: 0,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateMetrics = () => {
      const maxScroll = el.scrollHeight - el.clientHeight;
      const hasOverflow = maxScroll > 1;
      const thumbHeight = hasOverflow
        ? Math.max(28, (el.clientHeight / el.scrollHeight) * el.clientHeight)
        : el.clientHeight;
      const thumbOffset = hasOverflow
        ? (el.scrollTop / maxScroll) * (el.clientHeight - thumbHeight)
        : 0;
      setScrollMetrics({ hasOverflow, thumbHeight, thumbOffset });
      onRowsScrollbarWidthChange?.(el.offsetWidth - el.clientWidth);
    };

    updateMetrics();

    el.addEventListener("scroll", updateMetrics);
    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener("scroll", updateMetrics);
      resizeObserver.disconnect();
    };
  }, [onRowsScrollbarWidthChange, pane.length, scrollRef]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={(el) => {
          if (rowsAreaRef) {
            rowsAreaRef.current = el;
          } else {
            localRowsRef.current = el;
          }
          onRowsAreaRef?.(el);
        }}
        className="scrollbar-watchlist relative h-full overflow-y-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        {pane.map((sym, rowIdx) => {
          const globalIdx = paneIdx * symbolsPerPane + rowIdx;
          return (
            <WatchlistRow
              key={`${paneIdx}-${rowIdx}`}
              symbol={sym}
              quote={sym ? watchlistData.get(sym) ?? null : null}
              status={sym ? symbolStatus.get(sym) ?? null : null}
              globalIdx={globalIdx}
              rowIdx={rowIdx}
              selected={selectedRows.has(globalIdx)}
              onReplace={(newSym) => onReplace(globalIdx, sym, newSym)}
              onRemove={() => onRemove(globalIdx, sym)}
              onDeleteBlankRow={() => onDeleteBlankRow(globalIdx)}
              onSymbolSelect={(selectedSym, selectedIdx, e) => {
                onSelectSymbol(selectedSym, selectedIdx, e);
                onSymbolSelect?.(selectedSym);
              }}
              forceEdit={editingIdx === globalIdx}
              onForceEditConsumed={onForceEditConsumed}
              onContextMenu={(x, y) => onContextMenu(x, y, globalIdx, sym)}
              customColumns={customColumns}
              customValues={sym ? customColValues[sym] ?? {} : {}}
              taTimeframes={taTimeframes}
              taScores={
                sym ? (Object.fromEntries(techScores.get(sym) ?? new Map()) as Record<string, number | null>) : {}
              }
              gridTemplateColumns={gridTemplateColumns}
              showGrip={showGrip && !!sym}
              reserveGripSpace={showGrip}
              insertLineBefore={insertBeforeIdx === globalIdx}
              onGripMouseDown={(e) => startRowDrag(e, globalIdx, sym)}
            />
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-y-0 right-0 flex w-[10px] justify-center bg-[#0D1117]">
        <div className="my-1 w-[6px] rounded-full bg-white/[0.05]">
          <div
            className="rounded-full bg-white/[0.18] transition-[height,transform] duration-100"
            style={{
              height: `${Math.max(scrollMetrics.thumbHeight - 8, 18)}px`,
              transform: `translateY(${scrollMetrics.thumbOffset + 4}px)`,
              opacity: scrollMetrics.hasOverflow ? 1 : 0.35,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function WatchlistRow({
  symbol,
  quote,
  status,
  globalIdx,
  rowIdx,
  selected,
  onReplace,
  onRemove,
  onDeleteBlankRow,
  onSymbolSelect,
  forceEdit,
  onForceEditConsumed,
  onContextMenu,
  customColumns,
  customValues,
  taTimeframes,
  taScores,
  gridTemplateColumns,
  showGrip,
  reserveGripSpace,
  insertLineBefore,
  onGripMouseDown,
}: WatchlistRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [hovered, setHovered] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const symbolCellRef = useRef<HTMLDivElement>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const name = symbol ? getSymbolName(symbol) : "";

  // Focus input when editing
  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  // Auto-enter edit mode when forceEdit is set on an empty row
  useEffect(() => {
    if (forceEdit && !symbol) {
      setEditing(true);
      onForceEditConsumed();
    }
  }, [forceEdit, symbol, onForceEditConsumed]);

  // Filter suggestions — search symbol, name, sector, and industry
  const q = editValue.toLowerCase();
  const suggestions = editValue
    ? SEARCHABLE_SYMBOLS.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.sector.toLowerCase().includes(q) ||
          s.industry.toLowerCase().includes(q),
      ).slice(0, 8)
    : [];

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightIdx(-1);
  }, [editValue]);

  useEffect(() => {
    if (highlightIdx < 0) return;
    suggestionRefs.current[highlightIdx]?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  const commitSymbol = (sym: string) => {
    const upper = sym.trim().toUpperCase();
    if (upper) onReplace(upper);
    setEditing(false);
    setEditValue("");
    setShowSuggestions(false);
    setHighlightIdx(-1);
  };

  const moveSuggestionHighlight = useCallback(
    (direction: "next" | "prev") => {
      if (suggestions.length === 0) return;
      setShowSuggestions(true);
      setHighlightIdx((prev) => {
        if (direction === "next") {
          if (prev < 0) return 0;
          return Math.min(prev + 1, suggestions.length - 1);
        }
        if (prev < 0) return suggestions.length - 1;
        return Math.max(prev - 1, 0);
      });
    },
    [suggestions.length],
  );

  const getHighlightedSuggestion = useCallback(() => {
    if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
      return suggestions[highlightIdx].symbol;
    }
    if (suggestions.length > 0) {
      return suggestions[0].symbol;
    }
    return editValue;
  }, [editValue, highlightIdx, suggestions]);

  const handleSuggestionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, commit: (sym: string) => void) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSuggestionHighlight("next");
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSuggestionHighlight("prev");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        commit(getHighlightedSuggestion());
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(false);
        setEditValue("");
        setShowSuggestions(false);
        setHighlightIdx(-1);
      }
    },
    [getHighlightedSuggestion, moveSuggestionHighlight],
  );

  const handleRowContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(e.clientX, e.clientY);
  };

  // Zebra striping: even rows panel bg, odd rows base/80
  const zebraClass = rowIdx % 2 === 0 ? "bg-panel" : "bg-base/80";

  // Empty row — click to type
  if (!symbol) {
    return (
      <div
        className={`relative flex items-center border-b border-white/[0.03] ${zebraClass} hover:bg-white/[0.05]`}
        style={{ height: ROW_H }}
        onContextMenu={handleRowContextMenu}
      >
        {insertLineBefore && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-blue" />
        )}
        {reserveGripSpace && <div className="shrink-0" style={{ width: ROW_GRIP_W }} />}
        {editing ? (
          <div className="relative flex-1 px-1">
            <input
              ref={inputRef}
              value={editValue}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setEditValue(e.target.value);
                setShowSuggestions(true);
              }}
              onKeyDown={(e) => handleSuggestionKeyDown(e, commitSymbol)}
              onBlur={() => {
                // Delay to allow click on suggestion
                setTimeout(() => {
                  setEditing(false);
                  setEditValue("");
                  setShowSuggestions(false);
                }, 150);
              }}
              placeholder="Type symbol..."
              className="w-full bg-transparent font-mono text-[10px] text-white/70 placeholder:text-white/15 focus:outline-none"
            />
            {showSuggestions && suggestions.length > 0 && inputRef.current && (() => {
              const rect = inputRef.current!.getBoundingClientRect();
              return (
              <div
                className="fixed z-[130] w-[260px] rounded-md border border-white/[0.08] bg-[#1C2128] py-0.5 shadow-xl shadow-black/40"
                style={{ left: rect.left, top: rect.bottom + 2 }}
              >
                {suggestions.map((s, i) => (
                  <button
                    key={s.symbol}
                    ref={(el) => {
                      suggestionRefs.current[i] = el;
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commitSymbol(s.symbol);
                    }}
                    onMouseEnter={() => setHighlightIdx(i)}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left transition-colors duration-75 ${
                      i === highlightIdx
                        ? "bg-white/[0.08] text-white/90"
                        : "hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className={`w-12 shrink-0 font-mono text-[10px] font-medium ${
                      i === highlightIdx ? "text-white/90" : "text-white/70"
                    }`}>
                      {s.symbol}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate text-[9px] ${
                        i === highlightIdx ? "text-white/50" : "text-white/30"
                      }`}>
                        {s.name}
                      </span>
                      {s.sector && (
                        <span className={`truncate text-[8px] ${
                          i === highlightIdx ? "text-white/30" : "text-white/15"
                        }`}>
                          {s.sector}{s.industry ? ` · ${s.industry}` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
              );
            })()}
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                onDeleteBlankRow();
              }
            }}
            className="flex h-full flex-1 items-center px-1.5"
          >
            <span className="text-[10px] text-white/10">+</span>
          </button>
        )}
      </div>
    );
  }

  // Double-click to edit a populated row
  const commitReplace = (sym: string) => {
    const upper = sym.trim().toUpperCase();
    if (upper && upper !== symbol) {
      onReplace(upper);
    }
    setEditing(false);
    setEditValue("");
    setShowSuggestions(false);
    setHighlightIdx(-1);
  };

  // If editing a populated row (via double-click)
  if (editing && symbol) {
    return (
      <div
        className={`flex items-center border-b border-white/[0.03] ${zebraClass}`}
        style={{ height: ROW_H }}
        onContextMenu={handleRowContextMenu}
      >
        {reserveGripSpace && <div className="shrink-0" style={{ width: ROW_GRIP_W }} />}
        <div className="relative flex-1 px-1">
          <input
            ref={inputRef}
            value={editValue}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setEditValue(e.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={(e) => handleSuggestionKeyDown(e, commitReplace)}
            onBlur={() => {
              setTimeout(() => {
                setEditing(false);
                setEditValue("");
                setShowSuggestions(false);
              }, 150);
            }}
            placeholder={symbol}
            className="w-full bg-transparent font-mono text-[10px] text-white/70 placeholder:text-white/25 focus:outline-none"
          />
          {showSuggestions && suggestions.length > 0 && inputRef.current && (() => {
            const rect = inputRef.current!.getBoundingClientRect();
            return (
              <div
                className="fixed z-[130] w-[260px] rounded-md border border-white/[0.08] bg-[#1C2128] py-0.5 shadow-xl shadow-black/40"
                style={{ left: rect.left, top: rect.bottom + 2 }}
              >
                {suggestions.map((s, i) => (
                  <button
                    key={s.symbol}
                    ref={(el) => {
                      suggestionRefs.current[i] = el;
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commitReplace(s.symbol);
                    }}
                    onMouseEnter={() => setHighlightIdx(i)}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left transition-colors duration-75 ${
                      i === highlightIdx
                        ? "bg-white/[0.08] text-white/90"
                        : "hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className={`w-12 shrink-0 font-mono text-[10px] font-medium ${
                      i === highlightIdx ? "text-white/90" : "text-white/70"
                    }`}>
                      {s.symbol}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate text-[9px] ${
                        i === highlightIdx ? "text-white/50" : "text-white/30"
                      }`}>
                        {s.name}
                      </span>
                      {s.sector && (
                        <span className={`truncate text-[8px] ${
                          i === highlightIdx ? "text-white/30" : "text-white/15"
                        }`}>
                          {s.sector}{s.industry ? ` · ${s.industry}` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  // Populated row
  const isError = status === "error";

  return (
    <div
      ref={rowRef}
      className={`group relative grid items-center border-b transition-colors duration-75 focus:outline-none ${
        isError
          ? "border-red/20 bg-red/[0.08] hover:bg-red/[0.12] focus:bg-red/[0.10]"
          : `border-white/[0.03] hover:bg-white/[0.05] focus:bg-white/[0.04] ${
              quote && quote.change !== 0 ? changeBg(quote.change) : zebraClass
            }`
      }`}
      style={{ height: ROW_H, gridTemplateColumns }}
      onClick={(e) => {
        onSymbolSelect?.(symbol, globalIdx, e);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        setEditing(true);
        setEditValue("");
      }}
      onContextMenu={handleRowContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onRemove();
        }
      }}
      tabIndex={0}
    >
      {/* Insertion line above this row */}
      {insertLineBefore && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-blue" />
      )}
      {selected && (
        <div className="pointer-events-none absolute inset-[1px] rounded-[3px] border border-blue/55 shadow-[inset_0_0_0_1px_rgba(125,194,255,0.15)]" />
      )}
      {/* Grip handle */}
      {reserveGripSpace && (
        <div
          className={`flex shrink-0 items-center justify-center ${showGrip ? "cursor-grab opacity-0 group-hover:opacity-100" : ""}`}
          style={{ width: ROW_GRIP_W }}
          onMouseDown={showGrip ? onGripMouseDown : undefined}
          data-no-drag
        >
          {showGrip && <GripVertical className="h-3 w-3 text-white/25" strokeWidth={1.5} />}
        </div>
      )}
      {/* Symbol */}
      <div
        ref={symbolCellRef}
        className={`min-w-0 truncate border-r border-white/[0.06] px-1.5 font-mono text-[10px] font-medium ${
          isError ? "text-red/80" : "text-white/80"
        }`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {symbol}
      </div>

      {/* Last */}
      <div
        className={`min-w-0 truncate border-r border-white/[0.06] px-1.5 text-right font-mono text-[10px] ${
          isError ? "text-red/40" : "text-white/70"
        }`}
      >
        {quote ? quote.last.toFixed(2) : isError ? "ERR" : "—"}
      </div>

      {/* Change */}
      <div
        className={`min-w-0 truncate border-r border-white/[0.06] px-1.5 text-right font-mono text-[10px] font-medium ${
          isError ? "text-red/40" : quote ? changeColor(quote.change) : "text-white/30"
        }`}
      >
        {quote
          ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)}`
          : isError ? "—" : "—"}
      </div>

      {/* Change % */}
      <div
        className={`min-w-0 truncate ${customColumns.length > 0 || taTimeframes.length > 0 ? "border-r border-white/[0.06]" : ""} px-1.5 text-right font-mono text-[10px] font-medium ${
          isError ? "text-red/40" : quote ? changeColor(quote.changePct) : "text-white/30"
        }`}
      >
        {quote
          ? `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`
          : "—"}
      </div>

      {/* Custom scripted columns */}
      {customColumns.map((col, ci) => {
        const val = customValues[col.id];
        const isNum = typeof val === "number";
        const isStr = typeof val === "string";
        const isCrossover = col.kind === "crossover";
        const shouldColorize = "colorize" in col && col.colorize;
        let colorClass = "text-white/50";
        let displayValue = val != null ? (isNum ? (val as number).toFixed(col.decimals ?? 0) : String(val)) : "—";
        if (isCrossover && isStr) {
          colorClass =
            val === "BUY"
              ? "bg-green/[0.16] text-green font-medium"
              : val === "SELL"
                ? "bg-red/[0.16] text-red font-medium"
                : "bg-yellow/20 text-yellow font-medium";
          displayValue =
            val === "BUY"
              ? "\u2197"
              : val === "SELL"
                ? "\u2198"
                : "-";
        } else if (isNum && shouldColorize) {
          colorClass = (val as number) > 50 ? "text-green font-medium" : (val as number) < 50 ? "text-red font-medium" : "text-white/50";
        }
        return (
          <div
            key={col.id}
            className={`min-w-0 truncate px-1.5 font-mono text-[10px] ${isCrossover ? "text-center" : "text-right"} ${colorClass} ${ci < customColumns.length - 1 || taTimeframes.length > 0 ? "border-r border-white/[0.06]" : ""}`}
          >
            {displayValue}
          </div>
        );
      })}

      {/* TA score cells */}
      {taTimeframes.map((tf, ti) => {
        const score = taScores[tf] ?? null;
        return (
          <div
            key={`ta-${tf}`}
            className={`min-w-0 truncate px-1 text-center font-mono text-[10px] font-medium ${
              ti < taTimeframes.length - 1 ? "border-r border-white/[0.06]" : ""
            } ${
              score === null
                ? "text-white/15"
                : score > 60
                  ? "text-green"
                  : score < 40
                    ? "text-red"
                    : "text-white/40"
            }`}
            title={`${tf} technical score: ${score ?? "no data"}`}
          >
            {score === null ? "—" : score}
          </div>
        );
      })}

      {/* Hover tooltip — fixed position to escape overflow clipping */}
      {hovered && symbolCellRef.current && (() => {
        const rect = symbolCellRef.current!.getBoundingClientRect();
        return (
          <div
            className="pointer-events-none fixed z-[140] rounded-md border border-white/[0.08] bg-[#1C2128] px-2.5 py-1.5 shadow-xl shadow-black/40"
            style={{
              left: rect.left,
              top: Math.max(4, rect.top - 4),
              transform: "translateY(-100%)",
            }}
          >
            <p className={`font-mono text-[11px] font-semibold ${isError ? "text-red" : "text-white/90"}`}>
              {symbol}
            </p>
            <p className="text-[9px] text-white/40">{name}</p>
            {isError && (
              <p className="mt-0.5 text-[8px] text-red/60">
                Symbol not recognized — remove or replace
              </p>
            )}
            {!quote && !isError && (
              <p className="mt-0.5 text-[8px] text-white/20">
                Waiting for TWS data
              </p>
            )}
          </div>
        );
      })()}
    </div>
  );
}

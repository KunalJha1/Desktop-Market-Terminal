import { useState, useRef, useCallback, useEffect, useMemo, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { X, GripVertical, Settings } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import { getChannelById } from "../lib/link-channels";
import { linkBus } from "../lib/link-bus";
import { getSymbolName, SEARCHABLE_SYMBOLS, getEtfInfo, filterRankSymbolSearch } from "../lib/market-data";
import type { Quote, EtfHolding } from "../lib/market-data";
import { useWatchlistData, type SymbolStatus } from "../lib/use-market-data";
import { describeTechScoreCell, useTechScores } from "../lib/use-technicals";
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

// Column ID encoding: "b:key" for builtin, "c:id" for custom, "ta:tf" for TA
function toColId(type: "builtin" | "custom" | "ta", key: string): string {
  if (type === "builtin") return `b:${key}`;
  if (type === "ta") return `ta:${key}`;
  return `c:${key}`;
}

const ROW_H = 24;
const HEADER_H = 22;
const TA_COL_W = 44;
const ROW_GRIP_W = 12;
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
  const overlayRoot = typeof document !== "undefined" ? document.body : null;
  const {
    symbols,
    setSymbols,
    insertSymbolAt: insertGlobalSymbolAt,
  } = useWatchlist();
  const savedColWidths = config.columnWidths as number[] | undefined;
  const savedTaColWidths = config.taColumnWidths as Record<string, number> | undefined;
  const taTimeframes: string[] = (config.taTimeframes as string[]) ?? [];
  const savedHeaderTints = (config.headerTints as HeaderTintConfig | undefined) ?? {};
  const savedColumnLabels = (config.columnLabels as Record<string, string> | undefined) ?? {};
  const [columnLabels, setColumnLabels] = useState<Record<string, string>>(savedColumnLabels);
  const [editingHeaderKey, setEditingHeaderKey] = useState<string | null>(null);
  const [editingHeaderValue, setEditingHeaderValue] = useState("");
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
    if (didColDragRef.current) {
      didColDragRef.current = false;
      return;
    }
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

  // ── Column order (drag-to-reorder) ──
  const allColIds = useMemo(() => [
    ...COLUMNS.map(c => toColId("builtin", c.key)),
    ...customColumns.map(c => toColId("custom", c.id)),
    ...taTimeframes.map(tf => toColId("ta", tf)),
  ], [customColumns, taTimeframes]);

  const effectiveColOrder = useMemo(() => {
    const savedOrder = config.colOrder as string[] | undefined;
    const validSet = new Set(allColIds);
    if (!savedOrder || savedOrder.length === 0) return allColIds;
    const storedValid = savedOrder.filter(id => validSet.has(id));
    const storedSet = new Set(storedValid);
    const newCols = allColIds.filter(id => !storedSet.has(id));
    return [...storedValid, ...newCols];
  }, [allColIds, config]);

  const [colDragState, setColDragState] = useState<{ colId: string; mouseX: number; mouseY: number } | null>(null);
  const [colInsertBeforeId, setColInsertBeforeId] = useState<string | null>(null);
  const colDragColIdRef = useRef<string | null>(null);
  const colInsertBeforeIdRef = useRef<string | null>(null);
  const effectiveColOrderRef = useRef<string[]>([]);
  effectiveColOrderRef.current = effectiveColOrder;
  const paneHeaderRefs = useRef<Array<HTMLDivElement | null>>([]);
  const didColDragRef = useRef(false);

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

  // ── Column header drag-to-reorder ──
  const startColDrag = useCallback((colId: string, e: React.MouseEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    let didDrag = false;
    // Capture layout at drag-start time (won't change mid-drag)
    const capColWidths = colWidths;
    const capCustomCols = customColumns;
    const capTaColWidths = taColWidths;
    const capSortCol = sortCol;

    colDragColIdRef.current = colId;
    colInsertBeforeIdRef.current = null;

    const getInsertId = (clientX: number): string | null => {
      const header =
        paneHeaderRefs.current.find(h => {
          if (!h) return false;
          const r = h.getBoundingClientRect();
          return clientX >= r.left && clientX <= r.right;
        }) ?? paneHeaderRefs.current.find(h => !!h) ?? null;
      if (!header) return null;
      const rect = header.getBoundingClientRect();
      let cum = capSortCol ? 0 : ROW_GRIP_W;
      for (const id of effectiveColOrderRef.current) {
        let w = 0;
        if (id.startsWith("b:")) {
          const ci = COLUMNS.findIndex(c => c.key === id.slice(2));
          w = ci >= 0 ? (capColWidths[ci] ?? 60) : 60;
        } else if (id.startsWith("c:")) {
          w = capCustomCols.find(c => c.id === id.slice(2))?.width ?? 60;
        } else if (id.startsWith("ta:")) {
          w = capTaColWidths[id.slice(3)] ?? TA_COL_W;
        }
        if (clientX - rect.left < cum + w / 2) return id;
        cum += w;
      }
      return null;
    };

    const onMove = (ev: MouseEvent) => {
      if (!didDrag) {
        if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
          didDrag = true;
          setColDragState({ colId, mouseX: ev.clientX, mouseY: ev.clientY });
        }
        return;
      }
      setColDragState(prev => prev ? { ...prev, mouseX: ev.clientX, mouseY: ev.clientY } : null);
      const insertId = getInsertId(ev.clientX);
      colInsertBeforeIdRef.current = insertId;
      setColInsertBeforeId(insertId);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const srcId = colDragColIdRef.current;
      colDragColIdRef.current = null;
      setColDragState(null);
      setColInsertBeforeId(null);
      if (!didDrag || !srcId) return;
      didColDragRef.current = true;
      const dstId = colInsertBeforeIdRef.current;
      colInsertBeforeIdRef.current = null;
      const order = effectiveColOrderRef.current;
      const srcIdx = order.indexOf(srcId);
      if (srcIdx === -1) return;
      const next = [...order];
      next.splice(srcIdx, 1);
      if (dstId === null || dstId === srcId) {
        if (dstId === srcId) return;
        next.push(srcId);
      } else {
        const dstIdx = order.indexOf(dstId);
        next.splice(dstIdx > srcIdx ? dstIdx - 1 : dstIdx, 0, srcId);
      }
      if (next.join(",") === order.join(",")) return;
      persistConfig({ colOrder: next });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [colWidths, customColumns, taColWidths, sortCol, persistConfig]);

  // ── Fixed partition count setting ──
  const fixedPaneCount = config.paneCount as number | undefined;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node))
        setSettingsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [settingsOpen]);

  const updateFixedPaneCount = useCallback(
    (n: number | undefined) => {
      const next = { ...config };
      if (n == null) delete next.paneCount;
      else next.paneCount = n;
      onConfigChange(next);
    },
    [config, onConfigChange],
  );

  // ── How many panes fit side-by-side? ──
  const paneWidth = useMemo(() => {
    let total = 0;
    for (const id of effectiveColOrder) {
      if (id.startsWith("b:")) {
        const ci = COLUMNS.findIndex(c => c.key === id.slice(2));
        total += ci >= 0 ? (colWidths[ci] ?? 60) : 60;
      } else if (id.startsWith("c:")) {
        total += customColumns.find(c => c.id === id.slice(2))?.width ?? 60;
      } else if (id.startsWith("ta:")) {
        total += taColWidths[id.slice(3)] ?? TA_COL_W;
      }
    }
    return total + (sortCol ? 0 : ROW_GRIP_W) + PANE_CHROME_W + PANE_GAP;
  }, [effectiveColOrder, colWidths, customColumns, taColWidths, sortCol]);

  const paneGridTemplate = useMemo(() => {
    const tracks: string[] = [];
    if (!sortCol) tracks.push(`${ROW_GRIP_W}px`);
    for (const id of effectiveColOrder) {
      if (id.startsWith("b:")) {
        const ci = COLUMNS.findIndex(c => c.key === id.slice(2));
        tracks.push(`${ci >= 0 ? (colWidths[ci] ?? 60) : 60}px`);
      } else if (id.startsWith("c:")) {
        tracks.push(`${customColumns.find(c => c.id === id.slice(2))?.width ?? 60}px`);
      } else if (id.startsWith("ta:")) {
        tracks.push(`${taColWidths[id.slice(3)] ?? TA_COL_W}px`);
      }
    }
    return tracks.join(" ");
  }, [effectiveColOrder, colWidths, customColumns, taColWidths, sortCol]);
  const autoPaneCount = Math.max(1, Math.floor(containerWidth / paneWidth));
  const paneCount = fixedPaneCount ?? autoPaneCount;

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

  // ── Arrow-key navigation: move selection up/down through non-empty symbols ──
  const onSymbolSelectRef = useRef(onSymbolSelect);
  onSymbolSelectRef.current = onSymbolSelect;
  const linkChannelRef = useRef(linkChannel);
  linkChannelRef.current = linkChannel;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target?.isContentEditable
      ) return;

      const displaySyms = sortCol ? sortedSymbols : symbols.filter((s) => s.trim() !== "");
      if (displaySyms.length === 0) return;

      e.preventDefault();

      // anchorGlobal is a paddedSymbols index; displaySyms occupies indices 0..N-1
      const anchorGlobal = selectionAnchorIdx;
      const currentDisplayIdx = anchorGlobal !== null && anchorGlobal < displaySyms.length ? anchorGlobal : -1;

      let nextDisplayIdx: number;
      if (currentDisplayIdx < 0) {
        nextDisplayIdx = e.key === "ArrowDown" ? 0 : displaySyms.length - 1;
      } else {
        nextDisplayIdx = e.key === "ArrowDown"
          ? Math.min(currentDisplayIdx + 1, displaySyms.length - 1)
          : Math.max(currentDisplayIdx - 1, 0);
      }

      const nextSymbol = displaySyms[nextDisplayIdx];
      if (!nextSymbol) return;

      setSelectedRows(new Set([nextDisplayIdx]));
      setSelectionAnchorIdx(nextDisplayIdx);
      onSymbolSelectRef.current?.(nextSymbol);
      if (linkChannelRef.current) linkBus.publish(linkChannelRef.current, nextSymbol);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectionAnchorIdx, sortCol, sortedSymbols, symbols]);

  // ── How many visible rows per pane? ──
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState(300);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setBodyHeight(entry.contentRect.height);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

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
          {/* Settings cog */}
          <div ref={settingsRef} className="relative">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm transition-colors duration-75 ${
                settingsOpen
                  ? "bg-white/[0.06] text-white"
                  : "text-white/70 hover:bg-white/[0.06] hover:text-white"
              }`}
              title="Settings"
            >
              <Settings className="h-2.5 w-2.5" strokeWidth={1.5} />
            </button>
            {settingsOpen && (
              <div className="absolute right-0 top-full z-[100] mt-1 w-[170px] rounded-md border border-white/[0.08] bg-[#1C2128] p-2.5 shadow-xl shadow-black/40">
                <div className="mb-2 text-[9px] uppercase tracking-wider text-white/25">
                  Amt of Partitions
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => updateFixedPaneCount(undefined)}
                    className={`h-5 rounded-sm px-2 text-[10px] transition-colors duration-75 ${
                      fixedPaneCount === undefined
                        ? "bg-blue/20 text-blue"
                        : "text-white/40 hover:bg-white/[0.06] hover:text-white/60"
                    }`}
                  >
                    Auto
                  </button>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      onClick={() => updateFixedPaneCount(n)}
                      className={`h-5 w-5 rounded-sm text-[10px] transition-colors duration-75 ${
                        fixedPaneCount === n
                          ? "bg-blue/20 text-blue"
                          : "text-white/40 hover:bg-white/[0.06] hover:text-white/60"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <ComponentLinkMenu
            linkChannel={linkChannel}
            onSetLinkChannel={onSetLinkChannel}
          />
          <button
            onClick={onClose}
            className="rounded-sm p-0.5 text-white/70 transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
          >
            <X className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Body — data-no-drag prevents GridLayout from starting a component move on row mousedown */}
      <div
        ref={containerRef}
        className={`flex flex-1 scrollbar-watchlist ${fixedPaneCount != null ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden"}`}
        data-no-drag
      >
        <div ref={bodyRef} className={`flex h-full gap-[6px] ${fixedPaneCount != null ? "" : "w-full"}`}>
          {panes.map((pane, paneIdx) => (
            <div
              key={paneIdx}
              className="flex min-h-0 flex-col overflow-hidden border border-white/[0.06]"
              style={
                fixedPaneCount != null
                  ? { width: paneWidth - PANE_GAP, flexShrink: 0 }
                  : { flex: 1, minWidth: 0 }
              }
            >
              {/* Column headers — click to sort, drag to reorder */}
              <div
                ref={(el) => { paneHeaderRefs.current[paneIdx] = el; }}
                className="grid shrink-0 items-center border-b border-white/[0.06] bg-[#0D1117]"
                style={{ height: HEADER_H, gridTemplateColumns: paneGridTemplate }}
              >
                {!sortCol && <div />}
                {effectiveColOrder.map((colId, ci) => {
                  const isLast = ci === effectiveColOrder.length - 1;
                  const borderClass = !isLast ? "border-r border-white/[0.06]" : "";
                  const isDragging = colDragState?.colId === colId;

                  if (colId.startsWith("b:")) {
                    const key = colId.slice(2);
                    const col = COLUMNS.find(c => c.key === key)!;
                    const colIdx = COLUMNS.findIndex(c => c.key === key);
                    return (
                      <div
                        key={colId}
                        className={`relative min-w-0 select-none truncate px-1.5 text-[10px] font-medium uppercase tracking-wider cursor-grab transition-colors duration-75 ${
                          sortCol === col.key ? "text-white" : "text-white hover:text-white"
                        } ${borderClass} ${isDragging ? "opacity-40" : ""}`}
                        style={{ textAlign: col.align }}
                        onClick={() => handleSort(col.key)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingHeaderKey(col.key);
                          setEditingHeaderValue(columnLabels[col.key] ?? col.label);
                        }}
                        onMouseDown={(e) => {
                          if (editingHeaderKey === col.key) return;
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          if (e.clientX > rect.right - 8) return;
                          startColDrag(colId, e);
                        }}
                      >
                        {colInsertBeforeId === colId && colDragState && (
                          <div className="pointer-events-none absolute left-0 top-0 z-20 h-full w-0.5 bg-blue" />
                        )}
                        {isLast && colInsertBeforeId === null && colDragState && (
                          <div className="pointer-events-none absolute right-0 top-0 z-20 h-full w-0.5 bg-blue" />
                        )}
                        {editingHeaderKey === col.key ? (
                          <input
                            autoFocus
                            className="w-full bg-transparent text-[10px] font-medium uppercase tracking-wider text-white/70 outline-none"
                            value={editingHeaderValue}
                            onChange={(e) => setEditingHeaderValue(e.target.value)}
                            onBlur={() => {
                              const trimmed = editingHeaderValue.trim();
                              const next = { ...columnLabels };
                              if (trimmed && trimmed !== col.label) {
                                next[col.key] = trimmed;
                              } else {
                                delete next[col.key];
                              }
                              setColumnLabels(next);
                              persistConfig({ columnLabels: next });
                              setEditingHeaderKey(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setEditingHeaderKey(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          columnLabels[col.key] ?? col.label
                        )}
                        {editingHeaderKey !== col.key && sortCol === col.key && (
                          <span className="ml-0.5 text-[9px] text-white/50">
                            {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                          </span>
                        )}
                        <div
                          className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue/[0.15]"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleColResize(colIdx, e); }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        />
                      </div>
                    );
                  }

                  if (colId.startsWith("c:")) {
                    const col = customColumns.find(c => c.id === colId.slice(2));
                    if (!col) return null;
                    return (
                      <div
                        key={colId}
                        className={`relative min-w-0 select-none truncate px-1.5 text-[10px] font-medium uppercase tracking-wider text-white cursor-grab transition-colors duration-75 hover:text-white ${borderClass} ${isDragging ? "opacity-40" : ""}`}
                        style={{
                          textAlign: "right",
                          color: headerTints.custom?.[col.id],
                          backgroundColor: headerTints.custom?.[col.id] ? `${headerTints.custom[col.id]}14` : undefined,
                        }}
                        onDoubleClick={() => { setColumnEditor({ ...col }); setColumnEditorIsNew(false); }}
                        onContextMenu={(e) => { e.preventDefault(); setColHeaderMenu({ x: e.clientX, y: e.clientY, type: "custom", colId: col.id }); }}
                        onMouseDown={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          if (e.clientX > rect.right - 8) return;
                          startColDrag(colId, e);
                        }}
                        title="Double-click to edit · Right-click for options · Drag to reorder"
                      >
                        {colInsertBeforeId === colId && colDragState && (
                          <div className="pointer-events-none absolute left-0 top-0 z-20 h-full w-0.5 bg-blue" />
                        )}
                        {isLast && colInsertBeforeId === null && colDragState && (
                          <div className="pointer-events-none absolute right-0 top-0 z-20 h-full w-0.5 bg-blue" />
                        )}
                        {col.label}
                        <div
                          className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-purple/[0.15]"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleCustomColResize(col.id, col.width, e); }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        />
                      </div>
                    );
                  }

                  if (colId.startsWith("ta:")) {
                    const tf = colId.slice(3);
                    return (
                      <div
                        key={colId}
                        className={`relative min-w-0 select-none truncate px-1 text-center text-[10px] font-medium uppercase tracking-wider text-white cursor-grab ${borderClass} ${isDragging ? "opacity-40" : ""}`}
                        style={{
                          color: headerTints.ta?.[tf],
                          backgroundColor: headerTints.ta?.[tf] ? `${headerTints.ta[tf]}14` : undefined,
                        }}
                        onContextMenu={(e) => { e.preventDefault(); setColHeaderMenu({ x: e.clientX, y: e.clientY, type: "ta", tf }); }}
                        onMouseDown={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          if (e.clientX > rect.right - 8) return;
                          startColDrag(colId, e);
                        }}
                        title={`Technical score ${tf} · Right-click to remove · Drag to reorder`}
                      >
                        {colInsertBeforeId === colId && colDragState && (
                          <div className="pointer-events-none absolute left-0 top-0 z-20 h-full w-0.5 bg-blue" />
                        )}
                        {isLast && colInsertBeforeId === null && colDragState && (
                          <div className="pointer-events-none absolute right-0 top-0 z-20 h-full w-0.5 bg-blue" />
                        )}
                        {tf}
                        <div
                          className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue/[0.15]"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleTaColResize(tf, e); }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        />
                      </div>
                    );
                  }

                  return null;
                })}
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
                colOrder={effectiveColOrder}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Context Menu */}
      {overlayRoot && contextMenu && createPortal(
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
        </div>,
        overlayRoot,
      )}

      {/* Column drag ghost */}
      {overlayRoot && colDragState && createPortal(
        <div
          className="pointer-events-none fixed z-[300] flex items-center gap-1 rounded border border-blue/50 bg-base/90 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60 shadow-lg backdrop-blur-sm"
          style={{ left: colDragState.mouseX + 10, top: colDragState.mouseY - 14 }}
        >
          {effectiveColOrder.find(id => id === colDragState.colId)?.startsWith("b:")
            ? (columnLabels[colDragState.colId.slice(2)] ?? COLUMNS.find(c => c.key === colDragState.colId.slice(2))?.label ?? colDragState.colId.slice(2))
            : effectiveColOrder.find(id => id === colDragState.colId)?.startsWith("c:")
              ? customColumns.find(c => c.id === colDragState.colId.slice(2))?.label ?? colDragState.colId.slice(2)
            : colDragState.colId.slice(3)
          }
        </div>,
        overlayRoot,
      )}

      {/* Row drag ghost — floats at cursor */}
      {overlayRoot && dragState && createPortal(
        <div
          className="pointer-events-none fixed z-[300] flex items-center gap-1.5 rounded border border-blue/40 bg-base/90 px-2 py-0.5 font-mono text-[10px] text-white/70 shadow-lg backdrop-blur-sm"
          style={{ left: dragState.mouseX + 12, top: dragState.mouseY - 10 }}
        >
          <GripVertical className="h-2.5 w-2.5 text-white/30" strokeWidth={1.5} />
          {dragState.symbol}
        </div>,
        overlayRoot,
      )}

      {/* Column Header Context Menu */}
      {overlayRoot && colHeaderMenu && createPortal(
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
        </div>,
        overlayRoot,
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
  taScores: Record<string, { score: number | null; status: string | null; barCount: number | null; requiredBars: number | null }>;
  gridTemplateColumns: string;
  showGrip: boolean;
  reserveGripSpace: boolean;
  insertLineBefore: boolean;
  onGripMouseDown: (e: React.MouseEvent) => void;
  colOrder: string[];
}

interface WatchlistPaneRowsProps {
  pane: string[];
  paneIdx: number;
  symbolsPerPane: number;
  onRowsAreaRef?: (el: HTMLDivElement | null) => void;
  watchlistData: Map<string, Quote>;
  symbolStatus: Map<string, SymbolStatus>;
  rowsAreaRef?: MutableRefObject<HTMLDivElement | null>;
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
  techScores: Map<string, Map<string, { score: number | null; status: string | null; barCount: number | null; requiredBars: number | null }>>;
  gridTemplateColumns: string;
  showGrip: boolean;
  insertBeforeIdx: number | null;
  startRowDrag: (e: React.MouseEvent, globalIdx: number, symbol: string) => void;
  colOrder: string[];
}

function WatchlistPaneRows({
  pane,
  paneIdx,
  symbolsPerPane,
  onRowsAreaRef,
  watchlistData,
  symbolStatus,
  rowsAreaRef,
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
  colOrder,
}: WatchlistPaneRowsProps) {
  const localRowsRef = useRef<HTMLDivElement | null>(null);

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
        className="scrollbar-none relative h-full overflow-y-auto"
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
                sym
                  ? (Object.fromEntries(
                      techScores.get(sym) ?? new Map(),
                    ) as Record<string, { score: number | null; status: string | null; barCount: number | null; requiredBars: number | null }>)
                  : {}
              }
              gridTemplateColumns={gridTemplateColumns}
              showGrip={showGrip && !!sym}
              reserveGripSpace={showGrip}
              insertLineBefore={insertBeforeIdx === globalIdx}
              onGripMouseDown={(e) => startRowDrag(e, globalIdx, sym)}
              colOrder={colOrder}
            />
          );
        })}
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
  taScores,
  gridTemplateColumns,
  showGrip,
  reserveGripSpace,
  insertLineBefore,
  onGripMouseDown,
  colOrder,
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

  const suggestions = editValue
    ? filterRankSymbolSearch(SEARCHABLE_SYMBOLS, editValue, {
        limit: 8,
        includeSectorIndustry: true,
      })
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
              className="w-full bg-transparent font-mono text-[12px] text-white/70 placeholder:text-white/15 focus:outline-none"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div
                className="absolute left-0 top-full z-[130] mt-1 w-[260px] rounded-md border border-white/[0.08] bg-[#1C2128] py-0.5 shadow-xl shadow-black/40"
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
                    <span className={`w-12 shrink-0 font-mono text-[11px] font-medium ${
                      i === highlightIdx ? "text-white/90" : "text-white/70"
                    }`}>
                      {s.symbol}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate text-[10px] ${
                        i === highlightIdx ? "text-white/50" : "text-white/30"
                      }`}>
                        {s.name}
                      </span>
                      {s.sector && (
                        <span className={`truncate text-[9px] ${
                          i === highlightIdx ? "text-white/30" : "text-white/15"
                        }`}>
                          {s.sector}{s.industry ? ` · ${s.industry}` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
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
            <span className="text-[12px] text-white/10">+</span>
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
            className="w-full bg-transparent font-mono text-[12px] text-white/70 placeholder:text-white/25 focus:outline-none"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div
              className="absolute left-0 top-full z-[130] mt-1 w-[260px] rounded-md border border-white/[0.08] bg-[#1C2128] py-0.5 shadow-xl shadow-black/40"
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
                    <span className={`w-12 shrink-0 font-mono text-[11px] font-medium ${
                      i === highlightIdx ? "text-white/90" : "text-white/70"
                    }`}>
                      {s.symbol}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate text-[10px] ${
                        i === highlightIdx ? "text-white/50" : "text-white/30"
                      }`}>
                        {s.name}
                      </span>
                      {s.sector && (
                        <span className={`truncate text-[9px] ${
                          i === highlightIdx ? "text-white/30" : "text-white/15"
                        }`}>
                          {s.sector}{s.industry ? ` · ${s.industry}` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
            </div>
          )}
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
          {showGrip && <GripVertical className="h-2.5 w-2.5 text-white/25" strokeWidth={1.5} />}
        </div>
      )}
      {colOrder.map((colId, ci) => {
        const isLastCell = ci === colOrder.length - 1;
        const borderClass = !isLastCell ? "border-r border-white/[0.06]" : "";

        if (colId === "b:symbol") {
          return (
            <div
              key={colId}
              ref={symbolCellRef}
              className={`min-w-0 truncate px-1.5 font-mono text-[12px] font-medium ${borderClass} ${isError ? "text-red/80" : "text-white/80"}`}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
            >
              {symbol}
            </div>
          );
        }
        if (colId === "b:last") {
          return (
            <div key={colId} className={`min-w-0 truncate px-1.5 text-right font-mono text-[11px] ${borderClass} ${isError ? "text-red/40" : "text-white/70"}`}>
              {quote ? quote.last.toFixed(2) : isError ? "ERR" : "—"}
            </div>
          );
        }
        if (colId === "b:change") {
          return (
            <div key={colId} className={`min-w-0 truncate px-1.5 text-right font-mono text-[11px] font-medium ${borderClass} ${isError ? "text-red/40" : quote ? changeColor(quote.change) : "text-white/30"}`}>
              {quote ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)}` : isError ? "—" : "—"}
            </div>
          );
        }
        if (colId === "b:changePct") {
          return (
            <div key={colId} className={`min-w-0 truncate px-1.5 text-right font-mono text-[11px] font-medium ${borderClass} ${isError ? "text-red/40" : quote ? changeColor(quote.changePct) : "text-white/30"}`}>
              {quote ? `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%` : "—"}
            </div>
          );
        }
        if (colId.startsWith("c:")) {
          const col = customColumns.find(c => c.id === colId.slice(2));
          if (!col) return null;
          const val = customValues[col.id];
          const isNum = typeof val === "number";
          const isStr = typeof val === "string";
          const isCrossover = col.kind === "crossover";
          const shouldColorize = "colorize" in col && col.colorize;
          let colorClass = "text-white/50";
          let displayValue = val != null ? (isNum ? (val as number).toFixed(col.decimals ?? 0) : String(val)) : "—";
          if (isCrossover && isStr) {
            colorClass = val === "BUY" ? "bg-green/[0.16] text-green font-medium" : val === "SELL" ? "bg-red/[0.16] text-red font-medium" : "bg-yellow/20 text-yellow font-medium";
            displayValue = val === "BUY" ? "\u2197" : val === "SELL" ? "\u2198" : "-";
          } else if (isNum && shouldColorize) {
            colorClass = (val as number) > 50 ? "text-green font-medium" : (val as number) < 50 ? "text-red font-medium" : "text-white/50";
          }
          return (
            <div key={colId} className={`min-w-0 truncate px-1.5 font-mono text-[11px] ${isCrossover ? "text-center" : "text-right"} ${colorClass} ${borderClass}`}>
              {displayValue}
            </div>
          );
        }
        if (colId.startsWith("ta:")) {
          const tf = colId.slice(3);
          const cell = taScores[tf] ?? null;
          const score = cell?.score ?? null;
          return (
            <div
              key={colId}
              className={`min-w-0 truncate px-1 text-center font-mono text-[11px] font-medium ${borderClass} ${score === null ? "text-white/15" : score > 60 ? "text-green" : score < 40 ? "text-red" : "text-white/40"}`}
              title={describeTechScoreCell(tf, cell)}
            >
              {score === null ? "—" : score}
            </div>
          );
        }
        return null;
      })}

      {/* Hover tooltip — portal to document.body to escape parent transform/overflow */}
      {hovered && symbolCellRef.current && (() => {
        const rect = symbolCellRef.current!.getBoundingClientRect();
        return createPortal(
          <div
            className="pointer-events-none fixed z-[140] rounded-md border border-white/[0.08] bg-[#1C2128] px-2.5 py-1.5 shadow-xl shadow-black/40"
            style={{
              left: rect.left,
              top: Math.max(4, rect.top - 4),
              transform: "translateY(-100%)",
            }}
          >
            <p className={`font-mono text-[12px] font-semibold ${isError ? "text-red" : "text-white/90"}`}>
              {symbol}
            </p>
            <p className="text-[10px] text-white/40">{name}</p>
            {isError && (
              <p className="mt-0.5 text-[9px] text-red/60">
                Symbol not recognized — remove or replace
              </p>
            )}
            {!quote && !isError && (
              <p className="mt-0.5 text-[9px] text-white/20">
                Waiting for TWS data
              </p>
            )}
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import { getChannelById } from "../lib/link-channels";
import { linkBus } from "../lib/link-bus";
import { getSymbolName, ALL_SYMBOLS, getEtfInfo } from "../lib/market-data";
import type { Quote, EtfHolding } from "../lib/market-data";
import { useWatchlistData } from "../lib/use-market-data";

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

// ─── Custom scripted columns ────────────────────────────────────────
export interface CustomColumnDef {
  id: string;
  label: string;
  width: number;
  decimals: number;
  colorize: boolean; // color green > 50, red < 50
  /** JavaScript expression. Available vars: last, bid, ask, open, high, low, prevClose, change, changePct, volume, spread, symbol */
  expression: string;
}

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
  const symbols: string[] = (config.symbols as string[]) ?? [];
  const savedColWidths = config.columnWidths as number[] | undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Live market data
  const watchlistData = useWatchlistData(symbols);

  // ── Sorting ──
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = useCallback((key: string) => {
    if (sortCol === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(key);
      setSortDir(key === "symbol" ? "asc" : "desc"); // numbers default desc
    }
  }, [sortCol]);

  const sortedSymbols = useMemo(() => {
    if (!sortCol) return symbols;
    const sorted = [...symbols].sort((a, b) => {
      if (sortCol === "symbol") return a.localeCompare(b);
      const qa = watchlistData.get(a);
      const qb = watchlistData.get(b);
      const va = qa ? (sortCol === "last" ? qa.last : sortCol === "change" ? qa.change : qa.changePct) : 0;
      const vb = qb ? (sortCol === "last" ? qb.last : sortCol === "change" ? qb.change : qb.changePct) : 0;
      return va - vb;
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [symbols, sortCol, sortDir, watchlistData]);

  // ── Context menu state ──
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    globalIdx: number;
    isEmpty: boolean;
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
  const savedCustomCols = (config.customColumns as CustomColumnDef[] | undefined) ?? [];
  const [customColumns, setCustomColumns] = useState<CustomColumnDef[]>(savedCustomCols);
  const [columnEditor, setColumnEditor] = useState<CustomColumnDef | null>(null);
  const [columnEditorIsNew, setColumnEditorIsNew] = useState(false);

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

  const persistCustomColumns = useCallback(
    (cols: CustomColumnDef[]) => {
      setCustomColumns(cols);
      onConfigChange({ ...config, symbols, columnWidths: colWidths, customColumns: cols });
    },
    [config, symbols, colWidths, onConfigChange],
  );

  // Compute custom column values for all symbols
  const customColValues = useMemo(() => {
    const result: Record<string, Record<string, number | string | null>> = {};
    for (const sym of symbols) {
      const quote = watchlistData.get(sym) ?? null;
      const vals: Record<string, number | string | null> = {};
      for (const col of customColumns) {
        vals[col.id] = evalCustomColumn(col.expression, quote, sym);
      }
      result[sym] = vals;
    }
    return result;
  }, [symbols, watchlistData, customColumns]);

  // Persist column widths on change
  const persistColWidths = useCallback(
    (widths: number[]) => {
      onConfigChange({ ...config, symbols, columnWidths: widths });
    },
    [config, symbols, onConfigChange],
  );

  // ── Column resize drag ──
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

  // ── How many panes fit side-by-side? ──
  const paneWidth = colWidths.reduce((a, b) => a + b, 0) + 8; // 8px padding
  const paneCount = Math.max(1, Math.floor(containerWidth / paneWidth));

  // ── Symbol mutations ──
  const updateSymbols = useCallback(
    (next: string[]) => {
      onConfigChange({ ...config, columnWidths: colWidths, symbols: next });
    },
    [config, colWidths, onConfigChange],
  );

  const removeSymbol = useCallback(
    (idx: number) => {
      updateSymbols(symbols.filter((_, i) => i !== idx));
    },
    [symbols, updateSymbols],
  );

  const replaceSymbol = useCallback(
    (idx: number, newSym: string) => {
      const next = [...symbols];
      next[idx] = newSym;
      updateSymbols(next);
    },
    [symbols, updateSymbols],
  );

  const addSymbol = useCallback(
    (sym: string) => {
      if (!sym || symbols.includes(sym)) return;
      updateSymbols([...symbols, sym]);

      // Check if it's an ETF — prompt to add top holdings
      const etf = getEtfInfo(sym);
      if (etf && etf.top_holdings.length > 0) {
        // Filter out holdings already in the watchlist
        const currentSet = new Set([...symbols, sym]);
        const available = etf.top_holdings.filter((h) => !currentSet.has(h.symbol));
        if (available.length > 0) {
          setEtfPrompt({
            etfSymbol: etf.symbol,
            etfName: etf.name,
            holdings: available,
            selected: new Set(available.map((h) => h.symbol)),
          });
        }
      }
    },
    [symbols, updateSymbols],
  );

  const insertSymbolAt = useCallback(
    (idx: number, sym: string) => {
      const next = [...symbols];
      next.splice(idx, 0, sym);
      updateSymbols(next);
    },
    [symbols, updateSymbols],
  );

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

  const channelInfo = getChannelById(linkChannel);

  // ── Context menu actions ──
  const handleContextMenuAction = (action: "delete" | "insertAbove" | "insertBelow" | "insert") => {
    if (!contextMenu) return;
    const idx = contextMenu.globalIdx;
    switch (action) {
      case "delete":
        if (idx < symbols.length) removeSymbol(idx);
        break;
      case "insertAbove": {
        const insertIdx = Math.min(idx, symbols.length);
        insertSymbolAt(insertIdx, "");
        setEditingIdx(insertIdx);
        break;
      }
      case "insertBelow": {
        const insertIdx = Math.min(idx + 1, symbols.length + 1);
        insertSymbolAt(insertIdx, "");
        setEditingIdx(insertIdx);
        break;
      }
      case "insert": {
        const insertIdx = Math.min(idx, symbols.length);
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
            {symbols.length} symbol{symbols.length !== 1 ? "s" : ""}
          </span>
          {channelInfo && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: channelInfo.color }}
            />
          )}
        </div>
        <div className="flex items-center gap-0.5">
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

      {/* Body */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        <div ref={bodyRef} className="flex h-full w-full">
          {panes.map((pane, paneIdx) => (
            <div
              key={paneIdx}
              className={`flex flex-1 flex-col overflow-hidden ${
                paneIdx > 0 ? "border-l border-white/[0.06]" : ""
              }`}
              style={{ minWidth: 0 }}
            >
              {/* Column headers — click to sort */}
              <div
                className="flex shrink-0 items-center border-b border-white/[0.06] bg-[#0D1117]"
                style={{ height: HEADER_H }}
              >
                {COLUMNS.map((col, ci) => (
                  <div
                    key={col.key}
                    className={`relative select-none truncate px-1.5 text-[9px] font-medium uppercase tracking-wider cursor-pointer transition-colors duration-75 ${
                      sortCol === col.key ? "text-white/70" : "text-white/40 hover:text-white/55"
                    } ${ci < COLUMNS.length - 1 || customColumns.length > 0 ? "border-r border-white/[0.06]" : ""}`}
                    style={{
                      width: colWidths[ci],
                      minWidth: col.minWidth,
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
                        e.stopPropagation();
                        handleColResize(ci, e);
                      }}
                    />
                  </div>
                ))}
                {/* Custom column headers */}
                {customColumns.map((col, ci) => (
                  <div
                    key={col.id}
                    className={`relative select-none truncate px-1.5 text-[9px] font-medium uppercase tracking-wider text-purple/70 cursor-pointer transition-colors duration-75 hover:text-purple ${
                      ci < customColumns.length - 1 ? "border-r border-white/[0.06]" : ""
                    }`}
                    style={{ width: col.width, minWidth: 40, textAlign: "right" }}
                    onDoubleClick={() => {
                      setColumnEditor({ ...col });
                      setColumnEditorIsNew(false);
                    }}
                    title="Double-click to edit column"
                  >
                    {col.label}
                  </div>
                ))}
                {/* Add custom column button */}
                {paneIdx === 0 && (
                  <button
                    onClick={() => {
                      setColumnEditor({
                        id: `col_${Date.now()}`,
                        label: "Score",
                        width: 54,
                        decimals: 0,
                        colorize: true,
                        expression: "changePct > 0 ? 75 : 25",
                      });
                      setColumnEditorIsNew(true);
                    }}
                    className="shrink-0 px-1 text-[9px] text-white/15 hover:text-white/40"
                    title="Add custom column"
                  >
                    +
                  </button>
                )}
              </div>

              {/* Rows */}
              <div className="flex-1 overflow-y-auto">
                {pane.map((sym, rowIdx) => {
                  const globalIdx = paneIdx * symbolsPerPane + rowIdx;
                  return (
                    <WatchlistRow
                      key={`${paneIdx}-${rowIdx}`}
                      symbol={sym}
                      quote={sym ? watchlistData.get(sym) ?? null : null}
                      colWidths={colWidths}
                      globalIdx={globalIdx}
                      rowIdx={rowIdx}
                      onAdd={addSymbol}
                      onReplace={(newSym) => replaceSymbol(globalIdx, newSym)}
                      onRemove={() => removeSymbol(globalIdx)}
                      onSymbolSelect={onSymbolSelect}
                      linkChannel={linkChannel}
                      forceEdit={editingIdx === globalIdx}
                      onForceEditConsumed={() => setEditingIdx(null)}
                      onContextMenu={(x, y) =>
                        setContextMenu({
                          x,
                          y,
                          globalIdx,
                          isEmpty: !sym,
                        })
                      }
                      customColumns={customColumns}
                      customValues={sym ? (customColValues[sym] ?? {}) : {}}
                    />
                  );
                })}
              </div>
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
            <button className={ctxItemClass} onClick={() => handleContextMenuAction("insert")}>
              Insert Row
            </button>
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

      {/* Custom Column Editor */}
      {columnEditor && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
          <div className="w-[380px] rounded-lg border border-white/[0.10] bg-[#161B22] shadow-2xl shadow-black/60">
            <div className="border-b border-white/[0.08] px-4 pt-4 pb-3">
              <p className="text-[12px] font-semibold text-white/90">
                {columnEditorIsNew ? "Add Custom Column" : "Edit Column"}
              </p>
              <p className="mt-1 text-[10px] text-white/30">
                Write a JS expression using quote fields as variables.
              </p>
            </div>

            <div className="space-y-3 px-4 py-3">
              {/* Label */}
              <div>
                <label className="mb-1 block text-[9px] font-medium uppercase tracking-wider text-white/40">Label</label>
                <input
                  value={columnEditor.label}
                  onChange={(e) => setColumnEditor({ ...columnEditor, label: e.target.value })}
                  className="w-full rounded border border-white/[0.08] bg-[#0D1117] px-2 py-1.5 font-mono text-[10px] text-white/80 focus:border-blue/50 focus:outline-none"
                />
              </div>

              {/* Expression */}
              <div>
                <label className="mb-1 block text-[9px] font-medium uppercase tracking-wider text-white/40">Expression</label>
                <textarea
                  value={columnEditor.expression}
                  onChange={(e) => setColumnEditor({ ...columnEditor, expression: e.target.value })}
                  rows={3}
                  className="w-full rounded border border-white/[0.08] bg-[#0D1117] px-2 py-1.5 font-mono text-[10px] text-white/80 focus:border-blue/50 focus:outline-none resize-none"
                  placeholder="e.g. changePct > 0 ? 75 : 25"
                />
                <p className="mt-1 text-[8px] text-white/20">
                  Available: last, bid, ask, mid, open, high, low, prevClose, change, changePct, volume, spread, symbol
                </p>
              </div>

              {/* Settings row */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="mb-1 block text-[9px] font-medium uppercase tracking-wider text-white/40">Decimals</label>
                  <input
                    type="number"
                    value={columnEditor.decimals}
                    onChange={(e) => setColumnEditor({ ...columnEditor, decimals: parseInt(e.target.value) || 0 })}
                    min={0}
                    max={6}
                    className="w-full rounded border border-white/[0.08] bg-[#0D1117] px-2 py-1.5 font-mono text-[10px] text-white/80 focus:border-blue/50 focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[9px] font-medium uppercase tracking-wider text-white/40">Width</label>
                  <input
                    type="number"
                    value={columnEditor.width}
                    onChange={(e) => setColumnEditor({ ...columnEditor, width: parseInt(e.target.value) || 54 })}
                    min={30}
                    max={200}
                    className="w-full rounded border border-white/[0.08] bg-[#0D1117] px-2 py-1.5 font-mono text-[10px] text-white/80 focus:border-blue/50 focus:outline-none"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 pt-4">
                  <input
                    type="checkbox"
                    checked={columnEditor.colorize}
                    onChange={(e) => setColumnEditor({ ...columnEditor, colorize: e.target.checked })}
                    className="h-3 w-3 rounded accent-blue"
                  />
                  <span className="text-[9px] text-white/40">Color</span>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between border-t border-white/[0.08] px-4 py-3">
              {!columnEditorIsNew ? (
                <button
                  onClick={() => {
                    persistCustomColumns(customColumns.filter((c) => c.id !== columnEditor.id));
                    setColumnEditor(null);
                  }}
                  className="text-[10px] text-red/60 hover:text-red"
                >
                  Delete
                </button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setColumnEditor(null)}
                  className="rounded px-3 py-1.5 text-[10px] font-medium text-white/40 hover:bg-white/[0.06] hover:text-white/60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (columnEditorIsNew) {
                      persistCustomColumns([...customColumns, columnEditor]);
                    } else {
                      persistCustomColumns(
                        customColumns.map((c) => (c.id === columnEditor.id ? columnEditor : c)),
                      );
                    }
                    setColumnEditor(null);
                  }}
                  className="rounded bg-blue/80 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-blue"
                >
                  {columnEditorIsNew ? "Add" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ETF Holdings Prompt */}
      {etfPrompt && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
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
            <div className="max-h-[240px] overflow-y-auto px-2 py-2">
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
        </div>
      )}
    </div>
  );
}

// ─── Row component ──────────────────────────────────────────────────
interface WatchlistRowProps {
  symbol: string;
  quote: Quote | null;
  colWidths: number[];
  globalIdx: number;
  rowIdx: number;
  onAdd: (sym: string) => void;
  onReplace: (newSym: string) => void;
  onRemove: () => void;
  onSymbolSelect?: (symbol: string) => void;
  linkChannel: number | null;
  forceEdit: boolean;
  onForceEditConsumed: () => void;
  onContextMenu: (x: number, y: number) => void;
  customColumns: CustomColumnDef[];
  customValues: Record<string, number | string | null>;
}

function WatchlistRow({
  symbol,
  quote,
  colWidths,
  rowIdx,
  onAdd,
  onReplace,
  onRemove,
  onSymbolSelect,
  linkChannel,
  forceEdit,
  onForceEditConsumed,
  onContextMenu,
  customColumns,
  customValues,
}: WatchlistRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [hovered, setHovered] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

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
    ? ALL_SYMBOLS.filter(
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

  const commitSymbol = (sym: string) => {
    const upper = sym.trim().toUpperCase();
    if (upper) onAdd(upper);
    setEditing(false);
    setEditValue("");
    setShowSuggestions(false);
    setHighlightIdx(-1);
  };

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
        className={`flex items-center border-b border-white/[0.03] ${zebraClass} hover:bg-white/[0.05]`}
        style={{ height: ROW_H }}
        onContextMenu={handleRowContextMenu}
      >
        {editing ? (
          <div className="relative flex-1 px-1">
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value);
                setShowSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && showSuggestions && suggestions.length > 0) {
                  e.preventDefault();
                  setHighlightIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
                } else if (e.key === "ArrowUp" && showSuggestions && suggestions.length > 0) {
                  e.preventDefault();
                  setHighlightIdx((prev) => Math.max(prev - 1, -1));
                } else if (e.key === "Enter") {
                  const sym = highlightIdx >= 0 && highlightIdx < suggestions.length
                    ? suggestions[highlightIdx].symbol
                    : suggestions.length > 0
                      ? suggestions[0].symbol
                      : editValue;
                  commitSymbol(sym);
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setEditValue("");
                  setShowSuggestions(false);
                  setHighlightIdx(-1);
                }
              }}
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
        <div className="relative flex-1 px-1">
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && showSuggestions && suggestions.length > 0) {
                e.preventDefault();
                setHighlightIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
              } else if (e.key === "ArrowUp" && showSuggestions && suggestions.length > 0) {
                e.preventDefault();
                setHighlightIdx((prev) => Math.max(prev - 1, -1));
              } else if (e.key === "Enter") {
                const sym = highlightIdx >= 0 && highlightIdx < suggestions.length
                  ? suggestions[highlightIdx].symbol
                  : suggestions.length > 0
                    ? suggestions[0].symbol
                    : editValue;
                commitReplace(sym);
              } else if (e.key === "Escape") {
                setEditing(false);
                setEditValue("");
                setShowSuggestions(false);
                setHighlightIdx(-1);
              }
            }}
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
  return (
    <div
      ref={rowRef}
      className={`group relative flex items-center border-b border-white/[0.03] transition-colors duration-75 hover:bg-white/[0.05] focus:bg-white/[0.04] focus:outline-none ${
        quote && quote.change !== 0 ? changeBg(quote.change) : zebraClass
      }`}
      style={{ height: ROW_H }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        onSymbolSelect?.(symbol);
        if (linkChannel) linkBus.publish(linkChannel, symbol);
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
      {/* Symbol */}
      <div
        className="truncate border-r border-white/[0.06] px-1.5 font-mono text-[10px] font-medium text-white/80"
        style={{ width: colWidths[0], minWidth: COLUMNS[0].minWidth }}
      >
        {symbol}
      </div>

      {/* Last */}
      <div
        className="truncate border-r border-white/[0.06] px-1.5 text-right font-mono text-[10px] text-white/70"
        style={{ width: colWidths[1], minWidth: COLUMNS[1].minWidth }}
      >
        {quote ? quote.last.toFixed(2) : "—"}
      </div>

      {/* Change */}
      <div
        className={`truncate border-r border-white/[0.06] px-1.5 text-right font-mono text-[10px] font-medium ${
          quote ? changeColor(quote.change) : "text-white/30"
        }`}
        style={{ width: colWidths[2], minWidth: COLUMNS[2].minWidth }}
      >
        {quote
          ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)}`
          : "—"}
      </div>

      {/* Change % */}
      <div
        className={`truncate ${customColumns.length > 0 ? "border-r border-white/[0.06]" : ""} px-1.5 text-right font-mono text-[10px] font-medium ${
          quote ? changeColor(quote.changePct) : "text-white/30"
        }`}
        style={{ width: colWidths[3], minWidth: COLUMNS[3].minWidth }}
      >
        {quote
          ? `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`
          : "—"}
      </div>

      {/* Custom scripted columns */}
      {customColumns.map((col, ci) => {
        const val = customValues[col.id];
        const isNum = typeof val === "number";
        return (
          <div
            key={col.id}
            className={`truncate px-1.5 text-right font-mono text-[10px] ${
              isNum && col.colorize
                ? val > 50 ? "text-green font-medium" : val < 50 ? "text-red font-medium" : "text-white/50"
                : "text-white/50"
            } ${ci < customColumns.length - 1 ? "border-r border-white/[0.06]" : ""}`}
            style={{ width: col.width, minWidth: 40 }}
          >
            {val != null ? (isNum ? (val as number).toFixed(col.decimals ?? 0) : String(val)) : "—"}
          </div>
        );
      })}

      {/* Hover tooltip — fixed position to escape overflow clipping */}
      {hovered && rowRef.current && (() => {
        const rect = rowRef.current!.getBoundingClientRect();
        return (
          <div
            className="pointer-events-none fixed z-[140] rounded-md border border-white/[0.08] bg-[#1C2128] px-2.5 py-1.5 shadow-xl shadow-black/40"
            style={{
              left: rect.left,
              top: Math.max(4, rect.top - 4),
              transform: "translateY(-100%)",
            }}
          >
            <p className="font-mono text-[11px] font-semibold text-white/90">
              {symbol}
            </p>
            <p className="text-[9px] text-white/40">{name}</p>
            {!quote && (
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

import { useEffect, useMemo, useRef, useState, memo } from "react";
import { GripVertical, X } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import CircularGauge from "./CircularGauge";
import { useTws } from "../lib/tws";
import { useWatchlist } from "../lib/watchlist";
import { LOGO_SYMBOLS } from "../lib/logo-symbols";
import type { HeatmapTile } from "../lib/heatmap-utils";
import { formatMarketCap } from "../lib/market-data";
import { linkBus } from "../lib/link-bus";
import { useSp500HeatmapData } from "../lib/use-sp500-heatmap";
import {
  TA_SCORE_TIMEFRAMES,
  TA_SCORE_TF_LABELS,
  type TaScoreTimeframe,
} from "../lib/ta-score-timeframes";

const SCORE_POLL_MS = 60_000;
const ROW_HEIGHT = 46;

type BuiltInColumnId =
  | "symbol"
  | "priceChange"
  | "mcap"
  | "pe"
  | "fpe"
  | "week52"
  | "verdict";
type ColumnId = BuiltInColumnId | `ta:${TaScoreTimeframe}`;
type SortKey =
  | "symbol"
  | "change"
  | "mcap"
  | "pe"
  | "fpe"
  | "verdict"
  | `tech_${TaScoreTimeframe}`;

interface TechScores {
  "5m": number | null;
  "15m": number | null;
  "1h": number | null;
  "4h": number | null;
  "1d": number | null;
  "1w": number | null;
}

interface ScreenerRow extends HeatmapTile {
  techScores: TechScores;
  verdictScore: number | null;
}

interface BuiltInColumnDef {
  id: BuiltInColumnId;
  label: string;
  width: number;
  minWidth: number;
  sortKey?: SortKey;
}

const BUILT_IN_COLUMNS: BuiltInColumnDef[] = [
  { id: "symbol", label: "Symbol", width: 240, minWidth: 180, sortKey: "symbol" },
  { id: "priceChange", label: "Price / Chg", width: 108, minWidth: 88, sortKey: "change" },
  { id: "mcap", label: "Mkt Cap", width: 96, minWidth: 72, sortKey: "mcap" },
  { id: "pe", label: "P/E", width: 76, minWidth: 60, sortKey: "pe" },
  { id: "fpe", label: "Fwd P/E", width: 82, minWidth: 64, sortKey: "fpe" },
  { id: "week52", label: "52W H / L", width: 108, minWidth: 84 },
  { id: "verdict", label: "Verdict", width: 104, minWidth: 90, sortKey: "verdict" },
];

const BUILT_IN_COLUMN_MAP = new Map(BUILT_IN_COLUMNS.map((col) => [col.id, col] as const));
const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = ["symbol", "priceChange", "mcap", "ta:1d", "verdict"];
const DEFAULT_TA_COL_WIDTH = 68;
const MIN_TA_COL_WIDTH = 52;

function isColumnId(value: unknown): value is ColumnId {
  if (typeof value !== "string") return false;
  if (BUILT_IN_COLUMN_MAP.has(value as BuiltInColumnId)) return true;
  return value.startsWith("ta:") && TA_SCORE_TIMEFRAMES.includes(value.slice(3) as TaScoreTimeframe);
}

function readVisibleColumns(config: Record<string, unknown>): ColumnId[] {
  const raw = config.visibleColumns;
  if (!Array.isArray(raw)) return DEFAULT_VISIBLE_COLUMNS;
  const cols = raw.filter(isColumnId);
  if (!cols.includes("symbol")) cols.unshift("symbol");
  return cols.length > 0 ? Array.from(new Set(cols)) : DEFAULT_VISIBLE_COLUMNS;
}

function readColumnWidths(config: Record<string, unknown>): Partial<Record<ColumnId, number>> {
  const raw = config.columnWidths;
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<ColumnId, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isColumnId(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

function getVisibleTimeframes(columns: ColumnId[]): TaScoreTimeframe[] {
  return columns
    .filter((col): col is `ta:${TaScoreTimeframe}` => col.startsWith("ta:"))
    .map((col) => col.slice(3) as TaScoreTimeframe);
}

function verdictScore(score: number | null): number {
  return score ?? -1;
}

function getVerdict(score: number | null): { label: string; cls: string } {
  if (score == null) return { label: "N/A", cls: "text-white/35" };
  if (score >= 75) return { label: "STRONG BUY", cls: "text-green bg-green/10" };
  if (score >= 60) return { label: "BUY", cls: "text-green/80 bg-green/[0.06]" };
  if (score >= 40) return { label: "NEUTRAL", cls: "text-amber bg-amber/10" };
  if (score >= 25) return { label: "SELL", cls: "text-red/80 bg-red/[0.06]" };
  return { label: "STRONG SELL", cls: "text-red bg-red/10" };
}

function averageScores(scores: TechScores, visibleTfs: TaScoreTimeframe[]): number | null {
  const preferred: TaScoreTimeframe[] = visibleTfs.length > 0 ? visibleTfs : ["1d"];
  const values = preferred
    .map((tf) => scores[tf])
    .filter((score): score is number => typeof score === "number");
  if (values.length === 0) return null;
  return values.reduce((sum, score) => sum + score, 0) / values.length;
}

const SymbolLogo = memo(function SymbolLogo({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  const upper = symbol.toUpperCase();

  if (failed || !LOGO_SYMBOLS.has(upper)) {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] font-mono text-[9px] font-semibold text-white/50">
        {upper.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={`/dailyiq-brand-resources/logosvg/${upper}.svg`}
      alt={upper}
      className="h-7 w-7 shrink-0 rounded-full object-contain"
      onError={() => setFailed(true)}
    />
  );
});

interface MiniScreenerCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  onSymbolSelect?: (symbol: string) => void;
}

interface ColumnDragState {
  colId: ColumnId;
  mouseX: number;
  mouseY: number;
}

export default function MiniScreenerCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  config,
  onConfigChange,
  onSymbolSelect,
}: MiniScreenerCardProps) {
  const { sidecarPort } = useTws();
  const { symbols: watchlistSymbols } = useWatchlist();
  const tiles = useSp500HeatmapData();
  const [techScoresMap, setTechScoresMap] = useState<Map<string, TechScores>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const configuredVisibleColumns = useMemo(() => readVisibleColumns(config), [config]);
  const configuredColumnWidths = useMemo(() => readColumnWidths(config), [config]);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(configuredVisibleColumns);
  const [columnWidths, setColumnWidths] = useState<Partial<Record<ColumnId, number>>>(configuredColumnWidths);
  const [sortKey, setSortKey] = useState<SortKey>("verdict");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colDragState, setColDragState] = useState<ColumnDragState | null>(null);
  const [colInsertBeforeId, setColInsertBeforeId] = useState<ColumnId | null>(null);
  const headerCellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const suppressSortRef = useRef(false);
  const colInsertBeforeIdRef = useRef<ColumnId | null>(null);
  const dragMouseXRef = useRef(0);

  useEffect(() => {
    setVisibleColumns(configuredVisibleColumns);
  }, [configuredVisibleColumns]);

  useEffect(() => {
    setColumnWidths(configuredColumnWidths);
  }, [configuredColumnWidths]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [pickerOpen]);

  const persistConfig = (patch: Record<string, unknown>) => {
    onConfigChange({ ...config, ...patch });
  };

  const toggleColumn = (columnId: ColumnId) => {
    if (columnId === "symbol") return;
    const next = visibleColumns.includes(columnId)
      ? visibleColumns.filter((col) => col !== columnId)
      : [...visibleColumns, columnId];
    setVisibleColumns(next);
    persistConfig({ visibleColumns: next });
  };

  const persistVisibleColumns = (next: ColumnId[]) => {
    setVisibleColumns(next);
    persistConfig({ visibleColumns: next });
  };

  const visibleTimeframes = useMemo(() => getVisibleTimeframes(visibleColumns), [visibleColumns]);

  useEffect(() => {
    const sortStillVisible =
      (sortKey === "symbol" && visibleColumns.includes("symbol")) ||
      (sortKey === "change" && visibleColumns.includes("priceChange")) ||
      (sortKey === "mcap" && visibleColumns.includes("mcap")) ||
      (sortKey === "pe" && visibleColumns.includes("pe")) ||
      (sortKey === "fpe" && visibleColumns.includes("fpe")) ||
      (sortKey === "verdict" && visibleColumns.includes("verdict")) ||
      (sortKey.startsWith("tech_") &&
        visibleColumns.includes(`ta:${sortKey.slice(5) as TaScoreTimeframe}` as ColumnId));

    if (!sortStillVisible) {
      setSortKey("verdict");
      setSortDir("desc");
    }
  }, [sortKey, visibleColumns]);

  const handleSort = (key?: SortKey) => {
    if (!key) return;
    if (suppressSortRef.current) {
      suppressSortRef.current = false;
      return;
    }
    if (sortKey === key) {
      setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const getColumnWidth = (col: ColumnId): number => {
    const configured = columnWidths[col];
    if (typeof configured === "number" && Number.isFinite(configured)) return configured;
    if (col.startsWith("ta:")) return DEFAULT_TA_COL_WIDTH;
    return BUILT_IN_COLUMN_MAP.get(col as BuiltInColumnId)?.width ?? 88;
  };

  const getMinColumnWidth = (col: ColumnId): number => {
    if (col.startsWith("ta:")) return MIN_TA_COL_WIDTH;
    return BUILT_IN_COLUMN_MAP.get(col as BuiltInColumnId)?.minWidth ?? 60;
  };

  const handleColumnResize = (colId: ColumnId, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = getColumnWidth(colId);
    const minWidth = getMinColumnWidth(colId);

    const onMove = (event: MouseEvent) => {
      const nextW = Math.max(minWidth, startW + (event.clientX - startX));
      setColumnWidths((prev) => ({ ...prev, [colId]: nextW }));
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setColumnWidths((prev) => {
        persistConfig({ columnWidths: prev });
        return prev;
      });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const startColumnDrag = (colId: ColumnId, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let didDrag = false;

    const getInsertId = (clientX: number): ColumnId | null => {
      for (const id of visibleColumns) {
        const el = headerCellRefs.current[id];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) return id;
      }
      return null;
    };

    const onMove = (event: MouseEvent) => {
      if (!didDrag) {
        if (Math.abs(event.clientX - startX) > 4 || Math.abs(event.clientY - startY) > 4) {
          didDrag = true;
          suppressSortRef.current = true;
          dragMouseXRef.current = event.clientX;
          setColDragState({ colId, mouseX: event.clientX, mouseY: event.clientY });
        }
        return;
      }
      dragMouseXRef.current = event.clientX;
      setColDragState((prev) => (prev ? { ...prev, mouseX: event.clientX, mouseY: event.clientY } : null));
      const insertId = getInsertId(event.clientX);
      colInsertBeforeIdRef.current = insertId;
      setColInsertBeforeId(insertId);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (didDrag) {
        const insertId = getInsertId(dragMouseXRef.current || startX);
        const nextInsertId = insertId ?? colInsertBeforeIdRef.current;
        const current = [...visibleColumns];
        const draggedIdx = current.indexOf(colId);
        if (draggedIdx !== -1) {
          current.splice(draggedIdx, 1);
          const targetIdx = nextInsertId ? current.indexOf(nextInsertId) : current.length;
          current.splice(targetIdx === -1 ? current.length : targetIdx, 0, colId);
          persistVisibleColumns(current);
        }
      }
      colInsertBeforeIdRef.current = null;
      setColDragState(null);
      setColInsertBeforeId(null);
      window.setTimeout(() => {
        suppressSortRef.current = false;
      }, 0);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    if (!sidecarPort || watchlistSymbols.length === 0) return;
    let cancelled = false;

    async function fetchScores() {
      try {
        const syms = watchlistSymbols.join(",");
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/technicals/scores?symbols=${syms}`);
        if (!res.ok) return;
        const data: Record<string, TechScores>[] = await res.json();
        if (cancelled) return;
        const map = new Map<string, TechScores>();
        if (Array.isArray(data)) {
          for (const entry of data) {
            const sym = (entry as Record<string, unknown>).symbol as string;
            if (sym) map.set(sym, entry as unknown as TechScores);
          }
        }
        setTechScoresMap(map);
      } catch {
        // ignore transport failures; next poll retries
      }
    }

    fetchScores();
    const id = setInterval(fetchScores, SCORE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sidecarPort, watchlistSymbols]);

  const rows = useMemo(() => {
    const enriched: ScreenerRow[] = tiles.map((tile) => {
      const detailed = techScoresMap.get(tile.symbol);
      const techScores: TechScores = {
        "5m": detailed?.["5m"] ?? null,
        "15m": detailed?.["15m"] ?? null,
        "1h": detailed?.["1h"] ?? null,
        "4h": detailed?.["4h"] ?? null,
        "1d": detailed?.["1d"] ?? tile.techScore1d ?? null,
        "1w": detailed?.["1w"] ?? tile.techScore1w ?? null,
      };
      return {
        ...tile,
        techScores,
        verdictScore: averageScores(techScores, visibleTimeframes),
      };
    });

    const dir = sortDir === "asc" ? 1 : -1;
    enriched.sort((a, b) => {
      let va: number;
      let vb: number;
      switch (sortKey) {
        case "symbol":
          return a.symbol.localeCompare(b.symbol) * dir;
        case "change":
          va = a.changePct ?? -999999;
          vb = b.changePct ?? -999999;
          return (va - vb) * dir;
        case "mcap":
          va = a.marketCap ?? -999999;
          vb = b.marketCap ?? -999999;
          return (va - vb) * dir;
        case "pe":
          va = a.trailingPE ?? -999999;
          vb = b.trailingPE ?? -999999;
          return (va - vb) * dir;
        case "fpe":
          va = a.forwardPE ?? -999999;
          vb = b.forwardPE ?? -999999;
          return (va - vb) * dir;
        case "verdict":
          va = verdictScore(a.verdictScore);
          vb = verdictScore(b.verdictScore);
          return (va - vb) * dir;
        default: {
          const tf = sortKey.slice(5) as TaScoreTimeframe;
          va = verdictScore(a.techScores[tf]);
          vb = verdictScore(b.techScores[tf]);
          return (va - vb) * dir;
        }
      }
    });

    return enriched;
  }, [tiles, techScoresMap, visibleTimeframes, sortDir, sortKey]);

  const gridTemplateColumns = useMemo(
    () =>
      visibleColumns
        .map((col) => {
          return `${getColumnWidth(col)}px`;
        })
        .join(" "),
    [visibleColumns, columnWidths],
  );

  const tableMinWidth = useMemo(
    () =>
      visibleColumns.reduce((sum, col) => {
        return sum + getColumnWidth(col);
      }, 0),
    [visibleColumns, columnWidths],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-white/70">Screener</span>
          <span className="font-mono text-[11px] text-white/25">
            {tiles.length > 0 ? `${rows.length}/${tiles.length}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div ref={pickerRef} className="relative">
            <button
              onClick={() => setPickerOpen((open) => !open)}
              className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-75 ${
                pickerOpen || visibleColumns.length > DEFAULT_VISIBLE_COLUMNS.length
                  ? "bg-blue/20 text-blue hover:bg-blue/30"
                  : "text-white/55 hover:bg-white/[0.06] hover:text-white/80"
              }`}
              title="Columns"
            >
              Cols
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-full z-[120] mt-1 w-[210px] rounded-md border border-white/[0.08] bg-[#1C2128] p-2 shadow-xl shadow-black/40">
                <div className="mb-2 text-[9px] uppercase tracking-[0.14em] text-white/30">
                  Metrics
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {BUILT_IN_COLUMNS.map((column) => {
                    const active = visibleColumns.includes(column.id);
                    const locked = column.id === "symbol";
                    return (
                      <button
                        key={column.id}
                        onClick={() => toggleColumn(column.id)}
                        disabled={locked}
                        className={`rounded-sm px-2 py-1 text-left font-mono text-[10px] transition-colors duration-75 ${
                          active
                            ? "bg-blue/20 text-blue"
                            : "text-white/55 hover:bg-white/[0.06] hover:text-white/80"
                        } ${locked ? "cursor-default opacity-90" : ""}`}
                      >
                        {column.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mb-2 mt-3 text-[9px] uppercase tracking-[0.14em] text-white/30">
                  TA Scores
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {TA_SCORE_TIMEFRAMES.map((tf) => {
                    const colId = `ta:${tf}` as ColumnId;
                    const active = visibleColumns.includes(colId);
                    return (
                      <button
                        key={tf}
                        onClick={() => toggleColumn(colId)}
                        className={`rounded-sm px-2 py-1 text-center font-mono text-[10px] transition-colors duration-75 ${
                          active
                            ? "bg-purple/20 text-purple"
                            : "text-white/55 hover:bg-white/[0.06] hover:text-white/80"
                        }`}
                      >
                        {TA_SCORE_TF_LABELS[tf]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <ComponentLinkMenu linkChannel={linkChannel} onSetLinkChannel={onSetLinkChannel} />
          <button
            onClick={onClose}
            className="rounded-sm p-0.5 text-white/70 transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
          >
            <X className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto scrollbar-none">
        <div style={{ minWidth: tableMinWidth }} className="min-h-full">
          <div
            className="grid shrink-0 items-center border-b border-white/[0.06] bg-[#0D1117]"
            style={{ gridTemplateColumns }}
          >
            {visibleColumns.map((col, ci) => {
              const isLast = ci === visibleColumns.length - 1;
              const borderClass = !isLast ? "border-r border-white/[0.06]" : "";

              if (col.startsWith("ta:")) {
                const tf = col.slice(3) as TaScoreTimeframe;
                const active = sortKey === `tech_${tf}`;
                return (
                  <div
                    key={col}
                    ref={(el) => {
                      headerCellRefs.current[col] = el;
                    }}
                    onMouseDown={(e) => startColumnDrag(col, e)}
                    onClick={() => handleSort(`tech_${tf}`)}
                    className={`relative flex min-w-0 cursor-grab select-none items-center justify-center gap-1 truncate px-1 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-wider transition-colors duration-75 hover:text-white ${
                      active ? "text-white" : "text-white/70"
                    } ${borderClass} ${colDragState?.colId === col ? "opacity-40" : ""}`}
                  >
                    {colInsertBeforeId === col && colDragState && (
                      <div className="pointer-events-none absolute left-0 top-0 z-20 h-full w-0.5 bg-blue" />
                    )}
                    {isLast && colInsertBeforeId === null && colDragState && (
                      <div className="pointer-events-none absolute right-0 top-0 z-20 h-full w-0.5 bg-blue" />
                    )}
                    <span>{TA_SCORE_TF_LABELS[tf]}</span>
                    {active && <span className="text-[9px] text-white/50">{sortDir === "asc" ? "▲" : "▼"}</span>}
                    <div
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue/[0.15]"
                      onMouseDown={(e) => handleColumnResize(col, e)}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    />
                  </div>
                );
              }

              const column = BUILT_IN_COLUMN_MAP.get(col as BuiltInColumnId);
              const active = column?.sortKey != null && sortKey === column.sortKey;
              const alignClass = col === "symbol" ? "text-left" : col === "verdict" ? "text-center" : "text-right";
              return (
                <div
                  key={col}
                  ref={(el) => {
                    headerCellRefs.current[col] = el;
                  }}
                  onMouseDown={(e) => startColumnDrag(col, e)}
                  onClick={() => handleSort(column?.sortKey)}
                  className={`relative flex min-w-0 select-none items-center gap-1 truncate px-1.5 py-2 font-mono text-[10px] font-medium uppercase tracking-wider transition-colors duration-75 ${
                    alignClass
                  } ${active ? "text-white" : "text-white/70"} ${borderClass} ${colDragState?.colId === col ? "opacity-40" : ""} ${
                    column?.sortKey ? "cursor-grab hover:text-white" : "cursor-grab hover:text-white/85"
                  } ${col === "symbol" ? "justify-start" : col === "verdict" ? "justify-center" : "justify-end"}`}
                >
                  {colInsertBeforeId === col && colDragState && (
                    <div className="pointer-events-none absolute left-0 top-0 z-20 h-full w-0.5 bg-blue" />
                  )}
                  {isLast && colInsertBeforeId === null && colDragState && (
                    <div className="pointer-events-none absolute right-0 top-0 z-20 h-full w-0.5 bg-blue" />
                  )}
                  {col === "symbol" && <GripVertical className="h-3 w-3 shrink-0 text-white/20" strokeWidth={1.5} />}
                  <span className="truncate">{column?.label}</span>
                  {active && <span className="text-[9px] text-white/50">{sortDir === "asc" ? "▲" : "▼"}</span>}
                  <div
                    className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue/[0.15]"
                    onMouseDown={(e) => handleColumnResize(col, e)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  />
                </div>
              );
            })}
          </div>

          {tiles.length === 0 ? (
            <div className="flex h-full min-h-[160px] items-center justify-center font-mono text-[12px] text-white/20">
              Loading...
            </div>
          ) : (
            rows.map((row) => {
              const change = row.changePct ?? null;
              const isUp = (change ?? 0) >= 0;
              const verdict = getVerdict(row.verdictScore);
              return (
                <div
                  key={row.symbol}
                  className="grid cursor-pointer items-center border-b border-white/[0.03] px-3 transition-colors duration-75 hover:bg-white/[0.06]"
                  style={{ height: ROW_HEIGHT, gridTemplateColumns }}
                  onClick={() => {
                    if (linkChannel) linkBus.publish(linkChannel, row.symbol);
                    onSymbolSelect?.(row.symbol);
                  }}
                >
                  {visibleColumns.map((col) => {
                    if (col === "symbol") {
                      return (
                        <div key={col} className="flex min-w-0 items-center gap-2 overflow-hidden">
                          <SymbolLogo symbol={row.symbol} />
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[13px] font-semibold leading-tight text-white/90">
                              {row.symbol}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] leading-tight text-white/35">
                              {row.name}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    if (col === "priceChange") {
                      return (
                        <div key={col} className="text-right">
                          <p className="font-mono text-[12px] font-medium leading-tight text-white/85">
                            {row.last != null ? `$${row.last.toFixed(2)}` : "\u2014"}
                          </p>
                          <p className={`mt-0.5 font-mono text-[10px] leading-tight ${isUp ? "text-green" : "text-red"}`}>
                            {change != null ? `${isUp ? "+" : ""}${change.toFixed(2)}%` : "\u2014"}
                          </p>
                        </div>
                      );
                    }

                    if (col === "mcap") {
                      return (
                        <div key={col} className="text-right font-mono text-[11px] text-white/60">
                          {formatMarketCap(row.marketCap)}
                        </div>
                      );
                    }

                    if (col === "pe") {
                      return (
                        <div key={col} className="text-right font-mono text-[11px] text-white/60">
                          {row.trailingPE != null ? row.trailingPE.toFixed(1) : "\u2014"}
                        </div>
                      );
                    }

                    if (col === "fpe") {
                      return (
                        <div key={col} className="text-right font-mono text-[11px] text-white/60">
                          {row.forwardPE != null ? row.forwardPE.toFixed(1) : "\u2014"}
                        </div>
                      );
                    }

                    if (col === "week52") {
                      return (
                        <div key={col} className="text-right font-mono text-[11px] leading-tight text-white/55">
                          <div>{row.week52High != null ? row.week52High.toFixed(0) : "\u2014"}</div>
                          <div className="mt-0.5 text-white/30">{row.week52Low != null ? row.week52Low.toFixed(0) : "\u2014"}</div>
                        </div>
                      );
                    }

                    if (col === "verdict") {
                      return (
                        <div key={col} className="flex justify-center px-1">
                          <span
                            className={`inline-block max-w-full truncate rounded-full px-2.5 py-0.5 text-center font-mono text-[10px] font-semibold leading-tight ${verdict.cls}`}
                          >
                            {verdict.label}
                          </span>
                        </div>
                      );
                    }

                    if (col.startsWith("ta:")) {
                      const tf = col.slice(3) as TaScoreTimeframe;
                      const score = row.techScores[tf];
                      return (
                        <div key={col} className="flex justify-center">
                          <CircularGauge score={score} size={30} />
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import { Columns3, GripVertical, Search, X } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import SymbolSearchModal from "./SymbolSearchModal";
import CircularGauge from "./CircularGauge";
import { useWatchlist } from "../lib/watchlist";
import { LOGO_SYMBOLS } from "../lib/logo-symbols";
import type { HeatmapTile } from "../lib/heatmap-utils";
import { formatMarketCap } from "../lib/market-data";
import { linkBus } from "../lib/link-bus";
import { useSp500HeatmapData } from "../lib/use-sp500-heatmap";
import { useTechScores } from "../lib/use-technicals";
import {
  TA_SCORE_TIMEFRAMES,
  TA_SCORE_TF_LABELS,
  type TaScoreTimeframe,
} from "../lib/ta-score-timeframes";

const ROW_HEIGHT = 46;
const MAG7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"];
const MINI_SCREENER_FILTER_KEY = "dailyiq.miniScreener.filter";
const MINI_SCREENER_CUSTOM_KEY = "dailyiq.miniScreener.customSymbols";

type MiniFilterType = "all" | "mag7" | "watchlist" | "custom";

type BuiltInColumnId =
  | "symbol"
  | "priceChange"
  | "mcap"
  | "sentiment"
  | "pe"
  | "fpe"
  | "week52"
  | "verdict";
type ColumnId = BuiltInColumnId | `ta:${TaScoreTimeframe}`;
type SortKey =
  | "symbol"
  | "change"
  | "mcap"
  | "sentiment"
  | "pe"
  | "fpe"
  | "verdict"
  | `tech_${TaScoreTimeframe}`;

interface TechScores {
  "1m": number | null;
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
  defaultVisible: boolean;
}

const BUILT_IN_COLUMNS: BuiltInColumnDef[] = [
  { id: "symbol", label: "Symbol", width: 160, minWidth: 120, sortKey: "symbol", defaultVisible: true },
  { id: "priceChange", label: "Price / Chg", width: 108, minWidth: 88, sortKey: "change", defaultVisible: true },
  { id: "mcap", label: "Mkt Cap", width: 96, minWidth: 72, sortKey: "mcap", defaultVisible: true },
  { id: "sentiment", label: "Sentiment", width: 88, minWidth: 68, sortKey: "sentiment", defaultVisible: true },
  { id: "pe", label: "P/E", width: 76, minWidth: 60, sortKey: "pe", defaultVisible: false },
  { id: "fpe", label: "Fwd P/E", width: 82, minWidth: 64, sortKey: "fpe", defaultVisible: false },
  { id: "week52", label: "52W H / L", width: 108, minWidth: 84, defaultVisible: false },
  { id: "verdict", label: "Verdict", width: 104, minWidth: 90, sortKey: "verdict", defaultVisible: true },
];

const BUILT_IN_COLUMN_MAP = new Map(BUILT_IN_COLUMNS.map((col) => [col.id, col] as const));
const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = ["symbol", "priceChange", "mcap", "sentiment", "ta:1d", "verdict"];
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

function MiniScreenerCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  config,
  onConfigChange,
  onSymbolSelect,
}: MiniScreenerCardProps) {
  const { symbols: watchlistSymbols } = useWatchlist();
  const tiles = useSp500HeatmapData();
  const containerRef = useRef<HTMLDivElement>(null);
  const colPickerRef = useRef<HTMLDivElement>(null);
  const colPickerButtonRef = useRef<HTMLButtonElement>(null);
  const colPickerPanelRef = useRef<HTMLDivElement>(null);
  const [colPickerRect, setColPickerRect] = useState<DOMRect | null>(null);
  const configuredVisibleColumns = useMemo(() => readVisibleColumns(config), [config]);
  const configuredColumnWidths = useMemo(() => readColumnWidths(config), [config]);
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(configuredVisibleColumns);
  const [columnWidths, setColumnWidths] = useState<Partial<Record<ColumnId, number>>>(configuredColumnWidths);
  const [sortKey, setSortKey] = useState<SortKey>("verdict");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [search, _setSearch] = useState("");
  const [symbolModalOpen, setSymbolModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<MiniFilterType>(() => {
    const stored = localStorage.getItem(MINI_SCREENER_FILTER_KEY);
    return (["all", "mag7", "watchlist", "custom"].includes(stored ?? "") ? stored : "all") as MiniFilterType;
  });
  const [customSymbols, setCustomSymbols] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(MINI_SCREENER_CUSTOM_KEY) ?? "[]") as string[]; }
    catch { return []; }
  });
  const [customDraft, setCustomDraft] = useState("");
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
    if (!colPickerOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !colPickerButtonRef.current?.contains(target) &&
        !colPickerPanelRef.current?.contains(target)
      ) {
        setColPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colPickerOpen]);

  function openColPicker() {
    if (!colPickerOpen && colPickerButtonRef.current) {
      setColPickerRect(colPickerButtonRef.current.getBoundingClientRect());
    }
    setColPickerOpen((v) => !v);
  }

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
    localStorage.setItem(MINI_SCREENER_FILTER_KEY, filterType);
    if (filterType === "custom") setCustomDraft(customSymbols.join(", "));
  }, [filterType, customSymbols]);

  const scoreSymbols = useMemo(() => {
    if (filterType === "mag7") return MAG7;
    if (filterType === "watchlist") return watchlistSymbols;
    if (filterType === "custom") return customSymbols;
    return tiles.map((t) => t.symbol);
  }, [filterType, watchlistSymbols, customSymbols, tiles]);
  const technicals = useTechScores(scoreSymbols, TA_SCORE_TIMEFRAMES as unknown as string[]);

  useEffect(() => {
    const sortStillVisible =
      (sortKey === "symbol" && visibleColumns.includes("symbol")) ||
      (sortKey === "change" && visibleColumns.includes("priceChange")) ||
      (sortKey === "mcap" && visibleColumns.includes("mcap")) ||
      (sortKey === "sentiment" && visibleColumns.includes("sentiment")) ||
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

  const rows = useMemo(() => {
    const enriched: ScreenerRow[] = tiles.map((tile) => {
      const detailed = technicals.get(tile.symbol);
      const techScores: TechScores = {
        "1m": detailed?.get("1m")?.score ?? null,
        "5m": detailed?.get("5m")?.score ?? null,
        "15m": detailed?.get("15m")?.score ?? null,
        "1h": detailed?.get("1h")?.score ?? null,
        "4h": detailed?.get("4h")?.score ?? null,
        "1d": detailed?.get("1d")?.score ?? tile.techScore1d ?? null,
        "1w": detailed?.get("1w")?.score ?? tile.techScore1w ?? null,
      };
      return {
        ...tile,
        techScores,
        verdictScore: averageScores(techScores, visibleTimeframes),
      };
    });

    let filtered = enriched;
    if (filterType === "mag7") {
      const set = new Set(MAG7);
      filtered = enriched.filter((r) => set.has(r.symbol));
    } else if (filterType === "watchlist") {
      const set = new Set(watchlistSymbols);
      filtered = enriched.filter((r) => set.has(r.symbol));
    } else if (filterType === "custom" && customSymbols.length > 0) {
      const set = new Set(customSymbols);
      filtered = enriched.filter((r) => set.has(r.symbol));
    }

    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
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
        case "sentiment":
          va = a.sentimentScore ?? -1;
          vb = b.sentimentScore ?? -1;
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

    if (search.trim()) {
      const q = search.trim().toUpperCase();
      return filtered.filter((r) => r.symbol.includes(q) || r.name?.toUpperCase().includes(q));
    }
    return filtered;
  }, [tiles, technicals, visibleTimeframes, sortDir, sortKey, search, filterType, watchlistSymbols, customSymbols]);

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
          <button
            type="button"
            onClick={() => setSymbolModalOpen(true)}
            className="flex items-center justify-center rounded-sm p-1 text-white transition-colors duration-75 hover:bg-white/[0.06]"
            aria-label="Search symbols"
          >
            <Search className="h-3 w-3" strokeWidth={1.6} />
          </button>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[11px] font-medium text-white/80">Screener</span>
            {visibleColumns.filter((c) => c.startsWith("ta:")).map((c) => {
              const tf = c.slice(3) as TaScoreTimeframe;
              return (
                <span key={c} className="rounded-[3px] bg-white/[0.07] px-1 py-0.5 font-mono text-[9px] font-medium text-white/55">
                  {TA_SCORE_TF_LABELS[tf]}
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-0.5 rounded-sm border border-white/[0.07] bg-white/[0.03] p-0.5">
            {(
              [
                ["all", "All"],
                ["mag7", "MAG 7"],
                ["watchlist", "WL"],
                ["custom", "Custom"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilterType(key)}
                className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-wide transition-colors ${
                  filterType === key
                    ? "bg-blue/25 text-white"
                    : "text-white/40 hover:bg-white/[0.05] hover:text-white/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div ref={colPickerRef}>
            <button
              ref={colPickerButtonRef}
              type="button"
              onClick={openColPicker}
              className="flex items-center gap-1 rounded-sm transition-colors duration-75 hover:bg-white/[0.06] hover:text-white"
              style={{
                height: 16,
                padding: "0 6px",
                borderRadius: 2,
                border: "none",
                cursor: "pointer",
                backgroundColor: colPickerOpen ? "rgba(255,255,255,0.06)" : "transparent",
                color: "#FFFFFF",
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 11,
                lineHeight: 1,
              }}
            >
              <Columns3 className="h-[13px] w-[13px]" strokeWidth={2} />
              Cols
            </button>
          </div>
          {colPickerOpen && colPickerRect
            ? createPortal(
                <div
                  ref={colPickerPanelRef}
                  className="fixed z-[9999] flex w-[230px] flex-col overflow-y-auto rounded-md border border-white/[0.10] bg-[#161B22] shadow-2xl shadow-black/60 scrollbar-dark"
                  style={{
                    top: colPickerRect.bottom + 4,
                    right: window.innerWidth - colPickerRect.right,
                    maxHeight: "min(440px, calc(100vh - 120px))",
                  }}
                >
                  <div className="p-2">
                    <p className="mb-1.5 text-[9px] uppercase tracking-[0.14em] text-white/28">Visible Columns</p>
                    <div className="space-y-0.5">
                      {BUILT_IN_COLUMNS.map((col) => (
                        <label
                          key={col.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-white/[0.04] ${col.id === "symbol" ? "pointer-events-none opacity-60" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={visibleColumns.includes(col.id)}
                            onChange={() => toggleColumn(col.id)}
                            disabled={col.id === "symbol"}
                            className="h-3 w-3 accent-blue"
                          />
                          <span className="text-[10px] text-white/65">{col.label}</span>
                          {!col.defaultVisible ? <span className="ml-auto text-[8px] text-white/22">opt</span> : null}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-white/[0.08] bg-[#131920] p-2">
                    <p className="mb-1.5 text-[9px] uppercase tracking-[0.14em] text-blue/70">TA Score Columns</p>
                    <div className="flex flex-wrap gap-1">
                      {TA_SCORE_TIMEFRAMES.map((tf) => {
                        const colId = `ta:${tf}` as ColumnId;
                        return (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => toggleColumn(colId)}
                            className={`rounded-sm px-2 py-0.5 text-[9px] font-mono transition-colors ${
                              visibleColumns.includes(colId)
                                ? "bg-blue/[0.22] text-blue"
                                : "border border-white/[0.08] text-white/40 hover:border-white/[0.18] hover:text-white/72"
                            }`}
                          >
                            {tf}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[9px] text-white/28">
                      {visibleTimeframes.length > 0
                        ? "Toggle timeframes to show or hide score columns."
                        : "Click a timeframe to add a score column"}
                    </p>
                  </div>
                </div>,
                document.body,
              )
            : null}
          <ComponentLinkMenu linkChannel={linkChannel} onSetLinkChannel={onSetLinkChannel} />
          <button
            onClick={onClose}
            className="rounded-sm p-0 text-white transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
              padding: 0,
              border: "none",
              cursor: "pointer",
              backgroundColor: "transparent",
              color: "#FFFFFF",
              borderRadius: 2,
            }}
          >
            <X className="h-[12px] w-[12px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {filterType === "custom" && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-white/[0.06] bg-[#0f141b] px-2 py-1.5">
          <input
            type="text"
            spellCheck={false}
            className="flex-1 rounded-sm border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-white/80 placeholder:text-white/20 focus:border-blue/40 focus:outline-none"
            placeholder="AAPL, MSFT, NVDA…"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const syms = customDraft.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
                setCustomSymbols(syms);
                localStorage.setItem(MINI_SCREENER_CUSTOM_KEY, JSON.stringify(syms));
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              const syms = customDraft.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
              setCustomSymbols(syms);
              localStorage.setItem(MINI_SCREENER_CUSTOM_KEY, JSON.stringify(syms));
            }}
            className="rounded-sm bg-blue/20 px-2 py-0.5 font-mono text-[9px] text-blue hover:bg-blue/30"
          >
            Apply
          </button>
        </div>
      )}

      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto scrollbar-none">
        <div style={{ width: tableMinWidth, minWidth: "100%" }} className="min-h-full">
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
            <div className="flex h-full min-h-[160px] items-center justify-center font-mono text-[12px] text-white/35">
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
                  className="grid cursor-pointer items-center border-b border-white/[0.03] transition-colors duration-75 hover:bg-white/[0.06]"
                  style={{ minHeight: ROW_HEIGHT, gridTemplateColumns }}
                  onClick={() => {
                    if (linkChannel) linkBus.publish(linkChannel, row.symbol);
                    onSymbolSelect?.(row.symbol);
                  }}
                >
                  {visibleColumns.map((col) => {
                    if (col === "symbol") {
                      return (
                        <div key={col} className="flex min-w-0 items-center gap-2 overflow-hidden px-1.5 py-2.5">
                          <div className="shrink-0">
                            <SymbolLogo symbol={row.symbol} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-mono text-[13px] font-semibold leading-tight text-white/90">
                              {row.symbol}
                            </p>
                            <p className="mt-0.5 text-[11px] leading-snug text-white/60 break-words">
                              {row.name}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    if (col === "priceChange") {
                      return (
                        <div key={col} className="px-1.5 text-right">
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
                        <div key={col} className="px-1.5 text-right font-mono text-[11px] text-white/80">
                          {formatMarketCap(row.marketCap)}
                        </div>
                      );
                    }

                    if (col === "sentiment") {
                      return (
                        <div key={col} className="flex justify-center">
                          <CircularGauge score={row.sentimentScore ?? null} size={28} />
                        </div>
                      );
                    }

                    if (col === "pe") {
                      return (
                        <div key={col} className="px-1.5 text-right font-mono text-[11px] text-white/80">
                          {row.trailingPE != null ? row.trailingPE.toFixed(1) : "\u2014"}
                        </div>
                      );
                    }

                    if (col === "fpe") {
                      return (
                        <div key={col} className="px-1.5 text-right font-mono text-[11px] text-white/80">
                          {row.forwardPE != null ? row.forwardPE.toFixed(1) : "\u2014"}
                        </div>
                      );
                    }

                    if (col === "week52") {
                      return (
                        <div key={col} className="px-1.5 text-right font-mono text-[11px] leading-tight text-white/80">
                          <div>{row.week52High != null ? row.week52High.toFixed(0) : "\u2014"}</div>
                          <div className="mt-0.5 text-white/55">{row.week52Low != null ? row.week52Low.toFixed(0) : "\u2014"}</div>
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

      <SymbolSearchModal
        isOpen={symbolModalOpen}
        onClose={() => setSymbolModalOpen(false)}
        onSelectSymbol={(sym) => {
          if (linkChannel) linkBus.publish(linkChannel, sym);
        }}
        title="Symbol Search"
        subtitle="Select a symbol to focus"
      />
    </div>
  );
}

export default memo(MiniScreenerCard);

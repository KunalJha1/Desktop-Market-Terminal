import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from "react";
import { useTws } from "../lib/tws";
import { useWatchlist } from "../lib/watchlist";
import { SEARCHABLE_SYMBOLS, formatMarketCap, filterRankSymbolSearch } from "../lib/market-data";
import CircularGauge from "../components/CircularGauge";

import { LOGO_SYMBOLS } from "../lib/logo-symbols";
import {
  TA_SCORE_TF_LABELS,
  TA_SCORE_TIMEFRAMES,
  type TaScoreTimeframe,
} from "../lib/ta-score-timeframes";
import { useTechScores } from "../lib/use-technicals";

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

// ── Types ────────────────────────────────────────────────────────────

interface HeatmapTile {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  groups: string[];
  sp500Weight: number;
  last: number | null;
  changePct: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  week52High: number | null;
  week52Low: number | null;
  volume: number | null;
  techScore1d: number | null;
  techScore1w: number | null;
}

interface TechScores {
  "1m": number | null;
  "5m": number | null;
  "15m": number | null;
  "1h": number | null;
  "1d": number | null;
  "1w": number | null;
}

interface ScreenerRow extends HeatmapTile {
  techScores: TechScores | null;
}

type SortKey =
  | "symbol"
  | "mcap"
  | "pe"
  | "fpe"
  | "change"
  | "verdict"
  | `tech_${TaScoreTimeframe}`;

type SortDir = "asc" | "desc";

type FilterType =
  | "all"
  | "watchlist"
  | "custom"
  | "mag7"
  | "movers"
  | "bullish"
  | "bearish";

const SCREENER_CUSTOM_STORAGE_KEY = "dailyiq.screener.customSymbols";
const SCREENER_VISIBLE_TFS_STORAGE_KEY = "dailyiq.screener.visibleTimeframes";
const CUSTOM_SYMBOL_INPUT_LIMIT = 100;

function loadStoredCustomSymbols(): string[] {
  try {
    const raw = localStorage.getItem(SCREENER_CUSTOM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseSymbolsFromInput(text: string, limit = CUSTOM_SYMBOL_INPUT_LIMIT): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\s,;\n]+/)) {
    const s = part.trim().toUpperCase();
    if (!s || s.length > 12) continue;
    if (!/^[A-Z0-9.\-]+$/.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

const ALL_TIMEFRAMES: TaScoreTimeframe[] = [...TA_SCORE_TIMEFRAMES];
const SCREENER_TIMEFRAMES: TaScoreTimeframe[] = ["5m", "15m", "1h", "1d", "1w"];
const DEFAULT_VISIBLE_TFS: TaScoreTimeframe[] = ["1d", "1w"];

function normalizeVisibleTimeframes(value: unknown): TaScoreTimeframe[] {
  if (!Array.isArray(value)) return DEFAULT_VISIBLE_TFS;
  const seen = new Set<TaScoreTimeframe>();
  const normalized = value
    .filter((tf): tf is TaScoreTimeframe => typeof tf === "string" && TA_SCORE_TIMEFRAMES.includes(tf as TaScoreTimeframe))
    .filter((tf) => {
      if (seen.has(tf)) return false;
      seen.add(tf);
      return true;
    });
  if (normalized.length === 0) return DEFAULT_VISIBLE_TFS;
  return [...normalized].sort(
    (a, b) => ALL_TIMEFRAMES.indexOf(a) - ALL_TIMEFRAMES.indexOf(b),
  );
}

function loadStoredVisibleTimeframes(): TaScoreTimeframe[] {
  try {
    const raw = localStorage.getItem(SCREENER_VISIBLE_TFS_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_TFS;
    return normalizeVisibleTimeframes(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_VISIBLE_TFS;
  }
}

const MAG7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"];
const VISIBLE_BATCH = 30;
const DATA_POLL_MS = 5000;

// ── Verdict logic (average of visible tech scores) ───────────────────

function getVerdict(score: number | null): {
  label: string;
  cls: string;
} {
  if (score === null || score === undefined)
    return { label: "N/A", cls: "text-white/30" };
  if (score >= 75)
    return { label: "STRONG BUY", cls: "text-green bg-green/10" };
  if (score >= 60)
    return { label: "BUY", cls: "text-green/80 bg-green/[0.06]" };
  if (score >= 40)
    return { label: "NEUTRAL", cls: "text-amber bg-amber/10" };
  if (score >= 25)
    return { label: "SELL", cls: "text-red/80 bg-red/[0.06]" };
  return { label: "STRONG SELL", cls: "text-red bg-red/10" };
}

// ── Sorting arrow ────────────────────────────────────────────────────

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active)
    return <span className="ml-1 text-[10px] text-white/15">↕</span>;
  return (
    <span className="ml-1 text-[10px] text-blue">
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

// ── Skeleton row ─────────────────────────────────────────────────────

function SkeletonRow({ delay, extraCols }: { delay: number; extraCols: number }) {
  return (
    <tr
      className="border-b border-white/[0.06] bg-panel/70"
      style={{ animationDelay: `${delay}s` }}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 animate-pulse rounded-full bg-white/[0.06]" />
          <div>
            <div className="h-3 w-12 animate-pulse rounded bg-white/[0.06]" />
            <div className="mt-1.5 h-2.5 w-20 animate-pulse rounded bg-white/[0.04]" />
          </div>
        </div>
      </td>
      <td className="px-2 py-2.5" align="center">
        <div className="mx-auto h-3 w-12 animate-pulse rounded bg-white/[0.06]" />
      </td>
      <td className="px-2 py-2.5" align="center">
        <div className="mx-auto h-3 w-9 animate-pulse rounded bg-white/[0.06]" />
      </td>
      <td className="px-2 py-2.5" align="center">
        <div className="mx-auto h-3 w-9 animate-pulse rounded bg-white/[0.06]" />
      </td>
      <td className="px-2 py-2.5" align="right">
        <div className="ml-auto h-3 w-16 animate-pulse rounded bg-white/[0.06]" />
        <div className="ml-auto mt-1.5 h-2.5 w-11 animate-pulse rounded bg-white/[0.04]" />
      </td>
      <td className="px-2 py-2.5" align="center">
        <div className="mx-auto h-3 w-20 animate-pulse rounded bg-white/[0.06]" />
      </td>
      {Array.from({ length: extraCols }).map((_, i) => (
        <td key={i} className="px-2 py-2.5" align="center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-white/[0.06]" />
        </td>
      ))}
      <td className="px-2 py-2.5" align="center">
        <div className="mx-auto h-5 w-20 animate-pulse rounded-full bg-white/[0.06]" />
      </td>
    </tr>
  );
}

// ── Table row ────────────────────────────────────────────────────────

const ScreenerTableRow = memo(function ScreenerTableRow({
  row,
  visibleTfs,
  getTechScoreForTf,
  verdictScore,
}: {
  row: ScreenerRow;
  visibleTfs: TaScoreTimeframe[];
  getTechScoreForTf: (row: ScreenerRow, tf: TaScoreTimeframe) => number | null;
  verdictScore: number | null;
}) {
  const isUp = (row.changePct ?? 0) >= 0;
  const verdict = getVerdict(verdictScore);

  return (
    <tr className="border-b border-white/[0.06] bg-panel/70 transition-colors duration-[80ms] odd:bg-panel even:bg-base/80 hover:bg-white/[0.04]">
      {/* Symbol */}
      <td className="w-[200px] min-w-[200px] px-3 py-2">
        <div className="flex items-center gap-2.5">
          <SymbolLogo symbol={row.symbol} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[15px] font-semibold leading-none text-white/90">
              {row.symbol}
            </p>
            <p className="mt-0.5 text-[13px] leading-none text-white/35">
              {row.name}
            </p>
            {row.sector && (
              <p className="mt-0.5 text-[12px] leading-none text-white/20">
                {row.sector}
              </p>
            )}
          </div>
        </div>
      </td>

      {/* Market Cap */}
      <td className="px-2 py-2 text-center font-mono text-[13px] text-white/60">
        {formatMarketCap(row.marketCap)}
      </td>

      {/* Trailing P/E */}
      <td className="px-2 py-2 text-center font-mono text-[13px] text-white/60">
        {row.trailingPE != null ? row.trailingPE.toFixed(1) : "—"}
      </td>

      {/* Forward P/E */}
      <td className="px-2 py-2 text-center font-mono text-[13px] text-white/60">
        {row.forwardPE != null ? row.forwardPE.toFixed(1) : "—"}
      </td>

      {/* Price / Change */}
      <td className="px-2 py-2 text-right">
        <p className="font-mono text-[15px] font-medium text-white/90">
          {row.last != null ? `$${row.last.toFixed(2)}` : "—"}
        </p>
        <p
          className={`mt-0.5 font-mono text-[13px] ${
            isUp ? "text-green" : "text-red"
          }`}
        >
          {row.changePct != null
            ? `${isUp ? "+" : ""}${row.changePct.toFixed(2)}%`
            : "—"}
        </p>
      </td>

      {/* 52W H/L */}
      <td className="px-2 py-2 text-center">
        {row.week52High != null || row.week52Low != null ? (
          <div className="font-mono text-[12px] leading-relaxed text-white/50">
            <span className="text-white/25">H</span>{" "}
            {row.week52High != null ? `$${row.week52High.toFixed(2)}` : "—"}
            <span className="mx-1 text-white/15">|</span>
            <span className="text-white/25">L</span>{" "}
            {row.week52Low != null ? `$${row.week52Low.toFixed(2)}` : "—"}
          </div>
        ) : (
          <span className="font-mono text-[10px] text-white/25">—</span>
        )}
      </td>

      {/* Technical Score columns — one per visible timeframe */}
      {visibleTfs.map((tf) => (
        <td key={tf} className="px-1 py-2" align="center">
          <CircularGauge score={getTechScoreForTf(row, tf)} size={36} />
        </td>
      ))}

      {/* Verdict */}
      <td className="px-2 py-2" align="center">
        <span
          className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[12px] font-semibold tracking-wide ${verdict.cls}`}
        >
          {verdict.label}
        </span>
      </td>
    </tr>
  );
});

// ── Main Component ───────────────────────────────────────────────────

export default function ScreenerPage() {
  const { sidecarPort } = useTws();
  const { symbols: watchlistSymbols } = useWatchlist();

  // Data
  const [tiles, setTiles] = useState<HeatmapTile[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & sorting
  const [filter, setFilter] = useState<FilterType>("all");
  const [visibleTfs, setVisibleTfs] = useState<TaScoreTimeframe[]>(loadStoredVisibleTimeframes);
  const [sortKey, setSortKey] = useState<SortKey>("verdict");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const [customSymbols, setCustomSymbols] = useState<string[]>(loadStoredCustomSymbols);
  const [customDraft, setCustomDraft] = useState("");

  // Virtual scroll
  const [visibleCount, setVisibleCount] = useState(VISIBLE_BATCH);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Data fetching ────────────────────────────────────────────────

  useEffect(() => {
    if (!sidecarPort) return;
    let cancelled = false;

    async function fetchTiles() {
      try {
        const url =
          filter === "custom"
            ? `http://127.0.0.1:${sidecarPort}/heatmap/custom?symbols=${encodeURIComponent(
                customSymbols.join(","),
              )}`
            : `http://127.0.0.1:${sidecarPort}/heatmap/sp500`;
        const res = await fetch(url);
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        setTiles((payload.tiles as HeatmapTile[]) ?? []);
        setLoading(false);
      } catch {
        // transient
      }
    }

    fetchTiles();
    const id = setInterval(fetchTiles, DATA_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sidecarPort, filter, customSymbols]);

  useEffect(() => {
    if (!sidecarPort || filter !== "custom" || customSymbols.length === 0) return;
    fetch(`http://127.0.0.1:${sidecarPort}/active-symbols`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: customSymbols }),
    }).catch(() => {});
  }, [sidecarPort, filter, customSymbols]);

  const symbolsForScores = useMemo(() => {
    if (filter === "custom") return customSymbols;
    if (filter === "watchlist") return watchlistSymbols;
    return tiles.map((tile) => tile.symbol);
  }, [customSymbols, filter, tiles, watchlistSymbols]);
  const technicals = useTechScores(symbolsForScores, ALL_TIMEFRAMES);

  // ── Click outside to close search ────────────────────────────────

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        searchRef.current &&
        !searchRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── IntersectionObserver for virtual scroll ──────────────────────

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((prev) => prev + VISIBLE_BATCH);
        }
      },
      { rootMargin: "400px 0px", threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // ── Search suggestions ───────────────────────────────────────────

  const searchSuggestions = useMemo(() => {
    if (!searchQuery || searchQuery.length < 1) return [];
    return filterRankSymbolSearch(SEARCHABLE_SYMBOLS, searchQuery, { limit: 8 });
  }, [searchQuery]);

  // ── Resolve tech score for a row at a specific timeframe ─────────

  const getTechScoreForTf = useCallback(
    (row: ScreenerRow, tf: TaScoreTimeframe): number | null => {
      const detailed = technicals.get(row.symbol);
      if (detailed) {
        const val = detailed.get(tf)?.score;
        if (val !== null && val !== undefined) return val;
      }
      if (tf === "1d") return row.techScore1d;
      if (tf === "1w") return row.techScore1w;
      return null;
    },
    [technicals],
  );

  // ── Compute verdict score: average of all visible TF scores ──────

  const getVerdictScore = useCallback(
    (row: ScreenerRow): number | null => {
      const scores: number[] = [];
      for (const tf of visibleTfs) {
        const s = getTechScoreForTf(row, tf);
        if (s !== null) scores.push(s);
      }
      if (scores.length === 0) return null;
      return scores.reduce((a, b) => a + b, 0) / scores.length;
    },
    [visibleTfs, getTechScoreForTf],
  );

  // ── Merge tiles into ScreenerRows ────────────────────────────────

  const rows: ScreenerRow[] = useMemo(
    () =>
      tiles.map((t) => ({
        ...t,
        techScores: {
          "1m": technicals.get(t.symbol)?.get("1m")?.score ?? null,
          "5m": technicals.get(t.symbol)?.get("5m")?.score ?? null,
          "15m": technicals.get(t.symbol)?.get("15m")?.score ?? null,
          "1h": technicals.get(t.symbol)?.get("1h")?.score ?? null,
          "1d": technicals.get(t.symbol)?.get("1d")?.score ?? t.techScore1d ?? null,
          "1w": technicals.get(t.symbol)?.get("1w")?.score ?? t.techScore1w ?? null,
        },
      })),
    [tiles, technicals],
  );

  // ── Filter & Sort ────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let base = rows;

    if (selectedSymbol) {
      return base.filter((r) => r.symbol === selectedSymbol);
    }

    if (filter === "watchlist") {
      const wl = new Set(watchlistSymbols);
      base = base.filter((r) => wl.has(r.symbol));
    } else if (filter === "mag7") {
      base = base.filter((r) => MAG7.includes(r.symbol));
    } else if (filter === "movers") {
      base = base.filter((r) => Math.abs(r.changePct ?? 0) > 3);
    } else if (filter === "bullish") {
      base = base.filter((r) => {
        const score = getVerdictScore(r);
        return score !== null && score > 60;
      });
    } else if (filter === "bearish") {
      base = base.filter((r) => {
        const score = getVerdictScore(r);
        return score !== null && score < 40;
      });
    }

    const dir = sortDir === "asc" ? 1 : -1;
    base = [...base].sort((a, b) => {
      let va: number, vb: number;

      if (sortKey === "symbol") {
        return a.symbol.localeCompare(b.symbol) * dir;
      }
      if (sortKey === "mcap") {
        va = a.marketCap ?? 0;
        vb = b.marketCap ?? 0;
        return (va - vb) * dir;
      }
      if (sortKey === "pe") {
        va = a.trailingPE ?? -999999;
        vb = b.trailingPE ?? -999999;
        return (va - vb) * dir;
      }
      if (sortKey === "fpe") {
        va = a.forwardPE ?? -999999;
        vb = b.forwardPE ?? -999999;
        return (va - vb) * dir;
      }
      if (sortKey === "change") {
        va = a.changePct ?? 0;
        vb = b.changePct ?? 0;
        return (va - vb) * dir;
      }
      if (sortKey === "verdict") {
        va = getVerdictScore(a) ?? -1;
        vb = getVerdictScore(b) ?? -1;
        return (va - vb) * dir;
      }
      // tech_<tf> sort keys
      if (sortKey.startsWith("tech_")) {
        const tf = sortKey.slice(5) as TaScoreTimeframe;
        va = getTechScoreForTf(a, tf) ?? -1;
        vb = getTechScoreForTf(b, tf) ?? -1;
        return (va - vb) * dir;
      }
      return 0;
    });

    return base;
  }, [
    rows,
    selectedSymbol,
    filter,
    watchlistSymbols,
    sortKey,
    sortDir,
    getVerdictScore,
    getTechScoreForTf,
  ]);

  const visibleRows = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  // ── Handlers ─────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const toggleTf = (tf: TaScoreTimeframe) => {
    setVisibleTfs((prev) => {
      if (prev.includes(tf)) {
        if (prev.length <= 1) return prev;
        return prev.filter((t) => t !== tf);
      }
      const next = [...prev, tf];
      next.sort((a, b) => ALL_TIMEFRAMES.indexOf(a) - ALL_TIMEFRAMES.indexOf(b));
      return next;
    });
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSelectedSymbol(null);
    setSearchOpen(false);
  };

  useEffect(() => {
    if (filter === "custom") {
      setCustomDraft(customSymbols.join(", "));
    }
  }, [filter, customSymbols]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SCREENER_VISIBLE_TFS_STORAGE_KEY,
        JSON.stringify(visibleTfs),
      );
    } catch {
      /* ignore */
    }
  }, [visibleTfs]);

  // Reset visible count when filter/sort changes
  useEffect(() => {
    setVisibleCount(VISIBLE_BATCH);
  }, [filter, sortKey, sortDir, selectedSymbol, customSymbols]);

  const applyCustomUniverse = useCallback(() => {
    const next = parseSymbolsFromInput(customDraft);
    setCustomSymbols(next);
    try {
      localStorage.setItem(SCREENER_CUSTOM_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setSelectedSymbol(null);
    setVisibleCount(VISIBLE_BATCH);
  }, [customDraft]);

  const clearCustomUniverse = useCallback(() => {
    setCustomDraft("");
    setCustomSymbols([]);
    try {
      localStorage.removeItem(SCREENER_CUSTOM_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setSelectedSymbol(null);
    setVisibleCount(VISIBLE_BATCH);
  }, []);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-base px-3 py-3 text-white">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-white/[0.06] bg-panel shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {/* Header bar */}
        <div className="shrink-0 border-b border-white/[0.06] bg-[linear-gradient(180deg,#141922_0%,#10151C_100%)]">
          <div className="flex h-11 items-center justify-between px-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[15px] font-semibold uppercase tracking-[0.18em] text-white">
              Market Screener
            </span>
            <span className="font-mono text-[13px] text-white/50">
              {loading ? "Loading..." : `${filtered.length} symbols`}
            </span>
          </div>

          {/* Search */}
          <div className="relative" ref={searchRef}>
            <div className="flex items-center">
              <input
                type="text"
                placeholder="Search symbol..."
                className="h-8 w-52 rounded-input border border-white/[0.08] bg-white/[0.04] px-3 font-mono text-[13px] text-white/80 placeholder:text-white/20 focus:border-blue/40 focus:outline-none"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (selectedSymbol) setSelectedSymbol(null);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") clearSearch();
                  if (
                    e.key === "Enter" &&
                    searchSuggestions.length > 0
                  ) {
                    setSelectedSymbol(searchSuggestions[0].symbol);
                    setSearchQuery(searchSuggestions[0].symbol);
                    setSearchOpen(false);
                  }
                }}
              />
              {searchQuery && (
                <button
                  onClick={clearSearch}
                  className="ml-1 text-[13px] text-white/30 hover:text-white/60"
                >
                  ✕
                </button>
              )}
            </div>

            {searchOpen && searchSuggestions.length > 0 && (
              <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded border border-white/[0.08] bg-panel shadow-xl">
                {searchSuggestions.map((s) => (
                  <button
                    key={s.symbol}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
                    onClick={() => {
                      setSelectedSymbol(s.symbol);
                      setSearchQuery(s.symbol);
                      setSearchOpen(false);
                    }}
                  >
                    <span className="font-mono text-[13px] font-semibold text-white/80">
                      {s.symbol}
                    </span>
                    <span className="truncate text-[12px] text-white/35">
                      {s.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

          {/* Filters row */}
          <div className="flex items-center gap-2 border-t border-white/[0.06] bg-[#0f141b] px-3 py-1.5">
          {/* Category pills */}
          <div className="flex items-center gap-1">
            {(
              [
                ["all", "All"],
                ["watchlist", "Watchlist"],
                ["custom", "Custom"],
                ["mag7", "MAG 7"],
                ["movers", "Big Movers"],
                ["bullish", "Bullish"],
                ["bearish", "Bearish"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setFilter(key);
                  if (key === "movers") handleSort("change");
                }}
                className={`rounded-btn border border-transparent px-3 py-1 font-mono text-[12px] font-medium tracking-wide transition-colors ${
                  filter === key
                    ? "border-blue-400/30 bg-blue-400/[0.12] text-blue-400"
                    : "text-white/72 hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mx-2 h-3 w-px bg-white/[0.08]" />

          {/* Tech timeframe multi-toggle */}
          <div className="flex items-center gap-1">
            <span className="mr-1 text-[11px] uppercase tracking-[0.14em] text-white/50">
              Columns
            </span>
            {SCREENER_TIMEFRAMES.map((tf) => {
              const active = visibleTfs.includes(tf);
              return (
                <button
                  key={tf}
                  onClick={() => toggleTf(tf)}
                  className={`rounded-btn border border-transparent px-2.5 py-1 font-mono text-[12px] font-medium transition-colors ${
                    active
                      ? "border-blue-400/30 bg-blue-400/[0.12] text-blue-400"
                      : "text-white/72 hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  {TA_SCORE_TF_LABELS[tf]}
                </button>
              );
            })}
          </div>
          </div>

          {filter === "custom" && (
            <div className="flex flex-col gap-1.5 border-t border-white/[0.06] bg-[#101722] px-3 py-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">
              Custom universe — comma, space, or newline (max {CUSTOM_SYMBOL_INPUT_LIMIT})
            </span>
            <div className="flex items-start gap-2">
              <textarea
                rows={2}
                spellCheck={false}
                className="min-h-[60px] flex-1 resize-y rounded-input border border-white/[0.08] bg-white/[0.04] px-3 py-2 font-mono text-[13px] text-white/80 placeholder:text-white/20 focus:border-blue/40 focus:outline-none"
                placeholder="e.g. AAPL, MSFT, NVDA, SPY"
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    applyCustomUniverse();
                  }
                }}
              />
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={applyCustomUniverse}
                  className="rounded-btn bg-blue/20 px-3 py-1.5 font-mono text-[12px] font-medium text-blue transition-colors hover:bg-blue/30"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={clearCustomUniverse}
                  className="rounded-btn px-3 py-1.5 font-mono text-[12px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                >
                  Clear
                </button>
              </div>
            </div>
            <p className="font-mono text-[11px] text-white/25">
              Symbols register with the data worker for quotes; rows show pending until data arrives.
            </p>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto scrollbar-dark">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-[#131925]">
              <tr className="border-b border-white/[0.06]">
              <th
                className="w-[200px] min-w-[200px] cursor-pointer px-3 py-2 text-left"
                onClick={() => handleSort("symbol")}
              >
                <span className="flex items-center font-mono text-[12px] uppercase tracking-[0.14em] text-white">
                  Symbol
                  <SortArrow active={sortKey === "symbol"} dir={sortDir} />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-center"
                onClick={() => handleSort("mcap")}
              >
                <span className="inline-flex items-center font-mono text-[12px] uppercase tracking-[0.14em] text-white">
                  Mkt Cap
                  <SortArrow active={sortKey === "mcap"} dir={sortDir} />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-center"
                onClick={() => handleSort("pe")}
              >
                <span className="inline-flex items-center font-mono text-[12px] uppercase tracking-[0.14em] text-white">
                  P/E
                  <SortArrow active={sortKey === "pe"} dir={sortDir} />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-center"
                onClick={() => handleSort("fpe")}
              >
                <span className="inline-flex items-center font-mono text-[12px] uppercase tracking-[0.14em] text-white">
                  Fwd P/E
                  <SortArrow active={sortKey === "fpe"} dir={sortDir} />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right"
                onClick={() => handleSort("change")}
              >
                <span className="inline-flex items-center font-mono text-[12px] uppercase tracking-[0.14em] text-white">
                  Price / Chg
                  <SortArrow active={sortKey === "change"} dir={sortDir} />
                </span>
              </th>
              <th className="px-2 py-2 text-center">
                <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-white">
                  52W H / L
                </span>
              </th>

              {/* One column header per visible tech timeframe */}
              {visibleTfs.map((tf) => (
                <th
                  key={tf}
                  className="cursor-pointer px-1 py-2 text-center"
                  onClick={() => handleSort(`tech_${tf}`)}
                >
                  <span className="inline-flex items-center gap-1 font-mono text-[12px] uppercase tracking-[0.14em] text-white">
                    {TA_SCORE_TF_LABELS[tf]}
                    <SortArrow active={sortKey === `tech_${tf}`} dir={sortDir} />
                  </span>
                </th>
              ))}

              <th
                className="cursor-pointer px-2 py-2 text-center"
                onClick={() => handleSort("verdict")}
              >
                <span className="inline-flex items-center font-mono text-[12px] uppercase tracking-[0.14em] text-white">
                  Verdict
                  <SortArrow active={sortKey === "verdict"} dir={sortDir} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 12 }).map((_, i) => (
                  <SkeletonRow key={i} delay={i * 0.04} extraCols={visibleTfs.length} />
                ))
              : visibleRows.map((row) => (
                  <ScreenerTableRow
                    key={row.symbol}
                    row={row}
                    visibleTfs={visibleTfs}
                    getTechScoreForTf={getTechScoreForTf}
                    verdictScore={getVerdictScore(row)}
                  />
                ))}
          </tbody>
          </table>

          {/* Load more */}
          {!loading && visibleRows.length < filtered.length && (
            <div className="border-t border-white/[0.06] bg-[#10151C] py-3 text-center">
              <button
                onClick={() => setVisibleCount((p) => p + VISIBLE_BATCH)}
                className="rounded-btn border border-white/[0.08] bg-white/[0.02] px-4 py-1.5 font-mono text-[12px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
              >
                Load More ({filtered.length - visibleRows.length} remaining)
              </button>
            </div>
          )}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {!loading && filtered.length === 0 && (
            <div className="flex h-40 items-center justify-center px-4 text-center">
              <p className="font-mono text-[13px] text-white/24">
                {selectedSymbol
                  ? `No data for ${selectedSymbol}`
                  : filter === "custom" && customSymbols.length === 0
                    ? "Add tickers above and click Apply to run a custom screener."
                    : "No symbols match the current filter."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

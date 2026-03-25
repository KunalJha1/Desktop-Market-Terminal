import { useEffect, useMemo, useRef, useState, memo } from "react";
import { X } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import CircularGauge from "./CircularGauge";
import { useTws } from "../lib/tws";
import { useWatchlist } from "../lib/watchlist";
import { LOGO_SYMBOLS } from "../lib/logo-symbols";
import type { HeatmapTile } from "../lib/heatmap-utils";
import { formatMarketCap } from "../lib/market-data";
import { linkBus } from "../lib/link-bus";

const DATA_POLL_MS = 5_000;
const SCORE_POLL_MS = 60_000;
const ROW_HEIGHT = 40;

interface TechScores {
  "1d": number | null;
  "1w": number | null;
  [key: string]: number | null;
}

interface ScreenerRow extends HeatmapTile {
  techScore: number | null;
}

type SortKey = "symbol" | "price" | "mcap" | "fpe" | "score" | "change";

function verdictScore(score: number | null): number {
  return score ?? -1;
}

function getVerdict(score: number | null): { label: string; cls: string } {
  if (score == null) return { label: "N/A", cls: "text-white/30" };
  if (score >= 75) return { label: "STRONG BUY", cls: "text-green bg-green/10" };
  if (score >= 60) return { label: "BUY", cls: "text-green/80 bg-green/[0.06]" };
  if (score >= 40) return { label: "NEUTRAL", cls: "text-amber bg-amber/10" };
  if (score >= 25) return { label: "SELL", cls: "text-red/80 bg-red/[0.06]" };
  return { label: "STRONG SELL", cls: "text-red bg-red/10" };
}

const SymbolLogo = memo(function SymbolLogo({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  const upper = symbol.toUpperCase();

  if (failed || !LOGO_SYMBOLS.has(upper)) {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] font-mono text-[8px] font-semibold text-white/50">
        {upper.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={`/dailyiq-brand-resources/logosvg/${upper}.svg`}
      alt={upper}
      className="h-6 w-6 shrink-0 rounded-full object-contain"
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

export default function MiniScreenerCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  onSymbolSelect,
}: MiniScreenerCardProps) {
  const { sidecarPort } = useTws();
  const { symbols: watchlistSymbols } = useWatchlist();

  const [tiles, setTiles] = useState<HeatmapTile[]>([]);
  const [techScoresMap, setTechScoresMap] = useState<Map<string, TechScores>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // Fetch heatmap tiles
  useEffect(() => {
    if (!sidecarPort) return;
    let cancelled = false;

    async function fetchTiles() {
      try {
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/heatmap/sp500`);
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        setTiles((payload.tiles as HeatmapTile[]) ?? []);
      } catch { /* ignore */ }
    }

    fetchTiles();
    const id = setInterval(fetchTiles, DATA_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [sidecarPort]);

  // Fetch detailed tech scores for watchlist symbols
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
      } catch { /* ignore */ }
    }

    fetchScores();
    const id = setInterval(fetchScores, SCORE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [sidecarPort, watchlistSymbols]);

  const rows = useMemo(() => {
    const enriched: ScreenerRow[] = tiles.map((t) => {
      const detailed = techScoresMap.get(t.symbol);
      const score = detailed?.["1d"] ?? t.techScore1d ?? null;
      return { ...t, techScore: score };
    });

    const dir = sortDir === "asc" ? 1 : -1;
    enriched.sort((a, b) => {
      let va: number, vb: number;
      switch (sortKey) {
        case "symbol":
          return a.symbol.localeCompare(b.symbol) * dir;
        case "price":
          va = a.last ?? 0;
          vb = b.last ?? 0;
          return (va - vb) * dir;
        case "change":
          va = a.changePct ?? 0;
          vb = b.changePct ?? 0;
          return (va - vb) * dir;
        case "mcap":
          va = a.marketCap ?? 0;
          vb = b.marketCap ?? 0;
          return (va - vb) * dir;
        case "fpe":
          va = a.forwardPE ?? -999999;
          vb = b.forwardPE ?? -999999;
          return (va - vb) * dir;
        case "score":
        default:
          va = verdictScore(a.techScore);
          vb = verdictScore(b.techScore);
          return (va - vb) * dir;
      }
    });

    return enriched;
  }, [tiles, techScoresMap, sortKey, sortDir]);

  return (
    <div className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel">
      {/* Header */}
      <div
        className="flex h-7 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-white/70">
            Screener
          </span>
          <span className="font-mono text-[10px] text-white/25">
            {tiles.length > 0 ? `${rows.length}/${tiles.length}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ComponentLinkMenu linkChannel={linkChannel} onSetLinkChannel={onSetLinkChannel} />
          <button
            onClick={onClose}
            className="rounded-sm p-0.5 text-white/70 transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
          >
            <X className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Table header */}
      <div className="flex shrink-0 items-center border-b border-white/[0.04] bg-[#0d0f13]/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-white">
        <span className="min-w-0 flex-[2.5] cursor-pointer select-none pl-0.5 transition-colors hover:text-white/60" onClick={() => handleSort("symbol")}>
          Symbol{sortKey === "symbol" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
        </span>
        <span className="w-[5.5rem] shrink-0 cursor-pointer select-none text-right transition-colors hover:text-white/60" onClick={() => handleSort("price")}>
          Price{sortKey === "price" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
        </span>
        <span className="w-[5.25rem] shrink-0 cursor-pointer select-none text-right transition-colors hover:text-white/60" onClick={() => handleSort("mcap")}>
          Mkt Cap{sortKey === "mcap" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
        </span>
        <span className="w-[4.25rem] shrink-0 cursor-pointer select-none text-right transition-colors hover:text-white/60" onClick={() => handleSort("fpe")}>
          Fwd P/E{sortKey === "fpe" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
        </span>
        <span className="w-14 shrink-0 cursor-pointer select-none text-center transition-colors hover:text-white/60" onClick={() => handleSort("score")}>
          1D{sortKey === "score" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
        </span>
        <span className="w-[5.5rem] shrink-0 cursor-pointer select-none text-center transition-colors hover:text-white/60" onClick={() => handleSort("score")}>
          Verdict{sortKey === "score" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
        </span>
      </div>

      {/* Rows */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
        {tiles.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-white/20">
            Loading...
          </div>
        ) : (
          rows.map((row) => {
            const isUp = (row.changePct ?? 0) >= 0;
            const verdict = getVerdict(row.techScore);
            return (
              <div
                key={row.symbol}
                className="flex cursor-pointer items-center border-b border-white/[0.03] px-3 transition-colors duration-75 hover:bg-white/[0.06]"
                style={{ height: ROW_HEIGHT }}
                onClick={() => {
                  if (linkChannel) linkBus.publish(linkChannel, row.symbol);
                  onSymbolSelect?.(row.symbol);
                }}
              >
                {/* Symbol */}
                <div className="flex min-w-0 flex-[2.5] items-center gap-2 overflow-hidden">
                  <SymbolLogo symbol={row.symbol} />
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] font-semibold leading-tight text-white/90">
                      {row.symbol}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] leading-tight text-white/30">
                      {row.name}
                    </p>
                  </div>
                </div>

                {/* Price / Change */}
                <div className="w-[5.5rem] shrink-0 text-right">
                  <p className="font-mono text-[11px] font-medium leading-tight text-white/80">
                    {row.last != null ? `$${row.last.toFixed(2)}` : "\u2014"}
                  </p>
                  <p className={`mt-0.5 font-mono text-[9px] leading-tight ${isUp ? "text-green" : "text-red"}`}>
                    {row.changePct != null ? `${isUp ? "+" : ""}${row.changePct.toFixed(2)}%` : "\u2014"}
                  </p>
                </div>

                {/* Mkt Cap */}
                <div className="w-[5.25rem] shrink-0 text-right font-mono text-[10px] leading-tight text-white/50">
                  {formatMarketCap(row.marketCap)}
                </div>

                {/* Fwd P/E */}
                <div className="w-[4.25rem] shrink-0 text-right font-mono text-[10px] leading-tight text-white/50">
                  {row.forwardPE != null ? row.forwardPE.toFixed(1) : "\u2014"}
                </div>

                {/* Tech Score gauge */}
                <div className="flex w-14 shrink-0 justify-center">
                  <CircularGauge score={row.techScore} size={28} />
                </div>

                {/* Verdict pill */}
                <div className="flex w-[5.5rem] shrink-0 justify-center px-0.5">
                  <span
                    className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-center font-mono text-[9px] font-semibold leading-tight ${verdict.cls}`}
                  >
                    {verdict.label}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

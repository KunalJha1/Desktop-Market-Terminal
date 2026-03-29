import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Search } from "lucide-react";
import CircularGauge from "./CircularGauge";
import {
  SEARCHABLE_SYMBOLS,
  filterRankSymbolSearch,
} from "../lib/market-data";
import { LOGO_SYMBOLS } from "../lib/logo-symbols";
import { useWatchlistData } from "../lib/use-market-data";
import { describeTechScoreCell, useTechScores } from "../lib/use-technicals";

interface SymbolSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSymbol: (symbol: string) => void;
  excludeSymbol?: string;
  title?: string;
  subtitle?: string;
}

function SymbolBall({ symbol }: { symbol: string }) {
  const upper = symbol.toUpperCase();
  const [failed, setFailed] = useState(false);

  if (failed || !LOGO_SYMBOLS.has(upper)) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] font-mono text-[10px] font-semibold text-white/60">
        {upper.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={`/dailyiq-brand-resources/logosvg/${upper}.svg`}
      alt={upper}
      className="h-8 w-8 shrink-0 rounded-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}

export default function SymbolSearchModal({
  isOpen,
  onClose,
  onSelectSymbol,
  excludeSymbol = "",
  title = "Quote Search",
  subtitle = "Enter ticker you want to search for",
}: SymbolSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        setSearchQuery("");
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const filtered = searchQuery.trim()
    ? filterRankSymbolSearch(SEARCHABLE_SYMBOLS, searchQuery, {
        limit: 24,
        excludeSymbol: excludeSymbol || undefined,
      })
    : SEARCHABLE_SYMBOLS.filter((s) => s.symbol !== excludeSymbol).slice(0, 24);

  const techScores = useTechScores(
    filtered.map((s) => s.symbol),
    ["1d"],
  );
  const { quotes: searchQuotes } = useWatchlistData(filtered.map((s) => s.symbol));

  const handleSelectSymbol = (symbol: string) => {
    onSelectSymbol(symbol);
    onClose();
    setSearchQuery("");
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[#020409]/50 p-5 backdrop-blur-[5px]">
      <div
        className="absolute inset-0"
        onClick={() => {
          onClose();
          setSearchQuery("");
        }}
      />
      <div className="relative z-[221] flex h-[min(64vh,640px)] w-[min(58vw,980px)] min-w-[680px] max-w-[980px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d1117] shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between border-b border-white/[0.08] bg-[#0f141b] px-5 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8FCBFF]">
              {title}
            </p>
            <h2 className="mt-1.5 text-[21px] font-semibold tracking-tight text-white">
              {subtitle}
            </h2>
          </div>
          <button
            onClick={() => {
              onClose();
              setSearchQuery("");
            }}
            className="rounded-md border border-white/[0.08] p-2 text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white"
            aria-label="Close search"
          >
            <X className="h-4 w-4" strokeWidth={1.6} />
          </button>
        </div>

        <div className="border-b border-white/[0.06] px-5 py-3">
          <div className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-[#090d12] px-4 py-2.5 shadow-inner shadow-black/20">
            <Search className="h-4 w-4 text-white/30" strokeWidth={1.8} />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchQuery.trim()) {
                  const sym = filtered.length > 0 ? filtered[0].symbol : searchQuery.trim().toUpperCase();
                  handleSelectSymbol(sym);
                }
              }}
              placeholder="AAPL, NVDA, TSLA..."
              className="w-full bg-transparent font-mono text-[14px] text-white/85 placeholder:text-white/20 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-[78px_104px_minmax(0,1fr)_116px_132px] gap-3 border-b border-white/[0.06] bg-white/[0.02] px-5 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-white/34">
          <span>Logo</span>
          <span>Ticker</span>
          <span>Symbol Name</span>
          <span className="text-center">Last Change</span>
          <span className="text-center">Technical Score 1D</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {filtered.map((s) => {
            const techCell = techScores.get(s.symbol)?.get("1d") ?? null;
            const score = techCell?.score ?? null;
            const liveQuote = searchQuotes.get(s.symbol) ?? null;
            const changePct = liveQuote?.changePct ?? null;
            const isPositiveChange = (changePct ?? 0) >= 0;
            return (
              <button
                key={s.symbol}
                onClick={() => handleSelectSymbol(s.symbol)}
                className="grid w-full grid-cols-[78px_104px_minmax(0,1fr)_116px_132px] items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-75 hover:bg-white/[0.05]"
              >
                <div className="flex items-center justify-center">
                  <SymbolBall symbol={s.symbol} />
                </div>
                <span className="font-mono text-[13px] font-semibold text-white/88">
                  {s.symbol}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-white/78">{s.name}</p>
                  {"sector" in s && typeof s.sector === "string" && s.sector ? (
                    <p className="mt-1 truncate text-[10px] uppercase tracking-[0.16em] text-white/25">
                      {s.sector}
                    </p>
                  ) : null}
                </div>
                <div className="text-center">
                  <span
                    className={`font-mono text-[12px] font-medium ${
                      changePct == null
                        ? "text-white/25"
                        : isPositiveChange
                          ? "text-green"
                          : "text-red"
                    }`}
                  >
                    {changePct == null
                      ? "—"
                      : `${isPositiveChange ? "+" : ""}${changePct.toFixed(2)}%`}
                  </span>
                </div>
                <div className="flex items-center justify-center" title={describeTechScoreCell("1d", techCell)}>
                  <CircularGauge score={score} size={36} />
                </div>
              </button>
            );
          })}

          {searchQuery.trim().length >= 1 &&
            !SEARCHABLE_SYMBOLS.some((s) => s.symbol === searchQuery.trim().toUpperCase()) && (
              <button
                onClick={() => handleSelectSymbol(searchQuery.trim().toUpperCase())}
                className="mt-2 flex w-full items-center gap-3 rounded-lg border border-dashed border-white/[0.08] px-4 py-3 text-left transition-colors duration-75 hover:bg-white/[0.04]"
              >
                <Search className="h-4 w-4 text-white/35" strokeWidth={1.6} />
                <span className="font-mono text-[12px] text-white/65">
                  Use "{searchQuery.trim().toUpperCase()}"
                </span>
              </button>
            )}

          {filtered.length === 0 && searchQuery.trim().length === 0 && (
            <p className="px-3 py-6 text-center font-mono text-[12px] text-white/25">
              No other symbols
            </p>
          )}

          {filtered.length === 0 && searchQuery.trim().length > 0 && (
            <p className="px-3 py-6 text-center font-mono text-[12px] text-white/25">
              No matching symbols found
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X, Search, TrendingUp, TrendingDown } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import CircularGauge from "./CircularGauge";
import { getChannelById } from "../lib/link-channels";
import { linkBus } from "../lib/link-bus";
import {
  SEARCHABLE_SYMBOLS,
  formatPrice,
  formatVolume,
  formatMarketCap,
  filterRankSymbolSearch,
} from "../lib/market-data";
import { useQuoteData, useWatchlistData } from "../lib/use-market-data";
import { describeTechScoreCell, useTechScores } from "../lib/use-technicals";
import { LOGO_SYMBOLS } from "../lib/logo-symbols";

const COMPACT_QUOTE_MIN_BODY_HEIGHT = 180;
const COMPACT_QUOTE_MIN_WIDTH = 300;

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

interface QuoteCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

export default function QuoteCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  config,
  onConfigChange,
}: QuoteCardProps) {
  const symbol = typeof config.symbol === "string" ? config.symbol.trim().toUpperCase() : "";
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const quoteId = useId();
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (searchOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setBodySize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Subscribe to link channel so watchlist symbol changes update this card
  useEffect(() => {
    if (!linkChannel) return;
    return linkBus.subscribe(linkChannel, (sym) => {
      onConfigChange({ ...config, symbol: sym });
    });
  }, [linkChannel, config, onConfigChange]);

  const quote = useQuoteData(quoteId, symbol);
  const isPositive = quote ? quote.change >= 0 : true;

  const filtered = searchQuery.trim()
    ? filterRankSymbolSearch(SEARCHABLE_SYMBOLS, searchQuery, {
        limit: 24,
        excludeSymbol: symbol,
      })
    : SEARCHABLE_SYMBOLS.filter((s) => s.symbol !== symbol).slice(0, 24);
  const techScores = useTechScores(
    filtered.map((s) => s.symbol),
    ["1d"],
  );
  const { quotes: searchQuotes } = useWatchlistData(filtered.map((s) => s.symbol));

  const channelInfo = getChannelById(linkChannel);
  const isHorizontalBias = bodySize.width >= COMPACT_QUOTE_MIN_WIDTH && bodySize.width > bodySize.height * 1.15;
  const compactQuoteStrip = isHorizontalBias && bodySize.height <= COMPACT_QUOTE_MIN_BODY_HEIGHT;
  const metricCellClassName = compactQuoteStrip
    ? "flex min-w-0 flex-1 flex-col justify-center px-1.5 py-0.5"
    : "flex min-w-0 flex-1 flex-col justify-center rounded-sm border px-2 py-1.5";
  const metricLabelClassName = compactQuoteStrip
    ? "text-[8px] font-semibold uppercase tracking-[0.18em]"
    : "text-[9px] font-semibold uppercase tracking-wider";
  const metricValueClassName = compactQuoteStrip
    ? "truncate font-mono text-[11px] font-semibold"
    : "truncate font-mono text-[13px] font-semibold";
  const metricEmptyClassName = compactQuoteStrip
    ? "font-mono text-[10px] text-white/20"
    : "font-mono text-[11px] text-white/20";

  const commitSymbol = (nextSymbol: string) => {
    onConfigChange({ ...config, symbol: nextSymbol });
    if (linkChannel) {
      linkBus.publish(linkChannel, nextSymbol);
    }
  };

  useEffect(() => {
    if (!searchOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setSearchQuery("");
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-none border border-white/[0.06] bg-panel"
    >
      {/* Header bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2">
        <div className="flex items-center gap-1.5">
          {/* Search toggle */}
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className="flex items-center gap-1 rounded-sm p-0.5 text-white/70 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white"
          >
            <Search className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
          <span className="font-mono text-[11px] font-medium text-white/80">
            {symbol}
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
            className="rounded-sm p-0.5 text-white/70 transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
          >
            <X className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        className={`flex flex-1 overflow-hidden ${
          compactQuoteStrip ? "flex-row items-stretch gap-4 px-4 py-2" : "flex-col gap-4 p-4"
        }`}
      >
        {quote ? (
          <>
            {/* Last price + change */}
            <div className={compactQuoteStrip ? "flex shrink-0 flex-col justify-center" : "shrink-0"}>
              <p className="mb-1 text-[8px] uppercase tracking-wider text-white/30">
                Last Price
              </p>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={`font-mono font-bold tracking-tight text-white/90 ${compactQuoteStrip ? "text-[18px]" : "text-[22px]"}`}>
                  {formatPrice(quote.last)}
                </span>
                <span
                  className={`flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                    isPositive
                      ? "bg-green/10 text-green"
                      : "bg-red/10 text-red"
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="h-2.5 w-2.5" strokeWidth={2} />
                  ) : (
                    <TrendingDown className="h-2.5 w-2.5" strokeWidth={2} />
                  )}
                  {isPositive ? "+" : ""}
                  {quote.change.toFixed(2)} ({isPositive ? "+" : ""}
                  {quote.changePct.toFixed(2)}%)
                </span>
              </div>
            </div>

            {/* BID / MID / ASK */}
            <div className={`flex min-w-0 ${
              compactQuoteStrip
                ? "shrink-0 items-center gap-3 border-l border-r border-white/[0.06] px-4"
                : "shrink-0 gap-2"
            }`}>
              <div
                className={`${metricCellClassName} ${
                  compactQuoteStrip ? "" : "border-green/20 bg-green/[0.04]"
                }`}
              >
                <p className={`${metricLabelClassName} text-green/70`}>Bid</p>
                {quote.bid != null ? (
                  <p className={`${metricValueClassName} text-green`}>{formatPrice(quote.bid)}</p>
                ) : (
                  <p className={metricEmptyClassName}>—</p>
                )}
              </div>
              <div
                className={`${metricCellClassName} ${
                  compactQuoteStrip ? "" : "border-blue/20 bg-blue/[0.04]"
                }`}
              >
                <p className={`${metricLabelClassName} text-[#58A6FF]/70`}>Mid</p>
                {quote.mid != null ? (
                  <p className={`${metricValueClassName} text-[#58A6FF]`}>{formatPrice(quote.mid)}</p>
                ) : (
                  <p className={metricEmptyClassName}>—</p>
                )}
              </div>
              <div
                className={`${metricCellClassName} ${
                  compactQuoteStrip ? "" : "border-[#FF1744]/25 bg-[#FF1744]/[0.06]"
                }`}
              >
                <p className={`${metricLabelClassName} text-[#FF1744]/70`}>Ask</p>
                {quote.ask != null ? (
                  <p className={`${metricValueClassName} text-[#FF1744]`}>{formatPrice(quote.ask)}</p>
                ) : (
                  <p className={metricEmptyClassName}>—</p>
                )}
              </div>
            </div>

            {/* Stats grid */}
            <div className={`min-w-0 flex-1 ${
              compactQuoteStrip
                ? "grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-x-4 gap-y-1 content-center"
                : "grid grid-cols-3 gap-x-4 gap-y-3 border-t border-white/[0.06] pt-3"
            }`}>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white">Open</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{formatPrice(quote.open)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white">Hi / Lo</p>
                <p className="font-mono text-[11px] font-medium">
                  <span className="text-green">{formatPrice(quote.high)}</span>
                  <span className="text-white/25"> / </span>
                  <span className="text-red">{formatPrice(quote.low)}</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white">52W H/L</p>
                <p className="font-mono text-[11px] font-medium">
                  <span className="text-green">{quote.week52High != null ? formatPrice(quote.week52High) : "—"}</span>
                  <span className="text-white/25"> / </span>
                  <span className="text-red">{quote.week52Low != null ? formatPrice(quote.week52Low) : "—"}</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white">Prev Close</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{formatPrice(quote.prevClose)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white">Volume</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{formatVolume(quote.volume)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white">Spread</p>
                <p className="font-mono text-[11px] font-medium text-amber">{quote.spread != null ? formatPrice(quote.spread) : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white">P/E (TTM)</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{quote.trailingPE != null ? quote.trailingPE.toFixed(1) : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white">Fwd P/E</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{quote.forwardPE != null ? quote.forwardPE.toFixed(1) : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white">Mkt Cap</p>
                <p className="font-mono text-[11px] font-medium text-[#58A6FF]">{formatMarketCap(quote.marketCap)}</p>
              </div>
            </div>
          </>
        ) : (
          /* No demo data — awaiting TWS connection */
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <p className="font-mono text-[15px] font-semibold text-white/90">
              {symbol}
            </p>
            <div className="flex flex-col items-center gap-1">
              <div className="flex gap-1">
                {Array.from({ length: 3 }, (_, i) => (
                  <div
                    key={i}
                    className="h-1 w-6 animate-pulse rounded-full bg-white/[0.06]"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </div>
              <p className="text-[9px] text-white/20">
                Waiting for TWS connection
              </p>
            </div>
          </div>
        )}
      </div>

      {searchOpen && createPortal(
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[#020409]/50 p-5 backdrop-blur-[5px]">
          <div
            className="absolute inset-0"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
          />
          <div className="relative z-[221] flex h-[min(64vh,640px)] w-[min(58vw,980px)] min-w-[680px] max-w-[980px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d1117] shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between border-b border-white/[0.08] bg-[#0f141b] px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8FCBFF]">
                  Quote Search
                </p>
                <h2 className="mt-1.5 text-[21px] font-semibold tracking-tight text-white">
                  Enter ticker you want to search for
                </h2>
              </div>
              <button
                onClick={() => {
                  setSearchOpen(false);
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
                      commitSymbol(sym);
                      setSearchOpen(false);
                      setSearchQuery("");
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
                    onClick={() => {
                      commitSymbol(s.symbol);
                      setSearchOpen(false);
                      setSearchQuery("");
                    }}
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
                    onClick={() => {
                      commitSymbol(searchQuery.trim().toUpperCase());
                      setSearchOpen(false);
                      setSearchQuery("");
                    }}
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
      )}
    </div>
  );
}

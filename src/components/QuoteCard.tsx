import { useState, useRef, useEffect, useId } from "react";
import { X, Search, TrendingUp, TrendingDown } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import { getChannelById } from "../lib/link-channels";
import { linkBus } from "../lib/link-bus";
import { SEARCHABLE_SYMBOLS, formatPrice, formatVolume, formatMarketCap } from "../lib/market-data";
import { useQuoteData } from "../lib/use-market-data";

const COMPACT_QUOTE_MIN_BODY_HEIGHT = 180;
const COMPACT_QUOTE_MIN_WIDTH = 300;

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
  const symbol = (config.symbol as string) || "AAPL";
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

  const q = searchQuery.toLowerCase();
  const filtered = SEARCHABLE_SYMBOLS.filter(
    (s) =>
      s.symbol !== symbol &&
      (!searchQuery ||
        s.symbol.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q)),
  ).slice(0, 12);

  const channelInfo = getChannelById(linkChannel);
  const isHorizontalBias = bodySize.width >= COMPACT_QUOTE_MIN_WIDTH && bodySize.width > bodySize.height * 1.15;
  const compactQuoteStrip = isHorizontalBias && bodySize.height <= COMPACT_QUOTE_MIN_BODY_HEIGHT;
  const metricCellClassName = compactQuoteStrip
    ? "flex min-w-0 flex-1 flex-col justify-center px-1.5 py-0.5"
    : "flex min-w-0 flex-1 flex-col justify-center rounded-sm border px-2 py-1.5";
  const metricLabelClassName = compactQuoteStrip
    ? "text-[7px] font-medium uppercase tracking-[0.18em]"
    : "text-[8px] font-medium uppercase tracking-wider";
  const metricValueClassName = compactQuoteStrip
    ? "truncate font-mono text-[11px] font-semibold"
    : "truncate font-mono text-[13px] font-semibold";
  const metricEmptyClassName = compactQuoteStrip
    ? "font-mono text-[10px] text-white/20"
    : "font-mono text-[11px] text-white/20";

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-none border border-white/[0.06] bg-panel"
    >
      {/* Header bar */}
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2">
        <div className="flex items-center gap-1.5">
          {/* Search toggle */}
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className="flex items-center gap-1 rounded-sm p-0.5 text-white/30 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/55"
          >
            <Search className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
          <span className="font-mono text-[10px] font-medium text-white/70">
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
            className="rounded-sm p-0.5 text-white/30 transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
          >
            <X className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Search dropdown */}
      {searchOpen && (
        <div className="border-b border-white/[0.06] bg-base px-2 py-1.5">
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
              }
              if (e.key === "Enter" && searchQuery.trim()) {
                const sym = filtered.length > 0 ? filtered[0].symbol : searchQuery.trim().toUpperCase();
                onConfigChange({ ...config, symbol: sym });
                setSearchOpen(false);
                setSearchQuery("");
              }
            }}
            placeholder="Search symbol..."
            className="w-full rounded-sm border border-white/[0.08] bg-[#0D1117] px-2 py-1 font-mono text-[10px] text-white/80 placeholder:text-white/20 focus:border-blue/40 focus:outline-none"
          />
          <div className="mt-1 max-h-[120px] overflow-y-auto">
            {filtered.map((s) => (
              <button
                key={s.symbol}
                onClick={() => {
                  onConfigChange({ ...config, symbol: s.symbol });
                  setSearchOpen(false);
                  setSearchQuery("");
                }}
                className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left font-mono text-[10px] text-white/50 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/80"
              >
                <span className="w-12 shrink-0 font-medium">{s.symbol}</span>
                <span className="truncate font-sans text-[9px] text-white/30">{s.name}</span>
              </button>
            ))}
            {/* Custom symbol option when no exact match */}
            {searchQuery.trim().length >= 1 &&
              !SEARCHABLE_SYMBOLS.some((s) => s.symbol === searchQuery.trim().toUpperCase()) && (
                <button
                  onClick={() => {
                    onConfigChange({
                      ...config,
                      symbol: searchQuery.trim().toUpperCase(),
                    });
                    setSearchOpen(false);
                    setSearchQuery("");
                  }}
                  className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left font-mono text-[10px] text-white/35 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/70"
                >
                  <Search className="h-2 w-2" strokeWidth={1.5} />
                  Use "{searchQuery.trim().toUpperCase()}"
                </button>
              )}
            {filtered.length === 0 && searchQuery.trim().length === 0 && (
              <p className="px-1.5 py-1 text-[10px] text-white/20">
                No other symbols
              </p>
            )}
          </div>
        </div>
      )}

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
                <p className={`${metricLabelClassName} text-green/50`}>Bid</p>
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
                <p className={`${metricLabelClassName} text-blue/50`}>Mid</p>
                {quote.mid != null ? (
                  <p className={`${metricValueClassName} text-blue`}>{formatPrice(quote.mid)}</p>
                ) : (
                  <p className={metricEmptyClassName}>—</p>
                )}
              </div>
              <div
                className={`${metricCellClassName} ${
                  compactQuoteStrip ? "" : "border-red/20 bg-red/[0.04]"
                }`}
              >
                <p className={`${metricLabelClassName} text-red/50`}>Ask</p>
                {quote.ask != null ? (
                  <p className={`${metricValueClassName} text-red`}>{formatPrice(quote.ask)}</p>
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
                <p className="text-[8px] uppercase tracking-wider text-white/30">Open</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{formatPrice(quote.open)}</p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-wider text-white/30">Hi / Lo</p>
                <p className="font-mono text-[11px] font-medium">
                  <span className="text-green">{formatPrice(quote.high)}</span>
                  <span className="text-white/25"> / </span>
                  <span className="text-red">{formatPrice(quote.low)}</span>
                </p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-wider text-white/30">52W H/L</p>
                <p className="font-mono text-[11px] font-medium">
                  <span className="text-green">{quote.week52High != null ? formatPrice(quote.week52High) : "—"}</span>
                  <span className="text-white/25"> / </span>
                  <span className="text-red">{quote.week52Low != null ? formatPrice(quote.week52Low) : "—"}</span>
                </p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-wider text-white/30">Prev Close</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{formatPrice(quote.prevClose)}</p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-wider text-white/30">Volume</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{formatVolume(quote.volume)}</p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-wider text-white/30">Spread</p>
                <p className="font-mono text-[11px] font-medium text-amber">{quote.spread != null ? formatPrice(quote.spread) : "—"}</p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-wider text-white/30">P/E (TTM)</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{quote.trailingPE != null ? quote.trailingPE.toFixed(1) : "—"}</p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-wider text-white/30">Fwd P/E</p>
                <p className="font-mono text-[11px] font-medium text-white/70">{quote.forwardPE != null ? quote.forwardPE.toFixed(1) : "—"}</p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-wider text-white/30">Mkt Cap</p>
                <p className="font-mono text-[11px] font-medium text-blue">{formatMarketCap(quote.marketCap)}</p>
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
    </div>
  );
}

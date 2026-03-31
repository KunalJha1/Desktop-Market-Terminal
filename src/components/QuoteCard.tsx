import { useState, useRef, useEffect, useId, memo } from "react";
import { X, TrendingUp, TrendingDown, Search } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import SymbolSearchModal from "./SymbolSearchModal";
import {
  formatPrice,
  formatMarketCap,
} from "../lib/market-data";
import { useQuoteData } from "../lib/use-market-data";
import { getChannelById } from "../lib/link-channels";
import { linkBus } from "../lib/link-bus";

const COMPACT_QUOTE_MIN_BODY_HEIGHT = 180;
const COMPACT_QUOTE_MIN_WIDTH = 300;

interface QuoteCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

function QuoteCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  config,
  onConfigChange,
}: QuoteCardProps) {
  const symbol = typeof config.symbol === "string" ? config.symbol.trim().toUpperCase() : "";
  const [searchOpen, setSearchOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const quoteId = useId();
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });

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
            className="flex items-center justify-center rounded-sm text-white transition-colors duration-75 hover:bg-white/[0.06] hover:text-white"
            style={{
              width: 16,
              height: 16,
              padding: 0,
              border: "none",
              borderRadius: 2,
              cursor: "pointer",
              backgroundColor: searchOpen ? "rgba(255,255,255,0.06)" : "transparent",
              color: "#FFFFFF",
            }}
          >
            <Search className="h-[13px] w-[13px]" strokeWidth={2} />
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

      <SymbolSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectSymbol={commitSymbol}
        excludeSymbol={symbol}
      />
    </div>
  );
}

export default memo(QuoteCard);

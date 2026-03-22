import { useState, useRef, useEffect, useId } from "react";
import { X, Search, TrendingUp, TrendingDown } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import { getChannelById } from "../lib/link-channels";
import { SEARCHABLE_SYMBOLS, formatPrice, formatVolume } from "../lib/market-data";
import { useQuoteData } from "../lib/use-market-data";

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
  const quoteId = useId();

  useEffect(() => {
    if (searchOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [searchOpen]);

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
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {quote ? (
          <>
            {/* Symbol + Price */}
            <div>
              <p className="text-[9px] uppercase tracking-wider text-white/35">
                Symbol
              </p>
              <p className="font-mono text-[15px] font-semibold text-white/90">
                {quote.symbol}
              </p>
            </div>

            {/* Last price + change — recessed band */}
            <div className="-mx-3 rounded-sm bg-base/40 px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[22px] font-bold tracking-tight text-white/90">
                  {formatPrice(quote.last)}
                </span>
                <span
                  className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-medium ${
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
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-sm border border-green/30 bg-green/[0.04] px-2 py-1.5">
                <p className="text-[8px] font-medium uppercase tracking-wider text-green/60">
                  Bid
                </p>
                <p className="font-mono text-[13px] font-semibold text-green">
                  {formatPrice(quote.bid)}
                </p>
              </div>
              <div className="rounded-sm border border-blue/30 bg-blue/[0.04] px-2 py-1.5">
                <p className="text-[8px] font-medium uppercase tracking-wider text-blue/60">
                  Mid
                </p>
                <p className="font-mono text-[13px] font-semibold text-blue">
                  {formatPrice(quote.mid)}
                </p>
              </div>
              <div className="rounded-sm border border-red/30 bg-red/[0.04] px-2 py-1.5">
                <p className="text-[8px] font-medium uppercase tracking-wider text-red/60">
                  Ask
                </p>
                <p className="font-mono text-[13px] font-semibold text-red">
                  {formatPrice(quote.ask)}
                </p>
              </div>
            </div>

            {/* Stats grid */}
            <div className="border-t border-white/[0.06] pt-2">
              <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                {[
                  { label: "Open", value: formatPrice(quote.open) },
                  { label: "High", value: formatPrice(quote.high), color: "text-green" },
                  { label: "Low", value: formatPrice(quote.low), color: "text-red" },
                  { label: "Prev Close", value: formatPrice(quote.prevClose) },
                  { label: "Volume", value: formatVolume(quote.volume) },
                  {
                    label: "Spread",
                    value: formatPrice(quote.spread),
                    color: "text-amber",
                  },
                ].map((stat) => (
                  <div key={stat.label}>
                    <p className="text-[8px] uppercase tracking-wider text-white/35">
                      {stat.label}
                    </p>
                    <p
                      className={`font-mono text-[11px] font-medium ${stat.color ?? "text-white/70"}`}
                    >
                      {stat.value}
                    </p>
                  </div>
                ))}
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

import { useEffect, useMemo, useState } from "react";
import {
  useDefaultOptionsSymbol,
  useOptionsChain,
  useOptionsSummary,
  useOptionsSymbolSuggestions,
  type OptionSide,
} from "../lib/use-options-data";

function formatPrice(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toFixed(2);
}

function formatIv(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatGreek(value: number | null | undefined, digits = 3): string {
  if (value == null) return "—";
  return value.toFixed(digits);
}

function formatInt(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTimestamp(value: number | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function metricTone(side: OptionSide | null): string {
  if (!side) return "text-white/18";
  if (side.inTheMoney) return "text-emerald-300";
  return "text-white/78";
}

function SideMetrics({
  side,
  align,
}: {
  side: OptionSide | null;
  align: "left" | "right";
}) {
  const base = align === "left" ? "text-right" : "text-left";
  return (
    <div className={`grid grid-cols-8 gap-2 ${base}`}>
      <span className={metricTone(side)}>{formatPrice(side?.bid)}</span>
      <span className={metricTone(side)}>{formatPrice(side?.ask)}</span>
      <span className={metricTone(side)}>{formatPrice(side?.mid)}</span>
      <span className={metricTone(side)}>{formatIv(side?.impliedVolatility)}</span>
      <span className={metricTone(side)}>{formatGreek(side?.delta, 2)}</span>
      <span className={metricTone(side)}>{formatGreek(side?.gamma, 3)}</span>
      <span className={metricTone(side)}>{formatGreek(side?.theta, 3)}</span>
      <span className={metricTone(side)}>{formatGreek(side?.vega, 3)}</span>
    </div>
  );
}

export default function OptionsPage() {
  const defaultSymbol = useDefaultOptionsSymbol();
  const [query, setQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState(defaultSymbol);
  const [searchOpen, setSearchOpen] = useState(false);
  const { summary, loading: summaryLoading, error: summaryError } = useOptionsSummary(selectedSymbol);
  const [selectedExpiration, setSelectedExpiration] = useState<number | null>(null);
  const { chain, loading: chainLoading, error: chainError } = useOptionsChain(selectedSymbol, selectedExpiration);
  const suggestions = useOptionsSymbolSuggestions(query);

  useEffect(() => {
    if (!selectedSymbol) {
      setSelectedSymbol(defaultSymbol);
      setQuery(defaultSymbol);
    }
  }, [defaultSymbol, selectedSymbol]);

  useEffect(() => {
    if (!query) {
      setQuery(selectedSymbol);
    }
  }, [query, selectedSymbol]);

  const flatExpirations = useMemo(
    () => summary?.months.flatMap((month) => month.expirations) ?? [],
    [summary],
  );

  useEffect(() => {
    if (!flatExpirations.length) {
      setSelectedExpiration(null);
      return;
    }
    if (!selectedExpiration || !flatExpirations.some((item) => item.expiration === selectedExpiration)) {
      setSelectedExpiration(flatExpirations[0].expiration);
    }
  }, [flatExpirations, selectedExpiration]);

  const stale = summary?.capturedAt ? Date.now() - summary.capturedAt > 60 * 60 * 1000 : false;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0d1015] text-white">
      <div className="border-b border-white/[0.06] bg-[linear-gradient(180deg,#141922_0%,#0d1015_100%)] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[280px] flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">
              Options Analysis
            </p>
            <div className="relative mt-2 max-w-[360px]">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value.toUpperCase());
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search symbol"
                className="w-full rounded-none border border-white/[0.09] bg-[#121722] px-3 py-2 font-mono text-[14px] uppercase tracking-[0.12em] text-white outline-none transition-colors focus:border-[#5d86ff]/65"
              />
              {searchOpen && suggestions.length > 0 ? (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-72 overflow-y-auto border border-white/[0.08] bg-[#0e131b] shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
                  {suggestions.map((entry) => (
                    <button
                      key={entry.symbol}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedSymbol(entry.symbol);
                        setQuery(entry.symbol);
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center justify-between border-b border-white/[0.04] px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
                    >
                      <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-white/90">
                        {entry.symbol}
                      </span>
                      <span className="ml-3 truncate text-[11px] text-white/42">
                        {entry.name}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-white/58">
            <div>
              <span className="text-white/28">Symbol</span>{" "}
              <span className="font-mono text-white/84">{selectedSymbol}</span>
            </div>
            <div>
              <span className="text-white/28">Spot</span>{" "}
              <span className="font-mono text-white/84">{formatPrice(summary?.underlyingPrice)}</span>
            </div>
            <div>
              <span className="text-white/28">Updated</span>{" "}
              <span className={`font-mono ${stale ? "text-amber-300" : "text-white/84"}`}>
                {formatTimestamp(summary?.capturedAt)}
              </span>
            </div>
            <div>
              <span className="text-white/28">Source</span>{" "}
              <span className="font-mono uppercase text-white/84">{summary?.source ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="flex min-w-max gap-6">
            {(summary?.months ?? []).map((month) => (
              <div key={month.monthKey} className="min-w-[180px]">
                <div className="mb-2 border-b border-white/[0.08] pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
                  {month.monthLabel}
                </div>
                <div className="flex flex-wrap gap-2">
                  {month.expirations.map((expiration) => {
                    const active = expiration.expiration === selectedExpiration;
                    return (
                      <button
                        key={expiration.expiration}
                        type="button"
                        onClick={() => setSelectedExpiration(expiration.expiration)}
                        className={`min-w-[58px] border px-2 py-1 font-mono text-[11px] transition-colors ${
                          active
                            ? "border-[#5d86ff] bg-[#5d86ff]/16 text-[#dce7ff]"
                            : "border-white/[0.08] bg-[#11161f] text-white/54 hover:border-white/[0.18] hover:text-white/82"
                        }`}
                      >
                        <div>{expiration.label}</div>
                        <div className="mt-0.5 text-[9px] text-white/34">{expiration.contractCount}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {!summaryLoading && !summaryError && !summary?.hasData ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/42">
                No Options Data
              </p>
              <p className="mt-2 text-[12px] text-white/54">
                The collector has not populated {selectedSymbol} yet, or this symbol has no stored chain.
              </p>
            </div>
          </div>
        ) : summaryError ? (
          <div className="flex h-full items-center justify-center text-[12px] text-red-300/80">
            {summaryError}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="grid grid-cols-[1fr_120px_1fr] items-end gap-3 border-b border-white/[0.06] bg-[#0f141d] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/34">
              <div className="grid grid-cols-8 gap-2 text-right">
                <span>Bid</span>
                <span>Ask</span>
                <span>Mid</span>
                <span>IV</span>
                <span>Delta</span>
                <span>Gamma</span>
                <span>Theta</span>
                <span>Vega</span>
              </div>
              <div className="text-center text-white/74">Strike</div>
              <div className="grid grid-cols-8 gap-2 text-left">
                <span>Bid</span>
                <span>Ask</span>
                <span>Mid</span>
                <span>IV</span>
                <span>Delta</span>
                <span>Gamma</span>
                <span>Theta</span>
                <span>Vega</span>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_120px_1fr] items-center gap-3 border-b border-white/[0.06] bg-[#101722] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em]">
              <div className="text-right text-emerald-300/90">Calls</div>
              <div className="text-center text-white/48">{chain?.expirationLabel ?? "Expiration"}</div>
              <div className="text-left text-rose-300/90">Puts</div>
            </div>

            <div className="flex-1 overflow-auto bg-[#0b0f15] px-4 py-2">
              {chainLoading ? (
                <div className="flex h-full items-center justify-center font-mono text-[11px] text-white/34">
                  Loading option chain...
                </div>
              ) : chainError ? (
                <div className="flex h-full items-center justify-center text-[12px] text-red-300/80">
                  {chainError}
                </div>
              ) : !(chain?.rows.length) ? (
                <div className="flex h-full items-center justify-center font-mono text-[11px] text-white/34">
                  Select an expiration with stored contracts.
                </div>
              ) : (
                <div className="min-w-[1120px]">
                  {chain.rows.map((row) => (
                    <div
                      key={row.strike}
                      className="grid grid-cols-[1fr_120px_1fr] items-center gap-3 border-b border-white/[0.04] py-2 font-mono text-[11px]"
                    >
                      <SideMetrics side={row.call} align="left" />
                      <div className="text-center">
                        <div className="text-[12px] text-white/88">{formatPrice(row.strike)}</div>
                        <div className="mt-1 flex items-center justify-center gap-3 text-[9px] text-white/34">
                          <span>C Vol {formatInt(row.call?.volume)}</span>
                          <span>P Vol {formatInt(row.put?.volume)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-center gap-3 text-[9px] text-white/28">
                          <span>C OI {formatInt(row.call?.openInterest)}</span>
                          <span>P OI {formatInt(row.put?.openInterest)}</span>
                        </div>
                      </div>
                      <SideMetrics side={row.put} align="right" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

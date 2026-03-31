import { useEffect, useMemo, useState, memo } from "react";
import { Calendar, Search, Radio } from "lucide-react";
import SymbolSearchModal from "../components/SymbolSearchModal";
import {
  useDefaultOptionsSymbol,
  useOptionsChain,
  useOptionsSummary,
  type OptionSide,
} from "../lib/use-options-data";

const BG_BASE = "#0D1117";
const BG_PANEL = "#161B22";

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

function sourceLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const u = raw.toLowerCase();
  if (u === "tws") return "TWS";
  if (u === "yahoo") return "Yahoo";
  return raw.toUpperCase();
}

function metricTone(side: OptionSide | null): string {
  if (!side) return "text-white/[0.22]";
  if (side.inTheMoney) return "text-[#00C853]";
  return "text-white/[0.82]";
}

const METRIC_COLS =
  "grid grid-cols-8 gap-x-1 gap-y-0 min-w-0 sm:gap-x-2 [&>span]:min-w-0 [&>span]:truncate";

/** Matches gap-2 between expiration pills. */
const EXP_PILL_GAP_PX = 8;
/** Tailwind min-w-[56px] floor; grow with label text (11px mono ~6.5px/char + px-2.5). */
const EXP_PILL_MIN_W_PX = 56;
const EXP_PILL_MAX_EST_W_PX = 132;
/** Avoid one month spanning the full screen; extra dates wrap to another row. */
const EXP_PILLS_MAX_PER_ROW = 12;

function expirationMonthMinWidthPx(expirations: { label: string }[]): number {
  const n = expirations.length;
  if (n === 0) return EXP_PILL_MIN_W_PX;
  const maxLabelChars = Math.max(3, ...expirations.map((e) => e.label.length));
  const estPillW = Math.min(
    EXP_PILL_MAX_EST_W_PX,
    Math.max(EXP_PILL_MIN_W_PX, Math.round(maxLabelChars * 6.5 + 22)),
  );
  const perRow = Math.min(n, EXP_PILLS_MAX_PER_ROW);
  return perRow * estPillW + (perRow - 1) * EXP_PILL_GAP_PX;
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
    <div className={`${METRIC_COLS} font-mono text-[11px] tabular-nums ${base}`}>
      <span className={metricTone(side)} title="Bid">
        {formatPrice(side?.bid)}
      </span>
      <span className={metricTone(side)} title="Ask">
        {formatPrice(side?.ask)}
      </span>
      <span className={metricTone(side)} title="Mid">
        {formatPrice(side?.mid)}
      </span>
      <span className={metricTone(side)} title="IV">
        {formatIv(side?.impliedVolatility)}
      </span>
      <span className={metricTone(side)} title="Delta">
        {formatGreek(side?.delta, 2)}
      </span>
      <span className={metricTone(side)} title="Gamma">
        {formatGreek(side?.gamma, 3)}
      </span>
      <span className={metricTone(side)} title="Theta">
        {formatGreek(side?.theta, 3)}
      </span>
      <span className={metricTone(side)} title="Vega">
        {formatGreek(side?.vega, 3)}
      </span>
    </div>
  );
}

function ChainHeaderLabels({ align }: { align: "left" | "right" }) {
  const cls = align === "left" ? "text-right" : "text-left";
  return (
    <div
      className={`${METRIC_COLS} font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-white/38 ${cls}`}
    >
      <span>Bid</span>
      <span>Ask</span>
      <span>Mid</span>
      <span>IV</span>
      <span>Δ</span>
      <span>Γ</span>
      <span>Θ</span>
      <span>ν</span>
    </div>
  );
}

function ChainSkeletonRows() {
  return (
    <div className="animate-pulse space-y-0" aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_128px_1fr] items-center gap-3 border-b border-white/[0.04] py-2"
        >
          <div className="flex justify-end gap-1">
            {Array.from({ length: 8 }).map((__, j) => (
              <div key={j} className="h-3 w-10 rounded bg-white/[0.06]" />
            ))}
          </div>
          <div className="mx-auto h-4 w-14 rounded bg-white/[0.08]" />
          <div className="flex justify-start gap-1">
            {Array.from({ length: 8 }).map((__, j) => (
              <div key={j} className="h-3 w-10 rounded bg-white/[0.06]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function OptionsPage() {
  const defaultSymbol = useDefaultOptionsSymbol();
  const [selectedSymbol, setSelectedSymbol] = useState(defaultSymbol);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const { summary, loading: summaryLoading, error: summaryError } = useOptionsSummary(selectedSymbol);
  const [selectedExpiration, setSelectedExpiration] = useState<number | null>(null);
  const { chain, loading: chainLoading, error: chainError } = useOptionsChain(selectedSymbol, selectedExpiration);

  useEffect(() => {
    if (!selectedSymbol) {
      setSelectedSymbol(defaultSymbol);
    }
  }, [defaultSymbol, selectedSymbol]);

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

  const atmStrike = useMemo(() => {
    const spot = summary?.underlyingPrice;
    const rows = chain?.rows ?? [];
    if (spot == null || !rows.length) return null;
    return rows.reduce((best, r) =>
      Math.abs(r.strike - spot) < Math.abs(best - spot) ? r.strike : best,
    rows[0].strike);
  }, [summary?.underlyingPrice, chain?.rows]);

  const isAtmRow = (strike: number) =>
    atmStrike != null && Math.abs(strike - atmStrike) < 1e-8;

  return (
    <div
      className="flex h-full min-h-0 flex-col text-white transition-none"
      style={{ backgroundColor: BG_BASE }}
    >
      {/* Header */}
      <header
        className="shrink-0 border-b border-white/[0.06] px-4 py-4 sm:px-5"
        style={{ backgroundColor: BG_PANEL }}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <h1 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/45">
                Options
              </h1>
              <span className="hidden h-3 w-px bg-white/10 sm:inline" aria-hidden />
              <p className="text-[12px] text-white/50">Chain snapshot from collector</p>
            </div>

            <button
              type="button"
              onClick={() => setSymbolSearchOpen((v) => !v)}
              className={`mt-3 flex h-8 w-full max-w-md items-center gap-1.5 border border-white/[0.08] px-2 text-left transition-colors duration-100 ease-out ${
                symbolSearchOpen ? "bg-white/[0.06]" : "bg-[#0D1117] hover:bg-[#1C2128]"
              }`}
              style={{ borderRadius: 4 }}
              aria-label="Search symbol"
              aria-expanded={symbolSearchOpen}
            >
              <Search className="h-[13px] w-[13px] shrink-0 text-white" strokeWidth={2} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-white/80">
                {selectedSymbol || "—"}
              </span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2 sm:gap-3">
            <div
              className="flex min-w-[100px] flex-col gap-0.5 border border-white/[0.06] px-3 py-2"
              style={{ backgroundColor: BG_BASE, borderRadius: 4 }}
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/35">Spot</span>
              <span className="font-mono text-[14px] tabular-nums text-[#00C853]/95">
                {formatPrice(summary?.underlyingPrice)}
              </span>
            </div>
            <div
              className="flex min-w-[120px] flex-col gap-0.5 border border-white/[0.06] px-3 py-2"
              style={{ backgroundColor: BG_BASE, borderRadius: 4 }}
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/35">Updated</span>
              <span
                className={`font-mono text-[12px] tabular-nums ${stale ? "text-[#F59E0B]" : "text-white/80"}`}
              >
                {formatTimestamp(summary?.capturedAt)}
              </span>
            </div>
            <div
              className="flex min-w-[88px] flex-col gap-0.5 border border-white/[0.06] px-3 py-2"
              style={{ backgroundColor: BG_BASE, borderRadius: 4 }}
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/35">Source</span>
              <span className="flex items-center gap-1.5 font-mono text-[12px] uppercase text-white/85">
                <Radio className="h-3.5 w-3.5 text-[#1A56DB]" strokeWidth={2} aria-hidden />
                {sourceLabel(summary?.source)}
              </span>
            </div>
          </div>
        </div>

        {/* Expirations */}
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <div className="mb-2 flex items-center gap-2 text-white/40">
            <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em]">Expirations</span>
          </div>
          <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-track]:bg-transparent">
            <div className="flex min-w-max gap-6 pb-1">
              {(summary?.months ?? []).map((month) => (
                <div
                  key={month.monthKey}
                  className="min-w-0 shrink-0"
                  style={{ minWidth: expirationMonthMinWidthPx(month.expirations) }}
                >
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/38">
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
                          className={`min-w-[56px] border px-2.5 py-1.5 text-left font-mono transition-[border-color,background-color,color] duration-100 ease-out ${
                            active
                              ? "border-[#1A56DB] bg-[#1A56DB]/12 text-[#d0e0ff]"
                              : "border-white/[0.08] bg-[#0D1117] text-white/55 hover:border-white/15 hover:bg-[#1C2128] hover:text-white/80"
                          }`}
                          style={{ borderRadius: 4 }}
                        >
                          <div className="text-[11px] leading-tight">{expiration.label}</div>
                          <div className="mt-0.5 text-[9px] text-white/30">{expiration.contractCount} lines</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {summaryLoading ? (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="h-10 max-w-md animate-pulse rounded bg-white/[0.06]" style={{ borderRadius: 4 }} />
            <div className="h-32 flex-1 animate-pulse rounded bg-white/[0.04]" />
          </div>
        ) : summaryError ? (
          <div className="flex flex-1 items-center justify-center px-4">
            <p className="max-w-md text-center text-[13px] text-[#FF3D71]/90">{summaryError}</p>
          </div>
        ) : !summary?.hasData ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/38">No options data</p>
            <p className="max-w-sm text-[13px] leading-relaxed text-white/48">
              The collector has not stored a chain for{" "}
              <span className="font-mono text-white/65">{selectedSymbol}</span> yet, or this symbol has no
              contracts in SQLite.
            </p>
          </div>
        ) : (
          <div
            className="mx-3 mb-3 mt-3 flex min-h-0 flex-1 flex-col border border-white/[0.06] sm:mx-4"
            style={{ backgroundColor: BG_PANEL }}
          >
            {/* Sticky column titles */}
            <div
              className="sticky top-0 z-20 grid shrink-0 grid-cols-[1fr_128px_1fr] items-end gap-3 border-b border-white/[0.06] px-3 py-2.5 sm:px-4"
              style={{ backgroundColor: BG_PANEL }}
            >
              <ChainHeaderLabels align="left" />
              <div className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
                Strike
              </div>
              <ChainHeaderLabels align="right" />
            </div>

            <div className="grid shrink-0 grid-cols-[1fr_128px_1fr] items-center gap-3 border-b border-white/[0.06] px-3 py-2 sm:px-4">
              <div className="text-right font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#00C853]/85">
                Calls
              </div>
              <div className="text-center font-mono text-[11px] tabular-nums text-white/55">
                {chain?.expirationLabel ?? "—"}
              </div>
              <div className="text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#FF3D71]/85">
                Puts
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto" style={{ backgroundColor: BG_BASE }}>
              {chainLoading ? (
                <div className="px-3 py-2 sm:px-4">
                  <ChainSkeletonRows />
                </div>
              ) : chainError ? (
                <div className="flex h-48 items-center justify-center px-4 text-[13px] text-[#FF3D71]/90">
                  {chainError}
                </div>
              ) : !(chain?.rows.length) ? (
                <div className="flex h-48 items-center justify-center font-mono text-[11px] text-white/35">
                  Select an expiration with stored contracts.
                </div>
              ) : (
                <div className="min-w-[1080px] px-3 pb-3 pt-1 sm:px-4">
                  {chain.rows.map((row) => {
                    const atm = isAtmRow(row.strike);
                    return (
                      <div
                        key={row.strike}
                        className={`grid grid-cols-[1fr_128px_1fr] items-center gap-3 border-b border-white/[0.04] transition-colors duration-100 ease-out ${
                          atm ? "bg-[#1A56DB]/[0.07]" : "hover:bg-[#1C2128]/80"
                        }`}
                      >
                        <SideMetrics side={row.call} align="left" />
                        <div
                          className={`flex flex-col items-center justify-center border-x border-white/[0.06] py-2 ${
                            atm ? "bg-[#1A56DB]/[0.06]" : ""
                          }`}
                        >
                          <div className="font-mono text-[13px] font-medium tabular-nums text-white/92">
                            {formatPrice(row.strike)}
                          </div>
                          {atm ? (
                            <span className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[#1A56DB]/90">
                              ATM
                            </span>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[9px] text-white/32">
                            <span>
                              C vol <span className="font-mono tabular-nums text-white/45">{formatInt(row.call?.volume)}</span>
                            </span>
                            <span>
                              P vol <span className="font-mono tabular-nums text-white/45">{formatInt(row.put?.volume)}</span>
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[9px] text-white/25">
                            <span>
                              C OI <span className="font-mono tabular-nums text-white/38">{formatInt(row.call?.openInterest)}</span>
                            </span>
                            <span>
                              P OI <span className="font-mono tabular-nums text-white/38">{formatInt(row.put?.openInterest)}</span>
                            </span>
                          </div>
                        </div>
                        <SideMetrics side={row.put} align="right" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <SymbolSearchModal
        isOpen={symbolSearchOpen}
        onClose={() => setSymbolSearchOpen(false)}
        onSelectSymbol={(sym) => setSelectedSymbol(sym.trim().toUpperCase())}
        excludeSymbol={selectedSymbol}
      />
    </div>
  );
}

export default memo(OptionsPage);

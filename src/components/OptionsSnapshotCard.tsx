import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, GripVertical, Search, X } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import ScrollArea from "./ScrollArea";
import SymbolSearchModal from "./SymbolSearchModal";
import { linkBus } from "../lib/link-bus";
import {
  useOptionsChain,
  useOptionsSummary,
  type OptionsChainRow,
  type OptionSide,
} from "../lib/use-options-data";
import { useOptionsAnalytics } from "../lib/use-options-analytics";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fp(v: number | null | undefined, d = 2): string {
  if (v == null) return "—";
  return v.toFixed(d);
}

function fIv(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fSign(v: number | null | undefined, d = 2): string {
  if (v == null) return "—";
  const s = (v * 100).toFixed(d);
  return `±${s}%`;
}

function fDte(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

/** Nearest ATM row */
function atmRow(rows: OptionsChainRow[], spot: number): OptionsChainRow | null {
  if (!rows.length) return null;
  return rows.reduce((best, r) =>
    Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best,
  rows[0]);
}

function mid(side: OptionSide | null): number | null {
  if (!side) return null;
  if (side.bid != null && side.ask != null) return (side.bid + side.ask) / 2;
  return side.bid ?? side.ask ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface OptionsSnapshotCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

// ── Stat tile ──────────────────────────────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  accentBorder?: string;
  wide?: boolean;
  scale?: number;
}

function StatTile({
  label,
  value,
  sub,
  color = "text-white/90",
  accentBorder,
  wide = false,
  scale = 1,
}: StatTileProps) {
  const tileBackground = accentBorder
    ? `linear-gradient(180deg, ${accentBorder}24, ${accentBorder}10)`
    : "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))";

  return (
    <div
      className={`group flex min-w-0 flex-col justify-between border border-white/[0.06] transition-colors duration-100 hover:border-white/[0.12] hover:bg-white/[0.035] ${
        wide ? "sm:col-span-2" : ""
      }`}
      style={{
        background: tileBackground,
        borderRadius: 5,
        borderColor: accentBorder ? `${accentBorder}40` : undefined,
        minHeight: 44 * scale,
        padding: `${6 * scale}px ${8 * scale}px`,
      }}
    >
      <span
        className="truncate font-semibold uppercase text-white/46"
        style={{ fontSize: 8 * scale, letterSpacing: `${0.14 * scale}em` }}
      >
        {label}
      </span>
      <span
        className={`truncate font-mono font-semibold tabular-nums ${color}`}
        style={{ marginTop: 2 * scale, fontSize: clamp(13 * scale, 11, 22) }}
      >
        {value}
      </span>
      {sub && (
        <span
          className="truncate font-mono text-white/35 tabular-nums"
          style={{ fontSize: 8 * scale }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

// ── Expiry pill row ────────────────────────────────────────────────────────────

interface ExpiryPickerProps {
  months: { monthLabel: string; expirations: { expiration: number; label: string }[] }[];
  selected: number | null;
  onSelect: (exp: number) => void;
  scale?: number;
}

function ExpiryPicker({ months, selected, onSelect, scale = 1 }: ExpiryPickerProps) {
  const allExps = useMemo(
    () => months.flatMap((m) => m.expirations),
    [months],
  );

  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const width = 224 * scale;
    const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
    const availableBelow = window.innerHeight - rect.bottom - 12;

    setPanelStyle({
      left,
      top: rect.bottom + 6,
      width,
      maxHeight: Math.min(280 * scale, Math.max(160 * scale, availableBelow)),
    });
  };

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    updatePosition();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectedLabel =
    allExps.find((e) => e.expiration === selected)?.label ?? "Select expiry";

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        className="flex max-w-full items-center border border-white/[0.10] bg-[#1C2128] text-white/70 transition-colors duration-75 hover:border-white/20 hover:text-white/90"
        style={{
          borderRadius: 4,
          gap: 4 * scale,
          height: 24 * scale,
          paddingInline: 8 * scale,
          fontSize: 10 * scale,
        }}
      >
        <span className="truncate font-mono">{selectedLabel}</span>
        <ChevronDown
          className="shrink-0 text-white/40"
          size={10 * scale}
          strokeWidth={2}
        />
      </button>

      {open ? createPortal(
        <div
          ref={panelRef}
          className="fixed z-[1000] border border-white/[0.10] bg-[#1C2128] py-1 shadow-xl shadow-black/40"
          style={{ ...panelStyle, borderRadius: 5 }}
        >
          <ScrollArea
            viewportClassName="max-h-52 pr-2"
            viewportStyle={{ maxHeight: panelStyle.maxHeight }}
            trackClassName="right-1 bg-[#0D1117]"
            thumbClassName="bg-white/[0.18]"
          >
            {months.map((month) => (
              <div key={month.monthLabel}>
                <div
                  className="font-semibold uppercase text-white/35"
                  style={{
                    padding: `${4 * scale}px ${10 * scale}px`,
                    fontSize: 9 * scale,
                    letterSpacing: `${0.18 * scale}em`,
                  }}
                >
                  {month.monthLabel}
                </div>
                {month.expirations.map((exp) => (
                  <button
                    key={exp.expiration}
                    onClick={() => { onSelect(exp.expiration); setOpen(false); }}
                    className={`flex w-full items-center text-left font-mono transition-colors duration-75 ${
                      exp.expiration === selected
                        ? "bg-[#1A56DB]/20 text-white"
                        : "text-white/70 hover:bg-white/[0.04] hover:text-white/90"
                    }`}
                    style={{
                      padding: `${4 * scale}px ${10 * scale}px`,
                      fontSize: 10 * scale,
                    }}
                  >
                    {exp.label}
                  </button>
                ))}
              </div>
            ))}
          </ScrollArea>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

function OptionsSnapshotCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  config,
  onConfigChange,
}: OptionsSnapshotCardProps) {
  const symbol =
    typeof config.symbol === "string" ? config.symbol.trim().toUpperCase() : "";
  const configuredExpiry =
    typeof config.expiration === "number" ? config.expiration : null;

  const [searchOpen, setSearchOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [cardScale, setCardScale] = useState(1);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const updateScale = (width: number, height: number) => {
      // Normalize against a 1920px reference viewport so the card content
      // doesn't inflate on wider screens (e.g. 1440p) where the same column
      // fraction allocates significantly more CSS pixels.
      const vpNorm = Math.min(1.0, Math.sqrt(1920 / Math.max(window.innerWidth, 1)));
      const normW = width * vpNorm;
      const normH = height * vpNorm;

      const areaScale = Math.sqrt((normW * normH) / (340 * 440));
      const widthScale = normW / 340;
      const heightScale = normH / 440;
      const nextScale = Math.min(areaScale, widthScale * 1.2, heightScale * 1.25) * 1.35;
      setCardScale(clamp(nextScale, 1.05, 2.45));
    };

    const rect = node.getBoundingClientRect();
    updateScale(rect.width, rect.height);

    const observer = new ResizeObserver(([entry]) => {
      updateScale(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Link channel subscription — use configRef so changing expiry doesn't
  // re-subscribe (linkBus.subscribe fires the callback immediately, which
  // would reset expiration back to null on every expiry selection).
  useEffect(() => {
    if (!linkChannel) return;
    return linkBus.subscribe(linkChannel, (sym) => {
      onConfigChange({ ...configRef.current, symbol: sym, expiration: null });
    });
  }, [linkChannel, onConfigChange]);

  const { summary } = useOptionsSummary(symbol);
  const spot = summary?.underlyingPrice ?? null;

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const filteredMonths = useMemo(
    () =>
      (summary?.months ?? [])
        .map((m) => ({
          ...m,
          expirations: m.expirations.filter((e) => e.expiration >= todayStart),
        }))
        .filter((m) => m.expirations.length > 0),
    [summary?.months, todayStart],
  );

  const allExps = useMemo(
    () => filteredMonths.flatMap((m) => m.expirations),
    [filteredMonths],
  );

  const nearestExp = allExps[0]?.expiration ?? null;
  const selectedExpiry = configuredExpiry ?? nearestExp;

  const { chain } = useOptionsChain(symbol, selectedExpiry);
  const analytics = useOptionsAnalytics(chain ?? null, null, spot);

  // ── Derived metrics ──────────────────────────────────────────────────────────

  const atm = useMemo(() => {
    if (!chain?.rows.length || spot == null) return null;
    return atmRow(chain.rows, spot);
  }, [chain?.rows, spot]);

  const atmCallMid = mid(atm?.call ?? null);
  const atmPutMid  = mid(atm?.put  ?? null);
  const straddlePrice =
    atmCallMid != null && atmPutMid != null ? atmCallMid + atmPutMid : null;

  const atmIv =
    atm?.call?.impliedVolatility ?? atm?.put?.impliedVolatility ?? null;

  const dte =
    atm?.call?.daysToExpiration ?? atm?.put?.daysToExpiration ?? null;

  // Put/Call OI ratio across the whole chain
  const pcRatio = useMemo(() => {
    const rows = chain?.rows ?? [];
    let totalCallOI = 0;
    let totalPutOI  = 0;
    for (const r of rows) {
      totalCallOI += r.call?.openInterest ?? 0;
      totalPutOI  += r.put?.openInterest  ?? 0;
    }
    if (totalCallOI === 0) return null;
    return totalPutOI / totalCallOI;
  }, [chain?.rows]);

  // Max pain: strike with highest combined OI loss for option buyers
  const maxPain = useMemo(() => {
    const rows = chain?.rows ?? [];
    if (!rows.length) return null;
    let bestStrike: number | null = null;
    let bestLoss = Infinity;
    for (const target of rows) {
      let totalLoss = 0;
      for (const r of rows) {
        const callLoss = Math.max(0, r.strike - target.strike) * (r.call?.openInterest ?? 0);
        const putLoss  = Math.max(0, target.strike - r.strike) * (r.put?.openInterest  ?? 0);
        totalLoss += callLoss + putLoss;
      }
      if (totalLoss < bestLoss) {
        bestLoss = totalLoss;
        bestStrike = target.strike;
      }
    }
    return bestStrike;
  }, [chain?.rows]);

  // ── UI state ─────────────────────────────────────────────────────────────────

  const commitSymbol = (sym: string) => {
    onConfigChange({ ...config, symbol: sym, expiration: null });
    if (linkChannel) linkBus.publish(linkChannel, sym);
  };

  const commitExpiry = (exp: number) => {
    onConfigChange({ ...config, expiration: exp });
  };

  const hasData = !!symbol && spot != null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div ref={rootRef} className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel">
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-white/[0.10] bg-base"
        data-drag-handle
        style={{
          gap: 6 * cardScale,
          height: 32 * cardScale,
          paddingInline: 8 * cardScale,
        }}
      >
        <div className="flex min-w-0 items-center" style={{ gap: 6 * cardScale }}>
          <GripVertical
            className="shrink-0 cursor-grab text-white/20 active:cursor-grabbing"
            size={12 * cardScale}
            strokeWidth={2}
          />
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className="flex min-w-0 items-center border border-white/[0.08] bg-[#1C2128] text-left transition-colors duration-75 hover:border-white/15 hover:bg-white/[0.06]"
            style={{
              borderRadius: 4,
              gap: 4 * cardScale,
              height: 20 * cardScale,
              paddingInline: 6 * cardScale,
            }}
          >
            <Search className="shrink-0 text-white/35" size={10 * cardScale} strokeWidth={2} />
            <span
              className="truncate font-mono font-semibold tracking-wide text-white/85"
              style={{ fontSize: 10 * cardScale }}
            >
              {symbol || "Symbol…"}
            </span>
          </button>
          <span
            className="hidden truncate font-medium text-white/80 min-[360px]:inline"
            style={{ fontSize: 11 * cardScale }}
          >
            Options Snapshot
          </span>
        </div>

        <div className="flex shrink-0 items-center" style={{ gap: 4 * cardScale }}>
          <ComponentLinkMenu linkChannel={linkChannel} onSetLinkChannel={onSetLinkChannel} />
          <button
            onClick={onClose}
            className="flex items-center justify-center text-white transition-colors duration-75 hover:text-white/60"
            style={{ width: 20 * cardScale, height: 20 * cardScale }}
          >
            <X size={12 * cardScale} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* No symbol empty state */}
      {!symbol && (
        <div
          className="flex flex-1 flex-col items-center justify-center text-center"
          style={{ gap: 6 * cardScale, paddingInline: 16 * cardScale }}
        >
          <div
            className="flex items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03]"
            style={{ width: 32 * cardScale, height: 32 * cardScale }}
          >
            <Search size={14 * cardScale} className="text-white/24" strokeWidth={1.7} />
          </div>
          <div>
            <p className="font-mono text-white/46" style={{ fontSize: 11 * cardScale }}>
              No symbol selected
            </p>
            <p className="text-white/24" style={{ marginTop: 2 * cardScale, fontSize: 10 * cardScale }}>
              Choose a ticker for options metrics.
            </p>
          </div>
          <button
            onClick={() => setSearchOpen(true)}
            className="border border-white/[0.10] bg-[#1C2128] text-white/60 transition-colors duration-75 hover:border-white/20 hover:text-white/90"
            style={{
              marginTop: 2 * cardScale,
              borderRadius: 4,
              padding: `${4 * cardScale}px ${10 * cardScale}px`,
              fontSize: 10 * cardScale,
            }}
          >
            Search symbol
          </button>
        </div>
      )}

      {/* Body */}
      {symbol && (
        <ScrollArea
          ref={bodyRef}
          className="min-h-0 flex-1"
          viewportClassName="h-full"
          trackClassName="inset-y-1 right-1 w-1.5 bg-[#0D1117]"
          thumbClassName="bg-white/[0.18]"
        >
          <div
            className="flex min-h-full flex-col"
            style={{
              gap: 8 * cardScale,
              padding: `${8 * cardScale}px ${12 * cardScale}px ${8 * cardScale}px ${8 * cardScale}px`,
            }}
          >
            {/* Expiry selector + spot */}
            <div
              className="flex min-w-0 flex-wrap items-center justify-between rounded border border-white/[0.06] bg-base/70"
              style={{
                gap: 8 * cardScale,
                padding: `${6 * cardScale}px ${8 * cardScale}px`,
              }}
            >
              <div className="min-w-0">
                <p
                  className="font-semibold uppercase text-white/30"
                  style={{ fontSize: 8 * cardScale, letterSpacing: `${0.14 * cardScale}em` }}
                >
                  Expiry
                </p>
                {allExps.length > 0 ? (
                  <div style={{ marginTop: 4 * cardScale }}>
                    <ExpiryPicker
                      months={filteredMonths}
                      selected={selectedExpiry}
                      onSelect={commitExpiry}
                      scale={cardScale}
                    />
                  </div>
                ) : (
                  <span
                    className="block font-mono text-white/25"
                    style={{ marginTop: 4 * cardScale, fontSize: 10 * cardScale }}
                  >
                    No expirations
                  </span>
                )}
              </div>
              <div className="text-right">
                <p
                  className="font-semibold uppercase text-white/30"
                  style={{ fontSize: 8 * cardScale, letterSpacing: `${0.14 * cardScale}em` }}
                >
                  Spot
                </p>
                <span
                  className="block font-mono font-semibold tabular-nums text-[#00C853]/90"
                  style={{ marginTop: 2 * cardScale, fontSize: 13 * cardScale }}
                >
                  {spot != null ? `$${fp(spot)}` : "—"}
                </span>
              </div>
            </div>

            {/* Stat grid */}
            <div
              className="grid"
              style={{
                gap: 6 * cardScale,
                gridTemplateColumns: `repeat(auto-fit, minmax(${98 * cardScale}px, 1fr))`,
              }}
            >
              {/* Implied move */}
              {analytics.impliedMoveToExpiry != null && (
                <StatTile
                  label="Impl. Move"
                  value={fSign(analytics.impliedMoveToExpiry)}
                  sub={dte != null ? `${fDte(dte)}d to expiry` : undefined}
                  color="text-[#A78BFA]"
                  accentBorder="#8B5CF6"
                  scale={cardScale}
                />
              )}

            {/* Support */}
            <StatTile
              label="Support"
              value={analytics.support != null ? `$${fp(analytics.support)}` : "—"}
              sub={
                analytics.support != null && spot != null
                  ? `${(((analytics.support - spot) / spot) * 100).toFixed(1)}% away`
                  : undefined
              }
              color={analytics.support != null ? "text-[#00C853]" : "text-white/20"}
              accentBorder={analytics.support != null ? "#00C853" : undefined}
              scale={cardScale}
            />

            {/* Resistance */}
            <StatTile
              label="Resistance"
              value={analytics.resistance != null ? `$${fp(analytics.resistance)}` : "—"}
              sub={
                analytics.resistance != null && spot != null
                  ? `+${(((analytics.resistance - spot) / spot) * 100).toFixed(1)}% away`
                  : undefined
              }
              color={analytics.resistance != null ? "text-[#FF3D71]" : "text-white/20"}
              accentBorder={analytics.resistance != null ? "#FF3D71" : undefined}
              scale={cardScale}
            />

            {/* ATM IV */}
            <StatTile
              label="ATM IV"
              value={fIv(atmIv)}
              color={
                atmIv == null
                  ? "text-white/20"
                  : atmIv >= 0.5
                    ? "text-[#F59E0B]"
                    : "text-white/80"
              }
              scale={cardScale}
            />

            {/* Straddle */}
            <StatTile
              label="ATM Straddle"
              value={straddlePrice != null ? `$${fp(straddlePrice)}` : "—"}
              sub={
                straddlePrice != null && spot != null
                  ? `${((straddlePrice / spot) * 100).toFixed(2)}% of spot`
                  : undefined
              }
              color="text-[#8B5CF6]/80"
              scale={cardScale}
            />

            {/* Put/Call ratio */}
            <StatTile
              label="P/C OI Ratio"
              value={pcRatio != null ? pcRatio.toFixed(2) : "—"}
              sub={
                pcRatio != null
                  ? pcRatio > 1.2
                    ? "bearish lean"
                    : pcRatio < 0.8
                      ? "bullish lean"
                      : "neutral"
                  : undefined
              }
              color={
                pcRatio == null
                  ? "text-white/20"
                  : pcRatio > 1.2
                    ? "text-[#FF3D71]"
                    : pcRatio < 0.8
                      ? "text-[#00C853]"
                      : "text-[#F59E0B]"
              }
              scale={cardScale}
            />

            {/* Max pain */}
            <StatTile
              label="Max Pain"
              value={maxPain != null ? `$${fp(maxPain)}` : "—"}
              sub={
                maxPain != null && spot != null
                  ? `${((maxPain - spot) / spot >= 0 ? "+" : "")}${(((maxPain - spot) / spot) * 100).toFixed(1)}% vs spot`
                  : undefined
              }
              color="text-[#F59E0B]"
              scale={cardScale}
            />

            {/* Best covered call */}
            {analytics.bestCoveredCall != null && (
              <StatTile
                label="Best Cov. Call"
                value={`$${fp(analytics.bestCoveredCall)}`}
                sub="highest scored CC strike"
                color="text-[#F59E0B]"
                accentBorder="#F59E0B"
                scale={cardScale}
              />
            )}

            {/* DTE */}
            <StatTile
              label="DTE"
              value={fDte(dte)}
              sub={dte != null ? "days to expiry" : undefined}
              color="text-white/70"
              scale={cardScale}
            />
          </div>

          {/* No data notice */}
          {!hasData && symbol && (
            <div className="flex flex-1 items-center justify-center">
              <span className="text-white/20" style={{ fontSize: 10 * cardScale }}>
                Fetching options data…
              </span>
            </div>
          )}
          </div>
        </ScrollArea>
      )}

      {/* Symbol search modal */}
      <SymbolSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectSymbol={(sym: string) => {
          commitSymbol(sym);
          setSearchOpen(false);
        }}
      />
    </div>
  );
}

export default memo(OptionsSnapshotCard);

import { useEffect, useMemo, useRef, useState, memo } from "react";
import { Calendar, Search, Radio, SlidersHorizontal } from "lucide-react";
import SymbolSearchModal from "../components/SymbolSearchModal";
import { LOGO_SYMBOLS } from "../lib/logo-symbols";
import {
  useDefaultOptionsSymbol,
  useOptionsChain,
  useOptionsEstimate,
  useOptionsSummary,
  type OptionSide,
} from "../lib/use-options-data";

const BG_BASE = "#0D1117";
const BG_PANEL = "#161B22";
const BG_HOVER = "#1C2128";

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


function formatTimestamp(value: number | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatVolume(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function sourceLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const u = raw.toLowerCase();
  if (u === "tws") return "TWS";
  if (u === "yahoo") return "Yahoo";
  return raw.toUpperCase();
}

// ── Column system ─────────────────────────────────────────────────────────────

type ColId =
  | "bid" | "ask" | "spread" | "ltp" | "theoretical"
  | "bidPct" | "askPct" | "annBidPct" | "annAskPct"
  | "intrinsic" | "timeVal" | "iv" | "be" | "toBePct"
  | "distance" | "retDist" | "delta" | "gamma" | "theta" | "vega" | "rho"
  | "volBar";

interface ColDef {
  id: ColId;
  label: string;
  width: number;
  defaultVisible: boolean;
  category: "price" | "greek" | "derived" | "visual";
}

const COL_MAP: Record<ColId, ColDef> = {
  rho:         { id: "rho",         label: "Rho",       width: 68,  defaultVisible: true,  category: "greek"   },
  vega:        { id: "vega",        label: "Vega",       width: 72,  defaultVisible: true,  category: "greek"   },
  gamma:       { id: "gamma",       label: "Gamma",      width: 74,  defaultVisible: true,  category: "greek"   },
  theta:       { id: "theta",       label: "Theta",      width: 76,  defaultVisible: true,  category: "greek"   },
  delta:       { id: "delta",       label: "Delta",      width: 74,  defaultVisible: true,  category: "greek"   },
  toBePct:     { id: "toBePct",     label: "TO BE%",     width: 80,  defaultVisible: false, category: "derived" },
  be:          { id: "be",          label: "BE",         width: 78,  defaultVisible: false, category: "derived" },
  iv:          { id: "iv",          label: "IV",         width: 72,  defaultVisible: true,  category: "price"   },
  timeVal:     { id: "timeVal",     label: "Time Val",   width: 76,  defaultVisible: false, category: "derived" },
  intrinsic:   { id: "intrinsic",   label: "Intr Val",   width: 76,  defaultVisible: false, category: "derived" },
  annAskPct:   { id: "annAskPct",   label: "Ann Ask%",   width: 82,  defaultVisible: false, category: "derived" },
  annBidPct:   { id: "annBidPct",   label: "Ann Bid%",   width: 82,  defaultVisible: false, category: "derived" },
  askPct:      { id: "askPct",      label: "Ask%",       width: 70,  defaultVisible: false, category: "derived" },
  bidPct:      { id: "bidPct",      label: "Bid%",       width: 70,  defaultVisible: false, category: "derived" },
  ltp:         { id: "ltp",         label: "LTP",        width: 78,  defaultVisible: false, category: "price"   },
  theoretical: { id: "theoretical", label: "Theor",      width: 78,  defaultVisible: false, category: "price"   },
  spread:      { id: "spread",      label: "Spread",     width: 72,  defaultVisible: false, category: "price"   },
  ask:         { id: "ask",         label: "Ask",        width: 80,  defaultVisible: true,  category: "price"   },
  bid:         { id: "bid",         label: "Bid",        width: 80,  defaultVisible: true,  category: "price"   },
  retDist:     { id: "retDist",     label: "Ret Dist",   width: 78,  defaultVisible: false, category: "derived" },
  distance:    { id: "distance",    label: "Distance",   width: 78,  defaultVisible: false, category: "derived" },
  volBar:      { id: "volBar",      label: "Volume",     width: 100, defaultVisible: true,  category: "visual"  },
};

// Calls: outermost (greeks) on the left → innermost (vol bar) on the right, reading toward center
const CALL_COL_IDS: ColId[] = [
  "rho","vega","gamma","theta","delta",
  "toBePct","be","iv","timeVal","intrinsic",
  "annAskPct","annBidPct","askPct","bidPct",
  "ltp","theoretical","spread","ask","bid",
  "retDist","distance","volBar",
];
// Puts: mirror
const PUT_COL_IDS: ColId[] = [...CALL_COL_IDS].reverse();

const DEFAULT_VISIBLE_COLS = new Set<ColId>(
  (Object.values(COL_MAP) as ColDef[]).filter(c => c.defaultVisible).map(c => c.id)
);

const COL_CATEGORIES: { label: string; ids: ColId[] }[] = [
  { label: "Price",   ids: ["bid","ask","spread","ltp","theoretical"] },
  { label: "Derived", ids: ["iv","bidPct","askPct","annBidPct","annAskPct","intrinsic","timeVal","be","toBePct","distance","retDist"] },
  { label: "Greeks",  ids: ["delta","theta","gamma","vega","rho"] },
  { label: "Visual",  ids: ["volBar"] },
];

function getOrderedCols(ids: ColId[], visible: Set<ColId>): ColDef[] {
  return ids.filter(id => visible.has(id)).map(id => COL_MAP[id]);
}
function gridTemplate(cols: ColDef[]): string {
  return cols.map(c => `${c.width}px`).join(" ");
}
function totalWidth(cols: ColDef[]): number {
  return cols.reduce((s, c) => s + c.width, 0);
}

// ── Cell computation ──────────────────────────────────────────────────────────

interface CellCtx { underlyingPrice: number | null; isCall: boolean; strike: number; }

function computeCell(id: ColId, side: OptionSide | null, ctx: CellCtx): string {
  const s = side; const up = ctx.underlyingPrice; const k = ctx.strike;
  switch (id) {
    case "bid":    return formatPrice(s?.bid);
    case "ask":    return formatPrice(s?.ask);
    case "spread": { const v = s?.ask != null && s?.bid != null ? s.ask - s.bid : null; return formatPrice(v); }
    case "ltp":    return formatPrice(s?.lastPrice);
    case "theoretical": {
      const v = s?.intrinsicValue != null && s?.extrinsicValue != null ? s.intrinsicValue + s.extrinsicValue : null;
      return formatPrice(v);
    }
    case "bidPct":    { const v = s?.bid != null && up ? (s.bid / up) * 100 : null; return v != null ? `${v.toFixed(2)}%` : "—"; }
    case "askPct":    { const v = s?.ask != null && up ? (s.ask / up) * 100 : null; return v != null ? `${v.toFixed(2)}%` : "—"; }
    case "annBidPct": { const d = s?.daysToExpiration; const v = s?.bid != null && up && d ? (s.bid/up)*(365/d)*100 : null; return v != null ? `${v.toFixed(1)}%` : "—"; }
    case "annAskPct": { const d = s?.daysToExpiration; const v = s?.ask != null && up && d ? (s.ask/up)*(365/d)*100 : null; return v != null ? `${v.toFixed(1)}%` : "—"; }
    case "intrinsic": return formatPrice(s?.intrinsicValue);
    case "timeVal":   return formatPrice(s?.extrinsicValue);
    case "iv":        return formatIv(s?.impliedVolatility);
    case "be":        { const v = s?.ask != null ? (ctx.isCall ? k + s.ask : k - s.ask) : null; return formatPrice(v); }
    case "toBePct":   { const be = s?.ask != null ? (ctx.isCall ? k + s.ask : k - s.ask) : null; const v = be != null && up ? ((be - up)/up)*100 : null; return v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—"; }
    case "distance":  { const v = up != null ? Math.abs(k - up) : null; return formatPrice(v); }
    case "retDist":   { const v = up != null ? (Math.abs(k-up)/up)*100 : null; return v != null ? `${v.toFixed(2)}%` : "—"; }
    case "delta":  return formatGreek(s?.delta, 2);
    case "gamma":  return formatGreek(s?.gamma, 4);
    case "theta":  return formatGreek(s?.theta, 3);
    case "vega":   return formatGreek(s?.vega, 3);
    case "rho":    return formatGreek(s?.rho, 3);
    case "volBar": return "";
    default:       return "—";
  }
}

function cellClass(id: ColId, side: OptionSide | null, isEmpty: boolean): string {
  if (isEmpty) return "text-white/18";
  const itm = side?.inTheMoney === true;
  switch (id) {
    case "bid": case "ask": return itm ? "text-[#00C853]" : "text-white/90";
    case "delta": return itm ? "text-[#00C853]/80" : "text-white/62";
    case "theta": return "text-[#F59E0B]/70";
    case "iv": return "text-white/78";
    case "gamma": case "vega": case "rho": return "text-white/48";
    case "toBePct": case "be": return "text-white/65";
    case "bidPct": case "askPct": case "annBidPct": case "annAskPct": return "text-white/58";
    default: return "text-white/70";
  }
}

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

const CENTER_W = 260;

function SideMetrics({
  side, isCall, itm: _itm, cols, strike, underlyingPrice, maxVolume,
}: {
  side: OptionSide | null; isCall: boolean; itm: boolean;
  cols: ColDef[]; strike: number; underlyingPrice: number | null; maxVolume: number;
}) {
  const itmBg = "";
  const ctx: CellCtx = { underlyingPrice, isCall, strike };
  const w = totalWidth(cols);
  return (
    <div
      className={`grid h-full items-center font-mono text-[13px] tabular-nums ${itmBg}`}
      style={{ gridTemplateColumns: gridTemplate(cols), width: w, minWidth: w }}
    >
      {cols.map(col => {
        if (col.id === "volBar") {
          const pct = side?.volume && maxVolume > 0 ? Math.min((side.volume / maxVolume) * 100, 100) : 0;
          const volLabel = formatVolume(side?.volume);
          return (
            <div
              key={col.id}
              className={`flex h-full flex-col justify-center gap-1 px-2 ${isCall ? "items-end" : "items-start"}`}
            >
              <div
                className={`h-[5px] rounded-full ${isCall ? "bg-[#00C853]/75" : "bg-[#FF3D71]/75"}`}
                style={{ width: `${pct}%`, minWidth: pct > 0 ? 2 : 0 }}
              />
              <span className={`font-mono text-[11px] tabular-nums ${volLabel === "—" ? "text-white/20" : isCall ? "text-[#00C853]/85" : "text-[#FF3D71]/85"}`}>
                {volLabel}
              </span>
            </div>
          );
        }
        const display = computeCell(col.id, side, ctx);
        const isEmpty = display === "—";
        return (
          <span
            key={col.id}
            className={`truncate px-1.5 ${cellClass(col.id, side, isEmpty)} ${isCall ? "text-right" : "text-left"}`}
            title={col.label}
          >
            {display}
          </span>
        );
      })}
    </div>
  );
}

function ChainHeaderLabels({ isCall, cols }: { isCall: boolean; cols: ColDef[] }) {
  const w = totalWidth(cols);
  return (
    <div
      className={`grid font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-white ${isCall ? "text-right" : "text-left"}`}
      style={{ gridTemplateColumns: gridTemplate(cols), width: w, minWidth: w }}
    >
      {cols.map(col => (
        <span key={col.id} className="truncate px-1.5 py-2" title={col.label}>
          {col.label}
        </span>
      ))}
    </div>
  );
}

function ColumnPicker({
  visible, onChange, onClose,
}: {
  visible: Set<ColId>; onChange: (id: ColId, on: boolean) => void; onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="absolute right-2 top-full z-40 mt-1 w-72 border border-white/[0.10] bg-[#1a2130] p-3 shadow-2xl shadow-black/50"
        style={{ borderRadius: 6 }}
      >
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">Toggle Columns</p>
        {COL_CATEGORIES.map(cat => (
          <div key={cat.label} className="mb-3">
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">{cat.label}</p>
            <div className="flex flex-wrap gap-1">
              {cat.ids.map(id => {
                const col = COL_MAP[id];
                const checked = visible.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onChange(id, !checked)}
                    className={`h-6 border px-2 font-mono text-[10px] transition-colors duration-75 ${
                      checked
                        ? "border-[#1A56DB]/60 bg-[#1A56DB]/20 text-[#a8c8ff]"
                        : "border-white/[0.08] text-white/40 hover:border-white/18 hover:text-white/65"
                    }`}
                    style={{ borderRadius: 3 }}
                  >
                    {col.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ChainSkeletonRows() {
  return (
    <div className="animate-pulse space-y-0" aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_160px_1fr] items-center gap-0 border-b border-white/[0.05] py-3"
        >
          <div className="flex justify-end gap-2 px-3">
            {Array.from({ length: 6 }).map((__, j) => (
              <div key={j} className="h-3 w-12 rounded bg-white/[0.07]" />
            ))}
          </div>
          <div className="mx-auto h-4 w-16 rounded bg-white/[0.09]" />
          <div className="flex justify-start gap-2 px-3">
            {Array.from({ length: 6 }).map((__, j) => (
              <div key={j} className="h-3 w-12 rounded bg-white/[0.07]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SymbolLogo({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const upper = symbol?.toUpperCase() ?? "";
  const [failed, setFailed] = useState(false);
  const sz = `${size}px`;

  if (!failed && upper && LOGO_SYMBOLS.has(upper)) {
    return (
      <img
        src={`/dailyiq-brand-resources/logosvg/${upper}.svg`}
        alt={upper}
        className="shrink-0 rounded-md object-contain"
        style={{ width: sz, height: sz }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center border border-[#1A56DB]/35 bg-[#1A56DB]/15 font-mono font-bold text-[#5b9bff]"
      style={{ width: sz, height: sz, borderRadius: 4, fontSize: size * 0.35 }}
    >
      {upper[0] ?? "?"}
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
  const estimate = useOptionsEstimate(selectedSymbol, selectedExpiration, summary?.session ?? null);
  const estMap = useMemo(() => {
    const m = new Map<number, { callEst: number | null; putEst: number | null }>();
    estimate?.rows.forEach(r => m.set(r.strike, { callEst: r.call?.estPrice ?? null, putEst: r.put?.estPrice ?? null }));
    return m;
  }, [estimate]);

  useEffect(() => {
    if (!selectedSymbol) {
      setSelectedSymbol(defaultSymbol);
    }
  }, [defaultSymbol, selectedSymbol]);

  const activeMonths = useMemo(() => {
    const now = Date.now();
    return (summary?.months ?? []).map((month) => ({
      ...month,
      expirations: month.expirations.filter((e) => {
        // expiration is midnight UTC on expiry day — keep it until that day has fully passed
        const expMs = e.expiration > 1e12 ? e.expiration : e.expiration * 1000;
        return expMs + 24 * 60 * 60 * 1000 > now;
      }),
    })).filter((month) => month.expirations.length > 0);
  }, [summary]);

  const flatExpirations = useMemo(
    () => activeMonths.flatMap((month) => month.expirations),
    [activeMonths],
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
  const [strikesVisible, setStrikesVisible] = useState<number | "all">(() => {
    const saved = localStorage.getItem("options:strikesVisible");
    if (saved === "all") return "all";
    const n = Number(saved);
    return n > 0 ? n : 20;
  });

  useEffect(() => {
    localStorage.setItem("options:strikesVisible", String(strikesVisible));
  }, [strikesVisible]);
  const [visibleCols, setVisibleCols] = useState<Set<ColId>>(DEFAULT_VISIBLE_COLS);
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

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

  const visibleRows = useMemo(() => {
    const rows = chain?.rows ?? [];
    if (strikesVisible === "all" || rows.length <= strikesVisible) return rows;
    if (atmStrike == null) return rows.slice(0, strikesVisible);
    const atmIdx = rows.findIndex((r) => Math.abs(r.strike - atmStrike) < 1e-8);
    if (atmIdx < 0) return rows.slice(0, strikesVisible);
    const half = Math.floor(strikesVisible / 2);
    const start = Math.max(0, atmIdx - half);
    const end = Math.min(rows.length, start + strikesVisible);
    const adjStart = Math.max(0, end - strikesVisible);
    return rows.slice(adjStart, end);
  }, [chain?.rows, strikesVisible, atmStrike]);

  const callCols = useMemo(() => getOrderedCols(CALL_COL_IDS, visibleCols), [visibleCols]);
  const putCols  = useMemo(() => getOrderedCols(PUT_COL_IDS, visibleCols), [visibleCols]);
  const _fullTableWidth = useMemo(
    () => totalWidth(callCols) + CENTER_W + totalWidth(putCols),
    [callCols, putCols],
  );
  const underlyingPrice = summary?.underlyingPrice ?? null;

  const maxVolume = useMemo(() => {
    const rows = chain?.rows ?? [];
    let m = 1;
    for (const r of rows) {
      if ((r.call?.volume ?? 0) > m) m = r.call!.volume!;
      if ((r.put?.volume ?? 0) > m) m = r.put!.volume!;
    }
    return m;
  }, [chain?.rows]);

  function toggleCol(id: ColId, on: boolean) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }

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
            {/* Symbol identity row */}
            <div className="flex items-center gap-3">
              <SymbolLogo symbol={selectedSymbol} />
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[19px] font-semibold leading-none tracking-wide text-white">
                    {selectedSymbol || "—"}
                  </span>
                  <span className="text-white/20" aria-hidden>|</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">Options</span>
                </div>
                <p className="mt-1 text-[11px] text-white/38">Chain snapshot · collector</p>
              </div>
            </div>

            {/* Search */}
            <button
              type="button"
              onClick={() => setSymbolSearchOpen((v) => !v)}
              className={`mt-3 flex h-8 w-full max-w-xs items-center gap-2 border px-2.5 text-left transition-colors duration-100 ease-out ${
                symbolSearchOpen
                  ? "border-[#1A56DB]/50 bg-[#1A56DB]/10"
                  : "border-white/[0.08] bg-[#0D1117] hover:border-white/15 hover:bg-[#1C2128]"
              }`}
              style={{ borderRadius: 4 }}
              aria-label="Search symbol"
              aria-expanded={symbolSearchOpen}
            >
              <Search className="h-[12px] w-[12px] shrink-0 text-white/40" strokeWidth={2} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/45">
                Search symbol…
              </span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2 sm:gap-3">
            <div
              className="flex min-w-[100px] flex-col gap-0.5 border border-white/[0.10] px-3 py-2"
              style={{ backgroundColor: BG_HOVER, borderRadius: 4 }}
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">Spot</span>
              <span className="font-mono text-[14px] tabular-nums text-[#00C853]/95">
                {formatPrice(summary?.underlyingPrice)}
              </span>
            </div>
            <div
              className="flex min-w-[120px] flex-col gap-0.5 border border-white/[0.10] px-3 py-2"
              style={{ backgroundColor: BG_HOVER, borderRadius: 4 }}
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">Updated</span>
              <span
                className={`font-mono text-[12px] tabular-nums ${stale ? "text-[#F59E0B]" : "text-white/80"}`}
              >
                {formatTimestamp(summary?.capturedAt)}
              </span>
            </div>
            <div
              className="flex min-w-[88px] flex-col gap-0.5 border border-white/[0.10] px-3 py-2"
              style={{ backgroundColor: BG_HOVER, borderRadius: 4 }}
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">Source</span>
              <span className="flex items-center gap-1.5 font-mono text-[12px] uppercase text-white/85">
                <Radio className="h-3.5 w-3.5 text-[#1A56DB]" strokeWidth={2} aria-hidden />
                {sourceLabel(summary?.source)}
              </span>
            </div>
          </div>
        </div>

        {/* Expirations + strike count */}
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-white/55">
              <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              <span className="font-mono text-[10px] uppercase tracking-[0.16em]">Expirations</span>
            </div>
            {/* Strike count chips + custom input */}
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/40">Strikes</span>
              {([4, 7, 10, 20, 50, "all"] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setStrikesVisible(n)}
                  className={`h-6 min-w-[28px] border px-1.5 font-mono text-[10px] uppercase tracking-[0.04em] transition-colors duration-100 ${
                    strikesVisible === n
                      ? "border-[#1A56DB]/60 bg-[#1A56DB]/20 text-[#a8c8ff]"
                      : "border-white/[0.10] bg-[#1C2128] text-white/55 hover:border-white/20 hover:text-white/80"
                  }`}
                  style={{ borderRadius: 4 }}
                >
                  {n === "all" ? "All" : `±${n}`}
                </button>
              ))}
              <input
                type="number"
                min={1}
                placeholder="±N"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = parseInt((e.target as HTMLInputElement).value, 10);
                    if (v > 0) { setStrikesVisible(v); (e.target as HTMLInputElement).blur(); }
                  }
                }}
                onBlur={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (v > 0) setStrikesVisible(v);
                }}
                className={`h-6 w-12 border bg-[#1C2128] px-1.5 text-center font-mono text-[10px] text-white/70 placeholder:text-white/25 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none transition-colors duration-100 ${
                  typeof strikesVisible === "number" && ![4,7,10,20,50].includes(strikesVisible)
                    ? "border-[#1A56DB]/60 bg-[#1A56DB]/20 text-[#a8c8ff]"
                    : "border-white/[0.10] hover:border-white/20"
                }`}
                style={{ borderRadius: 4, MozAppearance: "textfield" } as React.CSSProperties}
              />
            </div>
          </div>
          <div className="overflow-x-auto pb-1 [scrollbar-color:#2a3140_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-white/[0.14] [&::-webkit-scrollbar-track]:bg-transparent">
            <div className="flex min-w-max gap-6 pb-1">
              {activeMonths.map((month) => (
                <div
                  key={month.monthKey}
                  className="min-w-0 shrink-0"
                  style={{ minWidth: expirationMonthMinWidthPx(month.expirations) }}
                >
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/65">
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
                              ? "border-[#1A56DB] bg-[#1A56DB]/18 text-white"
                              : "border-white/[0.10] bg-[#1C2128] text-white/80 hover:border-white/20 hover:bg-[#222d3d] hover:text-white"
                          }`}
                          style={{ borderRadius: 4 }}
                        >
                          <div className="text-[11px] leading-tight">{expiration.label}</div>
                          <div className={`mt-0.5 text-[9px] ${active ? "text-white/55" : "text-white/45"}`}>{expiration.contractCount} lines</div>
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
            className="mx-3 mb-3 mt-3 flex min-h-0 flex-1 flex-col border border-white/[0.08] sm:mx-4"
            style={{ backgroundColor: BG_HOVER }}
          >
            {/* Single scroll container — header sticky inside it so both scroll together horizontally */}
            <div
              className="min-h-0 flex-1 overflow-auto [scrollbar-color:#2a3140_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-white/[0.14] [&::-webkit-scrollbar-track]:bg-transparent"
              style={{ backgroundColor: BG_HOVER }}
            >
            {/* Sticky header block */}
            <div className="sticky top-0 z-20 shrink-0" style={{ backgroundColor: BG_HOVER }}>
              {/* Calls / Puts banner — flex-1 so each side spans full available width */}
              <div className="flex w-full border-b border-white/[0.06]">
                {estimate && <div className="shrink-0 border-r border-white/[0.06]" style={{ width: 88 }} />}
                <div
                  className="flex flex-1 items-center justify-end py-2.5 px-4"
                  style={{ minWidth: totalWidth(callCols) }}
                >
                  <span className="font-mono text-[15px] font-semibold tracking-[0.06em] text-[#00C853]">Calls</span>
                </div>
                <div
                  className="relative flex shrink-0 items-center justify-center gap-3 border-x border-white/[0.06] py-2.5"
                  style={{ width: CENTER_W, minWidth: CENTER_W }}
                >
                  <span className="font-mono text-[11px] tabular-nums text-white/60">{chain?.expirationLabel ?? "—"}</span>
                  <div ref={colPickerRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setShowColPicker(v => !v)}
                      className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors duration-75 ${
                        showColPicker
                          ? "border-[#1A56DB]/50 bg-[#1A56DB]/15 text-[#a8c8ff]"
                          : "border-white/[0.15] text-white hover:border-white/30"
                      }`}
                    >
                      <SlidersHorizontal className="h-2.5 w-2.5" strokeWidth={1.8} />
                      Cols
                    </button>
                    {showColPicker && (
                      <ColumnPicker
                        visible={visibleCols}
                        onChange={toggleCol}
                        onClose={() => setShowColPicker(false)}
                      />
                    )}
                  </div>
                </div>
                <div
                  className="flex flex-1 items-center justify-start py-2.5 px-4"
                  style={{ minWidth: totalWidth(putCols) }}
                >
                  <span className="font-mono text-[15px] font-semibold tracking-[0.06em] text-[#FF3D71]">Puts</span>
                </div>
                {estimate && <div className="shrink-0 border-l border-white/[0.06]" style={{ width: 88 }} />}
              </div>
              {/* Column labels */}
              <div className="flex border-b border-white/[0.06]">
                {estimate && (
                  <div className="flex shrink-0 items-center justify-center border-r border-white/[0.06] font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-[#F59E0B]/80" style={{ width: 88 }}>
                    Est. Price
                  </div>
                )}
                <div className="flex flex-1 justify-end" style={{ minWidth: totalWidth(callCols) }}>
                  <ChainHeaderLabels isCall={true} cols={callCols} />
                </div>
                {/* Center header: Strike | IV */}
                <div
                  className="flex items-center border-x border-white/[0.06] font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-white"
                  style={{ width: CENTER_W, minWidth: CENTER_W }}
                >
                  <div className="pr-2 text-right" style={{ width: 130 }}>Strike</div>
                  <div className="border-l border-white/[0.08] pl-2 text-left" style={{ width: 130 }}>IV</div>
                </div>
                <div className="flex flex-1 justify-start" style={{ minWidth: totalWidth(putCols) }}>
                  <ChainHeaderLabels isCall={false} cols={putCols} />
                </div>
                {estimate && (
                  <div className="flex shrink-0 items-center justify-center border-l border-white/[0.06] font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-[#F59E0B]/80" style={{ width: 88 }}>
                    Est. Price
                  </div>
                )}
              </div>
            </div>

            <div>
              {chainLoading ? (
                <div className="px-3 py-2 sm:px-4">
                  <ChainSkeletonRows />
                </div>
              ) : chainError ? (
                <div className="flex h-48 items-center justify-center px-4 text-[13px] text-[#FF3D71]/90">
                  {chainError}
                </div>
              ) : !(chain?.rows.length) ? (
                <div className="flex h-48 items-center justify-center font-mono text-[11px] text-white/45">
                  Select an expiration with stored contracts.
                </div>
              ) : (
                <div className="pb-4 pt-0">
                  {visibleRows.map((row) => {
                    const atm = isAtmRow(row.strike);
                    const callItm = row.call?.inTheMoney === true;
                    const putItm  = row.put?.inTheMoney === true;
                    const _callVolPct = row.call?.volume && maxVolume > 0 ? Math.min((row.call.volume / maxVolume) * 100, 100) : 0;
                    const _putVolPct  = row.put?.volume  && maxVolume > 0 ? Math.min((row.put.volume  / maxVolume) * 100, 100) : 0;
                    const midIv = row.call?.impliedVolatility ?? row.put?.impliedVolatility;
                    return (
                      <div key={row.strike}>
                        {atm && (
                          <div className="flex w-full items-center py-2">
                            <div className="h-px flex-1 bg-white/[0.12]" />
                            <div className="mx-4 flex items-center gap-2 whitespace-nowrap">
                              <SymbolLogo symbol={selectedSymbol} size={20} />
                              <span className="font-mono text-[13px] font-semibold text-[#F59E0B]/80">${selectedSymbol}</span>
                              {underlyingPrice != null && (
                                <span className="font-mono text-[13px] font-semibold tabular-nums text-[#00C853]">${formatPrice(underlyingPrice)}</span>
                              )}
                            </div>
                            <div className="h-px flex-1 bg-white/[0.12]" />
                          </div>
                        )}
                        <div
                          className={`flex min-h-[40px] items-stretch border-b transition-colors duration-75 ease-out ${
                            atm ? "border-[#1A56DB]/20 bg-[#1A56DB]/[0.05]" : "border-white/[0.05] hover:bg-white/[0.03]"
                          }`}
                        >
                          {estimate && (() => {
                            const est = estMap.get(row.strike);
                            const callEst = est?.callEst ?? null;
                            return (
                              <div className="flex shrink-0 items-center justify-center border-r border-[#F59E0B]/20 bg-[#F59E0B]/[0.14]" style={{ width: 88 }}>
                                <span className={`font-mono text-[13px] tabular-nums ${callEst != null ? "font-semibold text-[#F59E0B]" : "text-white/20"}`}>
                                  {callEst != null ? `$${formatPrice(callEst)}` : "—"}
                                </span>
                              </div>
                            );
                          })()}
                          <div className={`flex flex-1 justify-end ${callItm ? "bg-[#00C853]/[0.07]" : ""}`} style={{ minWidth: totalWidth(callCols) }}>
                            <SideMetrics
                              side={row.call} isCall={true} itm={callItm}
                              cols={callCols} strike={row.strike}
                              underlyingPrice={underlyingPrice} maxVolume={maxVolume}
                            />
                          </div>
                          {/* Center: Strike IV */}
                          <div
                            className={`flex flex-col items-center justify-center border-x py-1.5 ${atm ? "border-x-[#1A56DB]/25 bg-[#1A56DB]/[0.04]" : "border-x-white/[0.05]"}`}
                            style={{ width: CENTER_W, minWidth: CENTER_W }}
                          >
                            <div className="flex w-full items-center">
                              <div className="pr-2 text-right" style={{ width: 130 }}>
                                <span className={`font-mono text-[15px] font-semibold tabular-nums ${atm ? "text-white" : "text-white/88"}`}>
                                  {formatPrice(row.strike)}
                                </span>
                              </div>
                              <div className="border-l border-white/[0.08] pl-2 font-mono text-[13px] tabular-nums text-white/50" style={{ width: 130 }}>
                                {formatIv(midIv)}
                              </div>
                            </div>
                          </div>
                          <div className={`flex flex-1 justify-start ${putItm ? "bg-[#FF3D71]/[0.07]" : ""}`} style={{ minWidth: totalWidth(putCols) }}>
                            <SideMetrics
                              side={row.put} isCall={false} itm={putItm}
                              cols={putCols} strike={row.strike}
                              underlyingPrice={underlyingPrice} maxVolume={maxVolume}
                            />
                          </div>
                          {estimate && (() => {
                            const est = estMap.get(row.strike);
                            const putEst = est?.putEst ?? null;
                            return (
                              <div className="flex shrink-0 items-center justify-center border-l border-[#F59E0B]/20 bg-[#F59E0B]/[0.14]" style={{ width: 88 }}>
                                <span className={`font-mono text-[13px] tabular-nums ${putEst != null ? "font-semibold text-[#F59E0B]" : "text-white/20"}`}>
                                  {putEst != null ? `$${formatPrice(putEst)}` : "—"}
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </div> {/* end single scroll container */}
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

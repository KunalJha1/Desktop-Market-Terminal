import { useEffect, useMemo, useRef, useState, memo } from "react";
import { Calendar, Search, Radio, SlidersHorizontal } from "lucide-react";
import SymbolSearchModal from "../components/SymbolSearchModal";
import { LOGO_SYMBOLS } from "../lib/logo-symbols";
import {
  useDefaultOptionsSymbol,
  useOptionsChain,
  useOptionsEstimate,
  useOptionsRefresh,
  useOptionsSummary,
  type OptionSide,
} from "../lib/use-options-data";
import { usePortfolioData } from "../lib/use-portfolio-data";
import {
  useOptionsAnalytics,
  type AnalyticsHighlightType,
} from "../lib/use-options-analytics";

const BG_BASE = "#0D1117";
const BG_PANEL = "#161B22";
const BG_HOVER = "#1C2128";

const ANALYTICS_COLORS: Record<AnalyticsHighlightType, string> = {
  coveredCall: "#F59E0B",
  equivalentPut: "#8B5CF6",
  resistance: "#FF3D71",
  support: "#00C853",
};

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
const DEFAULT_VISIBLE_COLS = new Set<ColId>(
  (Object.values(COL_MAP) as ColDef[]).filter(c => c.defaultVisible).map(c => c.id)
);

const COL_CATEGORIES: { label: string; ids: ColId[] }[] = [
  { label: "Price",   ids: ["bid","ask","spread","ltp","theoretical"] },
  { label: "Derived", ids: ["iv","bidPct","askPct","annBidPct","annAskPct","intrinsic","timeVal","be","toBePct","distance","retDist"] },
  { label: "Greeks",  ids: ["delta","theta","gamma","vega","rho"] },
  { label: "Visual",  ids: ["volBar"] },
];

function getOrderedColsFromOrder(order: ColId[], visible: Set<ColId>, widthOverrides: Partial<Record<ColId, number>>): ColDef[] {
  return order.filter(id => visible.has(id)).map(id => ({
    ...COL_MAP[id],
    width: widthOverrides[id] ?? COL_MAP[id].width,
  }));
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

function sideKey(s: OptionSide | null): string {
  if (!s) return "";
  return `${s.bid}|${s.ask}|${s.mid}|${s.impliedVolatility}|${s.delta}|${s.gamma}|${s.theta}|${s.vega}|${s.volume}|${s.openInterest}|${s.inTheMoney}`;
}

const SideMetrics = memo(function SideMetrics({
  side, isCall, cols, strike, underlyingPrice, maxVolume,
}: {
  side: OptionSide | null; isCall: boolean;
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
}, (prev, next) =>
  prev.isCall === next.isCall &&
  prev.strike === next.strike &&
  prev.underlyingPrice === next.underlyingPrice &&
  prev.maxVolume === next.maxVolume &&
  prev.cols === next.cols &&
  sideKey(prev.side) === sideKey(next.side)
);

function ChainHeaderLabels({
  isCall, cols, headerRef, onResize, onStartDrag, dragColId, insertBeforeId,
}: {
  isCall: boolean;
  cols: ColDef[];
  headerRef?: React.RefObject<HTMLDivElement>;
  onResize: (id: ColId, e: React.MouseEvent) => void;
  onStartDrag?: (id: ColId, e: React.MouseEvent) => void;
  dragColId: ColId | null;
  insertBeforeId: ColId | null;
}) {
  const w = totalWidth(cols);
  return (
    <div
      ref={isCall ? headerRef : undefined}
      className={`grid font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-white ${isCall ? "text-right" : "text-left"}`}
      style={{ gridTemplateColumns: gridTemplate(cols), width: w, minWidth: w }}
    >
      {cols.map(col => {
        const isDragging = dragColId === col.id;
        return (
          <div
            key={col.id}
            title={col.label}
            className={`group relative truncate px-1.5 py-2 select-none ${isCall && onStartDrag ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-40" : ""}`}
            onMouseDown={isCall && onStartDrag ? (e) => onStartDrag(col.id, e) : undefined}
          >
            {/* Reorder insertion indicator */}
            {isCall && insertBeforeId === col.id && (
              <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-0.5 bg-[#1A56DB]" />
            )}
            <span className="truncate">{col.label}</span>
            {/* Resize handle on right edge */}
            <div
              className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize opacity-0 transition-opacity duration-75 group-hover:opacity-100 hover:bg-[#1A56DB]/60"
              onMouseDown={(e) => { e.stopPropagation(); onResize(col.id, e); }}
            />
          </div>
        );
      })}
    </div>
  );
}

function ColumnPicker({
  visible, onChange, onClose, onReset,
}: {
  visible: Set<ColId>; onChange: (id: ColId, on: boolean) => void; onClose: () => void; onReset: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="absolute right-2 top-full z-40 mt-1 w-72 border border-white/[0.10] bg-[#1a2130] p-3 shadow-2xl shadow-black/50"
        style={{ borderRadius: 6 }}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">Toggle Columns</p>
          <button
            type="button"
            onClick={onReset}
            className="border border-white/[0.10] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/40 transition-colors duration-75 hover:border-white/20 hover:text-white/65"
            style={{ borderRadius: 3 }}
          >
            Reset
          </button>
        </div>
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
  const { refreshing } = useOptionsRefresh(selectedSymbol, selectedExpiration, summary?.session ?? null, summary?.source ?? null);
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

  // ── Column order + width overrides (persisted) ─────────────────────────────
  const [callColOrder, setCallColOrder] = useState<ColId[]>(() => {
    try {
      const saved = localStorage.getItem("options_col_order");
      if (saved) return JSON.parse(saved) as ColId[];
    } catch { /* ignore */ }
    return CALL_COL_IDS;
  });
  const [colWidthOverrides, setColWidthOverrides] = useState<Partial<Record<ColId, number>>>(() => {
    try {
      const saved = localStorage.getItem("options_col_widths");
      if (saved) return JSON.parse(saved) as Partial<Record<ColId, number>>;
    } catch { /* ignore */ }
    return {};
  });
  const [dragColId, setDragColId] = useState<ColId | null>(null);
  const [insertBeforeId, setInsertBeforeId] = useState<ColId | null>(null);
  const callHeaderRef = useRef<HTMLDivElement>(null);
  const insertBeforeIdRef = useRef<ColId | null>(null);

  function handleColResize(id: ColId, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidthOverrides[id] ?? COL_MAP[id].width;
    const MIN_W = 48;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(MIN_W, startW + (ev.clientX - startX));
      setColWidthOverrides(prev => ({ ...prev, [id]: newW }));
    };
    const onUp = () => {
      setColWidthOverrides(prev => {
        localStorage.setItem("options_col_widths", JSON.stringify(prev));
        return prev;
      });
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function startColDrag(id: ColId, e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    let didDrag = false;
    setDragColId(id);
    insertBeforeIdRef.current = null;

    const onMove = (ev: MouseEvent) => {
      if (!didDrag && Math.abs(ev.clientX - startX) > 4) didDrag = true;
      if (!didDrag) return;
      if (!callHeaderRef.current) return;
      const rect = callHeaderRef.current.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      // Use latest callColOrder + visibleCols + colWidthOverrides captured in closure
      let cum = 0;
      let foundId: ColId | null = null;
      for (const cid of callColOrder) {
        if (!visibleCols.has(cid)) continue;
        const w = colWidthOverrides[cid] ?? COL_MAP[cid].width;
        if (x < cum + w / 2) { foundId = cid; break; }
        cum += w;
      }
      insertBeforeIdRef.current = foundId;
      setInsertBeforeId(foundId);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setDragColId(null);
      const dst = insertBeforeIdRef.current;
      insertBeforeIdRef.current = null;
      setInsertBeforeId(null);
      if (!didDrag || !dst || dst === id) return;
      setCallColOrder(prev => {
        const next = prev.filter(cid => cid !== id);
        const dstIdx = next.indexOf(dst);
        if (dstIdx === -1) { next.push(id); } else { next.splice(dstIdx, 0, id); }
        localStorage.setItem("options_col_order", JSON.stringify(next));
        return next;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function resetColLayout() {
    setCallColOrder(CALL_COL_IDS);
    setColWidthOverrides({});
    localStorage.removeItem("options_col_order");
    localStorage.removeItem("options_col_widths");
  }

  // ── Analytics: portfolio cost basis + manual override ───────────────────────
  const { positions } = usePortfolioData();

  const portfolioCostBasis = useMemo(() => {
    const match = positions.find(
      (p) => p.symbol.toUpperCase() === selectedSymbol.toUpperCase() && p.secType === "STK",
    );
    return match?.avgCost ?? null;
  }, [positions, selectedSymbol]);

  const [manualCostBasis, setManualCostBasis] = useState<number | null>(null);
  const [manualCostBasisInput, setManualCostBasisInput] = useState<string>("");

  useEffect(() => {
    setManualCostBasis(null);
    setManualCostBasisInput("");
  }, [selectedSymbol]);

  const effectiveCostBasis = manualCostBasis ?? portfolioCostBasis;

  const [hoveredAnalytics, setHoveredAnalytics] = useState<{
    strike: number;
    x: number;
    y: number;
  } | null>(null);

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

  const callCols = useMemo(
    () => getOrderedColsFromOrder(callColOrder, visibleCols, colWidthOverrides),
    [callColOrder, visibleCols, colWidthOverrides],
  );
  const putCols = useMemo(() => [...callCols].reverse(), [callCols]);

  const underlyingPrice = summary?.underlyingPrice ?? null;
  const analytics = useOptionsAnalytics(chain ?? null, effectiveCostBasis, underlyingPrice);

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
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">
                {refreshing ? "Fetching…" : "Updated"}
              </span>
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

        {/* Analytics: cost basis input + legend chips */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
            Analytics
          </span>
          {portfolioCostBasis != null && manualCostBasis == null && (
            <span className="font-mono text-[11px] text-white/50">
              Portfolio avg cost:{" "}
              <span className="text-[#F59E0B]/80">${formatPrice(portfolioCostBasis)}</span>
            </span>
          )}
          <div className="flex items-center gap-1.5" title="Your average cost per share of the underlying stock. Used to highlight the best covered call and equivalent put strikes for your position.">
            <span className="font-mono text-[10px] text-white/40">Stock avg cost</span>
            <input
              type="number"
              min={0}
              step={0.01}
              placeholder={portfolioCostBasis != null ? String(portfolioCostBasis.toFixed(2)) : "avg cost / share"}
              value={manualCostBasisInput}
              onChange={(e) => {
                setManualCostBasisInput(e.target.value);
                const v = parseFloat(e.target.value);
                setManualCostBasis(!isNaN(v) && v > 0 ? v : null);
              }}
              className="h-6 w-28 border border-white/[0.10] bg-[#1C2128] px-1.5 text-center font-mono text-[10px] text-white/70 placeholder:text-white/25 focus:outline-none focus:border-[#F59E0B]/50 transition-colors duration-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              style={{ borderRadius: 4, MozAppearance: "textfield" } as React.CSSProperties}
            />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {analytics.bestCoveredCall != null && (
              <span className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color: ANALYTICS_COLORS.coveredCall }}>
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: ANALYTICS_COLORS.coveredCall }} />
                CC @${formatPrice(analytics.bestCoveredCall)}
              </span>
            )}
            {analytics.equivalentPut != null && (
              <span className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color: ANALYTICS_COLORS.equivalentPut }}>
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: ANALYTICS_COLORS.equivalentPut }} />
                NP @${formatPrice(analytics.equivalentPut)}
              </span>
            )}
            {analytics.resistance != null && (
              <span className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color: ANALYTICS_COLORS.resistance }}>
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: ANALYTICS_COLORS.resistance }} />
                Res @${formatPrice(analytics.resistance)}
              </span>
            )}
            {analytics.support != null && (
              <span className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color: ANALYTICS_COLORS.support }}>
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: ANALYTICS_COLORS.support }} />
                Sup @${formatPrice(analytics.support)}
              </span>
            )}
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
                        onReset={() => { resetColLayout(); setVisibleCols(DEFAULT_VISIBLE_COLS); }}
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
                  <ChainHeaderLabels
                    isCall={true}
                    cols={callCols}
                    headerRef={callHeaderRef}
                    onResize={handleColResize}
                    onStartDrag={startColDrag}
                    dragColId={dragColId}
                    insertBeforeId={insertBeforeId}
                  />
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
                  <ChainHeaderLabels
                    isCall={false}
                    cols={putCols}
                    onResize={handleColResize}
                    dragColId={dragColId}
                    insertBeforeId={null}
                  />
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

                    const midIv = row.call?.impliedVolatility ?? row.put?.impliedVolatility;

                    // Analytics highlights
                    const rowDetails = analytics.details.get(row.strike);
                    const isResistance = analytics.resistance === row.strike;
                    const isSupport = analytics.support === row.strike;
                    const isCoveredCall = analytics.bestCoveredCall === row.strike;
                    const isEquivPut = analytics.equivalentPut === row.strike;
                    const hasAnalytics = (rowDetails?.length ?? 0) > 0;
                    const rowBorderLeft = isResistance
                      ? ANALYTICS_COLORS.resistance
                      : isSupport
                        ? ANALYTICS_COLORS.support
                        : "transparent";
                    const rowBgExtra = isResistance
                      ? "bg-[#FF3D71]/[0.06]"
                      : isSupport
                        ? "bg-[#00C853]/[0.06]"
                        : "";

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
                          } ${rowBgExtra}`}
                          style={{ borderLeft: `4px solid ${rowBorderLeft}` }}
                          onMouseEnter={hasAnalytics ? (e) => setHoveredAnalytics({ strike: row.strike, x: e.clientX, y: e.clientY }) : undefined}
                          onMouseMove={hasAnalytics ? (e) => setHoveredAnalytics((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null) : undefined}
                          onMouseLeave={hasAnalytics ? () => setHoveredAnalytics(null) : undefined}
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
                          <div
                            className={`flex flex-1 items-center justify-end ${callItm ? "bg-[#00C853]/[0.07]" : ""} ${isCoveredCall ? "bg-[#F59E0B]/[0.08]" : ""}`}
                            style={{ minWidth: totalWidth(callCols), borderLeft: isCoveredCall ? "2px solid rgba(245,158,11,0.5)" : undefined }}
                          >
                            <SideMetrics
                              side={row.call} isCall={true}
                              cols={callCols} strike={row.strike}
                              underlyingPrice={underlyingPrice} maxVolume={maxVolume}
                            />
                            {isCoveredCall && (
                              <div className="flex shrink-0 items-center pr-2">
                                <span className="rounded border border-[#F59E0B]/40 bg-[#F59E0B]/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#F59E0B]">
                                  CC
                                </span>
                              </div>
                            )}
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
                          <div
                            className={`flex flex-1 items-center justify-start ${putItm ? "bg-[#FF3D71]/[0.07]" : ""} ${isEquivPut ? "bg-[#8B5CF6]/[0.08]" : ""}`}
                            style={{ minWidth: totalWidth(putCols), borderRight: isEquivPut ? "2px solid rgba(139,92,246,0.5)" : undefined }}
                          >
                            {isEquivPut && (() => {
                              const putBid = row.put?.bid ?? null;
                              const callBid = row.call?.bid ?? null;
                              const putHigher = putBid != null && callBid != null && putBid > callBid;
                              return (
                                <div className="flex shrink-0 items-center pl-2">
                                  <span className="rounded border border-[#8B5CF6]/40 bg-[#8B5CF6]/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#8B5CF6]">
                                    {putHigher ? "NP ▲" : "NP"}
                                  </span>
                                </div>
                              );
                            })()}
                            <SideMetrics
                              side={row.put} isCall={false}
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

      {/* Analytics floating tooltip */}
      {hoveredAnalytics && (() => {
        const details = analytics.details.get(hoveredAnalytics.strike);
        if (!details || details.length === 0) return null;
        const tooltipWidth = 264;
        const x = Math.min(hoveredAnalytics.x + 14, window.innerWidth - tooltipWidth - 8);
        const y = Math.min(hoveredAnalytics.y + 14, window.innerHeight - 220);
        return (
          <div
            style={{
              position: "fixed",
              left: x,
              top: y,
              width: tooltipWidth,
              zIndex: 9999,
              pointerEvents: "none",
              backgroundColor: "#161B22",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 6,
              padding: "10px 12px",
            }}
          >
            {details.map((d, i) => (
              <div key={d.type} style={i > 0 ? { marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.07)" } : {}}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, backgroundColor: ANALYTICS_COLORS[d.type], flexShrink: 0 }} />
                  <span style={{ fontFamily: "monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: ANALYTICS_COLORS[d.type], fontWeight: 600 }}>
                    {d.label}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.5, marginBottom: 8, marginTop: 0 }}>
                  {d.explanation}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", alignItems: "baseline" }}>
                  {d.metrics.annualizedReturn != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>Ann. Return</span>
                      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: ANALYTICS_COLORS[d.type], fontVariantNumeric: "tabular-nums" }}>
                        {(d.metrics.annualizedReturn * 100).toFixed(1)}%
                      </span>
                    </>
                  )}
                  {d.metrics.premium != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>Bid Premium</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.82)", fontVariantNumeric: "tabular-nums" }}>${formatPrice(d.metrics.premium)}</span>
                    </>
                  )}
                  {d.metrics.delta != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>Delta</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.82)", fontVariantNumeric: "tabular-nums" }}>
                        {formatGreek(d.metrics.delta, 2)}
                        {d.type === "coveredCall" && d.metrics.delta != null && (
                          <span style={{ marginLeft: 4, fontSize: 10, color: Math.abs(d.metrics.delta) >= 0.20 && Math.abs(d.metrics.delta) <= 0.35 ? "#00C853" : "rgba(255,255,255,0.40)" }}>
                            {Math.abs(d.metrics.delta) >= 0.20 && Math.abs(d.metrics.delta) <= 0.35 ? "✓ sweet spot" : Math.abs(d.metrics.delta) < 0.20 ? "low prem" : "assign risk"}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  {d.metrics.dte != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>DTE</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.82)", fontVariantNumeric: "tabular-nums" }}>
                        {d.metrics.dte}d
                        {(d.type === "coveredCall" || d.type === "equivalentPut") && (
                          <span style={{ marginLeft: 4, fontSize: 10, color: d.metrics.dte >= 21 && d.metrics.dte <= 45 ? "#00C853" : "rgba(255,255,255,0.40)" }}>
                            {d.metrics.dte >= 21 && d.metrics.dte <= 45 ? "✓ theta window" : d.metrics.dte < 21 ? "short" : "long"}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  {d.metrics.iv != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>IV</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: d.metrics.iv >= 0.35 ? "#F59E0B" : "rgba(255,255,255,0.82)", fontVariantNumeric: "tabular-nums" }}>
                        {formatIv(d.metrics.iv)}
                        {d.metrics.iv >= 0.35 && <span style={{ marginLeft: 4, fontSize: 10, color: "#F59E0B" }}>elevated</span>}
                      </span>
                    </>
                  )}
                  {d.metrics.assignmentCushion != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>Cushion</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: d.metrics.assignmentCushion >= 0.03 ? "#00C853" : "rgba(255,255,255,0.65)", fontVariantNumeric: "tabular-nums" }}>
                        +{(d.metrics.assignmentCushion * 100).toFixed(1)}% above cost
                      </span>
                    </>
                  )}
                  {d.metrics.spreadPct != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>B/A Spread</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: d.metrics.spreadPct <= 0.10 ? "rgba(255,255,255,0.82)" : "#F59E0B", fontVariantNumeric: "tabular-nums" }}>
                        {(d.metrics.spreadPct * 100).toFixed(1)}%
                        {d.metrics.spreadPct > 0.20 && <span style={{ marginLeft: 4, fontSize: 10, color: "#F59E0B" }}>wide</span>}
                      </span>
                    </>
                  )}
                  {d.metrics.callOI != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>Call OI</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.82)", fontVariantNumeric: "tabular-nums" }}>{formatVolume(d.metrics.callOI)}</span>
                    </>
                  )}
                  {d.metrics.callVolume != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>Call Vol</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.82)", fontVariantNumeric: "tabular-nums" }}>{formatVolume(d.metrics.callVolume)}</span>
                    </>
                  )}
                  {d.metrics.putOI != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>Put OI</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.82)", fontVariantNumeric: "tabular-nums" }}>{formatVolume(d.metrics.putOI)}</span>
                    </>
                  )}
                  {d.metrics.putVolume != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>Put Vol</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.82)", fontVariantNumeric: "tabular-nums" }}>{formatVolume(d.metrics.putVolume)}</span>
                    </>
                  )}
                  {d.metrics.comparePremium != null && d.metrics.premium != null && (
                    <>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap" }}>vs Call bid</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: d.metrics.premium > d.metrics.comparePremium ? ANALYTICS_COLORS.equivalentPut : "rgba(255,255,255,0.55)", fontVariantNumeric: "tabular-nums" }}>
                        ${formatPrice(d.metrics.comparePremium)} call
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

export default memo(OptionsPage);

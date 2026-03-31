import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { Search, X } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import CustomSelect from "./CustomSelect";
import SymbolSearchModal from "./SymbolSearchModal";
import { LOGO_SYMBOLS } from "../lib/logo-symbols";
import { useWatchlistData } from "../lib/use-market-data";
import { useSidecarPort } from "../lib/tws";
import { linkBus } from "../lib/link-bus";

const MAX_SYMBOLS = 10;
const POLL_INTERVAL_MS = 30_000;
const TIMEFRAME_OPTIONS = ["5m", "15m", "1h", "1d", "1w"] as const;
const LOOKBACK_OPTIONS = [1, 2, 3, 5, 8] as const;
const TIMEFRAME_SELECT_OPTIONS = TIMEFRAME_OPTIONS.map((option) => ({
  value: option,
  label: option.toUpperCase(),
}));
const LOOKBACK_SELECT_OPTIONS = LOOKBACK_OPTIONS.map((option) => ({
  value: String(option),
  label: `${option} bars`,
}));

type DetectorTimeframe = (typeof TIMEFRAME_OPTIONS)[number];

interface LiquiditySweepStatus {
  direction: "bull" | "bear" | null;
  eventTs: number | null;
  ageBars: number | null;
  ageMinutes: number | null;
  source: string | null;
}

interface LiquiditySweepDetectorCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

function readSymbols(config: Record<string, unknown>): string[] {
  const raw = config.symbols;
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((value) => (typeof value === "string" ? value.trim().toUpperCase() : ""))
        .filter(Boolean),
    ),
  ).slice(0, MAX_SYMBOLS);
}

function readTimeframe(config: Record<string, unknown>): DetectorTimeframe {
  const raw = typeof config.timeframe === "string" ? config.timeframe : "15m";
  return (TIMEFRAME_OPTIONS as readonly string[]).includes(raw) ? (raw as DetectorTimeframe) : "15m";
}

function readLookbackBars(config: Record<string, unknown>): number {
  const raw = config.lookbackBars;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 3;
  const normalized = Math.round(raw);
  return normalized >= 1 ? Math.min(normalized, 10) : 3;
}

function sourceLabel(source: string | null): string {
  if (source === "today") return "DH/DL";
  if (source === "prevDay") return "PDH/PDL";
  if (source === "prevWeek") return "PWH/PWL";
  if (source === "prevMonth") return "PMH/PML";
  return "Sweep";
}

function sweepBlurb(direction: "bull" | "bear" | null, source: string | null, ageBars: number | null): string {
  if (!direction) return "No active sweep in lookback window";

  const levelDesc =
    source === "today"
      ? "today's intraday low/high"
      : source === "prevDay"
        ? "the prior day's high/low (PDH/PDL)"
        : source === "prevWeek"
          ? "the prior week's high/low (PWH/PWL)"
          : source === "prevMonth"
            ? "the prior month's high/low (PMH/PML)"
            : "a key level";

  const ageNote = ageBars != null && ageBars > 0
    ? ` ${ageBars} bar${ageBars === 1 ? "" : "s"} ago`
    : " on the most recent bar";

  if (direction === "bull") {
    return `Price dipped below ${levelDesc}${ageNote}, sweeping sell-side liquidity, then closed back above — signaling a potential bullish reversal as stops were hunted.`;
  } else {
    return `Price spiked above ${levelDesc}${ageNote}, sweeping buy-side liquidity, then closed back below — signaling a potential bearish reversal as stops were hunted.`;
  }
}

function formatAge(eventTs: number | null): string {
  if (eventTs == null) return "No active sweep";
  const elapsedMs = Math.max(0, Date.now() - eventTs);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return "Sweep occurred just now";
  if (elapsedMinutes < 60) return `Sweep occurred ${elapsedMinutes} min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Sweep occurred ${elapsedHours} hr ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Sweep occurred ${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

function SymbolLogo({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  const upper = symbol.toUpperCase();

  if (failed || !LOGO_SYMBOLS.has(upper)) {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] font-mono text-[8px] font-semibold text-white/55">
        {upper.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={`/dailyiq-brand-resources/logosvg/${upper}.svg`}
      alt={upper}
      className="h-6 w-6 shrink-0 rounded-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function LiquiditySweepDetectorCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  config,
  onConfigChange,
}: LiquiditySweepDetectorCardProps) {
  const sidecarPort = useSidecarPort();
  const symbols = useMemo(() => readSymbols(config), [config]);
  const timeframe = readTimeframe(config);
  const lookbackBars = readLookbackBars(config);
  const [searchOpen, setSearchOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, LiquiditySweepStatus>>({});
  const [loading, setLoading] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const { quotes, status: quoteStatus } = useWatchlistData(symbols);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pullStateRef = useRef<{
    pointerId: number | null;
    startY: number;
    active: boolean;
  }>({
    pointerId: null,
    startY: 0,
    active: false,
  });

  const refreshStatuses = useCallback(async () => {
    if (!sidecarPort || symbols.length === 0) {
      setStatuses({});
      return;
    }
    setLoading(true);
    try {
      const query = new URLSearchParams({
        symbols: symbols.join(","),
        timeframe,
        lookback_bars: String(lookbackBars),
      });
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/technicals/liquidity-sweeps?${query.toString()}`);
      if (!res.ok) return;
      const payload = (await res.json()) as Record<string, LiquiditySweepStatus>;
      setStatuses(payload);
    } catch {
      setStatuses({});
    } finally {
      setLoading(false);
    }
  }, [lookbackBars, sidecarPort, symbols, timeframe]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const runRefresh = async () => {
      try {
        await refreshStatuses();
      } catch {
        if (!cancelled) setStatuses({});
      }
    };

    void runRefresh();
    if (sidecarPort && symbols.length > 0) {
      intervalId = window.setInterval(() => {
        void runRefresh();
      }, POLL_INTERVAL_MS);
    }
    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [refreshStatuses, sidecarPort, symbols.length]);

  const resetPullState = useCallback(() => {
    pullStateRef.current = {
      pointerId: null,
      startY: 0,
      active: false,
    };
    setPullDistance(0);
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (loading || symbols.length === 0 || event.button !== 0) return;
    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollTop > 0) return;
    pullStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      active: true,
    };
  }, [loading, symbols.length]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pullState = pullStateRef.current;
    if (!pullState.active || pullState.pointerId !== event.pointerId) return;
    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollTop > 0) {
      resetPullState();
      return;
    }
    const deltaY = event.clientY - pullState.startY;
    if (deltaY <= 0) {
      setPullDistance(0);
      return;
    }
    event.preventDefault();
    setPullDistance(Math.min(80, deltaY * 0.55));
  }, [resetPullState]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pullState = pullStateRef.current;
    if (!pullState.active || pullState.pointerId !== event.pointerId) return;
    const shouldRefresh = pullDistance >= 52 && !loading;
    resetPullState();
    if (shouldRefresh) {
      void refreshStatuses();
    }
  }, [loading, pullDistance, refreshStatuses, resetPullState]);

  const persistConfig = (patch: Record<string, unknown>) => {
    onConfigChange({ ...config, ...patch });
  };

  const addSymbol = (symbol: string) => {
    const nextSymbol = symbol.trim().toUpperCase();
    if (!nextSymbol || symbols.includes(nextSymbol) || symbols.length >= MAX_SYMBOLS) return;
    persistConfig({ symbols: [...symbols, nextSymbol] });
  };

  const removeSymbol = (symbol: string) => {
    persistConfig({ symbols: symbols.filter((item) => item !== symbol) });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-white/80">Liquidity Sweeps</span>
          <span className="font-mono text-[11px] text-white/35">{symbols.length}/{MAX_SYMBOLS}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSearchOpen(true)}
            disabled={symbols.length >= MAX_SYMBOLS}
            className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-white transition-colors duration-75 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
            title={symbols.length >= MAX_SYMBOLS ? "Max 10 symbols" : "Add symbol"}
          >
            Add
          </button>
          <ComponentLinkMenu linkChannel={linkChannel} onSetLinkChannel={onSetLinkChannel} />
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

      <div className="flex items-center gap-2 border-b border-white/[0.06] px-2 py-2">
        <CustomSelect
          value={timeframe}
          onChange={(next) => persistConfig({ timeframe: next })}
          options={TIMEFRAME_SELECT_OPTIONS}
          size="sm"
          triggerClassName="h-7 min-w-[70px] px-2 font-mono text-[10px] text-white/70"
          panelClassName="bg-[#131720]"
          panelWidth={104}
        />
        <CustomSelect
          value={String(lookbackBars)}
          onChange={(next) => persistConfig({ lookbackBars: Number(next) })}
          options={LOOKBACK_SELECT_OPTIONS}
          size="sm"
          triggerClassName="h-7 min-w-[88px] px-2 font-mono text-[10px] text-white/70"
          panelClassName="bg-[#131720]"
          panelWidth={112}
        />
        <div className="min-w-0 font-mono text-[10px] leading-[1.35] text-white/30">
          {loading ? "Refreshing..." : "Latest active sweep in window"}
        </div>
      </div>

      {symbols.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-b border-white/[0.06] px-2 py-2">
          {symbols.map((symbol) => (
            <button
              key={symbol}
              onClick={() => removeSymbol(symbol)}
              className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-white/65 transition-colors duration-75 hover:bg-white/[0.10] hover:text-white"
              title={`Remove ${symbol}`}
            >
              <span>{symbol}</span>
              <X className="h-2.5 w-2.5" strokeWidth={1.6} />
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto scrollbar-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
      >
        <div
          className="flex items-end justify-center overflow-hidden border-b border-white/[0.04] px-3 text-center transition-[height,opacity] duration-150"
          style={{
            height: symbols.length > 0 || pullDistance > 0 ? pullDistance : 0,
            opacity: pullDistance > 0 ? 1 : 0,
          }}
        >
          <span className="pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/34">
            {loading ? "Refreshing..." : pullDistance >= 52 ? "Release to refresh" : "Pull to refresh"}
          </span>
        </div>
        {symbols.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 px-6 text-center">
            <Search className="h-5 w-5 text-white/18" strokeWidth={1.6} />
            <div>
              <p className="font-mono text-[12px] text-white/40">No symbols configured</p>
              <p className="mt-1 text-[11px] text-white/24">Add up to 10 symbols to monitor fresh sweep events.</p>
            </div>
          </div>
        ) : (
          symbols.map((symbol) => {
            const sweep = statuses[symbol] ?? {
              direction: null,
              eventTs: null,
              ageBars: null,
              ageMinutes: null,
              source: null,
            };
            const quote = quotes.get(symbol);
            const symbolState = quoteStatus.get(symbol) ?? "pending";
            const isBull = sweep.direction === "bull";
            const badgeClass = isBull
              ? "bg-blue text-white"
              : sweep.direction === "bear"
                ? "bg-red text-white"
                : "bg-white/[0.08] text-white/60";

            return (
              <button
                key={symbol}
                onClick={() => {
                  if (linkChannel) linkBus.publish(linkChannel, symbol);
                }}
                className="grid w-full grid-cols-[102px_minmax(0,1fr)_108px] items-start gap-3 border-b border-white/[0.04] px-3 py-2.5 text-left transition-colors duration-75 hover:bg-white/[0.05]"
              >
                <div className="flex min-w-0 items-start gap-2 pt-0.5">
                  <SymbolLogo symbol={symbol} />
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] font-semibold text-white/90">{symbol}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-white/25">
                      {timeframe.toUpperCase()}
                    </p>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-white/74">
                    {quote?.name ?? (symbolState === "error" ? "Unknown symbol" : "Loading...")}
                  </p>
                  {sweep.direction ? (
                    <>
                      <p className="mt-0.5 font-mono text-[10px] text-white/40">
                        {formatAge(sweep.eventTs)} &bull; {sourceLabel(sweep.source)}
                      </p>
                      <p className="mt-1 whitespace-normal break-words text-[10px] leading-[1.4] text-white/28">
                        {sweepBlurb(sweep.direction, sweep.source, sweep.ageBars)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 font-mono text-[10px] leading-[1.35] text-white/28">
                      No active sweep in lookback window
                    </p>
                  )}
                </div>
                <div className="flex justify-end pt-0.5">
                  <span className={`inline-flex min-w-[88px] items-center justify-center rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${badgeClass}`}>
                    {sweep.direction === "bull" ? "Bull Sweep" : sweep.direction === "bear" ? "Bear Sweep" : "No Sweep"}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      <SymbolSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectSymbol={addSymbol}
        title="Liquidity Sweep Detector"
        subtitle={`Add up to ${MAX_SYMBOLS} symbols to monitor`}
      />
    </div>
  );
}

export default memo(LiquiditySweepDetectorCard);

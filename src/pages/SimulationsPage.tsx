import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SimChart } from "../chart/components/SimChart";
import { SimulationEngine } from "../lib/simulation-engine";
import type { SimState, SessionFilter } from "../lib/simulation-engine";
import type { OHLCVBar } from "../chart/types";
import { loadCustomStrategies } from "../chart/customStrategyStorage";
import type { CustomStrategyDefinition } from "../chart/customStrategies";
import { PRESET_STRATEGIES } from "../chart/presetStrategies";
import { useSidecarPort } from "../lib/tws";
import SymbolSearchModal from "../components/SymbolSearchModal";
import ScrollArea from "../components/ScrollArea";
import CustomSelect from "../components/CustomSelect";
import { SEARCHABLE_SYMBOLS } from "../lib/market-data";
import { getTimeframeMs } from "../chart/constants";
import SimScriptPanel from "../chart/components/SimScriptPanel";
import {
  displayBarsForTimeframe,
  getMaxSimHistoricalFetchConfig,
  getSimHistoricalFetchConfig,
  normalizeHistoricalBarTimeMs,
  type RawBarSize,
} from "../lib/historical-request";

const SIM_COUNT_PRESETS = [1, 4, 9, 16, 25, 36] as const;
/** Quick day counts — use “Max” for the longest IBKR-aligned range supported for the selected timeframe (e.g. 30 years of daily bars). */
const DAY_PRESETS = [5, 22, 63, 252] as const;
const SPEEDS = [1, 2, 5, 10] as const;
const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"];
const SPEED_INTERVAL: Record<number, number> = { 1: 250, 2: 125, 5: 50, 10: 25 };

function buildCombinedStrategy(selected: CustomStrategyDefinition[]): CustomStrategyDefinition {
  return {
    id: `combined_${Date.now()}`,
    name: selected.map((s) => s.name).join(" + "),
    buyThreshold: Math.round(selected.reduce((a, s) => a + s.buyThreshold, 0) / selected.length),
    sellThreshold: Math.round(selected.reduce((a, s) => a + s.sellThreshold, 0) / selected.length),
    conditions: selected.flatMap((s) => s.conditions),
  };
}

function pickUniqueRandom(arr: typeof SEARCHABLE_SYMBOLS, count: number): string[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length)).map((s) => s.symbol);
}

function fmtPnl(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}
function fmtPct(v: number): string {
  return v.toFixed(1) + "%";
}
function fmtNum(v: number | "∞"): string {
  if (v === "∞") return "∞";
  return v.toFixed(2);
}

function parsePositiveIntOr(value: string, fallback: number): number {
  const n = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function parsePositiveFloatOr(value: string, fallback: number): number {
  const n = Number.parseFloat(String(value).trim().replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

const noSpinnerInputClass =
  "h-6 px-2 text-[11px] font-mono text-left bg-[#161B22] border border-white/[0.08] rounded text-white/70 outline-none focus:border-white/20 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [appearance:textfield]";

function aggregateMetrics(states: SimState[]) {
  const allClosed = states.flatMap((s) => s.trades);
  const totalPnl = allClosed.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const winners = allClosed.filter((t) => (t.pnl ?? 0) > 0);
  const winRate = allClosed.length > 0 ? (winners.length / allClosed.length) * 100 : 0;
  const avgPnl = allClosed.length > 0 ? totalPnl / allClosed.length : 0;
  const sharpeVals = states.map((s) => s.metrics.sharpe).filter((v) => Number.isFinite(v));
  const sharpe = sharpeVals.length > 0 ? sharpeVals.reduce((a, b) => a + b, 0) / sharpeVals.length : 0;
  const maxDd = Math.max(...states.map((s) => s.metrics.maxDrawdown), 0);
  const pfNums = states.map((s) => s.metrics.profitFactor).filter((v): v is number => typeof v === "number");
  const profitFactor: number | "∞" = pfNums.length > 0 ? pfNums.reduce((a, b) => a + b, 0) / pfNums.length : 0;
  return { totalPnl, winRate, avgPnl, sharpe, maxDrawdown: maxDd, profitFactor, totalTrades: allClosed.length };
}

function BarSeparator() {
  return <div className="w-px h-4 bg-white/[0.08] mx-1" />;
}

function CtrlBtn({
  active, onClick, children, title,
}: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`px-2 py-1 text-[11px] font-mono rounded transition-colors duration-[120ms] ${
        active
          ? "bg-white/[0.10] text-white/90"
          : "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
      }`}
    >
      {children}
    </button>
  );
}

const HOVER_TOOLTIP_DELAY_MS = 850;

/** Shows `content` after a long hover/focus dwell (not on quick pointer moves). Portaled below anchor; center X for layout. */
function DelayedHoverTip({
  content,
  delayMs = HOVER_TOOLTIP_DELAY_MS,
  children,
}: {
  content: string;
  delayMs?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTipPos({
      left: r.left + r.width / 2,
      top: r.bottom + 8,
    });
  }, []);

  const schedule = () => {
    timerRef.current = window.setTimeout(() => {
      updatePos();
      setOpen(true);
    }, delayMs);
  };
  const clear = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
    setTipPos(null);
  };

  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePos();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePos]);

  const tip =
    open && tipPos != null
      ? createPortal(
          <span
            role="tooltip"
            style={{
              position: "fixed",
              left: tipPos.left,
              top: tipPos.top,
              transform: "translateX(-50%)",
              zIndex: 99999,
              maxWidth: "min(calc(100vw - 32px), 22rem)",
            }}
            className="pointer-events-none rounded border border-white/[0.12] bg-[#161B22] px-2.5 py-2 text-left text-[10px] font-mono leading-relaxed text-white/85 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          >
            {content}
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex"
        onPointerEnter={schedule}
        onPointerLeave={clear}
        onFocus={schedule}
        onBlur={clear}
      >
        {children}
      </span>
      {tip}
    </>
  );
}

function SimulationsPage() {
  const port = useSidecarPort();

  const [strategies, setStrategies] = useState<CustomStrategyDefinition[]>([]);
  const [strategy, setStrategy] = useState<CustomStrategyDefinition | null>(null);
  const [timeframe, setTimeframe] = useState("5m");
  const [sessionsInput, setSessionsInput] = useState("5");
  /** When true, ignore “Days” and request the widest supported `/historical` span for this timeframe (daily = 30 Y, intraday = tier max — see historical-request). */
  const [historyRangeFull, setHistoryRangeFull] = useState(false);
  const [hours, setHours] = useState<SessionFilter>("regular");
  const [rollDays, setRollDays] = useState(false);
  // Single symbol (when symbolPool is empty) or pool of symbols (multi-symbol mode)
  const [symbol, setSymbol] = useState("SPY");
  const [symbolPool, setSymbolPool] = useState<string[]>([]);
  const [simCount, setSimCount] = useState(4);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [positionMode, setPositionMode] = useState<"qty" | "capital">("qty");
  const [qtyInput, setQtyInput] = useState("1");
  const [capitalInput, setCapitalInput] = useState("10000");
  const [fractionalShares, setFractionalShares] = useState(true);
  const [reinvest, setReinvest] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [scriptSource, setScriptSource] = useState("");
  const [scriptPanelWidth] = useState(340);

  // Combine popover — fixed-positioned via portal to escape overflow-x-auto clipping
  const [combineOpen, setCombineOpen] = useState(false);
  const [combinePos, setCombinePos] = useState<{ top: number; left: number } | null>(null);
  const [combineSelected, setCombineSelected] = useState<Set<string>>(new Set());
  const combineBtnRef = useRef<HTMLButtonElement>(null);

  const enginesRef = useRef<SimulationEngine[]>([]);
  const [simStates, setSimStates] = useState<SimState[]>([]);
  // Track symbol per engine for display
  const [simSymbols, setSimSymbols] = useState<string[]>([]);

  // Load saved strategies (presets always included) and keep in sync with ChartPage edits
  const refreshStrategies = useCallback(() => {
    const userList = loadCustomStrategies();
    const merged = [...PRESET_STRATEGIES, ...userList];
    setStrategies(merged);
    setStrategy((prev) => {
      // Don't overwrite a combined strategy
      if (prev?.id.startsWith("combined_")) return prev;
      if (prev && merged.some((s) => s.id === prev.id)) {
        return merged.find((s) => s.id === prev.id) ?? merged[0] ?? null;
      }
      return merged[0] ?? null;
    });
  }, []);

  useEffect(() => {
    refreshStrategies();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "dailyiq-chart-custom-strategies") refreshStrategies();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refreshStrategies);
    window.addEventListener("dailyiq-strategies-updated", refreshStrategies);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refreshStrategies);
      window.removeEventListener("dailyiq-strategies-updated", refreshStrategies);
    };
  }, [refreshStrategies]);

  // Close combine popover on outside click
  useEffect(() => {
    if (!combineOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (combineBtnRef.current && !combineBtnRef.current.contains(target)) {
        // Also check if click was inside the portal popover
        const portal = document.getElementById("combine-portal");
        if (portal && portal.contains(target)) return;
        setCombineOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [combineOpen]);

  const handleRun = useCallback(async (scriptOverride?: string, strategyOverride?: CustomStrategyDefinition) => {
    const activeScript = (scriptOverride ?? scriptSource).trim();
    const activeStrategy = strategyOverride ?? strategy;
    if (!port || (!activeStrategy && !activeScript)) return;
    if (scriptOverride !== undefined) setScriptSource(scriptOverride);
    setIsLoading(true);
    setIsRunning(false);
    setError(null);
    enginesRef.current = [];
    setSimStates([]);

    try {
      const isMulti = symbolPool.length > 0;
      const sessions = Math.min(2000, Math.max(1, parsePositiveIntOr(sessionsInput, 5)));

      // Full-range mode: widest IBKR-aligned duration per bar tier (daily = decades of 1‑day candles).
      // Custom days: capped lookback derived below for fetch sizing only when not full-range.
      const fetchCfg = historyRangeFull
        ? getMaxSimHistoricalFetchConfig(timeframe)
        : getSimHistoricalFetchConfig(
          timeframe,
          isMulti
            ? sessions
            : Math.min(sessions * simCount, 2000),
        );
      const baseUrl = `http://127.0.0.1:${port}/historical`;

      const qtyParsed = parsePositiveFloatOr(qtyInput, 1);
      const startingCapitalParsed = parsePositiveFloatOr(capitalInput, 10_000);

      // Determine symbol per sim
      const symList: string[] = isMulti
        ? Array.from({ length: simCount }, (_, i) => symbolPool[i % symbolPool.length])
        : Array(simCount).fill(symbol);

      // Fetch unique symbols in parallel
      const uniqueSyms = [...new Set(symList)];
      const barsBySymbol = new Map<string, OHLCVBar[]>();

      await Promise.all(uniqueSyms.map(async (sym) => {
        const url = new URL(baseUrl);
        url.searchParams.set("symbol", sym);
        url.searchParams.set("bar_size", fetchCfg.barSizeParam);
        url.searchParams.set("duration", fetchCfg.duration);
        url.searchParams.set("what_to_show", "TRADES");
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${sym}`);
        const json = await res.json() as {
          bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
        };
        const raw = (json.bars ?? []).map((b) => ({
          time: normalizeHistoricalBarTimeMs(Number(b.time)),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        })).filter((b) => Number.isFinite(b.time));
        barsBySymbol.set(sym, displayBarsForTimeframe(raw, fetchCfg.rawBarSize as RawBarSize, timeframe));
      }));

      // Group sim indices by symbol so we can split each symbol's data into
      // non-overlapping segments — guaranteeing each sim sees a distinct time window.
      const simIndicesBySym = new Map<string, number[]>();
      for (let i = 0; i < simCount; i++) {
        const sym = symList[i];
        if (!simIndicesBySym.has(sym)) simIndicesBySym.set(sym, []);
        simIndicesBySym.get(sym)!.push(i);
      }

      const engines: SimulationEngine[] = Array(simCount);
      const resolvedSymbols: string[] = Array(simCount);

      for (const [sym, indices] of simIndicesBySym) {
        const raw = barsBySymbol.get(sym) ?? [];
        const n = indices.length;
        // Divide this symbol's bars into n equal non-overlapping segments
        const segLen = n > 0 ? Math.floor(raw.length / n) : raw.length;

        indices.forEach((simIdx, j) => {
          const segStart = j * segLen;
          // Last segment gets any remainder so we don't waste bars
          const segEnd = j === n - 1 ? raw.length : segStart + segLen;
          const segBars = raw.slice(segStart, segEnd);

          engines[simIdx] = new SimulationEngine({
            symbol: sym,
            strategy: activeScript ? undefined : (activeStrategy ?? undefined),
            timeframe,
            rawBars: segBars.length >= 2 ? segBars : [{ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 0 }],
            startBarIndex: 0,
            sessionFilter: hours,
            rollDays,
            positionMode,
            positionQty: qtyParsed,
            startingCapital: startingCapitalParsed,
            fractionalShares,
            reinvest: positionMode === "capital" ? reinvest : false,
            scriptSource: activeScript || undefined,
          });
          resolvedSymbols[simIdx] = sym;
        });
      }

      enginesRef.current = engines;
      setSimSymbols(resolvedSymbols);
      setSimStates(engines.map((e) => e.getState()));
      setIsLoading(false);
      setIsRunning(true);
    } catch (err) {
      setError(String(err));
      setIsLoading(false);
    }
  }, [
    port,
    strategy,
    sessionsInput,
    historyRangeFull,
    symbol,
    symbolPool,
    simCount,
    timeframe,
    hours,
    rollDays,
    scriptSource,
    positionMode,
    qtyInput,
    capitalInput,
    fractionalShares,
    reinvest,
  ]);

  const handleRunCombined = useCallback(() => {
    const selected = strategies.filter((s) => combineSelected.has(s.id));
    if (selected.length < 2) return;
    const combined = buildCombinedStrategy(selected);
    setStrategy(combined);
    setCombineOpen(false);
    handleRun(undefined, combined);
  }, [strategies, combineSelected, handleRun]);

  const handleStep = useCallback(() => {
    const engines = enginesRef.current;
    if (engines.length === 0) return;
    engines.forEach((e) => { if (!e.isDone()) e.step(); });
    setSimStates(engines.map((e) => e.getState()));
  }, []);

  const handlePause = useCallback(() => {
    setIsRunning((r) => !r);
  }, []);

  // Playback loop — rAF-based for 60fps alignment; timestamp throttling enforces speed intervals
  useEffect(() => {
    if (!isRunning) return;
    const engines = enginesRef.current;
    const interval = SPEED_INTERVAL[speed] ?? 250;
    let lastStepTime = 0;
    let rafId: number;
    const tick = (now: number) => {
      if (now - lastStepTime >= interval) {
        lastStepTime = now;
        let anyRunning = false;
        engines.forEach((e) => {
          if (!e.isDone()) {
            const steps = speed >= 10 ? 8 : speed >= 5 ? 4 : speed >= 2 ? 2 : 1;
            for (let s = 0; s < steps && !e.isDone(); s++) e.step();
            anyRunning = true;
          }
        });
        setSimStates(engines.map((e) => e.getState()));
        if (!anyRunning) { setIsRunning(false); return; }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isRunning, speed]);

  const cols = Math.ceil(Math.sqrt(simCount));
  const rows = Math.ceil(simCount / cols);
  const agg = useMemo(
    () => (simStates.length > 0 ? aggregateMetrics(simStates) : null),
    [simStates],
  );
  const runningCount = useMemo(
    () => simStates.filter((s) => !s.done).length,
    [simStates],
  );
  const isMultiSymbol = symbolPool.length > 0;
  const isDailyTf = getTimeframeMs(timeframe) >= 86_400_000;

  const strategyOptions = useMemo(() => {
    const presets = strategies.filter((s) => s.id.startsWith("preset_"));
    const userStrats = strategies.filter((s) => !s.id.startsWith("preset_") && !s.id.startsWith("combined_"));
    return [
      ...(strategy?.id.startsWith("combined_")
        ? [{ value: strategy.id, label: strategy.name, description: "Combined" }]
        : []),
      ...presets.map((s) => ({ value: s.id, label: s.name, description: "Built-in" })),
      ...userStrats.map((s) => ({ value: s.id, label: s.name, description: "My Strategies" })),
    ];
  }, [strategies, strategy]);

  // Combine popover content (rendered via portal)
  const combinePopover = combineOpen && combinePos && createPortal(
    <div
      id="combine-portal"
      style={{ position: "fixed", top: combinePos.top, left: combinePos.left, zIndex: 9999 }}
      className="w-64 bg-[#161B22] border border-white/[0.10] rounded shadow-2xl"
    >
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Combine Strategies</span>
        {combineSelected.size > 0 && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setCombineSelected(new Set())}
            className="text-[9px] font-mono text-white/30 hover:text-white/60 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <ScrollArea viewportClassName="max-h-52 py-1 pr-2">
        {strategies.map((s) => {
          const checked = combineSelected.has(s.id);
          return (
            <button
              key={s.id}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                setCombineSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.id)) next.delete(s.id);
                  else next.add(s.id);
                  return next;
                });
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.04] ${checked ? "text-white/90" : "text-white/45"}`}
            >
              <span className={`w-3 h-3 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${checked ? "bg-[#1A56DB] border-[#1A56DB]" : "border-white/20"}`}>
                {checked && <span className="text-[8px] leading-none text-white">✓</span>}
              </span>
              <span className="text-[11px] font-mono truncate">{s.name}</span>
            </button>
          );
        })}
      </ScrollArea>
      {combineSelected.size >= 2 ? (
        <div className="px-3 py-2 border-t border-white/[0.06]">
          <div className="text-[9px] font-mono text-white/30 mb-1.5 truncate">
            {strategies.filter((s) => combineSelected.has(s.id)).map((s) => s.name).join(" + ")}
          </div>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleRunCombined}
            className="w-full h-6 text-[11px] font-mono bg-[#1A56DB]/80 hover:bg-[#1A56DB] text-white rounded transition-colors duration-[120ms]"
          >
            ▶ Run Combined
          </button>
        </div>
      ) : (
        <div className="px-3 py-2 border-t border-white/[0.06]">
          <span className="text-[10px] font-mono text-white/20">Select 2+ strategies to combine</span>
        </div>
      )}
    </div>,
    document.body
  );

  return (
    <div className="flex flex-col h-full bg-[#0D1117] overflow-hidden">
      {/* Top control bar */}
      <div className="flex items-center gap-1 h-10 px-3 border-b border-white/[0.06] shrink-0 overflow-x-auto">
        {/* Strategy */}
        <CustomSelect
          value={strategy?.id ?? ""}
          onChange={(next) => setStrategy(strategies.find((s) => s.id === next) ?? null)}
          options={strategyOptions}
          size="sm"
          className="w-48 shrink-0"
          triggerClassName="bg-[#161B22] border-white/[0.08] font-mono text-white/70 focus:border-white/20"
          panelWidth={260}
        />
        <CtrlBtn onClick={refreshStrategies} title="Refresh strategy list from Chart tab">↻</CtrlBtn>

        {/* Combine strategies — portal-based popover to escape overflow clipping */}
        <button
          ref={combineBtnRef}
          title="Combine multiple strategies (AND logic)"
          onClick={() => {
            if (combineOpen) {
              setCombineOpen(false);
            } else {
              const rect = combineBtnRef.current?.getBoundingClientRect();
              if (rect) setCombinePos({ top: rect.bottom + 4, left: rect.left });
              setCombineOpen(true);
            }
          }}
          className={`px-2 py-1 text-[11px] font-mono rounded transition-colors duration-[120ms] ${
            combineOpen || combineSelected.size > 0
              ? "bg-white/[0.10] text-white/90"
              : "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
          }`}
        >
          ⊕{combineSelected.size > 1 ? ` ${combineSelected.size}` : " Combine"}
        </button>
        {combinePopover}

        <BarSeparator />

        {/* Timeframe */}
        <CustomSelect
          value={timeframe}
          onChange={setTimeframe}
          options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))}
          size="sm"
          className="w-20 shrink-0"
          triggerClassName="bg-[#161B22] border-white/[0.08] font-mono text-white/70 focus:border-white/20"
        />

        {/* Lookback: custom days vs widest supported span for this timeframe */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-white/30 font-mono whitespace-nowrap">
            {historyRangeFull ? "Hist" : "Days"}
          </span>
          <div className="flex items-center rounded border border-white/[0.06] overflow-hidden h-6">
            {DAY_PRESETS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setHistoryRangeFull(false);
                  setSessionsInput(String(d));
                }}
                disabled={historyRangeFull}
                className={`px-1.5 text-[10px] font-mono h-full transition-colors disabled:opacity-35 ${
                  !historyRangeFull && parsePositiveIntOr(sessionsInput, 5) === d
                    ? "bg-white/[0.10] text-white/90"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              title="Fetch the widest historical range supported for the selected timeframe (e.g. 30 years of daily candles for symbols like SPY where the feed allows it)."
              onClick={() => setHistoryRangeFull(true)}
              className={`px-1.5 text-[10px] font-mono h-full transition-colors border-l border-white/[0.06] ${
                historyRangeFull ? "bg-white/[0.10] text-white/90" : "text-amber-300/80 hover:bg-white/[0.06]"
              }`}
            >
              Max
            </button>
          </div>
          <input
            type="text"
            inputMode="numeric"
            spellCheck={false}
            autoComplete="off"
            value={historyRangeFull ? "" : sessionsInput}
            placeholder={historyRangeFull ? "∞" : undefined}
            readOnly={historyRangeFull}
            aria-readonly={historyRangeFull}
            onChange={(e) => {
              setHistoryRangeFull(false);
              setSessionsInput(e.target.value);
            }}
            onBlur={(e) => {
              if (historyRangeFull) return;
              setSessionsInput(
                String(Math.min(2000, Math.max(1, parsePositiveIntOr(e.target.value, 5)))),
              );
            }}
            title={
              historyRangeFull
                ? "Using max available history — pick a Days preset or type days to leave full-range mode"
                : "Custom lookback length in calendar days for the fetch window (max 2000)"
            }
            className={`w-[52px] ${noSpinnerInputClass} read-only:text-white/40 read-only:pointer-events-none`}
          />
        </div>

        {/* Hours — applies to intraday bars only */}
        <CustomSelect
          value={hours}
          onChange={(next) => setHours(next as SessionFilter)}
          options={[
            { value: "regular", label: "Regular" },
            { value: "extended", label: "Extended" },
            { value: "all", label: "All Hours" },
          ]}
          size="sm"
          className="w-28 shrink-0"
          disabled={isDailyTf}
          triggerClassName={`bg-[#161B22] border-white/[0.08] font-mono focus:border-white/20 ${isDailyTf ? "opacity-45 pointer-events-none" : "text-white/70"}`}
        />
        {isDailyTf && (
          <span className="text-[9px] font-mono text-white/25 whitespace-nowrap" title="Session filter applies to intraday data only">
            intraday&nbsp;hours
          </span>
        )}

        {/* Day handling — intraday */}
        {!isDailyTf && (
          <div className="flex items-center rounded border border-white/[0.08] overflow-hidden h-6">
            <DelayedHoverTip
              content={
                "Cutoff — Session clip: each bar is kept only if its clock time (US/Eastern) falls inside the Sessions choice (Regular RTH, Extended pre/post, or All). Bars outside that window are dropped before replay and aggregation."
              }
            >
              <button
                type="button"
                onClick={() => setRollDays(false)}
                className={`px-2 text-[10px] font-mono h-full transition-colors ${!rollDays ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
              >
                Cutoff
              </button>
            </DelayedHoverTip>
            <DelayedHoverTip
              content={
                "Roll — With Sessions set to All hours, replay uses the downloaded series as-is (no ET session mask). With Regular or Extended, the same US/Eastern session window is applied as for Cutoff."
              }
            >
              <button
                type="button"
                onClick={() => setRollDays(true)}
                className={`px-2 text-[10px] font-mono h-full transition-colors ${rollDays ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
              >
                Roll
              </button>
            </DelayedHoverTip>
          </div>
        )}

        <BarSeparator />

        {/* Symbol / symbol pool */}
        {isMultiSymbol ? (
          <div className="flex items-center gap-1">
            <span className="h-6 px-2 text-[11px] font-mono flex items-center bg-[#161B22] border border-white/[0.08] rounded text-white/80">
              {symbolPool.length} symbols
            </span>
            <button
              onClick={() => setSymbolPool([])}
              title="Clear symbol pool — go back to single symbol"
              className="h-6 w-6 flex items-center justify-center text-[11px] font-mono bg-[#161B22] border border-white/[0.08] rounded text-white/50 hover:text-white/80 hover:border-white/20 transition-colors"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            title="Search symbol"
            className="w-16 h-6 px-2 text-[11px] font-mono text-center bg-[#161B22] border border-white/[0.08] rounded text-white/80 hover:border-white/20 transition-colors duration-[120ms] uppercase"
          >
            {symbol || "SPY"}
          </button>
        )}

        <CtrlBtn
          onClick={() => {
            const idx = Math.floor(Math.random() * SEARCHABLE_SYMBOLS.length);
            setSymbol(SEARCHABLE_SYMBOLS[idx].symbol);
            setSymbolPool([]);
          }}
          title="Pick a single random symbol"
        >
          Random
        </CtrlBtn>

        <CtrlBtn
          active={isMultiSymbol}
          onClick={() => {
            const picked = pickUniqueRandom(SEARCHABLE_SYMBOLS, simCount);
            setSymbolPool(picked);
          }}
          title={`Pick ${simCount} random symbols — one per simulation`}
        >
          {simCount} Random
        </CtrlBtn>

        <BarSeparator />

        {/* Parallel sim count — preset grid sizes only */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-white/25 font-mono whitespace-nowrap">Grid</span>
          <div className="flex items-center rounded border border-white/[0.08] overflow-hidden h-6">
            {SIM_COUNT_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSimCount(n)}
                title={`${n} simultaneous simulations`}
                className={`px-1.5 text-[10px] font-mono h-full transition-colors min-w-[1.75rem] ${simCount === n ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <BarSeparator />

        {/* Playback controls */}
        <CtrlBtn onClick={() => handleRun()} title="Run / restart simulations">
          {isLoading ? "..." : "▶ Run"}
        </CtrlBtn>
        <CtrlBtn onClick={handleStep} title="Step one bar">⏭ Step</CtrlBtn>
        <CtrlBtn onClick={handlePause} active={isRunning} title={isRunning ? "Pause" : "Resume"}>
          {isRunning ? "⏸" : "▶"}
        </CtrlBtn>

        {/* Speed */}
        <div className="flex items-center rounded border border-white/[0.08] overflow-hidden h-6">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-1.5 text-[10px] font-mono h-full transition-colors ${speed === s ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
            >
              {s}x
            </button>
          ))}
        </div>

        <BarSeparator />

        {/* Position sizing — qty vs capital */}
        <div className="flex items-center gap-1 shrink-0 flex-wrap">
          <div className="flex items-center rounded border border-white/[0.08] overflow-hidden h-6">
            <button
              type="button"
              title="Trade a fixed share count each entry"
              onClick={() => setPositionMode("qty")}
              className={`px-1.5 text-[10px] font-mono h-full transition-colors ${positionMode === "qty" ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
            >
              Qty
            </button>
            <button
              type="button"
              title="Size each entry from USD capital (deploy all cash on BUY)"
              onClick={() => setPositionMode("capital")}
              className={`px-1.5 text-[10px] font-mono h-full transition-colors ${positionMode === "capital" ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
            >
              $
            </button>
          </div>
          {positionMode === "qty" ? (
            <input
              type="text"
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              onBlur={() =>
                setQtyInput(String(parsePositiveFloatOr(qtyInput, 1)))
              }
              title="Shares per entry"
              className={`w-[68px] ${noSpinnerInputClass}`}
            />
          ) : (
            <input
              type="text"
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              value={capitalInput}
              onChange={(e) => setCapitalInput(e.target.value)}
              onBlur={() =>
                setCapitalInput(String(parsePositiveFloatOr(capitalInput, 10000)))
              }
              title="Starting USD allocated per BUY (capital mode)"
              className={`w-[72px] ${noSpinnerInputClass}`}
            />
          )}
          <div className="flex items-center rounded border border-white/[0.08] overflow-hidden h-6">
            <button
              type="button"
              title="Whole shares only"
              onClick={() => setFractionalShares(false)}
              className={`px-1.5 text-[10px] font-mono h-full transition-colors ${!fractionalShares ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
            >
              Int
            </button>
            <button
              type="button"
              title="Fractional share quantities"
              onClick={() => setFractionalShares(true)}
              className={`px-1.5 text-[10px] font-mono h-full transition-colors ${fractionalShares ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
            >
              Frac
            </button>
          </div>
          {positionMode === "capital" && (
            <div className="flex items-center rounded border border-white/[0.08] overflow-hidden h-6">
              <button
                type="button"
                title="After each exit, reuse starting capital only (no compounding)"
                onClick={() => setReinvest(false)}
                className={`px-1.5 text-[10px] font-mono h-full transition-colors ${!reinvest ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
              >
                Flat
              </button>
              <button
                type="button"
                title="Compound: deploy full proceeds on the next BUY"
                onClick={() => setReinvest(true)}
                className={`px-1.5 text-[10px] font-mono h-full transition-colors ${reinvest ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
              >
                Reinvest
              </button>
            </div>
          )}
        </div>

        {/* Script toggle */}
        <CtrlBtn
          onClick={() => setShowScript((v) => !v)}
          active={showScript}
          title="Toggle script editor"
        >
          {"</>"}
        </CtrlBtn>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 text-[11px] font-mono text-red-400 bg-red-400/5 border-b border-red-400/10 shrink-0">
          {error}
        </div>
      )}

      {/* Main content: chart grid + metrics pane */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Chart grid */}
        <div className="flex-1 min-w-0 p-[2px]">
          {simStates.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-[11px] text-white/20 font-mono">
                {isLoading ? "Fetching data…" : "Configure a strategy and click ▶ Run"}
              </p>
            </div>
          ) : (
            <div
              className="grid gap-[2px] h-full"
              style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
            >
              {simStates.map((state, i) => (
                <SimChart
                  key={i}
                  bars={state.tfBars}
                  scriptResult={state.scriptResult}
                  simIndex={i + 1}
                  symbol={simSymbols[i] ?? symbol}
                  pnl={state.metrics.totalPnl}
                  status={isLoading ? "loading" : state.done ? "done" : isRunning ? "running" : "idle"}
                />
              ))}
            </div>
          )}
        </div>

        {/* Script panel */}
        <SimScriptPanel
          open={showScript}
          onClose={() => setShowScript(false)}
          width={scriptPanelWidth}
          source={scriptSource}
          onSourceChange={setScriptSource}
          onRun={(src) => handleRun(src)}
        />

        {/* Metrics pane */}
        <div className="w-[280px] shrink-0 border-l border-white/[0.06] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <span className="text-[11px] font-mono text-white/50 tracking-wider uppercase">Simulations</span>
            {runningCount > 0 && (
              <span className="text-[10px] font-mono text-amber-400">{runningCount} running</span>
            )}
          </div>

          {/* Aggregate metrics */}
          {agg ? (
            <div className="px-3 py-2 border-b border-white/[0.06]">
              <div className="text-[10px] font-mono text-white/30 mb-2 uppercase tracking-wider">Aggregate</div>
              <div className="space-y-1.5">
                <MetricRow
                  label="Total PnL"
                  value={fmtPnl(agg.totalPnl)}
                  color={agg.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
                  large
                />
                <MetricRow label="Win Rate" value={fmtPct(agg.winRate)} />
                <MetricRow label="Sharpe" value={fmtNum(agg.sharpe)} />
                <MetricRow label="Max Drawdown" value={fmtPnl(-agg.maxDrawdown)} color="text-red-400" />
                <MetricRow label="Profit Factor" value={fmtNum(agg.profitFactor)} />
                <MetricRow label="Avg PnL / Trade" value={fmtPnl(agg.avgPnl)} color={agg.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"} />
                <MetricRow label="Total Trades" value={String(agg.totalTrades)} />
              </div>
            </div>
          ) : (
            <div className="px-3 py-4 border-b border-white/[0.06]">
              <p className="text-[11px] text-white/20 font-mono">No data yet</p>
            </div>
          )}

          {/* Per-sim table */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {simStates.length > 0 && (
              <>
                <div className="flex items-center px-3 h-7 border-b border-white/[0.04] sticky top-0 bg-[#0D1117]">
                  <span className="w-5 text-[9px] font-mono text-white/25">#</span>
                  {isMultiSymbol && <span className="w-10 text-[9px] font-mono text-white/25">Sym</span>}
                  <span className="flex-1 text-[9px] font-mono text-white/25">PnL</span>
                  <span className="w-10 text-right text-[9px] font-mono text-white/25">Trades</span>
                  <span className="w-10 text-right text-[9px] font-mono text-white/25">Win%</span>
                  <span className="w-12 text-right text-[9px] font-mono text-white/25">Status</span>
                </div>
                {simStates.map((state, i) => {
                  const pnlPos = state.metrics.totalPnl >= 0;
                  const simStatus = isLoading ? "loading" : state.done ? "done" : isRunning ? "running" : "idle";
                  return (
                    <div
                      key={i}
                      className="flex items-center px-3 h-8 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                    >
                      <span className="w-5 text-[10px] font-mono text-white/30">{i + 1}</span>
                      {isMultiSymbol && (
                        <span className="w-10 text-[9px] font-mono text-white/40 truncate uppercase">
                          {simSymbols[i] ?? ""}
                        </span>
                      )}
                      <span className={`flex-1 text-[11px] font-mono ${pnlPos ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPnl(state.metrics.totalPnl)}
                      </span>
                      <span className="w-10 text-right text-[10px] font-mono text-white/50">
                        {state.metrics.totalTrades}
                      </span>
                      <span className="w-10 text-right text-[10px] font-mono text-white/50">
                        {fmtPct(state.metrics.winRate)}
                      </span>
                      <span className={`w-12 text-right text-[9px] font-mono tracking-wider ${
                        simStatus === "running" ? "text-amber-400" :
                        simStatus === "done" ? "text-emerald-400" :
                        "text-white/20"
                      }`}>
                        {simStatus === "running" ? "RUN" : simStatus === "done" ? "DONE" : simStatus === "loading" ? "..." : "IDLE"}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      <SymbolSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectSymbol={(sym) => { setSymbol(sym); setSymbolPool([]); }}
        title="Symbol Search"
        subtitle="Select a symbol to simulate"
      />
    </div>
  );
}

function MetricRow({
  label, value, color, large,
}: { label: string; value: string; color?: string; large?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono text-white/35">{label}</span>
      <span className={`font-mono ${large ? "text-[13px]" : "text-[11px]"} ${color ?? "text-white/70"}`}>
        {value}
      </span>
    </div>
  );
}

export default memo(SimulationsPage);

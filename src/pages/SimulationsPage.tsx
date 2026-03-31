import { memo, useCallback, useEffect, useRef, useState } from "react";
import { SimChart } from "../chart/components/SimChart";
import { SimulationEngine } from "../lib/simulation-engine";
import type { SimState, SessionFilter } from "../lib/simulation-engine";
import type { OHLCVBar } from "../chart/types";
import { loadCustomStrategies } from "../chart/customStrategyStorage";
import type { CustomStrategyDefinition } from "../chart/customStrategies";
import { PRESET_STRATEGIES } from "../chart/presetStrategies";
import { useSidecarPort } from "../lib/tws";
import SymbolSearchModal from "../components/SymbolSearchModal";
import { SEARCHABLE_SYMBOLS } from "../lib/market-data";

const SIM_COUNTS = [1, 4, 9, 16] as const;
const SPEEDS = [1, 2, 5, 10] as const;
const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1H", "4H", "1D"];
const SPEED_INTERVAL: Record<number, number> = { 1: 250, 2: 125, 5: 50, 10: 25 };

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

function SimulationsPage() {
  const port = useSidecarPort();

  const [strategies, setStrategies] = useState<CustomStrategyDefinition[]>([]);
  const [strategy, setStrategy] = useState<CustomStrategyDefinition | null>(null);
  const [timeframe, setTimeframe] = useState("5m");
  const [sessions, setSessions] = useState(5);
  const [hours, setHours] = useState<SessionFilter>("regular");
  const [rollDays, setRollDays] = useState(false);
  const [symbol, setSymbol] = useState("SPY");
  const [simCount, setSimCount] = useState<(typeof SIM_COUNTS)[number]>(4);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [positionSize, setPositionSize] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [scriptSource, setScriptSource] = useState("");

  const enginesRef = useRef<SimulationEngine[]>([]);
  const [simStates, setSimStates] = useState<SimState[]>([]);

  // Load saved strategies (presets always included) and keep in sync with ChartPage edits
  const refreshStrategies = useCallback(() => {
    const userList = loadCustomStrategies();
    const merged = [...PRESET_STRATEGIES, ...userList];
    setStrategies(merged);
    setStrategy((prev) => {
      if (prev && merged.some((s) => s.id === prev.id)) {
        return merged.find((s) => s.id === prev.id) ?? merged[0] ?? null;
      }
      return merged[0] ?? null;
    });
  }, []);

  useEffect(() => {
    refreshStrategies();
    // Re-sync when ChartPage saves strategies to localStorage
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

  const handleRun = useCallback(async () => {
    if (!port || (!strategy && !scriptSource.trim())) return;
    setIsLoading(true);
    setIsRunning(false);
    setError(null);
    enginesRef.current = [];
    setSimStates([]);

    try {
      const duration = `${sessions * 3} D`;
      const url = `http://127.0.0.1:${port}/historical?symbol=${encodeURIComponent(symbol)}&bar_size=1+min&duration=${encodeURIComponent(duration)}&what_to_show=TRADES`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> };
      const raw: OHLCVBar[] = (json.bars ?? []).map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }));

      if (raw.length < 10) {
        setError("Not enough historical data. Try more sessions or check your connection.");
        setIsLoading(false);
        return;
      }

      const maxStart = Math.max(0, raw.length - Math.floor(raw.length * 0.5));
      const engines: SimulationEngine[] = [];
      for (let i = 0; i < simCount; i++) {
        const startBarIndex = Math.floor(Math.random() * maxStart);
        engines.push(
          new SimulationEngine({
            symbol,
            strategy: strategy ?? undefined,
            timeframe,
            rawBars: raw,
            startBarIndex,
            sessionFilter: hours,
            rollDays,
            positionSize,
            scriptSource: scriptSource.trim() || undefined,
          })
        );
      }
      enginesRef.current = engines;
      setSimStates(engines.map((e) => e.getState()));
      setIsLoading(false);
      setIsRunning(true);
    } catch (err) {
      setError(String(err));
      setIsLoading(false);
    }
  }, [port, strategy, sessions, symbol, simCount, timeframe, hours, rollDays, positionSize, scriptSource]);

  const handleStep = useCallback(() => {
    const engines = enginesRef.current;
    if (engines.length === 0) return;
    engines.forEach((e) => { if (!e.isDone()) e.step(); });
    setSimStates(engines.map((e) => e.getState()));
  }, []);

  const handlePause = useCallback(() => {
    setIsRunning((r) => !r);
  }, []);

  // Playback interval
  useEffect(() => {
    if (!isRunning) return;
    const engines = enginesRef.current;
    const interval = SPEED_INTERVAL[speed] ?? 250;
    const id = setInterval(() => {
      let anyRunning = false;
      engines.forEach((e) => {
        if (!e.isDone()) {
          // advance multiple raw bars per tick for higher speeds
          const steps = speed >= 10 ? 8 : speed >= 5 ? 4 : speed >= 2 ? 2 : 1;
          for (let s = 0; s < steps && !e.isDone(); s++) e.step();
          anyRunning = true;
        }
      });
      setSimStates(engines.map((e) => e.getState()));
      if (!anyRunning) setIsRunning(false);
    }, interval);
    return () => clearInterval(id);
  }, [isRunning, speed]);

  const cols = Math.sqrt(simCount);
  const agg = simStates.length > 0 ? aggregateMetrics(simStates) : null;
  const runningCount = simStates.filter((s) => !s.done).length;

  return (
    <div className="flex flex-col h-full bg-[#0D1117] overflow-hidden">
      {/* Top control bar */}
      <div className="flex items-center gap-1 h-10 px-3 border-b border-white/[0.06] shrink-0 overflow-x-auto">
        {/* Strategy */}
        {(() => {
          const presets = strategies.filter((s) => s.id.startsWith("preset_"));
          const userStrats = strategies.filter((s) => !s.id.startsWith("preset_"));
          return (
            <select
              value={strategy?.id ?? ""}
              onChange={(e) => setStrategy(strategies.find((s) => s.id === e.target.value) ?? null)}
              className="h-6 px-2 text-[11px] font-mono bg-[#161B22] border border-white/[0.08] rounded text-white/70 outline-none focus:border-white/20"
            >
              <optgroup label="── Built-in ──">
                {presets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
              {userStrats.length > 0 && (
                <optgroup label="── My Strategies ──">
                  {userStrats.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          );
        })()}
        <CtrlBtn onClick={refreshStrategies} title="Refresh strategy list from Chart tab">↻</CtrlBtn>

        {/* Timeframe */}
        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          className="h-6 px-2 text-[11px] font-mono bg-[#161B22] border border-white/[0.08] rounded text-white/70 outline-none focus:border-white/20"
        >
          {TIMEFRAMES.map((tf) => (
            <option key={tf} value={tf}>{tf}</option>
          ))}
        </select>

        {/* Sessions */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-white/30 font-mono">Days</span>
          <input
            type="number"
            min={1}
            max={30}
            value={sessions}
            onChange={(e) => setSessions(Math.max(1, Math.min(30, Number(e.target.value))))}
            className="w-12 h-6 px-1.5 text-[11px] font-mono text-center bg-[#161B22] border border-white/[0.08] rounded text-white/70 outline-none focus:border-white/20"
          />
        </div>

        {/* Hours */}
        <select
          value={hours}
          onChange={(e) => setHours(e.target.value as SessionFilter)}
          className="h-6 px-2 text-[11px] font-mono bg-[#161B22] border border-white/[0.08] rounded text-white/70 outline-none focus:border-white/20"
        >
          <option value="regular">Regular</option>
          <option value="extended">Extended</option>
          <option value="all">All Hours</option>
        </select>

        {/* Day handling */}
        <div className="flex items-center rounded border border-white/[0.08] overflow-hidden h-6">
          <button
            onClick={() => setRollDays(false)}
            className={`px-2 text-[10px] font-mono h-full transition-colors ${!rollDays ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
          >
            Cutoff
          </button>
          <button
            onClick={() => setRollDays(true)}
            className={`px-2 text-[10px] font-mono h-full transition-colors ${rollDays ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
          >
            Roll
          </button>
        </div>

        <BarSeparator />

        {/* Symbol */}
        <button
          onClick={() => setSearchOpen(true)}
          title="Search symbol"
          className="w-16 h-6 px-2 text-[11px] font-mono text-center bg-[#161B22] border border-white/[0.08] rounded text-white/80 hover:border-white/20 transition-colors duration-[120ms] uppercase"
        >
          {symbol || "SPY"}
        </button>
        <CtrlBtn
          onClick={() => {
            const idx = Math.floor(Math.random() * SEARCHABLE_SYMBOLS.length);
            setSymbol(SEARCHABLE_SYMBOLS[idx].symbol);
          }}
          title="Pick a random symbol"
        >
          Random
        </CtrlBtn>

        {/* Sim count */}
        <div className="flex items-center rounded border border-white/[0.08] overflow-hidden h-6">
          {SIM_COUNTS.map((n) => (
            <button
              key={n}
              onClick={() => setSimCount(n)}
              className={`px-2 text-[10px] font-mono h-full transition-colors ${simCount === n ? "bg-white/[0.10] text-white/90" : "text-white/40 hover:text-white/60"}`}
            >
              {n}
            </button>
          ))}
        </div>

        <BarSeparator />

        {/* Playback controls */}
        <CtrlBtn onClick={handleRun} title="Run / restart simulations">
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

        {/* Position size */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-white/30 font-mono">Qty</span>
          <input
            type="number"
            min={1}
            max={10000}
            value={positionSize}
            onChange={(e) => setPositionSize(Math.max(1, Math.min(10000, Number(e.target.value))))}
            className="w-14 h-6 px-1.5 text-[11px] font-mono text-center bg-[#161B22] border border-white/[0.08] rounded text-white/70 outline-none focus:border-white/20"
          />
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

      {/* Script editor panel */}
      {showScript && (
        <div className="shrink-0 border-b border-white/[0.06] bg-[#0D1117] flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.04]">
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Script Editor</span>
            <span className="text-[10px] font-mono text-white/25">Pine Script-like DSL — overrides selected strategy when non-empty</span>
          </div>
          <textarea
            value={scriptSource}
            onChange={(e) => setScriptSource(e.target.value)}
            spellCheck={false}
            placeholder={`// Example:\nplot(close, title="Close")\nif close > ta.sma(close, 20)\n    plotshape(close, style=shape.triangleup, location=location.belowbar, color=color.green, text="BUY")\nif close < ta.sma(close, 20)\n    plotshape(close, style=shape.triangledown, location=location.abovebar, color=color.red, text="SELL")`}
            className="h-32 resize-none px-3 py-2 text-[11px] font-mono text-white/70 bg-transparent outline-none placeholder:text-white/15 leading-relaxed"
          />
        </div>
      )}

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
              style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${cols}, 1fr)` }}
            >
              {simStates.map((state, i) => (
                <SimChart
                  key={i}
                  bars={state.tfBars}
                  scriptResult={state.scriptResult}
                  simIndex={i + 1}
                  symbol={symbol}
                  pnl={state.metrics.totalPnl}
                  status={isLoading ? "loading" : state.done ? "done" : isRunning ? "running" : "idle"}
                />
              ))}
            </div>
          )}
        </div>

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
                {/* Table header */}
                <div className="flex items-center px-3 h-7 border-b border-white/[0.04] sticky top-0 bg-[#0D1117]">
                  <span className="w-5 text-[9px] font-mono text-white/25">#</span>
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
        onSelectSymbol={(sym) => setSymbol(sym)}
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

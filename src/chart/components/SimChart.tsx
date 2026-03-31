import { useEffect, useRef } from "react";
import type { OHLCVBar } from "../types";
import type { ScriptResult } from "../types";
import { ChartEngine } from "../core/ChartEngine";

export interface SimChartProps {
  bars: OHLCVBar[];
  scriptResult: ScriptResult | null;
  simIndex: number;
  symbol: string;
  pnl: number;
  status: "idle" | "running" | "done" | "loading";
}

export function SimChart({ bars, scriptResult, simIndex, symbol, pnl, status }: SimChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);

  // Create engine on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new ChartEngine(canvas);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Resize observer
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      engineRef.current?.resize(width, height);
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  // Push bars
  useEffect(() => {
    engineRef.current?.setData(bars);
  }, [bars]);

  // Push script result (buy/sell markers)
  useEffect(() => {
    engineRef.current?.setScriptResult("sim_strategy", scriptResult);
  }, [scriptResult]);

  const pnlPositive = pnl >= 0;
  const pnlColor = pnlPositive ? "text-emerald-400" : "text-red-400";
  const pnlStr = (pnlPositive ? "+" : "") + pnl.toFixed(2);

  const statusColor =
    status === "running" ? "text-amber-400" :
    status === "done" ? "text-emerald-400" :
    "text-white/20";
  const statusLabel =
    status === "running" ? "RUNNING" :
    status === "done" ? "DONE" :
    status === "loading" ? "LOADING" :
    "IDLE";

  return (
    <div ref={wrapperRef} className="relative w-full h-full bg-[#0D1117] overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />
      {/* Top-left: sim # and symbol */}
      <div className="absolute top-1.5 left-2 z-10 pointer-events-none">
        <span className="text-[10px] text-white/30 font-mono">#{simIndex} · {symbol}</span>
      </div>
      {/* Top-right: PnL */}
      <div className="absolute top-1.5 right-2 z-10 pointer-events-none">
        <span className={`text-[11px] font-mono ${pnlColor}`}>{pnlStr}</span>
      </div>
      {/* Bottom-right: status badge */}
      <div className="absolute bottom-1.5 right-2 z-10 pointer-events-none">
        <span className={`text-[9px] font-mono tracking-wider ${statusColor}`}>{statusLabel}</span>
      </div>
    </div>
  );
}

import { useRef, useEffect, useCallback } from 'react';
import { ChartEngine } from '../core/ChartEngine';
import type { OHLCVBar, ChartType, Timeframe, ScriptResult } from '../types';

interface ChartCanvasProps {
  bars: OHLCVBar[];
  chartType: ChartType;
  timeframe: Timeframe;
  engineRef: React.MutableRefObject<ChartEngine | null>;
  activeScripts?: Map<string, ScriptResult>;
  liveMode?: boolean;
  stopperPx?: number;
  onStopperPxChange?: (px: number) => void;
}

export default function ChartCanvas({
  bars,
  chartType,
  timeframe,
  engineRef,
  activeScripts,
  liveMode = false,
  stopperPx = 0,
  onStopperPxChange,
}: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new ChartEngine(canvas);
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [engineRef]);

  // ResizeObserver
  const handleResize = useCallback(() => {
    const container = containerRef.current;
    const engine = engineRef.current;
    if (!container || !engine) return;

    const { width, height } = container.getBoundingClientRect();
    engine.resize(Math.floor(width), Math.floor(height));
  }, [engineRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    handleResize();

    return () => ro.disconnect();
  }, [handleResize]);

  // Update data
  useEffect(() => {
    engineRef.current?.setData(bars);
  }, [bars, engineRef]);

  // Update chart type
  useEffect(() => {
    engineRef.current?.setChartType(chartType);
  }, [chartType, engineRef]);

  // Update timeframe
  useEffect(() => {
    engineRef.current?.setTimeframe(timeframe);
  }, [timeframe, engineRef]);

  // Update live mode / stopper
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setLiveMode(liveMode);
    engine.setStopperPx(stopperPx);
  }, [liveMode, stopperPx, engineRef]);

  // Update script results (multi-script)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.clearAllScripts();
    if (activeScripts) {
      for (const [id, result] of activeScripts) {
        engine.setScriptResult(id, result);
      }
    }
  }, [activeScripts, engineRef]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor: 'crosshair' }}
      />
      {liveMode && (
        <div
          className="absolute right-2 bottom-1 flex items-center gap-2"
          style={{
            height: 20,
            padding: '0 6px',
            backgroundColor: 'rgba(13,17,23,0.7)',
            border: '1px solid rgba(33,38,45,0.7)',
            borderRadius: 4,
            backdropFilter: 'blur(2px)',
          }}
        >
          <span className="text-[9px] font-mono text-text-muted">Stop</span>
          <input
            type="range"
            min={0}
            max={200}
            step={2}
            value={stopperPx}
            onChange={(e) => onStopperPxChange?.(Number(e.target.value))}
            style={{ width: 90 }}
          />
          <span className="text-[9px] font-mono text-text-muted">{stopperPx}px</span>
        </div>
      )}
    </div>
  );
}

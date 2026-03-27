import { useEffect, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import type { CustomColumnDef, ExpressionColumn } from "../../lib/custom-column-types";
import { TA_SCORE_TIMEFRAMES } from "../../lib/ta-score-timeframes";

interface PresetColumn {
  label: string;
  expression: string;
  decimals: number;
  colorize: boolean;
  width: number;
}

const PRESET_COLUMNS: PresetColumn[] = [
  { label: "Volume",    expression: "volume",           decimals: 0, colorize: false, width: 72 },
  { label: "Bid",       expression: "bid",              decimals: 2, colorize: false, width: 54 },
  { label: "Ask",       expression: "ask",              decimals: 2, colorize: false, width: 54 },
  { label: "Spread",    expression: "spread",           decimals: 4, colorize: false, width: 58 },
  { label: "Mid",       expression: "mid",              decimals: 2, colorize: false, width: 54 },
  { label: "Open",      expression: "open",             decimals: 2, colorize: false, width: 54 },
  { label: "High",      expression: "high",             decimals: 2, colorize: false, width: 54 },
  { label: "Low",       expression: "low",              decimals: 2, colorize: false, width: 54 },
  { label: "PrevClose", expression: "prevClose",        decimals: 2, colorize: false, width: 72 },
  { label: "B/A Ratio", expression: "bid / (ask || 1)", decimals: 2, colorize: true,  width: 62 },
];

interface ColumnPopoverProps {
  anchorRef: MutableRefObject<HTMLDivElement | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  taTimeframes: string[];
  customColumns: CustomColumnDef[];
  onUpdateTaTimeframes: (next: string[]) => void;
  onAddPresetColumn: (col: CustomColumnDef) => void;
  onOpenBuilder: (kind: "score" | "crossover" | "indicator" | "expression") => void;
  onClose: () => void;
}

export default function ColumnPopover({
  anchorRef,
  panelRef,
  taTimeframes,
  customColumns,
  onUpdateTaTimeframes,
  onAddPresetColumn,
  onOpenBuilder,
  onClose,
}: ColumnPopoverProps) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.right - 420,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef]);

  const availablePresets = PRESET_COLUMNS.filter(
    (p) => !customColumns.some((c) => c.kind === "expression" && c.label === p.label && (c as ExpressionColumn).expression === p.expression),
  );

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[260] w-[420px] rounded-md border border-white/[0.08] bg-[#1C2128] shadow-xl shadow-black/40"
      style={{ top: position.top, left: Math.max(8, position.left) }}
    >
      <div className="grid grid-cols-3 divide-x divide-white/[0.06]">
        {/* Column 1: TA Scores */}
        <div className="px-2.5 py-2">
          <p className="pb-1.5 text-[8px] uppercase tracking-wider text-white/25">TA Scores</p>
          {TA_SCORE_TIMEFRAMES.map((tf) => (
            <label
              key={tf}
              className="flex cursor-pointer items-center gap-2 py-1 hover:bg-white/[0.04] rounded-sm px-0.5"
            >
              <input
                type="checkbox"
                checked={taTimeframes.includes(tf)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...taTimeframes, tf]
                    : taTimeframes.filter((t) => t !== tf);
                  onUpdateTaTimeframes(next);
                }}
                className="h-2.5 w-2.5 accent-blue"
              />
              <span className="font-mono text-[10px] text-white/60">{tf}</span>
            </label>
          ))}
        </div>

        {/* Column 2: Quick Add */}
        <div className="px-2.5 py-2">
          <p className="pb-1.5 text-[8px] uppercase tracking-wider text-white/25">Quick Add</p>
          <div className="max-h-[220px] overflow-y-auto">
            {availablePresets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  const newCol: CustomColumnDef = {
                    id: `col_${Date.now()}_${preset.label}`,
                    kind: "expression",
                    ...preset,
                  };
                  onAddPresetColumn(newCol);
                  onClose();
                }}
                className="flex w-full items-center gap-1.5 rounded-sm px-0.5 py-0.5 text-left text-[10px] text-white/40 hover:bg-white/[0.04] hover:text-white/70"
              >
                <span className="text-[10px] leading-none text-white/20">+</span>
                <span className="font-mono">{preset.label}</span>
              </button>
            ))}
            {availablePresets.length === 0 && (
              <p className="py-1 text-[9px] text-white/20 italic">All added</p>
            )}
          </div>
        </div>

        {/* Column 3: Custom */}
        <div className="px-2.5 py-2">
          <p className="pb-1.5 text-[8px] uppercase tracking-wider text-white/25">Custom</p>
          <button
            onClick={() => { onOpenBuilder("score"); onClose(); }}
            className="flex w-full items-center gap-1.5 rounded-sm px-0.5 py-1 text-left text-[10px] text-white/40 hover:bg-white/[0.04] hover:text-white/70"
          >
            <span className="text-[10px] leading-none text-white/20">+</span>
            Score Column
          </button>
          <button
            onClick={() => { onOpenBuilder("crossover"); onClose(); }}
            className="flex w-full items-center gap-1.5 rounded-sm px-0.5 py-1 text-left text-[10px] text-white/40 hover:bg-white/[0.04] hover:text-white/70"
          >
            <span className="text-[10px] leading-none text-white/20">+</span>
            Crossover Column
          </button>
          <button
            onClick={() => { onOpenBuilder("indicator"); onClose(); }}
            className="flex w-full items-center gap-1.5 rounded-sm px-0.5 py-1 text-left text-[10px] text-white/40 hover:bg-white/[0.04] hover:text-white/70"
          >
            <span className="text-[10px] leading-none text-white/20">+</span>
            Indicator Column
          </button>
          <div className="mx-0 my-1.5 border-t border-white/[0.06]" />
          <button
            onClick={() => { onOpenBuilder("expression"); onClose(); }}
            className="flex w-full items-center gap-1.5 rounded-sm px-0.5 py-1 text-left text-[10px] text-white/30 hover:bg-white/[0.04] hover:text-white/50"
          >
            <span className="text-[10px] leading-none text-white/15">+</span>
            Expression...
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

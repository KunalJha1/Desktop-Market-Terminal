import { useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronDown } from "lucide-react";
import {
  AVAILABLE_TIMEFRAMES,
  INDICATOR_TYPES,
  getDefaultIndicatorOutput,
  getIndicatorCatalogEntry,
  getIndicatorOutputs,
  getDefaultIndicatorParams,
  type CustomColumnDef,
  type ExpressionColumn,
  type IndicatorColumn,
  type CrossoverColumn,
  type CrossoverCombo,
  type ScoreColumn,
  type ScoreCondition,
  type IndicatorRef,
  type IndicatorType,
  type IndicatorParams,
  type Timeframe,
} from "../../lib/custom-column-types";

type ColumnKind = "score" | "crossover" | "indicator" | "expression";

interface ColumnBuilderModalProps {
  editColumn: CustomColumnDef | null;
  initialKind: ColumnKind;
  onSave: (col: CustomColumnDef) => void;
  onDelete?: (colId: string) => void;
  onCancel: () => void;
}

const KIND_LABELS: Record<ColumnKind, string> = {
  score: "Score",
  crossover: "Crossover",
  indicator: "Indicator",
  expression: "Expression",
};

const inputCls =
  "w-full appearance-none rounded border border-white/[0.08] bg-[#0D1117] px-2 py-1.5 font-mono text-[10px] text-white/80 outline-none focus:border-[#1A56DB]/50 placeholder:text-white/20";

const selectCls =
  "w-full appearance-none rounded border border-white/[0.08] bg-[#0D1117] py-1.5 pl-2 pr-6 font-mono text-[10px] text-white/80 outline-none focus:border-[#1A56DB]/50 cursor-pointer";

const labelCls = "block pb-1 text-[8px] uppercase tracking-wider text-white/25";

function SelectWrapper({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className ?? ""}`}>
      {children}
      <ChevronDown
        size={10}
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-white/25"
      />
    </div>
  );
}

function defaultLabel(kind: ColumnKind): string {
  switch (kind) {
    case "score":
      return "Score";
    case "crossover":
      return "Cross";
    case "indicator":
      return "RSI";
    case "expression":
      return "Custom";
  }
}

function getPrimaryParam(type: IndicatorType, params: IndicatorParams): number {
  const defaults = getDefaultIndicatorParams(type);
  const firstKey = Object.keys(defaults)[0];
  if (!firstKey) return 0;
  return typeof params[firstKey] === "number" ? params[firstKey] : defaults[firstKey];
}

function setPrimaryParam(type: IndicatorType, value: number): IndicatorParams {
  const defaults = getDefaultIndicatorParams(type);
  const firstKey = Object.keys(defaults)[0];
  if (!firstKey) return defaults;
  return { ...defaults, [firstKey]: value };
}

function makeIndicatorRef(type: IndicatorType, primaryValue?: number): IndicatorRef {
  const defaults = getDefaultIndicatorParams(type);
  const firstKey = Object.keys(defaults)[0];
  if (!firstKey || primaryValue === undefined) {
    return { type, params: defaults, output: getDefaultIndicatorOutput(type) };
  }
  return { type, params: { ...defaults, [firstKey]: primaryValue }, output: getDefaultIndicatorOutput(type) };
}

function makeDefaultCrossoverCombo(): CrossoverCombo {
  return {
    indicatorA: makeIndicatorRef("EMA", 9),
    indicatorB: makeIndicatorRef("EMA", 21),
  };
}

function makeScoreCondition(type: IndicatorType, comparison: "above" | "below", threshold: number): ScoreCondition {
  return {
    indicatorType: type,
    params: getDefaultIndicatorParams(type),
    output: getDefaultIndicatorOutput(type),
    comparison,
    threshold,
  };
}

export default function ColumnBuilderModal({
  editColumn,
  initialKind,
  onSave,
  onDelete,
  onCancel,
}: ColumnBuilderModalProps) {
  const isEditing = editColumn !== null;
  const startKind: ColumnKind = editColumn?.kind ?? initialKind;

  const [kind, setKind] = useState<ColumnKind>(startKind);
  const [label, setLabel] = useState(editColumn?.label ?? defaultLabel(initialKind));
  const [width, setWidth] = useState(editColumn?.width ?? 54);
  const [decimals, setDecimals] = useState(editColumn?.decimals ?? 0);
  const [colorize, setColorize] = useState(editColumn?.colorize ?? true);

  const [expression, setExpression] = useState(
    editColumn?.kind === "expression"
      ? (editColumn as ExpressionColumn).expression
      : "changePct > 0 ? 75 : 25",
  );

  const [indType, setIndType] = useState<IndicatorType>(
    editColumn?.kind === "indicator"
      ? (editColumn as IndicatorColumn).indicatorType
      : "RSI",
  );
  const [indParams, setIndParams] = useState<IndicatorParams>(
    editColumn?.kind === "indicator"
      ? (editColumn as IndicatorColumn).params
      : getDefaultIndicatorParams("RSI"),
  );
  const [indOutput, setIndOutput] = useState<string | undefined>(
    editColumn?.kind === "indicator"
      ? (editColumn as IndicatorColumn).output
      : getDefaultIndicatorOutput("RSI"),
  );
  const [indTimeframe, setIndTimeframe] = useState<Timeframe>(
    editColumn?.kind === "indicator"
      ? (editColumn as IndicatorColumn).timeframe
      : "1h",
  );

  const [crossCombos, setCrossCombos] = useState<CrossoverCombo[]>(
    editColumn?.kind === "crossover"
      ? (((editColumn as CrossoverColumn).combos.length > 0
          ? (editColumn as CrossoverColumn).combos
          : [makeDefaultCrossoverCombo()]))
      : [makeDefaultCrossoverCombo()],
  );
  const [crossTf, setCrossTf] = useState<Timeframe>(
    editColumn?.kind === "crossover"
      ? (editColumn as CrossoverColumn).timeframe
      : "1h",
  );

  const [scoreTf, setScoreTf] = useState<Timeframe>(
    editColumn?.kind === "score" ? (editColumn as ScoreColumn).timeframe : "1h",
  );
  const [conditions, setConditions] = useState<ScoreCondition[]>(
    editColumn?.kind === "score"
      ? (editColumn as ScoreColumn).conditions
      : [makeScoreCondition("RSI", "above", 50)],
  );

  const handleSave = () => {
    const id = editColumn?.id ?? `col_${Date.now()}`;
    const base = { id, label, width, decimals, colorize };

    switch (kind) {
      case "expression":
        onSave({ ...base, kind: "expression", expression });
        break;
      case "indicator":
        onSave({
          ...base,
          kind: "indicator",
          indicatorType: indType,
          params: indParams,
          output: indOutput,
          timeframe: indTimeframe,
        });
        break;
      case "crossover":
        onSave({
          ...base,
          kind: "crossover",
          combos: crossCombos,
          timeframe: crossTf,
        });
        break;
      case "score":
        onSave({ ...base, kind: "score", timeframe: scoreTf, conditions });
        break;
    }
  };

  const addCondition = () => {
    setConditions((prev) => [...prev, makeScoreCondition("EMA", "above", 0)]);
  };

  const updateCondition = (idx: number, updates: Partial<ScoreCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...updates } : c)));
  };

  const removeCondition = (idx: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateCrossoverCombo = (idx: number, updates: Partial<CrossoverCombo>) => {
    setCrossCombos((prev) => prev.map((combo, i) => (i === idx ? { ...combo, ...updates } : combo)));
  };

  const addCrossoverCombo = () => {
    setCrossCombos((prev) => [...prev, makeDefaultCrossoverCombo()]);
  };

  const removeCrossoverCombo = (idx: number) => {
    setCrossCombos((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  return createPortal(
    <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/50">
      <div className="w-[480px] rounded-lg border border-white/[0.08] bg-[#161B22] shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div>
            <h3 className="text-[13px] font-semibold text-white">
              {isEditing ? "Edit Column" : "Add Custom Column"}
            </h3>
            <p className="text-[10px] text-white/30">
              {kind === "expression"
                ? "Write a JS expression using quote fields."
                : `Configure a ${kind} column.`}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/60"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-white/[0.06] px-5 py-2">
          {(["score", "crossover", "indicator", "expression"] as ColumnKind[]).map((nextKind) => (
            <button
              key={nextKind}
              onClick={() => {
                setKind(nextKind);
                if (!isEditing && label === defaultLabel(kind)) {
                  setLabel(defaultLabel(nextKind));
                }
              }}
              className={`rounded px-2.5 py-1 text-[10px] font-medium transition-colors duration-75 ${
                kind === nextKind
                  ? "bg-[#1A56DB]/20 text-[#1A56DB]"
                  : "text-white/40 hover:bg-white/[0.04]"
              }`}
            >
              {KIND_LABELS[nextKind]}
            </button>
          ))}
        </div>

        <div className="max-h-[400px] space-y-3 overflow-y-auto px-5 py-3">
          {kind === "expression" && (
            <ExpressionForm expression={expression} onChange={setExpression} />
          )}
          {kind === "indicator" && (
            <IndicatorForm
              type={indType}
              params={indParams}
              output={indOutput}
              timeframe={indTimeframe}
              onTypeChange={(type) => {
                setIndType(type);
                setIndParams(getDefaultIndicatorParams(type));
                setIndOutput(getDefaultIndicatorOutput(type));
                if (!isEditing && label === defaultLabel("indicator")) {
                  setLabel(type);
                }
              }}
              onParamsChange={setIndParams}
              onOutputChange={setIndOutput}
              onTimeframeChange={setIndTimeframe}
            />
          )}
          {kind === "crossover" && (
            <CrossoverForm
              combos={crossCombos}
              timeframe={crossTf}
              onUpdateCombo={updateCrossoverCombo}
              onAddCombo={addCrossoverCombo}
              onRemoveCombo={removeCrossoverCombo}
              onTimeframeChange={setCrossTf}
            />
          )}
          {kind === "score" && (
            <ScoreForm
              timeframe={scoreTf}
              conditions={conditions}
              onTimeframeChange={setScoreTf}
              onAddCondition={addCondition}
              onUpdateCondition={updateCondition}
              onRemoveCondition={removeCondition}
            />
          )}

          <div className="border-t border-white/[0.06] pt-3">
            <p className="pb-2 text-[8px] uppercase tracking-wider text-white/25">Settings</p>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className={labelCls}>Label</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Width</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value) || 54)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Decimals</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={decimals}
                  onChange={(e) => setDecimals(Number(e.target.value) || 0)}
                  className={inputCls}
                />
              </div>
              <div className="flex items-end pb-1.5">
                <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-white/50">
                  <input
                    type="checkbox"
                    checked={colorize}
                    onChange={(e) => setColorize(e.target.checked)}
                    className="relative h-3 w-3 cursor-pointer appearance-none rounded border border-white/[0.15] bg-[#0D1117] checked:border-[#1A56DB] checked:bg-[#1A56DB]
                      after:absolute after:left-[3px] after:top-[1px] after:h-[7px] after:w-[4px] after:rotate-45 after:border-b-[1.5px] after:border-r-[1.5px] after:border-white after:content-['']
                      after:opacity-0 checked:after:opacity-100"
                  />
                  Color
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3">
          <div>
            {isEditing && onDelete && (
              <button
                onClick={() => onDelete(editColumn.id)}
                className="rounded px-3 py-1 text-[10px] font-medium text-[#FF3D71] hover:bg-[#FF3D71]/10"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded px-3 py-1.5 text-[10px] font-medium text-white/50 hover:bg-white/[0.04] hover:text-white/70"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded bg-[#1A56DB] px-4 py-1.5 text-[10px] font-medium text-white hover:bg-[#1A56DB]/90"
            >
              {isEditing ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ExpressionForm({
  expression,
  onChange,
}: {
  expression: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className={labelCls}>Expression</label>
      <textarea
        value={expression}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full resize-none appearance-none rounded border border-white/[0.08] bg-[#0D1117] px-2.5 py-2 font-mono text-[10px] text-white/70 outline-none focus:border-[#1A56DB]/50"
      />
      <p className="pt-1 text-[9px] text-white/20">
        Available: last, bid, ask, mid, open, high, low, prevClose, change, changePct, volume, spread, symbol
      </p>
    </div>
  );
}

function IndicatorSelect({
  value,
  onChange,
  className,
}: {
  value: IndicatorType;
  onChange: (v: IndicatorType) => void;
  className?: string;
}) {
  return (
    <SelectWrapper className={className}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as IndicatorType)}
        className={selectCls}
      >
        {INDICATOR_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </SelectWrapper>
  );
}

function IndicatorOutputSelect({
  type,
  value,
  onChange,
  className,
}: {
  type: IndicatorType;
  value?: string;
  onChange: (value: string | undefined) => void;
  className?: string;
}) {
  const outputs = getIndicatorOutputs(type);
  if (outputs.length <= 1) {
    return null;
  }

  return (
    <SelectWrapper className={className}>
      <select
        value={value ?? outputs[0]?.key ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={selectCls}
      >
        {outputs.map((output) => (
          <option key={output.key} value={output.key}>
            {output.label}
          </option>
        ))}
      </select>
    </SelectWrapper>
  );
}

function TimeframeSelect({
  value,
  onChange,
  className,
}: {
  value: Timeframe;
  onChange: (v: Timeframe) => void;
  className?: string;
}) {
  return (
    <SelectWrapper className={className}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Timeframe)}
        className={selectCls}
      >
        {AVAILABLE_TIMEFRAMES.map((tf) => (
          <option key={tf} value={tf}>
            {tf}
          </option>
        ))}
      </select>
    </SelectWrapper>
  );
}

function ComparisonSelect({
  value,
  onChange,
  className,
}: {
  value: "above" | "below";
  onChange: (v: "above" | "below") => void;
  className?: string;
}) {
  return (
    <SelectWrapper className={className}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as "above" | "below")}
        className={selectCls}
      >
        <option value="above">above</option>
        <option value="below">below</option>
      </select>
    </SelectWrapper>
  );
}

function IndicatorConfigEditor({
  title,
  description,
  indicator,
  onChange,
  showSource = true,
}: {
  title: string;
  description?: string;
  indicator: IndicatorRef;
  onChange: (next: IndicatorRef) => void;
  showSource?: boolean;
}) {
  const catalog = getIndicatorCatalogEntry(indicator.type);
  const outputs = getIndicatorOutputs(indicator.type);

  return (
    <div className="space-y-2 rounded border border-white/[0.06] bg-[#0D1117]/50 p-2.5">
      <div>
        <div className="text-[9px] text-white/70">{title}</div>
        {description && <div className="pt-0.5 text-[9px] text-white/25">{description}</div>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {showSource && (
          <div>
            <label className={labelCls}>Source</label>
            <IndicatorSelect
              value={indicator.type}
              onChange={(type) =>
                onChange({
                  type,
                  params: getDefaultIndicatorParams(type),
                  output: getDefaultIndicatorOutput(type),
                })
              }
            />
          </div>
        )}
        {outputs.length > 1 && (
          <div>
            <label className={labelCls}>Output</label>
            <IndicatorOutputSelect
              type={indicator.type}
              value={indicator.output}
              onChange={(output) => onChange({ ...indicator, output })}
            />
          </div>
        )}
      </div>

      {catalog.paramOrder.length > 0 && (
        <div className={`grid gap-2 ${catalog.paramOrder.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {catalog.paramOrder.map((paramKey) => {
            const defaultValue = catalog.defaults[paramKey];
            const label = catalog.paramLabels[paramKey] ?? paramKey;
            return (
              <div key={paramKey}>
                <label className={labelCls}>{label}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={indicator.params[paramKey] ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...indicator,
                      params: {
                        ...indicator.params,
                        [paramKey]: e.target.value === "" ? defaultValue : Number(e.target.value) || defaultValue,
                      },
                    })
                  }
                  className={inputCls}
                  placeholder={`${label} (default ${defaultValue})`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IndicatorForm({
  type,
  params,
  output,
  timeframe,
  onTypeChange,
  onParamsChange,
  onOutputChange,
  onTimeframeChange,
}: {
  type: IndicatorType;
  params: IndicatorParams;
  output?: string;
  timeframe: Timeframe;
  onTypeChange: (t: IndicatorType) => void;
  onParamsChange: (params: IndicatorParams) => void;
  onOutputChange: (output: string | undefined) => void;
  onTimeframeChange: (tf: Timeframe) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Indicator</label>
          <IndicatorSelect value={type} onChange={onTypeChange} />
        </div>
        <div>
          <label className={labelCls}>Timeframe</label>
          <TimeframeSelect value={timeframe} onChange={onTimeframeChange} />
        </div>
      </div>
      <IndicatorConfigEditor
        title="Indicator Settings"
        description="Adjust the source, output, and each parameter."
        indicator={{ type, params, output }}
        onChange={(next) => {
          onTypeChange(next.type);
          onParamsChange(next.params);
          onOutputChange(next.output);
        }}
        showSource={false}
      />
      <p className="text-[9px] text-white/20">
        Shows the raw {type} value on {timeframe} bars.
      </p>
    </div>
  );
}

function CrossoverForm({
  combos,
  timeframe,
  onUpdateCombo,
  onAddCombo,
  onRemoveCombo,
  onTimeframeChange,
}: {
  combos: CrossoverCombo[];
  timeframe: Timeframe;
  onUpdateCombo: (idx: number, updates: Partial<CrossoverCombo>) => void;
  onAddCombo: () => void;
  onRemoveCombo: (idx: number) => void;
  onTimeframeChange: (tf: Timeframe) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Timeframe</label>
        <TimeframeSelect
          value={timeframe}
          onChange={onTimeframeChange}
          className="w-[100px]"
        />
      </div>

      <div className="space-y-2">
        {combos.map((combo, index) => {
          return (
            <div
              key={index}
              className="space-y-2 rounded border border-white/[0.06] bg-[#0D1117]/50 p-2.5"
            >
              <div className="flex items-center justify-between">
                <p className="text-[8px] uppercase tracking-wider text-white/25">Combo {index + 1}</p>
                {combos.length > 1 && (
                  <button
                    onClick={() => onRemoveCombo(index)}
                    className="rounded px-1 py-0.5 text-[9px] text-white/25 hover:bg-white/[0.06] hover:text-white/55"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <IndicatorConfigEditor
                  title="This On Top = BUY"
                  description="Pick the bullish side. This can be MACD, Signal, Histogram, Price, or any other source."
                  indicator={combo.indicatorA}
                  onChange={(indicatorA) => onUpdateCombo(index, { indicatorA })}
                />

                <IndicatorConfigEditor
                  title="This On Top = SELL"
                  description="Pick the bearish counterpart for the same combo."
                  indicator={combo.indicatorB}
                  onChange={(indicatorB) => onUpdateCombo(index, { indicatorB })}
                />
              </div>

              <p className="text-[9px] text-white/20">
                BUY when the left indicator is above the right one. SELL when the left indicator is below the right one.
              </p>
            </div>
          );
        })}
      </div>

      <button
        onClick={onAddCombo}
        className="rounded border border-white/[0.08] px-2 py-1 text-[10px] text-white/45 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/75"
      >
        Add Another Combo
      </button>

      <p className="text-[9px] text-white/20">
        Final result: BUY only when every combo is above its counterpart, SELL only when every combo is below its counterpart, otherwise NEUTRAL.
      </p>
    </div>
  );
}

function ScoreForm({
  timeframe,
  conditions,
  onTimeframeChange,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}: {
  timeframe: Timeframe;
  conditions: ScoreCondition[];
  onTimeframeChange: (tf: Timeframe) => void;
  onAddCondition: () => void;
  onUpdateCondition: (idx: number, updates: Partial<ScoreCondition>) => void;
  onRemoveCondition: (idx: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Timeframe</label>
        <TimeframeSelect
          value={timeframe}
          onChange={onTimeframeChange}
          className="w-[100px]"
        />
      </div>

      <div>
        <p className="pb-1.5 text-[8px] uppercase tracking-wider text-white/25">Conditions</p>
        <div className="space-y-1.5">
          {conditions.map((cond, index) => {
            const hasPrimaryParam = Object.keys(getDefaultIndicatorParams(cond.indicatorType)).length > 0;
            return (
              <div
                key={index}
                className="flex items-center gap-1.5 rounded border border-white/[0.06] bg-[#0D1117]/50 px-2 py-1.5"
              >
                <IndicatorSelect
                  value={cond.indicatorType}
                  onChange={(type) =>
                    onUpdateCondition(index, {
                      indicatorType: type,
                      params: getDefaultIndicatorParams(type),
                    })
                  }
                  className="w-[90px] shrink-0"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={hasPrimaryParam ? getPrimaryParam(cond.indicatorType, cond.params) : "—"}
                  onChange={(e) =>
                    onUpdateCondition(index, {
                      params: setPrimaryParam(cond.indicatorType, Number(e.target.value) || 1),
                    })
                  }
                  className={`${inputCls} !w-[48px] shrink-0`}
                  disabled={!hasPrimaryParam}
                />
                <ComparisonSelect
                  value={cond.comparison}
                  onChange={(comparison) => onUpdateCondition(index, { comparison })}
                  className="w-[72px] shrink-0"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={cond.threshold}
                  onChange={(e) =>
                    onUpdateCondition(index, { threshold: Number(e.target.value) || 0 })
                  }
                  className={`${inputCls} !w-[56px] shrink-0`}
                  placeholder="Value"
                />
                <button
                  onClick={() => onRemoveCondition(index)}
                  className="ml-auto shrink-0 rounded p-0.5 text-white/20 hover:bg-white/[0.06] hover:text-white/50"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={onAddCondition}
          className="mt-1.5 flex items-center gap-1 rounded px-2 py-1 text-[10px] text-[#1A56DB]/70 hover:bg-[#1A56DB]/10 hover:text-[#1A56DB]"
        >
          <span className="text-[11px] leading-none">+</span>
          Add Condition
        </button>
      </div>

      <p className="text-[9px] text-white/20">
        Score = (matching conditions / total) &times; 100. All match = 100 (buy), none = 0 (sell), mixed = neutral.
      </p>
    </div>
  );
}

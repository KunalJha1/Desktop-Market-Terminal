import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  AVAILABLE_TIMEFRAMES,
  ETF_FIELD_OPTIONS,
  INDICATOR_TYPES,
  META_FIELD_OPTIONS,
  QUOTE_FIELD_OPTIONS,
  getDefaultValueSource,
  getIndicatorCatalogEntry,
  getIndicatorOutputs,
  getValueSourceLabel,
  makeIndicatorValueSource,
  type CustomColumnDef,
  type ExpressionColumn,
  type IndicatorColumn,
  type CrossoverColumn,
  type CrossoverCombo,
  type ScoreColumn,
  type ScoreCondition,
  type IndicatorType,
  type Timeframe,
  type ValueSource,
  type ValueSourceKind,
  type ScoreOperator,
} from "../../lib/custom-column-types";
import CustomSelect, { type CustomSelectOption } from "../CustomSelect";

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
  indicator: "Value",
  expression: "Expression",
};

const SOURCE_KIND_OPTIONS: Array<{ value: ValueSourceKind; label: string }> = [
  { value: "indicator", label: "Indicator" },
  { value: "quote", label: "Quote Field" },
  { value: "meta", label: "Symbol Field" },
  { value: "etf", label: "ETF Field" },
];

const COMPARISON_OPTIONS: CustomSelectOption[] = [
  { value: "above", label: "above" },
  { value: "below", label: "below" },
  { value: "equal", label: "equals" },
  { value: "notEqual", label: "not equal" },
];

const TARGET_OPTIONS: CustomSelectOption[] = [
  { value: "value", label: "Number" },
  { value: "source", label: "Another Source" },
];

const inputCls =
  "w-full appearance-none rounded border border-white/[0.08] bg-[#0D1117] px-2 py-1.5 font-mono text-[10px] text-white/80 outline-none focus:border-[#1A56DB]/50 placeholder:text-white/20";

const labelCls = "block pb-1 text-[8px] uppercase tracking-wider text-white/25";
const selectTriggerCls =
  "w-full font-mono text-[10px] text-white/80 focus:border-[#1A56DB]/50";

function defaultLabel(kind: ColumnKind): string {
  switch (kind) {
    case "score":
      return "Score";
    case "crossover":
      return "Cross";
    case "indicator":
      return "Value";
    case "expression":
      return "Custom";
  }
}

function makeDefaultCrossoverCombo(): CrossoverCombo {
  return {
    left: makeIndicatorValueSource("EMA", "1h", { period: 9 }, "value"),
    right: makeIndicatorValueSource("EMA", "1h", { period: 21 }, "value"),
  };
}

function makeScoreCondition(): ScoreCondition {
  return {
    left: makeIndicatorValueSource("RSI"),
    operator: "above",
    targetType: "value",
    threshold: 50,
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
      : "pct(change, prevClose)",
  );

  const [indicatorSource, setIndicatorSource] = useState<ValueSource>(
    editColumn?.kind === "indicator"
      ? (editColumn as IndicatorColumn).source
      : makeIndicatorValueSource("RSI"),
  );

  const [crossCombos, setCrossCombos] = useState<CrossoverCombo[]>(
    editColumn?.kind === "crossover"
      ? (((editColumn as CrossoverColumn).combos.length > 0
          ? (editColumn as CrossoverColumn).combos
          : [makeDefaultCrossoverCombo()]))
      : [makeDefaultCrossoverCombo()],
  );

  const [conditions, setConditions] = useState<ScoreCondition[]>(
    editColumn?.kind === "score"
      ? (editColumn as ScoreColumn).conditions
      : [makeScoreCondition()],
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
          source: indicatorSource,
        });
        break;
      case "crossover":
        onSave({
          ...base,
          kind: "crossover",
          combos: crossCombos,
        });
        break;
      case "score":
        onSave({ ...base, kind: "score", conditions });
        break;
    }
  };

  const addCondition = () => {
    setConditions((prev) => [...prev, makeScoreCondition()]);
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
      <div className="w-[620px] rounded-lg border border-white/[0.08] bg-[#161B22] shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div>
            <h3 className="text-[13px] font-semibold text-white">
              {isEditing ? "Edit Column" : "Add Custom Column"}
            </h3>
            <p className="text-[10px] text-white/30">
              {kind === "expression"
                ? "Build a column from quote fields, symbol metadata, and ETF details."
                : `Configure a ${kind} column with richer value sources.`}
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

        <div className="max-h-[500px] space-y-3 overflow-y-auto px-5 py-3">
          {kind === "expression" && (
            <ExpressionForm expression={expression} onChange={setExpression} />
          )}
          {kind === "indicator" && (
            <IndicatorForm source={indicatorSource} onSourceChange={setIndicatorSource} />
          )}
          {kind === "crossover" && (
            <CrossoverForm
              combos={crossCombos}
              onUpdateCombo={updateCrossoverCombo}
              onAddCombo={addCrossoverCombo}
              onRemoveCombo={removeCrossoverCombo}
            />
          )}
          {kind === "score" && (
            <ScoreForm
              conditions={conditions}
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
        rows={4}
        className="w-full resize-none appearance-none rounded border border-white/[0.08] bg-[#0D1117] px-2.5 py-2 font-mono text-[10px] text-white/70 outline-none focus:border-[#1A56DB]/50"
      />
      <p className="pt-1 text-[9px] text-white/20">
        Aliases: last, bid, ask, open, high, low, change, changePct, volume, week52High, trailingPE, marketCap, symbol, name, sector, industry.
      </p>
      <p className="pt-1 text-[9px] text-white/20">
        Objects/helpers: quote.*, meta.*, etf.*, nz(value, fallback), pct(part, whole), between(value, min, max).
      </p>
    </div>
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
    <CustomSelect
      className={className}
      value={value}
      onChange={(next) => onChange(next as Timeframe)}
      options={AVAILABLE_TIMEFRAMES.map((tf) => ({ value: tf, label: tf }))}
      size="sm"
      triggerClassName={selectTriggerCls}
    />
  );
}

function IndicatorSelect({
  value,
  onChange,
}: {
  value: IndicatorType;
  onChange: (v: IndicatorType) => void;
}) {
  return (
    <CustomSelect
      value={value}
      onChange={(next) => onChange(next as IndicatorType)}
      options={INDICATOR_TYPES.map((type) => ({ value: type, label: type }))}
      size="sm"
      triggerClassName={selectTriggerCls}
    />
  );
}

function SourceKindSelect({
  value,
  onChange,
}: {
  value: ValueSourceKind;
  onChange: (v: ValueSourceKind) => void;
}) {
  return (
    <CustomSelect
      value={value}
      onChange={(next) => onChange(next as ValueSourceKind)}
      options={SOURCE_KIND_OPTIONS}
      size="sm"
      triggerClassName={selectTriggerCls}
    />
  );
}

function ValueSourceEditor({
  source,
  onChange,
  title,
  description,
}: {
  source: ValueSource;
  onChange: (next: ValueSource) => void;
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-2 rounded border border-white/[0.06] bg-[#0D1117]/50 p-2.5">
      <div>
        <div className="text-[9px] text-white/70">{title}</div>
        {description && <div className="pt-0.5 text-[9px] text-white/25">{description}</div>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Source Type</label>
          <SourceKindSelect
            value={source.sourceKind}
            onChange={(kind) => onChange(getDefaultValueSource(kind))}
          />
        </div>

        {source.sourceKind === "indicator" && (
          <div>
            <label className={labelCls}>Indicator</label>
            <IndicatorSelect
              value={source.indicatorType}
              onChange={(indicatorType) =>
                onChange(makeIndicatorValueSource(indicatorType, source.timeframe))
              }
            />
          </div>
        )}

        {source.sourceKind === "quote" && (
          <div>
            <label className={labelCls}>Field</label>
            <CustomSelect
              value={source.field}
              onChange={(next) => onChange({ sourceKind: "quote", field: next as never })}
              options={QUOTE_FIELD_OPTIONS}
              size="sm"
              triggerClassName={selectTriggerCls}
            />
          </div>
        )}

        {source.sourceKind === "meta" && (
          <div>
            <label className={labelCls}>Field</label>
            <CustomSelect
              value={source.field}
              onChange={(next) => onChange({ sourceKind: "meta", field: next as never })}
              options={META_FIELD_OPTIONS}
              size="sm"
              triggerClassName={selectTriggerCls}
            />
          </div>
        )}

        {source.sourceKind === "etf" && (
          <div>
            <label className={labelCls}>Field</label>
            <CustomSelect
              value={source.field}
              onChange={(next) => onChange({ sourceKind: "etf", field: next as never })}
              options={ETF_FIELD_OPTIONS}
              size="sm"
              triggerClassName={selectTriggerCls}
            />
          </div>
        )}
      </div>

      {source.sourceKind === "indicator" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Timeframe</label>
              <TimeframeSelect
                value={source.timeframe}
                onChange={(timeframe) => onChange({ ...source, timeframe })}
              />
            </div>
            {getIndicatorOutputs(source.indicatorType).length > 1 && (
              <div>
                <label className={labelCls}>Output</label>
                <CustomSelect
                  value={source.output ?? ""}
                  onChange={(next) => onChange({ ...source, output: next || undefined })}
                  options={getIndicatorOutputs(source.indicatorType).map((output) => ({
                    value: output.key,
                    label: output.label,
                  }))}
                  size="sm"
                  triggerClassName={selectTriggerCls}
                />
              </div>
            )}
          </div>

          {getIndicatorCatalogEntry(source.indicatorType).paramOrder.length > 0 && (
            <div
              className={`grid gap-2 ${
                getIndicatorCatalogEntry(source.indicatorType).paramOrder.length > 1 ? "grid-cols-2" : "grid-cols-1"
              }`}
            >
              {getIndicatorCatalogEntry(source.indicatorType).paramOrder.map((paramKey) => {
                const catalog = getIndicatorCatalogEntry(source.indicatorType);
                const defaultValue = catalog.defaults[paramKey];
                const label = catalog.paramLabels[paramKey] ?? paramKey;
                return (
                  <div key={paramKey}>
                    <label className={labelCls}>{label}</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={source.params[paramKey] ?? ""}
                      onChange={(e) =>
                        onChange({
                          ...source,
                          params: {
                            ...source.params,
                            [paramKey]: e.target.value === "" ? defaultValue : Number(e.target.value) || defaultValue,
                          },
                        })
                      }
                      className={inputCls}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IndicatorForm({
  source,
  onSourceChange,
}: {
  source: ValueSource;
  onSourceChange: (source: ValueSource) => void;
}) {
  return (
    <div className="space-y-2">
      <ValueSourceEditor
        source={source}
        onChange={onSourceChange}
        title="Displayed Value"
        description="Pick any indicator, quote field, symbol field, or ETF field to render in the watchlist."
      />
      <p className="text-[9px] text-white/20">
        Current source: {getValueSourceLabel(source)}
      </p>
    </div>
  );
}

function CrossoverForm({
  combos,
  onUpdateCombo,
  onAddCombo,
  onRemoveCombo,
}: {
  combos: CrossoverCombo[];
  onUpdateCombo: (idx: number, updates: Partial<CrossoverCombo>) => void;
  onAddCombo: () => void;
  onRemoveCombo: (idx: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {combos.map((combo, index) => (
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
              <ValueSourceEditor
                source={combo.left}
                onChange={(left) => onUpdateCombo(index, { left })}
                title="Left Source"
                description="BUY if every left source is above its paired right source."
              />
              <ValueSourceEditor
                source={combo.right}
                onChange={(right) => onUpdateCombo(index, { right })}
                title="Right Source"
                description="SELL if every left source is below its paired right source."
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onAddCombo}
        className="rounded border border-white/[0.08] px-2 py-1 text-[10px] text-white/45 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/75"
      >
        Add Another Combo
      </button>

      <p className="text-[9px] text-white/20">
        Final result: BUY only when every combo is above, SELL only when every combo is below, otherwise NEUTRAL.
      </p>
    </div>
  );
}

function ScoreForm({
  conditions,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}: {
  conditions: ScoreCondition[];
  onAddCondition: () => void;
  onUpdateCondition: (idx: number, updates: Partial<ScoreCondition>) => void;
  onRemoveCondition: (idx: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="pb-1.5 text-[8px] uppercase tracking-wider text-white/25">Conditions</p>
        <div className="space-y-2">
          {conditions.map((cond, index) => (
            <div
              key={index}
              className="space-y-2 rounded border border-white/[0.06] bg-[#0D1117]/50 p-2.5"
            >
              <div className="flex items-center justify-between">
                <p className="text-[8px] uppercase tracking-wider text-white/25">Condition {index + 1}</p>
                {conditions.length > 1 && (
                  <button
                    onClick={() => onRemoveCondition(index)}
                    className="rounded px-1 py-0.5 text-[9px] text-white/25 hover:bg-white/[0.06] hover:text-white/55"
                  >
                    Remove
                  </button>
                )}
              </div>

              <ValueSourceEditor
                source={cond.left}
                onChange={(left) => onUpdateCondition(index, { left })}
                title="Check This"
              />

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>Operator</label>
                  <CustomSelect
                    value={cond.operator}
                    onChange={(next) => onUpdateCondition(index, { operator: next as ScoreOperator })}
                    options={COMPARISON_OPTIONS}
                    size="sm"
                    triggerClassName={selectTriggerCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Compare Against</label>
                  <CustomSelect
                    value={cond.targetType}
                    onChange={(next) =>
                      onUpdateCondition(index, {
                        targetType: next as "value" | "source",
                        right: next === "source" ? cond.right ?? getDefaultValueSource("quote") : undefined,
                      })
                    }
                    options={TARGET_OPTIONS}
                    size="sm"
                    triggerClassName={selectTriggerCls}
                  />
                </div>
                {cond.targetType === "value" && (
                  <div>
                    <label className={labelCls}>Threshold</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={cond.threshold}
                      onChange={(e) => onUpdateCondition(index, { threshold: Number(e.target.value) || 0 })}
                      className={inputCls}
                    />
                  </div>
                )}
              </div>

              {cond.targetType === "source" && (
                <ValueSourceEditor
                  source={cond.right ?? getDefaultValueSource("quote")}
                  onChange={(right) => onUpdateCondition(index, { right })}
                  title="Against This Source"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onAddCondition}
        className="rounded border border-white/[0.08] px-2 py-1 text-[10px] text-white/45 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/75"
      >
        Add Condition
      </button>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import CustomSelect from "../../components/CustomSelect";
import { indicatorRegistry } from "../indicators/registry";
import {
  CUSTOM_STRATEGY_INDICATOR_KEYS,
  CUSTOM_STRATEGY_QUOTE_FIELDS,
  getCustomStrategySourceLabel,
  makeCustomStrategyIndicatorSource,
  makeCustomStrategyQuoteSource,
  type CustomStrategyCondition,
  type CustomStrategyDefinition,
  type CustomStrategyIndicatorKey,
  type CustomStrategyScoreOperator,
  type CustomStrategyValueSource,
} from "../customStrategies";

interface CustomStrategyModalProps {
  open: boolean;
  strategy: CustomStrategyDefinition | null;
  onSave: (strategy: CustomStrategyDefinition) => void;
  onClose: () => void;
}

const labelCls = "block pb-1 text-[8px] uppercase tracking-wider text-white/25";
const inputCls =
  "w-full appearance-none rounded border border-white/[0.08] bg-[#0D1117] px-2 py-1.5 font-mono text-[10px] text-white/80 outline-none focus:border-[#1A56DB]/50 placeholder:text-white/20";
const selectTriggerCls =
  "w-full font-mono text-[10px] text-white/80 focus:border-[#1A56DB]/50";

const COMPARISON_OPTIONS = [
  { value: "above", label: "above" },
  { value: "below", label: "below" },
  { value: "equal", label: "equals" },
  { value: "notEqual", label: "not equal" },
];

function makeCondition(): CustomStrategyCondition {
  return {
    left: makeCustomStrategyIndicatorSource("Technical Score"),
    operator: "above",
    targetType: "value",
    threshold: 50,
  };
}

function SourceEditor({
  source,
  onChange,
}: {
  source: CustomStrategyValueSource;
  onChange: (source: CustomStrategyValueSource) => void;
}) {
  const indicatorMeta = useMemo(
    () => (source.sourceKind === "indicator" ? indicatorRegistry[source.indicatorKey] : null),
    [source],
  );

  return (
    <div className="space-y-2 rounded border border-white/[0.06] bg-[#0D1117]/50 p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Source Type</label>
          <CustomSelect
            value={source.sourceKind}
            onChange={(next) => onChange(next === "quote" ? makeCustomStrategyQuoteSource() : makeCustomStrategyIndicatorSource())}
            options={[
              { value: "indicator", label: "Indicator" },
              { value: "quote", label: "Price Field" },
            ]}
            size="sm"
            triggerClassName={selectTriggerCls}
          />
        </div>

        {source.sourceKind === "indicator" ? (
          <div>
            <label className={labelCls}>Indicator</label>
            <CustomSelect
              value={source.indicatorKey}
              onChange={(next) => onChange(makeCustomStrategyIndicatorSource(next as CustomStrategyIndicatorKey))}
              options={CUSTOM_STRATEGY_INDICATOR_KEYS.map((key) => ({ value: key, label: indicatorRegistry[key].name }))}
              size="sm"
              triggerClassName={selectTriggerCls}
            />
          </div>
        ) : (
          <div>
            <label className={labelCls}>Field</label>
            <CustomSelect
              value={source.field}
              onChange={(next) => onChange(makeCustomStrategyQuoteSource(next as typeof CUSTOM_STRATEGY_QUOTE_FIELDS[number]["value"]))}
              options={CUSTOM_STRATEGY_QUOTE_FIELDS}
              size="sm"
              triggerClassName={selectTriggerCls}
            />
          </div>
        )}
      </div>

      {source.sourceKind === "indicator" && (
        <>
          <div className="grid grid-cols-1 gap-2">
            <div>
              <label className={labelCls}>Output</label>
              <CustomSelect
                value={source.output}
                onChange={(next) => onChange({ ...source, output: next || indicatorMeta?.outputs[0]?.key || source.output })}
                options={(indicatorMeta?.outputs ?? []).map((output) => ({
                  value: output.key,
                  label: output.label,
                }))}
                size="sm"
                triggerClassName={selectTriggerCls}
              />
            </div>
          </div>
          <p className="text-[9px] text-white/20">Uses the active chart timeframe.</p>

          {Object.keys(indicatorMeta?.defaultParams ?? {}).length > 0 && (
            <div className={`grid gap-2 ${Object.keys(indicatorMeta?.defaultParams ?? {}).length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {Object.keys(indicatorMeta?.defaultParams ?? {}).map((paramKey) => (
                <div key={paramKey}>
                  <label className={labelCls}>{indicatorMeta?.paramLabels[paramKey] ?? paramKey}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={source.params[paramKey] ?? ""}
                    onChange={(e) => {
                      const fallback = indicatorMeta?.defaultParams[paramKey] ?? 0;
                      onChange({
                        ...source,
                        params: {
                          ...source.params,
                          [paramKey]: e.target.value === "" ? fallback : Number(e.target.value) || fallback,
                        },
                      });
                    }}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="text-[9px] text-white/20">Current source: {getCustomStrategySourceLabel(source)}</p>
    </div>
  );
}

export default function CustomStrategyModal({
  open,
  strategy,
  onSave,
  onClose,
}: CustomStrategyModalProps) {
  const [draft, setDraft] = useState<CustomStrategyDefinition | null>(strategy);

  useEffect(() => {
    setDraft(strategy);
  }, [strategy]);

  if (!open || !draft) return null;

  return createPortal(
    <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/50">
      <div className="w-[760px] rounded-lg border border-white/[0.08] bg-[#161B22] shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div>
            <h3 className="text-[13px] font-semibold text-white">
              {strategy ? "Custom Strategy" : "Custom Strategy"}
            </h3>
            <p className="text-[10px] text-white/30">
              Build a reusable chart strategy that outputs one score and derived BUY/SELL state.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/60"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[540px] space-y-3 overflow-y-auto px-5 py-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Name</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Buy Threshold</label>
              <input
                type="text"
                inputMode="decimal"
                value={draft.buyThreshold}
                onChange={(e) => setDraft({ ...draft, buyThreshold: Number(e.target.value) || 0 })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Sell Threshold</label>
              <input
                type="text"
                inputMode="decimal"
                value={draft.sellThreshold}
                onChange={(e) => setDraft({ ...draft, sellThreshold: Number(e.target.value) || 0 })}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between pb-1.5">
              <p className="text-[8px] uppercase tracking-wider text-white/25">Conditions</p>
              <button
                onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, makeCondition()] })}
                className="inline-flex items-center gap-1 rounded border border-white/[0.08] px-2 py-1 text-[10px] text-white/50 hover:bg-white/[0.04] hover:text-white/80"
              >
                <Plus size={10} />
                Condition
              </button>
            </div>

            <div className="space-y-2">
              {draft.conditions.map((condition, index) => (
                <div key={`${draft.id}-${index}`} className="space-y-2 rounded border border-white/[0.06] bg-[#0D1117]/40 p-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[8px] uppercase tracking-wider text-white/25">Condition {index + 1}</p>
                    {draft.conditions.length > 1 && (
                      <button
                        onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, itemIndex) => itemIndex !== index) })}
                        className="rounded px-1 py-0.5 text-[9px] text-white/25 hover:bg-white/[0.06] hover:text-white/55"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <SourceEditor
                    source={condition.left}
                    onChange={(left) => {
                      const next = [...draft.conditions];
                      next[index] = { ...condition, left };
                      setDraft({ ...draft, conditions: next });
                    }}
                  />

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>Operator</label>
                      <CustomSelect
                        value={condition.operator}
                        onChange={(next) => {
                          const conditions = [...draft.conditions];
                          conditions[index] = { ...condition, operator: next as CustomStrategyScoreOperator };
                          setDraft({ ...draft, conditions });
                        }}
                        options={COMPARISON_OPTIONS}
                        size="sm"
                        triggerClassName={selectTriggerCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Compare Against</label>
                      <CustomSelect
                        value={condition.targetType}
                        onChange={(next) => {
                          const conditions = [...draft.conditions];
                          conditions[index] = {
                            ...condition,
                            targetType: next as "value" | "source",
                            right: next === "source" ? condition.right ?? makeCustomStrategyQuoteSource("last") : undefined,
                          };
                          setDraft({ ...draft, conditions });
                        }}
                        options={[
                          { value: "value", label: "Number" },
                          { value: "source", label: "Another Source" },
                        ]}
                        size="sm"
                        triggerClassName={selectTriggerCls}
                      />
                    </div>
                    {condition.targetType === "value" && (
                      <div>
                        <label className={labelCls}>Threshold</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={condition.threshold}
                          onChange={(e) => {
                            const conditions = [...draft.conditions];
                            conditions[index] = { ...condition, threshold: Number(e.target.value) || 0 };
                            setDraft({ ...draft, conditions });
                          }}
                          className={inputCls}
                        />
                      </div>
                    )}
                  </div>

                  {condition.targetType === "source" && (
                    <SourceEditor
                      source={condition.right ?? makeCustomStrategyQuoteSource("last")}
                      onChange={(right) => {
                        const conditions = [...draft.conditions];
                        conditions[index] = { ...condition, right };
                        setDraft({ ...draft, conditions });
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-[10px] font-medium text-white/50 hover:bg-white/[0.04] hover:text-white/70"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="rounded bg-[#1A56DB] px-4 py-1.5 text-[10px] font-medium text-white hover:bg-[#1A56DB]/90"
          >
            Save Strategy
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

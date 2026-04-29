import { useState, useEffect } from 'react';
import type { ActiveIndicator } from '../types';
import { indicatorRegistry } from '../indicators/registry';
import { X, Eye, EyeOff } from 'lucide-react';

interface IndicatorSettingsProps {
  indicators: ActiveIndicator[];
  onUpdateParams: (id: string, params: Record<string, number>) => void;
  onRemove: (id: string) => void;
  onToggleVisibility: (id: string) => void;
}

/** Inline numeric input without browser spinners. */
function InlineNumericInput({
  value,
  onChange,
  title,
}: {
  value: number;
  onChange: (v: number) => void;
  title?: string;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const v = parseInt(text, 10);
    if (!isNaN(v) && v > 0) {
      onChange(v);
    } else {
      setText(String(value));
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); }}
      title={title}
      className="w-[36px] bg-hover text-[10px] text-text-primary font-mono text-center
                 rounded-input outline-none border border-transparent
                 focus:border-blue transition-colors duration-120"
    />
  );
}

function InlineCheckbox({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <label
      title={title}
      className="flex h-[18px] w-[18px] items-center justify-center rounded-input border border-border-default bg-hover cursor-pointer"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-[12px] w-[12px] accent-blue cursor-pointer"
      />
    </label>
  );
}

function isBooleanParam(label: string | undefined): boolean {
  if (!label) return false;
  return label.includes('1/0') || label.includes('(1/0)');
}

export default function IndicatorSettings({
  indicators,
  onUpdateParams,
  onRemove,
  onToggleVisibility,
}: IndicatorSettingsProps) {
  if (indicators.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-2 h-[28px] border-b border-border-default bg-base shrink-0 overflow-x-auto">
      {indicators.map((ind) => {
        const meta = indicatorRegistry[ind.name];
        if (!meta) return null;

        return (
          <div
            key={ind.id}
            className="flex items-center gap-1 shrink-0"
          >
            <span className="text-[10px] text-text-secondary font-mono">
              {meta.shortName}
            </span>
            {Object.entries(meta.defaultParams).map(([key, defaultValue]) => {
              if (ind.name === 'Probability Engine' && key === 'detailedStats') return null;
              const value = ind.params[key] ?? defaultValue;
              const label = meta.paramLabels[key] || key;
              if (isBooleanParam(label)) {
                return (
                  <InlineCheckbox
                    key={key}
                    checked={value >= 0.5}
                    onChange={checked => onUpdateParams(ind.id, { [key]: checked ? 1 : 0 })}
                    title={label}
                  />
                );
              }
              return (
                <InlineNumericInput
                  key={key}
                  value={value}
                  onChange={v => onUpdateParams(ind.id, { [key]: v })}
                  title={label}
                />
              );
            })}
            <button
              onClick={() => onToggleVisibility(ind.id)}
              className="text-text-muted hover:text-text-secondary p-0.5"
            >
              {ind.visible ? <Eye size={10} /> : <EyeOff size={10} />}
            </button>
            <button
              onClick={() => onRemove(ind.id)}
              className="text-text-muted hover:text-red p-0.5"
            >
              <X size={10} />
            </button>
            <div className="w-px h-3 bg-border-default ml-1" />
          </div>
        );
      })}
    </div>
  );
}

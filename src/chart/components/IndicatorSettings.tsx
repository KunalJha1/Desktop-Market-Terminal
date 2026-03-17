import type { ActiveIndicator } from '../types';
import { indicatorRegistry } from '../indicators/registry';
import { X, Eye, EyeOff } from 'lucide-react';

interface IndicatorSettingsProps {
  indicators: ActiveIndicator[];
  onUpdateParams: (id: string, params: Record<string, number>) => void;
  onRemove: (id: string) => void;
  onToggleVisibility: (id: string) => void;
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
            {Object.entries(ind.params).map(([key, value]) => (
              <input
                key={key}
                type="number"
                value={value}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v > 0) {
                    onUpdateParams(ind.id, { [key]: v });
                  }
                }}
                title={meta.paramLabels[key] || key}
                className="w-[36px] bg-hover text-[10px] text-text-primary font-mono text-center
                           rounded-input outline-none border border-transparent
                           focus:border-blue transition-colors duration-120"
              />
            ))}
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

import { useState, useRef, useEffect } from 'react';
import type { ActiveIndicator, ScriptResult } from '../types';
import { indicatorRegistry } from '../indicators/registry';
import { Eye, EyeOff, X, Settings } from 'lucide-react';

const COLOR_PALETTE = [
  '#1A56DB', '#F59E0B', '#8B5CF6', '#00C853',
  '#FF3D71', '#06B6D4', '#F97316', '#EC4899',
  '#E6EDF3', '#8B949E',
];

function ColorSwatchPicker({
  color,
  onChange,
  onClose,
}: {
  color: string;
  onChange: (c: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 0,
        left: 22,
        zIndex: 200,
        backgroundColor: '#161B22',
        border: '1px solid #21262D',
        borderRadius: 4,
        padding: 6,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        width: 118,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      }}
    >
      {COLOR_PALETTE.map(c => (
        <button
          key={c}
          onClick={() => { onChange(c); onClose(); }}
          style={{
            width: 16,
            height: 16,
            borderRadius: 2,
            backgroundColor: c,
            border: c.toLowerCase() === color.toLowerCase()
              ? '2px solid #E6EDF3'
              : '2px solid transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <input
        type="color"
        defaultValue={color}
        onChange={e => onChange(e.target.value)}
        title="Custom color"
        style={{
          width: 16,
          height: 16,
          cursor: 'pointer',
          padding: 0,
          border: 'none',
          borderRadius: 2,
          backgroundColor: 'transparent',
        }}
      />
    </div>
  );
}

interface IndicatorLegendProps {
  indicators: ActiveIndicator[];
  activeScripts: Map<string, ScriptResult>;
  onUpdateParams: (id: string, params: Record<string, number>) => void;
  onUpdateColor: (id: string, outputKey: string, color: string) => void;
  onRemove: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onSetDefaultColor?: (indicatorName: string, outputKey: string, color: string) => void;
}

export default function IndicatorLegend({
  indicators,
  activeScripts,
  onUpdateParams,
  onUpdateColor,
  onRemove,
  onToggleVisibility,
  onSetDefaultColor,
}: IndicatorLegendProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [colorPicker, setColorPicker] = useState<{ id: string; key: string } | null>(null);

  const hasScripts = Array.from(activeScripts.values()).some(r => r.plots.length > 0);
  if (indicators.length === 0 && !hasScripts) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 30,
        left: 8,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      {indicators.map(ind => {
        const meta = indicatorRegistry[ind.name];
        if (!meta) return null;
        const isHovered = hoveredId === ind.id;
        const isExpanded = expandedId === ind.id;
        const colors = ind.colors ?? {};

        return (
          <div
            key={ind.id}
            style={{ display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}
          >
            {/* Main row */}
            <div
              onMouseEnter={() => setHoveredId(ind.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 6px 2px 4px',
                borderRadius: isExpanded ? '3px 3px 0 0' : 3,
                backgroundColor: isHovered || isExpanded
                  ? 'rgba(28,33,40,0.92)'
                  : 'rgba(13,17,23,0.72)',
                transition: 'background-color 120ms ease-out',
                backdropFilter: 'blur(2px)',
                cursor: 'default',
                minHeight: 20,
              }}
            >
              {/* Color swatches — one per output */}
              {meta.outputs.map(output => {
                const c = colors[output.key] ?? output.color;
                const isPickerOpen =
                  colorPicker?.id === ind.id && colorPicker?.key === output.key;
                return (
                  <div key={output.key} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <button
                      onClick={() =>
                        setColorPicker(isPickerOpen ? null : { id: ind.id, key: output.key })
                      }
                      title={`${output.label} color`}
                      style={{
                        width: output.style === 'dots' ? 7 : 14,
                        height: output.style === 'dots' ? 7 : 3,
                        borderRadius: output.style === 'dots' ? '50%' : 1,
                        backgroundColor: c,
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        opacity: ind.visible ? 1 : 0.35,
                        display: 'block',
                        transition: 'opacity 120ms ease-out',
                        flexShrink: 0,
                      }}
                    />
                    {isPickerOpen && (
                      <ColorSwatchPicker
                        color={c}
                        onChange={newColor => onUpdateColor(ind.id, output.key, newColor)}
                        onClose={() => setColorPicker(null)}
                      />
                    )}
                  </div>
                );
              })}

              {/* Name + params */}
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: ind.visible ? '#8B949E' : '#484F58',
                  lineHeight: 1,
                  transition: 'color 120ms ease-out',
                  whiteSpace: 'nowrap',
                }}
              >
                {meta.shortName}
                {Object.keys(ind.params).length > 0 && (
                  <span style={{ color: ind.visible ? '#484F58' : '#2D3340' }}>
                    {' ('}
                    {Object.values(ind.params).join(', ')}
                    {')'}
                  </span>
                )}
              </span>

              {/* Action buttons — show on hover */}
              {isHovered && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 1, marginLeft: 2 }}>
                  <IconBtn
                    onClick={() => setExpandedId(isExpanded ? null : ind.id)}
                    active={isExpanded}
                    title="Settings"
                  >
                    <Settings size={9} />
                  </IconBtn>
                  <IconBtn
                    onClick={() => onToggleVisibility(ind.id)}
                    title={ind.visible ? 'Hide' : 'Show'}
                  >
                    {ind.visible ? <Eye size={9} /> : <EyeOff size={9} />}
                  </IconBtn>
                  <IconBtn
                    onClick={() => {
                      setExpandedId(null);
                      onRemove(ind.id);
                    }}
                    danger
                    title="Remove"
                  >
                    <X size={9} />
                  </IconBtn>
                </div>
              )}
            </div>

            {/* Expanded param editor */}
            {isExpanded && (
              <div
                onMouseEnter={() => setHoveredId(ind.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '5px 8px',
                  backgroundColor: 'rgba(22,27,34,0.95)',
                  borderRadius: '0 0 3px 3px',
                  borderTop: '1px solid rgba(33,38,45,0.8)',
                }}
              >
                {Object.entries(ind.params).map(([key, value]) => (
                  <label
                    key={key}
                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        color: '#484F58',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {meta.paramLabels[key] ?? key}
                    </span>
                    <input
                      type="number"
                      value={value}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v > 0) onUpdateParams(ind.id, { [key]: v });
                      }}
                      style={{
                        width: 44,
                        backgroundColor: '#1C2128',
                        color: '#E6EDF3',
                        fontSize: 10,
                        fontFamily: "'JetBrains Mono', monospace",
                        textAlign: 'center',
                        border: '1px solid #21262D',
                        borderRadius: 2,
                        outline: 'none',
                        padding: '1px 4px',
                      }}
                      onFocus={e => (e.currentTarget.style.borderColor = '#1A56DB')}
                      onBlur={e => (e.currentTarget.style.borderColor = '#21262D')}
                    />
                  </label>
                ))}
                {/* Per-output color pickers in expanded view */}
                {meta.outputs.map(output => {
                  const c = colors[output.key] ?? output.color;
                  const isPickerOpen =
                    colorPicker?.id === ind.id && colorPicker?.key === output.key;
                  return (
                    <div
                      key={output.key}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          color: '#484F58',
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {output.label}
                      </span>
                      <button
                        onClick={() =>
                          setColorPicker(isPickerOpen ? null : { id: ind.id, key: output.key })
                        }
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 2,
                          backgroundColor: c,
                          border: '1px solid #21262D',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      />
                      {onSetDefaultColor && (
                        <button
                          onClick={() => onSetDefaultColor(ind.name, output.key, c)}
                          style={{
                            fontSize: 8,
                            color: '#8B949E',
                            fontFamily: "'JetBrains Mono', monospace",
                            border: '1px solid #21262D',
                            background: 'none',
                            padding: '1px 4px',
                            borderRadius: 2,
                            cursor: 'pointer',
                          }}
                          title="Set default for new indicators"
                        >
                          Default
                        </button>
                      )}
                      {isPickerOpen && (
                        <ColorSwatchPicker
                          color={c}
                          onChange={newColor => onUpdateColor(ind.id, output.key, newColor)}
                          onClose={() => setColorPicker(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Active script entries */}
      {Array.from(activeScripts.entries()).map(([id, result]) =>
        result.plots.length > 0 ? (
          <div
            key={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 6px 2px 4px',
              borderRadius: 3,
              backgroundColor: 'rgba(13,17,23,0.72)',
              backdropFilter: 'blur(2px)',
              pointerEvents: 'auto',
            }}
          >
            {result.plots.map((plot, i) => (
              <span
                key={i}
                style={{
                  width: 14,
                  height: 3,
                  borderRadius: 1,
                  backgroundColor: plot.color,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
            ))}
            <span
              style={{
                fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
                color: '#8B5CF6',
                whiteSpace: 'nowrap',
              }}
            >
              {result.plots.map(p => p.label).join(' · ')}
            </span>
          </div>
        ) : null
      )}
    </div>
  );
}

// Tiny icon button helper
function IconBtn({
  onClick,
  children,
  title,
  active,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  active?: boolean;
  danger?: boolean;
}) {
  const baseColor = active ? '#E6EDF3' : '#484F58';
  const hoverColor = danger ? '#FF3D71' : '#E6EDF3';

  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        color: baseColor,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 2,
        borderRadius: 2,
        transition: 'color 120ms ease-out',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = hoverColor)}
      onMouseLeave={e => (e.currentTarget.style.color = baseColor)}
    >
      {children}
    </button>
  );
}

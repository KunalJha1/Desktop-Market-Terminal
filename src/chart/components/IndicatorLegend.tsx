import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ActiveIndicator, IndicatorOutput, ScriptResult } from '../types';
import { indicatorRegistry } from '../indicators/registry';
import { Eye, EyeOff, X, Settings, ChevronUp, ChevronDown, Pencil } from 'lucide-react';

const LINE_STYLES: Array<{ key: 'solid' | 'dashed' | 'dotted'; css: string }> = [
  { key: 'solid', css: 'solid' },
  { key: 'dashed', css: 'dashed' },
  { key: 'dotted', css: 'dotted' },
];

const LEGEND_ROW_BG = '#000000';
const LEGEND_ROW_BG_ACTIVE = '#000000';
const LEGEND_ROW_BORDER = 'rgba(255,255,255,0.08)';
const CHOP_ZONE_ROW_BG = '#000000';

// ── Color math ────────────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full.padEnd(6, '0'), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
}

function hsvToHex(h: number, s: number, v: number): string {
  return rgbToHex(...hsvToRgb(h, s, v));
}

// ── Full HSV Color Picker ─────────────────────────────────────────────────────
function ColorPicker({
  color,
  onChange,
  onClose,
  anchorRect,
}: {
  color: string;
  onChange: (c: string) => void;
  onClose: () => void;
  anchorRect: DOMRect;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const initHsv = (): [number, number, number] => {
    try { return rgbToHsv(...hexToRgb(color)); } catch { return [0, 1, 1]; }
  };
  const [[h, s, v], setHsv] = useState<[number, number, number]>(initHsv);
  const [hexInput, setHexInput] = useState(color.replace('#', '').toUpperCase());
  const [hexError, setHexError] = useState(false);
  const dragging = useRef<'square' | 'hue' | null>(null);

  // Close on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  // Keep hex input in sync when h/s/v change (not while typing in hex)
  const applyHsv = useCallback((nh: number, ns: number, nv: number) => {
    setHsv([nh, ns, nv]);
    const hex = hsvToHex(nh, ns, nv);
    setHexInput(hex.replace('#', '').toUpperCase());
    setHexError(false);
    onChange(hex);
  }, [onChange]);

  // Square drag
  const handleSquareMouse = useCallback((e: MouseEvent) => {
    const el = squareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ns = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nv = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    applyHsv(h, ns, nv);
  }, [h, applyHsv]);

  // Hue drag
  const handleHueMouse = useCallback((e: MouseEvent) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nh = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
    applyHsv(nh, s, v);
  }, [s, v, applyHsv]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current === 'square') handleSquareMouse(e);
      if (dragging.current === 'hue') handleHueMouse(e);
    };
    const onUp = () => { dragging.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [handleSquareMouse, handleHueMouse]);

  const hueColor = hsvToHex(h, 1, 1);
  const currentColor = hsvToHex(h, s, v);
  // Cursor position in the square
  const cursorX = s * 100;
  const cursorY = (1 - v) * 100;

  // Position: try right of anchor, flip left if off-screen
  const PICKER_W = 212;
  const PICKER_H = 240;
  const spaceRight = window.innerWidth - anchorRect.right;
  const left = spaceRight >= PICKER_W + 8
    ? anchorRect.right + 6
    : anchorRect.left - PICKER_W - 6;
  const top = Math.min(anchorRect.top, window.innerHeight - PICKER_H - 8);

  return createPortal(
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 9999,
        backgroundColor: '#161B22',
        border: '1px solid #30363D',
        borderRadius: 6,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: PICKER_W,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        userSelect: 'none',
      }}
    >
      {/* Saturation / Value square */}
      <div
        ref={squareRef}
        onMouseDown={e => { dragging.current = 'square'; handleSquareMouse(e.nativeEvent); }}
        style={{
          position: 'relative',
          width: '100%',
          height: 140,
          borderRadius: 4,
          backgroundColor: hueColor,
          backgroundImage:
            'linear-gradient(to right, #fff, transparent), linear-gradient(to bottom, transparent, #000)',
          cursor: 'crosshair',
          flexShrink: 0,
        }}
      >
        {/* Cursor circle */}
        <div
          style={{
            position: 'absolute',
            left: `${cursorX}%`,
            top: `${cursorY}%`,
            width: 10,
            height: 10,
            borderRadius: '50%',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Hue slider */}
      <div
        ref={hueRef}
        onMouseDown={e => { dragging.current = 'hue'; handleHueMouse(e.nativeEvent); }}
        style={{
          position: 'relative',
          width: '100%',
          height: 10,
          borderRadius: 5,
          background:
            'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          cursor: 'ew-resize',
          flexShrink: 0,
        }}
      >
        {/* Hue thumb */}
        <div
          style={{
            position: 'absolute',
            left: `${(h / 360) * 100}%`,
            top: '50%',
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: hueColor,
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Preview + hex input row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            backgroundColor: currentColor,
            border: '1px solid rgba(255,255,255,0.1)',
            flexShrink: 0,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: '#484F58' }}>#</span>
          <input
            type="text"
            value={hexInput}
            maxLength={6}
            spellCheck={false}
            onChange={e => {
              const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
              setHexInput(v);
              if (v.length === 6) {
                try {
                  const [r, g, b] = hexToRgb(v);
                  const [nh, ns, nv] = rgbToHsv(r, g, b);
                  setHsv([nh, ns, nv]);
                  setHexError(false);
                  onChange('#' + v);
                } catch { setHexError(true); }
              } else {
                setHexError(v.length > 0);
              }
            }}
            onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
            style={{
              flex: 1,
              minWidth: 0,
              backgroundColor: '#0D1117',
              color: hexError ? '#FF3D71' : '#E6EDF3',
              fontSize: 11,
              fontFamily: '"JetBrains Mono", monospace',
              border: `1px solid ${hexError ? '#FF3D71' : '#30363D'}`,
              borderRadius: 3,
              outline: 'none',
              padding: '3px 6px',
              letterSpacing: 1,
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Plain text input that only accepts numbers. Commits on blur/enter, reverts on invalid. */
function NumericInput({
  value,
  onChange,
  width = 44,
}: {
  value: number;
  onChange: (v: number) => void;
  width?: number;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const v = parseFloat(text);
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
      style={{
        width,
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
    />
  );
}

function TextInput({
  value,
  onChange,
  width = 88,
}: {
  value: string;
  onChange: (v: string) => void;
  width?: number;
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  const commit = () => {
    onChange(text.trim());
  };

  return (
    <input
      type="text"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); }}
      style={{
        width,
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
    />
  );
}

function TogglePill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: '1px solid #21262D',
        background: active ? '#1A56DB' : '#1C2128',
        color: active ? '#E6EDF3' : '#8B949E',
        borderRadius: 999,
        padding: '2px 7px',
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
        cursor: 'pointer',
      }}
    >
      {label}: {active ? 'On' : 'Off'}
    </button>
  );
}

interface IndicatorLegendProps {
  indicators: ActiveIndicator[];
  activeScripts: Map<string, ScriptResult>;
  onUpdateParams: (id: string, params: Record<string, number>) => void;
  onUpdateTextParams?: (id: string, textParams: Record<string, string>) => void;
  onUpdateColor: (id: string, outputKey: string, color: string) => void;
  onUpdateLineWidth?: (id: string, outputKey: string, width: number) => void;
  onUpdateLineStyle?: (id: string, outputKey: string, style: 'solid' | 'dashed' | 'dotted') => void;
  onRemove: (id: string) => void;
  onRemoveScript?: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onSetDefaultColor?: (indicatorName: string, outputKey: string, color: string) => void;
  onMoveUp?: (id: string) => void;
  onMoveDown?: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onOpenBuiltInScript?: (script: { indicatorId: string; name: string; source: string }) => void;
  leftOffset?: number;
  allCollapsed?: boolean;
  onCollapsedChange?: (v: boolean) => void;
}

export default function IndicatorLegend({
  indicators,
  activeScripts,
  onUpdateParams,
  onUpdateTextParams,
  onUpdateColor,
  onUpdateLineWidth,
  onUpdateLineStyle,
  onRemove,
  onRemoveScript,
  onToggleVisibility,
  onSetDefaultColor,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
  onOpenBuiltInScript,
  leftOffset = 8,
  allCollapsed: allCollapsedProp,
  onCollapsedChange,
}: IndicatorLegendProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scriptViewerId, setScriptViewerId] = useState<string | null>(null);
  const [colorPicker, setColorPicker] = useState<{ id: string; key: string; rect: DOMRect } | null>(null);
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const isControlled = allCollapsedProp !== undefined;
  const allCollapsed = isControlled ? allCollapsedProp! : localCollapsed;
  const handleToggleCollapsed = () => {
    const next = !allCollapsed;
    if (!isControlled) setLocalCollapsed(next);
    onCollapsedChange?.(next);
  };

  const hasScripts = Array.from(activeScripts.values()).some(r => r.plots.length > 0);
  if (indicators.length === 0 && !hasScripts) return null;

  return (
    <div
      data-no-drag
      style={{
        position: 'absolute',
        top: 30,
        left: leftOffset,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: allCollapsed ? 'center' : 'flex-start',
          pointerEvents: 'auto',
          marginBottom: allCollapsed ? 0 : 2,
        }}
      >
        <button
          type="button"
          onClick={() => {
            handleToggleCollapsed();
            setHoveredId(null);
            setExpandedId(null);
            setScriptViewerId(null);
            setColorPicker(null);
          }}
          title={allCollapsed ? 'Show indicators' : 'Collapse indicators'}
          aria-label={allCollapsed ? 'Show indicators' : 'Collapse indicators'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 22,
            borderRadius: 999,
            border: `1px solid ${LEGEND_ROW_BORDER}`,
            backgroundColor: '#000000',
            color: '#8B949E',
            boxShadow: '0 3px 10px rgba(0, 0, 0, 0.45)',
            cursor: 'pointer',
            transition: 'color 120ms ease-out, border-color 120ms ease-out, transform 120ms ease-out',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#E6EDF3';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#8B949E';
            e.currentTarget.style.borderColor = LEGEND_ROW_BORDER;
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          {allCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>

      {!allCollapsed && indicators.map((ind, index) => {
        const meta = indicatorRegistry[ind.name];
        if (!meta) return null;
        const isHovered = hoveredId === ind.id;
        const isExpanded = expandedId === ind.id;
        const isScriptOpen = scriptViewerId === ind.id;
        const colors = ind.colors ?? {};
        const isChopZone = ind.name === 'Chop Zone';
        const canDrag = ind.name !== 'Probability Engine';
        const legendSwatchOutputs: IndicatorOutput[] = meta.legendSwatchKeys?.length
          ? meta.legendSwatchKeys
            .map((key) => meta.outputs.find((o) => o.key === key))
            .filter((o): o is IndicatorOutput => o != null)
          : meta.outputs;

        return (
          <div
            key={ind.id}
            style={{ display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}
          >
            {/* Main row */}
            <div
              draggable={canDrag}
              onDragStart={(e) => {
                if (!canDrag) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', ind.id);
                onDragStart?.(ind.id);
              }}
              onDragEnd={() => onDragEnd?.()}
              onMouseEnter={() => setHoveredId(ind.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 6px 2px 4px',
                borderRadius: isExpanded ? '3px 3px 0 0' : 3,
                backgroundColor: isChopZone
                  ? CHOP_ZONE_ROW_BG
                  : (isHovered || isExpanded ? LEGEND_ROW_BG_ACTIVE : LEGEND_ROW_BG),
                transition: 'background-color 120ms ease-out',
                border: `1px solid ${LEGEND_ROW_BORDER}`,
                boxShadow: '0 3px 10px rgba(0, 0, 0, 0.45)',
                cursor: 'default',
                minHeight: 20,
              }}
            >
              {/* Color swatches — subset when `legendSwatchKeys` is set (picker in expanded settings) */}
              {legendSwatchOutputs.map(output => {
                const c = colors[output.key] ?? output.color;
                return (
                  <div key={output.key} style={{ display: 'flex', alignItems: 'center' }}>
                    <div
                      style={{
                        width: output.style === 'dots' ? 7 : output.style === 'markers' ? 10 : 14,
                        height: output.style === 'dots' ? 7 : output.style === 'markers' ? 6 : 3,
                        borderRadius: output.style === 'dots' ? '50%' : 1,
                        backgroundColor: c,
                        opacity: ind.visible ? 1 : 0.35,
                        transition: 'opacity 120ms ease-out',
                        flexShrink: 0,
                      }}
                    />
                  </div>
                );
              })}

              {/* Name + params */}
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: ind.visible ? '#E6EDF3' : '#484F58',
                  lineHeight: 1,
                  transition: 'color 120ms ease-out',
                  whiteSpace: 'nowrap',
                }}
              >
                {meta.shortName}
                {!meta.legendOmitParamSummary && Object.keys(ind.params).length > 0 && (
                  <span style={{ color: ind.visible ? '#E6EDF3' : '#2D3340' }}>
                    {' ('}
                    {Object.values(ind.params).join(', ')}
                    {')'}
                  </span>
                )}
              </span>

              {/* Action buttons — show on hover */}
              {isHovered && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 1, marginLeft: 2 }}>
                  {meta.scriptSource && (
                    <IconBtn
                      onClick={() => {
                        if (onOpenBuiltInScript) {
                          onOpenBuiltInScript({
                            indicatorId: ind.id,
                            name: ind.name,
                            source: meta.scriptSource!,
                          });
                          return;
                        }
                        setScriptViewerId(isScriptOpen ? null : ind.id);
                      }}
                      active={onOpenBuiltInScript ? false : isScriptOpen}
                      title="View built-in script"
                    >
                      <Pencil size={9} />
                    </IconBtn>
                  )}
                  <IconBtn
                    onClick={() => setExpandedId(isExpanded ? null : ind.id)}
                    active={isExpanded}
                    title="Settings"
                  >
                    <Settings size={9} />
                  </IconBtn>
                  <IconBtn
                    onClick={() => onMoveUp?.(ind.id)}
                    title="Move up"
                    disabled={!onMoveUp || index === 0}
                  >
                    <ChevronUp size={9} />
                  </IconBtn>
                  <IconBtn
                    onClick={() => onMoveDown?.(ind.id)}
                    title="Move down"
                    disabled={!onMoveDown || index === indicators.length - 1}
                  >
                    <ChevronDown size={9} />
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
                      setScriptViewerId(null);
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

            {!onOpenBuiltInScript && isScriptOpen && meta.scriptSource && (
              <div
                onMouseEnter={() => setHoveredId(ind.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '7px 8px',
                  backgroundColor: '#000000',
                  borderRadius: isExpanded ? 0 : '0 0 3px 3px',
                  borderTop: '1px solid rgba(33,38,45,0.8)',
                  minWidth: 240,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 9,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: '#8B949E',
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                  }}
                >
                  <span>Built-in Script</span>
                  <span style={{ color: '#484F58' }}>Read only</span>
                </div>
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 220,
                    overflow: 'auto',
                    padding: '8px 9px',
                    borderRadius: 4,
                    backgroundColor: '#0D1117',
                    border: '1px solid #21262D',
                    color: '#C9D1D9',
                    fontSize: 10,
                    lineHeight: 1.5,
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {meta.scriptSource}
                </pre>
              </div>
            )}

            {/* Expanded settings panel */}
            {isExpanded && (
              <div
                onMouseEnter={() => setHoveredId(ind.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '6px 8px',
                  backgroundColor: '#000000',
                  borderRadius: '0 0 3px 3px',
                  borderTop: '1px solid rgba(33,38,45,0.8)',
                  minWidth: 200,
                }}
              >
                {/* Section 1: Parameters */}
                {Object.keys(ind.params).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(ind.params).map(([key, value]) => (
                      (ind.name === 'DailyIQ Tech Score Signal' && key === 'showScorePane')
                      || (ind.name === 'Probability Engine' && key === 'detailedStats') ? (
                        <TogglePill
                          key={key}
                          active={value > 0}
                          label={meta.paramLabels[key] ?? key}
                          onClick={() => onUpdateParams(ind.id, { [key]: value > 0 ? 0 : 1 })}
                        />
                      ) : (
                        <label
                          key={key}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(84px, 1fr) auto',
                            alignItems: 'center',
                            gap: 8,
                            padding: '4px 6px',
                            borderRadius: 4,
                            border: '1px solid rgba(255,255,255,0.06)',
                            backgroundColor: '#0D1117',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 9,
                              color: '#8B949E',
                              fontFamily: "'JetBrains Mono', monospace",
                            }}
                          >
                            {meta.paramLabels[key] ?? key}
                          </span>
                          <NumericInput
                            value={value}
                            onChange={v => onUpdateParams(ind.id, { [key]: v })}
                          />
                        </label>
                      )
                    ))}
                  </div>
                )}
                {Object.keys(ind.textParams).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(ind.textParams).map(([key, value]) => (
                      <label
                        key={key}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(84px, 1fr) auto',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 6px',
                          borderRadius: 4,
                          border: '1px solid rgba(255,255,255,0.06)',
                          backgroundColor: '#0D1117',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 9,
                            color: '#8B949E',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {meta.textParamLabels?.[key] ?? key}
                        </span>
                        <TextInput
                          value={value}
                          onChange={v => onUpdateTextParams?.(ind.id, { [key]: v })}
                          width={96}
                        />
                      </label>
                    ))}
                  </div>
                )}

                {/* Section 2: Per-output controls */}
                {meta.outputs.map(output => {
                  const c = colors[output.key] ?? output.color;
                  const lw = ind.lineWidths?.[output.key] ?? output.lineWidth ?? 1.5;
                  const ls = ind.lineStyles?.[output.key] ?? 'solid';
                  const isPickerOpen =
                    colorPicker?.id === ind.id && colorPicker?.key === output.key;

                  return (
                    <div
                      key={output.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        position: 'relative',
                      }}
                    >
                      {/* Line preview */}
                      <span
                        style={{
                          display: 'inline-block',
                          width: 20,
                          height: 0,
                          borderTop: `${Math.max(1, Math.round(lw))}px ${ls} ${c}`,
                          flexShrink: 0,
                        }}
                      />

                      {/* Output label */}
                      <span
                        style={{
                          fontSize: 9,
                          color: '#8B949E',
                          fontFamily: "'JetBrains Mono', monospace",
                          minWidth: 40,
                        }}
                      >
                        {output.label}
                      </span>

                      {/* Line width slider */}
                      {output.style !== 'histogram' && output.style !== 'dots' && output.style !== 'markers' && onUpdateLineWidth && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <input
                            type="range"
                            min="0.5"
                            max="4"
                            step="0.5"
                            value={lw}
                            onChange={e => onUpdateLineWidth(ind.id, output.key, parseFloat(e.target.value))}
                            style={{
                              width: 50,
                              height: 3,
                              cursor: 'pointer',
                              accentColor: '#1A56DB',
                            }}
                            title={`Line width: ${lw}`}
                          />
                          <span
                            style={{
                              fontSize: 8,
                              color: '#484F58',
                              fontFamily: "'JetBrains Mono', monospace",
                              width: 16,
                              textAlign: 'right',
                            }}
                          >
                            {lw}
                          </span>
                        </div>
                      )}

                      {/* Line style toggles */}
                      {output.style !== 'histogram' && output.style !== 'dots' && output.style !== 'markers' && onUpdateLineStyle && (
                        <div style={{ display: 'flex', gap: 1 }}>
                          {LINE_STYLES.map(s => (
                            <button
                              key={s.key}
                              onClick={() => onUpdateLineStyle(ind.id, output.key, s.key)}
                              title={s.key}
                              style={{
                                width: 22,
                                height: 16,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'none',
                                border: ls === s.key
                                  ? '1px solid #1A56DB'
                                  : '1px solid #21262D',
                                borderRadius: 2,
                                cursor: 'pointer',
                                padding: 0,
                              }}
                            >
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 14,
                                  height: 0,
                                  borderTop: `2px ${s.css} ${ls === s.key ? '#E6EDF3' : '#484F58'}`,
                                }}
                              />
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Color picker */}
                      <button
                        onClick={e =>
                          setColorPicker(isPickerOpen ? null : { id: ind.id, key: output.key, rect: (e.currentTarget as HTMLButtonElement).getBoundingClientRect() })
                        }
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 2,
                          backgroundColor: c,
                          border: '1px solid #21262D',
                          cursor: 'pointer',
                          padding: 0,
                          flexShrink: 0,
                        }}
                      />

                      {/* Set default */}
                      {onSetDefaultColor && (
                        <button
                          onClick={() => onSetDefaultColor(ind.name, output.key, c)}
                          style={{
                            fontSize: 8,
                            color: '#484F58',
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

                      {isPickerOpen && colorPicker && (
                        <ColorPicker
                          color={c}
                          onChange={newColor => onUpdateColor(ind.id, output.key, newColor)}
                          onClose={() => setColorPicker(null)}
                          anchorRect={colorPicker.rect}
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
      {!allCollapsed && Array.from(activeScripts.entries()).map(([id, result]) =>
        result.plots.length > 0 ? (
          <div
            key={id}
            onMouseEnter={() => setHoveredId(`script:${id}`)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 4px 2px 4px',
              borderRadius: 3,
              backgroundColor: LEGEND_ROW_BG,
              border: `1px solid ${LEGEND_ROW_BORDER}`,
              boxShadow: '0 3px 10px rgba(0, 0, 0, 0.45)',
              pointerEvents: 'auto',
              minHeight: 20,
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
            {hoveredId === `script:${id}` && onRemoveScript && (
              <button
                onClick={() => onRemoveScript(id)}
                title="Remove script"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#8B949E',
                  padding: '0 2px',
                  display: 'flex',
                  alignItems: 'center',
                  lineHeight: 1,
                  marginLeft: 2,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#FF3D71'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#8B949E'; }}
              >
                <X size={10} />
              </button>
            )}
          </div>
        ) : null,
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
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const baseColor = active ? '#FFFFFF' : '#E6EDF3';
  const hoverColor = danger ? '#FF3D71' : '#FFFFFF';
  const hoverBg = danger ? 'rgba(255,61,113,0.12)' : 'rgba(255,255,255,0.08)';

  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        color: disabled ? '#2D3340' : baseColor,
        background: 'none',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        padding: 3,
        borderRadius: 3,
        transition: 'all 120ms ease-out',
      }}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.color = hoverColor;
        e.currentTarget.style.backgroundColor = hoverBg;
        e.currentTarget.style.transform = 'scale(1.15)';
      }}
      onMouseLeave={e => {
        if (disabled) return;
        e.currentTarget.style.color = baseColor;
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {children}
    </button>
  );
}

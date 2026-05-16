import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Lock, Unlock } from 'lucide-react';
import type { TechnicalTableWidgetState } from '../../lib/chart-state';
import type { TechnicalTableSnapshot } from '../../lib/table-overlay';
import {
  DIQ_TABLE_BULL_GREEN,
  TECH_TABLE_HEADER_HEIGHT,
  diqTrendText, diqTrendColor,
  diqStrengthText, diqStrengthColor, diqStrengthTextColor,
  diqChopText, diqChopColor, diqChopTextColor,
  diqRsiText, diqRsiColor,
  diqMacdText, diqMacdColor,
  diqEmaCrossText, diqEmaCrossColor, diqEmaCrossTextColor,
  diqVolMomText, diqVolMomColor, diqVolMomTextColor,
} from '../../lib/table-overlay';
import { DIQ_TABLE_TIMEFRAMES } from '../indicators/overlays/dailyIQTechnicalTable.constants';

export type TechnicalTableResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface Props {
  snapshot: TechnicalTableSnapshot | null;
  widget: TechnicalTableWidgetState;
  dragging: boolean;
  resizing: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHeaderPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHeaderPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHeaderPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (corner: TechnicalTableResizeCorner, event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleLock: () => void;
}

export default function DailyIQTechnicalTableOverlay({
  snapshot,
  widget,
  dragging,
  resizing,
  minWidth = 360,
  maxWidth = 680,
  minHeight = 250,
  maxHeight = 520,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
  onHeaderPointerCancel,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
  onToggleLock,
}: Props) {
  const [headerHovered, setHeaderHovered] = useState(false);
  const rows = snapshot?.rows ?? DIQ_TABLE_TIMEFRAMES.map((tf) => ({
    tf, trend: NaN, strength: NaN, chop: NaN, rsiNow: NaN, rsiPrev: NaN,
    macdNow: NaN, macdSignal: NaN, macdPrev: NaN, macdSignalPrev: NaN, emaCross: NaN, emaCrossGapDir: NaN, volMom: NaN,
  }));

  const overallTrend = snapshot?.overallTrend ?? NaN;
  const overallStrength = snapshot?.overallStrength ?? NaN;
  const overallChop = snapshot?.overallChop ?? NaN;
  const overallRsi = snapshot?.overallRsi ?? NaN;
  const overallMacdState = snapshot?.overallMacdState ?? NaN;
  const overallMacdText = overallMacdState === 1 ? 'Bull' : overallMacdState === -1 ? 'Bear' : 'Flat';
  const overallMacdColor = overallMacdState === 1 ? DIQ_TABLE_BULL_GREEN : overallMacdState === -1 ? '#FF3D71' : '#6B7280';
  const overallEmaCross = snapshot?.overallEmaCross ?? NaN;
  const overallVolMom = snapshot?.overallVolMom ?? NaN;
  const showHeader = !widget.locked || headerHovered;
  const widthScale = (widget.width - minWidth) / (maxWidth - minWidth);
  const heightScale = (widget.height - minHeight) / (maxHeight - minHeight);
  const tableScale = Math.max(0, Math.min(1, (widthScale + heightScale) / 2));
  const titleFontSize = 10 + (tableScale * 4);
  const headerFontSize = 10 + (tableScale * 5);
  const bodyFontSize = 10 + (tableScale * 5);
  const headerPadY = 5 + (tableScale * 5);
  const headerPadX = 7 + (tableScale * 7);
  const bodyPadY = 4 + (tableScale * 5);
  const bodyPadX = 7 + (tableScale * 6);
  const overallPadY = 5 + (tableScale * 5);
  const overallPadX = 7 + (tableScale * 7);
  const headerCellPadding = `${headerPadY}px ${headerPadX}px`;
  const bodyCellPadding = `${bodyPadY}px ${bodyPadX}px`;
  const overallCellPadding = `${overallPadY}px ${overallPadX}px`;
  const lockButtonSize = 16 + (tableScale * 8);
  const gripSize = 12 + (tableScale * 6);
  const handleSize = 14 + (tableScale * 8);
  const resizeHandleInset = 3 + (tableScale * 2);
  const cornerHandles: Array<{ corner: TechnicalTableResizeCorner; cursor: string; style: { left?: number; right?: number; top?: number; bottom?: number } }> = [
    { corner: 'top-left', cursor: 'nwse-resize', style: { left: 0, top: 0 } },
    { corner: 'top-right', cursor: 'nesw-resize', style: { right: 0, top: 0 } },
    { corner: 'bottom-left', cursor: 'nesw-resize', style: { left: 0, bottom: 0 } },
    { corner: 'bottom-right', cursor: 'nwse-resize', style: { right: 0, bottom: 0 } },
  ];

  return (
    <div
      onPointerEnter={() => setHeaderHovered(true)}
      onPointerLeave={() => setHeaderHovered(false)}
      style={{
        position: 'absolute', left: widget.x, top: widget.y, zIndex: 18, pointerEvents: 'auto',
        border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.92)',
        borderRadius: 8, overflow: 'hidden',
        boxShadow: dragging || resizing ? '0 16px 36px rgba(0,0,0,0.52)' : '0 10px 24px rgba(0,0,0,0.42)',
        width: widget.width, height: widget.height, display: 'flex', flexDirection: 'column',
        transition: dragging || resizing ? 'none' : 'box-shadow 120ms ease-out',
      }}
    >
      <div
        onPointerDown={widget.locked ? undefined : onHeaderPointerDown}
        onPointerMove={widget.locked ? undefined : onHeaderPointerMove}
        onPointerUp={widget.locked ? undefined : onHeaderPointerUp}
        onPointerCancel={widget.locked ? undefined : onHeaderPointerCancel}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: TECH_TABLE_HEADER_HEIGHT, zIndex: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 8px 0 6px', borderBottom: '1px solid rgba(255,255,255,0.12)',
          fontSize: titleFontSize, fontFamily: '"JetBrains Mono", monospace', color: '#E6EDF3',
          userSelect: 'none', WebkitUserSelect: 'none',
          background: widget.locked ? '#000000' : dragging
            ? 'linear-gradient(180deg, rgba(39,56,82,0.98) 0%, rgba(19,28,43,0.98) 100%)'
            : 'linear-gradient(180deg, rgba(28,33,40,0.98) 0%, rgba(15,23,32,0.98) 100%)',
          cursor: widget.locked ? 'default' : dragging ? 'grabbing' : 'grab',
          touchAction: widget.locked ? undefined : 'none',
          opacity: showHeader ? 1 : 0, pointerEvents: showHeader ? 'auto' : 'none',
          transform: showHeader ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'opacity 120ms ease-out, transform 120ms ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {!widget.locked && (
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: gripSize, height: gripSize, borderRadius: 4, color: dragging ? '#C7D2FE' : '#8B949E', background: dragging ? 'rgba(140,180,255,0.16)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
              <GripHorizontal size={Math.max(8, gripSize - 6)} strokeWidth={1.7} />
            </span>
          )}
          <span style={{ color: '#8B949E' }}>Technical Table</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
            style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, background: 'transparent', color: '#E6EDF3', width: lockButtonSize, height: lockButtonSize, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontSize: 11 + tableScale, fontFamily: '"JetBrains Mono", monospace', padding: 0, cursor: 'pointer' }}
            title={widget.locked ? 'Unlock placement' : 'Lock placement'}
          >
            {widget.locked ? <Lock size={12} strokeWidth={1.5} /> : <Unlock size={12} strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', backgroundColor: '#1E2232', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <table style={{ width: '100%', height: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: bodyFontSize, fontFamily: '"JetBrains Mono", monospace', color: '#E6EDF3', backgroundColor: '#1E2232', tableLayout: 'fixed', userSelect: 'none', WebkitUserSelect: 'none' }}>
          <colgroup>
            <col style={{ width: '14%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} />
            <col style={{ width: '16%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} />
          </colgroup>
          <thead>
            <tr>
              {['Timeframe', 'Trend', 'Strength', 'Chop', 'RSI', 'MACD', 'EMA Cross', 'Vol Mom'].map((head) => (
                <th key={head} style={{ position: 'sticky', top: 0, zIndex: 1, padding: headerCellPadding, borderBottom: '1px solid rgba(255,255,255,0.14)', backgroundColor: '#1E2232', color: '#FFFFFF', textAlign: head === 'Timeframe' ? 'left' : 'center', fontWeight: 600, fontSize: headerFontSize, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tf}>
                <td style={{ padding: bodyCellPadding, backgroundColor: '#141821', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{row.tf}</td>
                <td style={{ padding: bodyCellPadding, backgroundColor: diqTrendColor(row.trend), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqTrendText(row.trend)}</td>
                <td style={{ padding: bodyCellPadding, backgroundColor: diqStrengthColor(row.strength), color: diqStrengthTextColor(row.strength), textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqStrengthText(row.strength)}</td>
                <td style={{ padding: bodyCellPadding, backgroundColor: diqChopColor(row.chop), color: diqChopTextColor(row.chop), textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqChopText(row.chop)}</td>
                <td style={{ padding: bodyCellPadding, backgroundColor: diqRsiColor(row.rsiNow, row.rsiPrev), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqRsiText(row.rsiNow, row.rsiPrev)}</td>
                <td style={{ padding: bodyCellPadding, backgroundColor: diqMacdColor(row.macdNow, row.macdSignal, row.macdPrev, row.macdSignalPrev), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqMacdText(row.macdNow, row.macdSignal, row.macdPrev, row.macdSignalPrev)}</td>
                <td style={{ padding: bodyCellPadding, backgroundColor: diqEmaCrossColor(row.emaCross), color: diqEmaCrossTextColor(row.emaCross), textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqEmaCrossText(row.emaCross, row.emaCrossGapDir)}</td>
                <td style={{ padding: bodyCellPadding, backgroundColor: diqVolMomColor(row.volMom), color: diqVolMomTextColor(row.volMom), textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqVolMomText(row.volMom)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ padding: overallCellPadding, backgroundColor: '#1E2232', color: '#FFFFFF', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>Overall</td>
              <td style={{ padding: overallCellPadding, backgroundColor: diqTrendColor(overallTrend), color: '#FFFFFF', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqTrendText(overallTrend)}</td>
              <td style={{ padding: overallCellPadding, backgroundColor: diqStrengthColor(overallStrength), color: diqStrengthTextColor(overallStrength), textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqStrengthText(overallStrength)}</td>
              <td style={{ padding: overallCellPadding, backgroundColor: diqChopColor(overallChop), color: diqChopTextColor(overallChop), textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{diqChopText(overallChop)}</td>
              <td style={{ padding: overallCellPadding, backgroundColor: diqRsiColor(overallRsi, overallRsi), color: '#FFFFFF', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{Number.isFinite(overallRsi) ? overallRsi.toFixed(1) : '--'}</td>
              <td style={{ padding: overallCellPadding, backgroundColor: overallMacdColor, color: '#FFFFFF', textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{overallMacdText}</td>
              <td style={{ padding: overallCellPadding, backgroundColor: diqEmaCrossColor(overallEmaCross), color: diqEmaCrossTextColor(overallEmaCross), textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{Number.isFinite(overallEmaCross) ? (overallEmaCross === 1 ? 'Bull ↑' : overallEmaCross === -1 ? 'Bear ↓' : 'Mixed →') : '--'}</td>
              <td style={{ padding: overallCellPadding, backgroundColor: diqVolMomColor(overallVolMom), color: diqVolMomTextColor(overallVolMom), textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{Number.isFinite(overallVolMom) ? (overallVolMom === 1 ? 'SBM ↑' : overallVolMom === -1 ? 'SSM ↓' : 'Mixed →') : '--'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {!widget.locked && (
        <>
          {cornerHandles.map(({ corner, cursor, style }) => (
            <div
              key={corner}
              onPointerDown={(e) => onResizePointerDown(corner, e)}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerCancel}
              title={`Resize table from ${corner}`}
              style={{ position: 'absolute', width: handleSize, height: handleSize, cursor, touchAction: 'none', ...style }}
            >
              <div style={{ position: 'absolute', inset: 4, insetInline: resizeHandleInset, insetBlock: resizeHandleInset, borderRadius: 4, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)' }} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

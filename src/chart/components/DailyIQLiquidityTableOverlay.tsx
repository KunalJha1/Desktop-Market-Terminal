import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Lock, Unlock } from 'lucide-react';
import type { TechnicalTableWidgetState } from '../../lib/chart-state';
import type { LiquidityTableSnapshot } from '../../lib/table-overlay';
import { TECH_TABLE_HEADER_HEIGHT } from '../../lib/table-overlay';
import type { TechnicalTableResizeCorner } from './DailyIQTechnicalTableOverlay';

interface Props {
  snapshot: LiquidityTableSnapshot | null;
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

const emptyRows = [
  { highLabel: 'DH', highPrice: NaN, highSwept: false, highConfidencePrev: NaN, lowLabel: 'DL', lowPrice: NaN, lowSwept: false, lowConfidencePrev: NaN },
  { highLabel: 'PDH', highPrice: NaN, highSwept: false, highConfidencePrev: NaN, lowLabel: 'PDL', lowPrice: NaN, lowSwept: false, lowConfidencePrev: NaN },
  { highLabel: 'WH', highPrice: NaN, highSwept: false, highConfidencePrev: NaN, lowLabel: 'WL', lowPrice: NaN, lowSwept: false, lowConfidencePrev: NaN },
  { highLabel: 'MH', highPrice: NaN, highSwept: false, highConfidencePrev: NaN, lowLabel: 'ML', lowPrice: NaN, lowSwept: false, lowConfidencePrev: NaN },
  { highLabel: '52WH', highPrice: NaN, highSwept: false, highConfidencePrev: NaN, lowLabel: '52WL', lowPrice: NaN, lowSwept: false, lowConfidencePrev: NaN },
];

export default function DailyIQLiquidityTableOverlay({
  snapshot,
  widget,
  dragging,
  resizing,
  minWidth = 700,
  maxWidth = 1100,
  minHeight = 340,
  maxHeight = 700,
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

  const s = snapshot as any;
  const rows = (snapshot?.rows ?? emptyRows) as any[];

  const technicalRows = (
    s?.technicalRows ??
    s?.dashboardRows ??
    s?.technicalSnapshot?.rows ??
    []
  ) as any[];

  const showHeader = !widget.locked || headerHovered;

  const widthScale = (widget.width - minWidth) / (maxWidth - minWidth);
  const heightScale = (widget.height - minHeight) / (maxHeight - minHeight);
  const tableScale = Math.max(0, Math.min(1, (widthScale + heightScale) / 2));

  const titleFontSize = 11 + tableScale * 4;
  const topHeaderFontSize = 11 + tableScale * 4;
  const columnHeaderFontSize = 10 + tableScale * 4;
  const bodyFontSize = 11 + tableScale * 4;

  const headerCellPadding = `${6 + tableScale * 3}px ${7 + tableScale * 4}px`;
  const bodyCellPadding = `${5 + tableScale * 3}px ${6 + tableScale * 4}px`;

  const lockButtonSize = 18 + tableScale * 8;
  const gripSize = 14 + tableScale * 6;
  const handleSize = 16 + tableScale * 8;
  const resizeHandleInset = 3 + tableScale * 2;

  const closePrice = snapshot?.close ?? NaN;
  const nearPct = snapshot?.nearPct ?? 0.005;
  const highlightNearLevels = snapshot?.highlightNearLevels ?? true;
  const atrDaily = snapshot?.atrDaily ?? NaN;
  const targetAtrMult = snapshot?.targetAtrMult ?? 1;

  const computedOverallBull = technicalRows.filter((row) => row.trend === 1).length;
  const computedOverallBear = technicalRows.filter((row) => row.trend === -1).length;

  const rsiValues = technicalRows
    .map((row) => Number(row.rsiNow))
    .filter((value) => Number.isFinite(value));

  const computedOverallRsiAvg =
    rsiValues.length > 0
      ? rsiValues.reduce((sum, value) => sum + value, 0) / rsiValues.length
      : NaN;

  const computedOverallMacdBull = technicalRows.filter(
    (row) =>
      Number.isFinite(row.macdNow) &&
      Number.isFinite(row.macdSignal) &&
      row.macdNow > row.macdSignal
  ).length;

  const computedOverallMacdBear = technicalRows.filter(
    (row) =>
      Number.isFinite(row.macdNow) &&
      Number.isFinite(row.macdSignal) &&
      row.macdNow < row.macdSignal
  ).length;

  const overallBull = Number.isFinite(s?.overallBull) ? Number(s.overallBull) : computedOverallBull;
  const overallBear = Number.isFinite(s?.overallBear) ? Number(s.overallBear) : computedOverallBear;

  const overallRsiAvg = Number.isFinite(s?.overallRsiAvg)
    ? Number(s.overallRsiAvg)
    : Number.isFinite(s?.overallRsi)
      ? Number(s.overallRsi)
      : computedOverallRsiAvg;

  const overallMacdBull = Number.isFinite(s?.overallMacdBull)
    ? Number(s.overallMacdBull)
    : computedOverallMacdBull;

  const overallMacdBear = Number.isFinite(s?.overallMacdBear)
    ? Number(s.overallMacdBear)
    : computedOverallMacdBear;

  const isNear = (level: number) =>
    highlightNearLevels &&
    Number.isFinite(level) &&
    level !== 0 &&
    Number.isFinite(closePrice) &&
    Math.abs(closePrice - level) / Math.abs(level) <= nearPct;

  const priceText = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '--';
  const atrText = Number.isFinite(atrDaily) ? atrDaily.toFixed(2) : '--';
  const targetAtrText = `${targetAtrMult.toFixed(0)} ATR`;

  const calcHighTarget = (highPrice: number, highSwept: boolean) => {
    if (!highSwept || !Number.isFinite(highPrice) || !Number.isFinite(atrDaily)) return NaN;
    return highPrice - atrDaily * targetAtrMult;
  };

  const calcLowTarget = (lowPrice: number, lowSwept: boolean) => {
    if (!lowSwept || !Number.isFinite(lowPrice) || !Number.isFinite(atrDaily)) return NaN;
    return lowPrice + atrDaily * targetAtrMult;
  };

  const calcPineConfidence = (didSweep: boolean, isBullSide: boolean, targetPrice: number) => {
    if (
      !didSweep ||
      !Number.isFinite(targetPrice) ||
      !Number.isFinite(closePrice) ||
      !Number.isFinite(atrDaily) ||
      atrDaily === 0
    ) {
      return NaN;
    }

    const trendScore = isBullSide ? overallBull : overallBear;

    const rsiScore = isBullSide
      ? overallRsiAvg >= 55 ? 1.0 : overallRsiAvg >= 50 ? 0.5 : 0.0
      : overallRsiAvg <= 45 ? 1.0 : overallRsiAvg <= 50 ? 0.5 : 0.0;

    const macdScore = isBullSide
      ? overallMacdBull > overallMacdBear ? 1.0 : 0.0
      : overallMacdBear > overallMacdBull ? 1.0 : 0.0;

    const distanceAtr = Math.abs(targetPrice - closePrice) / atrDaily;

    const distanceScore =
      distanceAtr <= 0.5 ? 1.0 :
      distanceAtr <= 1.0 ? 0.75 :
      distanceAtr <= 1.5 ? 0.5 :
      0.25;

    return Math.round(
      ((trendScore / 8.0) * 45.0) +
      (rsiScore * 20.0) +
      (macdScore * 20.0) +
      (distanceScore * 15.0)
    );
  };

  const confidenceText = (curr?: number, prev?: number) => {
    if (!Number.isFinite(curr)) return '-';

    const arrow =
      !Number.isFinite(prev) ? '→' :
      Number(curr) > Number(prev) ? '↑' :
      Number(curr) < Number(prev) ? '↓' :
      '→';

    return `${arrow} ${Math.round(Number(curr))}%`;
  };

  const confidenceBg = (curr?: number) => {
    if (!Number.isFinite(curr)) return '#2B2D3A';
    if (Number(curr) >= 70) return '#007A3D';
    if (Number(curr) >= 50) return '#F59E0B';
    return '#FF3B7A';
  };

  const sweepText = (didSweep: boolean, bullSide: boolean) =>
    didSweep ? (bullSide ? 'Swept ↑' : 'Swept ↓') : 'Not Swept';

  const sweepBg = (didSweep: boolean, bullSide: boolean) =>
    !didSweep ? '#2B2D3A' : bullSide ? '#007A3D' : '#FF3B7A';

  const targetBg = (didSweep: boolean, bullSide: boolean) =>
    !didSweep ? '#2B2D3A' : bullSide ? '#007A3D' : '#FF3B7A';

  const levelBg = (near: boolean) => near ? '#FF9F2D' : '#111827';
  const priceBg = (near: boolean) => near ? '#FFB347' : '#2B2D3A';

  const baseCellStyle = {
    fontWeight: 950,
    fontFamily: '"JetBrains Mono", monospace',
    letterSpacing: '0.015em',
    textShadow: '0 0 0.35px rgba(255,255,255,0.45)',
  } as const;

  const cornerHandles: Array<{
    corner: TechnicalTableResizeCorner;
    cursor: string;
    style: { left?: number; right?: number; top?: number; bottom?: number };
  }> = [
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
        position: 'absolute',
        left: widget.x,
        top: widget.y,
        zIndex: 18,
        pointerEvents: 'auto',
        border: '1px solid rgba(255,255,255,0.12)',
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: dragging || resizing ? '0 16px 36px rgba(0,0,0,0.52)' : '0 10px 24px rgba(0,0,0,0.42)',
        width: widget.width,
        height: widget.height,
        display: 'flex',
        flexDirection: 'column',
        transition: dragging || resizing ? 'none' : 'box-shadow 120ms ease-out',
      }}
    >
      <div
        onPointerDown={widget.locked ? undefined : onHeaderPointerDown}
        onPointerMove={widget.locked ? undefined : onHeaderPointerMove}
        onPointerUp={widget.locked ? undefined : onHeaderPointerUp}
        onPointerCancel={widget.locked ? undefined : onHeaderPointerCancel}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: TECH_TABLE_HEADER_HEIGHT,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px 0 6px',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          fontSize: titleFontSize,
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 950,
          color: '#E6EDF3',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          background: widget.locked
            ? '#000000'
            : dragging
              ? 'linear-gradient(180deg, rgba(39,56,82,0.98) 0%, rgba(19,28,43,0.98) 100%)'
              : 'linear-gradient(180deg, rgba(28,33,40,0.98) 0%, rgba(15,23,32,0.98) 100%)',
          cursor: widget.locked ? 'default' : dragging ? 'grabbing' : 'grab',
          touchAction: widget.locked ? undefined : 'none',
          opacity: showHeader ? 1 : 0,
          pointerEvents: showHeader ? 'auto' : 'none',
          transform: showHeader ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'opacity 120ms ease-out, transform 120ms ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {!widget.locked && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: gripSize,
              height: gripSize,
              borderRadius: 4,
              color: dragging ? '#C7D2FE' : '#8B949E',
              background: dragging ? 'rgba(140,180,255,0.16)' : 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}>
              <GripHorizontal size={Math.max(8, gripSize - 6)} strokeWidth={1.7} />
            </span>
          )}
          <span style={{ color: '#8B949E' }}>Liquidity Sweep Table</span>
        </div>

        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          style={{
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 4,
            background: 'transparent',
            color: '#E6EDF3',
            width: lockButtonSize,
            height: lockButtonSize,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            cursor: 'pointer',
          }}
          title={widget.locked ? 'Unlock placement' : 'Lock placement'}
        >
          {widget.locked ? <Lock size={12} strokeWidth={1.5} /> : <Unlock size={12} strokeWidth={1.5} />}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', backgroundColor: '#111827', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <table style={{
          width: '100%',
          height: '100%',
          borderCollapse: 'separate',
          borderSpacing: 0,
          tableLayout: 'fixed',
          fontSize: bodyFontSize,
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 950,
          color: '#FFFFFF',
          backgroundColor: '#111827',
          lineHeight: 1.28,
        }}>
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>

          <thead>
            <tr>
              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#2B2D3A', color: '#FFFFFF', textAlign: 'center', fontSize: topHeaderFontSize }}>ATR</th>
              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#FACC15', color: '#000000', textAlign: 'center', fontSize: topHeaderFontSize }}>{atrText}</th>
              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#111827' }} />
              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#2B2D3A', color: '#FFFFFF', textAlign: 'center', fontSize: topHeaderFontSize }}>TARGET ↓</th>
              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#2B2D3A', color: '#FFFFFF', textAlign: 'center', fontSize: topHeaderFontSize }}>CONF</th>

              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#2B2D3A', color: '#FFFFFF', textAlign: 'center', fontSize: topHeaderFontSize }}>ATR</th>
              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#FACC15', color: '#000000', textAlign: 'center', fontSize: topHeaderFontSize }}>{atrText}</th>
              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#111827' }} />
              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#2B2D3A', color: '#FFFFFF', textAlign: 'center', fontSize: topHeaderFontSize }}>TARGET ↑</th>
              <th style={{ ...baseCellStyle, padding: headerCellPadding, backgroundColor: '#2B2D3A', color: '#FFFFFF', textAlign: 'center', fontSize: topHeaderFontSize }}>CONF</th>
            </tr>

            <tr>
              {['LEVEL (HIGH)', 'PRICE', 'SWEEP?', 'TP', 'CONF', 'LEVEL (LOW)', 'PRICE', 'SWEEP?', 'TP', 'CONF'].map((head) => (
                <th
                  key={head}
                  style={{
                    ...baseCellStyle,
                    padding: headerCellPadding,
                    borderBottom: '1px solid rgba(255,255,255,0.14)',
                    backgroundColor: '#111827',
                    color: '#FFFFFF',
                    textAlign: 'center',
                    fontSize: columnHeaderFontSize,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const highNear = isNear(row.highPrice);
              const lowNear = isNear(row.lowPrice);

              const highTarget = calcHighTarget(row.highPrice, row.highSwept);
              const lowTarget = calcLowTarget(row.lowPrice, row.lowSwept);

              const highConfidence = calcPineConfidence(row.highSwept, false, highTarget);
              const lowConfidence = calcPineConfidence(row.lowSwept, true, lowTarget);

              return (
                <tr key={`${row.highLabel}-${row.lowLabel}`}>
                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: levelBg(highNear), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap' }}>{row.highLabel}</td>
                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: priceBg(highNear), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap' }}>{priceText(row.highPrice)}</td>
                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: sweepBg(row.highSwept, false), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap' }}>{sweepText(row.highSwept, false)}</td>
                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: targetBg(row.highSwept, false), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'pre-line', lineHeight: 1.2 }}>{`${priceText(highTarget)}\n${targetAtrText}`}</td>
                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: confidenceBg(highConfidence), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap' }}>{confidenceText(highConfidence, row.highConfidencePrev)}</td>

                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: levelBg(lowNear), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap' }}>{row.lowLabel}</td>
                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: priceBg(lowNear), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap' }}>{priceText(row.lowPrice)}</td>
                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: sweepBg(row.lowSwept, true), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap' }}>{sweepText(row.lowSwept, true)}</td>
                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: targetBg(row.lowSwept, true), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'pre-line', lineHeight: 1.2 }}>{`${priceText(lowTarget)}\n${targetAtrText}`}</td>
                  <td style={{ ...baseCellStyle, padding: bodyCellPadding, backgroundColor: confidenceBg(lowConfidence), color: '#FFFFFF', textAlign: 'center', whiteSpace: 'nowrap' }}>{confidenceText(lowConfidence, row.lowConfidencePrev)}</td>
                </tr>
              );
            })}
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
              style={{
                position: 'absolute',
                width: handleSize,
                height: handleSize,
                cursor,
                touchAction: 'none',
                ...style,
              }}
            >
              <div style={{
                position: 'absolute',
                inset: 4,
                insetInline: resizeHandleInset,
                insetBlock: resizeHandleInset,
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.08)',
              }} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

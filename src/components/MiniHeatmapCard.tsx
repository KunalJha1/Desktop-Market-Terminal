import { useEffect, useMemo, useRef, useState, memo } from "react";
import { X } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import CustomSelect from "./CustomSelect";
import { useSp500HeatmapData } from "../lib/use-sp500-heatmap";
import {
  HEATMAP_METRIC_OPTIONS,
  type HeatmapMetricMode,
  type HeatmapTile,
  type Rect,
  type LayoutRect,
  formatTileMetricValue,
  squarify,
  formatPrice,
  getTileMetricColor,
  getTileMetricValue,
} from "../lib/heatmap-utils";

interface MiniHeatmapCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

function MiniHeatmapCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  config,
  onConfigChange,
}: MiniHeatmapCardProps) {
  const tiles = useSp500HeatmapData();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState<{
    tile: HeatmapTile;
    x: number;
    y: number;
  } | null>(null);
  const advanceDecline = useMemo(() => {
    const up = tiles.filter((t) => (t.changePct ?? 0) > 0).length;
    const down = tiles.filter((t) => (t.changePct ?? 0) < 0).length;
    const total = tiles.length;
    return { up, down, total };
  }, [tiles]);

  const metricMode: HeatmapMetricMode =
    typeof config.metricMode === "string" &&
    HEATMAP_METRIC_OPTIONS.some((o) => o.value === config.metricMode)
      ? (config.metricMode as HeatmapMetricMode)
      : "change";

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Layout tiles grouped by sector (no sector headers in mini view)
  const tileRects = useMemo(() => {
    const { width, height } = containerSize;
    if (width === 0 || height === 0 || tiles.length === 0) return [] as LayoutRect[];

    const sectorMap = new Map<string, HeatmapTile[]>();
    for (const tile of tiles) {
      const sector = tile.sector || "Other";
      const existing = sectorMap.get(sector);
      if (existing) existing.push(tile);
      else sectorMap.set(sector, [tile]);
    }

    const sectorItems = Array.from(sectorMap.entries())
      .map(([, items]) => ({
        items: [...items].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)),
        totalMarketCap: items.reduce(
          (sum, tile) => sum + Math.max(tile.marketCap ?? tile.sp500Weight * 1e12, 1),
          0,
        ),
      }))
      .sort((a, b) => b.totalMarketCap - a.totalMarketCap);

    // Lay out sectors first, then tiles within each sector
    const sectorRects = squarify(
      sectorItems.map((s) => ({
        value: s.totalMarketCap,
        data: s.items[0],
      })),
      { x: 0, y: 0, w: width, h: height },
    );

    const result: LayoutRect[] = [];
    sectorItems.forEach((sectorInfo, index) => {
      const sectorRect = sectorRects[index];
      if (!sectorRect) return;

      const inner: Rect = {
        x: sectorRect.x + 0.5,
        y: sectorRect.y + 0.5,
        w: Math.max(sectorRect.w - 1, 0),
        h: Math.max(sectorRect.h - 1, 0),
      };

      const rects = squarify(
        sectorInfo.items.map((tile) => ({
          value: Math.max(tile.marketCap ?? tile.sp500Weight * 1e12, 1),
          data: tile,
        })),
        inner,
      ).map((rect) => ({
        ...rect,
        x: rect.x + 0.5,
        y: rect.y + 0.5,
        w: Math.max(rect.w - 1, 0),
        h: Math.max(rect.h - 1, 0),
      }));

      result.push(...rects);
    });

    return result;
  }, [tiles, containerSize]);

  const handleMouseMove = (e: React.MouseEvent, tile: HeatmapTile) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTooltip({
      tile,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel">
      {/* Header */}
      <div
        className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2"
      >
        <span className="text-[11px] font-medium text-white/85">
          S&P 500 Heatmap
        </span>

        {/* Advance / Decline bar */}
        {advanceDecline.total > 0 && (
          <div className="flex flex-1 items-center gap-1.5 px-2">
            <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="absolute inset-y-0 left-0 rounded-l-full bg-green"
                style={{
                  width: `${(advanceDecline.up / advanceDecline.total) * 100}%`,
                }}
              />
              <div
                className="absolute inset-y-0 right-0 rounded-r-full bg-red"
                style={{
                  width: `${(advanceDecline.down / advanceDecline.total) * 100}%`,
                }}
              />
            </div>
            <span className="shrink-0 font-mono text-[9px] text-white/50">
              <span className="text-green">{advanceDecline.up}</span>
              <span className="text-white/30">/{advanceDecline.total}</span>
            </span>
          </div>
        )}

        <div className="flex items-center gap-0.5">
          <CustomSelect
            value={metricMode}
            onChange={(next) =>
              onConfigChange({ ...config, metricMode: next as HeatmapMetricMode })
            }
            options={HEATMAP_METRIC_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            size="sm"
            triggerClassName="h-4 border-transparent bg-transparent px-1.5 font-mono text-[11px] text-white hover:border-transparent hover:bg-white/[0.06] hover:text-white/90"
            panelClassName="bg-[#131720]"
            panelWidth={144}
          />
          <ComponentLinkMenu linkChannel={linkChannel} onSetLinkChannel={onSetLinkChannel} />
          <button
            onClick={onClose}
            className="rounded-sm p-0 text-white transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
              padding: 0,
              border: "none",
              cursor: "pointer",
              backgroundColor: "transparent",
              color: "#FFFFFF",
              borderRadius: 2,
            }}
          >
            <X className="h-[12px] w-[12px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Treemap */}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[#1a1d23]"
        onMouseLeave={() => setTooltip(null)}
      >
        {tileRects.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-[10px] text-white/20">
            Loading...
          </div>
        ) : (
          <>
            {tileRects.map((rect) => {
              const area = rect.w * rect.h;
              const showSymbol = area > 600 || (rect.w > 22 && rect.h > 12);
              const showMetric = area > 1800 || (rect.w > 36 && rect.h > 22);
              const metricValue = getTileMetricValue(rect.data, metricMode);

              return (
                <div
                  key={rect.data.symbol}
                  className="absolute overflow-hidden border border-[#20252c]"
                  style={{
                    left: rect.x,
                    top: rect.y,
                    width: rect.w,
                    height: rect.h,
                    backgroundColor: getTileMetricColor(rect.data, metricMode),
                  }}
                  onMouseEnter={(e) => handleMouseMove(e, rect.data)}
                  onMouseMove={(e) => handleMouseMove(e, rect.data)}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {showSymbol && (
                    <div className="flex h-full flex-col items-center justify-center px-0.5 text-center">
                      <span className="truncate font-sans text-[9px] font-semibold leading-none text-white">
                        {rect.data.symbol}
                      </span>
                      {showMetric && (
                        <span className="mt-0.5 font-sans text-[8px] leading-none text-white/80">
                          {formatTileMetricValue(metricValue, metricMode)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Tooltip */}
            {tooltip && (
              <div
                className="pointer-events-none absolute z-50 rounded border border-white/[0.1] bg-[#161B22] px-2.5 py-1.5 shadow-lg shadow-black/60"
                style={{
                  left: Math.min(tooltip.x + 12, containerSize.width - 160),
                  top: Math.min(tooltip.y + 12, containerSize.height - 70),
                }}
              >
                <p className="font-mono text-[11px] font-semibold text-white">
                  {tooltip.tile.symbol}
                </p>
                <p className="mt-0.5 text-[9px] text-white/50">{tooltip.tile.name}</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-white/80">
                    {formatPrice(tooltip.tile.last)}
                  </span>
                  <span
                    className={`font-mono text-[10px] ${
                      metricMode === "change"
                        ? (tooltip.tile.changePct ?? 0) >= 0
                          ? "text-green"
                          : "text-red"
                        : ((getTileMetricValue(tooltip.tile, metricMode) ?? 50) >= 55)
                          ? "text-green"
                          : ((getTileMetricValue(tooltip.tile, metricMode) ?? 50) <= 45)
                            ? "text-red"
                            : "text-white/80"
                    }`}
                  >
                    {formatTileMetricValue(getTileMetricValue(tooltip.tile, metricMode), metricMode)}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(MiniHeatmapCard);

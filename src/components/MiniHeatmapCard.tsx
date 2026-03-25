import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import { useTws } from "../lib/tws";
import {
  type HeatmapTile,
  type Rect,
  type LayoutRect,
  squarify,
  tileColor,
  formatPct,
  formatPrice,
} from "../lib/heatmap-utils";

const DATA_POLL_MS = 5_000;

interface MiniHeatmapCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

export default function MiniHeatmapCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
}: MiniHeatmapCardProps) {
  const { sidecarPort } = useTws();
  const [tiles, setTiles] = useState<HeatmapTile[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState<{
    tile: HeatmapTile;
    x: number;
    y: number;
  } | null>(null);

  // Fetch heatmap data
  useEffect(() => {
    if (!sidecarPort) return;
    let cancelled = false;

    async function fetchHeatmap() {
      try {
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/heatmap/sp500`);
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        setTiles((payload.tiles as HeatmapTile[]) ?? []);
      } catch { /* ignore */ }
    }

    fetchHeatmap();
    const id = setInterval(fetchHeatmap, DATA_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [sidecarPort]);

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
        className="flex h-7 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2"
      >
        <span className="text-[10px] font-medium text-white/70">
          S&P 500 Heatmap
        </span>
        <div className="flex items-center gap-1">
          <ComponentLinkMenu linkChannel={linkChannel} onSetLinkChannel={onSetLinkChannel} />
          <button
            onClick={onClose}
            className="rounded-sm p-0.5 text-white/70 transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
          >
            <X className="h-2.5 w-2.5" strokeWidth={1.5} />
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
              const showChange = area > 1800 || (rect.w > 36 && rect.h > 22);

              return (
                <div
                  key={rect.data.symbol}
                  className="absolute overflow-hidden border border-[#20252c]"
                  style={{
                    left: rect.x,
                    top: rect.y,
                    width: rect.w,
                    height: rect.h,
                    backgroundColor: tileColor(rect.data.changePct, rect.data.status),
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
                      {showChange && (
                        <span className="mt-0.5 font-sans text-[8px] leading-none text-white/80">
                          {formatPct(rect.data.changePct)}
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
                      (tooltip.tile.changePct ?? 0) >= 0 ? "text-green" : "text-red"
                    }`}
                  >
                    {formatPct(tooltip.tile.changePct)}
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

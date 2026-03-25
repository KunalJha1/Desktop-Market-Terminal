import { useEffect, useMemo, useRef, useState } from "react";
import { formatMarketCap } from "../lib/market-data";
import { useTws } from "../lib/tws";
import CircularGauge from "../components/CircularGauge";
import {
  type HeatmapTechTimeframe,
  type HeatmapTile,
  type Rect,
  type LayoutRect,
  type SectorBound,
  HEATMAP_TECH_TIMEFRAMES,
  squarify,
  tileColor,
  formatPct,
  formatPrice,
} from "../lib/heatmap-utils";

function resolveHeatmapTechScore(tile: HeatmapTile, key: HeatmapTechTimeframe): number | null {
  return (
    tile.techScores?.[key] ??
    (key === "1d" ? tile.techScore1d : key === "1w" ? tile.techScore1w : null)
  );
}

function formatAsOf(asOf: number | null): string {
  if (!asOf) return "Waiting";
  return new Date(asOf).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function HeatmapPage() {
  const { sidecarPort } = useTws();
  const [tiles, setTiles] = useState<HeatmapTile[]>([]);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [hovered, setHovered] = useState<HeatmapTile | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

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
        setAsOf((payload.asOf as number) ?? null);
      } catch {
        // Ignore transient sidecar issues.
      }
    }

    fetchHeatmap();
    const id = setInterval(fetchHeatmap, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sidecarPort]);

  // Heatmap prices are handled by the background universe price loop —
  // no need to register these as active symbols (which would trigger
  // expensive realtime 5s bar subscriptions and hit TWS limits).

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

  const { tileRects, sectorBounds } = useMemo(() => {
    const { width, height } = containerSize;
    if (width === 0 || height === 0 || tiles.length === 0) {
      return {
        tileRects: [] as LayoutRect[],
        sectorBounds: [] as SectorBound[],
      };
    }

    const sectorMap = new Map<string, HeatmapTile[]>();
    for (const tile of tiles) {
      const sector = tile.sector || "Other";
      const existing = sectorMap.get(sector);
      if (existing) existing.push(tile);
      else sectorMap.set(sector, [tile]);
    }

    const sectorItems = Array.from(sectorMap.entries())
      .map(([sector, items]) => ({
        sector,
        items: [...items].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)),
        totalMarketCap: items.reduce(
          (sum, tile) => sum + Math.max(tile.marketCap ?? tile.sp500Weight * 1e12, 1),
          0,
        ),
      }))
      .sort((a, b) => b.totalMarketCap - a.totalMarketCap);

    const sectorRects = squarify(
      sectorItems.map((sectorInfo) => ({
        value: sectorInfo.totalMarketCap,
        data: sectorInfo.items[0],
      })),
      { x: 0, y: 0, w: width, h: height },
    );

    const nextSectorBounds: SectorBound[] = [];
    const nextTileRects: LayoutRect[] = [];

    sectorItems.forEach((sectorInfo, index) => {
      const sectorRect = sectorRects[index];
      if (!sectorRect) return;

      const outerGap = 1;
      const shell: Rect = {
        x: sectorRect.x + outerGap,
        y: sectorRect.y + outerGap,
        w: Math.max(sectorRect.w - outerGap * 2, 0),
        h: Math.max(sectorRect.h - outerGap * 2, 0),
      };

      const headerHeight = shell.w > 110 && shell.h > 42 ? 18 : 0;
      const inner: Rect = {
        x: shell.x,
        y: shell.y + headerHeight,
        w: shell.w,
        h: Math.max(shell.h - headerHeight, 0),
      };

      nextSectorBounds.push({
        ...shell,
        sector: sectorInfo.sector,
        totalMarketCap: sectorInfo.totalMarketCap,
        count: sectorInfo.items.length,
        headerHeight,
      });

      const tileRectsForSector = squarify(
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

      nextTileRects.push(...tileRectsForSector);
    });

    return { tileRects: nextTileRects, sectorBounds: nextSectorBounds };
  }, [tiles, containerSize]);

  const totalTiles = tiles.length;
  const loadedTiles = tiles.filter((tile) => tile.status !== "pending").length;
  return (
    <div className="flex h-full min-h-0 bg-[#111318] text-white">
      <div className="min-w-0 flex-1 border-r border-white/[0.06]">
        <div className="flex h-8 items-center justify-between border-b border-white/[0.06] bg-[#0d0f13] px-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
              S&P 500 Map
            </span>
            <span className="font-mono text-[10px] text-white/35">
              {loadedTiles}/{totalTiles}
            </span>
          </div>
          <span className="font-mono text-[10px] text-white/35">
            Updated {formatAsOf(asOf)}
          </span>
        </div>

        <div
          ref={containerRef}
          className="relative h-[calc(100%-32px)] min-h-0 overflow-hidden bg-[#1a1d23]"
        >
          {tileRects.length === 0 ? (
            <div className="flex h-full items-center justify-center font-mono text-[11px] text-white/30">
              Waiting for warmed market snapshots...
            </div>
          ) : (
            <>
              {sectorBounds.map((sector) => (
                <div
                  key={`${sector.sector}-shell`}
                  className="pointer-events-none absolute border border-[#2b313a] bg-transparent"
                  style={{
                    left: sector.x,
                    top: sector.y,
                    width: sector.w,
                    height: sector.h,
                  }}
                />
              ))}

              {tileRects.map((rect) => {
                const area = rect.w * rect.h;
                const forceLabel = area > 5000;
                const showSymbol = forceLabel || (rect.w > 28 && rect.h > 14);
                const showChange = forceLabel || (rect.w > 42 && rect.h > 26);
                const showName = area > 12000 || (rect.w > 110 && rect.h > 52);
                const isUnknown = rect.data.status === "pending" || rect.data.changePct == null;

                return (
                  <button
                    key={rect.data.symbol}
                    type="button"
                    className="absolute appearance-none overflow-hidden border border-[#20252c] p-0 text-left"
                    style={{
                      left: rect.x,
                      top: rect.y,
                      width: rect.w,
                      height: rect.h,
                      backgroundColor: tileColor(rect.data.changePct, rect.data.status),
                    }}
                    onMouseEnter={() => setHovered(rect.data)}
                    onFocus={() => setHovered(rect.data)}
                    title={`${rect.data.symbol} ${formatPct(rect.data.changePct)}`}
                  >
                    {showSymbol ? (
                      <div className="flex h-full flex-col items-center justify-center px-0.5 text-center">
                        <span className="truncate font-sans text-[11px] font-semibold leading-none text-white">
                          {rect.data.symbol}
                        </span>
                        {showChange ? (
                          <span className="mt-0.5 font-sans text-[10px] leading-none text-white/90">
                            {isUnknown ? "—" : formatPct(rect.data.changePct)}
                          </span>
                        ) : null}
                        {showName ? (
                          <span className="mt-0.5 truncate font-sans text-[10px] leading-none text-white/75">
                            {rect.data.name}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </button>
                );
              })}

              {sectorBounds.map((sector) => {
                if (sector.headerHeight === 0) return null;

                return (
                  <div
                    key={sector.sector}
                    className="pointer-events-none absolute flex items-center justify-between border border-[#2b313a] bg-[#2a2f36] px-1.5"
                    style={{
                      left: sector.x,
                      top: sector.y,
                      width: sector.w,
                      height: sector.headerHeight,
                    }}
                  >
                    <span className="truncate font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-white/82">
                      {sector.sector}
                    </span>
                    <span className="font-mono text-[9px] text-white/42">
                      {formatMarketCap(sector.totalMarketCap)}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <aside className="flex w-[240px] shrink-0 flex-col bg-[#0d0f13]">
        <div className="border-b border-white/[0.06] px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            Legend
          </p>
          <div className="mt-2 space-y-1 font-sans text-[11px] text-white/70">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#0b7a36]" />
              <span>Strong gain (&ge;4%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#1fa34f]" />
              <span>Gain (&ge;0.5%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#2a6e3f]" />
              <span>Slight gain</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#8a3344]" />
              <span>Slight loss</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#c43d53]" />
              <span>Loss (&ge;0.5%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#981b31]" />
              <span>Strong loss (&ge;4%)</span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 px-3 py-3">
          {hovered ? (
            <div className="space-y-3">
              <div>
                <p className="font-sans text-[20px] font-semibold leading-none text-white">
                  {hovered.symbol}
                </p>
                <p className="mt-1 text-[11px] text-white/55">{hovered.name}</p>
              </div>

              <div className="border border-white/[0.06] bg-[#141820] px-3 py-2">
                <p className="font-sans text-[18px] font-semibold text-white">
                  {formatPrice(hovered.last)}
                </p>
                <p
                  className={`mt-1 font-mono text-[12px] ${
                    (hovered.changePct ?? 0) >= 0 ? "text-green" : "text-red"
                  }`}
                >
                  {formatPct(hovered.changePct)}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 text-[11px] text-white/72">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    Sector
                  </p>
                  <p>{hovered.sector}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    Industry
                  </p>
                  <p>{hovered.industry}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    Market Cap
                  </p>
                  <p>{formatMarketCap(hovered.marketCap)}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    P/E
                  </p>
                  <p>
                    {hovered.trailingPE != null ? hovered.trailingPE.toFixed(1) : "—"}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    Forward P/E
                  </p>
                  <p>
                    {hovered.forwardPE != null ? hovered.forwardPE.toFixed(1) : "—"}
                  </p>
                </div>
              </div>

              {/* Technical Scores — all cached horizons (intraday often empty off watchlist) */}
              <div className="border-t border-white/[0.06] pt-3">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                  Technical Scores
                </p>
                <div className="grid grid-cols-3 gap-x-1 gap-y-2">
                  {HEATMAP_TECH_TIMEFRAMES.map(({ key, label }) => (
                    <div key={key} className="flex flex-col items-center gap-0.5">
                      <CircularGauge score={resolveHeatmapTechScore(hovered, key)} size={38} />
                      <span className="font-mono text-[8px] text-white/35">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="font-sans text-[11px] text-white/40">
              Hover a tile to inspect the company.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

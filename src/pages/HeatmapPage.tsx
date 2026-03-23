import { useEffect, useMemo, useRef, useState } from "react";
import { formatMarketCap } from "../lib/market-data";
import { useTws } from "../lib/tws";

interface HeatmapTile {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  theme: string;
  groups: string[];
  sp500Weight: number;
  last: number | null;
  changePct: number | null;
  status: string | null;
  updatedAt: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayoutRect extends Rect {
  data: HeatmapTile;
}

interface SectorBound extends Rect {
  sector: string;
  totalWeight: number;
  count: number;
  headerHeight: number;
}

function squarify(
  items: { value: number; data: HeatmapTile }[],
  bounds: Rect,
): LayoutRect[] {
  if (items.length === 0) return [];
  const sorted = [...items]
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return [];

  function layoutPartition(
    subset: { value: number; data: HeatmapTile }[],
    rect: Rect,
  ): LayoutRect[] {
    if (subset.length === 0 || rect.w <= 0 || rect.h <= 0) return [];
    if (subset.length === 1) {
      return [{ ...rect, data: subset[0].data }];
    }

    const total = subset.reduce((sum, item) => sum + item.value, 0);
    let splitIndex = 1;
    let leftSum = subset[0].value;
    let bestDiff = Math.abs(total - leftSum * 2);

    for (let index = 1; index < subset.length - 1; index += 1) {
      leftSum += subset[index].value;
      const diff = Math.abs(total - leftSum * 2);
      if (diff <= bestDiff) {
        bestDiff = diff;
        splitIndex = index + 1;
      } else {
        break;
      }
    }

    const first = subset.slice(0, splitIndex);
    const second = subset.slice(splitIndex);
    const firstSum = first.reduce((sum, item) => sum + item.value, 0);
    const ratio = total > 0 ? firstSum / total : 0.5;

    if (rect.w >= rect.h) {
      const firstWidth = rect.w * ratio;
      return [
        ...layoutPartition(first, { x: rect.x, y: rect.y, w: firstWidth, h: rect.h }),
        ...layoutPartition(second, {
          x: rect.x + firstWidth,
          y: rect.y,
          w: rect.w - firstWidth,
          h: rect.h,
        }),
      ];
    }

    const firstHeight = rect.h * ratio;
    return [
      ...layoutPartition(first, { x: rect.x, y: rect.y, w: rect.w, h: firstHeight }),
      ...layoutPartition(second, {
        x: rect.x,
        y: rect.y + firstHeight,
        w: rect.w,
        h: rect.h - firstHeight,
      }),
    ];
  }

  return layoutPartition(sorted, bounds);
}

function tileColor(changePct: number | null, status: string | null): string {
  if (status === "pending") return "#3a4350";
  if (status === "stale") return "#8a5a12";
  if (changePct == null) return "#3a4350";

  if (changePct >= 4) return "#0b7a36";
  if (changePct >= 2) return "#138a40";
  if (changePct >= 0.5) return "#1fa34f";
  if (changePct > -0.5) return "#666f7d";
  if (changePct > -2) return "#c43d53";
  if (changePct > -4) return "#b52e43";
  return "#981b31";
}

function formatPct(changePct: number | null): string {
  if (changePct == null) return "—";
  return `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
}

function formatPrice(last: number | null): string {
  if (last == null) return "—";
  return `$${last.toFixed(2)}`;
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
    const id = setInterval(fetchHeatmap, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sidecarPort]);

  useEffect(() => {
    if (!sidecarPort || tiles.length === 0) return;
    const symbols = tiles.map((tile) => tile.symbol);
    const register = () => {
      fetch(`http://127.0.0.1:${sidecarPort}/active-symbols`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      }).catch(() => {});
    };

    register();
    const id = setInterval(register, 90_000);
    return () => clearInterval(id);
  }, [sidecarPort, tiles]);

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
        items: [...items].sort((a, b) => b.sp500Weight - a.sp500Weight),
        totalWeight: items.reduce(
          (sum, tile) => sum + Math.max(tile.sp500Weight, 0.0001),
          0,
        ),
      }))
      .sort((a, b) => b.totalWeight - a.totalWeight);

    const sectorRects = squarify(
      sectorItems.map((sectorInfo) => ({
        value: sectorInfo.totalWeight,
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
        totalWeight: sectorInfo.totalWeight,
        count: sectorInfo.items.length,
        headerHeight,
      });

      const tileRectsForSector = squarify(
        sectorInfo.items.map((tile) => ({
          value: Math.max(tile.sp500Weight, 0.0001),
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
                const forceLabel = area > 7000;
                const showSymbol = forceLabel || (rect.w > 36 && rect.h > 18);
                const showChange = forceLabel || (rect.w > 62 && rect.h > 34);
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
                      <div className="flex h-full flex-col justify-center px-1.5 text-center">
                        <span className="truncate font-sans text-[11px] font-semibold leading-none text-white">
                          {rect.data.symbol}
                        </span>
                        {showChange ? (
                          <span className="mt-1 font-sans text-[10px] leading-none text-white/90">
                            {isUnknown ? "No move" : formatPct(rect.data.changePct)}
                          </span>
                        ) : null}
                        {showName ? (
                          <span className="mt-1 truncate font-sans text-[10px] leading-none text-white/75">
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
                      {(sector.totalWeight * 100).toFixed(1)}%
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
              <span>Strong gain</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#1fa34f]" />
              <span>Gain</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#4b5563]" />
              <span>Flat</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#c43d53]" />
              <span>Loss</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#981b31]" />
              <span>Strong loss</span>
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
                    S&P Weight
                  </p>
                  <p>{(hovered.sp500Weight * 100).toFixed(2)}%</p>
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

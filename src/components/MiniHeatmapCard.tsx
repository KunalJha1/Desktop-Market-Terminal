import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import { X, ChevronDown, Plus } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import CustomSelect from "./CustomSelect";
import HeatmapGroupEditor from "./HeatmapGroupEditor";
import { useHeatmapData } from "../lib/use-sp500-heatmap";
import {
  fetchHeatmapGroups,
  createHeatmapGroup,
  isSymbolListHeatmapGroup,
  resolveHeatmapUrl,
  type HeatmapGroup,
  type HeatmapGroupPayload,
} from "../lib/heatmap-groups";
import { useSidecarPort } from "../lib/tws";
import { useWatchlist } from "../lib/watchlist";
import {
  HEATMAP_METRIC_OPTIONS,
  type HeatmapMetricMode,
  type HeatmapTile,
  type Rect,
  type LayoutRect,
  type SectorBound,
  formatTileMetricValue,
  squarify,
  formatPrice,
  getTileMetricColor,
  getTileMetricValue,
} from "../lib/heatmap-utils";

interface TileListProps {
  tileRects: LayoutRect[];
  metricMode: HeatmapMetricMode;
  onMouseEnter: (e: React.MouseEvent, tile: HeatmapTile) => void;
  onMouseMove: (e: React.MouseEvent, tile: HeatmapTile) => void;
  onMouseLeave: () => void;
}

const TileList = memo(function TileList({ tileRects, metricMode, onMouseEnter, onMouseMove, onMouseLeave }: TileListProps) {
  return (
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
            onMouseEnter={(e) => onMouseEnter(e, rect.data)}
            onMouseMove={(e) => onMouseMove(e, rect.data)}
            onMouseLeave={onMouseLeave}
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
    </>
  );
});

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
  const sidecarPort = useSidecarPort();
  const { symbols: watchlistSymbols } = useWatchlist();

  // Groups state
  const [groups, setGroups] = useState<HeatmapGroup[]>([]);
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);

  // Active group from card config (persisted in dashboard layout)
  const activeGroupId: number | null =
    typeof config.groupId === "number" ? config.groupId : null;
  const setActiveGroupId = (id: number | null) =>
    onConfigChange({ ...config, groupId: id });

  const activeGroup = activeGroupId !== null ? (groups.find((g) => g.id === activeGroupId) ?? null) : null;
  const activeLabel = activeGroup ? activeGroup.name : "S&P 500";
  const activeCustomSymbols = useMemo(
    () => (isSymbolListHeatmapGroup(activeGroup) ? (activeGroup?.symbols ?? []) : []),
    [activeGroup],
  );

  // Load groups
  useEffect(() => {
    if (!sidecarPort) return;
    fetchHeatmapGroups(sidecarPort)
      .then(setGroups)
      .catch(() => {});
  }, [sidecarPort]);

  // Close dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(e.target as Node)) {
        setGroupDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // Resolve heatmap URL
  const heatmapUrl = useMemo(() => {
    if (!sidecarPort) return null;
    return resolveHeatmapUrl(sidecarPort, activeGroup, watchlistSymbols);
  }, [sidecarPort, activeGroup, watchlistSymbols]);

  const tiles = useHeatmapData(heatmapUrl).tiles;

  useEffect(() => {
    if (!sidecarPort || activeCustomSymbols.length === 0) return;
    fetch(`http://127.0.0.1:${sidecarPort}/active-symbols`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: activeCustomSymbols }),
    }).catch(() => {});
  }, [sidecarPort, activeCustomSymbols]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const cachedRectRef = useRef<DOMRect | null>(null);
  const rafRef = useRef<number>(0);
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

  // Layout tiles grouped by sector
  const layout = useMemo(() => {
    const { width, height } = containerSize;
    if (width === 0 || height === 0 || tiles.length === 0)
      return { tileRects: [] as LayoutRect[], sectorBounds: [] as SectorBound[] };

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
      sectorItems.map((s) => ({
        value: s.totalMarketCap,
        data: s.items[0],
      })),
      { x: 0, y: 0, w: width, h: height },
    );

    const tileRects: LayoutRect[] = [];
    const sectorBounds: SectorBound[] = [];

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

      const headerHeight = shell.w > 80 && shell.h > 32 ? 14 : 0;
      const inner: Rect = {
        x: shell.x,
        y: shell.y + headerHeight,
        w: shell.w,
        h: Math.max(shell.h - headerHeight, 0),
      };

      sectorBounds.push({
        ...shell,
        sector: sectorInfo.sector,
        totalMarketCap: sectorInfo.totalMarketCap,
        count: sectorInfo.items.length,
        headerHeight,
      });

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

      tileRects.push(...rects);
    });

    return { tileRects, sectorBounds };
  }, [tiles, containerSize]);

  const { tileRects, sectorBounds } = layout;

  const handleTileMouseEnter = useCallback((e: React.MouseEvent, tile: HeatmapTile) => {
    cachedRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
    const r = cachedRectRef.current;
    if (!r) return;
    setTooltip({ tile, x: e.clientX - r.left, y: e.clientY - r.top });
  }, []);

  const handleTileMouseMove = useCallback((e: React.MouseEvent, tile: HeatmapTile) => {
    cancelAnimationFrame(rafRef.current);
    const cx = e.clientX;
    const cy = e.clientY;
    rafRef.current = requestAnimationFrame(() => {
      const r = cachedRectRef.current;
      if (!r) return;
      setTooltip({ tile, x: cx - r.left, y: cy - r.top });
    });
  }, []);

  const handleTileMouseLeave = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setTooltip(null);
  }, []);

  async function handleSaveGroup(payload: HeatmapGroupPayload) {
    if (!sidecarPort) return;
    const created = await createHeatmapGroup(sidecarPort, payload);
    setGroups((prev) => [...prev, created]);
    setActiveGroupId(created.id);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel">
      {/* Header */}
      <div
        className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2"
      >
        {/* Group selector */}
        <div className="relative" ref={groupDropdownRef}>
          <button
            onClick={() => setGroupDropdownOpen((o) => !o)}
            className="flex items-center gap-1 font-mono text-[11px] font-medium text-white/85 hover:text-white"
          >
            <span>{activeLabel}</span>
            <ChevronDown className="h-2.5 w-2.5 text-white/35" />
          </button>

          {groupDropdownOpen && (
            <div className="absolute left-0 top-full z-30 mt-0.5 w-44 border border-white/[0.10] bg-[#131720] shadow-xl">
              <button
                className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left font-sans text-[11px] hover:bg-white/[0.05] ${
                  activeGroupId === null ? "text-white" : "text-white/55"
                }`}
                onClick={() => { setActiveGroupId(null); setGroupDropdownOpen(false); }}
              >
                S&P 500
                {activeGroupId === null && <span className="h-1.5 w-1.5 rounded-full bg-[#1A56DB]" />}
              </button>

              {groups.length > 0 && <div className="border-t border-white/[0.06]" />}

              {groups.map((g) => (
                <button
                  key={g.id}
                  className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left font-sans text-[11px] hover:bg-white/[0.05] ${
                    activeGroupId === g.id ? "text-white" : "text-white/55"
                  }`}
                  onClick={() => { setActiveGroupId(g.id); setGroupDropdownOpen(false); }}
                >
                  <span className="truncate">{g.name}</span>
                  {activeGroupId === g.id && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1A56DB]" />}
                </button>
              ))}

              <div className="border-t border-white/[0.06]" />
              <button
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 font-sans text-[11px] text-[#7FB3FF] hover:bg-white/[0.04]"
                onClick={() => { setEditorOpen(true); setGroupDropdownOpen(false); }}
              >
                <Plus className="h-3 w-3" />
                New Group
              </button>
            </div>
          )}
        </div>

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
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-white/20">
            Loading...
          </div>
        ) : (
          <>
            {/* Sector shells */}
            {sectorBounds.map((sector) => (
              <div
                key={`${sector.sector}-shell`}
                className="pointer-events-none absolute border border-[#2b313a]"
                style={{
                  left: sector.x,
                  top: sector.y,
                  width: sector.w,
                  height: sector.h,
                }}
              />
            ))}

            {/* Sector header bars */}
            {sectorBounds.map((sector) => {
              if (sector.headerHeight === 0) return null;
              return (
                <div
                  key={`${sector.sector}-header`}
                  className="pointer-events-none absolute flex items-center border border-[#2b313a] bg-[#2a2f36] px-1.5"
                  style={{
                    left: sector.x,
                    top: sector.y,
                    width: sector.w,
                    height: sector.headerHeight,
                  }}
                >
                  <span
                    className="truncate font-sans font-semibold uppercase tracking-[0.07em] text-white/75"
                    style={{ fontSize: 9 }}
                  >
                    {sector.sector}
                  </span>
                </div>
              );
            })}

            <TileList
              tileRects={tileRects}
              metricMode={metricMode}
              onMouseEnter={handleTileMouseEnter}
              onMouseMove={handleTileMouseMove}
              onMouseLeave={handleTileMouseLeave}
            />

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

      {editorOpen && (
        <HeatmapGroupEditor
          group={null}
          onSave={handleSaveGroup}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}

export default memo(MiniHeatmapCard);

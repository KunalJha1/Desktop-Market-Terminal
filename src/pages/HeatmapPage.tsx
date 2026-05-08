import { useEffect, useMemo, useRef, useState, memo, useCallback, useDeferredValue } from "react";
import { Pencil, Plus, Trash2, ChevronDown } from "lucide-react";
import CircularGauge from "../components/CircularGauge";
import CustomSelect from "../components/CustomSelect";
import HeatmapGroupEditor from "../components/HeatmapGroupEditor";
import {
  HEATMAP_METRIC_OPTIONS,
  HEATMAP_TECH_TIMEFRAMES,
  type HeatmapMetricMode,
  type HeatmapTile,
  type LayoutRect,
  type Rect,
  type SectorBound,
  formatTileMetricValue,
  formatPrice,
  getTileMetricColor,
  getTileMetricValue,
  resolveHeatmapTechScore,
  squarify,
} from "../lib/heatmap-utils";
import { formatMarketCap } from "../lib/market-data";
import { useHeatmapData } from "../lib/use-sp500-heatmap";
import {
  fetchHeatmapGroups,
  createHeatmapGroup,
  updateHeatmapGroup,
  deleteHeatmapGroup,
  isSymbolListHeatmapGroup,
  resolveHeatmapUrl,
  type HeatmapGroup,
  type HeatmapGroupPayload,
} from "../lib/heatmap-groups";
import { useSidecarPort } from "../lib/tws";
import { useWatchlist } from "../lib/watchlist";

const HEATMAP_METRIC_STORAGE_KEY = "dailyiq-heatmap-metric";
const HEATMAP_GROUP_STORAGE_KEY = "dailyiq-heatmap-group";

function loadStoredMetricMode(): HeatmapMetricMode {
  try {
    const raw = localStorage.getItem(HEATMAP_METRIC_STORAGE_KEY);
    if (HEATMAP_METRIC_OPTIONS.some((option) => option.value === raw)) return raw as HeatmapMetricMode;
  } catch {
    // Ignore localStorage failures.
  }
  return "change";
}

function loadStoredGroupId(): number | null {
  try {
    const raw = localStorage.getItem(HEATMAP_GROUP_STORAGE_KEY);
    if (raw) {
      const id = parseInt(raw, 10);
      if (!isNaN(id)) return id;
    }
  } catch {
    // ignore
  }
  return null;
}

function getMetricToneClass(value: number | null, mode: HeatmapMetricMode): string {
  if (value == null) return "text-white/55";
  if (mode === "change") return value >= 0 ? "text-green" : "text-red";
  if (value >= 55) return "text-green";
  if (value <= 45) return "text-red";
  return "text-white/75";
}

function getMetricLabel(mode: HeatmapMetricMode): string {
  return HEATMAP_METRIC_OPTIONS.find((option) => option.value === mode)?.label ?? "Metric";
}

function getLegendItems(mode: HeatmapMetricMode): { color: string; label: string }[] {
  if (mode === "change") {
    return [
      { color: "#0b7a36", label: "Strong gain (>=4%)" },
      { color: "#1fa34f", label: "Gain (>=0.5%)" },
      { color: "#2a6e3f", label: "Slight gain" },
      { color: "#8a3344", label: "Slight loss" },
      { color: "#c43d53", label: "Loss (<=-0.5%)" },
      { color: "#981b31", label: "Strong loss (<=-4%)" },
    ];
  }

  if (mode === "sentiment") {
    return [
      { color: "#0b7a36", label: "Very bullish (85+)" },
      { color: "#138a40", label: "Bullish (70-84)" },
      { color: "#1fa34f", label: "Leaning bullish (55-69)" },
      { color: "#4b5563", label: "Neutral (45-54)" },
      { color: "#c43d53", label: "Leaning bearish (30-44)" },
      { color: "#981b31", label: "Bearish (<30)" },
    ];
  }

  return [
    { color: "#0b7a36", label: "Very bullish (85+)" },
    { color: "#138a40", label: "Bullish (70-84)" },
    { color: "#1fa34f", label: "Leaning bullish (55-69)" },
    { color: "#4b5563", label: "Neutral (45-54)" },
    { color: "#c43d53", label: "Leaning bearish (30-44)" },
    { color: "#981b31", label: "Bearish (<30)" },
  ];
}

function formatAsOf(asOf: number | null): string {
  if (!asOf) return "Waiting";
  return new Date(asOf).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface HeatmapTileButtonProps {
  rect: LayoutRect;
  metricMode: HeatmapMetricMode;
}

const HeatmapTileButton = memo(function HeatmapTileButton({ rect, metricMode }: HeatmapTileButtonProps) {
  const area = rect.w * rect.h;
  const forceLabel = area > 5000;
  const showSymbol = forceLabel || (rect.w > 28 && rect.h > 14);
  const showMetric = forceLabel || (rect.w > 42 && rect.h > 26);
  const showName = area > 12000 || (rect.w > 110 && rect.h > 52);
  const showLogo = rect.w >= 64 && rect.h >= 64;
  const logoSize = Math.min(28, Math.floor(Math.min(rect.w, rect.h) * 0.35));
  const metricValue = getTileMetricValue(rect.data, metricMode);
  const isUnknown = rect.data.status === "pending" || metricValue == null;

  return (
    <div
      className="absolute overflow-hidden border border-[#20252c]"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        backgroundColor: getTileMetricColor(rect.data, metricMode),
      }}
    >
      {showSymbol ? (
        <div className="flex h-full flex-col items-center justify-center px-0.5 text-center">
          {showLogo ? (
            <img
              src={`https://assets.parqet.com/logos/symbol/${rect.data.symbol}?format=svg`}
              alt=""
              width={logoSize}
              height={logoSize}
              className="mb-1 rounded-full object-contain"
              style={{ width: logoSize, height: logoSize }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : null}
          <span className="truncate font-sans text-[11px] font-semibold leading-none text-white">
            {rect.data.symbol}
          </span>
          {showMetric ? (
            <span className="mt-0.5 font-sans text-[10px] leading-none text-white/90">
              {isUnknown ? "—" : formatTileMetricValue(metricValue, metricMode)}
            </span>
          ) : null}
          {showName ? (
            <span className="mt-0.5 truncate font-sans text-[10px] leading-none text-white/75">
              {rect.data.name}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

interface HeatmapTilesProps {
  tileRects: LayoutRect[];
  sectorBounds: SectorBound[];
  metricMode: HeatmapMetricMode;
}

const HeatmapTiles = memo(function HeatmapTiles({ tileRects, sectorBounds, metricMode }: HeatmapTilesProps) {
  if (tileRects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[11px] text-white/30">
        Waiting for warmed market snapshots...
      </div>
    );
  }

  return (
    <>
      {sectorBounds.map((sector) => (
        <div
          key={`${sector.sector}-shell`}
          className="pointer-events-none absolute border border-[#2b313a] bg-transparent"
          style={{ left: sector.x, top: sector.y, width: sector.w, height: sector.h }}
        />
      ))}

      {tileRects.map((rect) => (
        <HeatmapTileButton key={rect.data.symbol} rect={rect} metricMode={metricMode} />
      ))}

      {sectorBounds.map((sector) => {
        if (sector.headerHeight === 0) return null;
        return (
          <div
            key={sector.sector}
            className="pointer-events-none absolute flex items-center justify-between border border-[#2b313a] bg-[#2a2f36] px-1.5"
            style={{ left: sector.x, top: sector.y, width: sector.w, height: sector.headerHeight }}
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
  );
});

function HeatmapPage() {
  const sidecarPort = useSidecarPort();
  const { symbols: watchlistSymbols } = useWatchlist();

  // Groups state
  const [groups, setGroups] = useState<HeatmapGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(() => loadStoredGroupId());
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<HeatmapGroup | null>(null);
  const groupDropdownRef = useRef<HTMLDivElement>(null);

  // Heatmap state
  const [hovered, setHovered] = useState<HeatmapTile | null>(null);
  const [metricMode, setMetricMode] = useState<HeatmapMetricMode>(() => loadStoredMetricMode());
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const rafRef = useRef<number>(0);
  const containerRectRef = useRef<DOMRect | null>(null);
  const tileRectsRef = useRef<LayoutRect[]>([]);

  // Close group dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(e.target as Node)) {
        setGroupDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // Load groups from backend
  useEffect(() => {
    if (!sidecarPort) return;
    fetchHeatmapGroups(sidecarPort)
      .then(setGroups)
      .catch(() => {});
  }, [sidecarPort]);

  // Persist active group id
  useEffect(() => {
    try {
      if (activeGroupId === null) {
        localStorage.removeItem(HEATMAP_GROUP_STORAGE_KEY);
      } else {
        localStorage.setItem(HEATMAP_GROUP_STORAGE_KEY, String(activeGroupId));
      }
    } catch {
      // ignore
    }
  }, [activeGroupId]);

  // Persist metric mode
  useEffect(() => {
    try {
      localStorage.setItem(HEATMAP_METRIC_STORAGE_KEY, metricMode);
    } catch {
      // ignore
    }
  }, [metricMode]);

  const activeGroup = activeGroupId !== null ? (groups.find((g) => g.id === activeGroupId) ?? null) : null;
  const activeCustomSymbols = useMemo(
    () => (isSymbolListHeatmapGroup(activeGroup) ? (activeGroup?.symbols ?? []) : []),
    [activeGroup],
  );

  // Resolve heatmap URL
  const heatmapUrl = useMemo(() => {
    if (!sidecarPort) return null;
    return resolveHeatmapUrl(sidecarPort, activeGroup, watchlistSymbols);
  }, [sidecarPort, activeGroup, watchlistSymbols]);

  const { tiles, asOf } = useHeatmapData(heatmapUrl);

  useEffect(() => {
    if (!sidecarPort || activeCustomSymbols.length === 0) return;
    fetch(`http://127.0.0.1:${sidecarPort}/active-symbols`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: activeCustomSymbols }),
    }).catch(() => {});
  }, [sidecarPort, activeCustomSymbols]);

  // Container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      containerRectRef.current = null;
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

  useEffect(() => {
    tileRectsRef.current = tileRects;
  }, [tileRects]);

  const handleContainerMouseMove = useCallback((e: React.MouseEvent) => {
    cancelAnimationFrame(rafRef.current);
    const cx = e.clientX;
    const cy = e.clientY;
    rafRef.current = requestAnimationFrame(() => {
      if (!containerRectRef.current) {
        containerRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
      }
      const r = containerRectRef.current;
      if (!r) return;
      const x = cx - r.left;
      const y = cy - r.top;
      const rects = tileRectsRef.current;
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) {
          setHovered(rect.data);
          return;
        }
      }
    });
  }, []);

  const handleContainerMouseLeave = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setHovered(null);
  }, []);

  const totalTiles = tiles.length;
  const loadedTiles = useMemo(
    () => tiles.filter((tile) => tile.status !== "pending").length,
    [tiles],
  );
  const legendItems = useMemo(() => getLegendItems(metricMode), [metricMode]);

  // Defer sidebar updates so treemap hit-testing stays on the fast path.
  const deferredHovered = useDeferredValue(hovered);
  const hoveredMetricValue = deferredHovered ? getTileMetricValue(deferredHovered, metricMode) : null;

  // Active group display label
  const activeLabel = activeGroup ? activeGroup.name : "S&P 500";

  // Group CRUD handlers
  async function handleSaveGroup(payload: HeatmapGroupPayload) {
    if (!sidecarPort) return;
    if (editingGroup) {
      const updated = await updateHeatmapGroup(sidecarPort, editingGroup.id, payload);
      setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
    } else {
      const created = await createHeatmapGroup(sidecarPort, payload);
      setGroups((prev) => [...prev, created]);
      setActiveGroupId(created.id);
    }
  }

  async function handleDeleteGroup(group: HeatmapGroup) {
    if (!sidecarPort) return;
    await deleteHeatmapGroup(sidecarPort, group.id);
    setGroups((prev) => prev.filter((g) => g.id !== group.id));
    if (activeGroupId === group.id) setActiveGroupId(null);
  }

  return (
    <div className="flex h-full min-h-0 bg-[#111318] text-white">
      <div className="min-w-0 flex-1 border-r border-white/[0.06]">
        <div className="flex h-8 items-center justify-between border-b border-white/[0.06] bg-[#0d0f13] px-3">
          <div className="flex items-center gap-2">
            {/* Group selector dropdown */}
            <div className="relative" ref={groupDropdownRef}>
              <button
                onClick={() => setGroupDropdownOpen((o) => !o)}
                className="flex h-6 items-center gap-1.5 border border-white/[0.08] bg-[#131720] px-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80 hover:border-white/[0.15] hover:text-white"
              >
                <span>{activeLabel}</span>
                <ChevronDown className="h-3 w-3 text-white/40" />
              </button>

              {groupDropdownOpen && (
                <div className="absolute left-0 top-full z-30 mt-0.5 w-52 border border-white/[0.10] bg-[#131720] shadow-xl">
                  {/* S&P 500 default */}
                  <button
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left font-sans text-[11px] hover:bg-white/[0.05] ${
                      activeGroupId === null ? "text-white" : "text-white/55"
                    }`}
                    onClick={() => { setActiveGroupId(null); setGroupDropdownOpen(false); }}
                  >
                    <span>S&P 500</span>
                    {activeGroupId === null && <span className="h-1.5 w-1.5 rounded-full bg-[#1A56DB]" />}
                  </button>

                  {groups.length > 0 && (
                    <div className="border-t border-white/[0.06]" />
                  )}

                  {groups.map((g) => (
                    <div
                      key={g.id}
                      className={`flex items-center justify-between px-3 py-1.5 ${
                        activeGroupId === g.id ? "bg-white/[0.04]" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <button
                        className={`flex-1 text-left font-sans text-[11px] ${
                          activeGroupId === g.id ? "text-white" : "text-white/55 hover:text-white/80"
                        }`}
                        onClick={() => { setActiveGroupId(g.id); setGroupDropdownOpen(false); }}
                      >
                        {g.name}
                        <span className="ml-1.5 font-mono text-[9px] text-white/25 uppercase">
                          {g.type}
                        </span>
                      </button>
                      <div className="flex items-center gap-0.5 pl-1">
                        {activeGroupId === g.id && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[#1A56DB]" />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingGroup(g);
                            setEditorOpen(true);
                            setGroupDropdownOpen(false);
                          }}
                          className="ml-1 flex h-5 w-5 items-center justify-center rounded-sm text-white/30 hover:bg-white/[0.06] hover:text-white/70"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteGroup(g);
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-sm text-white/30 hover:bg-white/[0.06] hover:text-red"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="border-t border-white/[0.06]" />
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 font-sans text-[11px] text-[#7FB3FF] hover:bg-white/[0.04]"
                    onClick={() => {
                      setEditingGroup(null);
                      setEditorOpen(true);
                      setGroupDropdownOpen(false);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    New Group
                  </button>
                </div>
              )}
            </div>

            <span className="font-mono text-[10px] text-white/35">
              {loadedTiles}/{totalTiles}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
              Metric
            </label>
            <CustomSelect
              value={metricMode}
              onChange={(next) => setMetricMode(next as HeatmapMetricMode)}
              options={HEATMAP_METRIC_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              size="sm"
              triggerClassName="border-white/[0.08] bg-[#131720] font-mono text-[10px] text-white/80"
              panelClassName="bg-[#131720]"
              panelWidth={168}
            />
            <span className="font-mono text-[10px] text-white/35">
              Updated {formatAsOf(asOf)}
            </span>
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative h-[calc(100%-32px)] min-h-0 overflow-hidden bg-[#1a1d23]"
          onMouseMove={handleContainerMouseMove}
          onMouseLeave={handleContainerMouseLeave}
        >
          <HeatmapTiles
            tileRects={tileRects}
            sectorBounds={sectorBounds}
            metricMode={metricMode}
          />
        </div>
      </div>

      <aside className="flex w-[240px] shrink-0 flex-col bg-[#0d0f13]">
        <div className="border-b border-white/[0.06] px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            Legend
          </p>
          <div className="mt-2 space-y-1 font-sans text-[11px] text-white/70">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
              {getMetricLabel(metricMode)}
            </p>
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="h-3 w-3" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 px-3 py-3">
          {deferredHovered ? (
            <div className="space-y-3">
              <div>
                <p className="font-sans text-[20px] font-semibold leading-none text-white">
                  {deferredHovered.symbol}
                </p>
                <p className="mt-1 text-[11px] text-white/55">{deferredHovered.name}</p>
              </div>

              <div className="border border-white/[0.06] bg-[#141820] px-3 py-2">
                <p className="font-sans text-[18px] font-semibold text-white">
                  {formatPrice(deferredHovered.last)}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                  {getMetricLabel(metricMode)}
                </p>
                <p
                  className={`mt-1 font-mono text-[12px] ${getMetricToneClass(
                    hoveredMetricValue,
                    metricMode,
                  )}`}
                >
                  {formatTileMetricValue(hoveredMetricValue, metricMode)}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 text-[11px] text-white/72">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    Sector
                  </p>
                  <p>{deferredHovered.sector}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    Industry
                  </p>
                  <p>{deferredHovered.industry}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    Market Cap
                  </p>
                  <p>{formatMarketCap(deferredHovered.marketCap)}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    P/E
                  </p>
                  <p>{deferredHovered.trailingPE != null ? deferredHovered.trailingPE.toFixed(1) : "—"}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                    Forward P/E
                  </p>
                  <p>{deferredHovered.forwardPE != null ? deferredHovered.forwardPE.toFixed(1) : "—"}</p>
                </div>
              </div>

              <div className="border-t border-white/[0.06] pt-3">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                  Technical Scores
                </p>
                <div className="grid grid-cols-3 gap-x-1 gap-y-2">
                  {HEATMAP_TECH_TIMEFRAMES.map(({ key, label }) => (
                    <div key={key} className="flex flex-col items-center gap-0.5">
                      <CircularGauge score={resolveHeatmapTechScore(deferredHovered, key)} size={38} />
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

      {editorOpen && (
        <HeatmapGroupEditor
          group={editingGroup}
          onSave={handleSaveGroup}
          onClose={() => { setEditorOpen(false); setEditingGroup(null); }}
        />
      )}
    </div>
  );
}

export default memo(HeatmapPage);

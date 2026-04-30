import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  memo,
} from "react";
import { DollarSign, List, BarChart2, Briefcase, SlidersHorizontal, LayoutGrid, Activity, TrendingUp } from "lucide-react";
import DashboardToolbar from "../components/DashboardToolbar";
import GridLayout from "../components/GridLayout";
import QuoteCard from "../components/QuoteCard";
import IBKRPortfolioCard from "../components/IBKRPortfolioCard";
import WatchlistCard from "../components/WatchlistCard";
import MiniChart from "../chart/components/MiniChart";
import MiniScreenerCard from "../components/MiniScreenerCard";
import MiniHeatmapCard from "../components/MiniHeatmapCard";
import LiquiditySweepDetectorCard from "../components/LiquiditySweepDetectorCard";
import OptionsSnapshotCard from "../components/OptionsSnapshotCard";
import { useTabs } from "../lib/tabs";
import { useLayout } from "../lib/layout";
import type { LayoutComponent } from "../lib/layout-types";
import { useWatchlist } from "../lib/watchlist";
import {
  readMiniChartConfig,
  removeMiniChartConfig,
  writeMiniChartConfig,
  mergePersistedMiniChartConfig,
} from "../lib/minichart-config-storage";

const COMPONENT_TYPES = [
  { type: "quote", label: "Quote Card", defaultW: 4, defaultH: 8, icon: DollarSign },
  { type: "watchlist", label: "Watchlist", defaultW: 4, defaultH: 10, icon: List },
  { type: "minichart", label: "Mini Chart", defaultW: 4, defaultH: 8, icon: BarChart2 },
  { type: "ibkr-portfolio", label: "Portfolio", defaultW: 8, defaultH: 12, icon: Briefcase },
  { type: "mini-screener", label: "Mini Screener", defaultW: 6, defaultH: 10, icon: SlidersHorizontal },
  { type: "mini-heatmap", label: "Mini Heatmap", defaultW: 6, defaultH: 10, icon: LayoutGrid },
  { type: "liquidity-sweep-detector", label: "Liquidity Sweep Detector", defaultW: 5, defaultH: 9,  icon: Activity   },
  { type: "options-snapshot",          label: "Options Snapshot",          defaultW: 4, defaultH: 11, icon: TrendingUp  },
] as const;

/** Debounce workspace `updateComponent` for MiniChart; localStorage stays immediate. */
const MINICHART_WORKSPACE_DEBOUNCE_MS = 400;

function DashboardPageComponent(_props: { tabId?: string }) {
  const { activeTabId, ready: tabsReady } = useTabs();
  const { symbols, setSymbols, ready: watchlistReady } = useWatchlist();
  const {
    ready: layoutReady,
    getTabState,
    setTabLocked,
    setTabLinkChannel,
    addComponent,
    removeComponent,
    updateComponent,
    setComponentLinkChannel,
    setTabZoom,
    loadFromFile,
    exportToFile,
  } = useLayout();

  const tabState = getTabState(activeTabId);
  const locked = tabState?.locked ?? true;
  const linkChannel = tabState?.linkChannel ?? null;
  const layout = tabState?.layout ?? { columns: 12, rowHeight: 40, components: [] };
  const zoom = layout.zoom ?? 0.9;

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const depsRef = useRef({
    activeTabId,
    updateComponent,
    removeComponent,
    setComponentLinkChannel,
  });
  depsRef.current = {
    activeTabId,
    updateComponent,
    removeComponent,
    setComponentLinkChannel,
  };

  const configChangeByIdRef = useRef(new Map<string, (cfg: Record<string, unknown>) => void>());
  const setLinkByIdRef = useRef(new Map<string, (ch: number | null) => void>());
  const closeByIdRef = useRef(new Map<string, () => void>());
  const miniChartCloseByIdRef = useRef(new Map<string, () => void>());
  const miniChartConfigByIdRef = useRef(new Map<string, (cfg: Record<string, unknown>) => void>());
  const symbolSelectByIdRef = useRef(new Map<string, (sym: string) => void>());

  useLayoutEffect(() => {
    configChangeByIdRef.current.clear();
    setLinkByIdRef.current.clear();
    closeByIdRef.current.clear();
    miniChartCloseByIdRef.current.clear();
    miniChartConfigByIdRef.current.clear();
    symbolSelectByIdRef.current.clear();
  }, [activeTabId, updateComponent, removeComponent, setComponentLinkChannel]);

  const getOnConfigChange = useCallback((id: string) => {
    let fn = configChangeByIdRef.current.get(id);
    if (!fn) {
      fn = (cfg: Record<string, unknown>) => {
        const { activeTabId: tid, updateComponent: uc } = depsRef.current;
        uc(tid, id, { config: cfg });
      };
      configChangeByIdRef.current.set(id, fn);
    }
    return fn;
  }, []);

  const getSetLinkChannel = useCallback((id: string) => {
    let fn = setLinkByIdRef.current.get(id);
    if (!fn) {
      fn = (ch: number | null) => {
        const { activeTabId: tid, setComponentLinkChannel: sl } = depsRef.current;
        sl(tid, id, ch);
      };
      setLinkByIdRef.current.set(id, fn);
    }
    return fn;
  }, []);

  const getOnClose = useCallback((id: string) => {
    let fn = closeByIdRef.current.get(id);
    if (!fn) {
      fn = () => {
        const { activeTabId: tid, removeComponent: rm } = depsRef.current;
        rm(tid, id);
      };
      closeByIdRef.current.set(id, fn);
    }
    return fn;
  }, []);

  const handleSymbolSelect = useCallback((sourceCompId: string, symbol: string) => {
    const components = layoutRef.current.components;
    const sourceComp = components.find((c) => c.id === sourceCompId);
    if (!sourceComp?.linkChannel) return;
    const { activeTabId: tid, updateComponent: uc } = depsRef.current;
    for (const c of components) {
      if (c.id !== sourceCompId && c.linkChannel === sourceComp.linkChannel) {
        uc(tid, c.id, {
          config: { ...c.config, symbol },
        });
      }
    }
  }, []);

  const getOnSymbolSelect = useCallback(
    (sourceCompId: string) => {
      let fn = symbolSelectByIdRef.current.get(sourceCompId);
      if (!fn) {
        fn = (sym: string) => {
          handleSymbolSelect(sourceCompId, sym);
        };
        symbolSelectByIdRef.current.set(sourceCompId, fn);
      }
      return fn;
    },
    [handleSymbolSelect],
  );

  const miniChartWorkspaceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [miniChartMergeEpoch, setMiniChartMergeEpoch] = useState(0);
  const bumpMiniChartMergeEpoch = useCallback(() => {
    setMiniChartMergeEpoch((n) => n + 1);
  }, []);

  const miniChartConfigById = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const c of layout.components) {
      if (c.type !== "minichart") continue;
      m.set(c.id, mergePersistedMiniChartConfig(activeTabId, c.id, c.config));
    }
    return m;
  }, [activeTabId, miniChartMergeEpoch, layout.components]);

  const updateMiniChartConfig = useCallback((componentId: string, nextConfig: Record<string, unknown>) => {
    const tid = activeTabIdRef.current;
    const currentConfig = (layoutRef.current.components.find((c) => c.id === componentId)?.config ??
      {}) as Record<string, unknown>;
    const persisted = readMiniChartConfig(tid, componentId) ?? {};
    const merged = { ...persisted, ...currentConfig, ...nextConfig };
    writeMiniChartConfig(tid, componentId, merged);
    bumpMiniChartMergeEpoch();

    const timers = miniChartWorkspaceTimersRef.current;
    const existing = timers[componentId];
    if (existing) clearTimeout(existing);
    timers[componentId] = setTimeout(() => {
      delete timers[componentId];
      const tabIdNow = activeTabIdRef.current;
      const latest = readMiniChartConfig(tabIdNow, componentId);
      const { updateComponent: uc } = depsRef.current;
      if (latest) uc(tabIdNow, componentId, { config: latest });
    }, MINICHART_WORKSPACE_DEBOUNCE_MS);
  }, [bumpMiniChartMergeEpoch]);

  const getMiniChartOnConfigChange = useCallback((id: string) => {
    let fn = miniChartConfigByIdRef.current.get(id);
    if (!fn) {
      fn = (cfg: Record<string, unknown>) => {
        updateMiniChartConfig(id, cfg);
      };
      miniChartConfigByIdRef.current.set(id, fn);
    }
    return fn;
  }, [updateMiniChartConfig]);

  const getMiniChartOnClose = useCallback((id: string) => {
    let fn = miniChartCloseByIdRef.current.get(id);
    if (!fn) {
      fn = () => {
        const tid = activeTabIdRef.current;
        removeMiniChartConfig(tid, id);
        const t = miniChartWorkspaceTimersRef.current[id];
        if (t) {
          clearTimeout(t);
          delete miniChartWorkspaceTimersRef.current[id];
        }
        const { removeComponent: rm } = depsRef.current;
        rm(tid, id);
      };
      miniChartCloseByIdRef.current.set(id, fn);
    }
    return fn;
  }, []);

  useEffect(() => {
    return () => {
      for (const t of Object.values(miniChartWorkspaceTimersRef.current)) {
        clearTimeout(t);
      }
      miniChartWorkspaceTimersRef.current = {};
    };
  }, []);

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 1.5;
  const ZOOM_STEP = 0.1;

  const handleZoomIn = useCallback(() => {
    const next = Math.min(ZOOM_MAX, Math.round((zoom + ZOOM_STEP) * 10) / 10);
    setTabZoom(activeTabId, next);
  }, [zoom, activeTabId, setTabZoom]);

  const handleZoomOut = useCallback(() => {
    const next = Math.max(ZOOM_MIN, Math.round((zoom - ZOOM_STEP) * 10) / 10);
    setTabZoom(activeTabId, next);
  }, [zoom, activeTabId, setTabZoom]);

  const handleZoomReset = useCallback(() => {
    setTabZoom(activeTabId, 0.9);
  }, [activeTabId, setTabZoom]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        handleZoomReset();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleZoomIn, handleZoomOut, handleZoomReset]);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAddMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node))
        setShowAddMenu(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAddMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showAddMenu]);

  const seededRef = useRef(false);
  useEffect(() => {
    if (!tabsReady || !layoutReady || !watchlistReady || seededRef.current) return;
    seededRef.current = true;
    const legacyWatchlist = layout.components.find((component) => component.type === "watchlist");
    const legacySymbols = Array.isArray(legacyWatchlist?.config.symbols)
      ? (legacyWatchlist?.config.symbols as string[])
      : [];
    if (symbols.length === 0 && legacySymbols.length > 0) {
      setSymbols(legacySymbols);
    }
    if (layout.components.length === 0) {
      addComponent(activeTabId, "watchlist", {
        w: 4, h: 12, x: 0, y: 0,
        config: {},
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsReady, layoutReady, watchlistReady, symbols.length]);

  const handleAddComponent = useCallback(
    (type: string) => {
      const spec = COMPONENT_TYPES.find((c) => c.type === type);
      if (!spec) return;

      const defaultConfigs: Record<string, Record<string, unknown>> = {
        quote: {},
        watchlist: {},
        minichart: { timeframe: "1D", chartType: "candlestick" },
        "ibkr-portfolio": {},
        "mini-screener": {},
        "mini-heatmap": {},
        "liquidity-sweep-detector": { symbols: [], timeframe: "15m", lookbackBars: 3, showExpandedInstructions: true },
        "options-snapshot": {},
      };

      addComponent(activeTabId, type, {
        w: spec.defaultW,
        h: spec.defaultH,
        x: 0,
        y: 0,
        config: defaultConfigs[type] ?? {},
      });
      if (locked) setTabLocked(activeTabId, false);
      setShowAddMenu(false);
    },
    [activeTabId, addComponent, locked, setTabLocked],
  );

  const handleMoveComponent = useCallback(
    (id: string, x: number, y: number) => {
      updateComponent(activeTabId, id, { x, y });
    },
    [activeTabId, updateComponent],
  );

  const handleResizeComponent = useCallback(
    (id: string, w: number, h: number, x?: number, y?: number) => {
      const update: Partial<LayoutComponent> = { w, h };
      if (x !== undefined) update.x = x;
      if (y !== undefined) update.y = y;
      updateComponent(activeTabId, id, update);
    },
    [activeTabId, updateComponent],
  );

  const renderComponent = useCallback(
    (comp: LayoutComponent) => {
      switch (comp.type) {
        case "quote":
          return (
            <QuoteCard
              linkChannel={comp.linkChannel}
              onSetLinkChannel={getSetLinkChannel(comp.id)}
              onClose={getOnClose(comp.id)}
              config={comp.config}
              onConfigChange={getOnConfigChange(comp.id)}
            />
          );
        case "watchlist":
          return (
            <WatchlistCard
              linkChannel={comp.linkChannel}
              onSetLinkChannel={getSetLinkChannel(comp.id)}
              onClose={getOnClose(comp.id)}
              config={comp.config}
              onConfigChange={getOnConfigChange(comp.id)}
              onSymbolSelect={getOnSymbolSelect(comp.id)}
            />
          );
        case "ibkr-portfolio":
          return (
            <IBKRPortfolioCard
              linkChannel={comp.linkChannel}
              onSetLinkChannel={getSetLinkChannel(comp.id)}
              onClose={getOnClose(comp.id)}
              config={comp.config}
              onConfigChange={getOnConfigChange(comp.id)}
            />
          );
        case "minichart": {
          const resolvedConfig =
            miniChartConfigById.get(comp.id) ?? mergePersistedMiniChartConfig(activeTabId, comp.id, comp.config);
          return (
            <MiniChart
              linkChannel={comp.linkChannel}
              onSetLinkChannel={getSetLinkChannel(comp.id)}
              onClose={getMiniChartOnClose(comp.id)}
              config={resolvedConfig}
              onConfigChange={getMiniChartOnConfigChange(comp.id)}
            />
          );
        }
        case "mini-screener":
          return (
            <MiniScreenerCard
              linkChannel={comp.linkChannel}
              onSetLinkChannel={getSetLinkChannel(comp.id)}
              onClose={getOnClose(comp.id)}
              config={comp.config}
              onConfigChange={getOnConfigChange(comp.id)}
              onSymbolSelect={getOnSymbolSelect(comp.id)}
            />
          );
        case "mini-heatmap":
          return (
            <MiniHeatmapCard
              linkChannel={comp.linkChannel}
              onSetLinkChannel={getSetLinkChannel(comp.id)}
              onClose={getOnClose(comp.id)}
              config={comp.config}
              onConfigChange={getOnConfigChange(comp.id)}
            />
          );
        case "liquidity-sweep-detector":
          return (
            <LiquiditySweepDetectorCard
              linkChannel={comp.linkChannel}
              onSetLinkChannel={getSetLinkChannel(comp.id)}
              onClose={getOnClose(comp.id)}
              config={comp.config}
              onConfigChange={getOnConfigChange(comp.id)}
            />
          );
        case "options-snapshot":
          return (
            <OptionsSnapshotCard
              linkChannel={comp.linkChannel}
              onSetLinkChannel={getSetLinkChannel(comp.id)}
              onClose={getOnClose(comp.id)}
              config={comp.config}
              onConfigChange={getOnConfigChange(comp.id)}
            />
          );
        default:
          return (
            <div className="flex h-full items-center justify-center border border-white/[0.06] bg-panel text-[10px] text-white/20">
              Unknown: {comp.type}
            </div>
          );
      }
    },
    [
      getOnConfigChange,
      getSetLinkChannel,
      getOnClose,
      getOnSymbolSelect,
      activeTabId,
      miniChartConfigById,
      getMiniChartOnConfigChange,
      getMiniChartOnClose,
    ],
  );

  const handleToggleLock = useCallback(() => {
    setTabLocked(activeTabId, !locked);
  }, [activeTabId, locked, setTabLocked]);

  const handleSetToolbarLinkChannel = useCallback(
    (ch: number | null) => {
      setTabLinkChannel(activeTabId, ch);
    },
    [activeTabId, setTabLinkChannel],
  );

  const handleToggleAddMenu = useCallback(() => {
    setShowAddMenu((v) => !v);
  }, []);

  const handleLoadWorkspace = useCallback(() => {
    void loadFromFile();
  }, [loadFromFile]);

  const handleSaveWorkspace = useCallback(() => {
    void exportToFile();
  }, [exportToFile]);

  if (!tabsReady || !layoutReady || !watchlistReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-[10px] text-white/20">Loading workspace...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative">
        <DashboardToolbar
          locked={locked}
          onToggleLock={handleToggleLock}
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          linkChannel={linkChannel}
          onSetLinkChannel={handleSetToolbarLinkChannel}
          onAddComponent={handleToggleAddMenu}
          onLoadWorkspace={handleLoadWorkspace}
          onSaveWorkspace={handleSaveWorkspace}
        />

        {showAddMenu && (
          <div
            ref={addMenuRef}
            className="absolute left-2 top-full z-[100] mt-1 min-w-[160px] rounded-md border border-white/[0.08] bg-[#1C2128] py-1 shadow-xl shadow-black/40"
          >
            {COMPONENT_TYPES.map((ct) => {
              const Icon = ct.icon;
              return (
                <button
                  key={ct.type}
                  onClick={() => handleAddComponent(ct.type)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-white transition-colors duration-75 hover:bg-white/[0.06]"
                >
                  <Icon className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                  {ct.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        <div
          style={{
            width: `${100 / zoom}%`,
            height: `${100 / zoom}%`,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
          }}
        >
          <GridLayout
            columns={layout.columns}
            rowHeight={layout.rowHeight}
            components={layout.components}
            locked={locked}
            onMoveComponent={handleMoveComponent}
            onResizeComponent={handleResizeComponent}
            renderComponent={renderComponent}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(DashboardPageComponent);

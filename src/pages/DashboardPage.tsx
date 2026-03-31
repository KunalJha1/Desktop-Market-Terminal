import { useState, useRef, useEffect, useCallback } from "react";
import { DollarSign, List, BarChart2, Briefcase, SlidersHorizontal, LayoutGrid, Activity } from "lucide-react";
import DashboardToolbar from "../components/DashboardToolbar";
import GridLayout from "../components/GridLayout";
import QuoteCard from "../components/QuoteCard";
import IBKRPortfolioCard from "../components/IBKRPortfolioCard";
import WatchlistCard from "../components/WatchlistCard";
import MiniChart from "../chart/components/MiniChart";
import MiniScreenerCard from "../components/MiniScreenerCard";
import MiniHeatmapCard from "../components/MiniHeatmapCard";
import LiquiditySweepDetectorCard from "../components/LiquiditySweepDetectorCard";
import { useTabs } from "../lib/tabs";
import { useLayout } from "../lib/layout";
import type { LayoutComponent } from "../lib/layout-types";
import { useWatchlist } from "../lib/watchlist";
import {
  readMiniChartConfig,
  removeMiniChartConfig,
  writeMiniChartConfig,
} from "../lib/minichart-config-storage";

const COMPONENT_TYPES = [
  { type: "quote", label: "Quote Card", defaultW: 4, defaultH: 8, icon: DollarSign },
  { type: "watchlist", label: "Watchlist", defaultW: 4, defaultH: 10, icon: List },
  { type: "minichart", label: "Mini Chart", defaultW: 4, defaultH: 8, icon: BarChart2 },
  { type: "ibkr-portfolio", label: "Portfolio", defaultW: 8, defaultH: 12, icon: Briefcase },
  { type: "mini-screener", label: "Mini Screener", defaultW: 6, defaultH: 10, icon: SlidersHorizontal },
  { type: "mini-heatmap", label: "Mini Heatmap", defaultW: 6, defaultH: 10, icon: LayoutGrid },
  { type: "liquidity-sweep-detector", label: "Liquidity Sweep Detector", defaultW: 5, defaultH: 9, icon: Activity },
] as const;

export default function DashboardPage() {
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

  // Keyboard shortcuts for zoom
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

  // Add Component dropdown
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

  // Preserve saved user state, but don't seed default symbols on first run.
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

  const handleAddComponent = (type: string) => {
    const spec = COMPONENT_TYPES.find((c) => c.type === type);
    if (!spec) return;

    const defaultConfigs: Record<string, Record<string, unknown>> = {
      quote: {},
      watchlist: {},
      minichart: { timeframe: "1D", chartType: "candlestick" },
      "ibkr-portfolio": {},
      "mini-screener": {},
      "mini-heatmap": {},
      "liquidity-sweep-detector": { symbols: [], timeframe: "15m", lookbackBars: 3 },
    };

    // Drop at (0,0) — user can drag it wherever they want
    addComponent(activeTabId, type, {
      w: spec.defaultW,
      h: spec.defaultH,
      x: 0,
      y: 0,
      config: defaultConfigs[type] ?? {},
    });
    // Auto-unlock so the new component can be dragged immediately
    if (locked) setTabLocked(activeTabId, false);
    setShowAddMenu(false);
  };

  const handleMoveComponent = (id: string, x: number, y: number) => {
    updateComponent(activeTabId, id, { x, y });
  };

  const handleResizeComponent = (id: string, w: number, h: number, x?: number, y?: number) => {
    const update: Partial<LayoutComponent> = { w, h };
    if (x !== undefined) update.x = x;
    if (y !== undefined) update.y = y;
    updateComponent(activeTabId, id, update);
  };

  const resolveMiniChartConfig = useCallback((componentId: string, config: Record<string, unknown>) => {
    const persisted = readMiniChartConfig(activeTabId, componentId);
    if (!persisted) return config;
    const merged = { ...persisted, ...config };
    // `updateMiniChartConfig` writes the full chart config (including oscillators) to localStorage on every
    // MiniChart change. The tab layout `config` can still carry a stale `indicators` array from the last
    // saved workspace file, which would otherwise overwrite localStorage here and strip MACD and similar panes.
    if (Array.isArray(persisted.indicators)) {
      merged.indicators = persisted.indicators;
    }
    if (typeof persisted.legendCollapsed === "boolean") {
      merged.legendCollapsed = persisted.legendCollapsed;
    }
    // Same for Probability Table placement: workspace JSON often carries default x/y and would reset drag position.
    const pw = persisted.probEngWidget;
    if (
      pw &&
      typeof pw === "object" &&
      !Array.isArray(pw) &&
      typeof (pw as { x?: unknown }).x === "number" &&
      typeof (pw as { y?: unknown }).y === "number"
    ) {
      merged.probEngWidget = { ...(pw as Record<string, unknown>) };
    }
    return merged;
  }, [activeTabId]);

  const updateMiniChartConfig = useCallback((componentId: string, currentConfig: Record<string, unknown>, nextConfig: Record<string, unknown>) => {
    const persisted = readMiniChartConfig(activeTabId, componentId) ?? {};
    const merged = { ...persisted, ...currentConfig, ...nextConfig };
    writeMiniChartConfig(activeTabId, componentId, merged);
    updateComponent(activeTabId, componentId, { config: merged });
  }, [activeTabId, updateComponent]);

  // When a watchlist row is clicked, update all linked components on the same channel
  const handleSymbolSelect = (sourceComp: LayoutComponent, symbol: string) => {
    if (!sourceComp.linkChannel) return;
    for (const c of layout.components) {
      if (c.id !== sourceComp.id && c.linkChannel === sourceComp.linkChannel) {
        updateComponent(activeTabId, c.id, {
          config: { ...c.config, symbol },
        });
      }
    }
  };

  const renderComponent = (comp: LayoutComponent) => {
    switch (comp.type) {
      case "quote":
        return (
          <QuoteCard
            linkChannel={comp.linkChannel}
            onSetLinkChannel={(ch) =>
              setComponentLinkChannel(activeTabId, comp.id, ch)
            }
            onClose={() => removeComponent(activeTabId, comp.id)}
            config={comp.config}
            onConfigChange={(cfg) =>
              updateComponent(activeTabId, comp.id, { config: cfg })
            }
          />
        );
      case "watchlist":
        return (
          <WatchlistCard
            linkChannel={comp.linkChannel}
            onSetLinkChannel={(ch) =>
              setComponentLinkChannel(activeTabId, comp.id, ch)
            }
            onClose={() => removeComponent(activeTabId, comp.id)}
            config={comp.config}
            onConfigChange={(cfg) =>
              updateComponent(activeTabId, comp.id, { config: cfg })
            }
            onSymbolSelect={(sym) => handleSymbolSelect(comp, sym)}
          />
        );
      case "ibkr-portfolio":
        return (
          <IBKRPortfolioCard
            linkChannel={comp.linkChannel}
            onSetLinkChannel={(ch) =>
              setComponentLinkChannel(activeTabId, comp.id, ch)
            }
            onClose={() => removeComponent(activeTabId, comp.id)}
            config={comp.config}
            onConfigChange={(cfg) =>
              updateComponent(activeTabId, comp.id, { config: cfg })
            }
          />
        );
      case "minichart":
        {
          const resolvedConfig = resolveMiniChartConfig(comp.id, comp.config);
        return (
          <MiniChart
            linkChannel={comp.linkChannel}
            onSetLinkChannel={(ch) =>
              setComponentLinkChannel(activeTabId, comp.id, ch)
            }
            onClose={() => {
              removeMiniChartConfig(activeTabId, comp.id);
              removeComponent(activeTabId, comp.id);
            }}
            config={resolvedConfig}
            onConfigChange={(cfg) =>
              updateMiniChartConfig(comp.id, comp.config, cfg)
            }
          />
        );
        }
      case "mini-screener":
        return (
          <MiniScreenerCard
            linkChannel={comp.linkChannel}
            onSetLinkChannel={(ch) =>
              setComponentLinkChannel(activeTabId, comp.id, ch)
            }
            onClose={() => removeComponent(activeTabId, comp.id)}
            config={comp.config}
            onConfigChange={(cfg) =>
              updateComponent(activeTabId, comp.id, { config: cfg })
            }
            onSymbolSelect={(sym) => handleSymbolSelect(comp, sym)}
          />
        );
      case "mini-heatmap":
        return (
          <MiniHeatmapCard
            linkChannel={comp.linkChannel}
            onSetLinkChannel={(ch) =>
              setComponentLinkChannel(activeTabId, comp.id, ch)
            }
            onClose={() => removeComponent(activeTabId, comp.id)}
            config={comp.config}
            onConfigChange={(cfg) =>
              updateComponent(activeTabId, comp.id, { config: cfg })
            }
          />
        );
      case "liquidity-sweep-detector":
        return (
          <LiquiditySweepDetectorCard
            linkChannel={comp.linkChannel}
            onSetLinkChannel={(ch) =>
              setComponentLinkChannel(activeTabId, comp.id, ch)
            }
            onClose={() => removeComponent(activeTabId, comp.id)}
            config={comp.config}
            onConfigChange={(cfg) =>
              updateComponent(activeTabId, comp.id, { config: cfg })
            }
          />
        );
      default:
        return (
          <div className="flex h-full items-center justify-center border border-white/[0.06] bg-panel text-[10px] text-white/20">
            Unknown: {comp.type}
          </div>
        );
    }
  };

  // Wait for persisted state to load before rendering
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
          onToggleLock={() => setTabLocked(activeTabId, !locked)}
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          linkChannel={linkChannel}
          onSetLinkChannel={(ch) => setTabLinkChannel(activeTabId, ch)}
          onAddComponent={() => setShowAddMenu((v) => !v)}
          onLoadWorkspace={() => {
            void loadFromFile();
          }}
          onSaveWorkspace={() => {
            void exportToFile();
          }}
        />

        {/* Add Component dropdown */}
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

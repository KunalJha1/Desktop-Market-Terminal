import { useState, useRef, useEffect } from "react";
import DashboardToolbar from "../components/DashboardToolbar";
import GridLayout from "../components/GridLayout";
import QuoteCard from "../components/QuoteCard";
import WatchlistCard from "../components/WatchlistCard";
import MiniChart from "../chart/components/MiniChart";
import { useTabs } from "../lib/tabs";
import { useLayout } from "../lib/layout";
import type { LayoutComponent } from "../lib/layout-types";
import { DEFAULT_WATCHLIST_SYMBOLS, useWatchlist } from "../lib/watchlist";

const COMPONENT_TYPES = [
  { type: "quote", label: "Quote Card", defaultW: 4, defaultH: 8 },
  { type: "watchlist", label: "Watchlist", defaultW: 4, defaultH: 10 },
  { type: "minichart", label: "Mini Chart", defaultW: 4, defaultH: 8 },
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
    loadFromFile,
    flushSave,
  } = useLayout();

  const tabState = getTabState(activeTabId);
  const locked = tabState?.locked ?? true;
  const linkChannel = tabState?.linkChannel ?? null;
  const layout = tabState?.layout ?? { columns: 12, rowHeight: 40, components: [] };

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

  // Seed a default watchlist on first run (when the tab has no components)
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
    } else if (symbols.length === 0) {
      setSymbols(DEFAULT_WATCHLIST_SYMBOLS);
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
      quote: { symbol: "AAPL" },
      watchlist: {},
      minichart: { symbol: "AAPL", timeframe: "1D", chartType: "candlestick" },
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

  // When a watchlist row is clicked, update all QuoteCards on the same link channel
  const handleSymbolSelect = (sourceComp: LayoutComponent, symbol: string) => {
    if (!sourceComp.linkChannel) return;
    for (const c of layout.components) {
      if (
        c.type === "quote" &&
        c.linkChannel === sourceComp.linkChannel
      ) {
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
      case "minichart":
        return (
          <MiniChart
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
          linkChannel={linkChannel}
          onSetLinkChannel={(ch) => setTabLinkChannel(activeTabId, ch)}
          onAddComponent={() => setShowAddMenu((v) => !v)}
          onLoadWorkspace={() => {
            void loadFromFile();
          }}
          onSaveWorkspace={() => {
            void flushSave();
          }}
        />

        {/* Add Component dropdown */}
        {showAddMenu && (
          <div
            ref={addMenuRef}
            className="absolute left-2 top-full z-[100] mt-1 min-w-[160px] rounded-md border border-white/[0.08] bg-[#1C2128] py-1 shadow-xl shadow-black/40"
          >
            {COMPONENT_TYPES.map((ct) => (
              <button
                key={ct.type}
                onClick={() => handleAddComponent(ct.type)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-white/50 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/80"
              >
                {ct.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
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
  );
}

import React, { Suspense, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/platform";
import {
  getDetachedLabel,
  readDetachedTabInfo,
  removeDetachedTabInfo,
  writeDetachedTabInfo,
  writeReattachRequest,
  isMainWindowClosing,
  type DetachedTabInfo,
} from "../lib/detached";
import WindowControls from "../components/WindowControls";
import type { TabType } from "../lib/tabs";
import { saveChartState } from "../lib/chart-state";

// Reuse the same lazy page components as the main Dashboard
const DashboardPage = React.lazy(() => import("./DashboardPage"));
const ScreenerPage = React.lazy(() => import("./ScreenerPage"));
const ChartPage = React.lazy(() => import("./ChartPage"));
const OptionsPage = React.lazy(() => import("./OptionsPage"));
const BacktestPage = React.lazy(() => import("./BacktestPage"));
const SimulationsPage = React.lazy(() => import("./SimulationsPage"));
const HeatmapPage = React.lazy(() => import("./HeatmapPage"));
const MarketBiasPage = React.lazy(() => import("./MarketBiasPage"));

const pageByType: Record<TabType, React.LazyExoticComponent<React.FC<{ tabId?: string }>>> = {
  dashboard: DashboardPage,
  screener: ScreenerPage,
  chart: ChartPage,
  options: OptionsPage,
  backtest: BacktestPage,
  simulations: SimulationsPage,
  heatmap: HeatmapPage,
  bias: MarketBiasPage,
};

function isSupportedTabType(value: string): value is TabType {
  return value in pageByType;
}

function PageFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-base">
      <p className="font-mono text-[12px] uppercase tracking-[0.24em] text-white/30">
        Loading
      </p>
    </div>
  );
}

function readDetachedInfoFromUrl(label: string): DetachedTabInfo | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("detached") !== "1") return null;
    const tabId = params.get("tabId");
    const tabType = params.get("tabType") as TabType | null;
    const title = params.get("title");
    const originalIndexRaw = params.get("originalIndex");
    const originalIndex = originalIndexRaw ? Number.parseInt(originalIndexRaw, 10) : 0;
    if (!tabId || !tabType || !title) return null;
    if (Number.isNaN(originalIndex)) return null;
    return {
      tabId,
      tabType,
      title,
      windowLabel: label,
      originalIndex,
    };
  } catch {
    return null;
  }
}

export default function DetachedWindow() {
  const label = getDetachedLabel()!;
  const [info, setInfo] = useState<DetachedTabInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const closingRef = useRef(false);
  const allowNativeCloseRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadInfo() {
      const fromUrl = readDetachedInfoFromUrl(label);
      if (fromUrl) {
        if (cancelled) return;
        writeDetachedTabInfo(fromUrl);
        appWindow.setTitle(fromUrl.title).catch(() => {});
        console.info("[detached] bootstrapped from URL", fromUrl);
        setInfo(fromUrl);
        setLoadError(null);
        return;
      }

      let tabInfo: DetachedTabInfo | null = null;
      if (isTauriRuntime()) {
        try {
          tabInfo = await invoke<DetachedTabInfo | null>("get_detached_tab_info", { label });
          if (tabInfo) {
            console.info("[detached] bootstrapped from backend state", tabInfo);
          }
        } catch (err) {
          console.error("[detached] get_detached_tab_info failed", err);
          tabInfo = null;
        }
      }
      if (!tabInfo) {
        tabInfo = readDetachedTabInfo(label);
        if (tabInfo) {
          console.info("[detached] bootstrapped from local storage", tabInfo);
        }
      }

      if (cancelled) return;
      if (tabInfo) {
        if (tabInfo.tabType === "chart" && tabInfo.chartStateJson) {
          try {
            saveChartState(tabInfo.tabId, JSON.parse(tabInfo.chartStateJson));
          } catch (err) {
            console.error("[detached] failed to hydrate chart state", err);
          }
        }
        writeDetachedTabInfo(tabInfo);
        appWindow.setTitle(tabInfo.title).catch(() => {});
        setLoadError(null);
      } else {
        console.error(`[detached] missing detached tab payload for ${label}`);
        setLoadError("Detached tab payload was missing. Reopen the tab from the main window.");
      }
      setInfo(tabInfo);
    }

    void loadInfo();

    return () => {
      cancelled = true;
    };
  }, [label]);

  const closeDetachedWindow = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      const currentInfo = readDetachedTabInfo(label) ?? info;
      if (currentInfo && !isMainWindowClosing()) {
        writeReattachRequest(currentInfo);
      }
      removeDetachedTabInfo(label);
      allowNativeCloseRef.current = true;
      await appWindow.close();
    } catch {
      allowNativeCloseRef.current = false;
      closingRef.current = false;
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlisten = appWindow.onCloseRequested(async (event) => {
      if (allowNativeCloseRef.current || isMainWindowClosing()) {
        return;
      }
      event.preventDefault();
      await closeDetachedWindow();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [info, label]);

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  const handleMaximizeToggle = async () => {
    const isMax = await appWindow.isMaximized();
    if (isMax) {
      await appWindow.unmaximize();
      return;
    }
    await appWindow.maximize();
  };

  const handleDragRegionMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    if (e.button === 0 && isTauriRuntime()) {
      appWindow.startDragging().catch(() => {});
    }
  };

  const handleDragRegionDblClick = () => {
    if (!isTauriRuntime()) return;
    appWindow.isMaximized().then((max) => {
      max ? appWindow.unmaximize() : appWindow.maximize();
    }).catch(() => {});
  };

  if (!info) {
    return (
      <div className="flex h-screen w-screen flex-col bg-base">
        <div
          className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.06] bg-base"
          onMouseDown={handleDragRegionMouseDown}
          onDoubleClick={handleDragRegionDblClick}
        >
          <span className="px-3 font-mono text-[11px] text-white/30">DailyIQ</span>
          <WindowControls
            onMinimize={handleMinimize}
            onMaximizeToggle={handleMaximizeToggle}
            onClose={closeDetachedWindow}
          />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="px-6 text-center">
            <p className="font-mono text-[12px] uppercase tracking-[0.24em] text-white/30">
              Detached tab unavailable
            </p>
            <p className="mt-3 text-[11px] text-white/40">
              {loadError ?? "No detached content was available for this window."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isSupportedTabType(info.tabType)) {
    console.error("[detached] unsupported tab type", info);
    return (
      <div className="flex h-screen w-screen flex-col bg-base">
        <div
          className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.06] bg-base"
          onMouseDown={handleDragRegionMouseDown}
          onDoubleClick={handleDragRegionDblClick}
        >
          <span className="px-3 font-mono text-[11px] text-white/30">DailyIQ</span>
          <WindowControls
            onMinimize={handleMinimize}
            onMaximizeToggle={handleMaximizeToggle}
            onClose={closeDetachedWindow}
          />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.24em] text-white/30">
              Unsupported tab
            </p>
            <p className="mt-3 text-[11px] text-white/40">
              This detached window received an invalid tab type.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const PageComponent = pageByType[info.tabType];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base">
      {/* Minimal title bar */}
      <div
        className="flex h-8 shrink-0 cursor-default select-none items-center justify-between border-b border-white/[0.06] bg-base"
        onMouseDown={handleDragRegionMouseDown}
        onDoubleClick={handleDragRegionDblClick}
      >
        <span className="px-3 font-mono text-[11px] text-white/45">{info.title}</span>
        <WindowControls
          onMinimize={handleMinimize}
          onMaximizeToggle={handleMaximizeToggle}
          onClose={closeDetachedWindow}
        />
      </div>

      {/* Page content */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<PageFallback />}>
          <div className="flex h-full w-full flex-col overflow-hidden">
            <PageComponent tabId={info.tabId} />
          </div>
        </Suspense>
      </main>
    </div>
  );
}

import React, { Suspense, useEffect, useState } from "react";
import { appWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/platform";
import { getDetachedLabel, readDetachedTabInfo, type DetachedTabInfo } from "../lib/detached";
import WindowControls from "../components/WindowControls";
import type { TabType } from "../lib/tabs";

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

function PageFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-base">
      <p className="font-mono text-[12px] uppercase tracking-[0.24em] text-white/30">
        Loading
      </p>
    </div>
  );
}

export default function DetachedWindow() {
  const label = getDetachedLabel()!;
  const [info, setInfo] = useState<DetachedTabInfo | null>(null);

  useEffect(() => {
    const tabInfo = readDetachedTabInfo(label);
    setInfo(tabInfo);

    // Set the native window title to the tab title
    if (tabInfo && isTauriRuntime()) {
      appWindow.setTitle(tabInfo.title).catch(() => {});
    }
  }, [label]);

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
          <WindowControls />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.24em] text-white/30">
            No content
          </p>
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
        <WindowControls />
      </div>

      {/* Page content */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<PageFallback />}>
          <PageComponent tabId={info.tabId} />
        </Suspense>
      </main>
    </div>
  );
}

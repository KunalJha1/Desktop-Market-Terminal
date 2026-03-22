import { useState, useRef } from "react";
import { appWindow } from "@tauri-apps/api/window";
import { useAuth } from "../lib/auth";
import { useTabs, type TabType } from "../lib/tabs";
import { useTws } from "../lib/tws";
import { isTauriRuntime, usePlatform } from "../lib/platform";
import WindowControls from "../components/WindowControls";
import TabBar from "../components/TabBar";
import SettingsPanel from "../components/SettingsPanel";
import DashboardPage from "./DashboardPage";
import ChartPage from "./ChartPage";
import OptionsPage from "./OptionsPage";
import BacktestPage from "./BacktestPage";
import SimulationsPage from "./SimulationsPage";
import HeatmapPage from "./HeatmapPage";
import MarketBiasPage from "./MarketBiasPage";

const pageByType: Record<TabType, React.FC<{ tabId?: string }>> = {
  dashboard: DashboardPage,
  chart: ChartPage,
  options: OptionsPage,
  backtest: BacktestPage,
  simulations: SimulationsPage,
  heatmap: HeatmapPage,
  bias: MarketBiasPage,
};

const CONNECTION_LABELS: Record<string, string> = {
  "tws-live": "TWS Live",
  "tws-paper": "TWS Paper",
  "gateway-live": "Gateway Live",
  "gateway-paper": "Gateway Paper",
};

export default function Dashboard() {
  const { session } = useAuth();
  const { tabs, activeTabId } = useTabs();
  const { status, port, clientId, connectionType, sidecarStatus } = useTws();
  const { isMac } = usePlatform();

  // Derive active data provider for status bar
  const dataProvider = status === "connected"
    ? "live" as const
    : sidecarStatus === "connected"
      ? "yahoo" as const
      : "offline" as const;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const user = session?.user;
  const firstName =
    user?.user_metadata?.full_name?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "User";

  const lastClickTime = useRef(0);
  const canDragWindow = isTauriRuntime();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const ActivePage = activeTab ? pageByType[activeTab.type] : null;

  return (
    <div className="flex h-screen flex-col bg-base">
      {/* Top bar — draggable titlebar */}
      <header
        className={`flex h-8 shrink-0 items-center border-b border-white/[0.06] bg-[#10151C] px-3 ${
          isMac ? "justify-end pl-[70px]" : "justify-between"
        }`}
        onMouseDown={async (e) => {
          if (!canDragWindow) return;
          if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
          e.preventDefault();
          const now = Date.now();
          if (now - lastClickTime.current < 300) {
            lastClickTime.current = 0;
            try {
              const isMax = await appWindow.isMaximized();
              if (isMax) await appWindow.unmaximize();
              else await appWindow.maximize();
            } catch {}
          } else {
            lastClickTime.current = now;
            appWindow.startDragging().catch(() => {});
          }
        }}
      >
        {!isMac && (
          <div className="flex items-center gap-3" data-no-drag>
            <p className="text-[11px] font-light tracking-wide text-white/40">
              Hi, <span className="text-white/70">{firstName}</span>
            </p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-[11px] font-light text-white/30 transition-all duration-100 hover:text-white/80"
            >
              Settings
            </button>
          </div>
        )}

        <div className="flex items-center gap-3" data-no-drag>
          {isMac && (
            <>
              <p className="text-[11px] font-light tracking-wide text-white/40">
                Hi, <span className="text-white/70">{firstName}</span>
              </p>
              <button
                onClick={() => setSettingsOpen(true)}
                className="text-[11px] font-light text-white/30 transition-all duration-100 hover:text-white/80"
              >
                Settings
              </button>
            </>
          )}
          <WindowControls />
        </div>
      </header>

      {/* Tab bar */}
      <TabBar />

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        {ActivePage && <ActivePage tabId={activeTab?.id} />}
      </main>

      {/* Bottom status bar */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.06] bg-base px-3 text-[10px] tracking-wide">
        <p className="font-light text-white/20">
          For research purposes only. Questions?{" "}
          <a
            href="mailto:dailyiqme@gmail.com"
            className="text-white/30 underline decoration-white/10 underline-offset-2 transition-colors duration-100 hover:text-white/50"
          >
            dailyiqme@gmail.com
          </a>
        </p>

        <div className="flex items-center gap-3 font-mono text-[10px] text-white/30">
          {/* Data provider */}
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                dataProvider === "live"
                  ? "bg-green"
                  : dataProvider === "yahoo"
                    ? "bg-blue"
                    : "bg-red/60"
              }`}
            />
            <span className={
              dataProvider === "live"
                ? "text-green"
                : dataProvider === "yahoo"
                  ? "text-blue"
                  : "text-red/60"
            }>
              {dataProvider === "live"
                ? "LIVE"
                : dataProvider === "yahoo"
                  ? "YAHOO"
                  : "OFFLINE"}
            </span>
          </div>
          <span className="text-white/10">|</span>
          {/* TWS connection */}
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                status === "connected"
                  ? "bg-green"
                  : status === "probing"
                    ? "bg-amber animate-pulse"
                    : "bg-red/60"
              }`}
            />
            <span>
              {status === "connected" && connectionType
                ? CONNECTION_LABELS[connectionType]
                : status === "probing"
                  ? "Probing..."
                  : "Disconnected"}
            </span>
          </div>
          <span className="text-white/10">|</span>
          <span>
            Port{" "}
            <span className="text-white/15">{port ?? "—"}</span>
          </span>
          <span className="text-white/10">|</span>
          <span>
            Client ID{" "}
            <span className="text-white/15">{clientId ?? "—"}</span>
          </span>
        </div>
      </footer>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

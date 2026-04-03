import React, { Suspense, useState, useRef, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { appWindow } from "@tauri-apps/api/window";
import { checkUpdate, installUpdate } from "@tauri-apps/api/updater";
import { relaunch } from "@tauri-apps/api/process";
import { useAuth } from "../lib/auth";
import { useTabs, type TabType } from "../lib/tabs";
import { useTws } from "../lib/tws";
import { useObservedMarketDataSource } from "../lib/use-market-data";
import { isTauriRuntime, usePlatform } from "../lib/platform";
import WindowControls from "../components/WindowControls";
import TabBar from "../components/TabBar";
import SettingsPanel from "../components/SettingsPanel";

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

const CONNECTION_LABELS: Record<string, string> = {
  "tws-live": "TWS Live",
  "tws-paper": "TWS Paper",
  "gateway-live": "Gateway Live",
  "gateway-paper": "Gateway Paper",
};

export default function Dashboard() {
  const { session } = useAuth();
  const { tabs, activeTabId } = useTabs();
  const {
    status,
    port,
    clientId,
    connectionType,
    finnhubStatus,
    finnhubHasKey,
    dailyiqHasKey,
    ibStatus,
    backendState,
    backendMessage,
    restartBackend,
  } = useTws();
  const observedMarketDataSource = useObservedMarketDataSource();
  const { isMac } = usePlatform();
  const isIbConnected = ibStatus === "connected";
  const isIbReconnecting = ibStatus === "reconnecting";
  const footerConnectionLabel =
    connectionType && status === "connected"
      ? CONNECTION_LABELS[connectionType]
      : "IBKR CONNECTED";

  const dataProvider = isIbConnected
    ? "live"
    : observedMarketDataSource === "dailyiq" || (dailyiqHasKey && observedMarketDataSource == null)
      ? "dailyiq"
      : observedMarketDataSource === "finnhub"
        ? "finnhub"
        : observedMarketDataSource === "yahoo"
          ? "yahoo"
          : "offline";
  const finnhubIndicatorState =
    finnhubStatus === "connected"
      ? "connected"
      : finnhubStatus === "testing"
        ? "testing"
        : finnhubHasKey
          ? "saved"
          : "off";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    checkUpdate()
      .then(({ shouldUpdate, manifest }) => {
        if (shouldUpdate) {
          setUpdateAvailable(true);
          setUpdateVersion(manifest?.version ?? null);
        }
      })
      .catch(() => {});
  }, []);

  async function handleApplyUpdate() {
    setUpdateInstalling(true);
    try {
      await installUpdate();
      await relaunch();
    } catch {
      setUpdateInstalling(false);
    }
  }

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);
  const user = session?.user;
  const firstName =
    user?.user_metadata?.full_name?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "User";

  const lastClickTime = useRef(0);
  const canDragWindow = isTauriRuntime();
  const headerMeta = (
    <>
      <p className="min-w-0 truncate text-[11px] font-light tracking-wide text-white/40">
        Hi, <span className="text-white/70">{firstName}</span>
      </p>
      <div className="flex min-w-0 shrink items-center gap-2 overflow-hidden">
        <button
          onClick={() => setSettingsOpen(true)}
          className="relative shrink-0 text-[11px] font-light text-white/30 transition-all duration-100 hover:text-white/80"
        >
          Settings
          {updateAvailable && (
            <span className="absolute -right-1.5 -top-0.5 h-[5px] w-[5px] rounded-full bg-red" />
          )}
        </button>
        {appVersion ? (
          <span
            className="truncate font-mono text-[10px] tabular-nums text-white/25"
            title="App version"
          >
            v{appVersion}
          </span>
        ) : null}
      </div>
    </>
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const ActivePage = activeTab ? pageByType[activeTab.type] : null;

  return (
    <div className="flex h-screen flex-col bg-base">
      {/* Top bar — draggable titlebar */}
      <header
        className={`flex h-8 shrink-0 items-center border-b border-white/[0.06] bg-[#10151C] ${
          isMac ? "justify-end pl-[78px] pr-3" : "justify-between pl-3"
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
          <div className="flex min-w-0 items-center gap-3" data-no-drag>
            {headerMeta}
          </div>
        )}

        <div
          className={`flex min-w-0 items-center gap-3 ${isMac ? "ml-auto max-w-full overflow-hidden" : ""}`}
          data-no-drag
        >
          {isMac && (
            <div className="flex min-w-0 max-w-full items-center justify-end gap-3 overflow-hidden">
              {headerMeta}
            </div>
          )}
          <WindowControls />
        </div>
      </header>

      {/* Update banner */}
      {updateAvailable && (
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-blue/20 bg-blue/[0.06] px-3">
          <span className="font-mono text-[10px] tracking-wide text-blue/70">
            {updateVersion ? `v${updateVersion} available` : "Update available"}
          </span>
          <button
            onClick={handleApplyUpdate}
            disabled={updateInstalling}
            className="rounded bg-blue/15 px-2 py-0.5 font-mono text-[10px] tracking-wide text-blue transition-colors duration-100 hover:bg-blue/25 disabled:opacity-50"
          >
            {updateInstalling ? "Installing..." : "Restart & Update"}
          </button>
        </div>
      )}

      {/* Tab bar */}
      <TabBar />

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        <Suspense fallback={
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30">Loading...</p>
          </div>
        }>
          {ActivePage && <ActivePage tabId={activeTab?.id} />}
        </Suspense>
      </main>

      {/* Bottom status bar */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.06] bg-base px-3 text-[10px] tracking-wide">
        <p className="font-light text-white">
          For research purposes only. Questions?{" "}
          <a
            href="mailto:dailyiqme@gmail.com"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors duration-100 hover:text-white/70"
          >
            dailyiqme@gmail.com
          </a>
        </p>

        <div className="flex items-center gap-3 font-mono text-[10px] text-white">
          {/* Data provider */}
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                dataProvider === "live"
                  ? "bg-green"
                  : dataProvider === "dailyiq"
                    ? "bg-sky-400"
                    : dataProvider === "finnhub" || dataProvider === "yahoo"
                      ? "bg-blue"
                      : "bg-red/60"
              }`}
            />
            <span className={
              dataProvider === "live"
                ? "text-green"
                : dataProvider === "dailyiq"
                  ? "text-sky-400"
                  : dataProvider === "finnhub" || dataProvider === "yahoo"
                    ? "text-blue"
                    : "text-red/60"
            }>
              {dataProvider === "live"
                ? "LIVE"
                : dataProvider === "dailyiq"
                  ? "DAILYIQ"
                  : dataProvider === "finnhub"
                    ? "FINNHUB"
                : dataProvider === "yahoo"
                  ? "YAHOO"
                  : "OFFLINE"}
            </span>
          </div>
          <span className="text-white/30">|</span>
          {/* Backend status — clickable restart when not healthy */}
          {backendState === "healthy" ? (
            <div className="flex items-center gap-1.5 text-green">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green" />
              <span>BACKEND</span>
            </div>
          ) : (
            <button
              onClick={restartBackend}
              title={backendMessage || "Click to restart backend"}
              className={`flex items-center gap-1.5 rounded px-1 transition-colors duration-120 ${
                backendState === "restarting" || backendState === "starting"
                  ? "cursor-default text-amber"
                  : "cursor-pointer text-red hover:text-red/80 hover:bg-red/10"
              }`}
              disabled={backendState === "restarting" || backendState === "starting"}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  backendState === "starting" || backendState === "restarting" || backendState === "unhealthy"
                    ? "bg-amber animate-pulse"
                    : "bg-red"
                }`}
              />
              <span>
                {backendState === "starting"
                  ? "BACKEND STARTING"
                  : backendState === "restarting"
                    ? "BACKEND RESTARTING"
                    : backendState === "unhealthy"
                      ? "BACKEND UNHEALTHY ↻"
                      : "BACKEND OFFLINE ↻"}
              </span>
            </button>
          )}
          <span className="text-white/30">|</span>
          {finnhubIndicatorState !== "off" ? (
            <>
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    finnhubIndicatorState === "connected"
                      ? "bg-green"
                      : "bg-amber animate-pulse"
                  }`}
                />
                <span
                  className={
                    finnhubIndicatorState === "connected"
                      ? "text-green"
                      : "text-amber"
                  }
                >
                  {finnhubIndicatorState === "connected"
                    ? "FINNHUB"
                    : finnhubIndicatorState === "testing"
                      ? "FINNHUB TESTING"
                      : "FINNHUB SAVED"}
                </span>
              </div>
              <span className="text-white/30">|</span>
            </>
          ) : null}
          {status === "connected" && port !== null && clientId !== null ? (
            <>
              <span>
                Port{" "}
                <span className="text-white/60">{port}</span>
              </span>
              <span className="text-white/30">|</span>
              <span>
                Client ID{" "}
                <span className="text-white/60">{clientId}</span>
              </span>
            </>
          ) : null}
          {status === "connected" && port !== null && clientId !== null ? (
            <span className="text-white/30">|</span>
          ) : null}
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                status === "connected"
                  ? "bg-green"
                  : status === "probing" || isIbReconnecting
                    ? "bg-amber animate-pulse"
                    : "bg-red/60"
              }`}
            />
            <span className={
              status === "connected"
                ? "text-green"
                : isIbReconnecting || status === "probing"
                  ? "text-amber"
                  : "text-red"
            }>
              {status === "connected"
                ? footerConnectionLabel
                : isIbReconnecting
                  ? "Reconnecting..."
                  : status === "probing"
                    ? "Probing..."
                    : "TWS DISCONNECTED"}
            </span>
          </div>
        </div>
      </footer>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} updateAvailable={updateAvailable} />
    </div>
  );
}

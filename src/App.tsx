import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider, useAuth } from "./lib/auth";
import AuthLayout from "./layouts/AuthLayout";
import LoginLanding from "./pages/auth/LoginLanding";
import SignIn from "./pages/auth/SignIn";
import SignUp from "./pages/auth/SignUp";
import Terms from "./pages/auth/Terms";
import Dashboard from "./pages/Dashboard";
import DetachedWindow from "./pages/DetachedWindow";
import TestWindow from "./pages/TestWindow";
import { LayoutProvider, useLayout } from "./lib/layout";
import { TwsProvider } from "./lib/tws";
import { TabProvider, useTabs } from "./lib/tabs";
import { appWindow } from "@tauri-apps/api/window";
import { WatchlistProvider, useWatchlist } from "./lib/watchlist";
import { isTauriRuntime } from "./lib/platform";
import { initPerfDiagnostics } from "./lib/perf-diagnostics";
import { isDetachedWindow, isTestWindowLabel, setMainWindowClosing } from "./lib/detached";

type WindowMode = "main" | "detached" | "test";

function isTestWindow(): boolean {
  return isTestWindowLabel();
}

function resolveWindowMode(): WindowMode {
  if (isTestWindow()) return "test";
  if (isDetachedWindow()) return "detached";
  return "main";
}

function SplashScreen({ label }: { label: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-base">
      <p className="font-mono text-[12px] uppercase tracking-[0.24em] text-white/45">
        {label}
      </p>
    </div>
  );
}

function LayoutGate({ children }: { children: React.ReactNode }) {
  const { ready: layoutReady } = useLayout();
  const { ready: tabsReady } = useTabs();
  if (!layoutReady || !tabsReady) {
    return <SplashScreen label="Loading workspace" />;
  }
  return <>{children}</>;
}

let isClosing = false;

function CloseGuard() {
  const { flushSave: flushLayout } = useLayout();
  const { flushSave: flushTabs } = useTabs();
  const { flushSave: flushWatchlist } = useWatchlist();

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!isDetachedWindow()) {
      setMainWindowClosing(false);
    }

    const unlisten = appWindow.onCloseRequested(async (event) => {
      if (isClosing) return;
      isClosing = true;
      event.preventDefault();
      if (!isDetachedWindow()) {
        setMainWindowClosing(true);
      }
      await Promise.all([flushLayout(), flushTabs(), flushWatchlist()]);
      await appWindow.close();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [flushLayout, flushTabs, flushWatchlist]);

  return null;
}

function AppRoutes() {
  const { session, loading, authError } = useAuth();

  if (loading) return <SplashScreen label="Starting app" />;

  if (session) {
    return (
      <LayoutProvider>
        <TabProvider>
          <WatchlistProvider>
            <TwsProvider>
              <LayoutGate>
                <CloseGuard />
                <Routes>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </LayoutGate>
            </TwsProvider>
          </WatchlistProvider>
        </TabProvider>
      </LayoutProvider>
    );
  }

  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/" element={<LoginLanding />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/terms" element={<Terms />} />
      </Route>
      {authError ? (
        <Route
          path="/auth-error"
          element={<SplashScreen label={authError} />}
        />
      ) : null}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  useEffect(() => {
    initPerfDiagnostics();
  }, []);

  const windowMode = resolveWindowMode();

  if (windowMode === "test") {
    return (
      <ErrorBoundary>
        <TestWindow />
      </ErrorBoundary>
    );
  }

  if (windowMode === "detached") {
    return (
      <ErrorBoundary>
        <WatchlistProvider>
          <TwsProvider>
            <DetachedWindow />
          </TwsProvider>
        </WatchlistProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;

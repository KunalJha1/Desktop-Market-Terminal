import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  loadTwsSettings,
  saveTwsSettings,
  type TwsSettings,
} from "./tws-storage";

type TwsStatus = "disconnected" | "probing" | "connected";
type TwsConnectionType =
  | "tws-live"
  | "tws-paper"
  | "gateway-live"
  | "gateway-paper";

type SidecarStatus = "connected" | "degraded" | "disconnected";
type FinnhubStatus = "connected" | "disconnected" | "testing";
type IbStatus = "connected" | "reconnecting" | "disconnected";
type BackendState =
  | "starting"
  | "healthy"
  | "unhealthy"
  | "restarting"
  | "stopped"
  | "failed";

const IB_STATUS_TIMEOUT_MS = 4000;
const SIDECAR_POLL_INTERVAL_MS = 3000;

interface ProbeResult {
  port: number;
  connection_type: TwsConnectionType;
}

interface BackendStatusResponse {
  state: BackendState;
  sidecar_port: number | null;
  last_healthy_at: number | null;
  last_restart_reason: string | null;
  restart_count: number;
  logs_available: boolean;
  log_path: string | null;
}

interface FinnhubStatusResponse {
  status: FinnhubStatus;
  message: string;
  hasKey: boolean;
  validatedAt: number | null;
}

interface FinnhubValidateResponse {
  ok: boolean;
  status: FinnhubStatus;
  message: string;
  hasKey: boolean;
  validatedAt: number | null;
}

interface TwsStatusResponse {
  connected: boolean;
  reconnecting: boolean;
  state: string;
  host: string | null;
  port: number | null;
  lastDisconnectAt: number | null;
  lastReconnectAt: number | null;
  reconnectAttempts: number;
  lastError: string | null;
}

interface TwsContextValue {
  status: TwsStatus;
  port: number | null;
  clientId: number | null;
  connectionType: TwsConnectionType | null;
  settings: TwsSettings;
  updateSettings: (updates: Partial<TwsSettings>) => void;
  probe: () => Promise<void>;
  sidecarPort: number | null;
  sidecarStatus: SidecarStatus;
  reloadSettings: () => Promise<void>;
  finnhubStatus: FinnhubStatus;
  finnhubMessage: string;
  finnhubHasKey: boolean;
  validateFinnhubKey: (apiKey: string) => Promise<FinnhubValidateResponse>;
  dailyiqHasKey: boolean;
  ibStatus: IbStatus;
  backendState: BackendState;
  backendMessage: string;
  restartBackend: () => Promise<void>;
}

export const TwsContext = createContext<TwsContextValue | null>(null);

export function useTws(): TwsContextValue {
  const ctx = useContext(TwsContext);
  if (!ctx) throw new Error("useTws must be used within TwsProvider");
  return ctx;
}

export function TwsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TwsStatus>("disconnected");
  const [port, setPort] = useState<number | null>(null);
  const [connectionType, setConnectionType] =
    useState<TwsConnectionType | null>(null);
  const [settings, setSettings] = useState<TwsSettings>({
    tradingMode: "account",
    faGroup: "",
    accountId: "",
    clientId: 0,
    autoProbe: true,
    intradayBackfillYears: 2,
    finnhubApiKey: "",
    playbookMemory: "",
    playbookMemoryEnabled: false,
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const initialized = useRef(false);

  const [sidecarPort, setSidecarPort] = useState<number | null>(null);
  const [sidecarStatus, setSidecarStatus] =
    useState<SidecarStatus>("disconnected");
  const [finnhubStatus, setFinnhubStatus] = useState<FinnhubStatus>("disconnected");
  const [finnhubMessage, setFinnhubMessage] = useState("No API key saved");
  const [finnhubHasKey, setFinnhubHasKey] = useState(false);
  const [dailyiqHasKey, setDailyiqHasKey] = useState(false);
  const [ibStatus, setIbStatus] = useState<IbStatus>("disconnected");
  const [backendState, setBackendState] = useState<BackendState>("stopped");
  const [backendMessage, setBackendMessage] = useState("Backend stopped");

  const reloadSettings = useCallback(async () => {
    const loaded = await loadTwsSettings();
    setSettings(loaded);
    settingsRef.current = loaded;
  }, []);

  const probe = useCallback(async () => {
    setStatus("probing");
    try {
      const result = await invoke<ProbeResult | null>("probe_tws_ports");
      if (result) {
        setPort(result.port);
        setConnectionType(result.connection_type);
        setStatus("connected");
      } else {
        setPort(null);
        setConnectionType(null);
        setStatus("disconnected");
      }
    } catch {
      setPort(null);
      setConnectionType(null);
      setStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    reloadSettings().then(() => {
      probe();
    });
  }, [probe, reloadSettings]);

  const refreshBackendStatus = useCallback(async () => {
    try {
      const payload = await invoke<BackendStatusResponse>("get_backend_status");
      setBackendState(payload.state);
      setBackendMessage(
        payload.last_restart_reason
          ? `${payload.state}: ${payload.last_restart_reason}`
          : payload.state === "healthy"
            ? "Backend healthy"
            : `Backend ${payload.state}`,
      );
      const nextPort = payload.sidecar_port;
      if (payload.state === "healthy" && nextPort) {
        setSidecarPort(nextPort);
        setSidecarStatus("connected");
      } else if (
        payload.state === "starting" ||
        payload.state === "restarting" ||
        payload.state === "unhealthy"
      ) {
        setSidecarPort(nextPort);
        setSidecarStatus("degraded");
      } else {
        setSidecarPort(null);
        setSidecarStatus("disconnected");
      }
      if (payload.state === "failed" || payload.state === "stopped") {
        setIbStatus("disconnected");
      }
    } catch {
      setBackendState("unhealthy");
      setBackendMessage("Backend status unavailable");
      setSidecarStatus((prev) => (prev === "connected" ? "degraded" : prev));
    }
  }, []);

  useEffect(() => {
    refreshBackendStatus();
    const id = setInterval(refreshBackendStatus, SIDECAR_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshBackendStatus]);

  const restartBackend = useCallback(async () => {
    setBackendState("restarting");
    setBackendMessage("Backend restarting...");
    setSidecarStatus("degraded");
    try {
      await invoke<number>("restart_sidecar");
    } catch {
      // Watchdog will pick up the failed state; refresh immediately to show latest status
    }
    await refreshBackendStatus();
  }, [refreshBackendStatus]);

  // Auto-trigger a restart when the backend transitions into "failed" state.
  // The Rust watchdog also handles this but has a 20 s backoff; one immediate
  // attempt from the frontend fills that gap without conflicting.
  const prevBackendStateRef = useRef<BackendState>(backendState);
  useEffect(() => {
    const prev = prevBackendStateRef.current;
    prevBackendStateRef.current = backendState;
    if (prev !== "failed" && backendState === "failed") {
      restartBackend();
    }
  }, [backendState, restartBackend]);

  const refreshFinnhubStatus = useCallback(async () => {
    const localHasKey = settingsRef.current.finnhubApiKey.trim().length > 0;
    if (!sidecarPort || backendState !== "healthy") {
      setFinnhubStatus("disconnected");
      setFinnhubMessage(
        backendState === "restarting" || backendState === "starting"
          ? "Backend restarting"
          : "Backend disconnected",
      );
      setFinnhubHasKey(localHasKey);
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/settings/finnhub/status`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = (await res.json()) as FinnhubStatusResponse;
      setFinnhubStatus(payload.status);
      setFinnhubMessage(payload.message);
      setFinnhubHasKey(payload.hasKey);
    } catch {
      setFinnhubStatus("disconnected");
      setFinnhubMessage("Finnhub status unavailable");
      setFinnhubHasKey(localHasKey);
    }
  }, [backendState, sidecarPort]);

  useEffect(() => {
    refreshFinnhubStatus();
    if (!sidecarPort) return;
    const id = setInterval(refreshFinnhubStatus, 5000);
    return () => clearInterval(id);
  }, [sidecarPort, refreshFinnhubStatus]);

  const refreshDailyiqStatus = useCallback(async () => {
    if (!sidecarPort || backendState !== "healthy") {
      setDailyiqHasKey(false);
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/settings/dailyiq/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as { hasKey: boolean; status: string };
      setDailyiqHasKey(payload.hasKey);
    } catch {
      setDailyiqHasKey(false);
    }
  }, [backendState, sidecarPort]);

  useEffect(() => {
    refreshDailyiqStatus();
    if (!sidecarPort) return;
    const id = setInterval(refreshDailyiqStatus, 15_000);
    return () => clearInterval(id);
  }, [sidecarPort, refreshDailyiqStatus]);

  const refreshIbStatus = useCallback(async () => {
    if (!sidecarPort || backendState !== "healthy") {
      setIbStatus("disconnected");
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/tws-status`, {
        signal: AbortSignal.timeout(IB_STATUS_TIMEOUT_MS),
      });
      if (!res.ok) {
        setIbStatus("disconnected");
        return;
      }
      const payload = (await res.json()) as TwsStatusResponse;
      if (payload.connected) {
        setIbStatus("connected");
      } else if (payload.reconnecting) {
        setIbStatus("reconnecting");
      } else {
        setIbStatus("disconnected");
      }
    } catch {
      setIbStatus("disconnected");
    }
  }, [backendState, sidecarPort]);

  useEffect(() => {
    refreshIbStatus();
    if (!sidecarPort) return;
    const id = setInterval(refreshIbStatus, 5000);
    return () => clearInterval(id);
  }, [sidecarPort, refreshIbStatus]);

  useEffect(() => {
    if (status !== "disconnected" || !settings.autoProbe) return;
    const id = setInterval(() => probe(), 10_000);
    return () => clearInterval(id);
  }, [status, settings.autoProbe, probe]);

  const updateSettings = useCallback(
    (updates: Partial<TwsSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...updates };
        saveTwsSettings(next);
        return next;
      });
    },
    [],
  );

  const validateFinnhubKey = useCallback(
    async (apiKey: string): Promise<FinnhubValidateResponse> => {
      if (!sidecarPort || backendState !== "healthy") {
        return {
          ok: false,
          status: "disconnected",
          message: "Backend not ready",
          hasKey: false,
          validatedAt: null,
        };
      }
      setFinnhubStatus("testing");
      setFinnhubMessage("Testing Finnhub key...");
      try {
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/settings/finnhub/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        });
        const payload = (await res.json()) as FinnhubValidateResponse;
        await reloadSettings();
        await refreshFinnhubStatus();
        return payload;
      } catch {
        await refreshFinnhubStatus();
        return {
          ok: false,
          status: "disconnected",
          message: "Finnhub validation request failed",
          hasKey: false,
          validatedAt: null,
        };
      }
    },
    [backendState, reloadSettings, refreshFinnhubStatus, sidecarPort],
  );

  const value = useMemo(
    () => ({
      status,
      port,
      clientId: settings.clientId,
      connectionType,
      settings,
      updateSettings,
      probe,
      sidecarPort,
      sidecarStatus,
      reloadSettings,
      finnhubStatus,
      finnhubMessage,
      finnhubHasKey,
      validateFinnhubKey,
      dailyiqHasKey,
      ibStatus,
      backendState,
      backendMessage,
      restartBackend,
    }),
    [
      status,
      port,
      settings,
      connectionType,
      updateSettings,
      probe,
      sidecarPort,
      sidecarStatus,
      reloadSettings,
      finnhubStatus,
      finnhubMessage,
      finnhubHasKey,
      validateFinnhubKey,
      dailyiqHasKey,
      ibStatus,
      backendState,
      backendMessage,
      restartBackend,
    ],
  );

  return (
    <TwsContext.Provider value={value}>
      {children}
    </TwsContext.Provider>
  );
}

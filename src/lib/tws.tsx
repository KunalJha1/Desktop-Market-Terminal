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

type SidecarStatus = "connected" | "disconnected";
type FinnhubStatus = "connected" | "disconnected" | "testing";

interface ProbeResult {
  port: number;
  connection_type: TwsConnectionType;
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

  const refreshSidecarPort = useCallback(async () => {
    try {
      const p = await invoke<number | null>("get_sidecar_port");
      if (!p) {
        setSidecarPort(null);
        setSidecarStatus("disconnected");
        return;
      }
      // Verify the sidecar process is actually responding, not just that
      // the port number is stored in Rust state (process may have crashed).
      const res = await fetch(`http://127.0.0.1:${p}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        setSidecarPort(p);
        setSidecarStatus("connected");
      } else {
        setSidecarPort(null);
        setSidecarStatus("disconnected");
      }
    } catch {
      setSidecarPort(null);
      setSidecarStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    refreshSidecarPort();
    const id = setInterval(refreshSidecarPort, 3000);
    return () => clearInterval(id);
  }, [refreshSidecarPort]);

  const refreshFinnhubStatus = useCallback(async () => {
    if (!sidecarPort) {
      setFinnhubStatus("disconnected");
      setFinnhubMessage("Sidecar disconnected");
      setFinnhubHasKey(false);
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
      setFinnhubHasKey(false);
    }
  }, [sidecarPort]);

  useEffect(() => {
    refreshFinnhubStatus();
    if (!sidecarPort) return;
    const id = setInterval(refreshFinnhubStatus, 5000);
    return () => clearInterval(id);
  }, [sidecarPort, refreshFinnhubStatus]);

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
      if (!sidecarPort) {
        return {
          ok: false,
          status: "disconnected",
          message: "Sidecar not connected",
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
    [reloadSettings, refreshFinnhubStatus, sidecarPort],
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
    ],
  );

  return (
    <TwsContext.Provider value={value}>
      {children}
    </TwsContext.Provider>
  );
}

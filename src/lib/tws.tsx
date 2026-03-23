import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
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

interface ProbeResult {
  port: number;
  connection_type: TwsConnectionType;
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
}

const TwsContext = createContext<TwsContextValue | null>(null);

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
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const initialized = useRef(false);

  const [sidecarPort, setSidecarPort] = useState<number | null>(null);
  const [sidecarStatus, setSidecarStatus] =
    useState<SidecarStatus>("disconnected");

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
    loadTwsSettings().then((loaded) => {
      setSettings(loaded);
      settingsRef.current = loaded;
      probe();
    });
  }, [probe]);

  const refreshSidecarPort = useCallback(async () => {
    try {
      const p = await invoke<number | null>("get_sidecar_port");
      setSidecarPort(p ?? null);
      setSidecarStatus(p ? "connected" : "disconnected");
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

  return (
    <TwsContext.Provider
      value={{
        status,
        port,
        clientId: settings.clientId,
        connectionType,
        settings,
        updateSettings,
        probe,
        sidecarPort,
        sidecarStatus,
      }}
    >
      {children}
    </TwsContext.Provider>
  );
}

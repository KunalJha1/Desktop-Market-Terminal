import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  readTextFile,
  writeTextFile,
  exists,
  createDir,
} from "@tauri-apps/api/fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/tauri";

export const DEFAULT_WATCHLIST_SYMBOLS = [
  "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
];

const WATCHLIST_FILENAME = "watchlist.json";
const SAVE_DEBOUNCE_MS = 800;
const LS_KEY = "dailyiq-watchlist-symbols";

function readLocalStorageSymbols(): string[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* ignore */ }
  return null;
}

interface WatchlistContextValue {
  symbols: string[];
  setSymbols: (symbols: string[]) => void;
  addSymbol: (symbol: string) => void;
  removeSymbol: (symbol: string) => void;
  replaceSymbol: (oldSymbol: string, newSymbol: string) => void;
  insertSymbolAt: (index: number, symbol: string) => void;
  ready: boolean;
  flushSave: () => Promise<void>;
}

const WatchlistContext = createContext<WatchlistContextValue>({
  symbols: [],
  setSymbols: () => {},
  addSymbol: () => {},
  removeSymbol: () => {},
  replaceSymbol: () => {},
  insertSymbolAt: () => {},
  ready: false,
  flushSave: async () => {},
});

// ── API helpers ──────────────────────────────────────────────────────

async function getSidecarPort(): Promise<number | null> {
  try {
    return await invoke<number | null>("get_sidecar_port");
  } catch {
    return null;
  }
}

async function apiLoadSymbols(): Promise<string[] | null> {
  try {
    const port = await getSidecarPort();
    if (!port) return null;
    const res = await fetch(`http://127.0.0.1:${port}/watchlist`);
    if (!res.ok) return null;
    const data = await res.json() as { symbols: string[] };
    if (Array.isArray(data.symbols)) return data.symbols;
    return null;
  } catch {
    return null;
  }
}

async function apiSaveSymbols(symbols: string[], port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/watchlist`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── File-based fallback ──────────────────────────────────────────────

async function fileLoadSymbols(): Promise<string[] | null> {
  try {
    const dir = await appDataDir();
    const filePath = await join(dir, WATCHLIST_FILENAME);
    if (await exists(filePath)) {
      const raw = await readTextFile(filePath);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // First run or corrupted file
  }
  return null;
}

async function fileSaveSymbols(syms: string[]) {
  try {
    const dir = await appDataDir();
    if (!(await exists(dir))) {
      await createDir(dir, { recursive: true });
    }
    const filePath = await join(dir, WATCHLIST_FILENAME);
    await writeTextFile(filePath, JSON.stringify(syms, null, 2));
  } catch {
    // Silently fail in browser dev mode
  }
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [symbols, setSymbolsState] = useState<string[]>(
    () => readLocalStorageSymbols() ?? DEFAULT_WATCHLIST_SYMBOLS,
  );
  const ready = true;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symbolsRef = useRef(symbols);
  const sidecarPortRef = useRef<number | null>(null);
  symbolsRef.current = symbols;

  async function saveToDisk(syms: string[]) {
    // Always resolve a fresh port — the Tauri-managed sidecar may restart on a new port.
    const port = await getSidecarPort();
    sidecarPortRef.current = port;
    if (port) {
      const ok = await apiSaveSymbols(syms, port);
      if (ok) return;
    }
    await fileSaveSymbols(syms);
  }

  function scheduleSave() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(symbolsRef.current)); } catch { /* ignore */ }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveToDisk(symbolsRef.current);
    }, SAVE_DEBOUNCE_MS);
  }

  // Load persisted watchlist in the background (non-blocking).
  // Start with file fallback (instant), then upgrade from API when sidecar is up.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Try the instant local file first
      const fileBased = await fileLoadSymbols();
      if (!cancelled && fileBased && fileBased.length > 0) {
        setSymbolsState(fileBased);
        try { localStorage.setItem(LS_KEY, JSON.stringify(fileBased)); } catch { /* ignore */ }
      }

      // Resolve sidecar port and try API (may take a moment if sidecar is booting)
      const port = await getSidecarPort();
      sidecarPortRef.current = port;
      if (port && !cancelled) {
        const apiBased = await apiLoadSymbols();
        if (!cancelled && apiBased && apiBased.length > 0) {
          setSymbolsState(apiBased);
          try { localStorage.setItem(LS_KEY, JSON.stringify(apiBased)); } catch { /* ignore */ }
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Schedule save on change (skip initial)
  const initialRef = useRef(true);
  useEffect(() => {
    if (initialRef.current) {
      initialRef.current = false;
      return;
    }
    scheduleSave();
  }, [symbols]);

  const setSymbols = useCallback((syms: string[]) => {
    setSymbolsState(syms);
  }, []);

  const addSymbol = useCallback((symbol: string) => {
    setSymbolsState((prev) => {
      if (!symbol) return prev;
      if (prev.includes(symbol)) return prev;
      const firstEmpty = prev.findIndex((s) => s.trim() === "");
      if (firstEmpty !== -1) {
        const next = [...prev];
        next[firstEmpty] = symbol;
        return next;
      }
      return [...prev, symbol];
    });
  }, []);

  const removeSymbol = useCallback((symbol: string) => {
    setSymbolsState((prev) => prev.filter((s) => s !== symbol));
  }, []);

  const replaceSymbol = useCallback((oldSymbol: string, newSymbol: string) => {
    setSymbolsState((prev) =>
      prev.map((s) => (s === oldSymbol ? newSymbol : s)),
    );
  }, []);

  const insertSymbolAt = useCallback((index: number, symbol: string) => {
    setSymbolsState((prev) => {
      if (symbol && prev.includes(symbol)) return prev;
      const next = [...prev];
      next.splice(index, 0, symbol);
      return next;
    });
  }, []);

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await saveToDisk(symbolsRef.current);
  }, []);

  return (
    <WatchlistContext.Provider
      value={{
        symbols,
        setSymbols,
        addSymbol,
        removeSymbol,
        replaceSymbol,
        insertSymbolAt,
        ready,
        flushSave,
      }}
    >
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  return useContext(WatchlistContext);
}

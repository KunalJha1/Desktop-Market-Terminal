import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { useLayout } from "./layout";
import {
  readAllDetachedTabInfo,
  readAllReattachRequests,
  isReattachRequestKey,
  readReattachRequest,
  removeDetachedTabInfo,
  removeReattachRequest,
  writeDetachedTabInfo,
  type DetachedTabInfo,
} from "./detached";

export type TabType =
  | "dashboard"
  | "screener"
  | "chart"
  | "options"
  | "backtest"
  | "simulations"
  | "heatmap"
  | "bias";

export interface Tab {
  id: string;
  title: string;
  type: TabType;
}

const DETACHABLE_TYPES: ReadonlySet<TabType> = new Set([
  "chart",
  "heatmap",
  "screener",
]);

/** All available tab presets — shown in the "+" menu */
export const tabPresets: { type: TabType; title: string }[] = [
  { type: "dashboard", title: "Dashboard" },
  { type: "screener", title: "Screener" },
  { type: "chart", title: "Charting" },
  { type: "options", title: "Options Analysis" },
  { type: "backtest", title: "Backtesting" },
  { type: "simulations", title: "Simulations" },
  { type: "heatmap", title: "Heatmap" },
  { type: "bias", title: "Market Bias" },
];

interface TabContextValue {
  tabs: Tab[];
  allTabs: Tab[];
  activeTabId: string;
  ready: boolean;
  setActiveTab: (id: string) => void;
  addTab: (type: TabType) => void;
  closeTab: (id: string) => void;
  /** Remove a tab and return it. If it's the last tab, a default replacement is added. */
  detachTab: (id: string, info: DetachedTabInfo) => Tab | null;
  reattachTab: (info: DetachedTabInfo) => void;
  canDetachTab: (id: string) => boolean;
  getDetachedTabByLabel: (label: string) => DetachedTabInfo | null;
  renameTab: (id: string, title: string) => void;
  duplicateTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  flushSave: () => Promise<void>;
}

function makeTab(type: TabType): Tab {
  const preset = tabPresets.find((p) => p.type === type)!;
  return { id: crypto.randomUUID(), title: preset.title, type };
}

const fallbackTabs: Tab[] = tabPresets.map((p) => makeTab(p.type));

const TabContext = createContext<TabContextValue>({
  tabs: fallbackTabs,
  allTabs: fallbackTabs,
  activeTabId: fallbackTabs[0].id,
  ready: false,
  setActiveTab: () => {},
  addTab: () => {},
  closeTab: () => {},
  detachTab: () => null,
  reattachTab: () => {},
  canDetachTab: () => false,
  getDetachedTabByLabel: () => null,
  renameTab: () => {},
  duplicateTab: () => {},
  reorderTabs: () => {},
  flushSave: async () => {},
});

export function TabProvider({ children }: { children: ReactNode }) {
  const { workspace, syncTabs } = useLayout();

  // Initialize from workspace if available, otherwise fallback
  const initialTabs: Tab[] = workspace?.tabs.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
  })) ?? fallbackTabs;

  const initialActiveId = workspace?.global.activeTabId ?? initialTabs[0].id;

  const [tabs, setTabs] = useState<Tab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialActiveId);
  const [ready, setReady] = useState(false);
  const detachedTabsRef = useRef<Map<string, DetachedTabInfo>>(new Map());

  // Mark ready after first render
  useEffect(() => { setReady(true); }, []);

  // flushSave — tabs are synced via layout, so just ensure layout saves
  const flushSave = useCallback(async () => {
    // Tab state is persisted through layout.syncTabs — nothing extra needed
  }, []);

  // Track whether we've done the initial sync to avoid syncing on mount
  const initialSyncDone = useRef(false);
  const lastKnownWorkspaceRef = useRef(workspace?.lastModified);

  // Detect when workspace is replaced externally (e.g. loaded from file)
  useEffect(() => {
    if (!workspace) return;
    if (workspace.lastModified !== lastKnownWorkspaceRef.current) {
      lastKnownWorkspaceRef.current = workspace.lastModified;
      const newTabs = workspace.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
      }));
      setTabs(newTabs);
      setActiveTabId(workspace.global.activeTabId);
      // Reset sync guard so the set above doesn't trigger a sync-back
      initialSyncDone.current = false;
    }
  }, [workspace]);

  // Sync tab changes back to workspace
  useEffect(() => {
    if (!initialSyncDone.current) {
      initialSyncDone.current = true;
      return;
    }
    syncTabs(tabs, activeTabId);
  }, [tabs, activeTabId, syncTabs]);

  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  useEffect(() => {
    const initialDetached = new Map<string, DetachedTabInfo>();
    for (const info of readAllDetachedTabInfo()) {
      initialDetached.set(info.windowLabel, info);
    }
    detachedTabsRef.current = initialDetached;
  }, []);

  const insertTabAtIndex = useCallback((prev: Tab[], tab: Tab, index: number) => {
    const next = prev.filter((existing) => existing.id !== tab.id);
    const boundedIndex = Math.max(0, Math.min(index, next.length));
    next.splice(boundedIndex, 0, tab);
    return next;
  }, []);

  const addTab = useCallback((type: TabType) => {
    const newTab = makeTab(type);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev;
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        if (id === activeTabId) {
          const newActive = next[Math.min(idx, next.length - 1)];
          setActiveTabId(newActive.id);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const detachTab = useCallback(
    (id: string, info: DetachedTabInfo): Tab | null => {
      writeDetachedTabInfo(info);
      detachedTabsRef.current.set(info.windowLabel, info);
      let detached: Tab | null = null;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        detached = prev[idx];
        const next = prev.filter((t) => t.id !== id);
        // If we just removed the last tab, add a replacement so the main window stays usable
        if (next.length === 0) {
          const replacement = makeTab("chart");
          setActiveTabId(replacement.id);
          return [replacement];
        }
        if (id === activeTabId) {
          const newActive = next[Math.min(idx, next.length - 1)];
          setActiveTabId(newActive.id);
        }
        return next;
      });
      return detached;
    },
    [activeTabId],
  );

  const reattachTab = useCallback((info: DetachedTabInfo) => {
    detachedTabsRef.current.delete(info.windowLabel);
    removeDetachedTabInfo(info.windowLabel);
    setTabs((prev) => {
      if (prev.some((tab) => tab.id === info.tabId)) return prev;
      const tab: Tab = {
        id: info.tabId,
        title: info.title,
        type: info.tabType,
      };
      return insertTabAtIndex(prev, tab, info.originalIndex);
    });
    setActiveTabId(info.tabId);
  }, [insertTabAtIndex]);

  const processPendingReattachRequests = useCallback(() => {
    for (const { key, info } of readAllReattachRequests()) {
      reattachTab(info);
      removeReattachRequest(key);
    }
  }, [reattachTab]);

  useEffect(() => {
    processPendingReattachRequests();

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !isReattachRequestKey(event.key) || !event.newValue) return;
      const info = readReattachRequest(event.key);
      if (!info) {
        removeReattachRequest(event.key);
        return;
      }
      reattachTab(info);
      removeReattachRequest(event.key);
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [processPendingReattachRequests, reattachTab]);

  const canDetachTab = useCallback((id: string) => {
    const tab = tabs.find((item) => item.id === id);
    return tab ? DETACHABLE_TYPES.has(tab.type) : false;
  }, [tabs]);

  const getDetachedTabByLabel = useCallback((label: string) => {
    return detachedTabsRef.current.get(label) ?? null;
  }, []);

  const renameTab = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
    );
  }, []);

  const duplicateTab = useCallback(
    (id: string) => {
      const source = tabs.find((t) => t.id === id);
      if (!source) return;
      const newTab: Tab = {
        id: crypto.randomUUID(),
        title: source.title,
        type: source.type,
      };
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        const next = [...prev];
        next.splice(idx + 1, 0, newTab);
        return next;
      });
      setActiveTabId(newTab.id);
    },
    [tabs],
  );

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const visibleTabs = useMemo(() => tabs, [tabs]);

  return (
    <TabContext.Provider
      value={{
        tabs: visibleTabs,
        allTabs: tabs,
        activeTabId,
        ready,
        setActiveTab,
        addTab,
        closeTab,
        detachTab,
        reattachTab,
        canDetachTab,
        getDetachedTabByLabel,
        renameTab,
        duplicateTab,
        reorderTabs,
        flushSave,
      }}
    >
      {children}
    </TabContext.Provider>
  );
}

export function useTabs() {
  return useContext(TabContext);
}

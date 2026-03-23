import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { appWindow } from "@tauri-apps/api/window";
import type { WorkspaceFile, TabState, TabLayout, LayoutComponent } from "./layout-types";
import {
  loadWorkspace,
  saveWorkspace,
  getDefaultWorkspace,
  pickWorkspaceFile,
  loadWorkspaceFromPath,
  saveWorkspaceToLocalStorage,
} from "./layout-storage";

interface LayoutContextValue {
  workspace: WorkspaceFile | null;
  ready: boolean;
  getTabState: (tabId: string) => TabState | undefined;
  setTabLocked: (tabId: string, locked: boolean) => void;
  setTabZoom: (tabId: string, zoom: number) => void;
  setTabLinkChannel: (tabId: string, channel: number | null) => void;
  updateTabLayout: (tabId: string, layout: TabLayout) => void;
  /** Add a component to a tab — inherits the tab's link channel by default */
  addComponent: (tabId: string, type: string, overrides?: Partial<LayoutComponent>) => void;
  /** Remove a component from a tab */
  removeComponent: (tabId: string, componentId: string) => void;
  /** Update a component's position/size */
  updateComponent: (tabId: string, componentId: string, updates: Partial<LayoutComponent>) => void;
  /** Change a single component's link channel */
  setComponentLinkChannel: (tabId: string, componentId: string, channel: number | null) => void;
  /** Sync full tab list from TabProvider into workspace */
  syncTabs: (
    tabs: { id: string; title: string; type: string }[],
    activeTabId: string,
  ) => void;
  /** Open file picker to load a different .diq workspace */
  loadFromFile: () => Promise<boolean>;
  flushSave: () => Promise<void>;
}

const LayoutContext = createContext<LayoutContextValue>({
  workspace: null,
  ready: false,
  getTabState: () => undefined,
  setTabLocked: () => {},
  setTabZoom: () => {},
  setTabLinkChannel: () => {},
  updateTabLayout: () => {},
  addComponent: () => {},
  removeComponent: () => {},
  updateComponent: () => {},
  setComponentLinkChannel: () => {},
  syncTabs: () => {},
  loadFromFile: async () => false,
  flushSave: async () => {},
});

const DEBOUNCE_MS = 2000;

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceFile | null>(null);
  const [ready, setReady] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRef = useRef<WorkspaceFile | null>(null);

  // Keep ref in sync for flush-on-close
  workspaceRef.current = workspace;

  // Load workspace on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadWorkspace();
      if (cancelled) return;
      let ws = loaded ?? getDefaultWorkspace();

      // Normalize: any tab or component with null linkChannel defaults to Link 1
      ws = {
        ...ws,
        tabs: ws.tabs.map((t) => ({
          ...t,
          linkChannel: t.linkChannel ?? 1,
          layout: {
            ...t.layout,
            components: t.layout.components.map((c) => ({
              ...c,
              linkChannel: c.linkChannel ?? 1,
            })),
          },
        })),
      };

      setWorkspace(ws);
      setReady(true);
      saveWorkspaceToLocalStorage(ws);

      // Write defaults on first launch
      if (!loaded) {
        await saveWorkspace(ws);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Flush save on window close
  useEffect(() => {
    const unlisten = appWindow.onCloseRequested(async () => {
      if (workspaceRef.current) {
        await saveWorkspace(workspaceRef.current);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const scheduleSave = useCallback((ws: WorkspaceFile) => {
    // Always mirror to localStorage immediately to survive hot reloads.
    saveWorkspaceToLocalStorage(ws);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveWorkspace(ws);
    }, DEBOUNCE_MS);
  }, []);

  const updateWorkspace = useCallback(
    (updater: (prev: WorkspaceFile) => WorkspaceFile) => {
      setWorkspace((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const getTabState = useCallback(
    (tabId: string) => workspace?.tabs.find((t) => t.id === tabId),
    [workspace],
  );

  const setTabLocked = useCallback(
    (tabId: string, locked: boolean) => {
      updateWorkspace((ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) => (t.id === tabId ? { ...t, locked } : t)),
      }));
    },
    [updateWorkspace],
  );

  const setTabZoom = useCallback(
    (tabId: string, zoom: number) => {
      updateWorkspace((ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) =>
          t.id === tabId
            ? { ...t, layout: { ...t.layout, zoom } }
            : t,
        ),
      }));
    },
    [updateWorkspace],
  );

  const setTabLinkChannel = useCallback(
    (tabId: string, channel: number | null) => {
      updateWorkspace((ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) =>
          t.id === tabId ? { ...t, linkChannel: channel } : t,
        ),
      }));
    },
    [updateWorkspace],
  );

  const updateTabLayout = useCallback(
    (tabId: string, layout: TabLayout) => {
      updateWorkspace((ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) => (t.id === tabId ? { ...t, layout } : t)),
      }));
    },
    [updateWorkspace],
  );

  const addComponent = useCallback(
    (tabId: string, type: string, overrides?: Partial<LayoutComponent>) => {
      updateWorkspace((ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) => {
          if (t.id !== tabId) return t;
          const component: LayoutComponent = {
            id: crypto.randomUUID(),
            type,
            x: 0,
            y: 0,
            w: 4,
            h: 4,
            linkChannel: t.linkChannel,
            config: {},
            ...overrides,
          };
          return {
            ...t,
            layout: {
              ...t.layout,
              components: [...t.layout.components, component],
            },
          };
        }),
      }));
    },
    [updateWorkspace],
  );

  const removeComponent = useCallback(
    (tabId: string, componentId: string) => {
      updateWorkspace((ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) => {
          if (t.id !== tabId) return t;
          return {
            ...t,
            layout: {
              ...t.layout,
              components: t.layout.components.filter((c) => c.id !== componentId),
            },
          };
        }),
      }));
    },
    [updateWorkspace],
  );

  const updateComponent = useCallback(
    (tabId: string, componentId: string, updates: Partial<LayoutComponent>) => {
      updateWorkspace((ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) => {
          if (t.id !== tabId) return t;
          return {
            ...t,
            layout: {
              ...t.layout,
              components: t.layout.components.map((c) =>
                c.id === componentId ? { ...c, ...updates } : c,
              ),
            },
          };
        }),
      }));
    },
    [updateWorkspace],
  );

  const setComponentLinkChannel = useCallback(
    (tabId: string, componentId: string, channel: number | null) => {
      updateWorkspace((ws) => ({
        ...ws,
        tabs: ws.tabs.map((t) => {
          if (t.id !== tabId) return t;
          return {
            ...t,
            layout: {
              ...t.layout,
              components: t.layout.components.map((c) =>
                c.id === componentId ? { ...c, linkChannel: channel } : c,
              ),
            },
          };
        }),
      }));
    },
    [updateWorkspace],
  );

  const syncTabs = useCallback(
    (
      tabs: { id: string; title: string; type: string }[],
      activeTabId: string,
    ) => {
      updateWorkspace((ws) => {
        const existingMap = new Map(ws.tabs.map((t) => [t.id, t]));
        const newTabs = tabs.map((t) => {
          const existing = existingMap.get(t.id);
          if (existing) {
            return { ...existing, title: t.title, type: t.type as TabState["type"] };
          }
          return {
            id: t.id,
            title: t.title,
            type: t.type as TabState["type"],
            locked: true,
            linkChannel: null,
            layout: { columns: 12, rowHeight: 40, zoom: 0.9, components: [] },
          };
        });
        return {
          ...ws,
          global: { ...ws.global, activeTabId },
          tabs: newTabs,
        };
      });
    },
    [updateWorkspace],
  );

  const loadFromFile = useCallback(async (): Promise<boolean> => {
    const filePath = await pickWorkspaceFile();
    if (!filePath) return false;

    const loaded = await loadWorkspaceFromPath(filePath);
    if (!loaded) return false;

    setWorkspace(loaded);
    saveWorkspaceToLocalStorage(loaded);
    // Also persist as the current workspace
    await saveWorkspace(loaded);
    return true;
  }, []);

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (workspaceRef.current) {
      saveWorkspaceToLocalStorage(workspaceRef.current);
      await saveWorkspace(workspaceRef.current);
    }
  }, []);

  return (
    <LayoutContext.Provider
      value={{
        workspace,
        ready,
        getTabState,
        setTabLocked,
        setTabZoom,
        setTabLinkChannel,
        updateTabLayout,
        addComponent,
        removeComponent,
        updateComponent,
        setComponentLinkChannel,
        syncTabs,
        loadFromFile,
        flushSave,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  return useContext(LayoutContext);
}

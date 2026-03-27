import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { X, Plus } from "lucide-react";
import { useTabs, tabPresets, type TabType } from "../lib/tabs";
import TabContextMenu from "./TabContextMenu";
import { invoke } from "@tauri-apps/api/tauri";
import { isTauriRuntime } from "../lib/platform";
import { removeDetachedTabInfo, writeDetachedTabInfo } from "../lib/detached";
import { loadChartState } from "../lib/chart-state";

const DRAG_START_DISTANCE = 6;
const TEAR_OFF_DISTANCE = 70;

type DragPhase = "idle" | "reorder" | "tearoff-ready";

interface DragPreviewState {
  title: string;
  x: number;
  y: number;
  detachable: boolean;
  phase: DragPhase;
}

export default function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    addTab,
    closeTab,
    detachTab,
    canDetachTab,
    renameTab,
    duplicateTab,
    reorderTabs,
  } = useTabs();

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const bodyUserSelectRef = useRef("");
  const bodyCursorRef = useRef("");
  const pointerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    index: number;
    active: boolean;
    sourceEl: HTMLDivElement;
    detachable: boolean;
    tearOffReady: boolean;
    title: string;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const tearingOffRef = useRef(false);

  const [menu, setMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addPos, setAddPos] = useState<{ x: number; y: number } | null>(null);
  const addRef = useRef<HTMLDivElement>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const restoreDocumentDragState = useCallback(() => {
    document.body.style.userSelect = bodyUserSelectRef.current;
    document.body.style.cursor = bodyCursorRef.current;
  }, []);

  const resetDragState = useCallback(() => {
    const drag = pointerDragRef.current;
    if (drag) {
      try {
        if (drag.sourceEl.hasPointerCapture(drag.pointerId)) {
          drag.sourceEl.releasePointerCapture(drag.pointerId);
        }
      } catch {
        // Ignore pointer capture failures.
      }
    }

    pointerDragRef.current = null;
    setDragIndex(null);
    dragOverIndexRef.current = null;
    setDragOverIndex(null);
    setDragPreview(null);
    restoreDocumentDragState();
  }, [restoreDocumentDragState]);

  useEffect(() => {
    return () => {
      resetDragState();
    };
  }, [resetDragState]);

  useEffect(() => {
    if (!showAdd) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        addRef.current && !addRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setShowAdd(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAdd(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showAdd]);

  const getTabIndexFromPoint = useCallback((clientX: number, clientY: number) => {
    const tabList = tabListRef.current;
    if (!tabList) return null;

    const pointedTab = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-tab-id]");

    if (pointedTab) {
      const pointedId = pointedTab.dataset.tabId;
      const pointedIndex = tabs.findIndex((tab) => tab.id === pointedId);
      if (pointedIndex >= 0) return pointedIndex;
    }

    const tabElements = Array.from(
      tabList.querySelectorAll<HTMLElement>("[data-tab-id]"),
    );
    if (!tabElements.length) return null;

    const firstRect = tabElements[0].getBoundingClientRect();
    const lastRect = tabElements[tabElements.length - 1].getBoundingClientRect();

    if (clientX < firstRect.left) return 0;
    if (clientX > lastRect.right) return tabElements.length - 1;

    const nearest = tabElements.reduce(
      (best, element, index) => {
        const rect = element.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const distance = Math.abs(clientX - center);
        return distance < best.distance ? { index, distance } : best;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    );

    return nearest.index;
  }, [tabs]);

  const triggerTearOff = useCallback(async (tabIndex: number, screenX: number, screenY: number) => {
    if (tearingOffRef.current) return;
    tearingOffRef.current = true;

    const tab = tabs[tabIndex];
    if (!tab || !canDetachTab(tab.id)) {
      tearingOffRef.current = false;
      return;
    }

    const label = `detached-${tab.id}`;
    const chartStateJson =
      tab.type === "chart"
        ? JSON.stringify(loadChartState(tab.id))
        : null;
    const detachedInfo = {
      tabId: tab.id,
      tabType: tab.type,
      title: tab.title,
      windowLabel: label,
      originalIndex: tabIndex,
      chartStateJson,
    } as const;
    writeDetachedTabInfo(detachedInfo);

    let spawned = false;
    try {
      console.info("[detach] spawning detached tab window", detachedInfo);
      await invoke("spawn_tab_window", {
        label,
        title: tab.title,
        tabId: tab.id,
        tabType: tab.type,
        originalIndex: tabIndex,
        chartStateJson,
        x: screenX - 200,
        y: screenY - 16,
        width: 1200,
        height: 800,
      });
      console.info("[detach] detached tab window created", detachedInfo);
      spawned = true;
    } catch (err) {
      console.error("spawn_tab_window failed", err);
    }

    if (spawned) {
      detachTab(tab.id, detachedInfo);
    } else {
      removeDetachedTabInfo(label);
    }
    tearingOffRef.current = false;
  }, [tabs, canDetachTab, detachTab]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (tearingOffRef.current) return;

      const deltaX = e.clientX - drag.startX;
      const deltaY = e.clientY - drag.startY;
      if (!drag.active && Math.hypot(deltaX, deltaY) < DRAG_START_DISTANCE) return;

      if (!drag.active) {
        drag.active = true;
        suppressClickRef.current = true;
        setDragIndex(drag.index);
        dragOverIndexRef.current = drag.index;
        setDragOverIndex(drag.index);
      }

      const tabStripRect = tabListRef.current?.getBoundingClientRect() ?? null;
      const pointerBelowStrip = tabStripRect
        ? e.clientY > tabStripRect.bottom
        : false;
      const tearOffReady =
        isTauriRuntime() &&
        drag.detachable &&
        pointerBelowStrip &&
        tabStripRect !== null &&
        e.clientY - tabStripRect.bottom >= TEAR_OFF_DISTANCE;
      drag.tearOffReady = tearOffReady;

      setDragPreview({
        title: drag.title,
        x: e.clientX,
        y: e.clientY,
        detachable: drag.detachable,
        phase: tearOffReady ? "tearoff-ready" : "reorder",
      });

      if (!tearOffReady) {
        const hoveredIndex = getTabIndexFromPoint(e.clientX, e.clientY);
        if (hoveredIndex !== null) {
          dragOverIndexRef.current = hoveredIndex;
          setDragOverIndex(hoveredIndex);
        }
      }
    };

    const handlePointerEnd = (e: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      const shouldTearOff = drag.active && drag.tearOffReady;
      const fromIndex = drag.index;
      const toIndex = dragOverIndexRef.current;
      const screenX = e.screenX;
      const screenY = e.screenY;

      resetDragState();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      if (shouldTearOff) {
        void triggerTearOff(fromIndex, screenX, screenY);
        return;
      }

      if (drag.active && toIndex !== null && fromIndex !== toIndex) {
        reorderTabs(fromIndex, toIndex);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [getTabIndexFromPoint, reorderTabs, resetDragState, triggerTearOff]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, index: number, title: string, detachable: boolean) => {
      if (e.button !== 0 || renamingId) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, input")) return;

      e.preventDefault();
      bodyUserSelectRef.current = document.body.style.userSelect;
      bodyCursorRef.current = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = detachable ? "grabbing" : "grabbing";

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture failures.
      }

      pointerDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        index,
        active: false,
        sourceEl: e.currentTarget,
        detachable,
        tearOffReady: false,
        title,
      };
    },
    [renamingId],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault();
      setMenu({ tabId, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const startRename = useCallback((tabId: string) => {
    setRenamingId(tabId);
    setMenu(null);
    requestAnimationFrame(() => renameRef.current?.select());
  }, []);

  const commitRename = useCallback(
    (tabId: string, value: string) => {
      renameTab(tabId, value);
      setRenamingId(null);
    },
    [renameTab],
  );

  const handleAddTab = useCallback(
    (type: TabType) => {
      addTab(type);
      setShowAdd(false);
    },
    [addTab],
  );

  const handleOpenTestWindow = useCallback(async () => {
    setShowAdd(false);
    if (!isTauriRuntime()) return;

    try {
      await invoke("spawn_test_window", {
        label: `test-window-${Date.now()}`,
        title: "DailyIQ Test Window",
        x: 180,
        y: 140,
        width: 720,
        height: 520,
      });
    } catch (err) {
      console.error("spawn_test_window failed", err);
    }
  }, []);

  return (
    <div className="relative flex h-8 shrink-0 items-end border-b border-white/[0.06] bg-base select-none">
      <div
        ref={tabListRef}
        className="flex h-full items-stretch overflow-x-auto select-none"
        style={{ touchAction: "none" }}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDragOver = dragOverIndex === index;
          const isDragging = dragIndex === index;
          const detachable = canDetachTab(tab.id);
          const previewPhase = isDragging ? dragPreview?.phase ?? "reorder" : "idle";

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onPointerDown={(e) => handlePointerDown(e, index, tab.title, detachable)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              onClick={() => {
                if (suppressClickRef.current) return;
                setActiveTab(tab.id);
              }}
              className={`group relative flex h-full items-center gap-1.5 border-r border-white/[0.04] px-3 transition-[colors,opacity,transform,border-color] duration-100 select-none ${
                isActive
                  ? "bg-panel text-white/80"
                  : "text-white/35 hover:bg-white/[0.03] hover:text-white/55"
              } ${detachable ? "cursor-grab" : "cursor-pointer"} ${
                isDragOver && !isDragging ? "border-l-2 border-l-blue" : ""
              } ${
                isDragging ? "scale-[0.985] opacity-35" : ""
              } ${
                previewPhase === "tearoff-ready" ? "border-blue/40 bg-blue/[0.06]" : ""
              }`}
              style={{ minWidth: 80, maxWidth: 160, touchAction: "none" }}
            >
              {isActive && (
                <div className="absolute inset-x-0 top-0 h-[1px] bg-blue" />
              )}

              {detachable && renamingId !== tab.id ? (
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                    previewPhase === "tearoff-ready" ? "bg-blue" : "bg-white/18 group-hover:bg-blue/65"
                  }`}
                  title="Drag downward to open in a child window"
                />
              ) : null}

              {renamingId === tab.id ? (
                <input
                  ref={renameRef}
                  defaultValue={tab.title}
                  className="w-full bg-transparent text-[11px] text-white/80 outline-none"
                  onBlur={(e) => commitRename(tab.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(tab.id, e.currentTarget.value);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate text-[11px]">{tab.title}</span>
              )}

              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className={`ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors duration-75 ${
                    isActive
                      ? "text-white/25 hover:bg-white/[0.08] hover:text-white/60"
                      : "text-transparent group-hover:text-white/20 group-hover:hover:bg-white/[0.08] group-hover:hover:text-white/60"
                  }`}
                >
                  <X className="h-2.5 w-2.5" strokeWidth={1.5} />
                </button>
              )}
            </div>
          );
        })}

        <div ref={addRef}>
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setAddPos({ x: rect.left, y: rect.bottom + 4 });
              setShowAdd((v) => !v);
            }}
            className="flex h-full w-8 items-center justify-center text-white/20 transition-colors duration-75 hover:text-white/50"
          >
            <Plus className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {dragPreview ? (
        <div
          className="pointer-events-none fixed z-[140] -translate-x-1/2 -translate-y-1/2"
          style={{ left: dragPreview.x, top: dragPreview.y }}
        >
          <div
            className={`min-w-[132px] max-w-[220px] rounded-md border px-3 py-2 shadow-2xl backdrop-blur-sm transition-colors ${
              dragPreview.phase === "tearoff-ready"
                ? "border-blue/55 bg-[#102136]/95 text-blue"
                : "border-white/[0.10] bg-[#161C24]/92 text-white/80"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  dragPreview.phase === "tearoff-ready"
                    ? "bg-blue"
                    : dragPreview.detachable
                      ? "bg-white/40"
                      : "bg-white/20"
                }`}
              />
              <span className="truncate text-[11px]">{dragPreview.title}</span>
            </div>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/42">
              {dragPreview.phase === "tearoff-ready"
                ? "Release to detach"
                : dragPreview.detachable
                  ? "Drag down to detach"
                  : "Drag to reorder"}
            </p>
          </div>
        </div>
      ) : null}

      {showAdd && addPos && (
        <div
          ref={dropdownRef}
          className="fixed z-[100] min-w-[160px] rounded-md border border-white/[0.08] bg-[#1C2128] py-1 shadow-xl shadow-black/40"
          style={{ left: addPos.x, top: addPos.y }}
        >
          {tabPresets.map((preset) => (
            <button
              key={preset.type}
              onClick={() => handleAddTab(preset.type)}
              className="block w-full px-3 py-1.5 text-left text-[11px] text-white/60 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/80"
            >
              {preset.title}
            </button>
          ))}
          <div className="mx-2 my-1 h-px bg-white/[0.06]" />
          <button
            onClick={() => { void handleOpenTestWindow(); }}
            className="block w-full px-3 py-1.5 text-left text-[11px] text-blue transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/85"
          >
            Test Window
          </button>
        </div>
      )}

      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          onRename={() => startRename(menu.tabId)}
          onDuplicate={() => {
            duplicateTab(menu.tabId);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

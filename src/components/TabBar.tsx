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
import { writeDetachedTabInfo } from "../lib/detached";

export default function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    addTab,
    closeTab,
    detachTab,
    renameTab,
    duplicateTab,
    reorderTabs,
  } = useTabs();

  // Drag reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    index: number;
    active: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const tearingOffRef = useRef(false);

  // Context menu state
  const [menu, setMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);

  // "+" dropdown state
  const [showAdd, setShowAdd] = useState(false);
  const [addPos, setAddPos] = useState<{ x: number; y: number } | null>(null);
  const addRef = useRef<HTMLDivElement>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  // Close add dropdown on click-outside / Escape
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showAdd) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        addRef.current && !addRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      )
        setShowAdd(false);
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

  const resetDragState = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

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
    if (!tab) { tearingOffRef.current = false; return; }

    const label = `detached-${tab.id}`;
    writeDetachedTabInfo(label, { tabId: tab.id, tabType: tab.type, title: tab.title });

    // Spawn new window so its title bar lands under the cursor
    const width = 1200;
    const height = 800;
    try {
      await invoke("spawn_tab_window", {
        label,
        title: tab.title,
        x: screenX - 200,
        y: screenY - 16,
        width,
        height,
      });
    } catch (err) {
      console.error("spawn_tab_window failed", err);
    }

    detachTab(tab.id);
    tearingOffRef.current = false;
  }, [tabs, detachTab]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (tearingOffRef.current) return;

      const deltaX = e.clientX - drag.startX;
      const deltaY = e.clientY - drag.startY;
      if (!drag.active && Math.hypot(deltaX, deltaY) < 6) return;

      if (!drag.active) {
        drag.active = true;
        suppressClickRef.current = true;
        setDragIndex(drag.index);
        setDragOverIndex(drag.index);
      }

      // Tear-off: dragging a tab >80px downward away from the tab bar pops it out.
      // deltaY is positive when dragging down. The tab bar is ~32px tall so 80px
      // below the drag start puts the cursor clearly into the page content area.
      if (isTauriRuntime() && deltaY > 80) {
        pointerDragRef.current = null;
        resetDragState();
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        triggerTearOff(drag.index, e.screenX, e.screenY);
        return;
      }

      const hoveredIndex = getTabIndexFromPoint(e.clientX, e.clientY);
      if (hoveredIndex !== null) {
        setDragOverIndex(hoveredIndex);
      }
    };

    const handlePointerEnd = (e: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      if (drag.active && dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
        reorderTabs(dragIndex, dragOverIndex);
      }

      pointerDragRef.current = null;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      resetDragState();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [dragIndex, dragOverIndex, getTabIndexFromPoint, reorderTabs, resetDragState, triggerTearOff]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
      if (e.button !== 0 || renamingId) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, input")) return;

      pointerDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        index,
        active: false,
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

  return (
    <div className="flex h-8 shrink-0 items-end border-b border-white/[0.06] bg-base">
      <div ref={tabListRef} className="flex h-full items-stretch overflow-x-auto">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDragOver = dragOverIndex === index;
          const isDragging = dragIndex === index;

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onPointerDown={(e) => handlePointerDown(e, index)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              onClick={() => {
                if (suppressClickRef.current) return;
                setActiveTab(tab.id);
              }}
              className={`group relative flex h-full cursor-pointer items-center gap-1.5 border-r border-white/[0.04] px-3 transition-colors duration-75 ${
                isActive
                  ? "bg-panel text-white/80"
                  : "text-white/35 hover:bg-white/[0.03] hover:text-white/55"
              } ${isDragOver && !isDragging ? "border-l-2 border-l-blue" : ""} ${
                isDragging ? "opacity-60" : ""
              }`}
              style={{ minWidth: 80, maxWidth: 160 }}
            >
              {/* Active tab indicator */}
              {isActive && (
                <div className="absolute inset-x-0 top-0 h-[1px] bg-blue" />
              )}

              {/* Tab title or rename input */}
              {renamingId === tab.id ? (
                <input
                  ref={renameRef}
                  defaultValue={tab.title}
                  className="w-full bg-transparent text-[11px] text-white/80 outline-none"
                  onBlur={(e) => commitRename(tab.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      commitRename(tab.id, e.currentTarget.value);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate text-[11px]">{tab.title}</span>
              )}

              {/* Close button */}
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

        {/* Add tab button */}
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

      {/* Add tab dropdown — rendered fixed to avoid overflow clipping */}
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
        </div>
      )}

      {/* Context menu */}
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

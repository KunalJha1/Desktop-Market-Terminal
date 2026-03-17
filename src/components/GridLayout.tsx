import { useRef, useState, useCallback, type ReactNode } from "react";
import type { LayoutComponent } from "../lib/layout-types";

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface GridLayoutProps {
  columns: number;
  rowHeight: number;
  components: LayoutComponent[];
  locked: boolean;
  onMoveComponent: (id: string, x: number, y: number) => void;
  onResizeComponent: (id: string, w: number, h: number, x?: number, y?: number) => void;
  renderComponent: (comp: LayoutComponent) => ReactNode;
}

const RESIZE_HANDLES: { dir: ResizeDir; cursor: string; className: string }[] = [
  { dir: "n",  cursor: "cursor-n-resize",  className: "top-0 left-2 right-2 h-1.5" },
  { dir: "s",  cursor: "cursor-s-resize",  className: "bottom-0 left-2 right-2 h-1.5" },
  { dir: "e",  cursor: "cursor-e-resize",  className: "right-0 top-2 bottom-2 w-1.5" },
  { dir: "w",  cursor: "cursor-w-resize",  className: "left-0 top-2 bottom-2 w-1.5" },
  { dir: "nw", cursor: "cursor-nw-resize", className: "top-0 left-0 h-2.5 w-2.5" },
  { dir: "ne", cursor: "cursor-ne-resize", className: "top-0 right-0 h-2.5 w-2.5" },
  { dir: "sw", cursor: "cursor-sw-resize", className: "bottom-0 left-0 h-2.5 w-2.5" },
  { dir: "se", cursor: "cursor-se-resize", className: "bottom-0 right-0 h-2.5 w-2.5" },
];

export default function GridLayout({
  columns,
  rowHeight,
  components,
  locked,
  onMoveComponent,
  onResizeComponent,
  renderComponent,
}: GridLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number } | null>(null);

  // Resize state — now tracks x/y/w/h since edges can move position
  const [resizing, setResizing] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Free-form (Ctrl/Cmd drag) state
  const [freeFormActive, setFreeFormActive] = useState(false);

  const getColWidth = useCallback(() => {
    if (!containerRef.current) return 0;
    return containerRef.current.clientWidth / columns;
  }, [columns]);

  // --- Drag handlers ---
  const handleDragStart = useCallback(
    (e: React.MouseEvent, comp: LayoutComponent) => {
      if (locked) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(comp.id);
      setDragPreview({ x: comp.x, y: comp.y });
      setFreeFormActive(e.ctrlKey || e.metaKey);

      const startX = e.clientX;
      const startY = e.clientY;

      const onMove = (ev: MouseEvent) => {
        const colW = getColWidth();
        if (!colW) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const isFreeForm = ev.ctrlKey || ev.metaKey;
        setFreeFormActive(isFreeForm);

        let newX: number, newY: number;
        if (isFreeForm) {
          newX = Math.max(0, Math.min(columns - comp.w, comp.x + dx / colW));
          newY = Math.max(0, comp.y + dy / rowHeight);
        } else {
          newX = Math.max(0, Math.min(columns - comp.w, comp.x + Math.round(dx / colW)));
          newY = Math.max(0, comp.y + Math.round(dy / rowHeight));
        }
        setDragPreview({ x: newX, y: newY });
      };

      const onUp = (ev: MouseEvent) => {
        const colW = getColWidth();
        if (colW) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          const isFreeForm = ev.ctrlKey || ev.metaKey;

          let newX: number, newY: number;
          if (isFreeForm) {
            newX = Math.max(0, Math.min(columns - comp.w, comp.x + dx / colW));
            newY = Math.max(0, comp.y + dy / rowHeight);
          } else {
            newX = Math.max(0, Math.min(columns - comp.w, comp.x + Math.round(dx / colW)));
            newY = Math.max(0, comp.y + Math.round(dy / rowHeight));
          }
          onMoveComponent(comp.id, newX, newY);
        }
        setDragging(null);
        setDragPreview(null);
        setFreeFormActive(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [locked, columns, rowHeight, getColWidth, onMoveComponent],
  );

  // --- Resize handlers (supports all 8 directions) ---
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, comp: LayoutComponent, dir: ResizeDir) => {
      if (locked) return;
      e.preventDefault();
      e.stopPropagation();
      setResizing(comp.id);
      setResizePreview({ x: comp.x, y: comp.y, w: comp.w, h: comp.h });
      setFreeFormActive(e.ctrlKey || e.metaKey);

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;

      const movesLeft = dir.includes("w");
      const movesRight = dir.includes("e");
      const movesTop = dir.includes("n");
      const movesBottom = dir.includes("s");

      const computeNew = (dx: number, dy: number, isFreeForm: boolean) => {
        const colW = getColWidth();
        if (!colW) return { x: comp.x, y: comp.y, w: comp.w, h: comp.h };

        const snapOrRaw = (val: number) => isFreeForm ? val : Math.round(val);

        let newX = comp.x;
        let newY = comp.y;
        let newW = comp.w;
        let newH = comp.h;

        if (movesRight) {
          newW = Math.max(2, Math.min(columns - comp.x, comp.w + snapOrRaw(dx / colW)));
        }
        if (movesLeft) {
          const dCols = snapOrRaw(dx / colW);
          const maxLeftShift = comp.w - 2; // can't shrink below min width of 2
          const clampedD = Math.max(-comp.x, Math.min(maxLeftShift, dCols));
          newX = comp.x + clampedD;
          newW = comp.w - clampedD;
        }
        if (movesBottom) {
          newH = Math.max(3, comp.h + snapOrRaw(dy / rowHeight));
        }
        if (movesTop) {
          const dRows = snapOrRaw(dy / rowHeight);
          const maxTopShift = comp.h - 3; // can't shrink below min height of 3
          const clampedD = Math.max(-comp.y, Math.min(maxTopShift, dRows));
          newY = comp.y + clampedD;
          newH = comp.h - clampedD;
        }

        return { x: newX, y: newY, w: newW, h: newH };
      };

      const onMove = (ev: MouseEvent) => {
        const colW = getColWidth();
        if (!colW) return;
        const dx = ev.clientX - startMouseX;
        const dy = ev.clientY - startMouseY;
        const isFreeForm = ev.ctrlKey || ev.metaKey;
        setFreeFormActive(isFreeForm);
        setResizePreview(computeNew(dx, dy, isFreeForm));
      };

      const onUp = (ev: MouseEvent) => {
        const colW = getColWidth();
        if (colW) {
          const dx = ev.clientX - startMouseX;
          const dy = ev.clientY - startMouseY;
          const isFreeForm = ev.ctrlKey || ev.metaKey;
          const { x, y, w, h } = computeNew(dx, dy, isFreeForm);
          onResizeComponent(comp.id, w, h, x, y);
        }
        setResizing(null);
        setResizePreview(null);
        setFreeFormActive(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [locked, columns, rowHeight, getColWidth, onResizeComponent],
  );

  const maxRow = components.reduce((max, c) => {
    const h = resizing === c.id && resizePreview ? resizePreview.h : c.h;
    const y = resizing === c.id && resizePreview ? resizePreview.y : (dragging === c.id && dragPreview ? dragPreview.y : c.y);
    return Math.max(max, y + h);
  }, 0);
  const minRows = Math.max(maxRow + 2, Math.ceil(400 / rowHeight));

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ minHeight: minRows * rowHeight }}
    >
      {/* Grid lines when unlocked */}
      {!locked && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {/* Column lines */}
          {Array.from({ length: columns + 1 }, (_, i) => (
            <div
              key={`col-${i}`}
              className="absolute top-0 h-full"
              style={{
                left: `${(i / columns) * 100}%`,
                width: 1,
                background:
                  i === 0 || i === columns
                    ? "transparent"
                    : "rgba(255,255,255,0.03)",
              }}
            />
          ))}
          {/* Row lines */}
          {Array.from({ length: minRows + 1 }, (_, i) => (
            <div
              key={`row-${i}`}
              className="absolute left-0 w-full"
              style={{
                top: i * rowHeight,
                height: 1,
                background: i === 0 ? "transparent" : "rgba(255,255,255,0.03)",
              }}
            />
          ))}
        </div>
      )}

      {/* Components */}
      {components.map((comp) => {
        const isDragging = dragging === comp.id;
        const isResizing = resizing === comp.id;
        const posX = isResizing && resizePreview ? resizePreview.x : (isDragging && dragPreview ? dragPreview.x : comp.x);
        const posY = isResizing && resizePreview ? resizePreview.y : (isDragging && dragPreview ? dragPreview.y : comp.y);
        const w = isResizing && resizePreview ? resizePreview.w : comp.w;
        const h = isResizing && resizePreview ? resizePreview.h : comp.h;

        return (
          <div
            key={comp.id}
            className={`absolute ${isDragging || isResizing ? "z-50" : "z-10"} ${
              isDragging ? "opacity-80" : ""
            }`}
            style={{
              left: `${(posX / columns) * 100}%`,
              top: posY * rowHeight,
              width: `${(w / columns) * 100}%`,
              height: h * rowHeight,
            }}
          >
            {/* Drag handle — whole component area */}
            <div
              className={`h-full w-full ${!locked ? "cursor-grab" : ""} ${
                isDragging ? "cursor-grabbing" : ""
              }`}
              onMouseDown={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest("button, input, [data-no-drag]")) return;
                handleDragStart(e, comp);
              }}
            >
              {renderComponent(comp)}
            </div>

            {/* Resize handles — all 8 directions, only when unlocked */}
            {!locked &&
              RESIZE_HANDLES.map(({ dir, cursor, className }) => (
                <div
                  key={dir}
                  className={`absolute z-[60] ${cursor} ${className}`}
                  onMouseDown={(e) => handleResizeStart(e, comp, dir)}
                />
              ))}

            {/* SE corner visual indicator */}
            {!locked && (
              <div className="pointer-events-none absolute bottom-0 right-0 z-[61]">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  className="text-white/20"
                >
                  <path
                    d="M10 2L2 10M10 6L6 10M10 10L10 10"
                    stroke="currentColor"
                    strokeWidth="1"
                    fill="none"
                  />
                </svg>
              </div>
            )}

            {/* Unlocked outline */}
            {!locked && !isDragging && !isResizing && (
              <div className="pointer-events-none absolute inset-0 border border-dashed border-white/[0.08]" />
            )}
            {/* Active drag/resize outline — amber for free-form, blue for snap */}
            {(isDragging || isResizing) && (
              <div
                className={`pointer-events-none absolute inset-0 border-2 ${
                  freeFormActive ? "border-amber/40" : "border-blue/40"
                }`}
              />
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {components.length === 0 && (
        <div className="flex h-full min-h-[400px] items-center justify-center">
          <p className="text-[11px] text-white/20">
            Click "Add Component" to get started
          </p>
        </div>
      )}
    </div>
  );
}

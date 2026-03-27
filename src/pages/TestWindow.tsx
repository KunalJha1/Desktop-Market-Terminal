import { useMemo } from "react";
import WindowControls from "../components/WindowControls";
import Logo from "../components/Logo";
import { appWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/platform";

export default function TestWindow() {
  const query = useMemo(() => window.location.search || "(empty)", []);
  const windowLabel = useMemo(() => {
    if (!isTauriRuntime()) return "browser";
    return appWindow.label;
  }, []);

  const handleDragRegionMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    if (e.button === 0 && isTauriRuntime()) {
      appWindow.startDragging().catch(() => {});
    }
  };

  const handleDragRegionDblClick = () => {
    if (!isTauriRuntime()) return;
    appWindow.isMaximized().then((max) => {
      max ? appWindow.unmaximize() : appWindow.maximize();
    }).catch(() => {});
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base">
      <div
        className="flex h-8 shrink-0 cursor-default select-none items-center justify-between border-b border-white/[0.06] bg-base"
        onMouseDown={handleDragRegionMouseDown}
        onDoubleClick={handleDragRegionDblClick}
      >
        <span className="px-3 font-mono text-[11px] text-white/45">Test Window</span>
        <WindowControls />
      </div>

      <main className="flex flex-1 items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(26,86,219,0.22),_transparent_48%),linear-gradient(180deg,_rgba(255,255,255,0.015),_rgba(255,255,255,0))]">
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-10 py-12 shadow-2xl shadow-black/35">
          <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300">
            Test Window Booted
          </div>
          <Logo className="h-16 w-auto opacity-95" />
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/38">
            DailyIQ Test Window
          </p>
          <div className="w-full max-w-[420px] rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3 font-mono text-[10px] text-white/48">
            <p>label: {windowLabel}</p>
            <p>query: {query}</p>
          </div>
        </div>
      </main>
    </div>
  );
}

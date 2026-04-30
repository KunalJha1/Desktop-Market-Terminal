import { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Lock, Unlock, Link2, FolderOpen, Save, ZoomIn, ZoomOut } from "lucide-react";
import { LINK_CHANNELS } from "../lib/link-channels";

// US market holidays for 2025-2026 (NYSE/NASDAQ)
const MARKET_HOLIDAYS: number[] = [
  new Date(2025, 0, 1).getTime(),
  new Date(2025, 0, 20).getTime(),
  new Date(2025, 1, 17).getTime(),
  new Date(2025, 3, 18).getTime(),
  new Date(2025, 4, 26).getTime(),
  new Date(2025, 5, 19).getTime(),
  new Date(2025, 6, 4).getTime(),
  new Date(2025, 8, 1).getTime(),
  new Date(2025, 10, 27).getTime(),
  new Date(2025, 11, 25).getTime(),
  new Date(2026, 0, 1).getTime(),
  new Date(2026, 0, 19).getTime(),
  new Date(2026, 1, 16).getTime(),
  new Date(2026, 3, 3).getTime(),
  new Date(2026, 4, 25).getTime(),
  new Date(2026, 5, 19).getTime(),
  new Date(2026, 6, 3).getTime(),
  new Date(2026, 8, 7).getTime(),
  new Date(2026, 10, 26).getTime(),
  new Date(2026, 11, 25).getTime(),
];

function isMarketHoliday(date: Date): boolean {
  const dayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  return MARKET_HOLIDAYS.includes(dayStart);
}

function getNextMarketOpen(): Date {
  const nowLocal = new Date();
  const etStr = nowLocal.toLocaleString("en-US", {
    timeZone: "America/New_York",
  });
  const et = new Date(etStr);
  const etTimeInMinutes = et.getHours() * 60 + et.getMinutes();
  const openTime = 9 * 60 + 30;

  if (
    et.getDay() >= 1 &&
    et.getDay() <= 5 &&
    etTimeInMinutes < openTime &&
    !isMarketHoliday(et)
  ) {
    const openET = new Date(et);
    openET.setHours(9, 30, 0, 0);
    const diff = nowLocal.getTime() - et.getTime();
    return new Date(openET.getTime() + diff);
  }

  const candidate = new Date(et);
  candidate.setHours(9, 30, 0, 0);
  candidate.setDate(candidate.getDate() + 1);

  for (let i = 0; i < 14; i++) {
    const day = candidate.getDay();
    if (day >= 1 && day <= 5 && !isMarketHoliday(candidate)) {
      const diff = nowLocal.getTime() - et.getTime();
      return new Date(candidate.getTime() + diff);
    }
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

type MarketSession = "premarket" | "open" | "afterhours" | "closed";

function getMarketSession(): MarketSession {
  const nowLocal = new Date();
  const etStr = nowLocal.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const day = et.getDay();
  if (day === 0 || day === 6 || isMarketHoliday(et)) return "closed";
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins >= 240 && mins < 570) return "premarket";
  if (mins >= 570 && mins < 960) return "open";
  if (mins >= 960 && mins < 1200) return "afterhours";
  return "closed";
}

function getETDate(): { et: Date; diff: number } {
  const nowLocal = new Date();
  const etStr = nowLocal.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  return { et, diff: nowLocal.getTime() - et.getTime() };
}

function getNextMarketClose(): Date {
  const { et, diff } = getETDate();
  const closeET = new Date(et);
  closeET.setHours(16, 0, 0, 0);
  return new Date(closeET.getTime() + diff);
}

function getNextAfterHoursClose(): Date {
  const { et, diff } = getETDate();
  const closeET = new Date(et);
  closeET.setHours(20, 0, 0, 0);
  return new Date(closeET.getTime() + diff);
}

function getNextPreMarketOpen(): Date {
  const nowLocal = new Date();
  const etStr = nowLocal.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const diff = nowLocal.getTime() - et.getTime();

  // Start from tomorrow 4:00 AM ET
  const candidate = new Date(et);
  candidate.setHours(4, 0, 0, 0);
  // If we haven't hit 4 AM today yet, use today
  if (et.getHours() * 60 + et.getMinutes() < 240) {
    const day = candidate.getDay();
    if (day >= 1 && day <= 5 && !isMarketHoliday(candidate)) {
      return new Date(candidate.getTime() + diff);
    }
  }
  candidate.setDate(candidate.getDate() + 1);
  for (let i = 0; i < 14; i++) {
    const day = candidate.getDay();
    if (day >= 1 && day <= 5 && !isMarketHoliday(candidate)) {
      return new Date(candidate.getTime() + diff);
    }
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

interface DashboardToolbarProps {
  locked: boolean;
  onToggleLock: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onAddComponent: () => void;
  onLoadWorkspace: () => void;
  onSaveWorkspace: () => void;
}

export default function DashboardToolbar({
  locked,
  onToggleLock,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  linkChannel,
  onSetLinkChannel,
  onAddComponent,
  onLoadWorkspace,
  onSaveWorkspace,
}: DashboardToolbarProps) {
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState<string | null>(null);
  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const linkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Close link dropdown on click-outside / Escape
  useEffect(() => {
    if (!showLinkMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (linkRef.current && !linkRef.current.contains(e.target as Node))
        setShowLinkMenu(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowLinkMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showLinkMenu]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const handleToggleLock = () => {
    const willBeUnlocked = locked;
    onToggleLock();
    setToast(willBeUnlocked ? "unlocked" : "locked");
  };

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const session = getMarketSession();
  const sessionInfo = useMemo(() => {
    const SESSION_CONFIG: Record<MarketSession, { label: string; color: string; countdownLabel: string; target: Date }> = {
      premarket:  { label: "Pre-Market",    color: "#F59E0B", countdownLabel: "Time Till Open",         target: getNextMarketOpen() },
      open:       { label: "Market Open",   color: "#00C853", countdownLabel: "Time Till Close",        target: getNextMarketClose() },
      afterhours: { label: "After-Hours",   color: "#F59E0B", countdownLabel: "Time Till Close",        target: getNextAfterHoursClose() },
      closed:     { label: "Market Closed", color: "#ffffff55", countdownLabel: "Time Till Pre-Market", target: getNextPreMarketOpen() },
    };
    return SESSION_CONFIG[session];
  }, [session]);

  const activeChannel = LINK_CHANNELS.find((c) => c.id === linkChannel);

  const btnClass =
    "flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[10px] text-white transition-colors duration-75 hover:bg-white/[0.04] hover:text-white";

  return (
    <>
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-white/[0.06] bg-base px-2">
        {/* Left: add component */}
        <button onClick={onAddComponent} className={btnClass}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>Add Component</span>
        </button>

        {/* Right: controls + time */}
        <div className="flex items-center gap-1">
          {/* Lock */}
          <button
            onClick={handleToggleLock}
            className={btnClass}
          >
            {locked ? (
              <Lock className="h-3.5 w-3.5 text-white" strokeWidth={1.5} />
            ) : (
              <Unlock className="h-3.5 w-3.5 text-green" strokeWidth={1.5} />
            )}
          </button>

          {/* Save workspace */}
          <button
            onClick={onSaveWorkspace}
            className={btnClass}
            title="Save workspace (.diq)"
          >
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>

          {/* Load workspace */}
          <button
            onClick={onLoadWorkspace}
            className={btnClass}
            title="Load workspace (.diq)"
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>

          {/* Link dropdown */}
          <div ref={linkRef} className="relative">
            <button
              onClick={() => setShowLinkMenu((v) => !v)}
              className={btnClass}
            >
              <Link2
                className="h-3.5 w-3.5"
                strokeWidth={1.5}
                style={{ color: activeChannel ? activeChannel.color : undefined }}
              />
              {activeChannel && (
                <span style={{ color: activeChannel.color }}>
                  {activeChannel.id}
                </span>
              )}
            </button>

            {showLinkMenu && (
              <div className="absolute right-0 top-full z-[100] mt-1 min-w-[140px] rounded-md border border-white/[0.08] bg-[#1C2128] py-1 shadow-xl shadow-black/40">
                {/* Unlink option */}
                <button
                  onClick={() => {
                    onSetLinkChannel(null);
                    setShowLinkMenu(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors duration-75 hover:bg-white/[0.06] ${
                    linkChannel === null
                      ? "text-white/70"
                      : "text-white/40"
                  }`}
                >
                  <span className="inline-block h-2 w-2 rounded-full border border-white/20" />
                  None
                </button>

                {LINK_CHANNELS.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => {
                      onSetLinkChannel(ch.id);
                      setShowLinkMenu(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors duration-75 hover:bg-white/[0.06] ${
                      linkChannel === ch.id
                        ? "text-white/70"
                        : "text-white/40"
                    }`}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: ch.color }}
                    />
                    <span>Link {ch.id}</span>
                    <span
                      className="ml-auto text-[9px]"
                      style={{ color: ch.color }}
                    >
                      {ch.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mx-1 h-3 w-px bg-white/[0.06]" />

          {/* Zoom controls */}
          <button onClick={onZoomOut} className={btnClass} title="Zoom out (Cmd -)">
            <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          <button
            onClick={onZoomReset}
            className="rounded-sm px-1 py-0.5 font-mono text-[10px] text-white transition-colors duration-75 hover:bg-white/[0.04] hover:text-white"
            title="Reset zoom (Cmd 0)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={onZoomIn} className={btnClass} title="Zoom in (Cmd +)">
            <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>

          <div className="mx-1 h-3 w-px bg-white/[0.06]" />

          <span className="font-mono text-[10px] text-white">
            {timeStr}
          </span>

          <div className="mx-1 h-3 w-px bg-white/[0.06]" />

          <span className="font-mono text-[10px]" style={{ color: sessionInfo.color }}>
            {sessionInfo.label}
          </span>
          <div className="mx-1 h-3 w-px bg-white/[0.06]" />
          <span className="font-mono text-[10px] text-white/50">
            {sessionInfo.countdownLabel}:{" "}
            <span className="text-white">{formatCountdown(sessionInfo.target.getTime() - now.getTime())}</span>
          </span>
        </div>
      </div>

      {/* Center toast for lock/unlock */}
      {toast && (
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center">
          <div className="animate-fade-toast flex items-center gap-3 rounded-lg border border-white/[0.08] bg-[#161B22] px-6 py-3.5 shadow-2xl shadow-black/50">
            {toast === "unlocked" ? (
              <Unlock className="h-4 w-4 text-green" strokeWidth={1.5} />
            ) : (
              <Lock className="h-4 w-4 text-white/40" strokeWidth={1.5} />
            )}
            <div>
              <p className="text-[13px] font-medium text-white/80">
                {toast === "unlocked" ? "Layout Unlocked" : "Layout Locked"}
              </p>
              <p className="mt-0.5 text-[11px] text-white/35">
                {toast === "unlocked"
                  ? "Components can now be moved and resized"
                  : "Components are fixed in place"}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

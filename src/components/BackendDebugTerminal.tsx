import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTws } from "../lib/tws";

interface DebugEvent {
  id: number;
  ts: number;
  category: string;
  action: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface DebugEventsResponse {
  events: DebugEvent[];
  next_id: number;
}

const POLL_MS = 1200;
const MAX_EVENTS = 800;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatEvent(evt: DebugEvent): string {
  const prefix = `[${formatTime(evt.ts)}] ${evt.category}.${evt.action}`;
  const msg = evt.message?.trim();
  if (msg) return `${prefix} | ${msg}`;
  if (evt.data && Object.keys(evt.data).length > 0) {
    return `${prefix} | ${JSON.stringify(evt.data)}`;
  }
  return prefix;
}

export default function BackendDebugTerminal() {
  const { sidecarPort, backendState } = useTws();
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [nextId, setNextId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const isReady = backendState === "healthy" && sidecarPort != null;

  const poll = useCallback(async () => {
    if (!sidecarPort || backendState !== "healthy") return;
    try {
      setLoading(true);
      const url = new URL(`http://127.0.0.1:${sidecarPort}/debug/events`);
      url.searchParams.set("after_id", String(nextId));
      url.searchParams.set("limit", "400");
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as DebugEventsResponse;
      if (Array.isArray(payload.events) && payload.events.length > 0) {
        setEvents((prev) => {
          const merged = [...prev, ...payload.events];
          return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
        });
      }
      if (typeof payload.next_id === "number") {
        setNextId(payload.next_id);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch debug events");
    } finally {
      setLoading(false);
    }
  }, [backendState, nextId, sidecarPort]);

  useEffect(() => {
    setEvents([]);
    setNextId(0);
    setError(null);
  }, [sidecarPort]);

  useEffect(() => {
    if (!isReady) return;
    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [isReady, poll]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [events]);

  const lines = useMemo(() => events.map((evt) => formatEvent(evt)), [events]);

  async function clearEvents(): Promise<void> {
    if (!sidecarPort || backendState !== "healthy") return;
    try {
      await fetch(`http://127.0.0.1:${sidecarPort}/debug/events/clear`, { method: "POST" });
      setEvents([]);
      setNextId(0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear debug events");
    }
  }

  return (
    <section className="shrink-0 border-b border-white/[0.06] bg-[#0B1118]" data-no-drag>
      <div className="flex h-7 items-center justify-between border-b border-white/[0.05] px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300/80">Backend Terminal</span>
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isReady ? "bg-green" : "bg-amber animate-pulse"
            }`}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-white/35">
            {loading ? "polling..." : `${events.length} events`}
          </span>
          <button
            type="button"
            className="font-mono text-[10px] text-white/45 transition-colors hover:text-white/80 disabled:opacity-50"
            onClick={() => {
              void clearEvents();
            }}
            disabled={!isReady}
          >
            clear
          </button>
        </div>
      </div>
      <div ref={scrollerRef} className="h-40 overflow-auto px-3 py-2">
        {error ? (
          <p className="font-mono text-[10px] text-red/80">{error}</p>
        ) : lines.length === 0 ? (
          <p className="font-mono text-[10px] text-white/35">
            {isReady ? "Waiting for backend events..." : "Backend is not healthy; terminal paused."}
          </p>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-white/72">
            {lines.join("\n")}
          </pre>
        )}
      </div>
    </section>
  );
}


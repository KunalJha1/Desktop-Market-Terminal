/**
 * Opt-in dev diagnostics for dashboard / shell performance investigation.
 * Enable: in DevTools console, run:
 *   localStorage.setItem('dailyiq:perfDiagnostics', '1'); location.reload()
 * Disable:
 *   localStorage.removeItem('dailyiq:perfDiagnostics'); location.reload()
 */

const STORAGE_KEY = "dailyiq:perfDiagnostics";

export function isPerfDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** React Profiler: record 15–20s idle on Dashboard; sort commits by duration; align spikes with Network. */
export function logProfilerInstructions(): void {
  if (!isPerfDiagnosticsEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(
    "[perf] React Profiler: Settings → Profiler → Record on Dashboard tab ~15–20s idle → sort by commit duration.",
  );
  // eslint-disable-next-line no-console
  console.info(
    "[perf] A/B: (1) Remove MiniChart tiles — if rhythm unchanged, RAF is not the pulse driver. (2) Compare footer-only vs full-shell Tws coupling via Profiler commits.",
  );
}

let longTaskObserverStarted = false;

/** Chrome Performance: Main thread long tasks (>50ms); scripting vs React vs canvas. */
export function initLongTaskObserver(): void {
  if (!isPerfDiagnosticsEnabled() || longTaskObserverStarted) return;
  if (typeof PerformanceObserver === "undefined") return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const d = entry.duration;
        if (d < 50) continue;
        // eslint-disable-next-line no-console
        console.warn("[perf] long task", Math.round(d), "ms", entry.name || "(unnamed)");
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    longTaskObserverStarted = true;
    // eslint-disable-next-line no-console
    console.info("[perf] Long Task observer active (PerformanceObserver 'longtask').");
  } catch {
    // longtask not supported in some environments
  }
}

export function initPerfDiagnostics(): void {
  if (!isPerfDiagnosticsEnabled()) return;
  logProfilerInstructions();
  initLongTaskObserver();
}

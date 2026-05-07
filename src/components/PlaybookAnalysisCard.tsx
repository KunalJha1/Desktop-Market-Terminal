import { memo, useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, RefreshCw, Settings, X } from "lucide-react";
import { useSidecarPort, useTws } from "../lib/tws";

const DEFAULT_REFRESH_MINUTES = 15;
const POLL_INTERVAL_MS = 2_000;

interface ModelStatus {
  status: "not_downloaded" | "downloading" | "ready" | "error";
  progress: number;
  error: string;
  model_filename: string;
}

interface AnalyzeResult {
  ok: boolean;
  model_status: ModelStatus;
  analysis: string | null;
  error?: string;
}

interface PlaybookAnalysisCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

function readRefreshMinutes(config: Record<string, unknown>): number {
  const v = config.refreshMinutes;
  if (typeof v === "number" && v >= 1) return Math.round(v);
  return DEFAULT_REFRESH_MINUTES;
}

function readAutoRefresh(config: Record<string, unknown>): boolean {
  return config.autoRefresh !== false;
}

function formatLastUpdated(ts: number | null): string {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function PlaybookAnalysisCard({
  onClose,
  config,
  onConfigChange,
}: PlaybookAnalysisCardProps) {
  const sidecarPort = useSidecarPort();
  const { settings } = useTws();
  const hasRules = Boolean(settings.playbookMemory?.trim());

  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refreshMinutes = readRefreshMinutes(config);
  const autoRefresh = readAutoRefresh(config);

  const settingsRef = useRef(showSettings);
  settingsRef.current = showSettings;

  // Poll model status until ready
  useEffect(() => {
    if (!sidecarPort) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/playbook/model/status`);
        if (!res.ok || cancelled) return;
        const data: ModelStatus = await res.json();
        if (!cancelled) setModelStatus(data);
        if (data.status === "downloading") {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        // backend not ready yet
      }
    }

    void poll();
    return () => { cancelled = true; };
  }, [sidecarPort]);

  const triggerDownload = useCallback(async () => {
    if (!sidecarPort) return;
    setDownloadError(null);
    try {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/playbook/model/download`, { method: "POST" });
      const data = await res.json();
      setModelStatus(data);
      // kick off polling
      const poll = async () => {
        try {
          const r = await fetch(`http://127.0.0.1:${sidecarPort}/playbook/model/status`);
          const s: ModelStatus = await r.json();
          setModelStatus(s);
          if (s.status === "downloading") setTimeout(poll, POLL_INTERVAL_MS);
        } catch {}
      };
      void poll();
    } catch (e) {
      setDownloadError(String(e));
    }
  }, [sidecarPort]);

  const runAnalysis = useCallback(async () => {
    if (!sidecarPort || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/playbook/analyze`);
      const data: AnalyzeResult = await res.json();
      if (data.ok && data.analysis) {
        setAnalysis(data.analysis);
        setLastUpdated(Date.now());
      } else if (data.error === "no_rules") {
        setAnalyzeError("no_rules");
      } else if (data.model_status?.status !== "ready") {
        setModelStatus(data.model_status);
      } else {
        setAnalyzeError(data.error ?? "Analysis failed");
      }
    } catch (e) {
      setAnalyzeError(String(e));
    } finally {
      setAnalyzing(false);
    }
  }, [sidecarPort, analyzing]);

  // Auto-run once model becomes ready
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    const cur = modelStatus?.status ?? null;
    if (cur === "ready" && prevStatus.current !== "ready" && hasRules) {
      void runAnalysis();
    }
    prevStatus.current = cur;
  }, [modelStatus?.status, hasRules, runAnalysis]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || modelStatus?.status !== "ready" || !hasRules) return;
    const id = setInterval(() => { void runAnalysis(); }, refreshMinutes * 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, modelStatus?.status, hasRules, refreshMinutes, runAnalysis]);

  // Tick last-updated label every 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const handleRefreshClick = useCallback(() => {
    void runAnalysis();
    setShowSettings(false);
  }, [runAnalysis]);

  const status = modelStatus?.status ?? "loading";

  return (
    <div className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel">
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <GripVertical className="shrink-0 cursor-grab text-white/20" size={12} />
          <span className="truncate text-[11px] font-medium text-white/80">Playbook Monitor</span>
          {lastUpdated && (
            <span className="shrink-0 font-mono text-[9px] text-white/30">{formatLastUpdated(lastUpdated)}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {status === "ready" && hasRules && (
            <button
              onClick={handleRefreshClick}
              disabled={analyzing}
              className="flex items-center justify-center rounded-sm p-1 text-white/50 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
            >
              <RefreshCw size={11} className={analyzing ? "animate-spin" : ""} />
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="flex items-center justify-center rounded-sm p-1 text-white/50 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white"
            >
              <Settings size={11} />
            </button>
            {showSettings && (
              <div className="absolute right-0 top-full z-[100] mt-1 w-[220px] rounded-md border border-white/[0.08] bg-[#1C2128] p-3 shadow-xl shadow-black/40">
                <div className="mb-2 text-[9px] uppercase tracking-wider text-white/25">Auto-refresh</div>
                <button
                  onClick={() => onConfigChange({ ...config, autoRefresh: !autoRefresh })}
                  className="mb-2 flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition-colors duration-75 hover:bg-white/[0.06]"
                >
                  <span className="text-[11px] text-white/75">Auto-refresh</span>
                  <span
                    className={`inline-flex h-5 min-w-[36px] items-center rounded-full px-1 transition-colors duration-100 ${autoRefresh ? "bg-blue-500/70" : "bg-white/[0.08]"}`}
                  >
                    <span
                      className={`h-3.5 w-3.5 rounded-full bg-white transition-transform duration-100 ${autoRefresh ? "translate-x-[18px]" : "translate-x-[1px]"}`}
                    />
                  </span>
                </button>
                <div className="mb-1 text-[9px] uppercase tracking-wider text-white/25">Interval (minutes)</div>
                <div className="flex gap-1">
                  {[5, 15, 30, 60].map((m) => (
                    <button
                      key={m}
                      onClick={() => onConfigChange({ ...config, refreshMinutes: m })}
                      className={`flex-1 rounded-sm py-1 text-[10px] transition-colors duration-75 ${refreshMinutes === m ? "bg-blue-500/20 text-blue-300" : "text-white/50 hover:bg-white/[0.06] hover:text-white"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-sm p-1 text-white/50 transition-colors duration-75 hover:bg-white/[0.06] hover:text-red-400"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        {status === "loading" && (
          <div className="flex h-full items-center justify-center">
            <span className="text-[11px] text-white/30">Connecting…</span>
          </div>
        )}

        {status === "not_downloaded" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-[11px] text-white/50">
              Playbook Monitor uses a local AI model (~300 MB) to check whether your trading rules are being followed in real time.
            </p>
            <button
              onClick={triggerDownload}
              className="rounded-md bg-blue-600/70 px-4 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-600"
            >
              Download Model
            </button>
            {downloadError && (
              <p className="text-[10px] text-red-400">{downloadError}</p>
            )}
          </div>
        )}

        {status === "downloading" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
            <p className="text-[11px] text-white/60">Downloading model…</p>
            <div className="w-full max-w-[220px] overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${modelStatus?.progress ?? 0}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-white/35">{modelStatus?.progress ?? 0}%</span>
          </div>
        )}

        {status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-[11px] text-red-400">Download failed</p>
            <p className="text-[10px] text-white/35">{modelStatus?.error}</p>
            <button
              onClick={triggerDownload}
              className="rounded-md bg-white/[0.06] px-3 py-1 text-[10px] text-white/60 hover:bg-white/[0.10]"
            >
              Retry
            </button>
          </div>
        )}

        {status === "ready" && !hasRules && (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="text-[11px] text-white/40">
              Add your trading rules in{" "}
              <span className="text-white/65">Settings → Playbook</span>{" "}
              to enable compliance analysis.
            </p>
          </div>
        )}

        {status === "ready" && hasRules && analyzing && !analysis && (
          <div className="space-y-2">
            {[85, 70, 90, 55].map((w, i) => (
              <div
                key={i}
                className="h-2.5 animate-pulse rounded bg-white/[0.06]"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        )}

        {status === "ready" && hasRules && analyzeError && analyzeError !== "no_rules" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-[11px] text-red-400/80">Analysis failed</p>
            <p className="text-[10px] text-white/30">{analyzeError}</p>
          </div>
        )}

        {status === "ready" && hasRules && analysis && (
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-white/75">{analysis}</p>
            {analyzing && (
              <div className="flex items-center gap-1 pt-1">
                <div className="h-1 w-1 animate-pulse rounded-full bg-blue-400" />
                <span className="text-[9px] text-white/30">Refreshing…</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(PlaybookAnalysisCard);

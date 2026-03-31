import { useEffect, useRef, useState, useCallback } from "react";
import { X, RefreshCw, Download, CheckCircle, AlertTriangle, LogOut } from "lucide-react";
import { useTws } from "../lib/tws";
import { useAuth } from "../lib/auth";
import { checkUpdate, installUpdate, type UpdateManifest } from "@tauri-apps/api/updater";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/api/process";
import { invoke } from "@tauri-apps/api/tauri";

const CONNECTION_LABELS: Record<string, string> = {
  "tws-live": "TWS Live",
  "tws-paper": "TWS Paper",
  "gateway-live": "Gateway Live",
  "gateway-paper": "Gateway Paper",
};

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  updateAvailable?: boolean;
}

const PLAYBOOK_PLACEHOLDER = `Example:
- Prioritize risk management over new opportunities
- If a portfolio position breaks my rules, discuss that first
- Prefer alignment across 1H, 5D, and 1W
- No averaging down
- Flag oversized positions above 12%
- Prefer swing-style decisions over scalp-style noise`;

export default function SettingsPanel({ open, onClose, updateAvailable }: SettingsPanelProps) {
  const { session, signOut } = useAuth();
  const {
    status,
    port,
    clientId,
    connectionType,
    backendState,
    backendMessage,
    settings,
    updateSettings,
    probe,
    finnhubStatus,
    finnhubMessage,
    validateFinnhubKey,
  } =
    useTws();
  const panelRef = useRef<HTMLDivElement>(null);

  const [appVersion, setAppVersion] = useState("");
  const [executablePath, setExecutablePath] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "downloading" | "up-to-date" | "error"
  >("idle");
  const [updateManifest, setUpdateManifest] = useState<UpdateManifest | null>(null);
  const [updateError, setUpdateError] = useState("");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  useEffect(() => {
    if (!open) return;
    invoke<string>("get_executable_path")
      .then(setExecutablePath)
      .catch(() => setExecutablePath(null));
  }, [open]);

  const handleCheckUpdate = useCallback(async () => {
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const { shouldUpdate, manifest } = await checkUpdate();
      if (shouldUpdate && manifest) {
        setUpdateManifest(manifest);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("up-to-date");
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setUpdateStatus("error");
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    setUpdateStatus("downloading");
    setUpdateError("");
    try {
      await installUpdate();
      await relaunch();
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setUpdateStatus("error");
    }
  }, []);

  useEffect(() => {
    if (open && updateAvailable && updateStatus === "idle") {
      handleCheckUpdate();
    }
  }, [open, updateAvailable, updateStatus, handleCheckUpdate]);

  const [finnhubDraft, setFinnhubDraft] = useState("");
  const [intradayBackfillYearsDraft, setIntradayBackfillYearsDraft] = useState("2");
  const [playbookMemoryDraft, setPlaybookMemoryDraft] = useState("");
  const [playbookMemoryEnabledDraft, setPlaybookMemoryEnabledDraft] = useState(false);
  const [finnhubSaveMessage, setFinnhubSaveMessage] = useState("");
  const [finnhubSaveState, setFinnhubSaveState] = useState<"idle" | "success" | "error">("idle");
  const [playbookSaveMessage, setPlaybookSaveMessage] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setFinnhubDraft(settings.finnhubApiKey);
    setIntradayBackfillYearsDraft(String(settings.intradayBackfillYears));
    setPlaybookMemoryDraft(settings.playbookMemory);
    setPlaybookMemoryEnabledDraft(settings.playbookMemoryEnabled);
    setFinnhubSaveMessage("");
    setFinnhubSaveState("idle");
    setPlaybookSaveMessage("");
  }, [
    open,
    settings.finnhubApiKey,
    settings.intradayBackfillYears,
    settings.playbookMemory,
    settings.playbookMemoryEnabled,
  ]);

  if (!open) return null;

  const statusDot =
    status === "connected"
      ? "bg-green"
      : status === "probing"
        ? "bg-amber animate-pulse"
        : "bg-red/60";

  const statusLabel =
    status === "connected" && connectionType
      ? `Connected to ${CONNECTION_LABELS[connectionType]} on :${port}`
      : status === "probing"
        ? "Probing ports..."
        : "Disconnected";
  const backendStatusLabel =
    backendState === "healthy"
      ? "Backend healthy"
      : backendMessage;
  const finnhubTesting = finnhubStatus === "testing";
  const intradayBackfillYears = Number.parseInt(intradayBackfillYearsDraft, 10);
  const intradayBackfillYearsValid =
    Number.isFinite(intradayBackfillYears) &&
    intradayBackfillYears >= 1 &&
    intradayBackfillYears <= 30;
  const intradayBackfillYearsNormalized = intradayBackfillYearsValid
    ? intradayBackfillYears
    : settings.intradayBackfillYears;
  const intradayBackfillDirty =
    intradayBackfillYearsNormalized !== settings.intradayBackfillYears ||
    intradayBackfillYearsDraft.trim() !== String(settings.intradayBackfillYears);
  const playbookHasText = playbookMemoryDraft.trim().length > 0;
  const playbookDirty =
    playbookMemoryDraft !== settings.playbookMemory ||
    playbookMemoryEnabledDraft !== settings.playbookMemoryEnabled;

  async function handleFinnhubSave() {
    setFinnhubSaveMessage("");
    setFinnhubSaveState("idle");
    const result = await validateFinnhubKey(finnhubDraft);
    if (result.ok) {
      setFinnhubSaveState("success");
      setFinnhubSaveMessage(result.message);
    } else {
      setFinnhubSaveState("error");
      setFinnhubSaveMessage(result.message);
    }
  }

  function handleIntradayBackfillSave() {
    updateSettings({ intradayBackfillYears: intradayBackfillYearsNormalized });
    setIntradayBackfillYearsDraft(String(intradayBackfillYearsNormalized));
  }

  function handlePlaybookSave() {
    updateSettings({
      playbookMemory: playbookMemoryDraft,
      playbookMemoryEnabled: playbookHasText ? playbookMemoryEnabledDraft : false,
    });
    setPlaybookSaveMessage("Playbook memory saved");
  }

  function handlePlaybookClear() {
    setPlaybookMemoryDraft("");
    setPlaybookMemoryEnabledDraft(false);
    setPlaybookSaveMessage("");
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      onClose();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[300] bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed inset-y-0 right-0 z-[301] flex w-[380px] flex-col border-l border-white/[0.06] bg-panel"
        style={{ transition: "transform 120ms ease-out" }}
      >
        {/* Header */}
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
          <span className="text-[11px] font-medium text-white/60">
            Settings
          </span>
          <button
            onClick={onClose}
            className="text-white/30 transition-colors duration-75 hover:text-white/60"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="scrollbar-panel flex-1 overflow-y-auto px-4 py-4">
          <section className="mb-6">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
              Account
            </h3>
            <div className="rounded-md border border-white/[0.06] bg-base/70 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-white/25">
                Signed in as
              </p>
              <p className="mt-1 break-all font-mono text-[11px] text-white/70">
                {session?.user?.email ?? "Unknown user"}
              </p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="max-w-[210px] text-[10px] leading-4 text-white/28">
                  Sign out of the DailyIQ console on this device.
                </p>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="flex items-center gap-1.5 rounded-md border border-red/20 bg-red/[0.06] px-3 py-1 text-[11px] text-red/80 transition-colors duration-120 hover:bg-red/[0.12] disabled:opacity-40"
                >
                  <LogOut className="h-3 w-3" strokeWidth={1.5} />
                  {signingOut ? "Logging out..." : "Log out"}
                </button>
              </div>
            </div>
          </section>

          {/* Connection Section */}
          <section className="mb-6">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
              Connection (IBKR ONLY)
            </h3>

            <div className="mb-3 flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  backendState === "healthy"
                    ? "bg-green"
                    : backendState === "starting" || backendState === "restarting" || backendState === "unhealthy"
                      ? "bg-amber animate-pulse"
                      : "bg-red/60"
                }`}
              />
              <span className="font-mono text-[11px] text-white/50">
                {backendStatusLabel}
              </span>
            </div>

            {/* Status */}
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${statusDot}`}
              />
              <span className="font-mono text-[11px] text-white/50">
                {statusLabel}
              </span>
            </div>

            {/* Port + Client ID */}
            <div className="mb-3 flex gap-4 font-mono text-[10px] text-white/35">
              <span>
                Port:{" "}
                <span className="text-white/50">{port ?? "—"}</span>
              </span>
              <span>
                Client ID:{" "}
                <span className="text-white/50">{clientId ?? "—"}</span>
              </span>
            </div>

            {/* Probe button */}
            <button
              onClick={() => probe()}
              disabled={status === "probing"}
              className="rounded-md border border-white/[0.08] bg-base px-3 py-1 text-[11px] text-white/50 transition-colors duration-120 hover:bg-white/[0.04] hover:text-white/70 disabled:opacity-40"
            >
              {status === "probing" ? "Probing..." : "Probe Now"}
            </button>
          </section>

          {/* Trading Configuration */}
          <section>
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
              Trading Configuration (IBKR ONLY)
            </h3>

            {/* Radio: FA Group vs Account */}
            <div className="mb-3 flex flex-col gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/50">
                <input
                  type="radio"
                  name="tradingMode"
                  checked={settings.tradingMode === "fa-group"}
                  onChange={() => updateSettings({ tradingMode: "fa-group" })}
                  className="accent-blue"
                />
                Trade using FA Group
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/50">
                <input
                  type="radio"
                  name="tradingMode"
                  checked={settings.tradingMode === "account"}
                  onChange={() => updateSettings({ tradingMode: "account" })}
                  className="accent-blue"
                />
                Trade using Account
              </label>
            </div>

            {/* Conditional input */}
            {settings.tradingMode === "fa-group" ? (
              <div>
                <label className="mb-1 block text-[10px] text-white/30">
                  FA Group Name
                </label>
                <input
                  type="text"
                  value={settings.faGroup}
                  onChange={(e) => updateSettings({ faGroup: e.target.value })}
                  placeholder="e.g. AllAccounts"
                  className="w-full rounded border border-white/[0.08] bg-base px-2 py-1 font-mono text-[11px] text-white/60 outline-none transition-colors duration-75 placeholder:text-white/15 focus:border-blue/40"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[10px] text-white/30">
                  Account ID
                </label>
                <input
                  type="text"
                  value={settings.accountId}
                  onChange={(e) =>
                    updateSettings({ accountId: e.target.value })
                  }
                  placeholder="e.g. DU1234567"
                  className="w-full rounded border border-white/[0.08] bg-base px-2 py-1 font-mono text-[11px] text-white/60 outline-none transition-colors duration-75 placeholder:text-white/15 focus:border-blue/40"
                />
              </div>
            )}
          </section>

          <section className="mt-6">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
              FINNHUB API KEY (OPTIONAL)
            </h3>
            <label className="mb-1 block text-[10px] text-white/30">
              API Key
            </label>
            <input
              type="password"
              value={finnhubDraft}
              onChange={(e) => setFinnhubDraft(e.target.value)}
              placeholder="Paste your Finnhub API key"
              className="w-full rounded border border-white/[0.08] bg-base px-2 py-1 font-mono text-[11px] text-white/60 outline-none transition-colors duration-75 placeholder:text-white/15 focus:border-blue/40"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span
                className={`text-[10px] ${
                  finnhubTesting
                    ? "text-amber"
                    : finnhubStatus === "connected"
                      ? "text-green"
                      : "text-white/35"
                }`}
              >
                {finnhubTesting ? "Testing..." : finnhubMessage}
              </span>
              <button
                onClick={() => handleFinnhubSave()}
                disabled={finnhubTesting || finnhubDraft === settings.finnhubApiKey}
                className="rounded-md border border-white/[0.08] bg-base px-3 py-1 text-[11px] text-white/50 transition-colors duration-120 hover:bg-white/[0.04] hover:text-white/70 disabled:opacity-40"
              >
                {finnhubTesting ? "Saving..." : "Save"}
              </button>
            </div>
            {finnhubSaveMessage ? (
              <p
                className={`mt-2 text-[10px] ${
                  finnhubSaveState === "success" ? "text-green" : "text-red/70"
                }`}
              >
                {finnhubSaveMessage}
              </p>
            ) : null}
          </section>

          <section className="mt-6 border-t border-white/[0.06] pt-6">
            <div className="mb-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
                Historical Backfill
              </h3>
              <p className="mt-1 max-w-[320px] text-[10px] leading-4 text-white/35">
                Controls how far the background worker tries to archive 1-minute bars from TWS. Intraday charts still load a smaller live window first.
              </p>
            </div>

            <label className="mb-1 block text-[10px] text-white/30">
              1-Minute Backfill Horizon (Years)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={30}
                step={1}
                value={intradayBackfillYearsDraft}
                onChange={(e) => setIntradayBackfillYearsDraft(e.target.value)}
                className="w-24 rounded border border-white/[0.08] bg-base px-2 py-1 font-mono text-[11px] text-white/60 outline-none transition-colors duration-75 placeholder:text-white/15 focus:border-blue/40"
              />
              <button
                type="button"
                onClick={handleIntradayBackfillSave}
                disabled={!intradayBackfillYearsValid || !intradayBackfillDirty}
                className="rounded-md border border-white/[0.08] bg-base px-3 py-1 text-[11px] text-white/50 transition-colors duration-120 hover:bg-white/[0.04] hover:text-white/70 disabled:opacity-40"
              >
                Save
              </button>
            </div>
            <p className={`mt-2 text-[10px] leading-4 ${intradayBackfillYearsValid ? "text-white/28" : "text-red/70"}`}>
              {intradayBackfillYearsValid
                ? `Default is 2 years. Maximum is 30 years. Current saved value: ${settings.intradayBackfillYears}Y.`
                : "Enter a whole number between 1 and 30."}
            </p>
          </section>

          <section className="mt-6 border-t border-white/[0.06] pt-6">
            <div className="mb-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
                Playbook Memory
              </h3>
              <p className="mt-1 max-w-[320px] text-[10px] leading-4 text-white/35">
                Persistent trading rules, preferences, and context that the AI monitor should consider before generating analysis.
              </p>
            </div>

            <label className="mb-2 flex cursor-pointer items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-base/70 px-3 py-2">
              <div>
                <p className="text-[11px] text-white/65">Enable Playbook Memory for AI Monitor</p>
                <p className="mt-0.5 text-[10px] text-white/25">
                  Stored locally even when disabled.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={playbookMemoryEnabledDraft}
                aria-label="Enable Playbook Memory for AI Monitor"
                onClick={() => {
                  if (!playbookHasText && !playbookMemoryEnabledDraft) return;
                  setPlaybookMemoryEnabledDraft((value) => !value);
                  setPlaybookSaveMessage("");
                }}
                disabled={!playbookHasText && !playbookMemoryEnabledDraft}
                className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-120 ${
                  playbookMemoryEnabledDraft
                    ? "border-blue/50 bg-blue/30"
                    : "border-white/[0.08] bg-white/[0.06]"
                } disabled:opacity-40`}
              >
                <span
                  className={`absolute top-[1px] h-3.5 w-3.5 rounded-full bg-white transition-transform duration-120 ${
                    playbookMemoryEnabledDraft ? "translate-x-[18px]" : "translate-x-[1px]"
                  }`}
                />
              </button>
            </label>

            <textarea
              value={playbookMemoryDraft}
              onChange={(e) => {
                const nextValue = e.target.value;
                setPlaybookMemoryDraft(nextValue);
                setPlaybookSaveMessage("");
                if (nextValue.trim().length === 0) {
                  setPlaybookMemoryEnabledDraft(false);
                } else if (!settings.playbookMemory && !settings.playbookMemoryEnabled) {
                  setPlaybookMemoryEnabledDraft(true);
                }
              }}
              placeholder={PLAYBOOK_PLACEHOLDER}
              className="min-h-[190px] w-full resize-y rounded-md border border-white/[0.08] bg-base px-3 py-2 text-[11px] leading-5 text-white/72 outline-none transition-colors duration-75 placeholder:text-white/18 focus:border-blue/40"
              spellCheck={false}
            />

            <p className="mt-2 text-[10px] leading-4 text-white/28">
              This text is prepended to the AI monitor context as a persistent instruction layer.
            </p>

            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handlePlaybookClear}
                disabled={!playbookMemoryDraft && !playbookMemoryEnabledDraft}
                className="rounded-md border border-white/[0.08] bg-base px-3 py-1 text-[11px] text-white/50 transition-colors duration-120 hover:bg-white/[0.04] hover:text-white/70 disabled:opacity-40"
              >
                Clear
              </button>
              <div className="flex items-center gap-3">
                {playbookSaveMessage ? (
                  <span className="text-[10px] text-green">
                    {playbookSaveMessage}
                  </span>
                ) : (
                  <span className="text-[10px] text-white/20">
                    {playbookDirty ? "Unsaved changes" : "Saved"}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handlePlaybookSave}
                  disabled={!playbookDirty}
                  className="rounded-md border border-white/[0.08] bg-base px-3 py-1 text-[11px] text-white/50 transition-colors duration-120 hover:bg-white/[0.04] hover:text-white/70 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          </section>

          {/* App Updates */}
          <section className="mt-6 border-t border-white/[0.06] pt-6">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
              App Updates
            </h3>

            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-[11px] text-white/50">
                Current version:{" "}
                <span className="text-white/70">v{appVersion}</span>
              </span>
            </div>

            {executablePath ? (
              <div className="mb-3 rounded-md border border-white/[0.06] bg-base px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
                  Running executable
                </p>
                <p className="mt-1 break-all font-mono text-[10px] leading-5 text-white/50">
                  {executablePath}
                </p>
              </div>
            ) : null}

            {updateStatus === "available" && updateManifest && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-blue/20 bg-blue/[0.06] px-3 py-2">
                <Download className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue" strokeWidth={1.5} />
                <div>
                  <p className="text-[11px] text-white/70">
                    Version <span className="font-mono font-medium text-blue">v{updateManifest.version}</span> available
                  </p>
                  {updateManifest.body && (
                    <p className="mt-1 text-[10px] leading-4 text-white/35">
                      {updateManifest.body}
                    </p>
                  )}
                </div>
              </div>
            )}

            {updateStatus === "up-to-date" && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-green/20 bg-green/[0.06] px-3 py-2">
                <CheckCircle className="h-3.5 w-3.5 text-green" strokeWidth={1.5} />
                <span className="text-[11px] text-green/80">You're on the latest version</span>
              </div>
            )}

            {updateStatus === "error" && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-red/20 bg-red/[0.06] px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red/70" strokeWidth={1.5} />
                <p className="text-[10px] leading-4 text-red/60">{updateError || "Failed to check for updates"}</p>
              </div>
            )}

            <div className="flex gap-2">
              {updateStatus === "available" ? (
                <button
                  onClick={handleInstallUpdate}
                  disabled={updateStatus !== "available"}
                  className="flex items-center gap-1.5 rounded-md border border-blue/30 bg-blue/10 px-3 py-1 text-[11px] text-blue transition-colors duration-120 hover:bg-blue/20"
                >
                  <Download className="h-3 w-3" strokeWidth={1.5} />
                  Install & Restart
                </button>
              ) : (
                <button
                  onClick={handleCheckUpdate}
                  disabled={updateStatus === "checking" || updateStatus === "downloading"}
                  className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-base px-3 py-1 text-[11px] text-white/50 transition-colors duration-120 hover:bg-white/[0.04] hover:text-white/70 disabled:opacity-40"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${updateStatus === "checking" ? "animate-spin" : ""}`}
                    strokeWidth={1.5}
                  />
                  {updateStatus === "checking"
                    ? "Checking..."
                    : updateStatus === "downloading"
                      ? "Installing..."
                      : "Check for Updates"}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

import {
  readTextFile,
  writeTextFile,
  exists,
  createDir,
  BaseDirectory,
} from "@tauri-apps/api/fs";
import { appDataDir } from "@tauri-apps/api/path";

export interface TwsSettings {
  tradingMode: "fa-group" | "account";
  faGroup: string;
  accountId: string;
  clientId: number;
  autoProbe: boolean;
  intradayBackfillYears: number;
  finnhubApiKey: string;
  playbookMemory: string;
  playbookMemoryEnabled: boolean;
}

const FILENAME = "tws-settings.json";

function randomClientId(): number {
  return Math.floor(Math.random() * 9000) + 1000;
}

function normalizeIntradayBackfillYears(value: unknown): number {
  const years =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(years)) return 2;
  return Math.max(1, Math.min(30, Math.trunc(years)));
}

function defaultSettings(): TwsSettings {
  return {
    tradingMode: "account",
    faGroup: "",
    accountId: "",
    clientId: randomClientId(),
    autoProbe: true,
    intradayBackfillYears: 2,
    finnhubApiKey: "",
    playbookMemory: "",
    playbookMemoryEnabled: false,
  };
}

export async function loadTwsSettings(): Promise<TwsSettings> {
  try {
    const defaults = defaultSettings();
    const dir = await appDataDir();
    if (!(await exists(dir))) {
      await createDir(dir, { recursive: true });
      return defaults;
    }
    const content = await readTextFile(FILENAME, {
      dir: BaseDirectory.AppData,
    });
    const parsed = JSON.parse(content) as Partial<TwsSettings>;
    return {
      tradingMode: parsed.tradingMode === "fa-group" ? "fa-group" : defaults.tradingMode,
      faGroup: typeof parsed.faGroup === "string" ? parsed.faGroup : defaults.faGroup,
      accountId: typeof parsed.accountId === "string" ? parsed.accountId : defaults.accountId,
      clientId:
        typeof parsed.clientId === "number" && parsed.clientId >= 1000 && parsed.clientId <= 9999
          ? parsed.clientId
          : defaults.clientId,
      autoProbe: typeof parsed.autoProbe === "boolean" ? parsed.autoProbe : defaults.autoProbe,
      intradayBackfillYears: normalizeIntradayBackfillYears(parsed.intradayBackfillYears),
      finnhubApiKey:
        typeof parsed.finnhubApiKey === "string" ? parsed.finnhubApiKey : defaults.finnhubApiKey,
      playbookMemory:
        typeof parsed.playbookMemory === "string" ? parsed.playbookMemory : defaults.playbookMemory,
      playbookMemoryEnabled:
        typeof parsed.playbookMemoryEnabled === "boolean"
          ? parsed.playbookMemoryEnabled
          : typeof parsed.playbookMemory === "string" && parsed.playbookMemory.trim().length > 0,
    };
  } catch {
    return defaultSettings();
  }
}

export async function saveTwsSettings(settings: TwsSettings): Promise<void> {
  try {
    const dir = await appDataDir();
    if (!(await exists(dir))) {
      await createDir(dir, { recursive: true });
    }
    let nextPayload: Record<string, unknown> = { ...settings };
    try {
      const existing = await readTextFile(FILENAME, {
        dir: BaseDirectory.AppData,
      });
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === "object") {
        nextPayload = {
          ...(parsed as Record<string, unknown>),
          ...settings,
        };
      }
    } catch {
      // Ignore missing/invalid existing file and write normalized settings only.
    }
    await writeTextFile(FILENAME, JSON.stringify(nextPayload, null, 2), {
      dir: BaseDirectory.AppData,
    });
  } catch (err) {
    console.error("Failed to save TWS settings:", err);
  }
}

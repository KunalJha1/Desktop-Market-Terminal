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
}

const FILENAME = "tws-settings.json";

function randomClientId(): number {
  return Math.floor(Math.random() * 9000) + 1000;
}

function defaultSettings(): TwsSettings {
  return {
    tradingMode: "account",
    faGroup: "",
    accountId: "",
    clientId: randomClientId(),
    autoProbe: true,
  };
}

export async function loadTwsSettings(): Promise<TwsSettings> {
  try {
    const dir = await appDataDir();
    if (!(await exists(dir))) {
      await createDir(dir, { recursive: true });
      return defaultSettings();
    }
    const content = await readTextFile(FILENAME, {
      dir: BaseDirectory.AppData,
    });
    const parsed = JSON.parse(content) as TwsSettings;
    if (typeof parsed.clientId !== "number") return defaultSettings();
    if (parsed.clientId < 1000 || parsed.clientId > 9999) {
      return {
        ...parsed,
        clientId: randomClientId(),
      };
    }
    return parsed;
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
    await writeTextFile(FILENAME, JSON.stringify(settings, null, 2), {
      dir: BaseDirectory.AppData,
    });
  } catch (err) {
    console.error("Failed to save TWS settings:", err);
  }
}

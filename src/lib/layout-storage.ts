import {
  readTextFile,
  writeTextFile,
  BaseDirectory,
  createDir,
  exists,
} from "@tauri-apps/api/fs";
import { appDataDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/api/dialog";
import type { WorkspaceFile, TabState } from "./layout-types";
import { tabPresets } from "./tabs";
import { isTauriRuntime } from "./platform";

const WORKSPACE_FILENAME = "workspace.diq";
const LOCAL_STORAGE_KEY = "dailyiq:workspace";

function makeDefaultTab(
  type: (typeof tabPresets)[number]["type"],
  title: string,
): TabState {
  return {
    id: crypto.randomUUID(),
    title,
    type,
    locked: true,
    linkChannel: 1,
    layout: { columns: 12, rowHeight: 40, components: [] },
  };
}

export function getDefaultWorkspace(): WorkspaceFile {
  const tabs = tabPresets.map((p) => makeDefaultTab(p.type, p.title));
  return {
    version: 1,
    lastModified: new Date().toISOString(),
    global: { activeTabId: tabs[0].id },
    tabs,
  };
}

function isValidWorkspace(parsed: unknown): parsed is WorkspaceFile {
  if (!parsed || typeof parsed !== "object") return false;
  const ws = parsed as WorkspaceFile;
  if (typeof ws.version !== "number") return false;
  if (!ws.global || typeof ws.global.activeTabId !== "string") return false;
  if (!Array.isArray(ws.tabs) || ws.tabs.length === 0) return false;
  return true;
}

function parseWorkspace(raw: string): WorkspaceFile | null {
  try {
    const parsed = JSON.parse(raw) as WorkspaceFile;
    if (!isValidWorkspace(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadWorkspaceFromLocalStorage(): WorkspaceFile | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    return parseWorkspace(raw);
  } catch {
    return null;
  }
}

export function saveWorkspaceToLocalStorage(ws: WorkspaceFile): void {
  try {
    const updated: WorkspaceFile = {
      ...ws,
      lastModified: new Date().toISOString(),
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage failures (e.g. blocked in some contexts)
  }
}

export async function loadWorkspace(): Promise<WorkspaceFile | null> {
  try {
    if (!isTauriRuntime()) {
      return loadWorkspaceFromLocalStorage();
    }

    // Tauri: try disk first
    const dir = await appDataDir();
    if (!(await exists(dir))) {
      await createDir(dir, { recursive: true });
    }

    const content = await readTextFile(WORKSPACE_FILENAME, {
      dir: BaseDirectory.AppData,
    });
    const parsed = parseWorkspace(content);
    if (parsed) return parsed;

    // Fallback to localStorage if disk is invalid
    const fallback = loadWorkspaceFromLocalStorage();
    if (fallback) {
      await saveWorkspace(fallback);
    }
    return fallback;
  } catch {
    const fallback = loadWorkspaceFromLocalStorage();
    if (import.meta.env.DEV && !fallback) {
      console.warn("Failed to load workspace from disk or localStorage.");
    }
    return fallback;
  }
}

export async function getWorkspaceDir(): Promise<string> {
  return appDataDir();
}

/** Parse a .diq file from an absolute path. Returns null if invalid. */
export async function loadWorkspaceFromPath(
  filePath: string,
): Promise<WorkspaceFile | null> {
  try {
    const content = await readTextFile(filePath);
    const parsed = JSON.parse(content) as WorkspaceFile;
    if (!parsed.version || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Open a native file picker filtered to .diq files, defaulting to the app data dir. */
export async function pickWorkspaceFile(): Promise<string | null> {
  const defaultDir = await appDataDir();
  const selected = await open({
    defaultPath: defaultDir,
    filters: [{ name: "DailyIQ Workspace", extensions: ["diq"] }],
    multiple: false,
  });
  if (typeof selected === "string") return selected;
  return null;
}

export async function saveWorkspace(ws: WorkspaceFile): Promise<void> {
  try {
    const dir = await appDataDir();
    const dirExists = await exists(dir);
    if (!dirExists) {
      await createDir(dir, { recursive: true });
    }

    const updated: WorkspaceFile = {
      ...ws,
      lastModified: new Date().toISOString(),
    };

    await writeTextFile(WORKSPACE_FILENAME, JSON.stringify(updated, null, 2), {
      dir: BaseDirectory.AppData,
    });
  } catch (err) {
    console.error("Failed to save workspace:", err);
  }
}

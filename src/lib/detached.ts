import { appWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./platform";
import type { TabType } from "./tabs";

export interface DetachedTabInfo {
  tabId: string;
  tabType: TabType;
  title: string;
  windowLabel: string;
  originalIndex: number;
  chartStateJson?: string | null;
}

const KEY_PREFIX = "detached-tab:";
const REATTACH_PREFIX = "detached-reattach:";
const MAIN_CLOSING_KEY = "detached-main-closing";

export function getWindowLabel(): string | null {
  if (!isTauriRuntime()) return null;
  return appWindow.label;
}

/** Returns the detached window label if this window is a detached tab, or null */
export function getDetachedLabel(): string | null {
  const label = getWindowLabel();
  if (!label) return null;
  return label.startsWith("detached-") ? label : null;
}

/** Returns true if this window is a detached tab window */
export function isDetachedWindow(): boolean {
  return getDetachedLabel() !== null;
}

export function isTestWindowLabel(): boolean {
  const label = getWindowLabel();
  return !!label && label.startsWith("test-window-");
}

function detachedKey(label: string): string {
  return KEY_PREFIX + label;
}

/** Persist detached tab info so child windows can restore it after refresh. */
export function writeDetachedTabInfo(info: DetachedTabInfo): void {
  localStorage.setItem(detachedKey(info.windowLabel), JSON.stringify(info));
}

/** Read detached tab info for a detached window label. */
export function readDetachedTabInfo(label: string): DetachedTabInfo | null {
  const key = detachedKey(label);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DetachedTabInfo;
  } catch {
    return null;
  }
}

/** Remove detached tab info once the window is reattached or discarded. */
export function removeDetachedTabInfo(label: string): void {
  localStorage.removeItem(detachedKey(label));
}

/** Enumerate any pending detached tabs persisted in localStorage. */
export function readAllDetachedTabInfo(): DetachedTabInfo[] {
  const items: DetachedTabInfo[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      items.push(JSON.parse(raw) as DetachedTabInfo);
    } catch {
      // Ignore malformed entries.
    }
  }
  return items;
}

/** Child windows use this to ask the main window to restore the tab. */
export function writeReattachRequest(info: DetachedTabInfo): void {
  const key = `${REATTACH_PREFIX}${info.windowLabel}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(key, JSON.stringify(info));
}

export function isReattachRequestKey(key: string): boolean {
  return key.startsWith(REATTACH_PREFIX);
}

export function readReattachRequest(key: string): DetachedTabInfo | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DetachedTabInfo;
  } catch {
    return null;
  }
}

export function removeReattachRequest(key: string): void {
  localStorage.removeItem(key);
}

export function readAllReattachRequests(): Array<{ key: string; info: DetachedTabInfo }> {
  const items: Array<{ key: string; info: DetachedTabInfo }> = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !isReattachRequestKey(key)) continue;
    const info = readReattachRequest(key);
    if (info) items.push({ key, info });
  }
  return items;
}

export function setMainWindowClosing(closing: boolean): void {
  if (closing) {
    localStorage.setItem(MAIN_CLOSING_KEY, JSON.stringify({ closing: true, ts: Date.now() }));
  } else {
    localStorage.removeItem(MAIN_CLOSING_KEY);
  }
}

export function isMainWindowClosing(): boolean {
  return localStorage.getItem(MAIN_CLOSING_KEY) !== null;
}

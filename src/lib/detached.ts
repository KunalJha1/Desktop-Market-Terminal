import { appWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./platform";
import type { TabType } from "./tabs";

export interface DetachedTabInfo {
  tabId: string;
  tabType: TabType;
  title: string;
}

const KEY_PREFIX = "detached-tab:";

/** Returns the detached window label if this window is a detached tab, or null */
export function getDetachedLabel(): string | null {
  if (!isTauriRuntime()) return null;
  const label = appWindow.label;
  return label.startsWith("detached-") ? label : null;
}

/** Returns true if this window is a detached tab window */
export function isDetachedWindow(): boolean {
  return getDetachedLabel() !== null;
}

/** Write tab info to localStorage before spawning a detached window */
export function writeDetachedTabInfo(label: string, info: DetachedTabInfo): void {
  localStorage.setItem(KEY_PREFIX + label, JSON.stringify(info));
}

/** Read (and delete) tab info for a detached window label */
export function readDetachedTabInfo(label: string): DetachedTabInfo | null {
  const key = KEY_PREFIX + label;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  localStorage.removeItem(key);
  try {
    return JSON.parse(raw) as DetachedTabInfo;
  } catch {
    return null;
  }
}

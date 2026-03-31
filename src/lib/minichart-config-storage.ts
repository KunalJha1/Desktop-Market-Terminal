const KEY_PREFIX = "dailyiq:minichart:";

function keyFor(tabId: string, componentId: string): string {
  return `${KEY_PREFIX}${tabId}:${componentId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function readMiniChartConfig(
  tabId: string,
  componentId: string,
): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(keyFor(tabId, componentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeMiniChartConfig(
  tabId: string,
  componentId: string,
  config: Record<string, unknown>,
): void {
  try {
    window.localStorage.setItem(keyFor(tabId, componentId), JSON.stringify(config));
  } catch {
    // Ignore storage failures.
  }
}

export function removeMiniChartConfig(tabId: string, componentId: string): void {
  try {
    window.localStorage.removeItem(keyFor(tabId, componentId));
  } catch {
    // Ignore storage failures.
  }
}

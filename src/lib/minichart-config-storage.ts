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

/** Merge workspace minichart config with localStorage (dashboard hydration). */
export function mergePersistedMiniChartConfig(
  tabId: string,
  componentId: string,
  workspaceConfig: Record<string, unknown>,
): Record<string, unknown> {
  const persisted = readMiniChartConfig(tabId, componentId);
  if (!persisted) return workspaceConfig;
  const merged = { ...persisted, ...workspaceConfig };
  if (Array.isArray(persisted.indicators)) {
    merged.indicators = persisted.indicators;
  }
  if (typeof persisted.legendCollapsed === "boolean") {
    merged.legendCollapsed = persisted.legendCollapsed;
  }
  const pw = persisted.probEngWidget;
  if (
    pw &&
    typeof pw === "object" &&
    !Array.isArray(pw) &&
    typeof (pw as { x?: unknown }).x === "number" &&
    typeof (pw as { y?: unknown }).y === "number"
  ) {
    merged.probEngWidget = { ...(pw as Record<string, unknown>) };
  }
  return merged;
}

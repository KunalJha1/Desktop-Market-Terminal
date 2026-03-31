import type { CustomStrategyDefinition } from "./customStrategies";

const STORAGE_KEY = "dailyiq-chart-custom-strategies";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStrategy(value: unknown): CustomStrategyDefinition | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string" || !Array.isArray(value.conditions)) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    conditions: value.conditions as CustomStrategyDefinition["conditions"],
    buyThreshold: typeof value.buyThreshold === "number" ? value.buyThreshold : 70,
    sellThreshold: typeof value.sellThreshold === "number" ? value.sellThreshold : 30,
  };
}

export function loadCustomStrategies(): CustomStrategyDefinition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeStrategy(item))
      .filter((item): item is CustomStrategyDefinition => item !== null);
  } catch {
    return [];
  }
}

export function saveCustomStrategies(strategies: CustomStrategyDefinition[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(strategies));
    window.dispatchEvent(new CustomEvent("dailyiq-strategies-updated"));
  } catch {
    // Ignore storage failures.
  }
}

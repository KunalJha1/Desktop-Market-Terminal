/** 10 link channels, each with a distinct color */
export const LINK_CHANNELS = [
  { id: 1, color: "#3b82f6", label: "Blue" },
  { id: 2, color: "#ef4444", label: "Red" },
  { id: 3, color: "#22c55e", label: "Green" },
  { id: 4, color: "#f59e0b", label: "Amber" },
  { id: 5, color: "#a855f7", label: "Purple" },
  { id: 6, color: "#ec4899", label: "Pink" },
  { id: 7, color: "#06b6d4", label: "Cyan" },
  { id: 8, color: "#f97316", label: "Orange" },
  { id: 9, color: "#84cc16", label: "Lime" },
  { id: 10, color: "#e879f9", label: "Fuchsia" },
] as const;

export type LinkChannel = (typeof LINK_CHANNELS)[number];

export function getChannelById(id: number | null) {
  return LINK_CHANNELS.find((c) => c.id === id) ?? null;
}

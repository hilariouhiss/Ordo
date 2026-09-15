/** Preset palette shared by projects, namespaces and tags; `null` = no colour. */
export const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#78716c",
] as const;

/**
 * A palette colour for an entity created without one (R3).
 *
 * Callers distinguish「未指定」(`undefined`) from an explicit `null` =「无颜色」:
 * only the former is randomized, so a user who picks 无 still gets 无.
 */
export function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

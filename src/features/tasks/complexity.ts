/**
 * The complexity vocabulary: one definition serves the task editor, the
 * subtask panel and the detail badges.
 *
 * `optionValue` returns a string, not a number: Kobalte's Select treats `""`
 * as "nothing selected" and renders a blank trigger, so 未评估 travels as the
 * sentinel `"none"` (the same reason `quick-add`'s project picker does).
 */

export const COMPLEXITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "未评估" },
  { value: "1", label: "1 · 很简单" },
  { value: "2", label: "2 · 简单" },
  { value: "3", label: "3 · 一般" },
  { value: "4", label: "4 · 复杂" },
  { value: "5", label: "5 · 很复杂" },
];

/** Stored value → the Select's sentinel value. */
export function complexityOptionValue(value: number | null | undefined): string {
  return value == null ? "none" : String(value);
}

/** The Select's sentinel value → the stored value. */
export function complexityFromOption(value: string): number | null {
  return value === "none" ? null : Number(value);
}

/** Badge text for a set complexity; `null` when there is nothing to show. */
export function complexityLabel(value: number | null | undefined): string | null {
  return value == null ? null : `复杂度 ${value}`;
}

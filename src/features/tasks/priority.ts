/**
 * The app's priority vocabulary. One definition serves the task editor's
 * select, the quick-add control row and the `!高/!中/!低` markers, so a label
 * can never drift between what the UI offers and what the parser accepts.
 */

import type { Priority } from "./types";

export const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
  { value: "none", label: "无" },
];

/** Human label for a priority (`无` for `none`). */
export function priorityLabel(priority: Priority): string {
  return PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? "无";
}

/** `高` → `high`; `null` when the label is not a priority. */
export function priorityFromLabel(label: string): Priority | null {
  return PRIORITY_OPTIONS.find((option) => option.label === label)?.value ?? null;
}

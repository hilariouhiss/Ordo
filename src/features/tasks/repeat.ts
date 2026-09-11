/**
 * Presentation helpers for repeat rules, shared by the editor, task rows and
 * the detail dialog.
 */
import type { RepeatFreq, RepeatRule } from "./types";

/** Unit label per frequency, as in 「每天 / 每 2 周 / 每 3 月」. */
export const REPEAT_FREQ_UNITS: Record<RepeatFreq, string> = {
  daily: "天",
  weekly: "周",
  monthly: "月",
};

/** Editor options: no rule, or one of the three frequencies. */
export const REPEAT_FREQ_OPTIONS: Array<{ value: RepeatFreq | "none"; label: string }> = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
];

/** Short human description, e.g. 「每天」「每 2 周」「每月（已暂停）」. */
export function describeRepeatRule(rule: RepeatRule): string {
  const unit = REPEAT_FREQ_UNITS[rule.freq];
  const base = rule.interval === 1 ? `每${unit}` : `每 ${rule.interval} ${unit}`;
  return rule.paused ? `${base}（已暂停）` : base;
}

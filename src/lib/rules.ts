import { t } from "./i18n";

const DAY_KEYS = [
  "date.mon",
  "date.tue",
  "date.wed",
  "date.thu",
  "date.fri",
  "date.sat",
  "date.sun",
] as const;

/** ISO weekday (Monday = 1) the way the interface names it. */
export function weekdayName(weekday: number): string {
  return t(DAY_KEYS[weekday - 1] ?? DAY_KEYS[0]);
}

/** "周四 09:00" / "Mon, Fri at 13:30". */
export function ruleSummary(rule: { weekdays: number[]; at: string }): string {
  const days = [...rule.weekdays]
    .sort((a, b) => a - b)
    .map(weekdayName)
    .join(t("rule.dayJoin"));
  return t("rule.schedule", { days, time: rule.at });
}

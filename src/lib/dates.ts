import { t } from "./i18n";

export function isoOf(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${day}`;
}

export function todayIso(): string {
  return isoOf(new Date());
}

/** The local calendar day of an RFC3339 timestamp. */
export function localDate(timestamp: string): string {
  return isoOf(new Date(timestamp));
}

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
export function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

const WEEKDAY_KEYS = [
  "date.sun",
  "date.mon",
  "date.tue",
  "date.wed",
  "date.thu",
  "date.fri",
  "date.sat",
] as const;

export function weekdayLabel(iso: string): string {
  return t(WEEKDAY_KEYS[weekdayOf(iso)]);
}

export function isWeekend(iso: string): boolean {
  const weekday = weekdayOf(iso);
  return weekday === 0 || weekday === 6;
}

export function addDays(iso: string, offset: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + offset);
  return isoOf(date);
}

/** The Monday of the week that contains `iso`. */
export function mondayOf(iso: string): string {
  return addDays(iso, -((weekdayOf(iso) + 6) % 7));
}

/** The local "M/D HH:MM" of an RFC3339 timestamp, or an empty string when missing. */
export function shortDateTime(timestamp: string | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${shortDate(isoOf(date))} ${hours}:${minutes}`;
}

/**
 * The workdays of the week the page shows: Monday to Friday. A weekend rolls forward to
 * the next Monday, so the page never opens on a blank weekend.
 */
export function weekWorkdays(today: string): string[] {
  const monday = isWeekend(today) ? addDays(today, (8 - weekdayOf(today)) % 7) : mondayOf(today);
  return [0, 1, 2, 3, 4].map((offset) => addDays(monday, offset));
}

import { t } from "./i18n";

function isoOf(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${day}`;
}

export function todayIso(): string {
  return isoOf(new Date());
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

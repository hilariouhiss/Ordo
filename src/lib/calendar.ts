import { isoOf, weekdayOf } from "./dates";

export interface MonthView {
  year: number;
  /** Zero-based, 0 = January. */
  month: number;
}

const WEEK_LENGTH = 7;
const WEEKS = 6;

export function monthOf(iso: string): MonthView {
  const [year, month] = iso.split("-").map(Number);
  return { year, month: month - 1 };
}

export function shiftMonth(view: MonthView, delta: number): MonthView {
  const date = new Date(view.year, view.month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/** Six Monday-first weeks, with Monday = index 0. */
export function monthMatrix(year: number, month: number): (string | null)[] {
  const first = isoOf(new Date(year, month, 1));
  const leading = (weekdayOf(first) + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: WEEKS * WEEK_LENGTH }, (_, index) => {
    const day = index - leading + 1;
    return day >= 1 && day <= days ? isoOf(new Date(year, month, day)) : null;
  });
}

/** The parts of a real calendar date, or null for 2/30 and leap-day misses. */
export function dateFromParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return isoOf(date);
}

/** Accepts YYYY-MM-DD or YYYY/M/D; empty means "no date", invalid means null. */
export function parseDateInput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (!match) return null;
  return dateFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function formatDateInput(iso: string): string {
  return iso ? iso.replaceAll("-", "/") : "";
}

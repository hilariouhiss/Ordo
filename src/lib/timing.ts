import { addDays, isWeekend } from "./dates";
import { MINUTES_PER_DAY } from "./effort";

/** The same day, or the next Monday when it falls on a weekend. */
export function workdayOnOrAfter(iso: string): string {
  let day = iso;
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}

function nextWorkday(iso: string): string {
  return workdayOnOrAfter(addDays(iso, 1));
}

/**
 * The day the estimated work ends: whole eight-hour days counted from the anchor,
 * skipping weekends. One hour of work still ends on the anchor day. The backend owns
 * the stored value; this mirrors it so the capture box can show the date as you type.
 */
export function finishForEffort(anchor: string, effortMinutes: number): string {
  const days = Math.max(1, Math.ceil(Math.max(1, effortMinutes) / MINUTES_PER_DAY));
  let day = workdayOnOrAfter(anchor);
  for (let left = 1; left < days; left++) day = nextWorkday(day);
  return day;
}

/** Work starts today unless the task already carries a later expected start. */
export function timingAnchor(today: string, expectedStartDate?: string | null): string {
  const start = expectedStartDate && expectedStartDate > today ? expectedStartDate : today;
  return workdayOnOrAfter(start);
}

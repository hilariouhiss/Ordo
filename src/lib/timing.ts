import { addDays, isWeekend } from "./dates";
import { EFFORT_MAX_MINUTES, MINUTES_PER_DAY } from "./effort";

/** The same day, or the next Monday when it falls on a weekend. */
export function workdayOnOrAfter(iso: string): string {
  let day = iso;
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}

/** The same day, or the Friday before when it falls on a weekend. */
export function workdayOnOrBefore(iso: string): string {
  let day = iso;
  while (isWeekend(day)) day = addDays(day, -1);
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

/** The whole-day estimate a chosen finish day implies, mirrored by the backend. */
export function effortForFinish(anchor: string, finishDay: string): number | null {
  const finish = workdayOnOrBefore(finishDay);
  if (finish < anchor) return null;
  const maxDays = EFFORT_MAX_MINUTES / MINUTES_PER_DAY;
  let days = 0;
  let day = workdayOnOrAfter(anchor);
  while (day <= finish) {
    if (!isWeekend(day)) {
      days += 1;
      if (days > maxDays) return null;
    }
    day = addDays(day, 1);
  }
  return days === 0 ? null : days * MINUTES_PER_DAY;
}

/** Work starts today unless the task already carries a later expected start. */
export function timingAnchor(today: string, expectedStartDate?: string | null): string {
  const start = expectedStartDate && expectedStartDate > today ? expectedStartDate : today;
  return workdayOnOrAfter(start);
}

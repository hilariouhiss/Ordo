import { t } from "./i18n";

/** Effort is minutes of work: one minute up to 480 hours (sixty eight-hour days). */
export const EFFORT_MIN_MINUTES = 1;
export const EFFORT_MAX_MINUTES = 28800;
/** Arrow keys move a quarter hour. */
export const EFFORT_STEP_MINUTES = 15;

export function validEffort(minutes: number): boolean {
  return (
    Number.isInteger(minutes) && minutes >= EFFORT_MIN_MINUTES && minutes <= EFFORT_MAX_MINUTES
  );
}

/** One task day is eight hours, so a day is 480 minutes. */
export const MINUTES_PER_DAY = 480;

export function splitEffort(minutes: number): {
  days: number;
  hours: number;
  minutes: number;
} {
  const total = Math.min(EFFORT_MAX_MINUTES, Math.max(0, Math.round(minutes)));
  return {
    days: Math.floor(total / MINUTES_PER_DAY),
    hours: Math.floor((total % MINUTES_PER_DAY) / 60),
    minutes: total % 60,
  };
}

export function joinEffort(days: number, hours: number, minutes: number): number {
  return days * MINUTES_PER_DAY + hours * 60 + minutes;
}

/** "1 天 2 小时 30 分" / "45 分钟" / "2 天". */
export function formatEffort(minutes: number): string {
  const split = splitEffort(minutes);
  const parts: string[] = [];
  if (split.days) parts.push(t("effort.days", { days: split.days }));
  if (split.hours) parts.push(t("effort.hours", { hours: split.hours }));
  if (split.minutes) {
    const key = parts.length ? "effort.minutesShort" : "effort.minutes";
    parts.push(t(key, { minutes: split.minutes }));
  }
  return parts.length ? parts.join(" ") : t("effort.minutes", { minutes: 0 });
}

/** Reads "2:30", "90", "1.5h", "2小时30分" or "30m"; anything else is null. */
export function parseEffortText(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const total = readEffortText(text);
  return total !== null && validEffort(total) ? total : null;
}

function readEffortText(text: string): number | null {
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(text);
  if (clock) return joinEffort(0, Number(clock[1]), Number(clock[2]));
  const combined = /^(\d+)\s*小时\s*(\d+)\s*分$/.exec(text);
  if (combined) return joinEffort(0, Number(combined[1]), Number(combined[2]));
  const hours = /^(\d+(?:\.\d+)?)\s*(?:个?小时|h|hr|hours?)$/i.exec(text);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const minutes = /^(\d+(?:\.\d+)?)\s*(?:分钟|分|m|mins?|minutes?)$/i.exec(text);
  if (minutes) return Math.round(Number(minutes[1]));
  const bare = /^\d+$/.exec(text);
  return bare ? Number(text) : null;
}

export function stepEffort(minutes: number, direction: 1 | -1): number {
  const stepped = minutes + direction * EFFORT_STEP_MINUTES;
  return Math.min(EFFORT_MAX_MINUTES, Math.max(EFFORT_MIN_MINUTES, stepped));
}

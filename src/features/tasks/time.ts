/**
 * Time-tracking presentation helpers (TE-01): displaying tracked lengths and
 * bridging `<input type="datetime-local">` values to local `Date`s. The plan's
 * timezone rule applies — instants are stored UTC, entered and shown local.
 */

import { format, parse } from "date-fns";

/**
 * Human-readable tracked length: seconds below a minute, whole minutes below
 * an hour, then hours (with minutes once they matter).
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

/** Zero-padded `HH:MM:SS` readout for a running timer. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (value: number): string => String(value).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(total % 60)}`;
}

/** Formats a local instant as a `datetime-local` input value. */
export function toLocalInputValue(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

/** Parses a `datetime-local` input value into a local `Date`. */
export function fromLocalInputValue(value: string): Date {
  return parse(value, "yyyy-MM-dd'T'HH:mm", new Date());
}

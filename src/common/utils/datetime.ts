import { format } from "date-fns";

/**
 * Conversion between backend ISO-8601 UTC timestamps and the value format of
 * `<input type="datetime-local">` ("yyyy-MM-dd'T'HH:mm", interpreted in the
 * user's timezone). Due dates are stored in UTC; local boundaries are the
 * frontend's business (plan §3).
 */

/** UTC ISO timestamp → `datetime-local` value string; `""` when unset/invalid. */
export function isoToLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

/** `datetime-local` value string → UTC ISO timestamp; `null` when empty/invalid. */
export function localInputValueToIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** UTC ISO timestamp → `date` input value ("yyyy-MM-dd", local); `""` when unset/invalid. */
export function isoToLocalDateValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "yyyy-MM-dd");
}

/**
 * `date` input value → UTC ISO timestamp, interpreted as the end of that
 * local day (a project due "9月15日" stays doable through the 15th);
 * `null` when empty/invalid.
 */
export function localDateValueToIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(`${local}T23:59:59`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Range and bucket arithmetic for the statistics view.
 *
 * The backend aggregates over a half-open `[from, to)` UTC window and labels
 * each bucket with a *local* date (ST-01's `offsetMinutes`). The frontend owns
 * the other half of that contract: it turns the presets into local day
 * boundaries, states the offset, and lays out the axis the backend may have
 * left gaps in — a bucket with no activity is simply absent from the response.
 */

import {
  addDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  format,
  parse,
  startOfDay,
  startOfYear,
  subDays,
} from "date-fns";
import type { StatsGranularity } from "./types";

/** Range presets offered by the view (PRD 3.1: 近 7 天 / 30 天 / 本年). */
export type StatsRangeKey = "7d" | "30d" | "year";

export const RANGE_OPTIONS: readonly { value: StatsRangeKey; label: string }[] = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "year", label: "本年" },
];

export interface StatsRange {
  /** Inclusive start: local midnight of the first day, as a UTC instant. */
  from: string;
  /** Exclusive end: local midnight of the day after the last one. */
  to: string;
  granularity: StatsGranularity;
  /** `-getTimezoneOffset()`, so backend buckets land on the user's days. */
  offsetMinutes: number;
  /** Every local day covered, `yyyy-MM-dd` — the heatmap's cells. */
  days: string[];
}

/** Local `yyyy-MM-dd` label of a date — the format the backend buckets with. */
export function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Parses one of those labels back into a local date. */
export function parseDayKey(key: string): Date {
  return parse(key, "yyyy-MM-dd", new Date());
}

/** Turns a range preset into the window and axis the view queries. */
export function rangeSpec(key: StatsRangeKey, now: Date = new Date()): StatsRange {
  const today = startOfDay(now);
  const firstDay =
    key === "year" ? startOfYear(today) : subDays(today, key === "7d" ? 6 : 29);

  return {
    from: firstDay.toISOString(),
    to: addDays(today, 1).toISOString(),
    granularity: key === "year" ? "week" : "day",
    offsetMinutes: -now.getTimezoneOffset(),
    days: eachDayOfInterval({ start: firstDay, end: today }).map(dayKey),
  };
}

/**
 * Bucket labels the axis should show, matching the backend's labels exactly:
 * the local date (day), the Monday of the week, or `yyyy-MM` (month).
 */
export function bucketKeys(range: StatsRange): string[] {
  const span = {
    start: parseDayKey(range.days[0]),
    end: parseDayKey(range.days[range.days.length - 1]),
  };

  switch (range.granularity) {
    case "day":
      return range.days;
    case "week":
      return eachWeekOfInterval(span, { weekStartsOn: 1 }).map(dayKey);
    case "month":
      return eachMonthOfInterval(span).map((date) => format(date, "yyyy-MM"));
  }
}

/** Values for `keys` in order; buckets the backend omitted read as zero. */
export function fillSeries(
  keys: readonly string[],
  points: readonly { bucket: string; value: number }[],
): number[] {
  const byBucket = new Map(points.map((point) => [point.bucket, point.value]));
  return keys.map((key) => byBucket.get(key) ?? 0);
}

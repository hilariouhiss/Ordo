import { addDays, weekdayOf } from "./dates";
import type { DayStats, StatsSlice } from "../model/types";

const DAY = 86_400_000;

export type Granularity = "day" | "week" | "month";

/** Local `YYYY-MM-DD` range, inclusive on both ends. */
export interface StatsRange {
  from: string;
  to: string;
}

/** One column of the completion trend chart. */
export interface StatsBucket {
  /** Local `YYYY-MM-DD` (day buckets) or the bucket's first day. */
  key: string;
  completed: number;
  created: number;
}

export interface HeatmapCell {
  date: string;
  completed: number;
}

/** A weekday-by-week grid: rows run Monday..Sunday, columns run week by week. */
export interface HeatmapRow {
  weekday: number;
  cells: HeatmapCell[];
}

/** How the page names an unset grouping so the chart is never blank. */
export interface BreakdownRow {
  name: string | null;
  completed: number;
  minutes: number;
  /** The merged remainder after the visible ranks. */
  merged: boolean;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY);
}

/** Inclusive day count; 0 when the range is backwards. */
export function rangeDays(range: StatsRange): number {
  const days = daysBetween(range.from, range.to) + 1;
  return days > 0 ? days : 0;
}

/** A month of daily columns is still readable; past that, weeks, then months. */
export function granularityFor(range: StatsRange): Granularity {
  const days = rangeDays(range);
  if (days <= 35) return "day";
  if (days <= 182) return "week";
  return "month";
}

function bucketKey(date: string, granularity: Granularity): string {
  if (granularity === "month") return date.slice(0, 7);
  if (granularity === "week") return addDays(date, -((weekdayOf(date) + 6) % 7));
  return date;
}

/** Pads the sparse daily rows into one bucket per column, in range order. */
export function bucketize(
  range: StatsRange,
  daily: DayStats[],
  granularity: Granularity,
): StatsBucket[] {
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const buckets: StatsBucket[] = [];
  const seen = new Set<string>();
  const days = rangeDays(range);
  for (let i = 0; i < days; i += 1) {
    const date = addDays(range.from, i);
    const key = bucketKey(date, granularity);
    if (!seen.has(key)) {
      seen.add(key);
      buckets.push({ key, completed: 0, created: 0 });
    }
    const day = byDate.get(date);
    if (!day) continue;
    const bucket = buckets[buckets.length - 1];
    bucket.completed += day.completed;
    bucket.created += day.created;
  }
  return buckets;
}

/** At most `max` ticks, always including the first column. */
export function labelStride(count: number, max = 8): number {
  if (count <= 0) return 1;
  return Math.max(1, Math.ceil(count / max));
}

/**
 * The row/column grid behind both heatmap shapes. Cells outside the range stay
 * in the grid so the weekday rows keep their alignment, and are marked empty by
 * a null `completed`.
 */
export function heatmapGrid(
  range: StatsRange,
  daily: DayStats[],
): { rows: HeatmapRow[]; weeks: string[] } {
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const firstMonday = addDays(range.from, -((weekdayOf(range.from) + 6) % 7));
  const days = rangeDays(range);
  const last = days > 0 ? addDays(range.from, days - 1) : range.from;
  const weeks: string[] = [];
  for (let week = firstMonday; week <= last; week = addDays(week, 7)) weeks.push(week);

  const rows: HeatmapRow[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    cells: weeks.map((week) => {
      const date = addDays(week, weekday);
      const inRange = date >= range.from && date <= last;
      if (!inRange) return { date, completed: -1 };
      return { date, completed: byDate.get(date)?.completed ?? 0 };
    }),
  }));
  return { rows, weeks };
}

/** Totals per weekday, Monday first, for the weekday distribution chart. */
export function weekdayTotals(daily: DayStats[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const day of daily) totals[(weekdayOf(day.date) + 6) % 7] += day.completed;
  return totals;
}

/** The busiest day, or null when nothing was completed. */
export function busiestDay(daily: DayStats[]): { date: string; completed: number } | null {
  let best: { date: string; completed: number } | null = null;
  for (const day of daily) {
    if (day.completed <= 0) continue;
    if (!best || day.completed > best.completed)
      best = { date: day.date, completed: day.completed };
  }
  return best;
}

/**
 * Sorts the grouping largest first and merges everything past `limit` into one
 * remainder row, so the bar column keeps a readable number of labels.
 */
export function breakdownRows(slices: StatsSlice[], limit: number): BreakdownRow[] {
  const sorted = [...slices].sort((a, b) => b.completed - a.completed || b.minutes - a.minutes);
  const rows = sorted.map((slice) => ({
    name: slice.name,
    completed: slice.completed,
    minutes: slice.minutes,
    merged: false,
  }));
  if (rows.length <= limit) return rows;
  const rest = rows.slice(limit);
  return [
    ...rows.slice(0, limit),
    {
      name: null,
      completed: rest.reduce((sum, row) => sum + row.completed, 0),
      minutes: rest.reduce((sum, row) => sum + row.minutes, 0),
      merged: true,
    },
  ];
}

/** Percentages are rounded for display; an empty denominator has no rate. */
export function onTimeRate(onTime: number, withDue: number): number | null {
  return withDue > 0 ? Math.round((onTime / withDue) * 100) : null;
}

/** Person-days keep one decimal below ten and drop the decimal above. */
export function personDays(minutes: number): string {
  const days = minutes / 480;
  return days >= 10 ? String(Math.round(days)) : days.toFixed(1);
}

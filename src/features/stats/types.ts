/**
 * Statistics-domain types mirroring the Rust models (`src-tauri/src/models.rs`).
 *
 * Statistics is read-only and derived: nothing here is persisted or
 * optimistically updated, so this feature has no store — the view holds its
 * data in hook-local signals.
 */

/** Bucket width of a series; the week bucket is labelled by its Monday. */
export type StatsGranularity = "day" | "week" | "month";

/** Dimension `stats:timeDistribution` splits tracked time by. */
export type TimeGroupBy = "project" | "tag";

/** One completion-curve point; `bucket` is `yyyy-MM-dd` (day/week) or `yyyy-MM`. */
export interface TrendPoint {
  bucket: string;
  completed: number;
}

/** One live project's tally; rate and remaining count derive from these. */
export interface ProjectProgress {
  projectId: string;
  name: string;
  total: number;
  completed: number;
  dueAt: string | null;
}

/** Tracked time of one project or tag; `id`/`name` are null for inbox time. */
export interface TimeShare {
  id: string | null;
  name: string | null;
  seconds: number;
}

/** Tracked time inside one period bucket. */
export interface TimePoint {
  bucket: string;
  seconds: number;
}

/** `stats:timeDistribution` response. */
export interface TimeDistribution {
  groups: TimeShare[];
  buckets: TimePoint[];
}

/** Query payload shared by the range-based statistics commands. */
export interface StatsQuery {
  /** Inclusive start, a UTC instant computed from a local day boundary. */
  from: string;
  /** Exclusive end (the local midnight after the last day). */
  to: string;
  granularity: StatsGranularity;
  /** `-new Date().getTimezoneOffset()`: buckets follow the user's calendar. */
  offsetMinutes: number;
}

export interface TimeDistributionQuery extends StatsQuery {
  groupBy: TimeGroupBy;
}

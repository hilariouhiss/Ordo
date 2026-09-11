/**
 * Data hook for the statistics view. Statistics is read-only and derived, so
 * there is no store: the view gets its series straight from `useStats`.
 *
 * Two independent loads share one failure flag: the range-dependent series
 * (re-queried whenever the range or the distribution dimension changes) and
 * the project tallies (fetched once — they do not depend on the range).
 * Out-of-order responses are dropped by request sequence, so switching ranges
 * quickly can never paint a stale window; until a new response lands the
 * previous one stays on screen instead of blanking the charts.
 */

import { createEffect, createMemo, createSignal, on, onMount } from "solid-js";
import * as api from "./api";
import { bucketKeys, fillSeries, type StatsRange } from "./series";
import type { ProjectProgress, TimeDistribution, TimeGroupBy, TrendPoint } from "./types";

export interface StatsData {
  /** Completions per axis bucket, aligned with `bucketKeys(range)`. */
  trend: () => number[];
  /** Completions per local day, aligned with `range.days` (heatmap). */
  daily: () => number[];
  /** Tracked seconds per axis bucket, aligned with `bucketKeys(range)`. */
  tracked: () => number[];
  /** Tracked time per project/tag over the range. */
  shares: () => TimeDistribution["groups"];
  /** Per-project tallies (range-independent). */
  projects: () => ProjectProgress[];
  /** Some data has been loaded; used to gate the first loading state. */
  ready: () => boolean;
  failed: () => boolean;
  retry: () => void;
}

/** Values of `points` for `keys`, as the chart series want them. */
function series(
  keys: () => string[],
  points: () => TrendPoint[],
): () => number[] {
  return () => fillSeries(keys(), points().map((point) => ({
    bucket: point.bucket,
    value: point.completed,
  })));
}

export function useStats(
  range: () => StatsRange,
  groupBy: () => TimeGroupBy,
): StatsData {
  const [trendPoints, setTrendPoints] = createSignal<TrendPoint[]>([]);
  const [dailyPoints, setDailyPoints] = createSignal<TrendPoint[]>([]);
  const [distribution, setDistribution] = createSignal<TimeDistribution>({
    groups: [],
    buckets: [],
  });
  const [projects, setProjects] = createSignal<ProjectProgress[]>([]);
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let seq = 0;

  async function loadRange(spec: StatsRange, dimension: TimeGroupBy): Promise<void> {
    const request = ++seq;
    // The heatmap always wants daily buckets; the line wants the range's own
    // width. For day ranges that is one request, shared by both.
    const daily =
      spec.granularity === "day"
        ? api.completionTrend(spec)
        : api.completionTrend({ ...spec, granularity: "day" });

    try {
      const [trend, days, shares] = await Promise.all([
        spec.granularity === "day" ? daily : api.completionTrend(spec),
        daily,
        api.timeDistribution({ ...spec, groupBy: dimension }),
      ]);
      if (request !== seq) return;
      setTrendPoints(trend);
      setDailyPoints(days);
      setDistribution(shares);
      setFailed(false);
      setReady(true);
    } catch {
      if (request !== seq) return;
      setFailed(true);
    }
  }

  async function loadProjects(): Promise<void> {
    try {
      setProjects(await api.projectProgress());
    } catch {
      setFailed(true);
    }
  }

  createEffect(
    on([range, groupBy], ([spec, dimension]) => {
      void loadRange(spec, dimension);
    }),
  );

  onMount(() => {
    void loadProjects();
  });

  const keys = createMemo(() => bucketKeys(range()));
  const buckets = createMemo(() =>
    distribution().buckets.map((point) => ({ bucket: point.bucket, value: point.seconds })),
  );

  return {
    trend: series(keys, trendPoints),
    daily: () => fillSeries(range().days, dailyPoints().map((point) => ({
      bucket: point.bucket,
      value: point.completed,
    }))),
    tracked: () => fillSeries(keys(), buckets()),
    shares: () => distribution().groups,
    projects,
    ready,
    failed,
    retry: () => {
      setFailed(false);
      void loadProjects();
      void loadRange(range(), groupBy());
    },
  };
}

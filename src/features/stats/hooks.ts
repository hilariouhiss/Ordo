/**
 * Data hooks for the statistics domain. Statistics is read-only and derived, so
 * there is no store: the stats view gets its series straight from `useStats`,
 * and a surface that only wants the project tally uses `useProjectProgress`.
 *
 * Two independent loads share one failure flag: the range-dependent series
 * (re-queried whenever the range or the distribution dimension changes) and
 * the project tallies (fetched once — they do not depend on the range).
 * Out-of-order responses are dropped by request sequence, so switching ranges
 * quickly can never paint a stale window; until a new response lands the
 * previous one stays on screen instead of blanking the charts — axis included,
 * because each answer carries the bucket labels it was loaded for.
 */

import { createEffect, createSignal, on, onMount } from "solid-js";
import * as api from "./api";
import { bucketKeys, fillSeries, type StatsRange } from "./series";
import type { ProjectProgress, TimeDistribution, TimeGroupBy, TrendPoint } from "./types";

export interface StatsData {
  /** Axis labels the two series below were bucketed for, not the range the
   * view currently has selected: the two only match once the answer lands. */
  keys: () => string[];
  /** Local days the heatmap covers, same contract as `keys`. */
  days: () => string[];
  /** Completions per axis bucket, aligned with `keys()`. */
  trend: () => number[];
  /** Completions per local day, aligned with `days()` (heatmap). */
  daily: () => number[];
  /** Tracked seconds per axis bucket, aligned with `keys()`. */
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

/**
 * One range's answer, stored as a unit. The axis labels travel with the points
 * they were computed for, so a range switch cannot pair the new axis with the
 * old response — every bucket of the new axis is absent from the old points,
 * and the charts would read as a screen of zeros until the answer landed.
 */
interface RangeAnswer {
  keys: string[];
  days: string[];
  trend: TrendPoint[];
  daily: TrendPoint[];
  distribution: TimeDistribution;
}

const NO_ANSWER: RangeAnswer = {
  keys: [],
  days: [],
  trend: [],
  daily: [],
  distribution: { groups: [], buckets: [] },
};

/** Buckets of `points` as the chart series want them. */
function values(points: readonly TrendPoint[]): { bucket: string; value: number }[] {
  return points.map((point) => ({ bucket: point.bucket, value: point.completed }));
}

export function useStats(
  range: () => StatsRange,
  groupBy: () => TimeGroupBy,
): StatsData {
  const [answer, setAnswer] = createSignal<RangeAnswer>(NO_ANSWER);
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
      setAnswer({
        keys: bucketKeys(spec),
        days: spec.days,
        trend,
        daily: days,
        distribution: shares,
      });
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

  const buckets = () =>
    answer().distribution.buckets.map((point) => ({
      bucket: point.bucket,
      value: point.seconds,
    }));

  return {
    keys: () => answer().keys,
    days: () => answer().days,
    trend: () => fillSeries(answer().keys, values(answer().trend)),
    daily: () => fillSeries(answer().days, values(answer().daily)),
    tracked: () => fillSeries(answer().keys, buckets()),
    shares: () => answer().distribution.groups,
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

export interface ProjectProgressData {
  /** 每项目计数（只含存活项目、只算顶层任务）。 */
  tallies: () => ProjectProgress[];
  /** 已经拿到过响应（成功或失败都算落地）。 */
  ready: () => boolean;
  failed: () => boolean;
}

/**
 * 只要那一笔项目计数时用它：统计页的 `useStats` 还带着 range、维度与序列
 * 对齐，命名空间页要的是同一口径（存活项目、顶层任务）的裸聚合。挂载时取
 * 一次；失败只标记，不弹通知（页面的项目列表照常可用）。
 */
export function useProjectProgress(): ProjectProgressData {
  const [tallies, setTallies] = createSignal<ProjectProgress[]>([]);
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);

  onMount(async () => {
    try {
      setTallies(await api.projectProgress());
    } catch {
      setFailed(true);
    } finally {
      setReady(true);
    }
  });

  return { tallies, ready, failed };
}

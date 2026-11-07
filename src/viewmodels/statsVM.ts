import { computed, reactive } from "vue";
import { addDays, todayIso } from "../lib/dates";
import { askNotice } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import {
  bucketize,
  busiestDay,
  daysBetween,
  granularityFor,
  heatmapGrid,
  onTimeRate,
  personDays,
  weekdayTotals,
} from "../lib/stats";
import { statsOverview } from "../model/ipc";
import type { StatsOverview } from "../model/types";

export type StatsPreset = "30d" | "12w" | "year" | "custom";

/** Presets the page offers, shortest first; the view maps them to labels. */
export const STATS_PRESETS: StatsPreset[] = ["30d", "12w", "year", "custom"];

/** A year and a day, matching the service's own ceiling. */
const MAX_RANGE_DAYS = 366;

/** Stands in before the first payload so the view never juggles nulls. */
function emptyOverview(): StatsOverview {
  return {
    from: "",
    to: "",
    completed: 0,
    created: 0,
    completedMinutes: 0,
    onTime: 0,
    withDue: 0,
    delayed: 0,
    daily: [],
    byProject: [],
    byCategory: [],
    previousCompleted: 0,
    previousMinutes: 0,
    previousOnTime: 0,
    previousWithDue: 0,
    previousDelayed: 0,
  };
}

export function createStatsVM() {
  const firstToday = todayIso();
  const state = reactive({
    preset: "30d" as StatsPreset,
    today: firstToday,
    /** The range the current query was built from. */
    from: addDays(firstToday, -29),
    to: firstToday,
    /** Custom-range drafts, kept apart so a half-typed range does not refetch. */
    customFrom: addDays(firstToday, -29),
    customTo: firstToday,
    /** Null until the first payload lands, so the view can tell loading from empty. */
    data: null as StatsOverview | null,
    loading: false,
    /** A failed read leaves the previous charts up but says so under the header. */
    failed: false,
  });

  const data = computed(() => state.data ?? emptyOverview());
  const range = computed(() => ({ from: state.from, to: state.to }));
  const span = computed(() => Math.max(0, daysBetween(range.value.from, range.value.to) + 1));
  const granularity = computed(() => granularityFor(range.value));

  const hasActivity = computed(() => {
    const d = state.data;
    return !!d && (d.completed > 0 || d.created > 0 || d.delayed > 0);
  });

  const buckets = computed(() => bucketize(range.value, data.value.daily, granularity.value));
  const heatmap = computed(() => heatmapGrid(range.value, data.value.daily));
  const compactHeatmap = computed(() => heatmap.value.weeks.length <= 14);
  const weekday = computed(() => weekdayTotals(data.value.daily));
  const busiest = computed(() => busiestDay(data.value.daily));
  const projects = computed(() => data.value.byProject);
  const categories = computed(() => data.value.byCategory);

  const rate = computed(() => onTimeRate(data.value.onTime, data.value.withDue));
  const previousRate = computed(() =>
    onTimeRate(data.value.previousOnTime, data.value.previousWithDue),
  );
  /** Whether the previous window carried anything worth comparing against. */
  const hasPrevious = computed(() => {
    const d = data.value;
    return d.previousCompleted > 0 || d.previousWithDue > 0 || d.previousDelayed > 0;
  });

  const completedDelta = computed(() =>
    hasPrevious.value ? data.value.completed - data.value.previousCompleted : null,
  );
  const minutesDelta = computed(() =>
    hasPrevious.value ? (data.value.completedMinutes - data.value.previousMinutes) / 480 : null,
  );
  const rateDelta = computed(() =>
    rate.value !== null && previousRate.value !== null ? rate.value - previousRate.value : null,
  );
  const delayedDelta = computed(() =>
    hasPrevious.value ? data.value.delayed - data.value.previousDelayed : null,
  );

  const completedDays = computed(() => personDays(data.value.completedMinutes));
  const completedHours = computed(() => Math.round(data.value.completedMinutes / 60));

  /** The preset window, anchored on the page's own idea of today. */
  function presetRange(preset: StatsPreset): { from: string; to: string } {
    const to = state.today;
    if (preset === "12w") return { from: addDays(to, -83), to };
    if (preset === "year") return { from: `${to.slice(0, 4)}-01-01`, to };
    if (preset === "custom") {
      return { from: state.customFrom || addDays(to, -29), to: state.customTo || to };
    }
    return { from: addDays(to, -29), to };
  }

  /** Keeps the range valid no matter what the date fields produced. */
  function normalize(from: string, to: string): { from: string; to: string } {
    let start = from;
    let end = to;
    if (!start || !end) return { from: state.to, to: state.to };
    if (start > end) [start, end] = [end, start];
    if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) start = addDays(end, -(MAX_RANGE_DAYS - 1));
    return { from: start, to: end };
  }

  /** Replies from an older range must not overwrite the range the page now shows. */
  let runId = 0;

  async function load(): Promise<void> {
    const mine = ++runId;
    state.loading = true;
    try {
      const data = await statsOverview(state.from, state.to);
      if (mine !== runId) return;
      state.data = data;
      state.failed = false;
    } catch (e) {
      if (mine !== runId) return;
      state.failed = true;
      throw e;
    } finally {
      if (mine === runId) state.loading = false;
    }
  }

  function apply(next: { from: string; to: string }): void {
    state.from = next.from;
    state.to = next.to;
    state.customFrom = next.from;
    state.customTo = next.to;
  }

  /** Switches preset, moves the window and refetches. */
  async function setPreset(preset: StatsPreset): Promise<void> {
    state.preset = preset;
    state.today = todayIso();
    const wanted = presetRange(preset);
    apply(normalize(wanted.from, wanted.to));
    try {
      await load();
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
    }
  }

  /** Applies an edited date field, fixing up an inverted or oversized range. */
  async function setCustom(from: string, to: string): Promise<void> {
    const next = normalize(from, to);
    if (next.from === state.from && next.to === state.to) return;
    state.preset = "custom";
    apply(next);
    try {
      await load();
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
    }
  }

  /** Entry point for the page: refresh "today" and load the current window. */
  async function refresh(): Promise<void> {
    state.today = todayIso();
    // A preset is anchored on today, so the app left open overnight must move it; a
    // custom window is the user's own dates and stays put.
    if (state.preset !== "custom") {
      const wanted = presetRange(state.preset);
      apply(normalize(wanted.from, wanted.to));
    }
    try {
      await load();
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
    }
  }

  return {
    state,
    data,
    range,
    span,
    granularity,
    hasActivity,
    hasPrevious,
    compactHeatmap,
    buckets,
    heatmap,
    weekday,
    busiest,
    projects,
    categories,
    rate,
    completedDelta,
    minutesDelta,
    rateDelta,
    delayedDelta,
    completedDays,
    completedHours,
    refresh,
    setPreset,
    setCustom,
  };
}

export const statsVM = createStatsVM();

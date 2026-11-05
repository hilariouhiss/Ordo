import { computed, reactive } from "vue";
import type { CaptureSubmission } from "../lib/capture";
import { mondayOf, todayIso, weekWorkdays } from "../lib/dates";
import { askNotice } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import {
  addDoneRows,
  fillPlannedDays,
  groupLanes,
  groupPlannedDays,
  toPlanTask,
} from "../lib/plan";
import { LOAD_WARN_HOURS, planLoads, planSchedule } from "../lib/schedule";
import {
  listSuspended,
  listWeek,
  listWeekDone,
  markNotificationsSeen,
  moveTask,
  placeTask,
  resumeTask,
  weekStats,
} from "../model/ipc";
import type { Task, WeekStats } from "../model/types";
import { appVM } from "./appVM";
import { saveCapture } from "./captureSave";

export function createWeekVM() {
  const state = reactive({
    tasks: [] as Task[],
    /** Finished this week; they left the week list but still show on the day they were done. */
    done: [] as Task[],
    draft: "",
    loading: false,
    suspended: [] as Task[],
    stats: { added: 0, done: 0, delayed: 0 } as WeekStats,
  });

  const week = computed(() => weekWorkdays(todayIso()));
  const planTasks = computed(() => state.tasks.map(toPlanTask));
  // The plan lays out the whole week, so a task's own start before today still counts.
  const plan = computed(() => planSchedule(planTasks.value, todayIso(), week.value[0]));
  const loads = computed(() => planLoads(planTasks.value, plan.value));
  const overloadDates = computed(() =>
    [...loads.value.entries()]
      .filter(([, hours]) => hours > LOAD_WARN_HOURS)
      .map(([date]) => date)
      .sort(),
  );

  const planEnd = computed(() =>
    plan.value.reduce<string | null>(
      (latest, row) => (latest === null || row.end > latest ? row.end : latest),
      null,
    ),
  );

  /**
   * The whole week shows, Monday to Friday, including the days already gone. A plan that
   * runs into next week is cut at the last workday, which also hosts the tasks whose
   * start falls past it; finished tasks keep their day so the week reads as it happened.
   */
  const days = computed(() => {
    const today = todayIso();
    const dates = week.value;
    const planned = groupPlannedDays(state.tasks, plan.value, today, dates[dates.length - 1]);
    const withDone = addDoneRows(planned, state.done, dates, today);
    if (!appVM.state.settings?.weekShowEmptyDays) return withDone;
    return fillPlannedDays(withDone, dates, plan.value, today);
  });
  /** The gantt's rows: one lane per task, finished ones kept in their planned order. */
  const lanes = computed(() => groupLanes(days.value, week.value));
  const conflictCount = computed(() => plan.value.filter((row) => row.conflict).length);
  const passNeeded = computed(() => {
    const last = appVM.state.settings?.lastPassWeek ?? "";
    return last !== mondayOf(todayIso()) && state.tasks.length > 0;
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      const today = todayIso();
      const [tasks, suspended, stats, done] = await Promise.all([
        listWeek(),
        listSuspended(),
        weekStats(today),
        listWeekDone(today),
      ]);
      state.tasks = tasks;
      state.suspended = suspended;
      state.stats = stats;
      state.done = done;
    } finally {
      state.loading = false;
    }
  }

  /**
   * Looking at the week is what marks reminders read. Kept out of `load()` because the
   * page reloads on every capture and AI fill, including while another page is open.
   */
  async function markSeen(): Promise<void> {
    await markNotificationsSeen().catch(() => {});
  }

  let capturing = false;

  async function capture(submission: CaptureSubmission): Promise<void> {
    if (capturing) return;
    const title = submission.title.trim();
    if (!title) return;
    capturing = true;
    try {
      await saveCapture(title, submission.fields, submission.newProjectName);
      if (state.draft.trim() === submission.raw.trim()) state.draft = "";
      await load();
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
    } finally {
      capturing = false;
    }
  }

  async function resume(id: string): Promise<void> {
    try {
      await resumeTask(id);
      await load();
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
    }
  }

  async function move(taskId: string, beforeId: string | null): Promise<void> {
    if (taskId === beforeId) return;
    try {
      state.tasks = await moveTask(taskId, beforeId);
    } catch {
      await load();
    }
  }

  /** Drops a task on a day: it joins the week there, and order follows the drop anchor. */
  async function place(taskId: string, day: string, beforeId: string | null): Promise<void> {
    try {
      await placeTask(taskId, day, beforeId);
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
    }
    await load();
  }

  /** Moves one slot in the list; the order decides the exclusive queue unless a place pins the task. */
  async function moveBy(taskId: string, delta: -1 | 1): Promise<void> {
    const ids = state.tasks.map((task) => task.id);
    const index = ids.indexOf(taskId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    await move(taskId, delta < 0 ? ids[target] : (ids[target + 1] ?? null));
  }

  return {
    state,
    week,
    plan,
    days,
    lanes,
    loads,
    planEnd,
    overloadDates,
    conflictCount,
    passNeeded,
    load,
    markSeen,
    capture,
    resume,
    move,
    place,
    moveBy,
  };
}

export const weekVM = createWeekVM();

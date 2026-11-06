import { computed, reactive, ref } from "vue";
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
  suspendTask,
  weekStats,
} from "../model/ipc";
import type { Task, WeekStats } from "../model/types";
import { appVM } from "./appVM";
import { saveCapture } from "./captureSave";
import { undoVM } from "./undoVM";

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

  /** The page's own idea of today; load() refreshes it so a window left open past midnight follows. */
  const today = ref(todayIso());
  const week = computed(() => weekWorkdays(today.value));
  const weekEnd = computed(() => week.value[week.value.length - 1]);
  /** A task the user planned after this week is next week's work: not on the page, not in its numbers. */
  const plannedLater = (task: Task): boolean =>
    task.expectedStartDate !== null && task.expectedStartDate > weekEnd.value;
  const weekTasks = computed(() => state.tasks.filter((task) => !plannedLater(task)));
  /** The bottom stack: this week's set that waits for a later start, soonest first. */
  const laterTasks = computed(() =>
    state.tasks
      .filter(plannedLater)
      .sort(
        (a, b) =>
          (a.expectedStartDate ?? "").localeCompare(b.expectedStartDate ?? "") ||
          a.sortOrder - b.sortOrder ||
          a.id.localeCompare(b.id),
      ),
  );
  const planTasks = computed(() => weekTasks.value.map(toPlanTask));
  // The plan lays out the whole week, so a task's own start before today still counts.
  const plan = computed(() => planSchedule(planTasks.value, today.value, week.value[0]));
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
   * runs past the last workday is cut there, and work the queue pushes past it is clamped
   * onto that day too; finished tasks keep their day so the week reads as it happened.
   */
  const days = computed(() => {
    const dates = week.value;
    const planned = groupPlannedDays(
      weekTasks.value,
      plan.value,
      today.value,
      dates[dates.length - 1],
    );
    const withDone = addDoneRows(planned, state.done, dates, today.value);
    if (!appVM.state.settings?.weekShowEmptyDays) return withDone;
    return fillPlannedDays(withDone, dates, plan.value, today.value);
  });
  /** The gantt's rows: one lane per task, finished ones kept in their planned order. */
  const lanes = computed(() => groupLanes(days.value, week.value));
  const conflictCount = computed(() => plan.value.filter((row) => row.conflict).length);
  const passNeeded = computed(() => {
    const last = appVM.state.settings?.lastPassWeek ?? "";
    return last !== mondayOf(today.value) && state.tasks.length > 0;
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      today.value = todayIso();
      const todayNow = today.value;
      const [tasks, suspended, stats, done] = await Promise.all([
        listWeek(),
        listSuspended(),
        weekStats(todayNow),
        listWeekDone(todayNow),
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
    const parked = state.suspended.find((task) => task.id === id);
    try {
      await resumeTask(id);
      if (parked) {
        undoVM.pushUndo(t("undo.resumed", { title: parked.title }), async () => {
          await suspendTask(id, parked.suspendedUntil, parked.suspendReason);
        });
      }
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
    today,
    week,
    weekTasks,
    laterTasks,
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

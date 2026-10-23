import { computed, reactive } from "vue";
import type { CaptureSubmission } from "../lib/capture";
import { mondayOf, todayIso } from "../lib/dates";
import { groupPlannedDays, toPlanTask } from "../lib/plan";
import { LOAD_WARN_HALF_DAYS, planLoads, planSchedule } from "../lib/schedule";
import {
  aiEnrich,
  capture as captureApi,
  listSuspended,
  listWeek,
  markNotificationsSeen,
  moveTask,
  resumeTask,
  weekStats,
} from "../model/ipc";
import type { Task, WeekStats } from "../model/types";
import { appVM } from "./appVM";
import { warnExclusiveConflict } from "./planning";

export function createWeekVM() {
  const state = reactive({
    tasks: [] as Task[],
    draft: "",
    loading: false,
    suspended: [] as Task[],
    stats: { added: 0, done: 0, delayed: 0 } as WeekStats,
  });

  const planTasks = computed(() => state.tasks.map(toPlanTask));
  const plan = computed(() => planSchedule(planTasks.value, todayIso()));
  const loads = computed(() => planLoads(planTasks.value, plan.value));
  const overloadDates = computed(() =>
    [...loads.value.entries()]
      .filter(([, halfDays]) => halfDays > LOAD_WARN_HALF_DAYS)
      .map(([date]) => date)
      .sort(),
  );

  const days = computed(() => groupPlannedDays(state.tasks, plan.value, todayIso()));

  const planEnd = computed(() =>
    plan.value.reduce<string | null>(
      (latest, row) => (latest === null || row.end > latest ? row.end : latest),
      null,
    ),
  );
  const conflictCount = computed(() => plan.value.filter((row) => row.conflict).length);
  const passNeeded = computed(() => {
    const last = appVM.state.settings?.lastPassWeek ?? "";
    return last !== mondayOf(todayIso()) && state.tasks.length > 0;
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      const today = todayIso();
      const [tasks, suspended, stats] = await Promise.all([
        listWeek(),
        listSuspended(),
        weekStats(today),
      ]);
      state.tasks = tasks;
      state.suspended = suspended;
      state.stats = stats;
      void markNotificationsSeen();
    } finally {
      state.loading = false;
    }
  }

  let capturing = false;

  async function capture(submission: CaptureSubmission): Promise<void> {
    if (capturing) return;
    const title = submission.title.trim();
    if (!title) return;
    capturing = true;
    try {
      const task = await captureApi(title, submission.fields);
      void aiEnrich(task.id);
      if (state.draft.trim() === submission.raw.trim()) state.draft = "";
      await load();
      warnExclusiveConflict(task, state.tasks);
    } finally {
      capturing = false;
    }
  }

  async function resume(id: string): Promise<void> {
    await resumeTask(id);
    await load();
  }

  async function move(taskId: string, beforeId: string | null): Promise<void> {
    if (taskId === beforeId) return;
    try {
      state.tasks = await moveTask(taskId, beforeId);
    } catch {
      await load();
    }
  }

  /** Moves one slot in the list; the order also decides the exclusive queue. */
  async function moveBy(taskId: string, delta: -1 | 1): Promise<void> {
    const ids = state.tasks.map((task) => task.id);
    const index = ids.indexOf(taskId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    await move(taskId, delta < 0 ? ids[target] : (ids[target + 1] ?? null));
  }

  return {
    state,
    plan,
    days,
    planEnd,
    overloadDates,
    conflictCount,
    passNeeded,
    load,
    capture,
    resume,
    move,
    moveBy,
  };
}

export const weekVM = createWeekVM();

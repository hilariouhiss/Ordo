import { computed, reactive } from "vue";
import type { CaptureSubmission } from "../lib/capture";
import { mondayOf, todayIso, weekdayLabel } from "../lib/dates";
import { planSchedule } from "../lib/schedule";
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

export interface PlannedRow {
  task: Task;
  end: string;
  spans: boolean;
  conflict: boolean;
}

export interface PlannedDay {
  date: string;
  weekday: string;
  isToday: boolean;
  rows: PlannedRow[];
}

export function createWeekVM() {
  const state = reactive({
    tasks: [] as Task[],
    draft: "",
    loading: false,
    suspended: [] as Task[],
    stats: { added: 0, done: 0, delayed: 0 } as WeekStats,
  });

  const plan = computed(() =>
    planSchedule(
      state.tasks.map((task) => ({
        id: task.id,
        effortDays: task.effortDays,
        dueDate: task.dueDate,
      })),
      todayIso(),
    ),
  );

  const days = computed<PlannedDay[]>(() => {
    const planned = new Map(plan.value.map((row) => [row.id, row]));
    const today = todayIso();
    const groups: PlannedDay[] = [];
    for (const task of state.tasks) {
      const row = planned.get(task.id);
      if (!row) continue;
      let group = groups.at(-1);
      if (!group || group.date !== row.start) {
        group = {
          date: row.start,
          weekday: weekdayLabel(row.start),
          isToday: row.start === today,
          rows: [],
        };
        groups.push(group);
      }
      group.rows.push({
        task,
        end: row.end,
        spans: row.end !== row.start,
        conflict: row.conflict,
      });
    }
    return groups;
  });

  const planEnd = computed(() => plan.value.at(-1)?.end ?? null);
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

  /** Moves one slot in the list, which is also one slot in the day plan. */
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

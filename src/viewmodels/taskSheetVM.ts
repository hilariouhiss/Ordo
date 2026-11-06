import { reactive } from "vue";
import { localDate, localTime, stampOfLocal, todayIso } from "../lib/dates";
import { EFFORT_MAX_MINUTES } from "../lib/effort";
import { finishForEffort, timingAnchor } from "../lib/timing";
import {
  addDelayNote,
  addStep,
  deleteStep,
  getTask,
  setStepEffort as setStepEffortApi,
  setTaskStatus,
  toggleStep,
  updateTaskPatch,
} from "../model/ipc";
import type { Priority, Status, Step, Task, TaskPatch } from "../model/types";

/** What the task sheet holds while it is open. Nothing here reaches the database before Save. */
export interface TaskForm {
  title: string;
  projectId: string | null;
  categoryId: string | null;
  ownerId: string | null;
  expectedStartDate: string;
  /** The date on screen; only sent when the user picked it (see `expectedFinishPicked`). */
  expectedFinishDate: string;
  expectedFinishPicked: boolean;
  note: string;
  tags: string[];
  effortMinutes: number;
  priority: Priority;
  exclusive: boolean;
  status: Status;
  actualStartDate: string;
  /** The stored time of day, kept so a date-only edit never rewrites the hour. */
  actualStartTime: string;
  actualFinishDate: string;
  actualFinishTime: string;
  /** 0 is the field's empty state; the backend reads it as "no record". */
  actualEffortMinutes: number;
}

/** The fields the user actually changed, so a save cannot wipe the ones it did not touch. */
export function diffTask(task: Task, form: TaskForm): TaskPatch {
  const patch: TaskPatch = {};
  const title = form.title.trim() || task.title;
  if (title !== task.title) patch.title = title;
  if (form.projectId !== task.projectId) patch.projectId = form.projectId;
  if (form.categoryId !== task.categoryId) patch.categoryId = form.categoryId;
  if (form.ownerId !== task.ownerId) patch.ownerId = form.ownerId;
  if ((form.expectedStartDate || null) !== task.expectedStartDate) {
    patch.expectedStartDate = form.expectedStartDate || null;
  }
  // A date the sheet derived itself is not sent: the backend derives it from the estimate
  // or start instead, so an hour of work does not round up to a whole day.
  if (form.expectedFinishPicked && (form.expectedFinishDate || null) !== task.expectedFinishDate) {
    patch.expectedFinishDate = form.expectedFinishDate || null;
  }
  if ((form.note || null) !== task.note) patch.note = form.note || null;
  if (form.tags.join("\u0000") !== task.tags.map((tag) => tag.name).join("\u0000")) {
    patch.tags = form.tags;
  }
  if (form.effortMinutes !== task.effortMinutes) patch.effortMinutes = form.effortMinutes;
  if (form.priority !== task.priority) patch.priority = form.priority;
  if (form.exclusive !== task.exclusive) patch.exclusive = form.exclusive;
  const actualStart = stampOfLocal(form.actualStartDate, form.actualStartTime);
  if (!sameStamp(actualStart, task.actualStartAt)) patch.actualStartAt = actualStart;
  const actualFinish = stampOfLocal(form.actualFinishDate, form.actualFinishTime);
  if (!sameStamp(actualFinish, task.actualFinishAt)) patch.actualFinishAt = actualFinish;
  const actualEffort = form.actualEffortMinutes > 0 ? form.actualEffortMinutes : null;
  if (actualEffort !== task.actualEffortMinutes) patch.actualEffortMinutes = actualEffort;
  return patch;
}

/**
 * Same date and time of day. The sheet edits minutes only, so a stored stamp's seconds —
 * "now" for a completion, for one — must not read as a change worth writing back.
 */
function sameStamp(one: string | null, other: string | null): boolean {
  if (!one || !other) return one === other;
  return Math.floor(Date.parse(one) / 60_000) === Math.floor(Date.parse(other) / 60_000);
}

function minutesBetween(start: string, finish: string): number {
  return Math.round((Date.parse(finish) - Date.parse(start)) / 60_000);
}

function addMinutes(stamp: string, minutes: number): string {
  return new Date(Date.parse(stamp) + minutes * 60_000).toISOString();
}

function clampEffort(minutes: number): number {
  return Math.min(EFFORT_MAX_MINUTES, Math.max(1, minutes));
}

/** The finish this form implies right now; the backend stores the same value on save. */
export function formFinish(form: TaskForm): string {
  return finishForEffort(
    timingAnchor(todayIso(), form.expectedStartDate || null),
    form.effortMinutes,
  );
}

/**
 * Mirrors the backend's actual-pair coupling on the draft: a finish and an effort move each
 * other around the actual start. Only what the sheet shows changes; the save writes it.
 * Returns the refusal the backend would give, or null.
 */
export function syncActualPreview(
  form: TaskForm,
  edited: "start" | "finish" | "effort",
): string | null {
  const start = stampOfLocal(form.actualStartDate, form.actualStartTime);
  const finish = stampOfLocal(form.actualFinishDate, form.actualFinishTime);
  const showFinish = (stamp: string): void => {
    form.actualFinishDate = localDate(stamp);
    form.actualFinishTime = localTime(stamp);
  };

  if (edited === "finish") {
    if (!finish) {
      form.actualEffortMinutes = 0;
      return null;
    }
    if (!start) return "actual_start_required";
    const minutes = minutesBetween(start, finish);
    if (minutes < 0) return "finish_before_start";
    form.actualEffortMinutes = clampEffort(minutes);
    return null;
  }

  if (edited === "effort") {
    if (form.actualEffortMinutes <= 0) {
      // Clearing the effort with a real pair still re-derives it, exactly as the backend does.
      if (start && finish) form.actualEffortMinutes = clampEffort(minutesBetween(start, finish));
      return null;
    }
    if (!start) return "actual_start_required";
    showFinish(addMinutes(start, form.actualEffortMinutes));
    return null;
  }

  if (start && finish) {
    const minutes = minutesBetween(start, finish);
    if (minutes < 0) return "finish_before_start";
    form.actualEffortMinutes = clampEffort(minutes);
  } else if (start && form.actualEffortMinutes > 0) {
    showFinish(addMinutes(start, form.actualEffortMinutes));
  }
  return null;
}

/** The whole sheet in one save: the steps, then the status, then the fields, then the note. */
export interface SheetSave {
  form: TaskForm;
  /** The steps as the sheet shows them; a step added here still carries a temp id. */
  steps: Step[];
  /** The overdue note typed in the sheet, still unsaved. */
  note: string;
}

export function createTaskSheetVM() {
  const state = reactive({
    openId: null as string | null,
    task: null as Task | null,
    loading: false,
    error: null as string | null,
  });

  async function open(id: string): Promise<void> {
    state.openId = id;
    state.loading = true;
    state.error = null;
    try {
      const task = await getTask(id);
      // A later open owns the sheet; this reply must not replace its task.
      if (state.openId === id) state.task = task;
    } catch (e) {
      if (state.openId === id) state.error = String(e);
    } finally {
      if (state.openId === id) state.loading = false;
    }
  }

  function close(): void {
    state.openId = null;
    state.task = null;
  }

  /** Applies the drafted step list to the stored one; every call hands back a fresh task. */
  async function applySteps(taskId: string, draft: Step[]): Promise<void> {
    let task = state.task;
    if (!task) return;
    const stored = task.steps;
    const kept = new Set(draft.map((s) => s.id));
    for (const s of stored) {
      if (!kept.has(s.id)) task = await deleteStep(s.id);
    }
    for (const s of draft) {
      if (stored.some((one) => one.id === s.id)) continue;
      task = await addStep(taskId, s.title);
      const added = task.steps[task.steps.length - 1];
      if (s.effortMinutes != null) task = await setStepEffortApi(added.id, s.effortMinutes);
      if (s.done) task = await toggleStep(added.id);
    }
    for (const s of draft) {
      const current = task.steps.find((one) => one.id === s.id);
      if (!current) continue;
      if (s.effortMinutes !== current.effortMinutes) {
        task = await setStepEffortApi(s.id, s.effortMinutes);
      }
      if (s.done !== current.done) task = await toggleStep(s.id);
    }
    state.task = task;
  }

  async function saveSheet(input: SheetSave): Promise<boolean> {
    const task = state.task;
    const id = state.openId;
    if (!task || !id) return false;
    state.error = null;
    // Measured before the steps land: an untouched actual time must stay out of the patch,
    // or it would erase what finishing a step just stamped.
    const patch = diffTask(task, input.form);
    try {
      await applySteps(id, input.steps);
      // Steps own the status once there are any.
      if (input.steps.length === 0 && input.form.status !== state.task?.status) {
        state.task = await setTaskStatus(id, input.form.status);
      }
      if (Object.keys(patch).length) state.task = await updateTaskPatch(id, patch);
      if (input.note.trim()) state.task = await addDelayNote(id, input.note.trim());
      // A sheet closed mid-save must not come back with a task nobody opened.
      if (state.openId !== id) state.task = null;
      return true;
    } catch (e) {
      state.error = String(e);
      return false;
    }
  }

  return { state, open, close, saveSheet };
}

export const taskSheetVM = createTaskSheetVM();

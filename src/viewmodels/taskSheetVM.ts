import { reactive } from "vue";
import { localDate, localTime, stampOfLocal, todayIso } from "../lib/dates";
import { EFFORT_MAX_MINUTES } from "../lib/effort";
import { finishForEffort, timingAnchor } from "../lib/timing";
import { addDelayNote, getTask, setTaskStatus, updateTaskPatch } from "../model/ipc";
import type { Priority, Status, Task, TaskPatch } from "../model/types";

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

/** A task as the sheet's draft: every stored field the editor shows. */
export function formOf(task: Task): TaskForm {
  return {
    title: task.title,
    projectId: task.projectId,
    categoryId: task.categoryId,
    ownerId: task.ownerId,
    expectedStartDate: task.expectedStartDate ?? "",
    expectedFinishDate: task.expectedFinishDate ?? "",
    expectedFinishPicked: false,
    note: task.note ?? "",
    tags: task.tags.map((tag) => tag.name),
    effortMinutes: task.effortMinutes,
    priority: task.priority,
    exclusive: task.exclusive,
    status: task.status,
    actualStartDate: task.actualStartAt ? localDate(task.actualStartAt) : "",
    actualStartTime: localTime(task.actualStartAt) || "09:00",
    actualFinishDate: task.actualFinishAt ? localDate(task.actualFinishAt) : "",
    actualFinishTime: localTime(task.actualFinishAt) || "09:00",
    actualEffortMinutes: task.actualEffortMinutes ?? 0,
  };
}

/**
 * The fields the user actually changed, so a save cannot wipe the ones it did not touch.
 * A task with subtasks derives its effort, dates and actual times, so those stay out.
 */
export function diffTask(task: Task, form: TaskForm): TaskPatch {
  const derived = task.children.length > 0;
  const patch: TaskPatch = {};
  const title = form.title.trim() || task.title;
  if (title !== task.title) patch.title = title;
  if (form.projectId !== task.projectId) patch.projectId = form.projectId;
  if (form.categoryId !== task.categoryId) patch.categoryId = form.categoryId;
  if (form.ownerId !== task.ownerId) patch.ownerId = form.ownerId;
  if ((form.note || null) !== task.note) patch.note = form.note || null;
  if (form.tags.join("\u0000") !== task.tags.map((tag) => tag.name).join("\u0000")) {
    patch.tags = form.tags;
  }
  if (form.priority !== task.priority) patch.priority = form.priority;
  if (form.exclusive !== task.exclusive) patch.exclusive = form.exclusive;
  if (derived) return patch;

  if ((form.expectedStartDate || null) !== task.expectedStartDate) {
    patch.expectedStartDate = form.expectedStartDate || null;
  }
  // A date the sheet derived itself is not sent: the backend derives it from the estimate
  // or start instead, so an hour of work does not round up to a whole day.
  if (form.expectedFinishPicked && (form.expectedFinishDate || null) !== task.expectedFinishDate) {
    patch.expectedFinishDate = form.expectedFinishDate || null;
  }
  if (form.effortMinutes !== task.effortMinutes) patch.effortMinutes = form.effortMinutes;
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

/** One draft the sheet stepped away from: a subtask opens over its parent's unsaved edit. */
interface ParkedDraft {
  task: Task;
  form: TaskForm;
  note: string;
}

export function createTaskSheetVM() {
  const state = reactive({
    openId: null as string | null,
    task: null as Task | null,
    /** The drafts of the tasks this subtask was opened from. */
    stack: [] as ParkedDraft[],
    /** The whole sheet in one draft: nothing reaches the database before Save. */
    form: null as TaskForm | null,
    /** The overdue note typed in the sheet, still unsaved. */
    note: "",
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
      if (state.openId === id) {
        state.task = task;
        state.form = formOf(task);
        state.note = "";
      }
    } catch (e) {
      if (state.openId === id) {
        // Never keep the previous task's draft under a failed open: a save would post it
        // against the id that failed to load.
        state.error = String(e);
        state.task = null;
        state.form = null;
        state.note = "";
      }
    } finally {
      if (state.openId === id) state.loading = false;
    }
  }

  function close(): void {
    state.openId = null;
    state.task = null;
    state.form = null;
    state.note = "";
    state.stack = [];
  }

  /** Opens a subtask over this one, keeping the parent's unsaved draft for the way back. */
  async function drill(childId: string): Promise<void> {
    if (!state.task || !state.form) return;
    state.stack.push({
      task: state.task,
      form: { ...state.form, tags: [...state.form.tags] },
      note: state.note,
    });
    await open(childId);
  }

  /** Back to the task this one was opened from, with its draft and fresh derived fields. */
  async function back(): Promise<void> {
    const parked = state.stack.pop();
    if (!parked) return;
    state.openId = parked.task.id;
    state.loading = true;
    state.error = null;
    try {
      const fresh = await getTask(parked.task.id);
      if (state.openId !== fresh.id) return;
      state.task = fresh;
      applyDerived(parked.form, fresh);
      state.form = parked.form;
      state.note = parked.note;
    } catch (e) {
      state.error = String(e);
    } finally {
      state.loading = false;
    }
  }

  /** Takes a fresh copy of the open task, keeping the draft's editable fields. */
  function applyTask(task: Task): void {
    if (!state.form) {
      state.task = task;
      return;
    }
    state.task = task;
    applyDerived(state.form, task);
  }

  /** The fields a task with subtasks takes from them, never from the draft. */
  function applyDerived(form: TaskForm, task: Task): void {
    form.expectedStartDate = task.expectedStartDate ?? "";
    form.expectedFinishDate = task.expectedFinishDate ?? "";
    form.expectedFinishPicked = false;
    form.effortMinutes = task.effortMinutes;
    form.status = task.status;
    form.actualStartDate = task.actualStartAt ? localDate(task.actualStartAt) : "";
    form.actualStartTime = localTime(task.actualStartAt) || "09:00";
    form.actualFinishDate = task.actualFinishAt ? localDate(task.actualFinishAt) : "";
    form.actualFinishTime = localTime(task.actualFinishAt) || "09:00";
    form.actualEffortMinutes = task.actualEffortMinutes ?? 0;
  }

  async function saveSheet(): Promise<boolean> {
    const task = state.task;
    const form = state.form;
    const id = state.openId;
    if (!task || !form || !id) return false;
    state.error = null;
    // Measured before the status lands: an untouched actual time must stay out of the patch.
    const patch = diffTask(task, form);
    try {
      // A task with subtasks is an umbrella: its status comes from them.
      if (!task.children.length && form.status !== task.status) {
        state.task = await setTaskStatus(id, form.status);
      }
      if (Object.keys(patch).length) state.task = await updateTaskPatch(id, patch);
      if (state.note.trim()) state.task = await addDelayNote(id, state.note.trim());
      // A sheet closed mid-save must not come back with a task nobody opened.
      if (state.openId !== id) state.task = null;
      return true;
    } catch (e) {
      state.error = String(e);
      return false;
    }
  }

  return { state, open, close, drill, back, applyTask, saveSheet };
}

export const taskSheetVM = createTaskSheetVM();

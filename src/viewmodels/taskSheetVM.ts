import { reactive } from "vue";
import { finishForEffort, timingAnchor } from "../lib/timing";
import { todayIso } from "../lib/dates";
import {
  addDelayNote,
  addStep,
  deleteStep,
  getTask,
  setTaskStatus,
  toggleStep,
  updateTaskPatch,
} from "../model/ipc";
import type { Priority, Status, Task, TaskPatch } from "../model/types";

/** What the task sheet holds while it is open. */
export interface TaskForm {
  title: string;
  projectId: string | null;
  categoryId: string | null;
  ownerId: string | null;
  expectedStartDate: string;
  note: string;
  tags: string[];
  effortMinutes: number;
  priority: Priority;
  exclusive: boolean;
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
  if ((form.note || null) !== task.note) patch.note = form.note || null;
  if (form.tags.join("\u0000") !== task.tags.map((tag) => tag.name).join("\u0000")) {
    patch.tags = form.tags;
  }
  if (form.effortMinutes !== task.effortMinutes) patch.effortMinutes = form.effortMinutes;
  if (form.priority !== task.priority) patch.priority = form.priority;
  if (form.exclusive !== task.exclusive) patch.exclusive = form.exclusive;
  return patch;
}

/** The finish this form implies right now; the backend stores the same value on save. */
export function formFinish(form: TaskForm): string {
  return finishForEffort(
    timingAnchor(todayIso(), form.expectedStartDate || null),
    form.effortMinutes,
  );
}

/**
 * What the sheet shows. An untouched task keeps the date it already has, so a rule's
 * occurrence date is not replaced by a preview; once the start or the estimate changes,
 * the date moves with it.
 */
export function finishPreview(task: Task, form: TaskForm): string {
  const untouched =
    (form.expectedStartDate || null) === task.expectedStartDate &&
    form.effortMinutes === task.effortMinutes;
  if (untouched && task.expectedFinishDate) return task.expectedFinishDate;
  return formFinish(form);
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
      state.task = await getTask(id);
    } catch (e) {
      state.error = String(e);
    } finally {
      state.loading = false;
    }
  }

  function close(): void {
    state.openId = null;
    state.task = null;
  }

  async function toggle(stepId: string): Promise<void> {
    state.task = await toggleStep(stepId);
  }

  async function add(title: string): Promise<void> {
    if (!state.openId || !title.trim()) return;
    state.task = await addStep(state.openId, title.trim());
  }

  async function remove(stepId: string): Promise<void> {
    state.task = await deleteStep(stepId);
  }

  /** Saves the sheet. The expected finish is not sent: the backend derives it. */
  async function saveForm(form: TaskForm): Promise<boolean> {
    const task = state.task;
    const id = state.openId;
    if (!task || !id) return false;
    state.error = null;
    try {
      const patch = diffTask(task, form);
      if (Object.keys(patch).length) state.task = await updateTaskPatch(id, patch);
      return true;
    } catch (e) {
      state.error = String(e);
      return false;
    }
  }

  async function addNote(reason: string): Promise<void> {
    if (!state.openId || !reason.trim()) return;
    state.task = await addDelayNote(state.openId, reason.trim());
  }

  async function setStatus(status: Status): Promise<void> {
    if (!state.openId) return;
    state.task = await setTaskStatus(state.openId, status);
  }

  return { state, open, close, toggle, add, remove, saveForm, addNote, setStatus };
}

export const taskSheetVM = createTaskSheetVM();

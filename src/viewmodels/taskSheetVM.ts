import { reactive } from "vue";
import { finishForEffort, timingAnchor } from "../lib/timing";
import { todayIso } from "../lib/dates";
import {
  addDelayNote,
  addStep,
  deleteStep,
  getTask,
  resetStepEfforts,
  setStepEffort as setStepEffortApi,
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
  /** The date on screen; only sent when the user picked it (see `expectedFinishPicked`). */
  expectedFinishDate: string;
  expectedFinishPicked: boolean;
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
  return patch;
}

/** The finish this form implies right now; the backend stores the same value on save. */
export function formFinish(form: TaskForm): string {
  return finishForEffort(
    timingAnchor(todayIso(), form.expectedStartDate || null),
    form.effortMinutes,
  );
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

  async function setStepEffort(stepId: string, minutes: number | null): Promise<void> {
    state.task = await setStepEffortApi(stepId, minutes);
  }

  async function evenSteps(): Promise<void> {
    if (!state.openId) return;
    state.task = await resetStepEfforts(state.openId);
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

  /** Writes one hand-edited field, e.g. an actual time, and takes the recomputed task. */
  async function patch(patch: TaskPatch): Promise<void> {
    const id = state.openId;
    if (!id) return;
    const task = await updateTaskPatch(id, patch);
    // A blur-then-close must not revive the sheet with a task nobody opened.
    if (state.openId === id) state.task = task;
  }

  async function addNote(reason: string): Promise<void> {
    if (!state.openId || !reason.trim()) return;
    state.task = await addDelayNote(state.openId, reason.trim());
  }

  async function setStatus(status: Status): Promise<void> {
    if (!state.openId) return;
    state.task = await setTaskStatus(state.openId, status);
  }

  return {
    state,
    open,
    close,
    toggle,
    add,
    remove,
    setStepEffort,
    evenSteps,
    saveForm,
    patch,
    addNote,
    setStatus,
  };
}

export const taskSheetVM = createTaskSheetVM();

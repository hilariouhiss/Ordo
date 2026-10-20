import { reactive } from "vue";
import {
  addDelayNote,
  addStep,
  deleteStep,
  getTask,
  setDue as setDueApi,
  setTaskStatus,
  toggleStep,
  updateTaskPatch,
} from "../model/ipc";
import type { Status, Task, TaskPatch } from "../model/types";

/** What the task sheet holds while it is open. */
export interface TaskForm {
  title: string;
  projectId: string | null;
  categoryId: string | null;
  ownerId: string | null;
  startDate: string;
  dueDate: string;
  note: string;
  tags: string[];
}

/** The fields the user actually changed, so a save cannot wipe the ones it did not touch. */
export function diffTask(task: Task, form: TaskForm): TaskPatch {
  const patch: TaskPatch = {};
  const title = form.title.trim() || task.title;
  if (title !== task.title) patch.title = title;
  if (form.projectId !== task.projectId) patch.projectId = form.projectId;
  if (form.categoryId !== task.categoryId) patch.categoryId = form.categoryId;
  if (form.ownerId !== task.ownerId) patch.ownerId = form.ownerId;
  if ((form.startDate || null) !== task.startDate) patch.startDate = form.startDate || null;
  if ((form.note || null) !== task.note) patch.note = form.note || null;
  if (form.tags.join("\u0000") !== task.tags.map((tag) => tag.name).join("\u0000")) {
    patch.tags = form.tags;
  }
  return patch;
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

  /// Saves the sheet: the deadline through set_due, everything else as a patch.
  async function saveForm(form: TaskForm): Promise<void> {
    const task = state.task;
    const id = state.openId;
    if (!task || !id) return;
    // Diff first: setDue replaces state.task, and the view's watcher then rewrites the form.
    const patch = diffTask(task, form);
    if ((form.dueDate || null) !== task.dueDate) {
      state.task = await setDueApi(id, form.dueDate || null, null);
    }
    if (Object.keys(patch).length) state.task = await updateTaskPatch(id, patch);
  }

  async function addNote(reason: string): Promise<void> {
    if (!state.openId || !reason.trim()) return;
    state.task = await addDelayNote(state.openId, reason.trim());
  }

  async function setStatus(status: Status): Promise<void> {
    if (!state.openId) return;
    state.task = await setTaskStatus(state.openId, status);
  }

  async function patch(patch: TaskPatch): Promise<void> {
    if (!state.openId) return;
    state.task = await updateTaskPatch(state.openId, patch);
  }

  return { state, open, close, toggle, add, remove, patch, saveForm, addNote, setStatus };
}

export const taskSheetVM = createTaskSheetVM();

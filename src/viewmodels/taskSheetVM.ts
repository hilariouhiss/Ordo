import { reactive } from "vue";
import {
  addDelayNote,
  addStep,
  deleteStep,
  getTask,
  setDue as setDueApi,
  setTaskStatus,
  toggleStep,
  updateTask,
} from "../model/ipc";
import type { Status, Task, TaskFields } from "../model/types";

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

  async function setDue(due: string | null): Promise<void> {
    if (!state.openId) return;
    state.task = await setDueApi(state.openId, due, null);
  }

  async function addNote(reason: string): Promise<void> {
    if (!state.openId || !reason.trim()) return;
    state.task = await addDelayNote(state.openId, reason.trim());
  }

  async function setStatus(status: Status): Promise<void> {
    if (!state.openId) return;
    state.task = await setTaskStatus(state.openId, status);
  }

  async function save(fields: TaskFields): Promise<void> {
    if (!state.openId) return;
    state.task = await updateTask(state.openId, fields);
  }

  return { state, open, close, toggle, add, remove, save, setDue, addNote, setStatus };
}

export const taskSheetVM = createTaskSheetVM();

import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { computed, reactive } from "vue";
import { localDate, stampOfLocal, todayIso } from "../lib/dates";
import { finishForEffort } from "../lib/timing";
import type { CaptureFields, Priority, Status } from "../model/types";
import { saveCapture } from "./captureSave";

/** The detailed task form. It is one capture: the same fields the quick line carries. */
export interface TaskCreateForm {
  title: string;
  note: string;
  status: Status;
  projectId: string | null;
  categoryId: string | null;
  ownerId: string | null;
  priority: Priority;
  expectedStartDate: string;
  effortMinutes: number;
  actualStartDate: string;
  actualEffortMinutes: number;
  tags: string[];
}

/** The done preview: local 09:00 on the actual day plus the actual effort. */
export function finishFromActualDay(start: string, minutes: number): string {
  const stamp = stampOfLocal(start, "09:00");
  if (!stamp) return "";
  const end = Date.parse(stamp) + Math.max(1, minutes) * 60_000;
  return localDate(new Date(end).toISOString());
}

function emptyForm(): TaskCreateForm {
  const today = todayIso();
  return {
    title: "",
    note: "",
    status: "todo",
    projectId: null,
    categoryId: null,
    ownerId: null,
    priority: "normal",
    expectedStartDate: today,
    effortMinutes: 480,
    actualStartDate: today,
    actualEffortMinutes: 480,
    tags: [],
  };
}

/**
 * The "+" on the capture bar opens one detailed form. It submits through the same
 * capture command as the one-line box, so a created task behaves exactly like any other.
 */
export function createTaskCreateVM() {
  const state = reactive({
    open: false,
    busy: false,
    error: "",
    form: emptyForm(),
  });

  const expectedFinish = computed(() =>
    finishForEffort(state.form.expectedStartDate || todayIso(), state.form.effortMinutes),
  );
  const actualFinish = computed(() =>
    state.form.status === "todo"
      ? ""
      : finishFromActualDay(
          state.form.actualStartDate || todayIso(),
          state.form.actualEffortMinutes,
        ),
  );

  function open(): void {
    state.form = emptyForm();
    state.error = "";
    state.open = true;
  }

  function close(): void {
    state.open = false;
    state.error = "";
  }

  async function save(): Promise<boolean> {
    const form = state.form;
    const title = form.title.trim();
    if (!title || state.busy) return false;
    state.busy = true;
    state.error = "";
    try {
      const finished = form.status === "done";
      const started = form.status !== "todo";
      const fields: CaptureFields = {
        projectId: form.projectId,
        ownerId: form.ownerId,
        priority: form.priority,
        effortMinutes: form.effortMinutes,
        expectedStartDate: form.expectedStartDate || null,
        actualStartDate: started ? form.actualStartDate || todayIso() : null,
        // A started task has no actual effort yet; the pair sync would finish it.
        actualEffortMinutes: finished ? Math.max(1, form.actualEffortMinutes) : null,
        categoryId: form.categoryId,
        note: form.note.trim() || null,
        tags: form.tags,
      };
      const task = await saveCapture(title, fields, null, finished);
      // The main window's own capture does not get Rust's window event, so send it here.
      if (isTauri()) void emit("capture:created", task);
      close();
      return true;
    } catch (e) {
      state.error = String(e);
      return false;
    } finally {
      state.busy = false;
    }
  }

  return { state, open, close, save, expectedFinish, actualFinish };
}

export const taskCreateVM = createTaskCreateVM();

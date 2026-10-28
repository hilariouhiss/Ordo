import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { reactive } from "vue";
import type { CaptureSubmission } from "../lib/capture";
import { aiEnrich, capture } from "../model/ipc";
import { projectsVM } from "./projectsVM";

export type QuickCreateMode = "task" | "project";

/**
 * The two in-app create flows share one overlay. The modal keeps errors in
 * place so a rejected backend call does not lose what the user typed.
 */
export function createQuickCreateVM() {
  const state = reactive({
    mode: null as QuickCreateMode | null,
    busy: false,
    error: "",
  });

  function openTask(): void {
    state.mode = "task";
    state.error = "";
  }

  function openProject(): void {
    state.mode = "project";
    state.error = "";
  }

  function close(): void {
    state.mode = null;
    state.error = "";
  }

  async function createTask(submission: CaptureSubmission): Promise<boolean> {
    if (state.busy) return false;
    const title = submission.title.trim();
    if (!title) return false;
    state.busy = true;
    state.error = "";
    try {
      const task = await capture(title, submission.fields);
      void aiEnrich(task.id);
      // The main window's own capture skips the capture window's Rust event, so
      // send the same event the other lists already listen to.
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

  async function createProject(name: string): Promise<boolean> {
    if (state.busy) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    state.busy = true;
    state.error = "";
    try {
      const project = await projectsVM.create(trimmed);
      if (!project) return false;
      close();
      return true;
    } catch (e) {
      state.error = String(e);
      return false;
    } finally {
      state.busy = false;
    }
  }

  return { state, openTask, openProject, close, createTask, createProject };
}

export const quickCreateVM = createQuickCreateVM();

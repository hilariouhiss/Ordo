import { reactive } from "vue";
import { projectsVM } from "./projectsVM";

export type QuickCreateMode = "project";

/**
 * The Ctrl+Shift+N project shortcut's small overlay. New tasks go through the
 * detailed dialog (taskCreateVM); this one keeps the project's name and nothing else.
 */
export function createQuickCreateVM() {
  const state = reactive({
    mode: null as QuickCreateMode | null,
    busy: false,
    error: "",
  });

  function openProject(): void {
    state.mode = "project";
    state.error = "";
  }

  function close(): void {
    state.mode = null;
    state.error = "";
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

  return { state, openProject, close, createProject };
}

export const quickCreateVM = createQuickCreateVM();

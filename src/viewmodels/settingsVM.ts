import { reactive } from "vue";
import * as ipc from "../model/ipc";
import type { Settings } from "../model/types";
import { appVM } from "./appVM";

export type SettingsTab = "ai" | "general" | "data" | "meta";

export function createSettingsVM() {
  const state = reactive({
    open: false,
    tab: "ai" as SettingsTab,
    backupPath: "",
    exportPath: "",
    busy: false,
    error: "",
  });

  function open(): void {
    state.open = true;
    state.error = "";
    state.tab = "ai";
  }

  function close(): void {
    state.open = false;
  }

  async function save(patch: Partial<Settings>): Promise<void> {
    state.error = "";
    try {
      appVM.state.settings = await ipc.setSettings(patch);
    } catch (e) {
      state.error = String(e);
    }
  }

  async function backup(): Promise<void> {
    state.backupPath = await ipc.backupNow();
  }

  async function exportData(): Promise<void> {
    state.exportPath = await ipc.exportJson();
  }

  async function addCategory(name: string): Promise<void> {
    if (!name.trim()) return;
    await ipc.createCategory(name.trim());
    await appVM.load();
  }

  async function renameCategory(id: string, name: string): Promise<void> {
    if (!name.trim()) return;
    await ipc.renameCategory(id, name.trim());
    await appVM.load();
  }

  async function removeCategory(id: string): Promise<void> {
    await ipc.deleteCategory(id);
    await appVM.load();
  }

  async function moveCategory(id: string, direction: -1 | 1): Promise<void> {
    const ids = appVM.state.categories.map((c) => c.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    appVM.state.categories = await ipc.reorderCategories(ids);
  }

  async function addTag(name: string): Promise<void> {
    if (!name.trim()) return;
    await ipc.createTag(name.trim());
    await appVM.load();
  }

  async function removeTag(id: string): Promise<void> {
    await ipc.deleteTag(id);
    await appVM.load();
  }

  return {
    state,
    open,
    close,
    save,
    backup,
    exportData,
    addCategory,
    renameCategory,
    removeCategory,
    moveCategory,
    addTag,
    removeTag,
  };
}

export const settingsVM = createSettingsVM();

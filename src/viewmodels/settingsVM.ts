import { reactive } from "vue";
import * as ipc from "../model/ipc";
import type { Settings } from "../model/types";
import { appVM } from "./appVM";

export type SettingsTab = "ai" | "general" | "data";

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
    state.error = "";
    try {
      state.backupPath = await ipc.backupNow();
      if (appVM.state.settings) appVM.state.settings.backupError = null;
    } catch (e) {
      state.error = String(e);
      if (appVM.state.settings) appVM.state.settings.backupError = String(e);
    }
  }

  async function exportData(): Promise<void> {
    state.error = "";
    try {
      state.exportPath = await ipc.exportJson();
    } catch (e) {
      state.error = String(e);
    }
  }

  return { state, open, close, save, backup, exportData };
}

export const settingsVM = createSettingsVM();

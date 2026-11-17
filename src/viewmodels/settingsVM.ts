import { reactive } from "vue";
import { askNotice, askNoticeOptOut } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import * as ipc from "../model/ipc";
import type { Mode, Settings } from "../model/types";
import { appVM } from "./appVM";

export type SettingsTab = "about" | "ai" | "general" | "mode" | "data" | "requirement";

export function createSettingsVM() {
  const state = reactive({
    open: false,
    tab: "general" as SettingsTab,
    backupPath: "",
    exportPath: "",
    busy: false,
    error: "",
  });

  function open(): void {
    state.open = true;
    state.error = "";
    state.tab = "general";
  }

  function close(): void {
    state.open = false;
  }

  /** Switches now; the answer carries the whole settings block, mode included. */
  async function switchMode(target: Mode): Promise<boolean> {
    if (appVM.state.settings?.mode === target) return true;
    state.error = "";
    try {
      appVM.state.settings = await ipc.setMode(target);
      // A manual switch is worth one line: it is the only point that explains what holds and what stays personal.
      if (!appVM.state.settings.modeHintDismissed) {
        const mode = t(target === "work" ? "mode.work" : "mode.personal");
        const scope = t("mode.switchedScope");
        const dismiss = await askNoticeOptOut(
          t("mode.switchedTitle", { mode }),
          appVM.state.settings.modeAuto ? `${t("mode.switchedSchedule")} ${scope}` : scope,
          t("mode.switchedDismiss"),
          true,
        );
        if (dismiss) await save({ modeHintDismissed: true });
      }
      return true;
    } catch (e) {
      state.error = String(e);
      void askNotice(t("common.actionFailed"), errorText(e));
      return false;
    }
  }

  async function save(patch: Partial<Settings>): Promise<boolean> {
    state.error = "";
    try {
      appVM.state.settings = await ipc.setSettings(patch);
      return true;
    } catch (e) {
      state.error = String(e);
      return false;
    }
  }

  /** The task default owns a transaction of its own: the setting and the bulk edit land together. */
  async function setTaskDefaultExclusive(
    value: boolean,
    applyToExisting: boolean,
  ): Promise<boolean> {
    state.error = "";
    try {
      appVM.state.settings = await ipc.setTaskDefaultExclusive(value, applyToExisting);
      return true;
    } catch (e) {
      state.error = String(e);
      return false;
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

  return { state, open, close, save, setTaskDefaultExclusive, switchMode, backup, exportData };
}

export const settingsVM = createSettingsVM();

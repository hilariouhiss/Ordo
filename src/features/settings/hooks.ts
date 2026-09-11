/**
 * Actions for the settings page (D-03, D-04).
 *
 * The file is chosen with the OS dialog and moved by the backend, so the
 * frontend never touches the bytes: it picks a path, calls the command and
 * reports what came back. A restore replaces every table, so the caller is
 * expected to confirm first — `runImport` only runs the command it is given.
 *
 * Autostart is the OS's own login-item list rather than a value we store, so
 * the switch is read from it (`loadAutostart`) and read back after a write.
 */

import { format } from "date-fns";
import { open, save } from "@tauri-apps/plugin-dialog";
import { normalizeError } from "../../common/ipc";
import { pushError, pushInfo } from "../../common/stores/notifications";
import { loadAll as loadProjects } from "../projects/hooks";
import { loadAll as loadTasks } from "../tasks/hooks";
import * as api from "./api";
import type { BackupSummary } from "./types";

/** Default file name offered by the save dialog. */
export function backupFileName(now: Date = new Date()): string {
  return `ordo-backup-${format(now, "yyyyMMdd-HHmmss")}.json`;
}

function reportFailure(error: unknown): null {
  const normalized = normalizeError(error);
  pushError(normalized.message, normalized.code);
  return null;
}

/** Save dialog; `null` when the user dismisses it. */
export async function pickExportPath(): Promise<string | null> {
  try {
    return await save({
      title: "导出 Ordo 备份",
      defaultPath: backupFileName(),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
  } catch {
    return null; // no Tauri runtime (browser dev server)
  }
}

/** Open dialog; `null` when the user dismisses it. */
export async function pickBackupFile(): Promise<string | null> {
  try {
    return await open({
      title: "选择 Ordo 备份文件",
      multiple: false,
      directory: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
  } catch {
    return null;
  }
}

/** Writes the backup and reports where it went. */
export async function runExport(path: string): Promise<BackupSummary | null> {
  try {
    const summary = await api.exportBackup(path);
    pushInfo(`已导出 ${summary.counts.tasks} 个任务到 ${summary.path}`);
    return summary;
  } catch (error) {
    return reportFailure(error);
  }
}

/**
 * Restores the backup and refreshes the in-memory stores, so the views show
 * the restored data without a restart.
 */
export async function runImport(path: string): Promise<BackupSummary | null> {
  try {
    const summary = await api.importBackup(path);
    pushInfo(
      `已从备份恢复 ${summary.counts.tasks} 个任务、${summary.counts.projects} 个项目`,
    );
    await Promise.all([loadTasks(), loadProjects()]);
    return summary;
  } catch (error) {
    return reportFailure(error);
  }
}

/** Whether Ordo starts with the system; `false` when the OS cannot be asked. */
export async function loadAutostart(): Promise<boolean> {
  try {
    return await api.autostartEnabled();
  } catch {
    return false; // no Tauri runtime (browser dev server)
  }
}

/**
 * Turns startup launch on or off and returns what the OS reports afterwards,
 * or `null` when the write was refused — the caller keeps the switch on the
 * returned value, so it can never claim a state the OS did not accept.
 */
export async function setAutostart(enabled: boolean): Promise<boolean | null> {
  try {
    await api.setAutostart(enabled);
    return await api.autostartEnabled();
  } catch (error) {
    return reportFailure(error);
  }
}

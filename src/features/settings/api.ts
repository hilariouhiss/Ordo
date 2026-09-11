/**
 * Backend calls for the settings domain — the only place in this feature that
 * touches the IPC layer. Components go through `hooks.ts`.
 */

import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { COMMANDS, invokeCommand } from "../../common/ipc";
import type { BackupSummary } from "./types";

/** Writes every table to `path` as one JSON backup document. */
export function exportBackup(path: string): Promise<BackupSummary> {
  return invokeCommand(COMMANDS.backup.export, { path });
}

/** Replaces the whole database with the backup at `path`. */
export function importBackup(path: string): Promise<BackupSummary> {
  return invokeCommand(COMMANDS.backup.import, { path });
}

/** Whether the OS currently launches Ordo at login (D-04). */
export function autostartEnabled(): Promise<boolean> {
  return isEnabled();
}

/** Registers (`true`) or unregisters (`false`) Ordo as an OS login item. */
export function setAutostart(enabled: boolean): Promise<void> {
  return enabled ? enable() : disable();
}

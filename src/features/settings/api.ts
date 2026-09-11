/**
 * Backend calls for the settings domain — the only place in this feature that
 * touches the IPC layer. Components go through `hooks.ts`.
 */

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

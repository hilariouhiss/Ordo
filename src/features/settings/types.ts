/**
 * Settings-domain types mirroring the Rust models (`src-tauri/src/models.rs`).
 *
 * Settings is a thin domain today: the only backend surface is the backup
 * pair, plus the key/value store the backup carries.
 */

/** Row counts of one backup (`BackupCounts`). */
export interface BackupCounts {
  namespaces: number;
  projects: number;
  boardColumns: number;
  tasks: number;
  subtasks: number;
  tags: number;
  comments: number;
  timeEntries: number;
  settings: number;
}

/** What `backup:export` wrote or `backup:import` restored (`BackupSummary`). */
export interface BackupSummary {
  path: string;
  /** Stamp of the document that was written or read. */
  exportedAt: string;
  counts: BackupCounts;
}

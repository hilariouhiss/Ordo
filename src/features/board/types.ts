/**
 * Domain types for the board feature, mirroring `BoardColumn` in
 * `src-tauri/src/models.rs` field-for-field (serde camelCase). Column
 * ordering uses the lexicographic `position` key.
 */

export interface BoardColumn {
  id: string;
  projectId: string;
  name: string;
  position: string;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Search-domain types mirroring the Rust models (`src-tauri/src/models.rs`).
 *
 * Search is a read-only domain: results are hook-local state, so this feature
 * has no store — there is nothing to optimistically update.
 */

export type SearchHitKind = "task" | "comment";

export interface SearchHit {
  kind: SearchHitKind;
  /** Id of the matching entity (the task itself, or the comment). */
  id: string;
  /** Id of the task to navigate to (for task hits, same as `id`). */
  taskId: string;
  taskTitle: string;
  /** Snippet around the first match, with `<mark>`/`</mark>` highlight markers. */
  snippet: string;
}

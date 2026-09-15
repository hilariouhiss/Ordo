/**
 * Board store (module-level `createStore`, mirroring the other domain
 * stores). Column lists are cached per project and loaded on demand when a
 * board view mounts — like the task store's per-task comment and time-entry
 * caches, which fill on demand and are read straight from the component.
 *
 * Mutators below are the data layer's plumbing — components change state
 * through `hooks.ts`, never directly.
 */

import { createStore, produce } from "solid-js/store";
import type { BoardColumn } from "./types";

export interface BoardState {
  /** Column cache per project, ordered by `position`. */
  columnsByProject: Record<string, BoardColumn[]>;
}

const [state, setState] = createStore<BoardState>({ columnsByProject: {} });

/** Reactive store state; read from components, mutate through hooks. */
export const boardState = state;

export function getColumns(projectId: string): BoardColumn[] {
  return state.columnsByProject[projectId] ?? [];
}

/** Whether the project's column list has been loaded into the cache. */
export function hasColumns(projectId: string): boolean {
  return projectId in state.columnsByProject;
}

/** Lookup across every cached project; boards are small, so a scan is fine. */
export function getColumn(columnId: string): BoardColumn | undefined {
  for (const columns of Object.values(state.columnsByProject)) {
    const found = columns.find((column) => column.id === columnId);
    if (found) return found;
  }
  return undefined;
}

// --- mutators (data-layer plumbing; see module docs) -------------------------

export function setColumns(projectId: string, columns: BoardColumn[]): void {
  setState("columnsByProject", projectId, columns);
}

export function upsertColumn(projectId: string, column: BoardColumn): void {
  setState(
    "columnsByProject",
    projectId,
    produce((list: BoardColumn[]) => {
      const index = list.findIndex((item) => item.id === column.id);
      if (index === -1) {
        list.push(column);
      } else {
        list[index] = column;
      }
    }),
  );
}

export function patchColumn(columnId: string, patch: Partial<BoardColumn>): void {
  for (const [projectId, columns] of Object.entries(state.columnsByProject)) {
    const index = columns.findIndex((column) => column.id === columnId);
    if (index !== -1) {
      setState("columnsByProject", projectId, index, produce((column: BoardColumn) => {
        Object.assign(column, patch);
      }));
      return;
    }
  }
}

export function removeColumn(columnId: string): void {
  for (const [projectId, columns] of Object.entries(state.columnsByProject)) {
    if (columns.some((column) => column.id === columnId)) {
      setState(
        "columnsByProject",
        projectId,
        (list) => list.filter((column) => column.id !== columnId),
      );
      return;
    }
  }
}

export function insertColumnAt(projectId: string, index: number, column: BoardColumn): void {
  setState(
    "columnsByProject",
    projectId,
    produce((list: BoardColumn[]) => {
      list.splice(Math.min(Math.max(index, 0), list.length), 0, column);
    }),
  );
}

/** Resets the store to its pristine state (test seam). */
export function resetBoardStore(): void {
  setState({ columnsByProject: {} });
}

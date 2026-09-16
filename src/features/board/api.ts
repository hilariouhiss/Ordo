/**
 * Backend calls for the board domain — the only place in this feature that
 * touches the IPC layer. Components never call these directly; they go
 * through `hooks.ts`, which owns the optimistic-update flow.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type { Task } from "../tasks/types";
import type { BoardColumn } from "./types";

export function listBoardColumns(projectId: string): Promise<BoardColumn[]> {
  return invokeCommand(COMMANDS.board.listColumns, { projectId });
}

/** `prev`/`next` are the target column's sort keys around the drop slot
 * (either side optional at the ends); returns the authoritative task. */
export function moveTask(
  taskId: string,
  columnId: string,
  prev: string | null,
  next: string | null,
): Promise<Task> {
  return invokeCommand(COMMANDS.board.moveTask, { taskId, columnId, prev, next });
}

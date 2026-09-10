/**
 * Backend calls for the board domain — the only place in this feature that
 * touches the IPC layer. Components never call these directly; they go
 * through `hooks.ts`, which owns the optimistic-update flow.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type { Task } from "../tasks/types";
import type { BoardColumn, NewBoardColumn, UpdateBoardColumn } from "./types";

export function listBoardColumns(projectId: string): Promise<BoardColumn[]> {
  return invokeCommand(COMMANDS.board.listColumns, { projectId });
}

export function addBoardColumn(payload: NewBoardColumn): Promise<BoardColumn> {
  return invokeCommand(COMMANDS.board.addColumn, { payload });
}

export function updateBoardColumn(
  columnId: string,
  payload: UpdateBoardColumn,
): Promise<BoardColumn> {
  return invokeCommand(COMMANDS.board.updateColumn, { columnId, payload });
}

export function deleteBoardColumn(columnId: string): Promise<void> {
  return invokeCommand(COMMANDS.board.deleteColumn, { columnId });
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

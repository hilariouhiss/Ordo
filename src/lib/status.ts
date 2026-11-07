import type { Status } from "../model/types";

export type StatusDisplay = Status | "suspended" | "waiting";

/**
 * A parked task reads as paused even though its stored status stays doing, so resuming
 * brings it back to where it was. Waiting wins over a stale suspension: they are exclusive.
 */
export function statusDisplay(status: Status, suspended: boolean, waiting = false): StatusDisplay {
  if (status === "done") return "done";
  if (waiting) return "waiting";
  return suspended ? "suspended" : status;
}

/** A task can be parked while it is still open and not already suspended. */
export function canSuspendTask(task: { status: Status; suspended: boolean }): boolean {
  return task.status !== "done" && !task.suspended;
}

/** Any open task can wait on someone; a waiting one opens the dialog to move its day. */
export function canWaitTask(task: { status: Status; waiting: boolean }): boolean {
  return task.status !== "done";
}

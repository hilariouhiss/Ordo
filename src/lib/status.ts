import type { Status } from "../model/types";

export type StatusDisplay = Status | "suspended";

/**
 * A suspended task reads as paused even though its stored status stays doing,
 * so resuming brings it back to where it was.
 */
export function statusDisplay(status: Status, suspended: boolean): StatusDisplay {
  if (status === "done") return "done";
  return suspended ? "suspended" : status;
}

/** A task can be parked while it is still open and not already suspended. */
export function canSuspendTask(task: { status: Status; suspended: boolean }): boolean {
  return task.status !== "done" && !task.suspended;
}

import type { Status } from "../model/types";

export type StatusDisplay = Status | "parked";

/**
 * The one state a task shows: a park hides its stored status (kept so resuming brings it
 * back), and a finished task stays done even if a stale flag survived.
 */
export function statusDisplay(status: Status, parked: boolean): StatusDisplay {
  if (status === "done") return "done";
  return parked ? "parked" : status;
}

/** A task can be set aside until it is finished. */
export function canParkTask(task: { status: Status }): boolean {
  return task.status !== "done";
}

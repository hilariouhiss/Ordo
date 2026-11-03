import { aiEnrich, capture } from "../model/ipc";
import type { CaptureFields, Task } from "../model/types";
import { appVM } from "./appVM";

/** Saves one captured line and starts the optional AI fill. */
export async function saveCapture(
  title: string,
  fields: CaptureFields,
  newProjectName: string | null,
): Promise<Task> {
  const task = await capture(title, fields, newProjectName);
  // A new project changes the shared list the next capture reads.
  if (newProjectName) void appVM.load().catch(() => {});
  // The fill is best effort; its failure must never reach the caller.
  void aiEnrich(task.id).catch(() => {});
  return task;
}

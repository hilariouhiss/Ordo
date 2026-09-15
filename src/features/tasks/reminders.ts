/**
 * Reminder event intake (R-01/R-02): the backend scheduler broadcasts fired
 * reminders as `reminder:triggered` events and shows the system notification
 * itself. This listener surfaces each reminder as an in-app notification and
 * implements click-to-locate: a reminder that fired while the window was
 * hidden is held as pending, and when the OS focuses the window (what
 * clicking the system notification does), the task viewer opens on it.
 */

import { createSignal } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { format } from "date-fns";
import { EVENTS } from "../../common/ipc/events";
import { pushInfo } from "../../common/stores/notifications";
import { openTaskViewer } from "../../common/stores/taskViewer";
import { loadAll } from "./hooks";
import { tasksState } from "./store";

/** Wire shape of the backend `Reminder` model (serde camelCase). */
export interface ReminderPayload {
  taskId: string;
  taskTitle: string;
  kind: "advance_1h" | "advance_10m" | "due";
  /** ISO-8601 UTC timestamp of the task's due time. */
  dueAt: string;
}

const [pending, setPending] = createSignal<ReminderPayload | null>(null);

/** Reminder fired while the window was hidden, awaiting the next focus. */
export function pendingReminder(): ReminderPayload | null {
  return pending();
}

/** Human-readable reminder text; the due time renders in the local timezone. */
export function formatReminderMessage(reminder: ReminderPayload): string {
  const due = new Date(reminder.dueAt);
  const time = Number.isNaN(due.getTime()) ? "" : format(due, "HH:mm");
  // The payload names the task the reminder belongs to — a child task names
  // itself, not its parent.
  const subject = reminder.taskTitle;
  switch (reminder.kind) {
    case "advance_1h":
      return `「${subject}」将于 1 小时后（${time}）到期`;
    case "advance_10m":
      return `「${subject}」将于 10 分钟后（${time}）到期`;
    case "due":
      return `「${subject}」已到截止时间（${time}）`;
  }
}

function handleReminder(reminder: ReminderPayload): void {
  pushInfo(formatReminderMessage(reminder));
  if (document.hidden) setPending(reminder);
}

/**
 * Consumes the pending reminder: opens the task viewer on its task (loading
 * the task data first if the store never got populated). Wired to the
 * window `focus` event — clicking the system notification focuses Ordo,
 * which lands the user on the right task.
 */
export async function locatePendingReminder(): Promise<void> {
  const reminder = pending();
  if (!reminder) return;
  setPending(null);
  if (!tasksState.loaded) await loadAll();
  openTaskViewer(reminder.taskId);
}

/** Clears intake state (test seam). */
export function resetReminderIntake(): void {
  setPending(null);
}

/**
 * Subscribes to backend reminder events for the app's lifetime. Safe to call
 * outside Tauri (plain browser dev server): the subscription simply fails
 * and reminders stay silent there.
 */
export async function subscribeToReminders(): Promise<void> {
  try {
    await listen<ReminderPayload>(EVENTS.reminderTriggered, (event) => {
      handleReminder(event.payload);
    });
    window.addEventListener("focus", () => void locatePendingReminder());
  } catch {
    // No Tauri runtime available; nothing to clean up.
  }
}

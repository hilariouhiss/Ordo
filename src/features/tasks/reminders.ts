/**
 * Reminder event intake (R-01): the backend scheduler broadcasts fired
 * reminders as `reminder:triggered` events; this listener surfaces each one
 * as an in-app notification. R-02 adds system notifications on top.
 */

import { listen } from "@tauri-apps/api/event";
import { format } from "date-fns";
import { EVENTS } from "../../common/ipc/events";
import { pushInfo } from "../../common/stores/notifications";

/** Wire shape of the backend `Reminder` model (serde camelCase). */
export interface ReminderPayload {
  taskId: string;
  taskTitle: string;
  kind: "advance_1h" | "advance_10m" | "due";
  /** ISO-8601 UTC timestamp of the task's due time. */
  dueAt: string;
}

/** Human-readable reminder text; the due time renders in the local timezone. */
export function formatReminderMessage(reminder: ReminderPayload): string {
  const due = new Date(reminder.dueAt);
  const time = Number.isNaN(due.getTime()) ? "" : format(due, "HH:mm");
  switch (reminder.kind) {
    case "advance_1h":
      return `「${reminder.taskTitle}」将于 1 小时后（${time}）到期`;
    case "advance_10m":
      return `「${reminder.taskTitle}」将于 10 分钟后（${time}）到期`;
    case "due":
      return `「${reminder.taskTitle}」已到截止时间（${time}）`;
  }
}

/**
 * Subscribes to backend reminder events for the app's lifetime. Safe to call
 * outside Tauri (plain browser dev server): the subscription simply fails
 * and reminders stay silent there.
 */
export async function subscribeToReminders(): Promise<void> {
  try {
    await listen<ReminderPayload>(EVENTS.reminderTriggered, (event) => {
      pushInfo(formatReminderMessage(event.payload));
    });
  } catch {
    // No Tauri runtime available; nothing to clean up.
  }
}

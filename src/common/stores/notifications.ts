import { createSignal } from "solid-js";

/** Severity of a notification; only `error` is pushed by the data layer. */
export type NotificationKind = "error" | "info";

/** One toast/notification entry surfaced to the user. */
export interface AppNotification {
  id: number;
  kind: NotificationKind;
  message: string;
  /** Backend error code when this notification reports a failed IPC call. */
  code?: string;
}

const [list, setList] = createSignal<AppNotification[]>([]);

/** Current notifications, newest last. */
export const notifications = list;

let nextId = 1;

/** Appends a notification and returns its id (for dismissal). */
export function pushNotification(
  kind: NotificationKind,
  message: string,
  code?: string,
): number {
  const id = nextId++;
  setList((items) => [...items, { id, kind, message, code }]);
  return id;
}

/** Reports a failed operation; `code` is the normalized backend error code. */
export function pushError(message: string, code?: string): number {
  return pushNotification("error", message, code);
}

/** Reports a neutral informational message. */
export function pushInfo(message: string): number {
  return pushNotification("info", message);
}

/** Removes one notification by id. */
export function dismissNotification(id: number): void {
  setList((items) => items.filter((item) => item.id !== id));
}

/** Removes every notification at once. */
export function clearNotifications(): void {
  setList([]);
}

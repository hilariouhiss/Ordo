/**
 * Global drag state (R7): which entity the pointer is carrying right now.
 *
 * The drop targets live in a different component tree from the rows that start
 * the drag — a task row inside a view, a project row inside the sidebar — so
 * the payload cannot ride a prop and has to sit in a store.
 *
 * `dataTransfer` alone would be enough in a browser, but jsdom dispatches drag
 * events without one (the board's tests already rely on the same fallback), so
 * the signal is the source of truth and `dataTransfer` is the redundant copy
 * that keeps the drag working if it ever crosses a real window boundary.
 */

import { createSignal } from "solid-js";

export type DragKind = "task" | "project";

export interface DragPayload {
  kind: DragKind;
  id: string;
}

/** One MIME type per kind, so a task can never trigger a project-only drop. */
export const DRAG_MIME: Record<DragKind, string> = {
  task: "application/x-ordo-task",
  project: "application/x-ordo-project",
};

const [dragging, setDragging] = createSignal<DragPayload | null>(null);

/** Reactive payload of the in-flight drag; `null` when nothing is being dragged. */
export { dragging };

/** Starts a drag: fills `dataTransfer` and publishes the payload. */
export function beginDrag(event: DragEvent, payload: DragPayload): void {
  const transfer = event.dataTransfer;
  if (transfer) {
    transfer.setData(DRAG_MIME[payload.kind], payload.id);
    transfer.effectAllowed = "move";
  }
  setDragging(payload);
}

export function endDrag(): void {
  setDragging(null);
}

/**
 * The id of the dragged entity, or `null` when this drag carries another kind
 * (or nothing we started). Drop handlers must check this *before* calling
 * `preventDefault` — that call is what turns an element into a drop target.
 */
export function draggedId(event: DragEvent | undefined, kind: DragKind): string | null {
  const fromTransfer = event?.dataTransfer?.getData(DRAG_MIME[kind]);
  if (fromTransfer) return fromTransfer;
  const current = dragging();
  return current?.kind === kind ? current.id : null;
}

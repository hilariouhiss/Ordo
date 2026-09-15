/**
 * The pending "this item is still blocked" confirmation.
 *
 * The completion hooks cannot render UI, and every completion entry point (list
 * row, board card, detail dialog, subtask row) goes through them — so the
 * blocked case parks the request here and a single host component
 * (`components/BlockedConfirmHost.tsx`, mounted once by the app shell) turns it
 * into a dialog. Callers keep treating `null` as "did not complete". The
 * request carries the whole action (`run`), so the host replays the entry
 * point's own write without knowing which one it was.
 */

import { createSignal } from "solid-js";

/** One unfinished prerequisite, resolved for display. */
export interface BlockerRef {
  id: string;
  title: string;
}

export interface BlockedRequest {
  /** The task the user is trying to complete. */
  id: string;
  title: string;
  blockers: BlockerRef[];
  /** What to run once the user confirms; the host awaits it. */
  run: () => Promise<unknown>;
}

const [request, setRequest] = createSignal<BlockedRequest | null>(null);

/** The request awaiting confirmation, or `null`. */
export function blockedRequest(): BlockedRequest | null {
  return request();
}

export function requestBlockedConfirm(next: BlockedRequest): void {
  setRequest(next);
}

export function clearBlockedConfirm(): void {
  setRequest(null);
}

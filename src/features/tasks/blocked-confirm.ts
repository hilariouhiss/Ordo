/**
 * The pending "this item is still blocked" confirmation.
 *
 * The completion hooks cannot render UI, and every completion entry point (list
 * row, board card, detail dialog, subtask row) goes through them — so the
 * blocked case parks the request here and a single host component
 * (`components/BlockedConfirmHost.tsx`, mounted once by the app shell) turns it
 * into a dialog. Callers keep treating `null` as "did not complete".
 */

import { createSignal } from "solid-js";
import type { DependencyKind } from "./types";

/** One unfinished prerequisite, resolved for display. */
export interface BlockerRef {
  kind: DependencyKind;
  id: string;
  title: string;
}

export interface BlockedRequest {
  kind: DependencyKind;
  /** The entity the user is trying to complete. */
  id: string;
  /** Parent task of a subtask; `null` for a task. */
  parentId: string | null;
  title: string;
  blockers: BlockerRef[];
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

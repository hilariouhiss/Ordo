/**
 * Backend calls for the namespace domain — the only place in this feature that
 * touches the IPC layer. Components never call these directly; they go
 * through `hooks.ts`, which owns the optimistic-update flow.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type { Namespace, NewNamespace, UpdateNamespace } from "./types";

// --- namespace:* -------------------------------------------------------------

export function listNamespaces(): Promise<Namespace[]> {
  return invokeCommand(COMMANDS.namespace.list);
}

export function createNamespace(payload: NewNamespace): Promise<Namespace> {
  return invokeCommand(COMMANDS.namespace.create, { payload });
}

export function updateNamespace(
  namespaceId: string,
  payload: UpdateNamespace,
): Promise<Namespace> {
  return invokeCommand(COMMANDS.namespace.update, { namespaceId, payload });
}

export function archiveNamespace(namespaceId: string): Promise<Namespace> {
  return invokeCommand(COMMANDS.namespace.archive, { namespaceId });
}

export function restoreNamespace(namespaceId: string): Promise<Namespace> {
  return invokeCommand(COMMANDS.namespace.restore, { namespaceId });
}

/** Soft-deletes the namespace row; its projects keep their filing and read as
 * ungrouped until the next load. */
export function deleteNamespace(namespaceId: string): Promise<void> {
  return invokeCommand(COMMANDS.namespace.delete, { namespaceId });
}

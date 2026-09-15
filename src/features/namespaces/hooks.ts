/**
 * Mutation entry points for the namespace domain — the surface components use.
 *
 * Every write follows the plan §3 optimistic data flow:
 * `用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果 reconcile
 *  → 失败回滚 + 通知`. Hooks return the authoritative entity on success and
 * `null` on failure (a notification is pushed already; callers need not
 * try/catch).
 */

import {
  missingEntity,
  nextTempId,
  optimistic,
  reportFailure,
} from "../../common/optimistic";
import { randomColor } from "../../common/colors";
import * as api from "./api";
import * as store from "./store";
import type { Namespace, NewNamespace, UpdateNamespace } from "./types";

// --- loading -----------------------------------------------------------------

/** Loads all namespaces; returns success. */
export async function loadAll(): Promise<boolean> {
  try {
    store.setAll(await api.listNamespaces());
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

// --- namespaces --------------------------------------------------------------

/** Creates a namespace; a temporary entry appears instantly and is replaced by
 * the authoritative row once the backend replies. */
export function createNamespace(input: NewNamespace): Promise<Namespace | null> {
  const tempId = nextTempId();
  const now = new Date().toISOString();
  // 未指定颜色（`undefined`）就随机一个；显式 `null`=「无颜色」保持无色（R3）。
  const color = input.color === undefined ? randomColor() : input.color;
  const optimisticNamespace: Namespace = {
    id: tempId,
    name: input.name.trim(),
    description: input.description ?? null,
    color,
    icon: input.icon ?? null,
    status: "active",
    // Backend assigns the real key; "\uffff" keeps the temp entry last when
    // the sidebar re-sorts by sortOrder.
    sortOrder: "\uffff",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return optimistic(
    () => store.upsertNamespace(optimisticNamespace),
    () => store.removeNamespace(tempId),
    async () => {
      const created = await api.createNamespace({
        ...input,
        name: optimisticNamespace.name,
        color,
      });
      store.removeNamespace(tempId);
      store.upsertNamespace(created);
      return created;
    },
  );
}

/** Applies a partial patch optimistically (missing = unchanged, null = clear). */
export function updateNamespace(
  namespaceId: string,
  patch: UpdateNamespace,
): Promise<Namespace | null> {
  const current = store.getNamespace(namespaceId);
  if (!current) return Promise.resolve(missingEntity("命名空间"));
  const before: Namespace = { ...current };

  const optimisticPatch: Partial<Namespace> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) optimisticPatch.name = patch.name.trim();
  if ("description" in patch) optimisticPatch.description = patch.description ?? null;
  if ("color" in patch) optimisticPatch.color = patch.color ?? null;
  if ("icon" in patch) optimisticPatch.icon = patch.icon ?? null;

  return optimistic(
    () => store.patchNamespace(namespaceId, optimisticPatch),
    () => store.patchNamespace(namespaceId, before),
    async () => {
      const saved = await api.updateNamespace(namespaceId, patch);
      store.patchNamespace(namespaceId, saved);
      return saved;
    },
  );
}

/** Flips the namespace to archived optimistically; nav hides the group (and
 * its projects, which move into the archived section) immediately. */
export function archiveNamespace(namespaceId: string): Promise<Namespace | null> {
  const current = store.getNamespace(namespaceId);
  if (!current) return Promise.resolve(missingEntity("命名空间"));
  const before: Namespace = { ...current };
  const now = new Date().toISOString();

  return optimistic(
    () => store.patchNamespace(namespaceId, { status: "archived", updatedAt: now }),
    () => store.patchNamespace(namespaceId, before),
    async () => {
      const saved = await api.archiveNamespace(namespaceId);
      store.patchNamespace(namespaceId, saved);
      return saved;
    },
  );
}

/** Restores an archived namespace optimistically; nav shows the group again. */
export function restoreNamespace(namespaceId: string): Promise<Namespace | null> {
  const current = store.getNamespace(namespaceId);
  if (!current) return Promise.resolve(missingEntity("命名空间"));
  const before: Namespace = { ...current };
  const now = new Date().toISOString();

  return optimistic(
    () => store.patchNamespace(namespaceId, { status: "active", updatedAt: now }),
    () => store.patchNamespace(namespaceId, before),
    async () => {
      const saved = await api.restoreNamespace(namespaceId);
      store.patchNamespace(namespaceId, saved);
      return saved;
    },
  );
}

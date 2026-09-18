/**
 * Mutation entry points for the namespace domain — the surface components use.
 *
 * The write flow (`用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果
 * reconcile → 失败回滚 + 通知`) is shared with the project domain and lives in
 * `common/crud-hooks`; this file is the namespace-shaped wiring: the row a create
 * drafts, the fields an update touches, and which command each write calls.
 */

import { randomColor } from "../../common/colors";
import { createCrud } from "../../common/crud-hooks";
import * as api from "./api";
import * as store from "./store";
import type { Namespace, NewNamespace, UpdateNamespace } from "./types";

const crud = createCrud<Namespace, NewNamespace, UpdateNamespace>({
  label: "命名空间",

  store: {
    setAll: store.setAll,
    get: store.getNamespace,
    upsert: store.upsertNamespace,
    patch: store.patchNamespace,
    remove: store.removeNamespace,
  },

  api: {
    list: api.listNamespaces,
    // The draft carries the trimmed name and the colour R3 picked, so the write
    // sends exactly what the user is already looking at.
    create: (input, draft) =>
      api.createNamespace({ ...input, name: draft.name, color: draft.color }),
    update: api.updateNamespace,
    archive: api.archiveNamespace,
    restore: api.restoreNamespace,
  },

  draft: (input, id) => {
    const now = new Date().toISOString();
    // 未指定颜色（`undefined`）就随机一个；显式 `null`=「无颜色」保持无色（R3）。
    const color = input.color === undefined ? randomColor() : input.color;
    return {
      id,
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
  },

  patchOf: (patch) => {
    const optimistic: Partial<Namespace> = { updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) optimistic.name = patch.name.trim();
    if ("description" in patch) optimistic.description = patch.description ?? null;
    if ("color" in patch) optimistic.color = patch.color ?? null;
    if ("icon" in patch) optimistic.icon = patch.icon ?? null;
    return optimistic;
  },
});

/** Loads all namespaces; returns success. */
export const loadAll = crud.loadAll;

/** Creates a namespace; a temporary entry appears instantly and is replaced by
 * the authoritative row once the backend replies. */
export const createNamespace = crud.create;

/** Applies a partial patch optimistically (missing = unchanged, null = clear). */
export const updateNamespace = crud.update;

/** Flips the namespace to archived optimistically; nav hides the group (and
 * its projects, which move into the archived section) immediately. */
export const archiveNamespace = crud.archive;

/** Restores an archived namespace optimistically; nav shows the group again. */
export const restoreNamespace = crud.restore;

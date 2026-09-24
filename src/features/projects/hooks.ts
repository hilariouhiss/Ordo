/**
 * Mutation entry points for the project domain — the surface components use.
 *
 * The write flow (`用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果
 * reconcile → 失败回滚 + 通知`) is shared with the namespace domain and lives in
 * `common/crud-hooks`; this file is the project-shaped wiring: the row a create
 * drafts, the fields an update touches, and which command each write calls.
 */

import { randomColor } from "../../common/colors";
import { createCrud } from "../../common/crud-hooks";
import { insertTaskAt, removeTask, taskIndex, tasks } from "../tasks/store";
import * as api from "./api";
import * as store from "./store";
import type { NewProject, Project, UpdateProject } from "./types";

const crud = createCrud<Project, NewProject, UpdateProject>({
  label: "项目",

  store: {
    setAll: store.setAll,
    get: store.getProject,
    upsert: store.upsertProject,
    patch: store.patchProject,
    remove: store.removeProject,
  },

  api: {
    list: api.listProjects,
    // The draft carries the trimmed name and the colour R3 picked, so the write
    // sends exactly what the user is already looking at.
    create: (input, draft) =>
      api.createProject({ ...input, name: draft.name, color: draft.color }),
    update: api.updateProject,
    archive: api.archiveProject,
    restore: api.restoreProject,
    delete: api.deleteProject,
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
      namespaceId: input.namespaceId ?? null,
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
    const optimistic: Partial<Project> = { updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) optimistic.name = patch.name.trim();
    if ("description" in patch) optimistic.description = patch.description ?? null;
    if ("color" in patch) optimistic.color = patch.color ?? null;
    if ("icon" in patch) optimistic.icon = patch.icon ?? null;
    if ("namespaceId" in patch) optimistic.namespaceId = patch.namespaceId ?? null;
    return optimistic;
  },

  // The backend delete takes the project's tasks in the same write; the
  // optimistic step drops them from the task snapshot in the same tick, and the
  // rollback re-inserts each at its slot (ascending, or a clamped index would
  // land a row after one it used to precede — `softDeleteTask`'s contract).
  beforeDelete: (project) => {
    const removed = tasks()
      .filter((task) => task.projectId === project.id)
      .map((task) => ({ index: taskIndex(task.id), task: { ...task } }))
      .sort((a, b) => a.index - b.index);
    return {
      apply: () => {
        for (const { task } of removed) removeTask(task.id);
      },
      rollback: () => {
        for (const { index, task } of removed) insertTaskAt(index, task);
      },
    };
  },
});

/** Loads all projects; returns success. */
export const loadAll = crud.loadAll;

/** Creates a project; a temporary entry appears instantly and is replaced by
 * the authoritative row once the backend replies. */
export const createProject = crud.create;

/** Applies a partial patch optimistically (missing = unchanged, null = clear). */
export const updateProject = crud.update;

/** Flips the project to archived optimistically; nav hides it immediately. */
export const archiveProject = crud.archive;

/** Restores an archived project optimistically; nav shows it immediately. */
export const restoreProject = crud.restore;

/** Soft-deletes a project with its tasks; removed instantly, put back on
 * failure. */
export const deleteProject = crud.delete;

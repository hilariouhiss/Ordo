/**
 * Mutation entry points for the project domain — the surface components use.
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
import type { NewProject, Project, UpdateProject } from "./types";

// --- loading -----------------------------------------------------------------

/** Loads all projects; returns success. */
export async function loadAll(): Promise<boolean> {
  try {
    store.setAll(await api.listProjects());
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

// --- projects ----------------------------------------------------------------

/** Creates a project; a temporary entry appears instantly and is replaced by
 * the authoritative row once the backend replies. */
export function createProject(input: NewProject): Promise<Project | null> {
  const tempId = nextTempId();
  const now = new Date().toISOString();
  // 未指定颜色（`undefined`）就随机一个；显式 `null`=「无颜色」保持无色（R3）。
  const color = input.color === undefined ? randomColor() : input.color;
  const optimisticProject: Project = {
    id: tempId,
    name: input.name.trim(),
    description: input.description ?? null,
    color,
    icon: input.icon ?? null,
    namespaceId: input.namespaceId ?? null,
    dueAt: input.dueAt ?? null,
    status: "active",
    // Backend assigns the real key; "\uffff" keeps the temp entry last when
    // the sidebar re-sorts by sortOrder.
    sortOrder: "\uffff",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return optimistic(
    () => store.upsertProject(optimisticProject),
    () => store.removeProject(tempId),
    async () => {
      const created = await api.createProject({
        ...input,
        name: optimisticProject.name,
        color,
      });
      store.removeProject(tempId);
      store.upsertProject(created);
      return created;
    },
  );
}

/** Applies a partial patch optimistically (missing = unchanged, null = clear). */
export function updateProject(
  projectId: string,
  patch: UpdateProject,
): Promise<Project | null> {
  const current = store.getProject(projectId);
  if (!current) return Promise.resolve(missingEntity("项目"));
  const before: Project = { ...current };

  const optimisticPatch: Partial<Project> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) optimisticPatch.name = patch.name.trim();
  if ("description" in patch) optimisticPatch.description = patch.description ?? null;
  if ("color" in patch) optimisticPatch.color = patch.color ?? null;
  if ("icon" in patch) optimisticPatch.icon = patch.icon ?? null;
  if ("namespaceId" in patch) optimisticPatch.namespaceId = patch.namespaceId ?? null;
  if ("dueAt" in patch) optimisticPatch.dueAt = patch.dueAt ?? null;

  return optimistic(
    () => store.patchProject(projectId, optimisticPatch),
    () => store.patchProject(projectId, before),
    async () => {
      const saved = await api.updateProject(projectId, patch);
      store.patchProject(projectId, saved);
      return saved;
    },
  );
}

/** Flips the project to archived optimistically; nav hides it immediately. */
export function archiveProject(projectId: string): Promise<Project | null> {
  const current = store.getProject(projectId);
  if (!current) return Promise.resolve(missingEntity("项目"));
  const before: Project = { ...current };
  const now = new Date().toISOString();

  return optimistic(
    () => store.patchProject(projectId, { status: "archived", updatedAt: now }),
    () => store.patchProject(projectId, before),
    async () => {
      const saved = await api.archiveProject(projectId);
      store.patchProject(projectId, saved);
      return saved;
    },
  );
}

/** Restores an archived project optimistically; nav shows it immediately. */
export function restoreProject(projectId: string): Promise<Project | null> {
  const current = store.getProject(projectId);
  if (!current) return Promise.resolve(missingEntity("项目"));
  const before: Project = { ...current };
  const now = new Date().toISOString();

  return optimistic(
    () => store.patchProject(projectId, { status: "active", updatedAt: now }),
    () => store.patchProject(projectId, before),
    async () => {
      const saved = await api.restoreProject(projectId);
      store.patchProject(projectId, saved);
      return saved;
    },
  );
}

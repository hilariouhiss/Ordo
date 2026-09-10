/**
 * Mutation entry points for the project domain — the surface components use.
 *
 * Every write follows the plan §3 optimistic data flow:
 * `用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果 reconcile
 *  → 失败回滚 + 通知`. Hooks return the authoritative entity on success and
 * `null` on failure (a notification is pushed already; callers need not
 * try/catch).
 */

import { normalizeError } from "../../common/ipc";
import { pushError } from "../../common/stores/notifications";
import * as api from "./api";
import * as store from "./store";
import type { NewProject, Project, UpdateProject } from "./types";

/** Prefix for optimistic ids; never collides with backend UUIDs. */
const TEMP_PREFIX = "optimistic-";
let tempSeq = 0;

function nextTempId(): string {
  tempSeq += 1;
  return `${TEMP_PREFIX}${Date.now().toString(36)}-${tempSeq}`;
}

/** Normalizes any thrown value, surfaces it as an error notification. */
function reportFailure(error: unknown): null {
  const normalized = normalizeError(error);
  pushError(normalized.message, normalized.code);
  return null;
}

/** Applies `apply`, runs `action`, reconciles; rolls back + notifies on failure. */
async function optimistic<T>(
  apply: () => void,
  rollback: () => void,
  action: () => Promise<T>,
): Promise<T | null> {
  apply();
  try {
    return await action();
  } catch (error) {
    rollback();
    return reportFailure(error);
  }
}

function missingEntity(what: string): null {
  pushError(`${what}不存在或数据已刷新，请重试`);
  return null;
}

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
  const optimisticProject: Project = {
    id: tempId,
    name: input.name.trim(),
    description: input.description ?? null,
    color: input.color ?? null,
    icon: input.icon ?? null,
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
      const created = await api.createProject({ ...input, name: optimisticProject.name });
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

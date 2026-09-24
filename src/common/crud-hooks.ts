/**
 * The write flow shared by the two archivable-entity domains (projects,
 * namespaces): load, optimistic create, partial patch, archive/restore toggle,
 * optimistic delete — each reconciled with the row the backend returns, each
 * rolled back when the write fails.
 *
 * The domains differ in their row shape, their command names and the handful of
 * fields an editor may send, so those arrive as wiring. The flow is identical,
 * and it is the part worth having once: the rollback snapshot below has to be
 * taken *before* the write (the store mutates rows in place), which is exactly
 * the kind of detail that rots when it is copied per domain.
 */

import {
  missingEntity,
  nextTempId,
  optimistic,
  patchRollback,
  reportFailure,
} from "./optimistic";

/** The fields every row in this flow carries. */
export interface CrudRow {
  id: string;
  status: "active" | "archived";
  updatedAt: string;
}

export interface CrudStore<T> {
  setAll(rows: T[]): void;
  get(id: string): T | undefined;
  upsert(row: T): void;
  patch(id: string, patch: Partial<T>): void;
  remove(id: string): void;
}

export interface CrudWiring<T extends CrudRow, TNew, TUpdate> {
  /** Noun for the "that row is gone" notification. */
  label: string;
  store: CrudStore<T>;
  api: {
    list: () => Promise<T[]>;
    /** `draft` is the optimistic row: what the user is already looking at. */
    create: (input: TNew, draft: T) => Promise<T>;
    update: (id: string, patch: TUpdate) => Promise<T>;
    archive: (id: string) => Promise<T>;
    restore: (id: string) => Promise<T>;
    delete: (id: string) => Promise<void>;
  };
  /** The optimistic row for a create, before the backend assigns the real id. */
  draft: (input: TNew, tempId: string) => T;
  /** The fields an update writes, as the optimistic patch. */
  patchOf: (patch: TUpdate) => Partial<T>;
  /** Rows a delete cascades to beyond this one, and how to undo that locally.
   * The backend deletes them in the same write; without this the screen would
   * show them until the next load. */
  beforeDelete?: (row: T) => { apply: () => void; rollback: () => void };
}

export interface Crud<T, TNew, TUpdate> {
  loadAll: () => Promise<boolean>;
  create: (input: TNew) => Promise<T | null>;
  update: (id: string, patch: TUpdate) => Promise<T | null>;
  archive: (id: string) => Promise<T | null>;
  restore: (id: string) => Promise<T | null>;
  delete: (id: string) => Promise<boolean | null>;
}

export function createCrud<T extends CrudRow, TNew, TUpdate>(
  wiring: CrudWiring<T, TNew, TUpdate>,
): Crud<T, TNew, TUpdate> {
  const { store, api, label } = wiring;

  /**
   * Applies the optimistic patch, reconciles with the authoritative row, and
   * rolls back only the fields this write touched — captured before the write,
   * or the rollback would read the optimistic values back (QA-05).
   */
  function applyPatch(
    id: string,
    patch: Partial<T>,
    action: () => Promise<T>,
  ): Promise<T | null> {
    const current = store.get(id);
    if (!current) return Promise.resolve(missingEntity(label));
    const rollback = patchRollback(current, patch);

    return optimistic(
      () => store.patch(id, patch),
      () => store.patch(id, rollback),
      async () => {
        const saved = await action();
        store.patch(id, saved);
        return saved;
      },
    );
  }

  function setStatus(id: string, status: T["status"]): Promise<T | null> {
    const patch = { status, updatedAt: new Date().toISOString() } as Partial<T>;
    return applyPatch(id, patch, () =>
      status === "archived" ? api.archive(id) : api.restore(id),
    );
  }

  return {
    /** Loads every live row (archived included); returns success. */
    async loadAll(): Promise<boolean> {
      try {
        store.setAll(await api.list());
        return true;
      } catch (error) {
        reportFailure(error);
        return false;
      }
    },

    /** Creates a row; a temporary entry appears instantly and is replaced by
     * the authoritative row once the backend replies. */
    create(input: TNew): Promise<T | null> {
      const tempId = nextTempId();
      const draft = wiring.draft(input, tempId);

      return optimistic(
        () => store.upsert(draft),
        () => store.remove(tempId),
        async () => {
          const created = await api.create(input, draft);
          store.remove(tempId);
          store.upsert(created);
          return created;
        },
      );
    },

    /** Partial patch optimistically (missing = unchanged, null = clear). */
    update(id: string, patch: TUpdate): Promise<T | null> {
      return applyPatch(id, wiring.patchOf(patch), () => api.update(id, patch));
    },

    /** Flips the row to archived optimistically; nav hides it immediately. */
    archive: (id: string) => setStatus(id, "archived"),

    /** Restores an archived row optimistically; nav shows it immediately. */
    restore: (id: string) => setStatus(id, "active"),

    /** Soft-deletes a row; removed instantly, put back on failure. The
     * cascade (`beforeDelete`) shares the same optimistic step and rollback,
     * so a project's tasks vanish with it in the same tick. */
    delete(id: string): Promise<boolean | null> {
      const current = store.get(id);
      if (!current) return Promise.resolve(missingEntity(label));
      const snapshot: T = { ...current };
      const cascade = wiring.beforeDelete?.(snapshot);

      return optimistic(
        () => {
          store.remove(id);
          cascade?.apply();
        },
        () => {
          store.upsert(snapshot);
          cascade?.rollback();
        },
        async () => {
          await api.delete(id);
          return true;
        },
      );
    },
  };
}

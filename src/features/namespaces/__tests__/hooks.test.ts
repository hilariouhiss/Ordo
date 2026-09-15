import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearNotifications, notifications } from "../../../common/stores/notifications";
import type { Namespace } from "../types";

vi.mock("../api", () => ({
  listNamespaces: vi.fn(),
  createNamespace: vi.fn(),
  updateNamespace: vi.fn(),
  archiveNamespace: vi.fn(),
  restoreNamespace: vi.fn(),
}));

import * as api from "../api";
import * as hooks from "../hooks";
import * as store from "../store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function appError(code = "validation", message = "操作失败") {
  return { code, message } as const;
}

function namespace(id: string, overrides: Partial<Namespace> = {}): Namespace {
  return {
    id,
    name: `命名空间 ${id}`,
    description: null,
    color: null,
    icon: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetNamespacesStore();
  clearNotifications();
});

afterEach(() => {
  clearNotifications();
});

describe("loadAll", () => {
  it("fills the store with namespaces", async () => {
    vi.mocked(api.listNamespaces).mockResolvedValue([namespace("a"), namespace("b")]);

    const ok = await hooks.loadAll();

    expect(ok).toBe(true);
    expect(store.namespacesState.namespaces).toHaveLength(2);
    expect(store.namespacesState.loaded).toBe(true);
  });

  it("notifies and reports failure when loading fails", async () => {
    vi.mocked(api.listNamespaces).mockRejectedValue(appError("database", "数据库错误"));

    const ok = await hooks.loadAll();

    expect(ok).toBe(false);
    expect(store.namespacesState.loaded).toBe(false);
    expect(notifications()).toEqual([
      { id: expect.any(Number), kind: "error", message: "数据库错误", code: "database" },
    ]);
  });
});

describe("createNamespace", () => {
  it("shows a trimmed optimistic entry, then reconciles with the real row", async () => {
    const pending = deferred<Namespace>();
    vi.mocked(api.createNamespace).mockReturnValue(pending.promise);

    const result = hooks.createNamespace({ name: "  工作  " });

    const optimistic = store.namespacesState.namespaces;
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].name).toBe("工作");
    expect(optimistic[0].id).toMatch(/^optimistic-/);

    pending.resolve(namespace("real-1", { name: "工作" }));
    const created = await result;

    expect(created?.id).toBe("real-1");
    expect(api.createNamespace).toHaveBeenCalledWith({ name: "工作" });
    expect(store.namespacesState.namespaces).toEqual([namespace("real-1", { name: "工作" })]);
  });

  it("removes the optimistic entry and notifies on failure", async () => {
    vi.mocked(api.createNamespace).mockRejectedValue(appError("validation", "名称已存在"));

    const created = await hooks.createNamespace({ name: "重名" });

    expect(created).toBeNull();
    expect(store.namespacesState.namespaces).toEqual([]);
    expect(notifications()).toHaveLength(1);
  });
});

describe("updateNamespace", () => {
  it("applies the patch optimistically and reconciles", async () => {
    store.setAll([namespace("n1")]);
    vi.mocked(api.updateNamespace).mockResolvedValue(namespace("n1", { name: "新名" }));

    const saved = await hooks.updateNamespace("n1", { name: "新名", color: null });

    expect(saved?.name).toBe("新名");
    expect(api.updateNamespace).toHaveBeenCalledWith("n1", { name: "新名", color: null });
    expect(store.getNamespace("n1")?.name).toBe("新名");
  });

  it("rolls back and notifies when the backend rejects the write", async () => {
    store.setAll([namespace("n1", { name: "原名", description: "原说明" })]);
    vi.mocked(api.updateNamespace).mockRejectedValue(appError("validation", "无效"));

    const saved = await hooks.updateNamespace("n1", { name: "新名" });

    expect(saved).toBeNull();
    expect(store.getNamespace("n1")?.name).toBe("原名");
    expect(store.getNamespace("n1")?.description).toBe("原说明");
    expect(notifications()).toHaveLength(1);
  });

  it("reports a missing namespace without calling the backend", async () => {
    const saved = await hooks.updateNamespace("ghost", { name: "x" });

    expect(saved).toBeNull();
    expect(api.updateNamespace).not.toHaveBeenCalled();
    expect(notifications()).toHaveLength(1);
  });
});

describe("archiveNamespace / restoreNamespace", () => {
  it("flips the status optimistically and reconciles", async () => {
    store.setAll([namespace("n1")]);
    vi.mocked(api.archiveNamespace).mockResolvedValue(namespace("n1", { status: "archived" }));

    const archived = await hooks.archiveNamespace("n1");

    expect(archived?.status).toBe("archived");
    expect(store.activeNamespaces()).toEqual([]);
    expect(store.archivedNamespaces()).toEqual([namespace("n1", { status: "archived" })]);

    vi.mocked(api.restoreNamespace).mockResolvedValue(namespace("n1"));
    const restored = await hooks.restoreNamespace("n1");

    expect(restored?.status).toBe("active");
    expect(store.activeNamespaces()).toHaveLength(1);
  });

  it("restores the previous status when archiving fails", async () => {
    store.setAll([namespace("n1")]);
    vi.mocked(api.archiveNamespace).mockRejectedValue(appError("database", "数据库错误"));

    const archived = await hooks.archiveNamespace("n1");

    expect(archived).toBeNull();
    expect(store.getNamespace("n1")?.status).toBe("active");
  });
});

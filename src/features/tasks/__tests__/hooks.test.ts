import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@solidjs/testing-library";
import { COLORS } from "../../../common/colors";
import {
  clearNotifications,
  notifications,
} from "../../../common/stores/notifications";
import type { Dependency, Tag, Task, TimeEntry } from "../types";

vi.mock("../api", () => ({
  listTasks: vi.fn(),
  listUnfinishedCounts: vi.fn().mockResolvedValue([]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  reorderTask: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listDependencies: vi.fn().mockResolvedValue([]),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  listComments: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  listTimeEntries: vi.fn(),
  createTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  startTimeEntry: vi.fn(),
  stopTimeEntry: vi.fn(),
}));

import * as api from "../api";
import { blockedRequest, clearBlockedConfirm } from "../blocked-confirm";
import * as hooks from "../hooks";
import * as store from "../store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function appError(code = "validation", message = "操作失败") {
  return { code, message } as const;
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: null,
    title: `任务 ${id}`,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt: null,
    repeatRule: null,
    complexity: null,
    parentTaskId: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function tag(id: string, name: string): Tag {
  return {
    id,
    name,
    color: null,
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
  };
}

function timeEntry(id: string, taskId: string, overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id,
    taskId,
    startedAt: "2026-09-09T09:00:00Z",
    endedAt: "2026-09-09T09:30:00Z",
    duration: 1800,
    createdAt: "2026-09-09T09:30:00Z",
    updatedAt: "2026-09-09T09:30:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetTasksStore();
  clearNotifications();
});

afterEach(() => {
  clearNotifications();
});

describe("loadAll", () => {
  it("fills the store with tasks and tags", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([task("a"), task("b")]);
    vi.mocked(api.listTags).mockResolvedValue([tag("t1", "工作")]);

    const ok = await hooks.loadAll();

    expect(ok).toBe(true);
    expect(store.tasks()).toHaveLength(2);
    expect(store.tasksState.tags).toHaveLength(1);
    expect(store.tasksState.loaded).toBe(true);
  });

  it("notifies and reports failure when loading fails", async () => {
    vi.mocked(api.listTasks).mockRejectedValue(appError("database", "数据库错误"));
    vi.mocked(api.listTags).mockResolvedValue([]);

    const ok = await hooks.loadAll();

    expect(ok).toBe(false);
    expect(store.tasksState.loaded).toBe(false);
    expect(notifications()).toEqual([
      { id: expect.any(Number), kind: "error", message: "数据库错误", code: "database" },
    ]);
  });

  it("takes the whole tree in one snapshot and loads the edges with it", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([
      task("a"),
      task("child", { parentTaskId: "a" }),
    ]);
    vi.mocked(api.listTags).mockResolvedValue([]);
    vi.mocked(api.listDependencies).mockResolvedValue([
      { dependentId: "child", prerequisiteId: "a" },
    ]);

    const ok = await hooks.loadAll();

    expect(ok).toBe(true);
    // There is no hierarchy leg to load: a child is a row in the same list.
    expect(store.childrenOf("a").map((item) => item.id)).toEqual(["child"]);
    expect(store.hasChildren("a")).toBe(true);
    expect(store.tasksState.dependencies).toEqual([
      { dependentId: "child", prerequisiteId: "a" },
    ]);
  });
});

describe("reloadTasks", () => {
  it("re-reads tasks and tags, children included", async () => {
    store.setAll([task("a")], []);
    vi.mocked(api.listTasks).mockResolvedValue([
      task("a", { title: "改名" }),
      task("new"),
      task("child", { parentTaskId: "new" }),
    ]);
    vi.mocked(api.listTags).mockResolvedValue([tag("t1", "工作")]);

    const ok = await hooks.reloadTasks();

    expect(ok).toBe(true);
    // `tasks()` is key-ordered (these rows share a key, so it falls back to
    // created-at), not insertion-ordered.
    expect(store.tasks().map((item) => item.id)).toEqual(["a", "child", "new"]);
    expect(store.tasksState.tags).toHaveLength(1);
    // The refresh carries the tree with it, so a child written elsewhere is
    // visible without a second load.
    expect(store.childrenOf("new").map((item) => item.id)).toEqual(["child"]);
  });

  it("notifies and reports failure without touching the loaded data", async () => {
    store.setAll([task("a"), task("child", { parentTaskId: "a" })], []);
    vi.mocked(api.listTasks).mockRejectedValue(appError("database", "数据库错误"));
    vi.mocked(api.listTags).mockResolvedValue([]);

    const ok = await hooks.reloadTasks();

    expect(ok).toBe(false);
    expect(notifications()).toEqual([
      { id: expect.any(Number), kind: "error", message: "数据库错误", code: "database" },
    ]);
    expect(store.getTask("a")).toBeTruthy();
    expect(store.childrenOf("a").map((item) => item.id)).toEqual(["child"]);
  });
});

describe("ensureScope", () => {
  it("只拉一次；并发调用复用同一个请求；失败写 error", async () => {
    const page = {
      rows: [task("t1", { projectId: "p1" })],
      children: [],
      related: [],
      blocked: [],
      hasMore: false,
      cursor: null,
    };
    const load = vi.fn().mockResolvedValue(page);

    await Promise.all([hooks.ensureScope("project:p1", load), hooks.ensureScope("project:p1", load)]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(store.scopeRows("project:p1").map((row) => row.id)).toEqual(["t1"]);

    // 已装载 → 不再发请求。
    await hooks.ensureScope("project:p1", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("force 绕过「已装载」的短路（重试按钮用）", async () => {
    const load = vi.fn().mockResolvedValue({
      rows: [task("t9", { projectId: "p1" })],
      children: [],
      related: [],
      blocked: [],
      hasMore: false,
      cursor: null,
    });

    await hooks.ensureScope("project:p1", load);
    await hooks.ensureScope("project:p1", load, true);

    expect(load).toHaveBeenCalledTimes(2);
    expect(store.scopeRows("project:p1").map((row) => row.id)).toEqual(["t9"]);
  });

  it("失败记进 scopeMeta 并返回 false", async () => {
    const load = vi.fn().mockRejectedValue(appError("db", "读不出来"));

    await expect(hooks.ensureScope("project:p2", load)).resolves.toBe(false);

    expect(store.scopeMetaOf("project:p2").error).toBe("读不出来");
    // 失败不算装载完成，下一次还会重试。
    await hooks.ensureScope("project:p2", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("createTask", () => {
  it("shows a trimmed optimistic entry, then reconciles with the real row", async () => {
    const pending = deferred<Task>();
    vi.mocked(api.createTask).mockReturnValue(pending.promise);

    const call = hooks.createTask({ title: "  新任务  ", tagIds: ["t1"] });
    const optimistic = store.tasks().find((item) => item.title === "新任务");
    expect(optimistic).toBeTruthy();
    expect(optimistic?.id.startsWith("optimistic-")).toBe(true);
    expect(optimistic?.tagIds).toEqual(["t1"]);

    const authoritative = task("real-1", { title: "新任务" });
    pending.resolve(authoritative);
    const result = await call;

    expect(result).toEqual(authoritative);
    expect(store.tasks().some((item) => item.id.startsWith("optimistic-"))).toBe(
      false,
    );
    expect(store.getTask("real-1")?.title).toBe("新任务");
    expect(vi.mocked(api.createTask)).toHaveBeenCalledWith(
      expect.objectContaining({ title: "新任务" }),
    );
  });

  it("rolls the optimistic entry back and notifies on failure", async () => {
    vi.mocked(api.createTask).mockRejectedValue(appError("validation", "标题不能为空"));

    const result = await hooks.createTask({ title: "  " });

    expect(result).toBeNull();
    expect(store.tasks()).toEqual([]);
    expect(notifications()[0]).toMatchObject({ message: "标题不能为空", code: "validation" });
  });

  it("re-reads the list after creating a task that carried initial subtasks", async () => {
    vi.mocked(api.createTask).mockResolvedValue(task("created"));
    vi.mocked(api.listTasks).mockResolvedValue([
      task("created"),
      task("child", { parentTaskId: "created" }),
    ]);
    vi.mocked(api.listTags).mockResolvedValue([]);

    await hooks.createTask({ title: "新任务", subtaskTitles: ["第一步"] });

    // The children came back as plain rows of the same list, so one refresh is
    // all it takes to give the new row its disclosure control.
    await waitFor(() => expect(store.childrenOf("created")).toHaveLength(1));
    expect(api.listTasks).toHaveBeenCalled();
  });

  it("does not re-read the list when the new task carried none", async () => {
    vi.mocked(api.createTask).mockResolvedValue(task("created"));

    await hooks.createTask({ title: "新任务" });

    expect(api.listTasks).not.toHaveBeenCalled();
  });
});

describe("updateTask", () => {
  it("applies the patch optimistically and reconciles", async () => {
    store.setAll([task("a", { note: "旧备注", tagIds: ["t1"], completedAt: null })], []);
    const pending = deferred<Task>();
    vi.mocked(api.updateTask).mockReturnValue(pending.promise);

    const call = hooks.updateTask("a", {
      title: "改名",
      note: null,
      priority: "high",
      tagIds: ["t2"],
    });
    const optimistic = store.getTask("a");
    expect(optimistic?.title).toBe("改名");
    expect(optimistic?.note).toBeNull();
    expect(optimistic?.priority).toBe("high");
    expect(optimistic?.tagIds).toEqual(["t2"]);

    const authoritative = task("a", { title: "改名", priority: "high", tagIds: ["t2"] });
    pending.resolve(authoritative);
    await call;

    expect(store.getTask("a")).toEqual(authoritative);
  });

  it("rolls back only the fields it touched, leaving a concurrent write alone", async () => {
    store.setAll([task("a", { title: "旧标题", priority: "none" })], []);
    const pending = deferred<Task>();
    vi.mocked(api.updateTask).mockReturnValue(pending.promise);

    // The rename is in flight…
    const failing = hooks.updateTask("a", { title: "新标题" });

    // …while a second write on the same row lands and succeeds.
    vi.mocked(api.updateTask).mockResolvedValue(task("a", { title: "旧标题", priority: "high" }));
    await hooks.updateTask("a", { priority: "high" });

    pending.reject(appError("db", "写入失败"));
    await failing;

    expect(store.getTask("a")?.title).toBe("旧标题");
    // A whole-row rollback would take the priority write down with it, leaving
    // the screen disagreeing with the database until the next full load.
    expect(store.getTask("a")?.priority).toBe("high");
  });

  it("restores the exact previous state and notifies on failure", async () => {
    const original = task("a", { note: "旧备注", priority: "low" });
    store.setAll([original], []);
    // The store takes the fixture by reference and a patch mutates rows in
    // place, so the expected value has to be its own copy — comparing against
    // `original` would compare the row with itself.
    const expected = { ...original };
    vi.mocked(api.updateTask).mockRejectedValue(appError("db", "写入失败"));

    const result = await hooks.updateTask("a", { title: "改名", note: null });

    expect(result).toBeNull();
    expect(store.getTask("a")).toEqual(expected);
    expect(notifications()[0]?.message).toBe("写入失败");
  });

  it("files the task under a parent and promotes it back, optimistically", async () => {
    store.setAll([task("a"), task("p1")], []);
    const pending = deferred<Task>();
    vi.mocked(api.updateTask).mockReturnValue(pending.promise);

    const call = hooks.updateTask("a", { parentTaskId: "p1" });
    expect(store.getTask("a")?.parentTaskId).toBe("p1");
    expect(store.childrenOf("p1").map((item) => item.id)).toEqual(["a"]);

    pending.resolve(task("a", { parentTaskId: "p1" }));
    await call;

    // `null` is the "move back to the top level" patch, not a missing field.
    vi.mocked(api.updateTask).mockResolvedValue(task("a"));
    await hooks.updateTask("a", { parentTaskId: null });

    expect(api.updateTask).toHaveBeenLastCalledWith("a", { parentTaskId: null });
    expect(store.getTask("a")?.parentTaskId).toBeNull();
    expect(store.topLevelTasks().map((item) => item.id)).toEqual(["a", "p1"]);
  });

  it("rejects unknown ids without calling the backend", async () => {
    const result = await hooks.updateTask("missing", { title: "无" });

    expect(result).toBeNull();
    expect(api.updateTask).not.toHaveBeenCalled();
  });
});

describe("completeTask / uncompleteTask", () => {
  it("stamps completedAt optimistically then reconciles", async () => {
    store.setAll([task("a")], []);
    const pending = deferred<Task>();
    vi.mocked(api.completeTask).mockReturnValue(pending.promise);

    const call = hooks.completeTask("a");
    expect(store.getTask("a")?.completedAt).toBeTruthy();

    const authoritative = task("a", { completedAt: "2026-09-09T11:00:00Z" });
    pending.resolve(authoritative);
    await call;

    expect(store.getTask("a")?.completedAt).toBe("2026-09-09T11:00:00Z");
  });

  it("rolls back on failure", async () => {
    store.setAll([task("a")], []);
    vi.mocked(api.completeTask).mockRejectedValue(appError("not_found", "任务不存在"));

    const result = await hooks.completeTask("a");

    expect(result).toBeNull();
    expect(store.getTask("a")?.completedAt).toBeNull();
    expect(notifications()[0]?.code).toBe("not_found");
  });

  it("uncompletes through task:update with completedAt null", async () => {
    store.setAll([task("a", { completedAt: "2026-09-09T11:00:00Z" })], []);
    const pending = deferred<Task>();
    vi.mocked(api.updateTask).mockReturnValue(pending.promise);

    const call = hooks.uncompleteTask("a");
    expect(store.getTask("a")?.completedAt).toBeNull();
    expect(vi.mocked(api.updateTask)).toHaveBeenCalledWith("a", { completedAt: null });

    pending.resolve(task("a"));
    await call;
  });
});

describe("softDeleteTask / restoreTask", () => {
  it("removes the task instantly and keeps it removed on success", async () => {
    store.setAll([task("a"), task("b")], []);
    vi.mocked(api.softDeleteTask).mockResolvedValue(undefined);

    const result = await hooks.softDeleteTask("a");

    expect(result).toBe(true);
    expect(store.tasks().map((item) => item.id)).toEqual(["b"]);
  });

  it("re-inserts at the original position on failure", async () => {
    store.setAll([task("a"), task("b"), task("c")], []);
    vi.mocked(api.softDeleteTask).mockRejectedValue(appError("db", "删除失败"));

    const result = await hooks.softDeleteTask("b");

    expect(result).toBeNull();
    expect(store.tasks().map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("restores a deleted task with the authoritative row", async () => {
    vi.mocked(api.restoreTask).mockResolvedValue(task("a"));
    vi.mocked(api.listTasks).mockResolvedValue([task("a")]);
    vi.mocked(api.listTags).mockResolvedValue([]);

    const restored = await hooks.restoreTask("a");

    expect(restored?.id).toBe("a");
    expect(store.getTask("a")).toBeTruthy();
  });

  it("notifies when restore fails", async () => {
    vi.mocked(api.restoreTask).mockRejectedValue(appError("not_found", "任务不存在"));

    const restored = await hooks.restoreTask("missing");

    expect(restored).toBeNull();
    expect(store.tasks()).toEqual([]);
    expect(notifications()[0]?.message).toBe("任务不存在");
  });
});

describe("层级", () => {
  it("createTask files a new task under its parent", async () => {
    vi.mocked(api.createTask).mockImplementation(async (payload) =>
      task("new-1", { title: payload.title, parentTaskId: payload.parentTaskId ?? null }),
    );

    await hooks.createTask({ title: "收集数据", parentTaskId: "p1" });

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: "p1" }),
    );
  });

  it("soft-deleting a parent removes its children in the same tick", async () => {
    store.setAll([task("p1"), task("c1", { parentTaskId: "p1" })], []);
    vi.mocked(api.softDeleteTask).mockResolvedValue(undefined);

    await hooks.softDeleteTask("p1");

    expect(store.getTask("p1")).toBeUndefined();
    expect(store.getTask("c1")).toBeUndefined();
  });

  it("a failed parent delete puts every row back in the slot it left", async () => {
    store.setAll([task("c1", { parentTaskId: "p1" }), task("x1"), task("p1")], []);
    vi.mocked(api.softDeleteTask).mockRejectedValue(appError("db", "删除失败"));

    const result = await hooks.softDeleteTask("p1");

    expect(result).toBeNull();
    // Every row comes back with the key it had. `tasks()` is key-ordered, so
    // the rollback only has to restore rows and keys — not positions.
    expect(store.tasks().map((item) => item.id)).toEqual(["c1", "p1", "x1"]);
    expect(store.getTask("x1")?.sortOrder).toBe(store.getTask("p1")?.sortOrder);
  });

  it("restoring a parent re-reads the list so its children come back too", async () => {
    // `restoreTask` is not optimistic — it waits for the authoritative row.
    // The server restores the children in the same transaction, but the single
    // returned row cannot carry them, so the hook re-reads the list.
    store.setAll([], []);
    vi.mocked(api.restoreTask).mockResolvedValue(task("p1"));
    vi.mocked(api.listTasks).mockResolvedValue([
      task("p1"),
      task("c1", { parentTaskId: "p1" }),
    ]);
    vi.mocked(api.listTags).mockResolvedValue([]);

    await hooks.restoreTask("p1");

    expect(store.getTask("p1")).toBeDefined();
    await waitFor(() => expect(store.getTask("c1")).toBeDefined());
  });
});

describe("reorderTask", () => {
  it("posts the neighbour keys and installs the keys the backend rewrote", async () => {
    store.setAll([task("t1", { sortOrder: "n" }), task("t2", { sortOrder: "o" })], []);
    vi.mocked(api.reorderTask).mockResolvedValue({
      moved: task("t1", { sortOrder: "m" }),
      rebalanced: [{ id: "t2", sortOrder: "a" }],
    });

    const result = await hooks.reorderTask("t1", null, "m");

    expect(api.reorderTask).toHaveBeenCalledWith("t1", null, "m");
    expect(result?.id).toBe("t1");
    expect(result?.sortOrder).toBe("m");
    expect(store.getTask("t1")?.sortOrder).toBe("m");
    expect(store.getTask("t2")?.sortOrder).toBe("a");
    // Keys are the order: t1 now sorts before t2, with no re-splicing of the
    // scope's id list involved.
    expect(store.tasks().map((item) => item.id)).toEqual(["t2", "t1"]);
  });

  it("hands the rewritten keys to the derivation a view reads", async () => {
    store.setAll([task("t1", { sortOrder: "m" }), task("t2", { sortOrder: "n" })], []);
    vi.mocked(api.reorderTask).mockResolvedValue({
      moved: task("t1", { sortOrder: "b" }),
      rebalanced: [{ id: "t2", sortOrder: "a" }],
    });

    await hooks.reorderTask("t1", null, "m");

    // `tasks()` sorts by key, so patching the two keys is enough for every
    // reader — no re-splicing of the scope list involved.
    expect(store.topLevelTasks().map((item) => item.id)).toEqual(["t2", "t1"]);
  });
});

describe("tags", () => {
  it("creates a tag optimistically and reconciles", async () => {
    const pending = deferred<Tag>();
    vi.mocked(api.createTag).mockReturnValue(pending.promise);

    const call = hooks.createTag({ name: "  工作  " });
    expect(store.tasksState.tags.some((item) => item.name === "工作")).toBe(true);

    pending.resolve(tag("t1", "工作"));
    const result = await call;

    expect(result?.id).toBe("t1");
    expect(store.tasksState.tags[0]?.id).toBe("t1");
  });

  // R3: 新建标签不指定颜色 → 随机色；显式 `null` 仍是「无颜色」。
  it("gives a tag created without a colour a palette colour", async () => {
    vi.mocked(api.createTag).mockImplementation(async (input) => tag("t1", input.name));

    await hooks.createTag({ name: "随手" });

    expect(COLORS).toContain(vi.mocked(api.createTag).mock.calls[0]?.[0].color);
  });

  it("keeps an explicit null tag colour instead of randomizing it", async () => {
    vi.mocked(api.createTag).mockResolvedValue(tag("t1", "无色"));

    await hooks.createTag({ name: "无色", color: null });

    expect(api.createTag).toHaveBeenCalledWith({ name: "无色", color: null });
  });

  it("keeps duplicate names out of the store and notifies", async () => {
    vi.mocked(api.createTag).mockRejectedValue(appError("validation", "标签「工作」已存在"));

    const result = await hooks.createTag({ name: "工作" });

    expect(result).toBeNull();
    expect(store.tasksState.tags).toEqual([]);
    expect(notifications()[0]?.code).toBe("validation");
  });

  it("updates a tag optimistically and rolls back on failure", async () => {
    store.setAll([], [tag("t1", "工作")]);
    const pending = deferred<Tag>();
    vi.mocked(api.updateTag).mockReturnValue(pending.promise);

    const call = hooks.updateTag("t1", { name: "生活", color: "#00ff00" });
    expect(store.getTag("t1")?.name).toBe("生活");
    expect(store.getTag("t1")?.color).toBe("#00ff00");

    pending.resolve(tag("t1", "生活"));
    await call;
    expect(store.getTag("t1")?.name).toBe("生活");
  });

  it("deletes a tag and strips it from tasks, restoring both on failure", async () => {
    store.setAll(
      [task("a", { tagIds: ["t1", "t2"] }), task("b", { tagIds: [] })],
      [tag("t1", "工作"), tag("t2", "生活")],
    );

    const pending = deferred<void>();
    vi.mocked(api.deleteTag).mockReturnValue(pending.promise);

    const call = hooks.deleteTag("t1");
    expect(store.tasksState.tags.map((item) => item.id)).toEqual(["t2"]);
    expect(store.getTask("a")?.tagIds).toEqual(["t2"]);

    pending.reject(appError("db", "删除失败"));
    const result = await call;

    expect(result).toBeNull();
    expect(store.tasksState.tags.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(store.getTask("a")?.tagIds).toEqual(["t1", "t2"]);
  });
});

describe("time entries", () => {
  it("loads one task's entries into the cache", async () => {
    vi.mocked(api.listTimeEntries).mockResolvedValue([timeEntry("e1", "a")]);

    const ok = await hooks.loadTimeEntries("a");

    expect(ok).toBe(true);
    expect(api.listTimeEntries).toHaveBeenCalledWith("a");
    expect(store.getTimeEntries("a").map((item) => item.id)).toEqual(["e1"]);
  });

  it("records a manual entry optimistically and reconciles with the real row", async () => {
    store.setTimeEntries("a", []);
    const pending = deferred<TimeEntry>();
    vi.mocked(api.createTimeEntry).mockReturnValue(pending.promise);

    const call = hooks.createTimeEntry("a", {
      startedAt: "2026-09-09T09:00:00Z",
      duration: 600,
    });
    const optimistic = store.getTimeEntries("a")[0];
    expect(optimistic?.id.startsWith("optimistic-")).toBe(true);
    expect(optimistic?.duration).toBe(600);
    // The end is derived locally so the row already reads as a finished run.
    expect(optimistic?.endedAt).toBe("2026-09-09T09:10:00.000Z");

    const authoritative = timeEntry("e1", "a", {
      startedAt: "2026-09-09T09:00:00Z",
      endedAt: "2026-09-09T09:10:00Z",
      duration: 600,
    });
    pending.resolve(authoritative);
    const result = await call;

    expect(result).toEqual(authoritative);
    expect(store.getTimeEntries("a")).toEqual([authoritative]);
    expect(api.createTimeEntry).toHaveBeenCalledWith("a", {
      startedAt: "2026-09-09T09:00:00Z",
      duration: 600,
    });
  });

  it("rolls the optimistic manual entry back and notifies on failure", async () => {
    store.setTimeEntries("a", []);
    vi.mocked(api.createTimeEntry).mockRejectedValue(appError("validation", "时长需大于 0 秒"));

    const result = await hooks.createTimeEntry("a", {
      startedAt: "2026-09-09T09:00:00Z",
      duration: 0,
    });

    expect(result).toBeNull();
    expect(store.getTimeEntries("a")).toEqual([]);
    expect(notifications()[0]).toMatchObject({ message: "时长需大于 0 秒", code: "validation" });
  });

  it("starts a timer optimistically and reconciles with the running row", async () => {
    store.setTimeEntries("a", [timeEntry("old", "a")]);
    const pending = deferred<TimeEntry>();
    vi.mocked(api.startTimeEntry).mockReturnValue(pending.promise);

    const call = hooks.startTimer("a");
    const optimistic = store.getTimeEntries("a")[0];
    expect(optimistic?.id.startsWith("optimistic-")).toBe(true);
    expect(optimistic?.endedAt).toBeNull();
    expect(optimistic?.duration).toBe(0);

    // The backend answers with the authoritative running entry.
    const running = timeEntry("e2", "a", { endedAt: null, duration: 0 });
    pending.resolve(running);
    const result = await call;

    expect(result).toEqual(running);
    expect(api.startTimeEntry).toHaveBeenCalledWith("a");
    expect(store.getTimeEntries("a").map((item) => item.id)).toEqual(["e2", "old"]);
  });

  it("removes the optimistic timer again when starting fails", async () => {
    store.setTimeEntries("a", []);
    vi.mocked(api.startTimeEntry).mockRejectedValue(appError("not_found", "任务不存在"));

    const result = await hooks.startTimer("a");

    expect(result).toBeNull();
    expect(store.getTimeEntries("a")).toEqual([]);
    expect(notifications()[0]?.code).toBe("not_found");
  });

  it("stops a timer, freezing the elapsed seconds, and restores it on failure", async () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    store.setTimeEntries("a", [
      timeEntry("e1", "a", { startedAt, endedAt: null, duration: 0 }),
    ]);
    const pending = deferred<TimeEntry>();
    vi.mocked(api.stopTimeEntry).mockReturnValue(pending.promise);

    const call = hooks.stopTimer("a", "e1");
    const optimistic = store.getTimeEntries("a")[0];
    expect(optimistic?.endedAt).not.toBeNull();
    expect(optimistic?.duration).toBeGreaterThanOrEqual(90);
    expect(optimistic?.duration).toBeLessThan(95);

    const stopped = timeEntry("e1", "a", {
      startedAt,
      endedAt: new Date().toISOString(),
      duration: 91,
    });
    pending.resolve(stopped);
    expect(await call).toEqual(stopped);
    expect(store.getTimeEntries("a")[0]?.duration).toBe(91);

    // A rejected stop puts the previous row back untouched.
    const before = { ...store.getTimeEntries("a")[0]! };
    vi.mocked(api.stopTimeEntry).mockRejectedValue(appError("db", "写入失败"));
    expect(await hooks.stopTimer("a", "e1")).toBeNull();
    expect(store.getTimeEntries("a")[0]).toEqual(before);
    expect(notifications()[0]?.message).toBe("写入失败");
  });

  it("edits an entry's duration through time:update", async () => {
    store.setTimeEntries("a", [timeEntry("e1", "a", { duration: 600 })]);
    vi.mocked(api.updateTimeEntry).mockResolvedValue(timeEntry("e1", "a", { duration: 900 }));

    const result = await hooks.updateTimeEntry("a", "e1", { duration: 900 });

    expect(result?.duration).toBe(900);
    expect(store.getTimeEntries("a")[0]?.duration).toBe(900);
    expect(api.updateTimeEntry).toHaveBeenCalledWith("e1", { duration: 900 });
  });

  it("deletes an entry and re-inserts it at its old position on failure", async () => {
    store.setTimeEntries("a", [timeEntry("e1", "a"), timeEntry("e2", "a")]);
    const pending = deferred<void>();
    vi.mocked(api.deleteTimeEntry).mockReturnValue(pending.promise);

    const call = hooks.deleteTimeEntry("a", "e1");
    expect(store.getTimeEntries("a").map((item) => item.id)).toEqual(["e2"]);

    pending.reject(appError("db", "写入失败"));
    expect(await call).toBeNull();
    expect(store.getTimeEntries("a").map((item) => item.id)).toEqual(["e1", "e2"]);
  });
});

describe("依赖与软阻塞", () => {
  it("被阻塞时不落库，确认后由请求自带的动作完成", async () => {
    const blocked = task("a");
    const prerequisite = task("b");
    store.setAll([blocked, prerequisite], []);
    store.setDependencies([{ dependentId: "a", prerequisiteId: "b" }]);

    const result = await hooks.completeTask("a");
    expect(result).toBeNull();
    expect(api.completeTask).not.toHaveBeenCalled();
    expect(blockedRequest()?.blockers.map((blocker) => blocker.id)).toEqual(["b"]);
    // The parked request carries the blocked entity's title for the dialog
    // (`task()` names its fixtures `任务 <id>`).
    expect(blockedRequest()?.title).toBe("任务 a");

    // The host replays exactly what was parked.
    vi.mocked(api.completeTask).mockResolvedValue({ ...blocked, completedAt: "2026-09-14T10:00:00Z" });
    await blockedRequest()?.run();
    expect(api.completeTask).toHaveBeenCalledWith("a");
    store.setDependencies([]);
    clearBlockedConfirm();
  });

  it("子任务被阻塞时同样只停请求", async () => {
    // A child is a task: it goes through the same gate, and the parked request
    // names the child itself rather than its parent.
    store.setAll(
      [
        task("a"),
        task("child", { parentTaskId: "a", title: "第一步" }),
        task("s2", { parentTaskId: "a", title: "第二步" }),
      ],
      [],
    );
    store.setDependencies([{ dependentId: "child", prerequisiteId: "s2" }]);

    expect(await hooks.completeTask("child")).toBeNull();
    expect(api.completeTask).not.toHaveBeenCalled();
    expect(blockedRequest()).toMatchObject({
      id: "child",
      title: "第一步",
      blockers: [{ id: "s2", title: "第二步" }],
    });

    vi.mocked(api.completeTask).mockResolvedValue(
      task("child", { parentTaskId: "a", completedAt: "2026-09-14T10:00:00Z" }),
    );
    await blockedRequest()?.run();
    expect(api.completeTask).toHaveBeenCalledWith("child");
    store.setDependencies([]);
    clearBlockedConfirm();
  });

  it("前置被软删后不再阻塞，恢复后依赖自动回来", async () => {
    store.setAll([task("a"), task("b")], []);
    store.setDependencies([{ dependentId: "a", prerequisiteId: "b" }]);
    vi.mocked(api.softDeleteTask).mockResolvedValue(undefined);
    vi.mocked(api.completeTask).mockResolvedValue(
      task("a", { completedAt: "2026-09-14T10:00:00Z" }),
    );

    await hooks.softDeleteTask("b");

    // The edge is still in the list — the store's liveness is what changed, so
    // the dependent is free again without a restart or a `loadAll`.
    expect(store.tasksState.dependencies).toHaveLength(1);
    expect(await hooks.completeTask("a")).not.toBeNull();
    expect(api.completeTask).toHaveBeenCalledWith("a");
    expect(blockedRequest()).toBeNull();

    // Restoring the prerequisite brings the relation back. `dependency:listAll`
    // only reports edges whose endpoints are both live, so while `b` sat in the
    // trash the edge was absent from every snapshot the app loaded — the
    // restore's own re-read is what puts it back (QA-09).
    store.setDependencies([]); // the refresh that ran while `b` was deleted
    vi.mocked(api.restoreTask).mockResolvedValue(task("b"));
    vi.mocked(api.listTasks).mockResolvedValue([task("a"), task("b")]);
    vi.mocked(api.listTags).mockResolvedValue([]);
    vi.mocked(api.listDependencies).mockResolvedValue([
      { dependentId: "a", prerequisiteId: "b" },
    ]);
    await hooks.restoreTask("b");
    await waitFor(() => expect(store.getTask("b")).toBeDefined());

    expect(await hooks.completeTask("a")).toBeNull();
    expect(blockedRequest()?.blockers.map((blocker) => blocker.id)).toEqual(["b"]);

    store.setDependencies([]);
    clearBlockedConfirm();
  });

  it("前置已完成时直接完成，不弹确认", async () => {
    const dependent = task("a");
    const done = task("b", { completedAt: "2026-09-14T09:00:00Z" });
    store.setAll([dependent, done], []);
    store.setDependencies([{ dependentId: "a", prerequisiteId: "b" }]);
    vi.mocked(api.completeTask).mockResolvedValue({
      ...dependent,
      completedAt: "2026-09-14T10:00:00Z",
    });

    await hooks.completeTask("a");

    expect(api.completeTask).toHaveBeenCalledWith("a");
    expect(blockedRequest()).toBeNull();
    store.setDependencies([]);
  });

  it("取消完成不受前置影响，直接落库", async () => {
    store.setAll(
      [task("check", { completedAt: "2026-09-14T09:00:00Z" })],
      [],
    );
    // The prerequisite is unfinished — and nonexistent, so nothing else can
    // explain the pass: un-completing never reaches the gate.
    store.setDependencies([{ dependentId: "check", prerequisiteId: "s2" }]);
    vi.mocked(api.updateTask).mockResolvedValue(task("check"));

    const result = await hooks.uncompleteTask("check");

    expect(api.updateTask).toHaveBeenCalledWith("check", { completedAt: null });
    expect(result?.completedAt).toBeNull();
    expect(blockedRequest()).toBeNull();
    store.setDependencies([]);
  });

  it("添加与删除依赖走乐观更新并调用 api", async () => {
    store.setAll([task("a"), task("b")], []);
    vi.mocked(api.addDependency).mockResolvedValue({
      dependentId: "a",
      prerequisiteId: "b",
    });

    await hooks.addDependency("a", "b");

    expect(store.tasksState.dependencies).toEqual([
      { dependentId: "a", prerequisiteId: "b" },
    ]);
    expect(api.addDependency).toHaveBeenCalledWith({
      dependentId: "a",
      prerequisiteId: "b",
    });

    vi.mocked(api.removeDependency).mockResolvedValue(undefined);
    await hooks.removeDependency("a", "b");
    expect(store.tasksState.dependencies).toEqual([]);
  });

  it("依赖写入失败时回滚到原数组并通知", async () => {
    store.setAll([task("a"), task("b")], []);
    const pending = deferred<Dependency>();
    vi.mocked(api.addDependency).mockReturnValue(pending.promise);

    const call = hooks.addDependency("a", "b");
    // Optimistic: the edge is in the store before the IPC settles.
    expect(store.tasksState.dependencies).toEqual([
      { dependentId: "a", prerequisiteId: "b" },
    ]);

    pending.reject(appError("db", "写入失败"));
    expect(await call).toBeNull();
    expect(store.tasksState.dependencies).toEqual([]);
    expect(notifications()[0]?.message).toBe("写入失败");

    // Removal rolls back the same way, from an edge that is there.
    store.setDependencies([{ dependentId: "a", prerequisiteId: "b" }]);
    vi.mocked(api.removeDependency).mockRejectedValue(appError("db", "写入失败"));
    expect(await hooks.removeDependency("a", "b")).toBeNull();
    expect(store.tasksState.dependencies).toEqual([
      { dependentId: "a", prerequisiteId: "b" },
    ]);

    // An edge that is not in the store is a silent no-op success, not a write:
    // a second click on the same remove button must not raise an error toast.
    expect(await hooks.removeDependency("a", "zz")).toBe(true);
    expect(store.tasksState.dependencies).toEqual([
      { dependentId: "a", prerequisiteId: "b" },
    ]);
    expect(api.removeDependency).toHaveBeenCalledTimes(1);
  });

  it("删除不存在的依赖不写库、不通知", async () => {
    store.setAll([task("a"), task("b")], []);

    expect(await hooks.removeDependency("a", "b")).toBe(true);

    expect(api.removeDependency).not.toHaveBeenCalled();
    expect(notifications()).toEqual([]);
  });
});

describe("loadUnfinishedCounts", () => {
  it("写进 store，迟到的响应不覆盖新的", async () => {
    let releaseFirst: (rows: { projectId: string; unfinished: number }[]) => void = () => {};
    vi.mocked(api.listUnfinishedCounts)
      .mockReturnValueOnce(new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce([{ projectId: "p1", unfinished: 3 }]);

    const stale = hooks.loadUnfinishedCounts();
    const fresh = hooks.loadUnfinishedCounts();
    releaseFirst([{ projectId: "p1", unfinished: 1 }]);

    await Promise.all([stale, fresh]);
    expect(store.unfinishedCountOf("p1")).toBe(3);
  });
});

describe("写后刷新计数", () => {
  it("新建、完成、删除之后各重取一次", async () => {
    vi.mocked(api.listUnfinishedCounts).mockResolvedValue([{ projectId: "p1", unfinished: 1 }]);
    vi.mocked(api.createTask).mockResolvedValue(task("t9", { projectId: "p1" }));
    vi.mocked(api.completeTask).mockResolvedValue(task("t1", { completedAt: "2026-09-16T10:00:00Z" }));
    vi.mocked(api.softDeleteTask).mockResolvedValue(undefined);

    await hooks.createTask({ title: "新任务", projectId: "p1" });
    expect(api.listUnfinishedCounts).toHaveBeenCalledTimes(1);

    store.upsertTask(task("t1", { projectId: "p1" }));
    await hooks.completeTask("t1");
    expect(api.listUnfinishedCounts).toHaveBeenCalledTimes(2);

    await hooks.softDeleteTask("t1");
    expect(api.listUnfinishedCounts).toHaveBeenCalledTimes(3);
  });

  it("编辑器那样带上同值字段的纯字段编辑不重取；真换项目才重取", async () => {
    vi.mocked(api.listUnfinishedCounts).mockResolvedValue([]);
    store.upsertTask(task("t1", { projectId: "p1" }));
    // 编辑器 (TaskEditorDialog) 每次保存都带上任务自己的 `projectId`/`completedAt`
    // 之类的整行字段，改标题也不例外——所以判定要按值，不能按「键在不在」。
    vi.mocked(api.updateTask).mockResolvedValue(task("t1", { projectId: "p1", title: "改过" }));

    await hooks.updateTask("t1", { projectId: "p1", title: "改过" });

    expect(api.listUnfinishedCounts).not.toHaveBeenCalled();

    // 真换项目（p1 → p2）会改变两个项目各自的计数。
    vi.mocked(api.updateTask).mockResolvedValue(task("t1", { projectId: "p2" }));

    await hooks.updateTask("t1", { projectId: "p2" });

    expect(api.listUnfinishedCounts).toHaveBeenCalledTimes(1);
  });
});

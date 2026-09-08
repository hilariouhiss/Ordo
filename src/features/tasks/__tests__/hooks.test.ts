import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNotifications,
  notifications,
} from "../../../common/stores/notifications";
import type { Subtask, Tag, Task } from "../types";

vi.mock("../api", () => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listSubtasks: vi.fn(),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  completeSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  reorderSubtask: vi.fn(),
}));

import * as api from "../api";
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

function subtask(id: string, taskId: string, sortOrder: string): Subtask {
  return {
    id,
    taskId,
    title: `子任务 ${id}`,
    done: false,
    sortOrder,
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
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
    expect(store.tasksState.tasks).toHaveLength(2);
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
});

describe("createTask", () => {
  it("shows a trimmed optimistic entry, then reconciles with the real row", async () => {
    const pending = deferred<Task>();
    vi.mocked(api.createTask).mockReturnValue(pending.promise);

    const call = hooks.createTask({ title: "  新任务  ", tagIds: ["t1"] });
    const optimistic = store.tasksState.tasks.find((item) => item.title === "新任务");
    expect(optimistic).toBeTruthy();
    expect(optimistic?.id.startsWith("optimistic-")).toBe(true);
    expect(optimistic?.tagIds).toEqual(["t1"]);

    const authoritative = task("real-1", { title: "新任务" });
    pending.resolve(authoritative);
    const result = await call;

    expect(result).toEqual(authoritative);
    expect(store.tasksState.tasks.some((item) => item.id.startsWith("optimistic-"))).toBe(
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
    expect(store.tasksState.tasks).toEqual([]);
    expect(notifications()[0]).toMatchObject({ message: "标题不能为空", code: "validation" });
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

  it("restores the exact previous state and notifies on failure", async () => {
    const original = task("a", { note: "旧备注", priority: "low" });
    store.setAll([original], []);
    vi.mocked(api.updateTask).mockRejectedValue(appError("db", "写入失败"));

    const result = await hooks.updateTask("a", { title: "改名", note: null });

    expect(result).toBeNull();
    expect(store.getTask("a")).toEqual(original);
    expect(notifications()[0]?.message).toBe("写入失败");
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
    expect(store.tasksState.tasks.map((item) => item.id)).toEqual(["b"]);
  });

  it("re-inserts at the original position on failure", async () => {
    store.setAll([task("a"), task("b"), task("c")], []);
    vi.mocked(api.softDeleteTask).mockRejectedValue(appError("db", "删除失败"));

    const result = await hooks.softDeleteTask("b");

    expect(result).toBeNull();
    expect(store.tasksState.tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("restores a deleted task with the authoritative row", async () => {
    vi.mocked(api.restoreTask).mockResolvedValue(task("a"));

    const restored = await hooks.restoreTask("a");

    expect(restored?.id).toBe("a");
    expect(store.getTask("a")).toBeTruthy();
  });

  it("notifies when restore fails", async () => {
    vi.mocked(api.restoreTask).mockRejectedValue(appError("not_found", "任务不存在"));

    const restored = await hooks.restoreTask("missing");

    expect(restored).toBeNull();
    expect(store.tasksState.tasks).toEqual([]);
    expect(notifications()[0]?.message).toBe("任务不存在");
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

describe("subtasks", () => {
  it("loads and caches a task's subtasks", async () => {
    vi.mocked(api.listSubtasks).mockResolvedValue([subtask("s1", "a", "n")]);

    const ok = await hooks.loadSubtasks("a");

    expect(ok).toBe(true);
    expect(store.getSubtasks("a").map((item) => item.id)).toEqual(["s1"]);
  });

  it("creates a subtask optimistically when the cache is loaded", async () => {
    store.setSubtasks("a", [subtask("s1", "a", "n")]);
    const pending = deferred<Subtask>();
    vi.mocked(api.createSubtask).mockReturnValue(pending.promise);

    const call = hooks.createSubtask("a", { title: "  新步骤  " });
    expect(store.getSubtasks("a").some((item) => item.title === "新步骤")).toBe(true);

    pending.resolve(subtask("s2", "a", "o"));
    const result = await call;

    expect(result?.id).toBe("s2");
    expect(store.getSubtasks("a").map((item) => item.id)).toEqual(["s1", "s2"]);
  });

  it("skips the optimistic step when the cache is not loaded yet", async () => {
    vi.mocked(api.createSubtask).mockResolvedValue(subtask("s1", "a", "n"));

    const result = await hooks.createSubtask("a", { title: "新步骤" });

    expect(result?.id).toBe("s1");
    expect(store.hasSubtasks("a")).toBe(false);
  });

  it("toggles done optimistically and rolls back on failure", async () => {
    store.setSubtasks("a", [subtask("s1", "a", "n")]);

    const pending = deferred<Subtask>();
    vi.mocked(api.completeSubtask).mockReturnValue(pending.promise);
    const call = hooks.completeSubtask("a", "s1", true);
    expect(store.getSubtasks("a")[0]?.done).toBe(true);
    expect(api.completeSubtask).toHaveBeenCalledWith("s1", true);

    pending.reject(appError("db", "失败"));
    const result = await call;

    expect(result).toBeNull();
    expect(store.getSubtasks("a")[0]?.done).toBe(false);
  });

  it("reorders with the authoritative list and restores order on failure", async () => {
    const list = [
      subtask("s1", "a", "n"),
      subtask("s2", "a", "o"),
      subtask("s3", "a", "p"),
    ];
    store.setSubtasks("a", list);
    const pending = deferred<Subtask[]>();
    vi.mocked(api.reorderSubtask).mockReturnValue(pending.promise);

    // Move s3 before s1 (next = s1's key).
    const call = hooks.reorderSubtask("a", "s3", null, "n");
    expect(store.getSubtasks("a").map((item) => item.id)).toEqual(["s3", "s1", "s2"]);
    expect(api.reorderSubtask).toHaveBeenCalledWith("s3", null, "n");

    const authoritative = [
      subtask("s3", "a", "a"),
      subtask("s1", "a", "b"),
      subtask("s2", "a", "c"),
    ];
    pending.resolve(authoritative);
    const result = await call;

    expect(result).toEqual(authoritative);
    expect(store.getSubtasks("a")).toEqual(authoritative);

    // A failed move restores the previous order.
    vi.mocked(api.reorderSubtask).mockRejectedValue(appError("db", "失败"));
    await hooks.reorderSubtask("a", "s1", "n", null);
    expect(store.getSubtasks("a")).toEqual(authoritative);
  });

  it("deletes a subtask and re-inserts on failure", async () => {
    store.setSubtasks("a", [subtask("s1", "a", "n"), subtask("s2", "a", "o")]);

    const pending = deferred<void>();
    vi.mocked(api.deleteSubtask).mockReturnValue(pending.promise);
    const call = hooks.deleteSubtask("a", "s1");
    expect(store.getSubtasks("a").map((item) => item.id)).toEqual(["s2"]);

    pending.reject(appError("db", "失败"));
    const result = await call;

    expect(result).toBeNull();
    expect(store.getSubtasks("a").map((item) => item.id)).toEqual(["s1", "s2"]);
  });
});

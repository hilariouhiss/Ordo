/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@solidjs/testing-library";
import {
  clearNotifications,
  notifications,
} from "../../../common/stores/notifications";
import type { Dependency, Subtask, Tag, Task, TimeEntry } from "../types";

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
  listSubtasksAll: vi.fn().mockResolvedValue([]),
  listDependencies: vi.fn().mockResolvedValue([]),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  completeSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  reorderSubtask: vi.fn(),
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

/** The third argument doubles as title and sort key: the per-task subtask
 * cases pass distinct keys ("n"/"o"/"p"), the bulk-load case a real title. */
function subtask(id: string, taskId: string, key: string, done = false): Subtask {
  return {
    id,
    taskId,
    title: key,
    note: null,
    priority: "none",
    dueAt: null,
    complexity: null,
    done,
    sortOrder: key,
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

  it("fills the subtask cache for every task, including childless ones", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([task("a"), task("b")]);
    vi.mocked(api.listTags).mockResolvedValue([]);
    vi.mocked(api.listSubtasksAll).mockResolvedValue([
      subtask("s1", "a", "第一步"),
      subtask("s2", "a", "第二步", true),
    ]);

    const ok = await hooks.loadAll();

    expect(ok).toBe(true);
    expect(store.getSubtasks("a").map((item) => item.title)).toEqual(["第一步", "第二步"]);
    // The childless task must still get an entry: `hasSubtasks` is what the
    // detail dialog reads to decide whether to fetch, and a missing key would
    // make it re-request data already in hand.
    expect(store.hasSubtasks("b")).toBe(true);
    expect(store.getSubtasks("b")).toEqual([]);
  });
});

describe("reloadTasks", () => {
  it("re-reads tasks and tags without touching the subtask cache", async () => {
    store.setAll([task("a")], []);
    store.setSubtasks("a", [subtask("s1", "a", "第一步")]);
    vi.mocked(api.listTasks).mockResolvedValue([task("a", { title: "改名" }), task("new")]);
    vi.mocked(api.listTags).mockResolvedValue([tag("t1", "工作")]);

    const ok = await hooks.reloadTasks();

    expect(ok).toBe(true);
    expect(store.tasksState.tasks.map((item) => item.id)).toEqual(["a", "new"]);
    expect(store.tasksState.tags).toHaveLength(1);
    // The snapshot stays home: the bulk rebuild would overwrite whatever the
    // user just wrote from the detail dialog, and the mid-session caller (the
    // quick-add window filing a task) creates no subtasks to pull.
    expect(api.listSubtasksAll).not.toHaveBeenCalled();
    expect(store.getSubtasks("a").map((item) => item.id)).toEqual(["s1"]);
    // The new task gets no entry, so its detail dialog fetches once — the
    // lazy fallback, and the truthful answer for a task nobody has opened.
    expect(store.hasSubtasks("new")).toBe(false);
  });

  it("notifies and reports failure without touching the loaded data", async () => {
    store.setAll([task("a")], []);
    store.setSubtasks("a", [subtask("s1", "a", "第一步")]);
    vi.mocked(api.listTasks).mockRejectedValue(appError("database", "数据库错误"));
    vi.mocked(api.listTags).mockResolvedValue([]);

    const ok = await hooks.reloadTasks();

    expect(ok).toBe(false);
    expect(notifications()).toEqual([
      { id: expect.any(Number), kind: "error", message: "数据库错误", code: "database" },
    ]);
    expect(store.getTask("a")).toBeTruthy();
    expect(store.getSubtasks("a").map((item) => item.id)).toEqual(["s1"]);
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

  it("refetches subtasks after creating a task that carried initial ones", async () => {
    vi.mocked(api.createTask).mockResolvedValue(task("created"));
    vi.mocked(api.listSubtasks).mockResolvedValue([subtask("s1", "created", "第一步")]);

    await hooks.createTask({ title: "新任务", subtaskTitles: ["第一步"] });

    expect(api.listSubtasks).toHaveBeenCalledWith("created");
    await waitFor(() => expect(store.getSubtasks("created")).toHaveLength(1));
  });

  it("does not fetch subtasks when the new task carried none", async () => {
    vi.mocked(api.createTask).mockResolvedValue(task("created"));

    await hooks.createTask({ title: "新任务" });

    expect(api.listSubtasks).not.toHaveBeenCalled();
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
  it("被阻塞时不落库，force 版本才发 IPC", async () => {
    const blocked = task("a");
    const prerequisite = task("b");
    store.setAll([blocked, prerequisite], []);
    store.setDependencies([{ kind: "task", dependentId: "a", prerequisiteId: "b" }]);

    const result = await hooks.completeTask("a");
    expect(result).toBeNull();
    expect(api.completeTask).not.toHaveBeenCalled();
    expect(blockedRequest()?.blockers.map((blocker) => blocker.id)).toEqual(["b"]);
    // The parked request carries the blocked entity's title for the dialog
    // (`task()` names its fixtures `任务 <id>`).
    expect(blockedRequest()?.title).toBe("任务 a");

    vi.mocked(api.completeTask).mockResolvedValue({ ...blocked, completedAt: "2026-09-14T10:00:00Z" });
    await hooks.forceCompleteTask("a");
    expect(api.completeTask).toHaveBeenCalledWith("a");
    store.setDependencies([]);
    clearBlockedConfirm();
  });

  it("子任务被阻塞时同样只停请求", async () => {
    store.setAll([task("a")], []);
    store.setSubtasks("a", [subtask("s1", "a", "第一步"), subtask("s2", "a", "第二步")]);
    store.setDependencies([{ kind: "subtask", dependentId: "s1", prerequisiteId: "s2" }]);

    expect(await hooks.completeSubtask("a", "s1", true)).toBeNull();
    expect(api.completeSubtask).not.toHaveBeenCalled();
    expect(blockedRequest()).toMatchObject({
      kind: "subtask",
      id: "s1",
      parentId: "a",
      title: "第一步",
      blockers: [{ kind: "subtask", id: "s2", title: "第二步" }],
    });

    vi.mocked(api.completeSubtask).mockResolvedValue(subtask("s1", "a", "第一步", true));
    await hooks.forceCompleteSubtask("a", "s1");
    expect(api.completeSubtask).toHaveBeenCalledWith("s1", true);
    store.setDependencies([]);
    clearBlockedConfirm();
  });

  it("前置已完成时直接完成，不弹确认", async () => {
    const dependent = task("a");
    const done = task("b", { completedAt: "2026-09-14T09:00:00Z" });
    store.setAll([dependent, done], []);
    store.setDependencies([{ kind: "task", dependentId: "a", prerequisiteId: "b" }]);
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
    store.setAll([task("a")], []);
    store.setSubtasks("a", [subtask("s1", "a", "第一步", true)]);
    // The prerequisite is unfinished — and nonexistent, so nothing else can
    // explain the pass: `done === false` skips the check outright.
    store.setDependencies([{ kind: "subtask", dependentId: "s1", prerequisiteId: "s2" }]);
    vi.mocked(api.completeSubtask).mockResolvedValue(subtask("s1", "a", "第一步", false));

    const result = await hooks.completeSubtask("a", "s1", false);

    expect(api.completeSubtask).toHaveBeenCalledWith("s1", false);
    expect(result?.done).toBe(false);
    expect(store.getSubtasks("a")[0]?.done).toBe(false);
    expect(blockedRequest()).toBeNull();
    store.setDependencies([]);
  });

  it("添加与删除依赖走乐观更新并调用 api", async () => {
    store.setAll([task("a"), task("b")], []);
    vi.mocked(api.addDependency).mockResolvedValue({
      kind: "task",
      dependentId: "a",
      prerequisiteId: "b",
    });

    await hooks.addDependency("task", "a", "b");

    expect(store.tasksState.dependencies).toEqual([
      { kind: "task", dependentId: "a", prerequisiteId: "b" },
    ]);
    expect(api.addDependency).toHaveBeenCalledWith({
      kind: "task",
      dependentId: "a",
      prerequisiteId: "b",
    });

    vi.mocked(api.removeDependency).mockResolvedValue(undefined);
    await hooks.removeDependency("task", "a", "b");
    expect(store.tasksState.dependencies).toEqual([]);
  });

  it("依赖写入失败时回滚到原数组并通知", async () => {
    store.setAll([task("a"), task("b")], []);
    const pending = deferred<Dependency>();
    vi.mocked(api.addDependency).mockReturnValue(pending.promise);

    const call = hooks.addDependency("task", "a", "b");
    // Optimistic: the edge is in the store before the IPC settles.
    expect(store.tasksState.dependencies).toEqual([
      { kind: "task", dependentId: "a", prerequisiteId: "b" },
    ]);

    pending.reject(appError("db", "写入失败"));
    expect(await call).toBeNull();
    expect(store.tasksState.dependencies).toEqual([]);
    expect(notifications()[0]?.message).toBe("写入失败");

    // Removal rolls back the same way, from an edge that is there.
    store.setDependencies([{ kind: "task", dependentId: "a", prerequisiteId: "b" }]);
    vi.mocked(api.removeDependency).mockRejectedValue(appError("db", "写入失败"));
    expect(await hooks.removeDependency("task", "a", "b")).toBeNull();
    expect(store.tasksState.dependencies).toEqual([
      { kind: "task", dependentId: "a", prerequisiteId: "b" },
    ]);

    // An edge that is not in the store is a no-op with a toast, not a write.
    expect(await hooks.removeDependency("task", "a", "zz")).toBeNull();
    expect(store.tasksState.dependencies).toEqual([
      { kind: "task", dependentId: "a", prerequisiteId: "b" },
    ]);
    expect(api.removeDependency).toHaveBeenCalledTimes(1);
  });
});

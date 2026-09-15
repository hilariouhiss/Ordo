import { beforeEach, describe, expect, it } from "vitest";
import type { Tag, Task } from "../types";
import * as store from "../store";

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

describe("tasks store", () => {
  beforeEach(() => {
    store.resetTasksStore();
  });

  it("starts unloaded and empty", () => {
    expect(store.tasksState.loaded).toBe(false);
    expect(store.tasksState.tasks).toEqual([]);
    expect(store.tasksState.tags).toEqual([]);
  });

  it("setAll loads tasks and tags", () => {
    store.setAll([task("a")], [tag("t1", "工作")]);

    expect(store.tasksState.loaded).toBe(true);
    expect(store.getTask("a")?.title).toBe("任务 a");
    expect(store.getTag("t1")?.name).toBe("工作");
  });

  it("upsertTask appends new tasks and replaces existing ones", () => {
    store.setAll([task("a"), task("b")], []);

    store.upsertTask(task("c"));
    store.upsertTask(task("a", { title: "改名" }));

    expect(store.tasksState.tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(store.getTask("a")?.title).toBe("改名");
  });

  it("patchTask merges partial fields and ignores unknown ids", () => {
    store.setAll([task("a")], []);

    store.patchTask("a", { priority: "high", dueAt: "2026-09-10T00:00:00Z" });
    store.patchTask("missing", { title: "无效果" });

    expect(store.getTask("a")?.priority).toBe("high");
    expect(store.getTask("a")?.dueAt).toBe("2026-09-10T00:00:00Z");
    expect(store.getTask("a")?.title).toBe("任务 a");
  });

  it("removeTask and insertTaskAt restore a task at its position", () => {
    store.setAll([task("a"), task("b"), task("c")], []);
    const snapshot = task("b");

    store.removeTask("b");
    expect(store.tasksState.tasks.map((item) => item.id)).toEqual(["a", "c"]);

    store.insertTaskAt(1, snapshot);
    expect(store.tasksState.tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);

    // Out-of-range indices are clamped, not fatal.
    store.insertTaskAt(99, task("z"));
    expect(store.tasksState.tasks.map((item) => item.id)).toEqual(["a", "b", "c", "z"]);
  });

  it("installTaskOrder installs the whole run where its first row sat", () => {
    store.setAll(
      [task("other"), task("t1", { sortOrder: "m" }), task("t2", { sortOrder: "n" })],
      [],
    );

    store.installTaskOrder([task("t2", { sortOrder: "a" }), task("t1", { sortOrder: "b" })]);

    // The rows move, not only their keys: a rebalance rewrote both.
    expect(store.tasksState.tasks.map((item) => item.id)).toEqual(["other", "t2", "t1"]);
    expect(store.getTask("t1")?.sortOrder).toBe("b");
    expect(store.getTask("t2")?.sortOrder).toBe("a");
  });

  it("tag mutators keep the list in sync", () => {
    store.setAll([], [tag("t1", "工作"), tag("t2", "生活")]);

    store.upsertTag(tag("t3", "学习"));
    store.patchTag("t1", { color: "#ff0000" });
    store.removeTag("t2");

    expect(store.tasksState.tags.map((item) => item.id)).toEqual(["t1", "t3"]);
    expect(store.getTag("t1")?.color).toBe("#ff0000");
  });

  describe("层级派生", () => {
    it("childrenOf returns one parent's children in sort order", () => {
      store.setAll(
        [
          task("p1", { sortOrder: "a" }),
          task("c2", { parentTaskId: "p1", sortOrder: "n" }),
          task("c1", { parentTaskId: "p1", sortOrder: "m" }),
          task("other", { sortOrder: "b" }),
          task("c3", { parentTaskId: "other", sortOrder: "a" }),
        ],
        [],
      );

      expect(store.childrenOf("p1").map((item) => item.id)).toEqual(["c1", "c2"]);
      expect(store.childrenOf("other").map((item) => item.id)).toEqual(["c3"]);
      expect(store.childrenOf("nobody")).toEqual([]);
    });

    it("topLevelTasks drops every child but keeps store order", () => {
      store.setAll(
        [
          task("p1", { sortOrder: "a" }),
          task("c1", { parentTaskId: "p1", sortOrder: "m" }),
          task("p2", { sortOrder: "b" }),
        ],
        [],
      );

      expect(store.topLevelTasks().map((item) => item.id)).toEqual(["p1", "p2"]);
    });

    it("hasChildren answers the disclosure question", () => {
      store.setAll([task("p1"), task("c1", { parentTaskId: "p1" })], []);

      expect(store.hasChildren("p1")).toBe(true);
      expect(store.hasChildren("c1")).toBe(false);
    });
  });

  it("resetTasksStore clears everything", () => {
    store.setAll([task("a")], [tag("t1", "工作")]);

    store.resetTasksStore();

    expect(store.tasksState.loaded).toBe(false);
    expect(store.tasksState.tasks).toEqual([]);
    expect(store.tasksState.tags).toEqual([]);
  });
});

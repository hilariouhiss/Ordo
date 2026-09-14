import { beforeEach, describe, expect, it } from "vitest";
import type { Subtask, Tag, Task } from "../types";
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
    note: null,
    priority: "none",
    dueAt: null,
    complexity: null,
    done: false,
    sortOrder,
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

  it("tag mutators keep the list in sync", () => {
    store.setAll([], [tag("t1", "工作"), tag("t2", "生活")]);

    store.upsertTag(tag("t3", "学习"));
    store.patchTag("t1", { color: "#ff0000" });
    store.removeTag("t2");

    expect(store.tasksState.tags.map((item) => item.id)).toEqual(["t1", "t3"]);
    expect(store.getTag("t1")?.color).toBe("#ff0000");
  });

  it("subtask cache is scoped per task and safe when unloaded", () => {
    expect(store.hasSubtasks("a")).toBe(false);
    expect(store.getSubtasks("a")).toEqual([]);

    store.setSubtasks("a", [subtask("s1", "a", "n"), subtask("s2", "a", "o")]);

    expect(store.hasSubtasks("a")).toBe(true);
    expect(store.getSubtasks("a").map((item) => item.id)).toEqual(["s1", "s2"]);

    store.upsertSubtask("a", subtask("s3", "a", "p"));
    store.patchSubtask("a", "s1", { done: true });
    store.removeSubtask("a", "s2");

    const remaining = store.getSubtasks("a");
    expect(remaining.map((item) => item.id)).toEqual(["s1", "s3"]);
    expect(remaining[0]?.done).toBe(true);

    // Mutating an unloaded task's cache is a no-op.
    store.removeSubtask("unknown", "s1");
    expect(store.getSubtasks("unknown")).toEqual([]);
  });

  it("setSubtasksAll seeds the loaded snapshot's ids and leaves other tasks alone", () => {
    store.setAll([task("a"), task("b"), task("c"), task("late")], []);
    store.setSubtasks("late", [subtask("s9", "late", "n")]);

    store.setSubtasksAll(
      [subtask("s1", "a", "n"), subtask("s2", "a", "o"), subtask("s3", "b", "n")],
      ["a", "b", "c"],
    );

    // Sub-tasks are grouped under their own taskId.
    expect(store.getSubtasks("a").map((item) => item.id)).toEqual(["s1", "s2"]);
    expect(store.getSubtasks("b").map((item) => item.id)).toEqual(["s3"]);

    // A task the load covered, but that has no sub-tasks, still gets an entry:
    // `hasSubtasks` reads the key, and the detail dialog uses it to decide
    // whether to fetch again.
    expect(store.hasSubtasks("c")).toBe(true);
    expect(store.getSubtasks("c")).toEqual([]);

    // A live task missing from `taskIds` keeps its previous value — the seed
    // comes from the load's own snapshot, never from `state.tasks`, which
    // still lists `late` here.
    expect(store.getSubtasks("late").map((item) => item.id)).toEqual(["s9"]);
  });

  it("resetTasksStore clears everything", () => {
    store.setAll([task("a")], [tag("t1", "工作")]);
    store.setSubtasks("a", [subtask("s1", "a", "n")]);

    store.resetTasksStore();

    expect(store.tasksState.loaded).toBe(false);
    expect(store.getSubtasks("a")).toEqual([]);
  });
});

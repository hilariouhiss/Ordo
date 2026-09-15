import { beforeEach, describe, expect, it } from "vitest";
import { canAcceptChild } from "../hierarchy";
import * as store from "../store";
import type { Task } from "../types";

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
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

/** `p1` owns `c1`; `t2` is a plain top-level row. */
function seedTree(): void {
  store.resetTasksStore();
  store.setAll([task("p1"), task("c1", { parentTaskId: "p1" }), task("t2")], []);
}

describe("canAcceptChild", () => {
  beforeEach(seedTree);

  /*
   * One row per rule the service enforces (R7c, single level). Each row is a
   * named case in the output, so a regression says which rule broke.
   */
  it.each([
    { name: "accepts a top-level task under another top-level task", child: "t2", parent: "p1", expected: true },
    { name: "accepts a child moved to a different parent", child: "c1", parent: "t2", expected: true },
    { name: "refuses a task dropped onto itself", child: "t2", parent: "t2", expected: false },
    { name: "refuses a target that already has a parent", child: "t2", parent: "c1", expected: false },
    { name: "refuses a task that has children of its own", child: "p1", parent: "t2", expected: false },
    { name: "refuses a task already filed under that parent", child: "c1", parent: "p1", expected: false },
    { name: "refuses a dragged id the store does not know", child: "ghost", parent: "p1", expected: false },
  ])("$name", ({ child, parent, expected }) => {
    expect(canAcceptChild(child, store.getTask(parent)!)).toBe(expected);
  });

  it("follows the store, so a child that gains one loses its own candidacy", () => {
    const parent = store.getTask("t2")!;
    expect(canAcceptChild("p1", parent)).toBe(false);

    // Move `p1`'s only child away: it is a childless top-level task now and may
    // become someone's child.
    store.patchTask("c1", { parentTaskId: "t2" });

    expect(canAcceptChild("p1", parent)).toBe(true);
  });
});

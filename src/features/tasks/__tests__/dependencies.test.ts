import { describe, expect, it } from "vitest";
import {
  blockersOf,
  buildIndex,
  completionSet,
  edgeEquals,
  entityKey,
  isBlocked,
  successorsOf,
  wouldCycle,
} from "../dependencies";
import type { Dependency, Subtask, Task } from "../types";

function edge(dependentId: string, prerequisiteId: string): Dependency {
  return { kind: "task", dependentId, prerequisiteId };
}

function task(id: string, completedAt: string | null = null): Task {
  return {
    id,
    projectId: null,
    title: id,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt,
    repeatRule: null,
    tagIds: [],
    complexity: null,
    sortOrder: "a",
    createdAt: "2026-09-14T00:00:00Z",
    updatedAt: "2026-09-14T00:00:00Z",
    deletedAt: null,
  };
}

describe("dependency derivations", () => {
  // A → B → C plus the diamond A → D → C, so the walk has to survive both a
  // chain and a merge.
  const edges = [edge("A", "B"), edge("B", "C"), edge("A", "D"), edge("D", "C")];
  const index = buildIndex(edges);
  const tasks = [task("A"), task("B", "2026-09-14T10:00:00Z"), task("C"), task("D")];

  it("lists every prerequisite while nothing is finished", () => {
    // The empty set is the point: the completed-prerequisite case comes next.
    const done = new Set<string>();
    expect(blockersOf(index, done, "task", "A")).toEqual(["B", "D"]);
    expect(blockersOf(index, done, "task", "B")).toEqual(["C"]);
    expect(isBlocked(index, done, "task", "A")).toBe(true);
    expect(isBlocked(index, done, "task", "D")).toBe(true);
  });

  it("treats a completed prerequisite as satisfied", () => {
    const done = completionSet(tasks, {});
    // B is complete, so A's only remaining blocker is D.
    expect(blockersOf(index, done, "task", "A")).toEqual(["D"]);
    expect(isBlocked(index, done, "task", "B")).toBe(true);
  });

  it("finds successors in the other direction", () => {
    expect(successorsOf(index, "task", "C")).toEqual(["B", "D"]);
    expect(successorsOf(index, "task", "A")).toEqual([]);
  });

  it("detects the edges that would close a cycle", () => {
    expect(wouldCycle(index, "task", "C", "A")).toBe(true);
    expect(wouldCycle(index, "task", "A", "A")).toBe(true);
    // A already depends on B, so re-stating that edge is not a cycle.
    expect(wouldCycle(index, "task", "A", "B")).toBe(false);
    expect(wouldCycle(index, "task", "A", "E")).toBe(false);
  });

  it("keeps task and subtask graphs apart", () => {
    const mixed = buildIndex([
      { kind: "task", dependentId: "X", prerequisiteId: "Y" },
      { kind: "subtask", dependentId: "S1", prerequisiteId: "S2" },
    ]);
    expect(blockersOf(mixed, new Set(), "task", "X")).toEqual(["Y"]);
    expect(blockersOf(mixed, new Set(), "subtask", "S1")).toEqual(["S2"]);
    expect(blockersOf(mixed, new Set(), "task", "S1")).toEqual([]);
  });

  it("reads a done subtask out of the per-task cache", () => {
    const subtasks = {
      t1: [
        { id: "S1", taskId: "t1", title: "一", done: true },
        { id: "S2", taskId: "t1", title: "二", done: false },
      ] as Subtask[],
    };
    const done = completionSet([task("t1")], subtasks);
    const subIndex = buildIndex([
      { kind: "subtask", dependentId: "S2", prerequisiteId: "S1" },
    ]);
    expect(done.has(entityKey("subtask", "S1"))).toBe(true);
    expect(isBlocked(subIndex, done, "subtask", "S2")).toBe(false);
    expect(isBlocked(subIndex, done, "subtask", "S1")).toBe(false);
  });

  it("compares edges by kind and both endpoints", () => {
    expect(edgeEquals(edge("A", "B"), edge("A", "B"))).toBe(true);
    expect(edgeEquals(edge("A", "B"), edge("B", "A"))).toBe(false);
    expect(
      edgeEquals(edge("A", "B"), { kind: "subtask", dependentId: "A", prerequisiteId: "B" }),
    ).toBe(false);
  });
});

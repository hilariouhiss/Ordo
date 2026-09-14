import { describe, expect, it } from "vitest";
import {
  blockersOf,
  buildIndex,
  completionSet,
  edgeEquals,
  entityKey,
  isBlocked,
  liveSet,
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
  const tasks = [task("A"), task("B", "2026-09-14T10:00:00Z"), task("C"), task("D")];
  const index = buildIndex(edges, liveSet(tasks, {}));

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
    const mixed = buildIndex(
      [
        { kind: "task", dependentId: "X", prerequisiteId: "Y" },
        { kind: "subtask", dependentId: "S1", prerequisiteId: "S2" },
      ],
      new Set(["task:X", "task:Y", "subtask:S1", "subtask:S2"]),
    );
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
    const subIndex = buildIndex(
      [{ kind: "subtask", dependentId: "S2", prerequisiteId: "S1" }],
      liveSet([task("t1")], subtasks),
    );
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

  /*
   * The edge list is never pruned — `dependency:listAll` filters by liveness
   * instead, and the store's list is that filtered snapshot. The one path that
   * does NOT come from the backend is the optimistic soft delete: the task
   * vanishes from `state.tasks` while the edge stays. Rebuilding the index over
   * a stale edge list would then count the deleted prerequisite as unfinished,
   * so the index is built against the live set rather than the raw edges.
   */
  it("ignores an edge whose prerequisite is no longer live, and restores it", () => {
    const edges = [edge("A", "B")];
    const done = new Set<string>();

    // B is still in the store: A waits for it.
    const withBoth = buildIndex(edges, liveSet([task("A"), task("B")], {}));
    expect(blockersOf(withBoth, done, "task", "A")).toEqual(["B"]);
    expect(isBlocked(withBoth, done, "task", "A")).toBe(true);

    // B soft-deleted: the edge is still in the list, but dormant.
    const withoutB = buildIndex(edges, liveSet([task("A")], {}));
    expect(blockersOf(withoutB, done, "task", "A")).toEqual([]);
    expect(isBlocked(withoutB, done, "task", "A")).toBe(false);

    // Restoring B brings the relation back with no compensation write.
    const restored = buildIndex(edges, liveSet([task("A"), task("B")], {}));
    expect(isBlocked(restored, done, "task", "A")).toBe(true);
  });

  it("drops an edge whose dependent is no longer live", () => {
    const subtasks = {
      t1: [
        { id: "S1", taskId: "t1", title: "一", done: false },
        { id: "S2", taskId: "t1", title: "二", done: false },
      ] as Subtask[],
    };
    const edges = [{ kind: "subtask", dependentId: "S2", prerequisiteId: "S1" } as const];
    const tasks = [task("t1")];

    // The dependent is soft-deleted out of its parent's cache: its own edge
    // must not show up in the prerequisite's successor list either.
    const alive = buildIndex(edges, liveSet(tasks, subtasks));
    expect(successorsOf(alive, "subtask", "S1")).toEqual(["S2"]);

    const pruned = buildIndex(edges, liveSet(tasks, { t1: [subtasks.t1[0]] }));
    expect(successorsOf(pruned, "subtask", "S1")).toEqual([]);
    expect(isBlocked(pruned, new Set(), "subtask", "S2")).toBe(false);
  });
});

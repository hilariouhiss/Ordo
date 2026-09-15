import { describe, expect, it } from "vitest";
import {
  blockersOf,
  buildIndex,
  completionSet,
  edgeEquals,
  isBlocked,
  liveSet,
  successorsOf,
  wouldCycle,
} from "../dependencies";
import type { Dependency, Task } from "../types";

function edge(dependentId: string, prerequisiteId: string): Dependency {
  return { dependentId, prerequisiteId };
}

function task(
  id: string,
  completedAt: string | null = null,
  parentTaskId: string | null = null,
): Task {
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
    parentTaskId,
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
  const index = buildIndex(edges, liveSet(tasks));

  it("lists every prerequisite while nothing is finished", () => {
    // The empty set is the point: the completed-prerequisite case comes next.
    const done = new Set<string>();
    expect(blockersOf(index, done, "A")).toEqual(["B", "D"]);
    expect(blockersOf(index, done, "B")).toEqual(["C"]);
    expect(isBlocked(index, done, "A")).toBe(true);
    expect(isBlocked(index, done, "D")).toBe(true);
  });

  it("treats a completed prerequisite as satisfied", () => {
    const done = completionSet(tasks);
    // B is complete, so A's only remaining blocker is D.
    expect(blockersOf(index, done, "A")).toEqual(["D"]);
    expect(isBlocked(index, done, "B")).toBe(true);
  });

  it("finds successors in the other direction", () => {
    expect(successorsOf(index, "C")).toEqual(["B", "D"]);
    expect(successorsOf(index, "A")).toEqual([]);
  });

  it("detects the edges that would close a cycle", () => {
    expect(wouldCycle(index, "C", "A")).toBe(true);
    expect(wouldCycle(index, "A", "A")).toBe(true);
    // A already depends on B, so re-stating that edge is not a cycle.
    expect(wouldCycle(index, "A", "B")).toBe(false);
    expect(wouldCycle(index, "A", "E")).toBe(false);
  });

  it("reads a child task's completion out of the same task list", () => {
    // There is one edge set and one node namespace: a child task is a Task
    // whose `completedAt` decides whether its dependents stay blocked.
    const tasks = [
      task("t1"),
      task("S1", "2026-09-14T10:00:00Z", "t1"),
      task("S2", null, "t1"),
    ];
    const done = completionSet(tasks);
    const subIndex = buildIndex([edge("S2", "S1")], liveSet(tasks));

    expect(done.has("S1")).toBe(true);
    expect(isBlocked(subIndex, done, "S2")).toBe(false);
    expect(isBlocked(subIndex, done, "S1")).toBe(false);
  });

  it("compares edges by both endpoints", () => {
    expect(edgeEquals(edge("A", "B"), edge("A", "B"))).toBe(true);
    expect(edgeEquals(edge("A", "B"), edge("B", "A"))).toBe(false);
    expect(edgeEquals(edge("A", "B"), edge("A", "C"))).toBe(false);
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
    const withBoth = buildIndex(edges, liveSet([task("A"), task("B")]));
    expect(blockersOf(withBoth, done, "A")).toEqual(["B"]);
    expect(isBlocked(withBoth, done, "A")).toBe(true);

    // B soft-deleted: the edge is still in the list, but dormant.
    const withoutB = buildIndex(edges, liveSet([task("A")]));
    expect(blockersOf(withoutB, done, "A")).toEqual([]);
    expect(isBlocked(withoutB, done, "A")).toBe(false);

    // Restoring B brings the relation back with no compensation write.
    const restored = buildIndex(edges, liveSet([task("A"), task("B")]));
    expect(isBlocked(restored, done, "A")).toBe(true);
  });

  it("drops an edge whose dependent is no longer live", () => {
    const edges = [edge("S2", "S1")];
    const tasks = [task("t1"), task("S1", null, "t1"), task("S2", null, "t1")];

    // Both children are rows in `tasks`; the edge joins them directly.
    const alive = buildIndex(edges, liveSet(tasks));
    expect(successorsOf(alive, "S1")).toEqual(["S2"]);

    const pruned = buildIndex(edges, liveSet([tasks[0], tasks[1]]));
    expect(successorsOf(pruned, "S1")).toEqual([]);
    expect(isBlocked(pruned, new Set(), "S2")).toBe(false);
  });
});

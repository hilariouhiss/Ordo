/**
 * Dependency-graph derivations — all pure, so the blocked/cyclic rules are
 * table-tested instead of click-tested.
 *
 * The full edge set arrives with the task list, so "is this blocked?" is a
 * local computation. Callers build the live set, the index and the completion
 * set once per render pass (inside a `createMemo`) and then ask per row; the
 * per-row cost is that row's own prerequisite count, not the size of the graph.
 *
 * A child task is a task (R7c) and an edge only ever joins two of them, so the
 * keys here are bare task ids — there is no kind to qualify them with.
 */

import type { Dependency, Task } from "./types";

export interface DependencyIndex {
  /** dependent id → its prerequisite ids, in insertion order */
  prerequisites: Map<string, string[]>;
  /** prerequisite id → the ids waiting for it */
  successors: Map<string, string[]>;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

export function buildIndex(
  dependencies: readonly Dependency[],
  live: ReadonlySet<string>,
): DependencyIndex {
  const prerequisites = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const edge of dependencies) {
    // A soft delete is optimistic here: the row leaves the store while the
    // edge list keeps the edge (`dependency:listAll` only hides it at the next
    // load), so liveness — not the raw list — decides whether an edge counts.
    if (!live.has(edge.dependentId) || !live.has(edge.prerequisiteId)) continue;
    push(prerequisites, edge.dependentId, edge.prerequisiteId);
    push(successors, edge.prerequisiteId, edge.dependentId);
  }
  return { prerequisites, successors };
}

/** Ids of every live task the store holds — children included, since they are
 * rows in `tasks` like any other; a soft-deleted one is simply gone. */
export function liveSet(tasks: readonly Task[]): Set<string> {
  const live = new Set<string>();
  for (const task of tasks) live.add(task.id);
  return live;
}

/** Ids of every finished task; a child task with `completedAt` set is done. */
export function completionSet(tasks: readonly Task[]): Set<string> {
  const done = new Set<string>();
  for (const task of tasks) {
    if (task.completedAt !== null) done.add(task.id);
  }
  return done;
}

/** Ids of the task's prerequisites that are still unfinished. */
export function blockersOf(
  index: DependencyIndex,
  done: ReadonlySet<string>,
  id: string,
): string[] {
  const prerequisites = index.prerequisites.get(id) ?? [];
  return prerequisites.filter((prerequisiteId) => !done.has(prerequisiteId));
}

export function isBlocked(
  index: DependencyIndex,
  done: ReadonlySet<string>,
  id: string,
): boolean {
  return blockersOf(index, done, id).length > 0;
}

/** Ids of the tasks that list `id` as a prerequisite. */
export function successorsOf(index: DependencyIndex, id: string): string[] {
  return index.successors.get(id) ?? [];
}

/**
 * Whether `dependent → prerequisite` would close a cycle: walk up from the
 * prerequisite along its own prerequisites, and reaching the dependent means
 * the new edge closes the loop. The visited set keeps a pre-existing cycle
 * from looping forever.
 */
export function wouldCycle(
  index: DependencyIndex,
  dependentId: string,
  prerequisiteId: string,
): boolean {
  if (dependentId === prerequisiteId) return true;
  const seen = new Set<string>();
  const stack = [prerequisiteId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === dependentId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of index.prerequisites.get(current) ?? []) {
      stack.push(next);
    }
  }
  return false;
}

/** Whether two edges point at the same pair (used for optimistic inserts). */
export function edgeEquals(left: Dependency, right: Dependency): boolean {
  return (
    left.dependentId === right.dependentId &&
    left.prerequisiteId === right.prerequisiteId
  );
}

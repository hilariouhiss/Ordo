/**
 * Dependency-graph derivations — all pure, so the blocked/cyclic rules are
 * table-tested instead of click-tested.
 *
 * The full edge set arrives with the task list, so "is this blocked?" is a
 * local computation. Callers build the index and the completion set once per
 * render pass (inside a `createMemo`) and then ask per row; the per-row cost is
 * that row's own prerequisite count, not the size of the graph.
 */

import type { Dependency, DependencyKind, Subtask, Task } from "./types";

/** One entity's key in the index maps and the completion set. */
export function entityKey(kind: DependencyKind, id: string): string {
  return `${kind}:${id}`;
}

export interface DependencyIndex {
  /** dependent key → its prerequisite ids, in insertion order */
  prerequisites: Map<string, string[]>;
  /** prerequisite key → the ids waiting for it */
  successors: Map<string, string[]>;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

export function buildIndex(dependencies: readonly Dependency[]): DependencyIndex {
  const prerequisites = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const edge of dependencies) {
    push(prerequisites, entityKey(edge.kind, edge.dependentId), edge.prerequisiteId);
    push(successors, entityKey(edge.kind, edge.prerequisiteId), edge.dependentId);
  }
  return { prerequisites, successors };
}

/** Keys of every finished entity: completed tasks and done subtasks. */
export function completionSet(
  tasks: readonly Task[],
  subtasksByTask: Record<string, readonly Subtask[]>,
): Set<string> {
  const done = new Set<string>();
  for (const task of tasks) {
    if (task.completedAt !== null) done.add(entityKey("task", task.id));
  }
  for (const list of Object.values(subtasksByTask)) {
    for (const subtask of list) {
      if (subtask.done) done.add(entityKey("subtask", subtask.id));
    }
  }
  return done;
}

/** Ids of the entity's prerequisites that are still unfinished. */
export function blockersOf(
  index: DependencyIndex,
  done: ReadonlySet<string>,
  kind: DependencyKind,
  id: string,
): string[] {
  const prerequisites = index.prerequisites.get(entityKey(kind, id)) ?? [];
  return prerequisites.filter(
    (prerequisiteId) => !done.has(entityKey(kind, prerequisiteId)),
  );
}

export function isBlocked(
  index: DependencyIndex,
  done: ReadonlySet<string>,
  kind: DependencyKind,
  id: string,
): boolean {
  return blockersOf(index, done, kind, id).length > 0;
}

/** Ids of the entities that list `id` as a prerequisite. */
export function successorsOf(
  index: DependencyIndex,
  kind: DependencyKind,
  id: string,
): string[] {
  return index.successors.get(entityKey(kind, id)) ?? [];
}

/**
 * Whether `dependent → prerequisite` would close a cycle: walk up from the
 * prerequisite along its own prerequisites, and reaching the dependent means
 * the new edge closes the loop. The visited set keeps a pre-existing cycle
 * from looping forever.
 */
export function wouldCycle(
  index: DependencyIndex,
  kind: DependencyKind,
  dependentId: string,
  prerequisiteId: string,
): boolean {
  if (dependentId === prerequisiteId) return true;
  const target = entityKey(kind, dependentId);
  const seen = new Set<string>();
  const stack = [entityKey(kind, prerequisiteId)];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of index.prerequisites.get(current) ?? []) {
      stack.push(entityKey(kind, next));
    }
  }
  return false;
}

/** Whether two edges point at the same pair (used for optimistic inserts). */
export function edgeEquals(left: Dependency, right: Dependency): boolean {
  return (
    left.kind === right.kind &&
    left.dependentId === right.dependentId &&
    left.prerequisiteId === right.prerequisiteId
  );
}

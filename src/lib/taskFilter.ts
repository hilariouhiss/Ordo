import type { Task, TaskFilter } from "../model/types";

/** The neutral filter: no text, no facets, every task visible. */
export const EMPTY_FILTER: TaskFilter = {
  query: "",
  projectId: null,
  categoryId: null,
  ownerId: null,
  tagId: null,
  priority: null,
};

export function isEmptyFilter(filter: TaskFilter): boolean {
  return (
    !filter.query.trim() &&
    !filter.projectId &&
    !filter.categoryId &&
    !filter.ownerId &&
    !filter.tagId &&
    !filter.priority
  );
}

/** Keeps the incoming order; a facet narrows, never re-sorts. */
export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return tasks.filter(
    (task) =>
      (!query || task.title.toLocaleLowerCase().includes(query)) &&
      (!filter.projectId || task.projectId === filter.projectId) &&
      (!filter.categoryId || task.categoryId === filter.categoryId) &&
      (!filter.ownerId || task.ownerId === filter.ownerId) &&
      (!filter.tagId || task.tags.some((tag) => tag.id === filter.tagId)) &&
      (!filter.priority || task.priority === filter.priority),
  );
}

/** View-chip matching: a query is compared without blanks or case noise. */
export function sameFilter(one: TaskFilter, other: TaskFilter): boolean {
  return (
    one.query.trim().toLocaleLowerCase() === other.query.trim().toLocaleLowerCase() &&
    one.projectId === other.projectId &&
    one.categoryId === other.categoryId &&
    one.ownerId === other.ownerId &&
    one.tagId === other.tagId &&
    one.priority === other.priority
  );
}

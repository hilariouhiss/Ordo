import type { Category, Task } from "../model/types";

export type TaskGroupBy = "project" | "category" | "tag";

export interface TaskGroup {
  key: string;
  name: string;
  tasks: Task[];
}

export interface TaskGroupOptions {
  by: TaskGroupBy;
  categories: Category[];
  collator: Intl.Collator;
  noneName: string;
}

const NONE_KEY = "__none__";

/** Keeps the incoming task order inside a group; only the groups themselves are sorted. */
function sortByName(groups: TaskGroup[], collator: Intl.Collator): void {
  groups.sort((a, b) => collator.compare(a.name, b.name) || a.key.localeCompare(b.key));
}

function byProject(tasks: Task[], collator: Intl.Collator, noneName: string): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  const none: Task[] = [];
  for (const task of tasks) {
    if (!task.projectId || !task.projectName) {
      none.push(task);
      continue;
    }
    const group = groups.get(task.projectId) ?? {
      key: task.projectId,
      name: task.projectName,
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(task.projectId, group);
  }

  const result = [...groups.values()];
  sortByName(result, collator);
  if (none.length) result.push({ key: NONE_KEY, name: noneName, tasks: none });
  return result;
}

function byCategory(
  tasks: Task[],
  categories: Category[],
  collator: Intl.Collator,
  noneName: string,
): TaskGroup[] {
  const groups = [...categories]
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || collator.compare(a.name, b.name) || a.id.localeCompare(b.id),
    )
    .map((category) => ({ key: category.id, name: category.name, tasks: [] as Task[] }));
  const byId = new Map(groups.map((group) => [group.key, group]));
  const none: Task[] = [];
  for (const task of tasks) {
    const group = task.categoryId ? byId.get(task.categoryId) : undefined;
    if (group) group.tasks.push(task);
    else none.push(task);
  }

  const result = groups.filter((group) => group.tasks.length > 0);
  if (none.length) result.push({ key: NONE_KEY, name: noneName, tasks: none });
  return result;
}

function byTag(tasks: Task[], collator: Intl.Collator, noneName: string): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  const none: Task[] = [];
  for (const task of tasks) {
    if (!task.tags.length) {
      none.push(task);
      continue;
    }
    for (const tag of task.tags) {
      const group = groups.get(tag.id) ?? { key: tag.id, name: tag.name, tasks: [] };
      group.tasks.push(task);
      groups.set(tag.id, group);
    }
  }

  const result = [...groups.values()];
  sortByName(result, collator);
  if (none.length) result.push({ key: NONE_KEY, name: noneName, tasks: none });
  return result;
}

export function groupTasks(tasks: Task[], options: TaskGroupOptions): TaskGroup[] {
  if (!tasks.length) return [];
  switch (options.by) {
    case "project":
      return byProject(tasks, options.collator, options.noneName);
    case "category":
      return byCategory(tasks, options.categories, options.collator, options.noneName);
    case "tag":
      return byTag(tasks, options.collator, options.noneName);
  }
}

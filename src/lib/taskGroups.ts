import type { Category, Person, Priority, ProjectSummary, Task } from "../model/types";

export type TaskGroupBy = "project" | "category" | "tag" | "owner" | "priority";
export type TaskGrouping = TaskGroupBy | "none";

export interface TaskGroup {
  key: string;
  name: string;
  tasks: Task[];
}

export interface TaskGroupOptions {
  by: TaskGroupBy;
  categories: Category[];
  people: Person[];
  projects: ProjectSummary[];
  priorityLabels: Record<Priority, string>;
  collator: Intl.Collator;
  noneName: string;
}

export const NONE_GROUP_KEY = "__none__";
const PRIORITY_ORDER: Priority[] = ["high", "normal", "low"];

/** Keeps the incoming task order inside a group; only the groups themselves are sorted. */
function sortByName(groups: TaskGroup[], collator: Intl.Collator): void {
  groups.sort((a, b) => collator.compare(a.name, b.name) || a.key.localeCompare(b.key));
}

function byProject(
  tasks: Task[],
  projects: ProjectSummary[],
  collator: Intl.Collator,
  noneName: string,
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  // Seed active projects so an empty project can still be a drop target.
  for (const project of projects) {
    groups.set(project.id, { key: project.id, name: project.name, tasks: [] });
  }
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
  // Always present, so dragging here can clear a project.
  result.push({ key: NONE_GROUP_KEY, name: noneName, tasks: none });
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
  if (none.length) result.push({ key: NONE_GROUP_KEY, name: noneName, tasks: none });
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
  if (none.length) result.push({ key: NONE_GROUP_KEY, name: noneName, tasks: none });
  return result;
}

function byOwner(
  tasks: Task[],
  people: Person[],
  collator: Intl.Collator,
  noneName: string,
): TaskGroup[] {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const groups = new Map<string, TaskGroup>();
  const none: Task[] = [];
  for (const task of tasks) {
    const person = task.ownerId ? peopleById.get(task.ownerId) : undefined;
    if (!person) {
      none.push(task);
      continue;
    }
    const group = groups.get(person.id) ?? { key: person.id, name: person.name, tasks: [] };
    group.tasks.push(task);
    groups.set(person.id, group);
  }

  const result = [...groups.values()];
  sortByName(result, collator);
  if (none.length) result.push({ key: NONE_GROUP_KEY, name: noneName, tasks: none });
  return result;
}

function byPriority(
  tasks: Task[],
  labels: Record<Priority, string>,
  noneName: string,
): TaskGroup[] {
  const groups: TaskGroup[] = PRIORITY_ORDER.map((priority) => ({
    key: priority,
    name: labels[priority],
    tasks: [],
  }));
  const byId = new Map(groups.map((group) => [group.key, group]));
  const none: Task[] = [];
  for (const task of tasks) {
    const group = byId.get(task.priority);
    if (group) group.tasks.push(task);
    else none.push(task);
  }

  const result = groups.filter((group) => group.tasks.length > 0);
  if (none.length) result.push({ key: NONE_GROUP_KEY, name: noneName, tasks: none });
  return result;
}

export function groupTasks(tasks: Task[], options: TaskGroupOptions): TaskGroup[] {
  if (!tasks.length) return [];
  switch (options.by) {
    case "project":
      return byProject(tasks, options.projects, options.collator, options.noneName);
    case "category":
      return byCategory(tasks, options.categories, options.collator, options.noneName);
    case "tag":
      return byTag(tasks, options.collator, options.noneName);
    case "owner":
      return byOwner(tasks, options.people, options.collator, options.noneName);
    case "priority":
      return byPriority(tasks, options.priorityLabels, options.noneName);
  }
}

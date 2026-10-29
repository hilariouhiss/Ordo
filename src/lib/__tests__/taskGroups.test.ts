import { describe, expect, it } from "vite-plus/test";
import type { Category, Person, Priority, ProjectSummary, Tag } from "../../model/types";
import { task } from "../../viewmodels/__tests__/fixtures";
import { groupTasks, type TaskGroupOptions } from "../taskGroups";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const categories: Category[] = [
  { id: "c2", name: "Docs", sortOrder: 2 },
  { id: "c1", name: "Code", sortOrder: 1 },
];
const people: Person[] = [
  { id: "u1", name: "Alice", isMe: true },
  { id: "u2", name: "Bob", isMe: false },
];
const priorityLabels: Record<Priority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

function options(overrides: Partial<TaskGroupOptions> = {}): TaskGroupOptions {
  return {
    by: "project",
    projects: [],
    categories,
    people,
    priorityLabels,
    collator,
    noneName: "None",
    ...overrides,
  };
}

function project(id: string, name: string): ProjectSummary {
  return {
    id,
    name,
    groupId: null,
    priority: "normal",
    total: 0,
    done: 0,
    byCategory: [],
  };
}

function tag(id: string, name: string): Tag {
  return { id, name };
}

function summary(groups: ReturnType<typeof groupTasks>): [string, string[]][] {
  return groups.map((group) => [group.name, group.tasks.map((item) => item.id)]);
}

describe("groupTasks", () => {
  it("groups by project, sorts names and puts missing projects last", () => {
    const groups = groupTasks(
      [
        task({ id: "t1", projectId: "p2", projectName: "Beta" }),
        task({ id: "t2", projectId: null, projectName: null }),
        task({ id: "t3", projectId: "p1", projectName: "Alpha" }),
        task({ id: "t4", projectId: "p2", projectName: "Beta" }),
        task({ id: "t5", projectId: "gone", projectName: null }),
      ],
      options({ by: "project", noneName: "No project" }),
    );

    expect(summary(groups)).toEqual([
      ["Alpha", ["t3"]],
      ["Beta", ["t1", "t4"]],
      ["No project", ["t2", "t5"]],
    ]);
  });

  it("keeps empty active projects as drop targets and always keeps unassigned", () => {
    const groups = groupTasks(
      [task({ id: "t1", projectId: "p1", projectName: "Alpha" })],
      options({
        by: "project",
        projects: [project("p2", "Beta"), project("p3", "Empty"), project("p1", "Alpha")],
        noneName: "No project",
      }),
    );

    expect(summary(groups)).toEqual([
      ["Alpha", ["t1"]],
      ["Beta", []],
      ["Empty", []],
      ["No project", []],
    ]);
  });

  it("orders categories by sortOrder, skips empty ones and folds unknown ids", () => {
    const groups = groupTasks(
      [
        task({ id: "t1", categoryId: "c2" }),
        task({ id: "t2", categoryId: "c1" }),
        task({ id: "t3", categoryId: "gone" }),
        task({ id: "t4", categoryId: null }),
      ],
      options({ by: "category", noneName: "Uncategorized" }),
    );

    expect(summary(groups)).toEqual([
      ["Code", ["t2"]],
      ["Docs", ["t1"]],
      ["Uncategorized", ["t3", "t4"]],
    ]);
  });

  it("puts a task under every tag and collects untagged tasks last", () => {
    const groups = groupTasks(
      [
        task({ id: "t1", tags: [tag("g2", "Work")] }),
        task({ id: "t2", tags: [] }),
        task({ id: "t3", tags: [tag("g1", "Client"), tag("g2", "Work")] }),
      ],
      options({ by: "tag", noneName: "No tag" }),
    );

    expect(summary(groups)).toEqual([
      ["Client", ["t3"]],
      ["Work", ["t1", "t3"]],
      ["No tag", ["t2"]],
    ]);
  });

  it("groups by owner and folds missing people into unassigned", () => {
    const groups = groupTasks(
      [
        task({ id: "t1", ownerId: "u2" }),
        task({ id: "t2", ownerId: null }),
        task({ id: "t3", ownerId: "u1" }),
        task({ id: "t4", ownerId: "gone" }),
      ],
      options({ by: "owner", noneName: "Unassigned" }),
    );

    expect(summary(groups)).toEqual([
      ["Alice", ["t3"]],
      ["Bob", ["t1"]],
      ["Unassigned", ["t2", "t4"]],
    ]);
  });

  it("orders priority groups from high to low", () => {
    const groups = groupTasks(
      [
        task({ id: "t1", priority: "low" }),
        task({ id: "t2", priority: "high" }),
        task({ id: "t3", priority: "normal" }),
        task({ id: "t4", priority: "high" }),
      ],
      options({ by: "priority", noneName: "Unassigned" }),
    );

    expect(summary(groups)).toEqual([
      ["High", ["t2", "t4"]],
      ["Normal", ["t3"]],
      ["Low", ["t1"]],
    ]);
  });

  it("returns nothing when there are no tasks", () => {
    expect(groupTasks([], options({ by: "project", noneName: "No project" }))).toEqual([]);
  });
});

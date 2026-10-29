import { describe, expect, it } from "vite-plus/test";
import type { Category, Tag } from "../../model/types";
import { task } from "../../viewmodels/__tests__/fixtures";
import { groupTasks } from "../taskGroups";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const categories: Category[] = [
  { id: "c2", name: "Docs", sortOrder: 2 },
  { id: "c1", name: "Code", sortOrder: 1 },
];

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
      { by: "project", categories, collator, noneName: "No project" },
    );

    expect(summary(groups)).toEqual([
      ["Alpha", ["t3"]],
      ["Beta", ["t1", "t4"]],
      ["No project", ["t2", "t5"]],
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
      { by: "category", categories, collator, noneName: "Uncategorized" },
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
      { by: "tag", categories, collator, noneName: "No tag" },
    );

    expect(summary(groups)).toEqual([
      ["Client", ["t3"]],
      ["Work", ["t1", "t3"]],
      ["No tag", ["t2"]],
    ]);
  });

  it("returns nothing when there are no tasks", () => {
    expect(groupTasks([], { by: "project", categories, collator, noneName: "No project" })).toEqual(
      [],
    );
  });
});

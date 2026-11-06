import { describe, expect, it } from "vite-plus/test";
import { task } from "../../viewmodels/__tests__/fixtures";
import { EMPTY_FILTER, filterTasks, isEmptyFilter, sameFilter } from "../taskFilter";

const tasks = [
  task({
    id: "t1",
    title: "交底会议纪要",
    projectId: "p1",
    categoryId: "c1",
    ownerId: "o1",
    priority: "high",
    tags: [{ id: "g1", name: "现场" }],
  }),
  task({
    id: "t2",
    title: "写验收清单",
    projectId: "p2",
    categoryId: "c2",
    ownerId: "o2",
    priority: "low",
    tags: [{ id: "g2", name: "文档" }],
  }),
  task({
    id: "t3",
    title: "ABC 交底复盘",
    projectId: "p1",
    categoryId: null,
    ownerId: null,
    priority: "normal",
  }),
];

function ids(list: { id: string }[]): string[] {
  return list.map((item) => item.id);
}

describe("filterTasks", () => {
  it("returns everything in order for an empty filter", () => {
    expect(ids(filterTasks(tasks, EMPTY_FILTER))).toEqual(["t1", "t2", "t3"]);
  });

  it("matches the title as a trimmed, case-insensitive substring", () => {
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTER, query: " 交底 " }))).toEqual(["t1", "t3"]);
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTER, query: "abc" }))).toEqual(["t3"]);
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTER, query: "验收" }))).toEqual(["t2"]);
  });

  it("combines every facet with AND", () => {
    const filter = {
      ...EMPTY_FILTER,
      projectId: "p1",
      priority: "high" as const,
    };
    expect(ids(filterTasks(tasks, filter))).toEqual(["t1"]);

    expect(ids(filterTasks(tasks, { ...EMPTY_FILTER, projectId: "p1", categoryId: "c1" }))).toEqual(
      ["t1"],
    );
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTER, ownerId: "o2" }))).toEqual(["t2"]);
  });

  it("matches a tag when any of the task's tags is selected", () => {
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTER, tagId: "g2" }))).toEqual(["t2"]);
    expect(ids(filterTasks(tasks, { ...EMPTY_FILTER, tagId: "missing" }))).toEqual([]);
  });

  it("returns nothing when no task matches, without touching the input", () => {
    const before = JSON.stringify(tasks);
    expect(filterTasks(tasks, { ...EMPTY_FILTER, projectId: "nope" })).toEqual([]);
    expect(JSON.stringify(tasks)).toBe(before);
  });
});

describe("isEmptyFilter", () => {
  it("treats blank text and empty facets as the empty filter", () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
    expect(isEmptyFilter({ ...EMPTY_FILTER, query: "   " })).toBe(true);
    expect(isEmptyFilter({ ...EMPTY_FILTER, query: "交底" })).toBe(false);
    expect(isEmptyFilter({ ...EMPTY_FILTER, priority: "high" })).toBe(false);
    expect(isEmptyFilter({ ...EMPTY_FILTER, tagId: "g1" })).toBe(false);
  });
});

describe("sameFilter", () => {
  it("ignores surrounding blanks and case when comparing", () => {
    expect(sameFilter({ ...EMPTY_FILTER, query: " abc " }, { ...EMPTY_FILTER, query: "ABC" })).toBe(
      true,
    );
    expect(
      sameFilter({ ...EMPTY_FILTER, projectId: "p1" }, { ...EMPTY_FILTER, projectId: "p2" }),
    ).toBe(false);
    expect(sameFilter({ ...EMPTY_FILTER, priority: "high" }, { ...EMPTY_FILTER })).toBe(false);
  });
});

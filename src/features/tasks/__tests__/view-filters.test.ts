import { describe, expect, it } from "vitest";
import {
  applyFilter,
  formatDueLabel,
  isOverdue,
  sortTasks,
  viewCompleted,
  viewInbox,
  viewToday,
  viewUpcoming,
} from "../view-filters";
import type { Tag, Task } from "../types";

/** 2026-09-09 12:00 in the test machine's local timezone. */
const NOW = new Date(2026, 8, 9, 12, 0);

/** ISO timestamp `dayOffset` days from today at `hour:minute` local time. */
function iso(dayOffset: number, hour: number, minute = 0): string {
  return new Date(2026, 8, 9 + dayOffset, hour, minute).toISOString();
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: null,
    title: `任务 ${id}`,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt: null,
    repeatRule: null,
    complexity: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("view predicates", () => {
  it("inbox keeps uncompleted project-less tasks only", () => {
    const tasks = [
      task("plain"),
      task("in-project", { projectId: "p1" }),
      task("done-inbox", { completedAt: iso(-1, 9) }),
    ];

    expect(viewInbox(tasks).map((t) => t.id)).toEqual(["plain"]);
  });

  it("today keeps uncompleted tasks due by end of the local day", () => {
    const tasks = [
      task("earlier-today", { dueAt: iso(0, 8) }),
      task("end-of-today", { dueAt: iso(0, 23, 59) }),
      task("overdue", { dueAt: iso(-3, 10) }),
      task("tomorrow", { dueAt: iso(1, 0) }),
      task("no-due"),
      task("completed-today", { dueAt: iso(0, 8), completedAt: iso(0, 9) }),
    ];

    expect(viewToday(tasks, NOW).map((t) => t.id)).toEqual([
      "earlier-today",
      "end-of-today",
      "overdue",
    ]);
  });

  it("upcoming keeps tasks due after today within the range", () => {
    const tasks = [
      task("tomorrow", { dueAt: iso(1, 0) }),
      task("in-7d", { dueAt: iso(7, 23) }),
      task("day-8", { dueAt: iso(8, 8) }),
      task("today-late", { dueAt: iso(0, 23) }),
      task("overdue", { dueAt: iso(-1, 8) }),
      task("no-due"),
      task("completed-tomorrow", { dueAt: iso(1, 8), completedAt: iso(0, 9) }),
    ];

    expect(viewUpcoming(tasks, 7, NOW).map((t) => t.id)).toEqual(["tomorrow", "in-7d"]);
    expect(viewUpcoming(tasks, 14, NOW).map((t) => t.id)).toEqual([
      "tomorrow",
      "in-7d",
      "day-8",
    ]);
  });

  it("completed keeps every task with a completedAt stamp", () => {
    const tasks = [task("open"), task("done", { completedAt: iso(0, 9) })];

    expect(viewCompleted(tasks).map((t) => t.id)).toEqual(["done"]);
  });
});

describe("applyFilter", () => {
  it("passes everything through with no restrictions", () => {
    const tasks = [task("a", { priority: "high" }), task("b", { tagIds: ["t1"] })];

    expect(applyFilter(tasks, { priority: "all", tagIds: [] })).toHaveLength(2);
  });

  it("keeps only the chosen priority", () => {
    const tasks = [
      task("high", { priority: "high" }),
      task("low", { priority: "low" }),
      task("none"),
    ];

    expect(applyFilter(tasks, { priority: "low", tagIds: [] }).map((t) => t.id)).toEqual([
      "low",
    ]);
  });

  it("matches tasks carrying any of the selected tags", () => {
    const tasks = [
      task("both", { tagIds: ["t1", "t2"] }),
      task("one", { tagIds: ["t2"] }),
      task("none"),
    ];

    expect(applyFilter(tasks, { priority: "all", tagIds: ["t1"] }).map((t) => t.id)).toEqual([
      "both",
    ]);
    expect(applyFilter(tasks, { priority: "all", tagIds: ["t1", "t2"] }).map((t) => t.id)).toEqual(
      ["both", "one"],
    );
  });

  it("combines priority and tag restrictions", () => {
    const tasks = [
      task("high-tagged", { priority: "high", tagIds: ["t1"] }),
      task("low-tagged", { priority: "low", tagIds: ["t1"] }),
    ];

    expect(
      applyFilter(tasks, { priority: "high", tagIds: ["t1"] }).map((t) => t.id),
    ).toEqual(["high-tagged"]);
  });
});

describe("sortTasks", () => {
  it("manual order follows sort keys (SQL parity: sort_order, created_at, id)", () => {
    const tasks = [
      task("b", { sortOrder: "z" }),
      task("a", { sortOrder: "a" }),
      task("c", { sortOrder: "zz" }),
    ];

    expect(sortTasks(tasks, "manual").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("priority order ranks high → medium → low → none with manual ties", () => {
    const tasks = [
      task("none-1"),
      task("low", { priority: "low", sortOrder: "z" }),
      task("high-2", { priority: "high", sortOrder: "z" }),
      task("high-1", { priority: "high", sortOrder: "a" }),
      task("medium", { priority: "medium" }),
    ];

    expect(sortTasks(tasks, "priority").map((t) => t.id)).toEqual([
      "high-1",
      "high-2",
      "medium",
      "low",
      "none-1",
    ]);
  });

  it("due order is earliest first with undated tasks last", () => {
    const tasks = [
      task("no-due", { sortOrder: "a" }),
      task("later", { dueAt: iso(2, 9), sortOrder: "a" }),
      task("sooner", { dueAt: iso(1, 9), sortOrder: "z" }),
    ];

    expect(sortTasks(tasks, "due").map((t) => t.id)).toEqual(["sooner", "later", "no-due"]);
  });

  it("recent order puts the latest completedAt first", () => {
    const tasks = [
      task("older", { completedAt: iso(-2, 9), sortOrder: "a" }),
      task("newer", { completedAt: iso(0, 9), sortOrder: "z" }),
    ];

    expect(sortTasks(tasks, "recent").map((t) => t.id)).toEqual(["newer", "older"]);
  });

  it("tag order groups by the first tag name, untagged tasks last", () => {
    const tags: Tag[] = [
      { id: "t-work", name: "Work", color: null, createdAt: "", updatedAt: "", deletedAt: null },
      { id: "t-life", name: "alice", color: null, createdAt: "", updatedAt: "", deletedAt: null },
    ];
    const tasks = [
      task("untagged", { sortOrder: "a" }),
      task("life", { tagIds: ["t-life"] }),
      task("work", { tagIds: ["t-work"], sortOrder: "z" }),
      task("untagged-2", { sortOrder: "b" }),
      // Case-insensitive + ties fall back to manual order.
      task("work-2", { tagIds: ["t-work"], sortOrder: "b" }),
    ];

    expect(sortTasks(tasks, "tag", tags).map((t) => t.id)).toEqual([
      "life",
      "work-2",
      "work",
      "untagged",
      "untagged-2",
    ]);
  });
});

describe("due presentation", () => {
  it("labels today/tomorrow/yesterday with the time, other days by date", () => {
    expect(formatDueLabel(iso(0, 14, 30), NOW)).toBe("今天 14:30");
    expect(formatDueLabel(iso(1, 9), NOW)).toBe("明天 09:00");
    expect(formatDueLabel(iso(-1, 10), NOW)).toBe("昨天 10:00");
    expect(formatDueLabel(iso(3, 8), NOW)).toBe("9月12日 08:00");
    expect(formatDueLabel(null, NOW)).toBe("");
  });

  it("flags only past due dates as overdue", () => {
    expect(isOverdue(iso(-1, 9), NOW)).toBe(true);
    expect(isOverdue(iso(0, 8), NOW)).toBe(true); // earlier today is past
    expect(isOverdue(iso(0, 18), NOW)).toBe(false); // later today is not
    expect(isOverdue(iso(2, 9), NOW)).toBe(false);
    expect(isOverdue(null, NOW)).toBe(false);
  });
});

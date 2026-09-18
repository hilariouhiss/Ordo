import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTaskViewer, focusedTaskId } from "../../../common/stores/taskViewer";
import * as taskApi from "../../tasks/api";
import * as taskStore from "../../tasks/store";
import type { Task } from "../../tasks/types";
import * as searchApi from "../api";
import { SearchView } from "../components/SearchView";
import type { SearchHit } from "../types";

vi.mock("../api", () => ({
  querySearch: vi.fn(),
}));

vi.mock("../../tasks/api", () => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  reorderTask: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listDependencies: vi.fn().mockResolvedValue([]),
}));

// Debounced search runs on setTimeout; the responses resolve via microtasks
// that `advanceTimersByTimeAsync` flushes.
vi.useFakeTimers();

function taskFixture(id: string, overrides: Partial<Task> = {}): Task {
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
    parentTaskId: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function hit(overrides: Partial<SearchHit>): SearchHit {
  return {
    kind: "task",
    id: "t1",
    taskId: "t1",
    taskTitle: "海报设计评审",
    snippet: "…<mark>设计</mark>评审…",
    ...overrides,
  };
}

async function typeQuery(value: string) {
  fireEvent.input(screen.getByRole("textbox", { name: "搜索任务" }), {
    target: { value },
  });
  await vi.advanceTimersByTimeAsync(200);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(taskApi.listTasks).mockResolvedValue([]);
  vi.mocked(taskApi.listTags).mockResolvedValue([]);
  taskStore.resetTasksStore();
  closeTaskViewer();
});

afterEach(cleanup);

describe("SearchView", () => {
  it("shows the intro hint for a blank query without searching", async () => {
    render(() => <SearchView />);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText("全文搜索")).toBeTruthy();
    expect(searchApi.querySearch).not.toHaveBeenCalled();
  });

  it("searches after the debounce and renders grouped, highlighted results", async () => {
    taskStore.setAll([taskFixture("t1", { title: "海报设计评审" })], []);
    vi.mocked(searchApi.querySearch).mockResolvedValue([
      hit({}),
      hit({
        kind: "comment",
        id: "c1",
        taskId: "t1",
        taskTitle: "海报设计评审",
        snippet: "<mark>设计</mark>定稿了",
      }),
    ]);

    render(() => <SearchView />);
    await typeQuery("设计");

    expect(searchApi.querySearch).toHaveBeenCalledWith("设计");
    expect(screen.getByText("任务（1）")).toBeTruthy();
    expect(screen.getByText("评论（1）")).toBeTruthy();
    // Snippet markers render as real <mark> elements, not raw HTML.
    const marks = screen.getAllByText("设计");
    expect(marks.length).toBe(2);
    for (const mark of marks) expect(mark.tagName).toBe("MARK");
  });

  /*
   * The result count is the one thing a screen-reader user cannot see: the hits
   * arrive as buttons with no count of their own, so the view has to say what
   * the query produced.
   */
  it("announces the result counts, and the empty case, in one status region", async () => {
    taskStore.setAll([taskFixture("t1", { title: "海报设计评审" })], []);
    vi.mocked(searchApi.querySearch).mockResolvedValue([
      hit({}),
      hit({ kind: "comment", id: "c1", taskId: "t1" }),
      hit({ kind: "comment", id: "c2", taskId: "t1" }),
    ]);

    render(() => <SearchView />);
    await typeQuery("设计");

    expect(screen.getByRole("status").textContent).toContain("任务 1 条，评论 2 条");

    vi.mocked(searchApi.querySearch).mockResolvedValue([]);
    await typeQuery("不存在");

    expect(screen.getByRole("status").textContent).toContain("没有匹配的结果");
  });

  it("focuses the task viewer when a hit is clicked", async () => {
    taskStore.setAll([taskFixture("t1", { title: "海报设计评审" })], []);
    vi.mocked(searchApi.querySearch).mockResolvedValue([
      hit({}),
      hit({
        kind: "comment",
        id: "c1",
        taskId: "t1",
        taskTitle: "海报设计评审",
        snippet: "<mark>设计</mark>定稿了",
      }),
    ]);

    render(() => <SearchView />);
    await typeQuery("设计");

    // Both hit kinds jump to the owning task (the app-level viewer opens it).
    fireEvent.click(screen.getByRole("button", { name: "打开任务 海报设计评审" }));
    expect(focusedTaskId()).toBe("t1");

    fireEvent.click(screen.getByRole("button", { name: "打开任务 海报设计评审（评论命中）" }));
    expect(focusedTaskId()).toBe("t1");
  });

  it("shows an empty state when nothing matches", async () => {
    vi.mocked(searchApi.querySearch).mockResolvedValue([]);

    render(() => <SearchView />);
    await typeQuery("不存在的词");

    // The pane's own heading (the status region says the same words).
    expect(screen.getByRole("heading", { name: "没有匹配的结果" })).toBeTruthy();
  });

  it("shows a searching indicator while the request is pending", async () => {
    let resolve!: (hits: SearchHit[]) => void;
    vi.mocked(searchApi.querySearch).mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );

    render(() => <SearchView />);
    fireEvent.input(screen.getByRole("textbox", { name: "搜索任务" }), {
      target: { value: "设计" },
    });
    await vi.advanceTimersByTimeAsync(200);

    expect(screen.getByText("搜索中…")).toBeTruthy();

    resolve([hit({})]);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByText("搜索中…")).toBeNull();
  });

  it("reports a failed search without losing the layout", async () => {
    vi.mocked(searchApi.querySearch).mockRejectedValue({ code: "database", message: "失败" });

    render(() => <SearchView />);
    await typeQuery("设计");

    expect(screen.getByRole("alert").textContent).toContain("搜索失败");
  });
});

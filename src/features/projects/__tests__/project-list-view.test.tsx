import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as projectsStore from "../store";
import { ProjectListView } from "../components/ProjectListView";
import * as api from "../../tasks/api";
import * as tasksStore from "../../tasks/store";
import type { Project } from "../types";
import type { Task } from "../../tasks/types";

vi.mock("../../tasks/api", () => ({
  listTasks: vi.fn(),
  // Defaults to an empty page: an unseeded test gets an empty scope instead of
  // crashing `installPage` on `undefined.rows`.
  listTasksByProject: vi.fn().mockResolvedValue({
    rows: [],
    children: [],
    related: [],
    blocked: [],
    hasMore: false,
    cursor: null,
  }),
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

// Project mutations are covered by the projects hooks tests; stubbing the
// hooks keeps the real projects api module out of the jsdom test.
vi.mock("../hooks", () => ({
  loadAll: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
}));

function projectFixture(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    description: "项目说明",
    color: "#3b82f6",
    icon: "rocket",
    namespaceId: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: "proj-1",
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

/**
 * Seeds the project's scope *before* render: `ensureScope` then short-circuits
 * on `loaded`, exactly as it does after the first load, so the view's own load
 * never reaches the mocked API.
 */
function seedProject(tasks: Task[], projectId = "proj-1") {
  tasksStore.installPage(
    `project:${projectId}`,
    { rows: tasks, children: [], related: [], blocked: [], hasMore: false, cursor: null },
    false,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderView(overrides: Partial<Project> = {}) {
  const project = projectFixture("proj-1", overrides);
  projectsStore.setAll([project]);
  render(() => <ProjectListView project={project} />);
  return project;
}

beforeEach(() => {
  vi.clearAllMocks();
  tasksStore.resetTasksStore();
  projectsStore.resetProjectsStore();
});

afterEach(cleanup);

describe("ProjectListView", () => {
  it("shows the project header and the completion rate of its tasks only", () => {
    // The other scopes are loaded too (the shell's `all` snapshot); the page
    // reads only its own, so neither one is listed or counted here.
    tasksStore.setAll(
      [task("inbox", { projectId: null }), task("other", { projectId: "proj-2" })],
      [],
    );
    seedProject([task("t1"), task("t2", { completedAt: "2026-09-09T10:00:00Z" })]);
    renderView();

    expect(screen.getByText("项目 proj-1")).toBeTruthy();
    expect(screen.getByText("项目说明")).toBeTruthy();
    // R2: a project carries no deadline, so the header has no 截止 line.
    expect(screen.queryByText(/截止/)).toBeNull();
    // Only the project's own tasks are listed; rate counts them.
    expect(screen.getByText("1 / 2 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 1 项")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "完成率 50%" }).getAttribute("aria-valuenow")).toBe(
      "50",
    );
    expect(screen.getByText("2 个任务")).toBeTruthy();
    expect(screen.queryByText("任务 inbox")).toBeNull();
    expect(screen.queryByText("任务 other")).toBeNull();
  });

  // §8.5: the header counts top-level tasks only — a child is a step inside its
  // parent, and counting both would report the same work twice.
  it("leaves child tasks out of the completion rate", () => {
    seedProject([
      task("t1", { completedAt: "2026-09-09T10:00:00Z" }),
      task("t2"),
      task("child", { parentTaskId: "t2" }),
    ]);
    renderView();

    expect(screen.getByText("1 / 2 已完成")).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "完成率 50%" }).getAttribute("aria-valuenow"),
    ).toBe("50");
  });

  // 冷启动直接落在项目路由时 `all` 快照可能还没有：子行计数和子行本身都必须由
  // 项目范围自己的行走 store 的子行索引回答，不能回头读整库快照。
  it("只装载项目范围时也算得出子行计数、列得出子行", () => {
    seedProject([
      task("t1", { title: "父任务" }),
      task("c1", { title: "子任务", parentTaskId: "t1", completedAt: "2026-09-09T10:00:00Z" }),
    ]);

    renderView();

    expect(screen.getByText("1/1")).toBeTruthy();
    expect(screen.getByText("子任务 1/1 已完成")).toBeTruthy();
    // 规则 A：范围内的子行把父行打开，子行直接列在父行下面。
    expect(screen.getByText("子任务")).toBeTruthy();
  });

  it("装载失败显示错误面板，「重试」再拉一次并渲染任务", async () => {
    vi.mocked(api.listTasksByProject).mockRejectedValueOnce({
      code: "db",
      message: "数据库连接锁失效",
    });

    renderView();

    const pane = await screen.findByRole("alert");
    expect(pane.textContent).toContain("加载失败");
    expect(pane.textContent).toContain("数据库连接锁失效");
    expect(screen.queryByText("任务 t1")).toBeNull();

    vi.mocked(api.listTasksByProject).mockResolvedValue({
      rows: [task("t1")],
      children: [],
      related: [],
      blocked: [],
      hasMore: false,
      cursor: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    // `force = true`：失败的范围保持未装载，重试按钮把装载器再跑一次。
    await waitFor(() => expect(screen.getByText("任务 t1")).toBeTruthy());
    expect(api.listTasksByProject).toHaveBeenCalledTimes(2);
  });

  it("updates the completion rate live when a task is checked", async () => {
    seedProject([task("t1"), task("t2")]);
    renderView();
    const pending = deferred<Task>();
    vi.mocked(api.completeTask).mockReturnValue(pending.promise);

    expect(screen.getByText("0 / 2 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 2 项")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "完成 任务 t1" }));

    // Optimistic patch flips the rate and the remaining count before the
    // backend replies.
    expect(screen.getByText("1 / 2 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 1 项")).toBeTruthy();

    pending.resolve(task("t1", { completedAt: "2026-09-09T10:00:00Z" }));
    await waitFor(() => expect(screen.getByText("1 / 2 已完成")).toBeTruthy());
    expect(
      screen.getByRole("progressbar", { name: "完成率 50%" }).getAttribute("aria-valuenow"),
    ).toBe("50");
  });

  it("creates new tasks assigned to this project", async () => {
    seedProject([]);
    renderView();
    vi.mocked(api.createTask).mockResolvedValue(task("new-1"));

    fireEvent.click(screen.getByRole("button", { name: /新建任务/ }));
    fireEvent.input(await screen.findByLabelText("标题"), { target: { value: "首个任务" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.createTask).mock.calls[0]?.[0];
    expect(payload?.projectId).toBe("proj-1");
  });

  it("re-sorts rows when the tag sort mode is chosen", async () => {
    seedProject([
      task("b-tag", { tagIds: ["t-b"], sortOrder: "n" }),
      task("a-tag", { tagIds: ["t-a"], sortOrder: "o" }),
      task("none", { sortOrder: "p" }),
    ]);
    // The tag mode sorts by tag *name*, so the rows have to be there too.
    tasksStore.replaceTags([
      { id: "t-b", name: "工作", color: null, createdAt: "", updatedAt: "", deletedAt: null },
      { id: "t-a", name: "生活", color: null, createdAt: "", updatedAt: "", deletedAt: null },
    ]);
    renderView();

    const rowOrder = () =>
      [...document.querySelectorAll("[data-task-id]")].map(
        (row) => row.getAttribute("data-task-id"),
      );

    fireEvent.pointerDown(screen.getByRole("button", { name: /排序方式/ }));
    fireEvent.click(await screen.findByRole("option", { name: "按标签" }));

    // CJK names sort by code point: 工作 (U+5DE5) before 生活 (U+751F).
    await waitFor(() => expect(rowOrder()).toEqual(["b-tag", "a-tag", "none"]));
  });

  it("未播种时自己把项目范围拉回来（深层链接）", async () => {
    vi.mocked(api.listTasksByProject).mockResolvedValue({
      rows: [task("t1")],
      children: [],
      related: [],
      blocked: [],
      hasMore: false,
      cursor: null,
    });

    renderView();

    await waitFor(() => expect(screen.getByText("任务 t1")).toBeTruthy());
    expect(api.listTasksByProject).toHaveBeenCalledWith("proj-1");
  });
});

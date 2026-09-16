/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/solid-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../common/components/__tests__/setup";
import { sidebarCollapsed, toggleSidebar } from "../../common/stores/ui";
import { closeTaskViewer } from "../../common/stores/taskViewer";
import {
  clearNotifications,
  notifications,
} from "../../common/stores/notifications";
import * as namespacesApi from "../../features/namespaces/api";
import { resetNamespacesStore } from "../../features/namespaces/store";
import type { Namespace } from "../../features/namespaces/types";
import * as projectsApi from "../../features/projects/api";
import * as tasksApi from "../../features/tasks/api";
import { resetProjectsStore } from "../../features/projects/store";
import type { Project } from "../../features/projects/types";
import { resetTasksStore, setAll as setTasks, tasksState } from "../../features/tasks/store";
import type { Task } from "../../features/tasks/types";
import { routeTree } from "../../router";

// The shell subscribes to backend events and loads both stores on mount.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../features/namespaces/api", () => ({
  listNamespaces: vi.fn(),
  createNamespace: vi.fn(),
  updateNamespace: vi.fn(),
  archiveNamespace: vi.fn(),
  restoreNamespace: vi.fn(),
}));

vi.mock("../../features/projects/api", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
}));

vi.mock("../../features/tasks/api", () => ({
  listTasks: vi.fn().mockResolvedValue([]),
  listUnfinishedCounts: vi.fn().mockResolvedValue([]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  reorderTask: vi.fn(),
  listTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listDependencies: vi.fn().mockResolvedValue([]),
}));

function namespace(id: string, name: string, status: "active" | "archived" = "active"): Namespace {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    status,
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
  };
}

function project(
  id: string,
  name: string,
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

/** A task due today, so the default view lists it and a drag can start there. */
function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: null,
    title: `任务 ${id}`,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: new Date().toISOString(),
    completedAt: null,
    repeatRule: null,
    complexity: null,
    parentTaskId: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function renderShell() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/today"] }),
  });
  render(() => <RouterProvider router={router} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProjectsStore();
  resetNamespacesStore();
  resetTasksStore();
  clearNotifications();
  closeTaskViewer();
});

afterEach(cleanup);

describe("AppShell sidebar", () => {
  it("nests a namespace's projects and keeps ungrouped ones at the root", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([
      namespace("ns1", "工作"),
      namespace("ns2", "学习"),
    ]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
      project("p2", "移动端", { namespaceId: "ns1" }),
      project("p3", "读论文", { namespaceId: "ns2" }),
      project("p4", "杂事"),
    ]);
    renderShell();

    const group = await screen.findByRole("navigation", { name: "工作 的项目" });
    expect(group.textContent).toContain("网站改版");
    expect(group.textContent).toContain("移动端");
    expect(group.textContent).not.toContain("读论文");
    expect(group.textContent).not.toContain("杂事");
    // R1: the nested nav takes the one shared indent token, not a hand-rolled
    // margin/border/padding trio that could drift from the task list's step.
    expect(group.className).toContain("child-indent");
    expect(group.className).not.toContain("ml-3.5");

    // Unfiled projects stay in the flat root list, exactly as before.
    const root = screen.getByRole("navigation", { name: "项目列表" });
    expect(root.textContent).toContain("杂事");
    expect(root.textContent).not.toContain("网站改版");
  });

  // R8: 展开箭头占的是自己左边那一列，父行内容不再被它推到和子项同一列上 ——
  // 28px 的 `iconButtonClass` 箭头加 2px gap 正好等于 `child-indent` 的 30px。
  it("keeps a group's own row off its children's column", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
    ]);
    renderShell();

    const row = (await screen.findByRole("link", { name: /工作/ })).closest("div") as HTMLElement;
    // The chevron's slot hangs in the sidebar's own gutter, so the group's icon
    // and name keep the level-0 column; only the children take the indent.
    expect(row.classList.contains("-ml-2")).toBe(true);
    expect(row.classList.contains("child-indent")).toBe(false);

    const group = screen.getByRole("navigation", { name: "工作 的项目" });
    expect(group.className).toContain("child-indent");

    // A nested project pulls its own slot onto the guide line, which leaves the
    // row's content exactly where it was before the row became expandable.
    const nested = screen
      .getByRole("link", { name: "网站改版" })
      .closest("div") as HTMLElement;
    expect(nested.classList.contains("-ml-2.5")).toBe(true);
    expect(nested.classList.contains("child-indent")).toBe(false);
  });

  // R9: 项目行可展开，列出该项目「顶层 + 未完成」的任务。
  it("expands a project row into its top-level unfinished tasks", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "杂事"),
      project("p2", "别的"),
    ]);
    // Loaded by the shell itself: the sidebar cannot wait for a task view.
    vi.mocked(tasksApi.listTasks).mockResolvedValue([
      task("t1", { projectId: "p1", title: "写周报" }),
      task("t2", { projectId: "p1", title: "已完成的", completedAt: "2026-09-15T10:00:00Z" }),
      task("t3", { projectId: "p1", title: "子任务", parentTaskId: "t1" }),
      task("t4", { projectId: "p2", title: "别的任务" }),
      task("t5", { title: "收件箱任务" }),
    ]);
    renderShell();

    fireEvent.click(await screen.findByRole("button", { name: "展开项目 杂事" }));

    const list = await screen.findByRole("navigation", { name: "杂事 的未完成任务" });
    expect(list.textContent).toContain("写周报");
    expect(list.textContent).not.toContain("已完成的");
    expect(list.textContent).not.toContain("子任务");
    expect(list.textContent).not.toContain("别的任务");
    expect(list.textContent).not.toContain("收件箱任务");

    // Collapsed by default, and each row opens its own list.
    expect(screen.queryByRole("navigation", { name: "别的 的未完成任务" })).toBeNull();
    expect(screen.getByRole("button", { name: "收起项目 杂事" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("offers no disclosure for a project with nothing left to do", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.listTasks).mockResolvedValue([
      task("t1", { projectId: "p1", completedAt: "2026-09-15T10:00:00Z" }),
      task("t2", { projectId: "p1", parentTaskId: "t1" }),
    ]);
    renderShell();

    await screen.findByRole("link", { name: "杂事" });
    // Wait for the shell's task load, or the absence below proves nothing.
    await waitFor(() => expect(tasksState.loaded).toBe(true));
    expect(screen.queryByRole("button", { name: /项目 杂事/ })).toBeNull();
  });

  it("opens the task detail from a task row in the tree", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.listTasks).mockResolvedValue([
      task("t1", { projectId: "p1", title: "写周报" }),
    ]);
    renderShell();

    fireEvent.click(await screen.findByRole("button", { name: "展开项目 杂事" }));
    // The same task is also a row in 今天, so the click has to start on the
    // sidebar's own copy.
    const list = await screen.findByRole("navigation", { name: "杂事 的未完成任务" });
    fireEvent.click(within(list).getByRole("button", { name: "写周报" }));

    expect(screen.getByRole("dialog").textContent).toContain("写周报");
  });

  it("lists an archived namespace's projects under it, not in the flat archive", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([
      namespace("ns1", "工作"),
      namespace("ns2", "旧线", "archived"),
    ]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "归档项目", { status: "archived" }),
      project("p2", "旧线项目", { namespaceId: "ns2" }),
      project("p3", "旧线归档项目", { namespaceId: "ns2", status: "archived" }),
    ]);
    renderShell();

    // Expand the archived section.
    const toggle = await screen.findByRole("button", { name: /已归档/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();

    const group = await screen.findByRole("navigation", { name: "旧线 的项目" });
    expect(group.textContent).toContain("旧线项目");
    expect(group.textContent).toContain("旧线归档项目");

    const flat = screen.getByRole("navigation", { name: "已归档项目" });
    expect(flat.textContent).toContain("归档项目");
    expect(flat.textContent).not.toContain("旧线项目");
    // `归档项目` is a substring of `旧线归档项目`, so the positive assertion
    // above cannot see a flat list wired to the archived namespace's projects:
    // that list would drop the unfiled project and duplicate this one.
    expect(flat.textContent).not.toContain("旧线归档项目");
  });

  it("shows no namespace rows when there are none", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    renderShell();

    await screen.findByText("杂事");
    expect(screen.queryByRole("navigation", { name: "命名空间列表" })).toBeNull();
  });

  // R4: 两个创建入口都是「标题 ＋」，命名空间不再是列表下方的整宽按钮。
  it("offers 项目 ＋ and 命名空间 ＋ as sibling headers", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([]);
    renderShell();

    const createProject = await screen.findByRole("button", { name: "新建项目" });
    const createNamespace = screen.getByRole("button", { name: "新建命名空间" });

    // Same header shape: a label row with the ＋ on its right.
    for (const button of [createProject, createNamespace]) {
      expect(button.parentElement?.textContent).toMatch(/项目|命名空间/);
    }
    expect(screen.queryByRole("button", { name: "＋ 新建命名空间" })).toBeNull();

    createNamespace.click();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("drops the namespace chevron in the collapsed rail", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([]);
    renderShell();

    await screen.findByRole("button", { name: "收起命名空间 工作" });
    toggleSidebar();

    // Collapsed there is no nested nav to open, so the toggle is dead weight —
    // and the row is the icon alone, with the project rows' `size-8` geometry
    // rather than a `flex-1` basis that would squeeze it to a few pixels.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /命名空间 工作/ })).toBeNull(),
    );
    expect(screen.getByRole("link", { name: "工作" }).getAttribute("class")).not.toContain(
      "flex-1",
    );

    // The collapse signal is module-level: leave it expanded for later tests.
    toggleSidebar();
    await waitFor(() => expect(sidebarCollapsed()).toBe(false));
  });

  // R7a: 拖项目行到命名空间行 = 归入该命名空间；拖到根级项目区 = 移出命名空间。
  it("files a dragged project into a namespace, and unfiles it on the root list", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(projectsApi.updateProject).mockResolvedValue(
      project("p1", "杂事", { namespaceId: "ns1" }),
    );
    renderShell();

    const row = await screen.findByRole("link", { name: "杂事" });
    expect(row.getAttribute("draggable")).toBe("true");

    fireEvent.dragStart(row);
    // Expanded, the row also carries the project count, so match on the name.
    const group = screen.getByRole("link", { name: /工作/ }).closest("div") as HTMLElement;
    fireEvent.dragOver(group);
    fireEvent.drop(group);

    await waitFor(() =>
      expect(projectsApi.updateProject).toHaveBeenCalledWith("p1", { namespaceId: "ns1" }),
    );

    // Same drag, dropped on the root list, moves it back out.
    fireEvent.dragStart(row);
    const root = screen.getByRole("navigation", { name: "项目列表" });
    fireEvent.dragOver(root);
    fireEvent.drop(root);

    await waitFor(() =>
      expect(projectsApi.updateProject).toHaveBeenCalledWith("p1", { namespaceId: null }),
    );
  });

  // R7b/§9.4: 任务行拖到侧边栏项目行 = 移进该项目，同时脱离父任务 —— 因为用户
  // 以为只是换了项目，所以落地后要说一句。
  it("unfiles a dragged child task when it lands on a project row", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.updateTask).mockResolvedValue(task("t1", { projectId: "p1" }));
    renderShell();

    const target = await screen.findByRole("link", { name: "杂事" });
    setTasks([task("t1", { parentTaskId: "p9" })], []);

    // The child stands alone in 今天 (its parent is not in the view). The drag
    // has to start on *that row*: §9.4 is a user gesture, and starting it from
    // the store instead would test a path the UI cannot reach.
    const row = (await waitFor(() => {
      const element = document.querySelector('[data-subtask-id="t1"]');
      if (!element) throw new Error("task row not rendered yet");
      return element;
    })) as HTMLElement;

    fireEvent.dragStart(row);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(() =>
      expect(tasksApi.updateTask).toHaveBeenCalledWith("t1", {
        projectId: "p1",
        parentTaskId: null,
      }),
    );

    await waitFor(() => expect(notifications()).toHaveLength(1));
    expect(notifications()[0]?.message).toContain("移出父任务");
  });

  // R7b: 任务行拖到侧边栏项目行 = 把任务移进该项目。顶层任务没有父子关系可断，
  // 所以这一路不发通知。
  it("moves a dragged task into the project row it is dropped on", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.updateTask).mockResolvedValue(task("t1", { projectId: "p1" }));
    renderShell();

    const target = await screen.findByRole("link", { name: "杂事" });
    setTasks([task("t1")], []);

    const row = (await waitFor(() => {
      const element = document.querySelector('[data-task-id="t1"]');
      if (!element) throw new Error("task row not rendered yet");
      return element;
    })) as HTMLElement;

    fireEvent.dragStart(row);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(() =>
      expect(tasksApi.updateTask).toHaveBeenCalledWith("t1", {
        projectId: "p1",
        parentTaskId: null,
      }),
    );
    expect(notifications()).toHaveLength(0);
  });

  it("ignores a drop that carries nothing we started", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    renderShell();

    const group = (await screen.findByRole("link", { name: /工作/ })).closest("div") as HTMLElement;
    // A file dragged in from the OS, or the board's own column drag.
    fireEvent.drop(group);

    expect(projectsApi.updateProject).not.toHaveBeenCalled();
  });
});

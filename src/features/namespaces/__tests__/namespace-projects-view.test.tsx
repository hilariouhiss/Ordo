import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as projectsStore from "../../projects/store";
import type { Project } from "../../projects/types";
import * as statsApi from "../../stats/api";
import { resetTasksStore, setAll as setTasks } from "../../tasks/store";
import type { Task } from "../../tasks/types";
import { NamespaceProjectsView } from "../components/NamespaceProjectsView";
import * as hooks from "../hooks";
import * as store from "../store";
import type { Namespace } from "../types";

// The rows link to the project page; a plain anchor keeps this test free of
// router plumbing (the AppShell test owns the real router).
vi.mock("@tanstack/solid-router", () => ({
  Link: (props: { children?: unknown }) => <a href="/">{props.children as never}</a>,
}));

vi.mock("../hooks", () => ({
  archiveNamespace: vi.fn(),
  restoreNamespace: vi.fn(),
}));

vi.mock("../../projects/hooks", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
}));

// The page reads its bars from `stats:projectProgress`; mocking the api module
// (not the hook) is what keeps the real `useProjectProgress` under test while
// the tallies stay scripted. The default empty tally keeps the cases that do
// not care about the bars away from the real IPC layer.
vi.mock("../../stats/api", () => ({
  projectProgress: vi.fn().mockResolvedValue([]),
  completionTrend: vi.fn(),
  timeDistribution: vi.fn(),
}));

function namespaceFixture(overrides: Partial<Namespace> = {}): Namespace {
  return {
    id: "ns1",
    name: "工作",
    description: "主线项目",
    color: null,
    icon: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    description: null,
    color: null,
    icon: null,
    namespaceId: "ns1",
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function task(id: string, projectId: string | null, completed = false): Task {
  return {
    id,
    projectId,
    title: `任务 ${id}`,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt: completed ? "2026-09-15T10:00:00Z" : null,
    repeatRule: null,
    complexity: null,
    parentTaskId: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetNamespacesStore();
  projectsStore.resetProjectsStore();
  resetTasksStore();
  store.setAll([namespaceFixture()]);
});

afterEach(cleanup);

describe("NamespaceProjectsView", () => {
  // 这一页不再从任务快照里数：汇总和每张卡都读服务端聚合，所以快照里放一组
  // 与聚合对不上的行，页面上一个都不许出现。
  it("reads the summary and the cards from the aggregate, not the task snapshot", async () => {
    projectsStore.setAll([project("p1"), project("p2")]);
    vi.mocked(statsApi.projectProgress).mockResolvedValue([
      { projectId: "p1", name: "项目 p1", total: 4, completed: 1 },
      { projectId: "p2", name: "项目 p2", total: 2, completed: 1 },
    ]);
    setTasks(
      [task("t1", "p1"), task("t2", "p1"), task("t3", "p2"), task("t4", null)],
      [],
    );

    render(() => <NamespaceProjectsView namespace={namespaceFixture()} />);

    expect(screen.getByText("工作")).toBeTruthy();
    expect(screen.getByText("主线项目")).toBeTruthy();

    // 汇总 = 本命名空间两行之和（1/4 + 1/2），不是快照里的三个未完成任务。
    await waitFor(() => expect(screen.getByText("2 / 6 已完成")).toBeTruthy());
    expect(screen.queryByText("0 / 3 已完成")).toBeNull();
    // 每张卡报自己那一行。
    expect(screen.getByText("1 / 4 已完成")).toBeTruthy();
    expect(screen.getByText("1 / 2 已完成")).toBeTruthy();
  });

  it("sums the group's own projects only, ignoring the rest of the tally", async () => {
    projectsStore.setAll([project("p1"), project("p2", { namespaceId: "ns2" })]);
    vi.mocked(statsApi.projectProgress).mockResolvedValue([
      { projectId: "p1", name: "项目 p1", total: 3, completed: 2 },
      { projectId: "p2", name: "项目 p2", total: 9, completed: 9 },
    ]);

    render(() => <NamespaceProjectsView namespace={namespaceFixture()} />);

    // 汇总就是 p1 那一行（卡片与汇总各一处），别的命名空间的行不进来。
    await waitFor(() => expect(screen.getAllByText("2 / 3 已完成")).toHaveLength(2));
    expect(screen.queryByText("9 / 9 已完成")).toBeNull();
  });

  it("leaves the page standing when the aggregate fails", async () => {
    projectsStore.setAll([project("p1")]);
    vi.mocked(statsApi.projectProgress).mockRejectedValue({
      code: "db",
      message: "数据库连接锁失效",
    });

    render(() => <NamespaceProjectsView namespace={namespaceFixture()} />);

    // 失败也算落地：不画汇总面板（0 / 0 是「拿到了空聚合」的样子，不是这里），
    // 项目列表照旧可用。
    await waitFor(() => expect(statsApi.projectProgress).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("0 / 0 已完成")).toBeNull();
    expect(screen.getByRole("link", { name: "项目 p1" })).toBeTruthy();
  });

  it("shows the empty state and creates a project inside the namespace", async () => {
    render(() => <NamespaceProjectsView namespace={namespaceFixture()} />);

    expect(screen.getByText("这个命名空间还没有项目")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    // The editor opens prefilled with this namespace.
    // Select.Label names the trigger, so it is reachable by its accessible name.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /命名空间/ })).toBeTruthy(),
    );
  });

  it("archives the namespace from the header", async () => {
    projectsStore.setAll([project("p1")]);
    vi.mocked(hooks.archiveNamespace).mockResolvedValue(null);
    render(() => <NamespaceProjectsView namespace={namespaceFixture()} />);

    fireEvent.click(screen.getByRole("button", { name: "归档命名空间" }));

    await waitFor(() => expect(hooks.archiveNamespace).toHaveBeenCalledWith("ns1"));
  });

  it("offers restore instead of archive on an archived namespace", () => {
    // The header reads the live store row (so optimistic patches land in the
    // same tick), so the archived state has to be in the store, not only in
    // the prop snapshot the route hands in.
    store.setAll([namespaceFixture({ status: "archived" })]);
    render(() => (
      <NamespaceProjectsView namespace={namespaceFixture({ status: "archived" })} />
    ));

    expect(screen.getByRole("button", { name: "恢复命名空间" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "归档命名空间" })).toBeNull();
  });
});

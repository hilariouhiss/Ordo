/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import * as projectsStore from "../../projects/store";
import type { Project } from "../../projects/types";
import { resetTasksStore, setAll as setTasks } from "../../tasks/store";
import type { Task } from "../../tasks/types";
import { NamespaceProjectsView } from "../components/NamespaceProjectsView";
import * as hooks from "../hooks";
import * as store from "../store";
import type { Namespace } from "../types";

// The rows link to the project page; a plain anchor keeps this test free of
// router plumbing (the AppShell test owns the real router).
vi.mock("@tanstack/solid-router", () => ({
  Link: (props: { children?: unknown }) => <a href="#">{props.children as never}</a>,
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
  it("aggregates the group's task progress from the live stores", () => {
    projectsStore.setAll([project("p1"), project("p2")]);
    setTasks(
      [task("t1", "p1", true), task("t2", "p1"), task("t3", "p2"), task("t4", null)],
      [],
    );

    render(() => <NamespaceProjectsView namespace={namespaceFixture()} />);

    expect(screen.getByText("工作")).toBeTruthy();
    expect(screen.getByText("主线项目")).toBeTruthy();
    // 1 of 3 tasks in the group is done; the inbox task is not counted.
    expect(screen.getByText("1 / 3 已完成")).toBeTruthy();
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

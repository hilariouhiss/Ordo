/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@solidjs/testing-library";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/solid-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../common/components/__tests__/setup";
import * as namespacesApi from "../../features/namespaces/api";
import { resetNamespacesStore } from "../../features/namespaces/store";
import type { Namespace } from "../../features/namespaces/types";
import * as projectsApi from "../../features/projects/api";
import { resetProjectsStore } from "../../features/projects/store";
import type { Project } from "../../features/projects/types";
import { resetTasksStore } from "../../features/tasks/store";
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
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  listTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listSubtasks: vi.fn().mockResolvedValue([]),
  listSubtasksAll: vi.fn().mockResolvedValue([]),
  listDependencies: vi.fn().mockResolvedValue([]),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  completeSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  reorderSubtask: vi.fn(),
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
    dueAt: null,
    status: "active",
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

    // Unfiled projects stay in the flat root list, exactly as before.
    const root = screen.getByRole("navigation", { name: "项目列表" });
    expect(root.textContent).toContain("杂事");
    expect(root.textContent).not.toContain("网站改版");
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
});

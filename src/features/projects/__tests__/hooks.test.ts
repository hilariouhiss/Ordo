import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLORS } from "../../../common/colors";
import {
  clearNotifications,
  notifications,
} from "../../../common/stores/notifications";
import { resetTasksStore, setAll as setTasks, tasks } from "../../tasks/store";
import type { Task } from "../../tasks/types";
import type { Project } from "../types";

vi.mock("../api", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
  deleteProject: vi.fn(),
}));

import * as api from "../api";
import * as hooks from "../hooks";
import * as store from "../store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function appError(code = "validation", message = "操作失败") {
  return { code, message } as const;
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

/** A row of the task snapshot, with only the fields this file cares about. */
function taskRow(id: string, overrides: Partial<Task> = {}): Task {
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
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetProjectsStore();
  resetTasksStore();
  clearNotifications();
});

afterEach(() => {
  clearNotifications();
});

describe("loadAll", () => {
  it("fills the store with projects", async () => {
    vi.mocked(api.listProjects).mockResolvedValue([project("a"), project("b")]);

    const ok = await hooks.loadAll();

    expect(ok).toBe(true);
    expect(store.projectsState.projects).toHaveLength(2);
    expect(store.projectsState.loaded).toBe(true);
  });

  it("notifies and reports failure when loading fails", async () => {
    vi.mocked(api.listProjects).mockRejectedValue(appError("database", "数据库错误"));

    const ok = await hooks.loadAll();

    expect(ok).toBe(false);
    expect(store.projectsState.loaded).toBe(false);
    expect(notifications()).toEqual([
      { id: expect.any(Number), kind: "error", message: "数据库错误", code: "database" },
    ]);
  });
});

describe("createProject", () => {
  it("shows a trimmed optimistic entry, then reconciles with the real row", async () => {
    const pending = deferred<Project>();
    vi.mocked(api.createProject).mockReturnValue(pending.promise);

    const result = hooks.createProject({ name: "  网站改版  " });

    // The optimistic entry is visible while the request is in flight.
    const optimistic = store.projectsState.projects;
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].name).toBe("网站改版");
    expect(optimistic[0].id).toMatch(/^optimistic-/);

    pending.resolve(project("real-1", { name: "网站改版" }));
    const created = await result;

    expect(created?.id).toBe("real-1");
    expect(api.createProject).toHaveBeenCalledWith({
      name: "网站改版",
      color: expect.any(String),
    });
    expect(store.projectsState.projects).toEqual([project("real-1", { name: "网站改版" })]);
  });

  // R3: 未指定颜色（`undefined`）→ 随机色；显式 `null`=「无颜色」→ 保持无色。
  it("gives a project created without a colour a palette colour", async () => {
    vi.mocked(api.createProject).mockImplementation(async (input) =>
      project("real-1", { name: input.name, color: input.color ?? null }),
    );

    const created = await hooks.createProject({ name: "随手" });

    expect(COLORS).toContain(created?.color);
    expect(api.createProject).toHaveBeenCalledWith({ name: "随手", color: created?.color });
  });

  it("keeps an explicit null colour instead of randomizing it", async () => {
    vi.mocked(api.createProject).mockResolvedValue(project("real-1", { name: "无色" }));

    await hooks.createProject({ name: "无色", color: null });

    expect(api.createProject).toHaveBeenCalledWith({ name: "无色", color: null });
  });

  it("removes the optimistic entry and notifies on failure", async () => {
    vi.mocked(api.createProject).mockRejectedValue(appError("validation", "项目名已存在"));

    const created = await hooks.createProject({ name: "重名" });

    expect(created).toBeNull();
    expect(store.projectsState.projects).toEqual([]);
    expect(notifications()).toEqual([
      { id: expect.any(Number), kind: "error", message: "项目名已存在", code: "validation" },
    ]);
  });
});

describe("updateProject", () => {
  it("applies the patch optimistically and reconciles", async () => {
    store.setAll([project("p1")]);
    vi.mocked(api.updateProject).mockResolvedValue(
      project("p1", { name: "新名", description: "说明" }),
    );

    const saved = await hooks.updateProject("p1", {
      name: "新名",
      description: "说明",
      color: null,
    });

    expect(saved?.name).toBe("新名");
    expect(api.updateProject).toHaveBeenCalledWith("p1", {
      name: "新名",
      description: "说明",
      color: null,
    });
    expect(store.getProject("p1")?.name).toBe("新名");
    expect(store.getProject("p1")?.description).toBe("说明");
    expect(store.getProject("p1")?.color).toBeNull();
  });

  it("rolls back every field when the backend rejects the write", async () => {
    store.setAll([project("p1", { name: "原名", description: "原说明" })]);
    vi.mocked(api.updateProject).mockRejectedValue(appError("validation", "无效"));

    const saved = await hooks.updateProject("p1", { name: "新名" });

    expect(saved).toBeNull();
    expect(store.getProject("p1")?.name).toBe("原名");
    expect(store.getProject("p1")?.description).toBe("原说明");
    expect(notifications()).toHaveLength(1);
  });

  it("reports a missing project without calling the backend", async () => {
    const saved = await hooks.updateProject("ghost", { name: "x" });

    expect(saved).toBeNull();
    expect(api.updateProject).not.toHaveBeenCalled();
    expect(notifications()).toHaveLength(1);
  });
});

describe("archiveProject / restoreProject", () => {
  it("flips the status optimistically and reconciles", async () => {
    store.setAll([project("p1")]);
    vi.mocked(api.archiveProject).mockResolvedValue(project("p1", { status: "archived" }));

    const archived = await hooks.archiveProject("p1");

    expect(archived?.status).toBe("archived");
    expect(store.getProject("p1")?.status).toBe("archived");
    expect(store.activeProjects()).toEqual([]);
    expect(store.archivedProjects()).toEqual([project("p1", { status: "archived" })]);

    vi.mocked(api.restoreProject).mockResolvedValue(project("p1"));
    const restored = await hooks.restoreProject("p1");

    expect(restored?.status).toBe("active");
    expect(store.getProject("p1")?.status).toBe("active");
  });

  it("restores the previous status when archiving fails", async () => {
    store.setAll([project("p1")]);
    vi.mocked(api.archiveProject).mockRejectedValue(appError("database", "数据库错误"));

    const archived = await hooks.archiveProject("p1");

    expect(archived).toBeNull();
    expect(store.getProject("p1")?.status).toBe("active");
  });
});

describe("deleteProject", () => {
  it("removes the project and its tasks optimistically, then confirms", async () => {
    const pending = deferred<void>();
    store.setAll([project("p1"), project("p2")]);
    setTasks(
      [
        taskRow("t1", { projectId: "p1" }),
        taskRow("t2", { projectId: "p1", parentTaskId: "t1" }),
        taskRow("t3", { projectId: "p2" }),
      ],
      [],
    );
    vi.mocked(api.deleteProject).mockReturnValue(pending.promise);

    const result = hooks.deleteProject("p1");

    // Both halves of the backend cascade are hidden in the same tick: leaving
    // the tasks up would show orphans until the next load.
    expect(store.projectsState.projects.map((row) => row.id)).toEqual(["p2"]);
    expect(tasks().map((row) => row.id)).toEqual(["t3"]);

    pending.resolve(undefined);
    await expect(result).resolves.toBe(true);
    expect(api.deleteProject).toHaveBeenCalledWith("p1");
  });

  it("puts the project and its tasks back when the delete fails", async () => {
    store.setAll([project("p1"), project("p2")]);
    setTasks(
      [
        taskRow("t1", { projectId: "p1" }),
        taskRow("t2", { projectId: "p1" }),
        taskRow("t3", { projectId: "p2" }),
      ],
      [],
    );
    vi.mocked(api.deleteProject).mockRejectedValue(appError("database", "数据库错误"));

    const ok = await hooks.deleteProject("p1");

    expect(ok).toBeNull();
    expect(store.getProject("p1")).toEqual(project("p1"));
    expect(tasks().map((row) => row.id)).toEqual(["t1", "t2", "t3"]);
    expect(notifications()).toEqual([
      { id: expect.any(Number), kind: "error", message: "数据库错误", code: "database" },
    ]);
  });

  it("reports a missing project without calling the backend", async () => {
    const ok = await hooks.deleteProject("ghost");

    expect(ok).toBeNull();
    expect(api.deleteProject).not.toHaveBeenCalled();
    expect(notifications()).toHaveLength(1);
  });
});

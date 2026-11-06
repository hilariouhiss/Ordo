import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  listAllTasks: vi.fn(),
  setSettings: vi.fn(),
  updateTaskPatch: vi.fn(),
}));
vi.mock("../undoVM", () => ({ undoVM: { pushUndo: vi.fn() } }));

import { listAllTasks, setSettings, updateTaskPatch } from "../../model/ipc";
import type { SavedTaskView, TaskFilter } from "../../model/types";
import { appVM } from "../appVM";
import { createTasksVM } from "../tasksVM";
import { undoVM } from "../undoVM";
import { defaultSettings, task } from "./fixtures";

const EMPTY: TaskFilter = {
  query: "",
  projectId: null,
  categoryId: null,
  ownerId: null,
  tagId: null,
  priority: null,
};

beforeEach(() => {
  appVM.state.settings = null;
  appVM.state.projects = [];
  appVM.state.categories = [];
  appVM.state.people = [];
  vi.clearAllMocks();
});

afterEach(() => {
  appVM.state.settings = null;
  appVM.state.projects = [];
  appVM.state.categories = [];
  appVM.state.people = [];
});

describe("tasksVM", () => {
  it("defaults to project grouping", () => {
    const vm = createTasksVM();

    expect(vm.state.groupBy).toBe("project");
  });

  it("loads every task", async () => {
    vi.mocked(listAllTasks).mockResolvedValue([
      task({ id: "t1" }),
      task({ id: "t2", status: "done", inWeek: false }),
    ]);

    const vm = createTasksVM();
    await vm.load();

    expect(vm.state.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(vm.state.loading).toBe(false);
  });

  it("stops loading when the request fails", async () => {
    vi.mocked(listAllTasks).mockRejectedValue("boom");

    const vm = createTasksVM();
    await expect(vm.load()).rejects.toBe("boom");

    expect(vm.state.loading).toBe(false);
  });

  it("restores the saved grouping", () => {
    appVM.state.settings = { ...defaultSettings, tasksGroupBy: "priority" };

    const vm = createTasksVM();

    expect(vm.state.groupBy).toBe("priority");
  });

  it("saves the chosen grouping", async () => {
    vi.mocked(setSettings).mockResolvedValue({ ...defaultSettings, tasksGroupBy: "owner" });

    const vm = createTasksVM();
    await vm.setGroupBy("owner");

    expect(setSettings).toHaveBeenCalledWith({ tasksGroupBy: "owner" });
    expect(vm.state.groupBy).toBe("owner");
  });

  it("folds groups per grouping", async () => {
    vi.mocked(setSettings)
      .mockResolvedValueOnce({ ...defaultSettings, tasksGroupBy: "category" })
      .mockResolvedValueOnce({ ...defaultSettings, tasksGroupBy: "project" });

    const vm = createTasksVM();
    vm.toggleGroup("g1");
    expect(vm.isGroupCollapsed("g1")).toBe(true);

    await vm.setGroupBy("category");
    expect(vm.isGroupCollapsed("g1")).toBe(false);

    await vm.setGroupBy("project");
    expect(vm.isGroupCollapsed("g1")).toBe(true);
  });

  it("moves a task to another project", async () => {
    vi.mocked(listAllTasks).mockResolvedValue([
      task({ id: "t1", projectId: "p1", projectName: "Alpha" }),
    ]);
    vi.mocked(updateTaskPatch).mockResolvedValue(
      task({ id: "t1", projectId: "p2", projectName: "Beta" }),
    );

    const vm = createTasksVM();
    await vm.load();

    expect(await vm.assignProject("t1", "p2")).toBe(true);
    expect(updateTaskPatch).toHaveBeenCalledWith("t1", { projectId: "p2" });
    expect(vm.state.tasks[0].projectName).toBe("Beta");
  });

  it("clears a task's project", async () => {
    vi.mocked(listAllTasks).mockResolvedValue([
      task({ id: "t1", projectId: "p1", projectName: "Alpha" }),
    ]);
    vi.mocked(updateTaskPatch).mockResolvedValue(
      task({ id: "t1", projectId: null, projectName: null }),
    );

    const vm = createTasksVM();
    await vm.load();

    expect(await vm.assignProject("t1", null)).toBe(true);
    expect(updateTaskPatch).toHaveBeenCalledWith("t1", { projectId: null });
    expect(vm.state.tasks[0].projectName).toBeNull();
  });

  it("does not write when the task already belongs to the project", async () => {
    vi.mocked(listAllTasks).mockResolvedValue([
      task({ id: "t1", projectId: "p1", projectName: "Alpha" }),
    ]);

    const vm = createTasksVM();
    await vm.load();

    expect(await vm.assignProject("t1", "p1")).toBe(false);
    expect(updateTaskPatch).not.toHaveBeenCalled();
  });

  it("offers undo back to the project a drag replaced", async () => {
    vi.mocked(listAllTasks).mockResolvedValue([
      task({ id: "t1", title: "交底", projectId: "p1", projectName: "Alpha" }),
    ]);
    vi.mocked(updateTaskPatch).mockResolvedValue(
      task({ id: "t1", projectId: "p2", projectName: "Beta" }),
    );

    const vm = createTasksVM();
    await vm.load();
    await vm.assignProject("t1", "p2");

    const [, run] = vi.mocked(undoVM.pushUndo).mock.calls[0];
    await run();
    expect(updateTaskPatch).toHaveBeenLastCalledWith("t1", { projectId: "p1" });
  });

  it("narrows the list and drops empty groups while a filter is active", async () => {
    vi.mocked(listAllTasks).mockResolvedValue([
      task({ id: "t1", title: "交底", projectId: "p1", projectName: "Alpha" }),
      task({ id: "t2", title: "写清单", projectId: "p2", projectName: "Beta" }),
    ]);
    const vm = createTasksVM();
    await vm.load();

    vm.state.filter.query = "交底";

    expect(vm.filteredTasks.value.map((item) => item.id)).toEqual(["t1"]);
    expect(vm.sections.value.map((group) => group.key)).toEqual(["p1"]);
    expect(vm.isEmpty.value).toBe(false);

    vm.clearFilter();
    expect(vm.isEmpty.value).toBe(true);
    expect(vm.sections.value.map((group) => group.key)).toContain("__none__");
  });

  it("saves the current filter and grouping as a named view", async () => {
    vi.mocked(listAllTasks).mockResolvedValue([task({ id: "t1", title: "交底" })]);
    vi.mocked(setSettings).mockImplementation(async (patch) => ({
      ...defaultSettings,
      ...patch,
    }));
    const vm = createTasksVM();
    await vm.load();
    vm.state.filter.query = "交底";
    vm.state.filter.priority = "high";

    expect(await vm.saveView("  交底  ")).toBe(true);

    expect(setSettings).toHaveBeenCalledWith({
      savedTaskViews: [
        expect.objectContaining({
          name: "交底",
          groupBy: "project",
          filter: expect.objectContaining({ query: "交底", priority: "high" }),
        }),
      ],
    });
    expect(appVM.state.settings?.savedTaskViews).toHaveLength(1);
  });

  it("applies a saved view's filter and grouping without sharing the object", async () => {
    const view: SavedTaskView = {
      id: "v1",
      name: "滨江",
      groupBy: "owner",
      filter: { ...EMPTY, projectId: "p1" },
    };
    appVM.state.settings = { ...defaultSettings, savedTaskViews: [view] };
    vi.mocked(setSettings).mockResolvedValue({
      ...defaultSettings,
      savedTaskViews: [view],
      tasksGroupBy: "owner",
    });
    const vm = createTasksVM();

    await vm.applyView("v1");

    expect(vm.state.filter.projectId).toBe("p1");
    expect(vm.state.groupBy).toBe("owner");
    expect(setSettings).toHaveBeenCalledWith({ tasksGroupBy: "owner" });

    vm.state.filter.query = "改了";
    expect(view.filter.query).toBe("");
  });

  it("deletes a saved view through the settings", async () => {
    const view: SavedTaskView = {
      id: "v1",
      name: "滨江",
      groupBy: "project",
      filter: { ...EMPTY, projectId: "p1" },
    };
    appVM.state.settings = { ...defaultSettings, savedTaskViews: [view] };
    vi.mocked(setSettings).mockResolvedValue({ ...defaultSettings, savedTaskViews: [] });
    const vm = createTasksVM();

    await vm.removeView("v1");

    expect(setSettings).toHaveBeenCalledWith({ savedTaskViews: [] });
  });
});

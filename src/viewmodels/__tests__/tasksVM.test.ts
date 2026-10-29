import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  listAllTasks: vi.fn(),
  setSettings: vi.fn(),
  updateTaskPatch: vi.fn(),
}));

import { listAllTasks, setSettings, updateTaskPatch } from "../../model/ipc";
import { appVM } from "../appVM";
import { createTasksVM } from "../tasksVM";
import { defaultSettings, task } from "./fixtures";

beforeEach(() => {
  appVM.state.settings = null;
  vi.clearAllMocks();
});

afterEach(() => {
  appVM.state.settings = null;
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
});

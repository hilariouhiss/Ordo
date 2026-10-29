import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  listAllTasks: vi.fn(),
  setSettings: vi.fn(),
}));

import { listAllTasks, setSettings } from "../../model/ipc";
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
      .mockResolvedValueOnce({ ...defaultSettings, tasksGroupBy: "project" })
      .mockResolvedValueOnce({ ...defaultSettings, tasksGroupBy: "category" })
      .mockResolvedValueOnce({ ...defaultSettings, tasksGroupBy: "project" });

    const vm = createTasksVM();
    await vm.setGroupBy("project");
    vm.toggleGroup("g1");
    expect(vm.isGroupCollapsed("g1")).toBe(true);

    await vm.setGroupBy("category");
    expect(vm.isGroupCollapsed("g1")).toBe(false);

    await vm.setGroupBy("project");
    expect(vm.isGroupCollapsed("g1")).toBe(true);
  });
});

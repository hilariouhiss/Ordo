import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({ listAllTasks: vi.fn() }));

import { listAllTasks } from "../../model/ipc";
import { createTasksVM } from "../tasksVM";
import { task } from "./fixtures";

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
});

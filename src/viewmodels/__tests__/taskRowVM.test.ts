import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  setTaskStatus: vi.fn(),
  startTask: vi.fn(),
  suspendTask: vi.fn(),
}));

import { setTaskStatus, startTask, suspendTask } from "../../model/ipc";
import { createTaskRowVM } from "../taskRowVM";
import { task } from "./fixtures";

describe("taskRowVM", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts and suspends the task through the commands", async () => {
    const vm = createTaskRowVM();

    await vm.start(task({ id: "t1" }));
    await vm.suspend(task({ id: "t1" }), "2026-11-02", "等甲方");

    expect(startTask).toHaveBeenCalledWith("t1");
    expect(suspendTask).toHaveBeenCalledWith("t1", "2026-11-02", "等甲方");
  });

  it("toggles between done and todo", async () => {
    const vm = createTaskRowVM();

    await vm.toggleDone(task({ status: "doing" }));
    expect(setTaskStatus).toHaveBeenLastCalledWith("t1", "done");

    await vm.toggleDone(task({ status: "done" }));
    expect(setTaskStatus).toHaveBeenLastCalledWith("t1", "todo");
  });
});

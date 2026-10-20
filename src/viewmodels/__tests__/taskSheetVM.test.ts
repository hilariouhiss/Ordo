import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  getTask: vi.fn(),
  toggleStep: vi.fn(),
  addStep: vi.fn(),
  updateTaskPatch: vi.fn(),
  deleteStep: vi.fn(),
}));

import { getTask, toggleStep, updateTaskPatch } from "../../model/ipc";
import { createTaskSheetVM } from "../taskSheetVM";
import { step, task } from "./fixtures";

describe("taskSheetVM", () => {
  it("opens a task and toggles a step", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1", status: "todo" }));
    vi.mocked(toggleStep).mockResolvedValue(
      task({ id: "t1", status: "doing", steps: [step({ done: true })] }),
    );

    const vm = createTaskSheetVM();
    await vm.open("t1");
    expect(vm.state.task?.id).toBe("t1");

    await vm.toggle("s1");
    expect(vm.state.task?.status).toBe("doing");
    expect(toggleStep).toHaveBeenCalledWith("s1");
  });

  it("saves only the fields the user changed", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1", title: "旧", note: "旧备注" }));
    vi.mocked(updateTaskPatch).mockResolvedValue(task({ id: "t1", title: "新" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    await vm.patch({ title: "新" });
    expect(updateTaskPatch).toHaveBeenCalledWith("t1", { title: "新" });
  });
});

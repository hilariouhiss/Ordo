import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  getTask: vi.fn(),
  toggleStep: vi.fn(),
  addStep: vi.fn(),
  updateTaskPatch: vi.fn(),
  deleteStep: vi.fn(),
}));

import { getTask, toggleStep, updateTaskPatch } from "../../model/ipc";
import type { Task } from "../../model/types";
import { createTaskSheetVM, diffTask, type TaskForm } from "../taskSheetVM";
import { step, task } from "./fixtures";

function formOf(t: Task): TaskForm {
  return {
    title: t.title,
    projectId: t.projectId,
    categoryId: t.categoryId,
    ownerId: t.ownerId,
    startDate: t.startDate ?? "",
    note: t.note ?? "",
    tags: t.tags.map((tag) => tag.name),
  };
}

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

  it("sends only the fields the user changed", () => {
    const t = task({ title: "旧", note: "旧备注", tags: [{ id: "g1", name: "fix" }] });
    expect(diffTask(t, { ...formOf(t), title: "新" })).toEqual({ title: "新" });
  });

  it("sends nothing when the user changed nothing", () => {
    const t = task({ note: "AI 填的备注", tags: [{ id: "g1", name: "fix" }] });
    expect(diffTask(t, formOf(t))).toEqual({});
  });

  it("sends null when the user clears a field", () => {
    const t = task({ note: "旧备注" });
    expect(diffTask(t, { ...formOf(t), note: "" })).toEqual({ note: null });
  });
});

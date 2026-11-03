import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  getTask: vi.fn(),
  toggleStep: vi.fn(),
  addStep: vi.fn(),
  updateTaskPatch: vi.fn(),
  deleteStep: vi.fn(),
  addDelayNote: vi.fn(),
}));

import { getTask, updateTaskPatch } from "../../model/ipc";
import type { Task } from "../../model/types";
import {
  createTaskSheetVM,
  diffTask,
  finishPreview,
  formFinish,
  type TaskForm,
} from "../taskSheetVM";
import { task } from "./fixtures";

function formOf(t: Task): TaskForm {
  return {
    title: t.title,
    projectId: t.projectId,
    categoryId: t.categoryId,
    ownerId: t.ownerId,
    expectedStartDate: t.expectedStartDate ?? "",
    note: t.note ?? "",
    tags: t.tags.map((tag) => tag.name),
    effortMinutes: t.effortMinutes,
    priority: t.priority,
    exclusive: t.exclusive,
  };
}

describe("taskSheetVM", () => {
  it("opens a task and toggles a step", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1", status: "todo" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    expect(vm.state.task?.id).toBe("t1");
  });

  it("sends an effort change through the patch", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1" }));
    vi.mocked(updateTaskPatch).mockResolvedValue(task({ id: "t1", effortMinutes: 960 }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    const saved = await vm.saveForm({ ...formOf(task({ id: "t1" })), effortMinutes: 960 });

    expect(saved).toBe(true);
    expect(updateTaskPatch).toHaveBeenCalledWith("t1", { effortMinutes: 960 });
  });

  it("never sends a finish date, because the backend derives it", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1", expectedFinishDate: "2026-10-25" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");

    expect(diffTask(task({ id: "t1" }), formOf(task({ id: "t1" })))).toEqual({});
  });

  it("returns false and reports a failed save", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1" }));
    vi.mocked(updateTaskPatch).mockRejectedValue("boom");

    const vm = createTaskSheetVM();
    await vm.open("t1");
    const saved = await vm.saveForm({ ...formOf(task({ id: "t1" })), title: "新" });

    expect(saved).toBe(false);
    expect(vm.state.error).toBe("boom");
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

  it("sends a priority change on its own", () => {
    const t = task({ priority: "normal" });
    expect(diffTask(t, { ...formOf(t), priority: "high" })).toEqual({ priority: "high" });
  });

  it("sends an exclusive change on its own", () => {
    const t = task({ exclusive: false });
    expect(diffTask(t, { ...formOf(t), exclusive: true })).toEqual({ exclusive: true });
  });
});

describe("finishPreview", () => {
  it("keeps the stored date until the start or the estimate changes", () => {
    const t = task({ expectedFinishDate: "2026-10-23", effortMinutes: 480 });
    expect(finishPreview(t, formOf(t))).toBe("2026-10-23");
  });

  it("moves with a new estimate", () => {
    const t = task({ expectedFinishDate: "2026-10-21", effortMinutes: 480 });
    const form = { ...formOf(t), effortMinutes: 960 };
    expect(finishPreview(t, form)).toBe(formFinish(form));
    expect(finishPreview(t, form)).not.toBe("2026-10-21");
  });

  it("falls back to the derived date when the task has none", () => {
    const t = task({ expectedFinishDate: null });
    expect(finishPreview(t, formOf(t))).toBe(formFinish(formOf(t)));
  });
});

describe("formFinish", () => {
  it("shows the working day the estimate needs", () => {
    expect(formFinish({ ...formOf(task()), effortMinutes: 960 })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("counts from a later expected start", () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const form = {
      ...formOf(task()),
      expectedStartDate: `${year}-${month}-${day}`,
      effortMinutes: 480,
    };
    // A same-day start leaves a single day of work on the anchor.
    expect(formFinish(form)).toBe(`${year}-${month}-${day}`);
  });
});

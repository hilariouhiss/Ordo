import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  getTask: vi.fn(),
  toggleStep: vi.fn(),
  addStep: vi.fn(),
  updateTaskPatch: vi.fn(),
  deleteStep: vi.fn(),
  addDelayNote: vi.fn(),
  setStepEffort: vi.fn(),
  resetStepEfforts: vi.fn(),
}));

import { getTask, setStepEffort, updateTaskPatch } from "../../model/ipc";
import type { Task } from "../../model/types";
import { createTaskSheetVM, diffTask, formFinish, type TaskForm } from "../taskSheetVM";
import { step, task } from "./fixtures";

function formOf(t: Task): TaskForm {
  return {
    title: t.title,
    projectId: t.projectId,
    categoryId: t.categoryId,
    ownerId: t.ownerId,
    expectedStartDate: t.expectedStartDate ?? "",
    expectedFinishDate: t.expectedFinishDate ?? "",
    expectedFinishPicked: false,
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

  it("ignores an open whose read lands after a newer one", async () => {
    let resolveFirst!: (value: Task) => void;
    let resolveSecond!: (value: Task) => void;
    vi.mocked(getTask)
      .mockReturnValueOnce(
        new Promise<Task>((done) => {
          resolveFirst = done;
        }),
      )
      .mockReturnValueOnce(
        new Promise<Task>((done) => {
          resolveSecond = done;
        }),
      );

    const vm = createTaskSheetVM();
    const first = vm.open("t1");
    const second = vm.open("t2");
    resolveSecond(task({ id: "t2" }));
    await second;
    resolveFirst(task({ id: "t1" }));
    await first;

    expect(vm.state.task?.id).toBe("t2");
  });

  it("pins a step's share and takes the refreshed task", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1" }));
    vi.mocked(setStepEffort).mockResolvedValue(
      task({ id: "t1", steps: [step({ id: "s1", effortMinutes: 90 })] }),
    );

    const vm = createTaskSheetVM();
    await vm.open("t1");
    await vm.setStepEffort("s1", 90);

    expect(setStepEffort).toHaveBeenCalledWith("s1", 90);
    expect(vm.state.task?.steps[0].effortMinutes).toBe(90);
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

  it("sends a picked finish date and a cleared one", () => {
    const t = task({ expectedFinishDate: "2026-10-25" });

    expect(
      diffTask(t, { ...formOf(t), expectedFinishDate: "2026-10-27", expectedFinishPicked: true }),
    ).toEqual({ expectedFinishDate: "2026-10-27" });
    expect(
      diffTask(t, { ...formOf(t), expectedFinishDate: "", expectedFinishPicked: true }),
    ).toEqual({ expectedFinishDate: null });
  });

  it("does not send a finish date the sheet derived itself", () => {
    const t = task({ expectedFinishDate: "2026-10-25" });

    expect(diffTask(t, { ...formOf(t), expectedFinishDate: "2026-10-27" })).toEqual({});
  });

  it("patches one actual time and takes the refreshed task", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1" }));
    vi.mocked(updateTaskPatch).mockResolvedValue(
      task({ id: "t1", actualStartAt: "2026-10-20T07:00:00Z" }),
    );

    const vm = createTaskSheetVM();
    await vm.open("t1");
    await vm.patch({ actualStartAt: "2026-10-20T07:00:00Z" });

    expect(updateTaskPatch).toHaveBeenCalledWith("t1", {
      actualStartAt: "2026-10-20T07:00:00Z",
    });
    expect(vm.state.task?.actualStartAt).toBe("2026-10-20T07:00:00Z");
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

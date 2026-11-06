import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  getTask: vi.fn(),
  toggleStep: vi.fn(),
  addStep: vi.fn(),
  updateTaskPatch: vi.fn(),
  deleteStep: vi.fn(),
  addDelayNote: vi.fn(),
  setStepEffort: vi.fn(),
  setTaskStatus: vi.fn(),
}));

import {
  addDelayNote,
  addStep,
  deleteStep,
  getTask,
  setStepEffort,
  setTaskStatus,
  toggleStep,
  updateTaskPatch,
} from "../../model/ipc";
import type { Task } from "../../model/types";
import {
  createTaskSheetVM,
  diffTask,
  formFinish,
  syncActualPreview,
  type TaskForm,
} from "../taskSheetVM";
import { localDate, localTime, stampOfLocal } from "../../lib/dates";
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
    status: t.status,
    actualStartDate: t.actualStartAt ? localDate(t.actualStartAt) : "",
    actualStartTime: localTime(t.actualStartAt) || "09:00",
    actualFinishDate: t.actualFinishAt ? localDate(t.actualFinishAt) : "",
    actualFinishTime: localTime(t.actualFinishAt) || "09:00",
    actualEffortMinutes: t.actualEffortMinutes ?? 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("returns false and reports a failed save", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1" }));
    vi.mocked(updateTaskPatch).mockRejectedValue("boom");

    const vm = createTaskSheetVM();
    await vm.open("t1");
    const saved = await vm.saveSheet({
      form: { ...formOf(task({ id: "t1" })), title: "新" },
      steps: [],
      note: "",
    });

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

describe("actual times in the draft", () => {
  it("keeps running actuals out of the patch", () => {
    const t = task({
      actualStartAt: "2026-10-19T01:00:37Z",
      actualFinishAt: "2026-10-19T03:00:07Z",
      actualEffortMinutes: 120,
    });

    expect(diffTask(t, formOf(t))).toEqual({});
  });

  it("sends only the actual field that moved", () => {
    const t = task();
    const patch = diffTask(t, {
      ...formOf(t),
      actualStartDate: "2026-10-19",
      actualStartTime: "09:00",
    });

    expect(Object.keys(patch)).toEqual(["actualStartAt"]);
    expect(patch.actualStartAt).toBe(stampOfLocal("2026-10-19", "09:00"));
  });

  it("clears the finish and the effort together", () => {
    const t = task({
      actualStartAt: "2026-10-19T01:00:00Z",
      actualFinishAt: "2026-10-19T03:00:00Z",
      actualEffortMinutes: 120,
    });

    expect(diffTask(t, { ...formOf(t), actualFinishDate: "", actualEffortMinutes: 0 })).toEqual({
      actualFinishAt: null,
      actualEffortMinutes: null,
    });
  });
});

describe("syncActualPreview", () => {
  const withStart = () => ({
    ...formOf(task()),
    actualStartDate: "2026-10-19",
    actualStartTime: "09:00",
  });

  it("moves the finish when the effort changes", () => {
    const form = { ...withStart(), actualEffortMinutes: 90 };

    expect(syncActualPreview(form, "effort")).toBeNull();
    expect(form.actualFinishDate).toBe("2026-10-19");
    expect(form.actualFinishTime).toBe("10:30");
  });

  it("reads the effort from the finish", () => {
    const form = { ...withStart(), actualFinishDate: "2026-10-19", actualFinishTime: "11:30" };

    expect(syncActualPreview(form, "finish")).toBeNull();
    expect(form.actualEffortMinutes).toBe(150);
  });

  it("refuses a finish without an actual start", () => {
    const form = {
      ...formOf(task()),
      actualFinishDate: "2026-10-19",
      actualFinishTime: "11:30",
    };

    expect(syncActualPreview(form, "finish")).toBe("actual_start_required");
    expect(form.actualEffortMinutes).toBe(0);
  });

  it("refuses a finish before the start", () => {
    const form = { ...withStart(), actualFinishDate: "2026-10-18", actualFinishTime: "11:30" };

    expect(syncActualPreview(form, "finish")).toBe("finish_before_start");
  });

  it("clears the effort when the finish goes away", () => {
    const form = { ...withStart(), actualEffortMinutes: 90 };

    expect(syncActualPreview(form, "finish")).toBeNull();
    expect(form.actualEffortMinutes).toBe(0);
  });

  it("re-reads the effort when the start moves", () => {
    const form = {
      ...withStart(),
      actualStartTime: "10:30",
      actualFinishDate: "2026-10-19",
      actualFinishTime: "11:30",
    };

    expect(syncActualPreview(form, "start")).toBeNull();
    expect(form.actualEffortMinutes).toBe(60);
  });
});

describe("saveSheet", () => {
  it("writes the steps before the fields", async () => {
    const original = task({ id: "t1", steps: [step({ id: "s1" })] });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(toggleStep).mockResolvedValue(
      task({ id: "t1", steps: [step({ id: "s1", done: true })] }),
    );
    vi.mocked(updateTaskPatch).mockResolvedValue(task({ id: "t1", title: "新" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    const saved = await vm.saveSheet({
      form: { ...formOf(original), title: "新" },
      steps: [step({ id: "s1", done: true })],
      note: "",
    });

    expect(saved).toBe(true);
    expect(toggleStep).toHaveBeenCalledWith("s1");
    expect(updateTaskPatch).toHaveBeenCalledWith("t1", { title: "新" });
    expect(vi.mocked(toggleStep).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(updateTaskPatch).mock.invocationCallOrder[0],
    );
  });

  it("adds a step the sheet created and pins its share", async () => {
    const original = task({ id: "t1" });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(addStep).mockResolvedValue(
      task({ id: "t1", steps: [step({ id: "s9", title: "新步骤" })] }),
    );
    vi.mocked(setStepEffort).mockResolvedValue(
      task({ id: "t1", steps: [step({ id: "s9", title: "新步骤", effortMinutes: 90 })] }),
    );

    const vm = createTaskSheetVM();
    await vm.open("t1");
    const saved = await vm.saveSheet({
      form: formOf(original),
      steps: [step({ id: "new-1", title: "新步骤", effortMinutes: 90 })],
      note: "",
    });

    expect(saved).toBe(true);
    expect(addStep).toHaveBeenCalledWith("t1", "新步骤");
    expect(setStepEffort).toHaveBeenCalledWith("s9", 90);
  });

  it("removes a step the sheet dropped", async () => {
    const original = task({ id: "t1", steps: [step({ id: "s1" }), step({ id: "s2" })] });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(deleteStep).mockResolvedValue(task({ id: "t1", steps: [step({ id: "s2" })] }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    const saved = await vm.saveSheet({
      form: formOf(original),
      steps: [step({ id: "s2" })],
      note: "",
    });

    expect(saved).toBe(true);
    expect(deleteStep).toHaveBeenCalledWith("s1");
    expect(toggleStep).not.toHaveBeenCalled();
  });

  it("sends the drafted status when the task has no steps", async () => {
    const original = task({ id: "t1" });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(setTaskStatus).mockResolvedValue(task({ id: "t1", status: "done" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    await vm.saveSheet({ form: { ...formOf(original), status: "done" }, steps: [], note: "" });

    expect(setTaskStatus).toHaveBeenCalledWith("t1", "done");
  });

  it("records the overdue note with the save", async () => {
    const original = task({ id: "t1" });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(addDelayNote).mockResolvedValue(original);

    const vm = createTaskSheetVM();
    await vm.open("t1");
    await vm.saveSheet({ form: formOf(original), steps: [], note: "等客户回复" });

    expect(addDelayNote).toHaveBeenCalledWith("t1", "等客户回复");
  });

  it("writes nothing when the sheet was not touched", async () => {
    const original = task({ id: "t1", steps: [step({ id: "s1", done: true })] });
    vi.mocked(getTask).mockResolvedValue(original);

    const vm = createTaskSheetVM();
    await vm.open("t1");
    const saved = await vm.saveSheet({
      form: formOf(original),
      steps: [step({ id: "s1", done: true })],
      note: "",
    });

    expect(saved).toBe(true);
    expect(updateTaskPatch).not.toHaveBeenCalled();
    expect(toggleStep).not.toHaveBeenCalled();
    expect(addStep).not.toHaveBeenCalled();
    expect(deleteStep).not.toHaveBeenCalled();
    expect(setTaskStatus).not.toHaveBeenCalled();
    expect(addDelayNote).not.toHaveBeenCalled();
  });

  it("stops at the first failure and keeps the draft", async () => {
    const original = task({ id: "t1", steps: [step({ id: "s1" })] });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(toggleStep).mockRejectedValue("boom");

    const vm = createTaskSheetVM();
    await vm.open("t1");
    const saved = await vm.saveSheet({
      form: { ...formOf(original), title: "新" },
      steps: [step({ id: "s1", done: true })],
      note: "",
    });

    expect(saved).toBe(false);
    expect(vm.state.error).toBe("boom");
    expect(updateTaskPatch).not.toHaveBeenCalled();
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

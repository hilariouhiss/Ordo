import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  getTask: vi.fn(),
  updateTaskPatch: vi.fn(),
  addDelayNote: vi.fn(),
  setTaskStatus: vi.fn(),
}));

import { addDelayNote, getTask, setTaskStatus, updateTaskPatch } from "../../model/ipc";
import { isoOf, stampOfLocal } from "../../lib/dates";
import { createTaskSheetVM, diffTask, formFinish, formOf, syncActualPreview } from "../taskSheetVM";
import { task } from "./fixtures";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("taskSheetVM", () => {
  it("opens a task and seeds its draft", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1", title: "交底", status: "todo" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");

    expect(vm.state.task?.id).toBe("t1");
    expect(vm.state.form?.title).toBe("交底");
  });

  it("ignores an open whose read lands after a newer one", async () => {
    let resolveFirst!: (value: ReturnType<typeof task>) => void;
    let resolveSecond!: (value: ReturnType<typeof task>) => void;
    vi.mocked(getTask)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveFirst = done;
        }),
      )
      .mockReturnValueOnce(
        new Promise((done) => {
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

  it("keeps the parent draft across a subtask and refreshes its derived fields", async () => {
    const parent = task({
      id: "t1",
      effortMinutes: 480,
      children: [task({ id: "s1", parentId: "t1", title: "收集" })],
    });
    vi.mocked(getTask)
      .mockResolvedValueOnce(parent)
      .mockResolvedValueOnce(task({ id: "s1", parentId: "t1", title: "收集", parentTitle: "父" }))
      .mockResolvedValueOnce(task({ ...parent, effortMinutes: 960 }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.form!.title = "改过的标题";

    await vm.drill("s1");
    expect(vm.state.form?.title).toBe("收集");
    expect(vm.state.stack).toHaveLength(1);

    await vm.back();
    expect(vm.state.task?.id).toBe("t1");
    expect(vm.state.form?.title).toBe("改过的标题");
    expect(vm.state.form?.effortMinutes).toBe(960);
    expect(vm.state.stack).toHaveLength(0);
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

  it("keeps a parent's derived fields out of the patch", () => {
    const parent = task({
      id: "t1",
      effortMinutes: 480,
      children: [task({ id: "s1", parentId: "t1" })],
    });
    const form = {
      ...formOf(parent),
      title: "新",
      effortMinutes: 60,
      expectedFinishDate: "2026-12-01",
      expectedFinishPicked: true,
      actualFinishDate: "2026-10-20",
      actualEffortMinutes: 30,
    };

    expect(diffTask(parent, form)).toEqual({ title: "新" });
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
  it("sends the drafted status before the fields", async () => {
    const original = task({ id: "t1", status: "todo" });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(setTaskStatus).mockResolvedValue(task({ id: "t1", status: "done" }));
    vi.mocked(updateTaskPatch).mockResolvedValue(task({ id: "t1", title: "新" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.form!.title = "新";
    vm.state.form!.status = "done";
    const saved = await vm.saveSheet();

    expect(saved).toBe(true);
    expect(setTaskStatus).toHaveBeenCalledWith("t1", "done");
    expect(updateTaskPatch).toHaveBeenCalledWith("t1", { title: "新" });
    expect(vi.mocked(setTaskStatus).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(updateTaskPatch).mock.invocationCallOrder[0],
    );
  });

  it("leaves the status of a task with subtasks to its children", async () => {
    const parent = task({
      id: "t1",
      status: "doing",
      children: [task({ id: "s1", parentId: "t1" })],
    });
    vi.mocked(getTask).mockResolvedValue(parent);

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.form!.status = "done";
    await vm.saveSheet();

    expect(setTaskStatus).not.toHaveBeenCalled();
    expect(updateTaskPatch).not.toHaveBeenCalled();
  });

  it("records the overdue note with the save", async () => {
    const original = task({ id: "t1" });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(addDelayNote).mockResolvedValue(original);

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.note = "等客户回复";
    await vm.saveSheet();

    expect(addDelayNote).toHaveBeenCalledWith("t1", "等客户回复");
  });

  it("writes nothing when the sheet was not touched", async () => {
    const original = task({ id: "t1" });
    vi.mocked(getTask).mockResolvedValue(original);

    const vm = createTaskSheetVM();
    await vm.open("t1");
    const saved = await vm.saveSheet();

    expect(saved).toBe(true);
    expect(updateTaskPatch).not.toHaveBeenCalled();
    expect(setTaskStatus).not.toHaveBeenCalled();
    expect(addDelayNote).not.toHaveBeenCalled();
  });

  it("reports a failed save and keeps the draft", async () => {
    const original = task({ id: "t1" });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(updateTaskPatch).mockRejectedValue("boom");

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.form!.title = "新";
    const saved = await vm.saveSheet();

    expect(saved).toBe(false);
    expect(vm.state.error).toBe("boom");
    expect(vm.state.form?.title).toBe("新");
  });
});

describe("formFinish", () => {
  it("shows the working day the estimate needs", () => {
    expect(formFinish({ ...formOf(task()), effortMinutes: 960 })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("counts from a later expected start", () => {
    // A Monday a week out, so the assertion holds on any weekday the suite runs.
    const start = new Date();
    start.setDate(start.getDate() + 7);
    while (start.getDay() !== 1) start.setDate(start.getDate() + 1);
    const monday = isoOf(start);
    const form = { ...formOf(task()), expectedStartDate: monday, effortMinutes: 480 };

    // A same-day start leaves a single day of work on the anchor.
    expect(formFinish(form)).toBe(monday);
  });
});

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  getTask: vi.fn(),
  updateTaskPatch: vi.fn(),
  addDelayNote: vi.fn(),
  setTaskStatus: vi.fn(),
  addMember: vi.fn(),
  addSubtask: vi.fn(),
  archiveTask: vi.fn(),
  deleteSubtask: vi.fn(),
  reorderSubtasks: vi.fn(),
  ownerCandidates: vi.fn().mockResolvedValue([]),
  listRequirements: vi.fn().mockResolvedValue([]),
  setDelayReason: vi.fn(),
  deferTask: vi.fn(),
  unarchiveTask: vi.fn(),
  parkTask: vi.fn(),
  resumeTask: vi.fn(),
}));

import {
  addDelayNote,
  addMember,
  addSubtask,
  deferTask,
  getTask,
  parkTask,
  reorderSubtasks,
  resumeTask,
  setTaskStatus,
  updateTaskPatch,
} from "../../model/ipc";
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

  it("defers the open task and follows the new dates", async () => {
    const before = task({ id: "t1", expectedFinishDate: "2026-10-09", effortMinutes: 240 });
    const after = task({
      id: "t1",
      expectedFinishDate: "2026-11-25",
      effortMinutes: 27 * 480,
    });
    vi.mocked(getTask).mockResolvedValue(before);
    vi.mocked(deferTask).mockResolvedValue(after);

    const vm = createTaskSheetVM();
    await vm.open("t1");
    await vm.defer("2026-11-25", "等甲方");

    expect(deferTask).toHaveBeenCalledWith("t1", "2026-11-25", "等甲方");
    expect(vm.state.task?.expectedFinishDate).toBe("2026-11-25");
    expect(vm.state.form?.expectedFinishDate).toBe("2026-11-25");
    expect(vm.state.form?.effortMinutes).toBe(27 * 480);
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

  it("drops the previous draft when the next open fails", async () => {
    vi.mocked(getTask)
      .mockResolvedValueOnce(task({ id: "t1", title: "旧的" }))
      .mockRejectedValueOnce("task_not_found");

    const vm = createTaskSheetVM();
    await vm.open("t1");
    await vm.open("gone");

    expect(vm.state.task).toBeNull();
    expect(vm.state.form).toBeNull();
    expect(vm.state.error).toBe("task_not_found");
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

describe("the park draft", () => {
  it("parks the open task when the draft says so", async () => {
    const original = task({ id: "t1", status: "doing" });
    vi.mocked(getTask).mockResolvedValue(original);
    vi.mocked(parkTask).mockResolvedValue(task({ id: "t1", status: "doing", parked: true }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.setPark({ reason: "等甲方", until: "2026-11-02", personId: null });
    expect(parkTask).not.toHaveBeenCalled();

    const saved = await vm.saveSheet();

    expect(saved).toBe(true);
    expect(parkTask).toHaveBeenCalledWith("t1", "2026-11-02", "等甲方", null);
    expect(setTaskStatus).not.toHaveBeenCalled();
    expect(vm.state.task?.parked).toBe(true);
    expect(vm.state.form?.parked).toBe(true);
  });

  it("resumes a parked task only when the sheet is saved", async () => {
    const parked = task({
      id: "t1",
      status: "doing",
      parked: true,
      parkedAt: "2026-10-18",
      parkUntil: "2026-11-02",
      parkReason: "等甲方",
    });
    vi.mocked(getTask).mockResolvedValue(parked);
    vi.mocked(resumeTask).mockResolvedValue(task({ id: "t1", status: "doing" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.selectStatus("doing");

    expect(resumeTask).not.toHaveBeenCalled();

    const saved = await vm.saveSheet();

    expect(saved).toBe(true);
    expect(resumeTask).toHaveBeenCalledWith("t1");
    expect(parkTask).not.toHaveBeenCalled();
    expect(setTaskStatus).not.toHaveBeenCalled();
    expect(vm.state.form?.parked).toBe(false);
  });

  it("completing a parked draft lets the status clear the park", async () => {
    const parked = task({
      id: "t1",
      status: "doing",
      parked: true,
      parkUntil: "2026-11-02",
    });
    vi.mocked(getTask).mockResolvedValue(parked);
    vi.mocked(setTaskStatus).mockResolvedValue(task({ id: "t1", status: "done" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.selectStatus("done");
    await vm.saveSheet();

    expect(setTaskStatus).toHaveBeenCalledWith("t1", "done");
    expect(resumeTask).not.toHaveBeenCalled();
  });

  it("re-parks when the draft changes the park details", async () => {
    const parked = task({
      id: "t1",
      status: "doing",
      parked: true,
      parkUntil: "2026-11-02",
      parkReason: "等甲方",
      parkedOnId: null,
    });
    vi.mocked(getTask).mockResolvedValue(parked);
    vi.mocked(parkTask).mockResolvedValue(
      task({ id: "t1", status: "doing", parked: true, parkUntil: "2026-11-05" }),
    );

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.setPark({ reason: "等甲方", until: "2026-11-05", personId: null });
    await vm.saveSheet();

    expect(parkTask).toHaveBeenCalledWith("t1", "2026-11-05", "等甲方", null);
    expect(resumeTask).not.toHaveBeenCalled();
  });

  it("does not write a park the draft did not touch", async () => {
    const parked = task({
      id: "t1",
      status: "doing",
      parked: true,
      parkUntil: "2026-11-02",
      parkReason: "等甲方",
    });
    vi.mocked(getTask).mockResolvedValue(parked);

    const vm = createTaskSheetVM();
    await vm.open("t1");
    await vm.saveSheet();

    expect(parkTask).not.toHaveBeenCalled();
    expect(resumeTask).not.toHaveBeenCalled();
  });
});

describe("save", () => {
  it("adds a picked owner to the project before landing the patch", async () => {
    vi.mocked(getTask).mockResolvedValue(task({ id: "t1", projectId: "p1", ownerId: null }));
    vi.mocked(updateTaskPatch).mockResolvedValue(task({ id: "t1", projectId: "p1" }));

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.form!.ownerId = "u2";
    const saved = await vm.save();

    expect(saved).toBe(true);
    expect(addMember).toHaveBeenCalledWith("p1", "u2", null);
    expect(vi.mocked(addMember).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(updateTaskPatch).mock.invocationCallOrder[0],
    );
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

  it("refuses to half-apply a status change when the actual pair is invalid", async () => {
    const original = task({ id: "t1", status: "doing", actualStartAt: "2026-10-20T02:00:00Z" });
    vi.mocked(getTask).mockResolvedValue(original);

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.form!.status = "done";
    vm.state.form!.actualFinishDate = "2026-10-19";
    const saved = await vm.saveSheet();

    expect(saved).toBe(false);
    expect(vm.state.error).toBe("finish_before_start");
    expect(setTaskStatus).not.toHaveBeenCalled();
    expect(updateTaskPatch).not.toHaveBeenCalled();
  });

  it("still saves a finished task that never recorded an actual start", async () => {
    const finished = task({
      id: "t1",
      status: "done",
      actualFinishAt: "2026-10-20T09:00:00Z",
      actualEffortMinutes: 480,
    });
    vi.mocked(getTask).mockResolvedValue(finished);
    vi.mocked(updateTaskPatch).mockResolvedValue({ ...finished, title: "新" });

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.form!.title = "新";
    const saved = await vm.saveSheet();

    expect(saved).toBe(true);
    expect(updateTaskPatch).toHaveBeenCalledWith("t1", { title: "新" });
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

  it("still clears the effort of a finished task that never recorded a start", async () => {
    const finished = task({
      id: "t1",
      status: "done",
      actualFinishAt: "2026-10-20T09:00:00Z",
      actualEffortMinutes: 480,
    });
    vi.mocked(getTask).mockResolvedValue(finished);
    vi.mocked(updateTaskPatch).mockResolvedValue({ ...finished, actualEffortMinutes: null });

    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.form!.actualEffortMinutes = 0;
    const saved = await vm.saveSheet();

    expect(saved).toBe(true);
    expect(updateTaskPatch).toHaveBeenCalledWith("t1", { actualEffortMinutes: null });
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

describe("subtask order draft", () => {
  function parent() {
    return task({
      id: "t1",
      children: [
        task({ id: "s1", parentId: "t1" }),
        task({ id: "s2", parentId: "t1" }),
        task({ id: "s3", parentId: "t1" }),
      ],
    });
  }

  it("moves a subtask locally without writing", async () => {
    vi.mocked(getTask).mockResolvedValue(parent());
    const vm = createTaskSheetVM();
    await vm.open("t1");

    vm.moveSubtask("s3", "s1");

    expect(vm.state.childOrder).toEqual(["s3", "s1", "s2"]);
    expect(reorderSubtasks).not.toHaveBeenCalled();
  });

  it("writes the draft order when the sheet is saved", async () => {
    const before = parent();
    vi.mocked(getTask).mockResolvedValue(before);
    vi.mocked(reorderSubtasks).mockResolvedValue(
      task({
        ...before,
        children: [before.children[2], before.children[0], before.children[1]],
      }),
    );
    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.moveSubtask("s3", "s1");

    const saved = await vm.saveSheet();

    expect(saved).toBe(true);
    expect(reorderSubtasks).toHaveBeenCalledWith("t1", ["s3", "s1", "s2"]);
    expect(vm.state.task?.children.map((child) => child.id)).toEqual(["s3", "s1", "s2"]);
  });

  it("does not write an order that did not move", async () => {
    vi.mocked(getTask).mockResolvedValue(parent());
    const vm = createTaskSheetVM();
    await vm.open("t1");
    await vm.saveSheet();

    expect(reorderSubtasks).not.toHaveBeenCalled();
  });

  it("keeps the draft order across a drill and back", async () => {
    const before = parent();
    vi.mocked(getTask)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(task({ id: "s1", parentId: "t1", title: "收集" }))
      .mockResolvedValueOnce(before);
    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.moveSubtask("s3", "s1");

    await vm.drill("s1");
    await vm.back();

    expect(vm.state.childOrder).toEqual(["s3", "s1", "s2"]);
  });

  it("keeps the draft order when a subtask change refreshes the parent", async () => {
    const before = parent();
    const child = before.children[1];
    vi.mocked(getTask).mockResolvedValueOnce(before).mockResolvedValueOnce(before);
    vi.mocked(setTaskStatus).mockResolvedValue(child);
    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.moveSubtask("s3", "s1");

    await vm.toggleSubtask(child);

    expect(vm.state.childOrder).toEqual(["s3", "s1", "s2"]);
  });

  it("keeps the draft and reports a stale order", async () => {
    vi.mocked(getTask).mockResolvedValue(parent());
    vi.mocked(reorderSubtasks).mockRejectedValue("subtasks_changed");
    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.moveSubtask("s3", "s1");

    const saved = await vm.saveSheet();

    expect(saved).toBe(false);
    expect(vm.state.error).toBe("subtasks_changed");
    expect(vm.state.childOrder).toEqual(["s3", "s1", "s2"]);
  });
});

describe("new subtask plan", () => {
  it("takes the parent's unsaved plan for the first child", async () => {
    const parent = task({
      id: "t1",
      expectedStartDate: "2026-10-19",
      expectedFinishDate: "2026-10-20",
      effortMinutes: 480,
    });
    vi.mocked(getTask).mockResolvedValue(parent);
    vi.mocked(addSubtask).mockResolvedValue(
      task({ id: "t1", children: [task({ id: "s1", parentId: "t1" })] }),
    );
    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.state.form!.expectedStartDate = "2026-10-21";
    vm.state.form!.expectedFinishDate = "2026-10-22";
    vm.state.form!.effortMinutes = 960;

    await vm.submitSubtask("第一步");

    expect(addSubtask).toHaveBeenCalledWith("t1", "第一步", {
      expectedStartDate: "2026-10-21",
      expectedFinishDate: "2026-10-22",
      effortMinutes: 960,
    });
  });

  it("copies the last child in the draft order", async () => {
    const parent = task({
      id: "t1",
      expectedStartDate: "2026-10-19",
      children: [
        task({
          id: "s1",
          parentId: "t1",
          effortMinutes: 120,
          expectedFinishDate: "2026-10-22",
        }),
        task({
          id: "s2",
          parentId: "t1",
          effortMinutes: 60,
          expectedFinishDate: "2026-10-23",
        }),
      ],
    });
    vi.mocked(getTask).mockResolvedValue(parent);
    vi.mocked(addSubtask).mockResolvedValue(parent);
    const vm = createTaskSheetVM();
    await vm.open("t1");
    vm.moveSubtask("s2", "s1");

    await vm.submitSubtask("第三步");

    expect(addSubtask).toHaveBeenCalledWith("t1", "第三步", {
      expectedStartDate: "2026-10-19",
      expectedFinishDate: "2026-10-22",
      effortMinutes: 120,
    });
  });
});

describe("task requirement link", () => {
  it("sends a changed requirement link in the patch", () => {
    const before = task({ id: "t1", projectId: "p1" });
    const form = { ...formOf(before), requirementId: "r1" };

    expect(diffTask(before, form)).toEqual({ requirementId: "r1" });
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

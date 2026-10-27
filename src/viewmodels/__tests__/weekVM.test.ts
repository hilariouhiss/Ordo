import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  aiEnrich: vi.fn(),
  bootstrap: vi.fn(),
  capture: vi.fn(),
  listWeek: vi.fn(),
  listSuspended: vi.fn(),
  weekStats: vi.fn(),
  resumeTask: vi.fn(),
  markNotificationsSeen: vi.fn(),
  moveTask: vi.fn(),
}));

import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { mondayOf, todayIso } from "../../lib/dates";
import { closeDialog, dialogRequest } from "../../lib/dialog";
import { capture, listSuspended, listWeek, moveTask, weekStats } from "../../model/ipc";
import type { Task } from "../../model/types";
import { appVM } from "../appVM";
import { createWeekVM } from "../weekVM";
import { defaultSettings, task } from "./fixtures";

describe("weekVM", () => {
  afterEach(() => closeDialog(null));

  it("capture stores the task and clears the draft", async () => {
    vi.mocked(listWeek)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([task({ id: "t1", title: "周五前把软件方案评审发老李" })]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 1, done: 0, delayed: 0 });
    vi.mocked(capture).mockResolvedValue(task({ id: "t1", title: "周五前把软件方案评审发老李" }));

    const vm = createWeekVM();
    await vm.load();
    vm.state.draft = "周五前把软件方案评审发老李";
    await vm.capture({
      raw: vm.state.draft,
      title: vm.state.draft,
      fields: CAPTURE_DEFAULTS,
    });

    expect(capture).toHaveBeenCalledWith("周五前把软件方案评审发老李", CAPTURE_DEFAULTS);
    expect(vm.state.tasks[0].id).toBe("t1");
    expect(vm.state.draft).toBe("");
  });

  it("ignores a blank draft", async () => {
    const vm = createWeekVM();
    await vm.capture({ raw: "   ", title: "   ", fields: CAPTURE_DEFAULTS });
    expect(capture).not.toHaveBeenCalled();
  });

  it("shows a notice when the backend rejects the capture", async () => {
    vi.mocked(capture).mockRejectedValueOnce("invalid_project");
    const vm = createWeekVM();
    vm.state.draft = "交底";

    await vm.capture({ raw: vm.state.draft, title: "交底", fields: CAPTURE_DEFAULTS });

    expect(dialogRequest.value?.kind).toBe("notice");
    expect(vm.state.draft).toBe("交底");
  });

  it("ignores a repeated submit while one is in flight", async () => {
    let resolve!: (value: Task) => void;
    vi.mocked(capture).mockReturnValue(
      new Promise<Task>((done) => {
        resolve = done;
      }),
    );
    vi.mocked(listWeek).mockResolvedValue([]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });

    const vm = createWeekVM();
    const first = vm.capture({ raw: "交底", title: "交底", fields: CAPTURE_DEFAULTS });
    const second = vm.capture({ raw: "交底", title: "交底", fields: CAPTURE_DEFAULTS });
    resolve(task({ id: "t1" }));
    await Promise.all([first, second]);

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("move sends the drop anchor and takes the returned order", async () => {
    vi.mocked(moveTask).mockResolvedValue([task({ id: "t2" }), task({ id: "t1" })]);

    const vm = createWeekVM();
    await vm.move("t2", "t1");

    expect(moveTask).toHaveBeenCalledWith("t2", "t1");
    expect(vm.state.tasks.map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("moveBy anchors on the neighbour it passes", async () => {
    vi.mocked(listWeek).mockResolvedValue([
      task({ id: "t1" }),
      task({ id: "t2" }),
      task({ id: "t3" }),
    ]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    const vm = createWeekVM();
    await vm.load();

    vi.mocked(moveTask).mockResolvedValue([
      task({ id: "t2" }),
      task({ id: "t1" }),
      task({ id: "t3" }),
    ]);
    await vm.moveBy("t2", -1);
    expect(moveTask).toHaveBeenCalledWith("t2", "t1");

    vi.mocked(moveTask).mockClear();
    await vm.moveBy("t3", 1);
    expect(moveTask).not.toHaveBeenCalled();
  });
});

describe("weekVM plan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0, 0));
  });

  afterEach(() => {
    closeDialog(null);
    vi.useRealTimers();
  });

  async function loadedWith(tasks: Task[]) {
    vi.mocked(listWeek).mockResolvedValue(tasks);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    const vm = createWeekVM();
    await vm.load();
    return vm;
  }

  it("keeps parallel tasks on the day they start", async () => {
    const vm = await loadedWith([
      task({ id: "a", effortDays: 0.5 }),
      task({ id: "b", effortDays: 0.5 }),
      task({ id: "c", effortDays: 1 }),
    ]);

    expect(vm.days.value).toHaveLength(1);
    expect(vm.days.value[0].date).toBe("2026-10-20");
    expect(vm.days.value[0].weekday).toBe("周二");
    expect(vm.days.value[0].rows.map((row) => row.task.id)).toEqual(["a", "b", "c"]);
    expect(vm.days.value[0].isToday).toBe(true);
    expect(vm.planEnd.value).toBe("2026-10-20");
  });

  it("keeps a spanning task under its start day and shows where it ends", async () => {
    const vm = await loadedWith([task({ id: "a", effortDays: 2 })]);

    expect(vm.days.value).toHaveLength(1);
    expect(vm.days.value[0].rows[0].spans).toBe(true);
    expect(vm.days.value[0].rows[0].end).toBe("2026-10-21");
  });

  it("counts a finish after the due date, not one on it", async () => {
    const vm = await loadedWith([
      task({ id: "late", dueDate: "2026-10-19" }),
      task({ id: "fit", dueDate: "2026-10-21" }),
    ]);

    expect(vm.conflictCount.value).toBe(1);
    expect(vm.days.value[0].rows[0].conflict).toBe(true);
    expect(vm.days.value[0].rows[1].conflict).toBe(false);
  });

  it("uses the task's own start date", async () => {
    const vm = await loadedWith([task({ id: "a", startDate: "2026-10-22" })]);

    expect(vm.days.value[0].date).toBe("2026-10-22");
    expect(vm.days.value[0].isToday).toBe(false);
    expect(vm.planEnd.value).toBe("2026-10-22");
  });

  it("pushes shared work behind an exclusive task", async () => {
    const vm = await loadedWith([task({ id: "x", exclusive: true }), task({ id: "s" })]);

    expect(vm.days.value.map((day) => day.date)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(vm.days.value[0].rows.map((row) => row.task.id)).toEqual(["x"]);
    expect(vm.days.value[1].rows.map((row) => row.task.id)).toEqual(["s"]);
  });

  it("queues two exclusive tasks on separate days", async () => {
    const vm = await loadedWith([
      task({ id: "x1", exclusive: true }),
      task({ id: "x2", exclusive: true }),
    ]);

    expect(vm.days.value.map((day) => day.date)).toEqual(["2026-10-20", "2026-10-21"]);
  });

  it("takes the latest finish as the plan end", async () => {
    const vm = await loadedWith([task({ id: "a" }), task({ id: "b", effortDays: 3 })]);

    expect(vm.planEnd.value).toBe("2026-10-22");
  });

  it("warns when a day stacks more than two person-days", async () => {
    const vm = await loadedWith([task({ id: "a" }), task({ id: "b" }), task({ id: "c" })]);

    expect(vm.overloadDates.value).toEqual(["2026-10-20"]);
  });

  it("stays quiet at exactly two person-days", async () => {
    const vm = await loadedWith([task({ id: "a" }), task({ id: "b" })]);

    expect(vm.overloadDates.value).toEqual([]);
  });

  it("warns when a capture lands on exclusive time", async () => {
    const blocker = task({ id: "x", title: "出差", exclusive: true });
    const added = task({ id: "n", title: "新任务" });
    vi.mocked(listWeek).mockResolvedValueOnce([blocker]).mockResolvedValueOnce([blocker, added]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    vi.mocked(capture).mockResolvedValue(added);

    const vm = createWeekVM();
    await vm.load();
    await vm.capture({ raw: "新任务", title: "新任务", fields: CAPTURE_DEFAULTS });

    expect(dialogRequest.value?.kind).toBe("notice");
  });

  it("has no plan for an empty week", async () => {
    const vm = await loadedWith([]);

    expect(vm.days.value).toEqual([]);
    expect(vm.planEnd.value).toBeNull();
    expect(vm.conflictCount.value).toBe(0);
  });
});

describe("weekVM pass entry", () => {
  afterEach(() => {
    appVM.state.settings = null;
  });

  it("shows the pass entry after a capture into an empty week", async () => {
    vi.mocked(listWeek)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([task({ id: "t1" })]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 1, done: 0, delayed: 0 });
    vi.mocked(capture).mockResolvedValue(task({ id: "t1" }));
    appVM.state.settings = { ...defaultSettings, lastPassWeek: "" };

    const vm = createWeekVM();
    await vm.load();
    expect(vm.passNeeded.value).toBe(false);

    await vm.capture({ raw: "交底", title: "交底", fields: CAPTURE_DEFAULTS });
    expect(vm.passNeeded.value).toBe(true);
  });

  it("hides the pass entry once this week's pass is recorded", async () => {
    vi.mocked(listWeek).mockResolvedValue([task({ id: "t1" })]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    appVM.state.settings = { ...defaultSettings, lastPassWeek: mondayOf(todayIso()) };

    const vm = createWeekVM();
    await vm.load();
    expect(vm.passNeeded.value).toBe(false);
  });
});

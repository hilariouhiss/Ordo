import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  aiEnrich: vi.fn(),
  capture: vi.fn(),
  listWeek: vi.fn(),
  listSuspended: vi.fn(),
  weekStats: vi.fn(),
  resumeTask: vi.fn(),
  markNotificationsSeen: vi.fn(),
  moveTask: vi.fn(),
}));

import { capture, listSuspended, listWeek, moveTask, weekStats } from "../../model/ipc";
import type { Task } from "../../model/types";
import { createWeekVM } from "../weekVM";
import { task } from "./fixtures";

describe("weekVM", () => {
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
    await vm.capture(vm.state.draft);

    expect(vm.state.tasks[0].id).toBe("t1");
    expect(vm.state.draft).toBe("");
  });

  it("ignores a blank draft", async () => {
    const vm = createWeekVM();
    await vm.capture("   ");
    expect(capture).not.toHaveBeenCalled();
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

  it("groups tasks under the day they are planned to start", async () => {
    const vm = await loadedWith([
      task({ id: "a", effortDays: 0.5 }),
      task({ id: "b", effortDays: 0.5 }),
      task({ id: "c", effortDays: 1 }),
    ]);

    expect(vm.days.value.map((day) => day.date)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(vm.days.value[0].weekday).toBe("周二");
    expect(vm.days.value[0].rows.map((row) => row.task.id)).toEqual(["a", "b"]);
    expect(vm.days.value[0].isToday).toBe(true);
    expect(vm.days.value[1].isToday).toBe(false);
    expect(vm.planEnd.value).toBe("2026-10-21");
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
    expect(vm.days.value[1].rows[0].conflict).toBe(false);
  });

  it("has no plan for an empty week", async () => {
    const vm = await loadedWith([]);

    expect(vm.days.value).toEqual([]);
    expect(vm.planEnd.value).toBeNull();
    expect(vm.conflictCount.value).toBe(0);
  });
});

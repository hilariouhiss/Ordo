import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  aiEnrich: vi.fn().mockResolvedValue(undefined),
  bootstrap: vi.fn(),
  capture: vi.fn(),
  listWeek: vi.fn(),
  listSuspended: vi.fn(),
  listWeekDone: vi.fn().mockResolvedValue([]),
  weekStats: vi.fn(),
  resumeTask: vi.fn(),
  markNotificationsSeen: vi.fn(),
  moveTask: vi.fn(),
  placeTask: vi.fn(),
}));

import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { mondayOf, todayIso } from "../../lib/dates";
import { closeDialog, dialogRequest } from "../../lib/dialog";
import {
  capture,
  listSuspended,
  listWeek,
  listWeekDone,
  markNotificationsSeen,
  moveTask,
  placeTask,
  resumeTask,
  weekStats,
} from "../../model/ipc";
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
      newProjectName: null,
    });

    expect(capture).toHaveBeenCalledWith("周五前把软件方案评审发老李", CAPTURE_DEFAULTS, null);
    expect(vm.state.tasks[0].id).toBe("t1");
    expect(vm.state.draft).toBe("");
  });

  it("ignores a blank draft", async () => {
    const vm = createWeekVM();
    await vm.capture({ raw: "   ", title: "   ", fields: CAPTURE_DEFAULTS, newProjectName: null });
    expect(capture).not.toHaveBeenCalled();
  });

  it("loading the week leaves the reminder count alone", async () => {
    vi.mocked(listWeek).mockResolvedValue([]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    vi.mocked(markNotificationsSeen).mockResolvedValue(undefined);
    const vm = createWeekVM();

    await vm.load();
    await vm.load();

    // The page reloads on every capture and AI fill, even from other pages; only opening
    // the week itself may clear the tray's unread count.
    expect(vi.mocked(markNotificationsSeen)).not.toHaveBeenCalled();
    await vm.markSeen();
    expect(vi.mocked(markNotificationsSeen)).toHaveBeenCalledTimes(1);
  });

  it("shows a notice when the backend rejects the capture", async () => {
    vi.mocked(capture).mockRejectedValueOnce("invalid_project");
    const vm = createWeekVM();
    vm.state.draft = "交底";

    await vm.capture({
      raw: vm.state.draft,
      title: "交底",
      fields: CAPTURE_DEFAULTS,
      newProjectName: null,
    });

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
    const first = vm.capture({
      raw: "交底",
      title: "交底",
      fields: CAPTURE_DEFAULTS,
      newProjectName: null,
    });
    const second = vm.capture({
      raw: "交底",
      title: "交底",
      fields: CAPTURE_DEFAULTS,
      newProjectName: null,
    });
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
    appVM.state.settings = null;
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
      task({ id: "a", effortMinutes: 240 }),
      task({ id: "b", effortMinutes: 240 }),
      task({ id: "c", effortMinutes: 480 }),
    ]);

    expect(vm.days.value).toHaveLength(1);
    expect(vm.days.value[0].date).toBe("2026-10-20");
    expect(vm.days.value[0].weekday).toBe("周二");
    expect(vm.days.value[0].rows.map((row) => row.task.id)).toEqual(["a", "b", "c"]);
    expect(vm.days.value[0].isToday).toBe(true);
    expect(vm.planEnd.value).toBe("2026-10-20");
  });

  it("repeats a spanning task on every day it covers", async () => {
    const vm = await loadedWith([task({ id: "a", effortMinutes: 960 })]);

    expect(vm.days.value.map((day) => day.date)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(vm.days.value[0].rows[0]).toMatchObject({
      spans: true,
      days: 2,
      end: "2026-10-21",
    });
    expect(vm.days.value[1].rows).toEqual([vm.days.value[0].rows[0]]);
    expect(vm.loads.value.get("2026-10-21")).toBe(8);
  });

  it("counts a finish after the due date, not one on it", async () => {
    const vm = await loadedWith([
      task({ id: "late", expectedFinishDate: "2026-10-19" }),
      task({ id: "fit", expectedFinishDate: "2026-10-21" }),
    ]);

    expect(vm.conflictCount.value).toBe(1);
    expect(vm.days.value[0].rows[0].conflict).toBe(true);
    expect(vm.days.value[0].rows[1].conflict).toBe(false);
  });

  it("uses the task's own start date", async () => {
    const vm = await loadedWith([task({ id: "a", expectedStartDate: "2026-10-22" })]);

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
    const vm = await loadedWith([task({ id: "a" }), task({ id: "b", effortMinutes: 1440 })]);

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

  it("has no plan for an empty week", async () => {
    const vm = await loadedWith([]);

    expect(vm.days.value).toEqual([]);
    expect(vm.planEnd.value).toBeNull();
    expect(vm.conflictCount.value).toBe(0);
  });

  it("gives the gantt one lane per task in manual order, finished ones included", async () => {
    vi.mocked(listWeek).mockResolvedValue([
      task({ id: "a", sortOrder: 0 }),
      task({ id: "c", sortOrder: 2 }),
    ]);
    vi.mocked(listWeekDone).mockResolvedValueOnce([
      task({
        id: "b",
        sortOrder: 1,
        status: "done",
        expectedStartDate: "2026-10-21",
        actualFinishAt: new Date(2026, 9, 21, 15).toISOString(),
      }),
    ]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 1, delayed: 0 });
    const vm = createWeekVM();
    await vm.load();

    expect(vm.week.value).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(vm.lanes.value.map((lane) => lane.task.id)).toEqual(["a", "b", "c"]);
    expect(vm.lanes.value.map((lane) => [lane.from, lane.to])).toEqual([
      [1, 1],
      [2, 2],
      [1, 1],
    ]);
  });

  it("fills the whole workweek from Monday when the setting is on", async () => {
    appVM.state.settings = defaultSettings;
    const vm = await loadedWith([]);

    expect(vm.days.value.map((day) => day.date)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(vm.days.value.every((day) => day.rows.length === 0)).toBe(true);
    expect(vm.days.value[0].isPast).toBe(true);
  });

  it("keeps the days a spanning task covers and fills the rest", async () => {
    appVM.state.settings = defaultSettings;
    const vm = await loadedWith([task({ id: "a", effortMinutes: 960 })]);

    expect(vm.days.value.map((day) => day.date)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(vm.days.value[2].rows[0].task.id).toBe("a");
  });

  it("places a dropped task on the day and reloads", async () => {
    vi.mocked(placeTask).mockResolvedValue();
    vi.mocked(listWeek).mockResolvedValue([task({ id: "t1", expectedStartDate: "2026-10-22" })]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    const vm = createWeekVM();

    await vm.place("t1", "2026-10-22", "t2");

    expect(placeTask).toHaveBeenCalledWith("t1", "2026-10-22", "t2");
    expect(vm.state.tasks[0].expectedStartDate).toBe("2026-10-22");
  });

  it("shows a notice when resuming a parked task fails", async () => {
    vi.mocked(resumeTask).mockRejectedValueOnce("db_lock_poisoned");
    const vm = createWeekVM();

    await vm.resume("t1");

    expect(dialogRequest.value?.kind).toBe("notice");
  });
});

describe("weekVM plan across a week boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Wednesday 11/4, the day the report came from.
    vi.setSystemTime(new Date(2026, 10, 4, 9, 0, 0));
    appVM.state.settings = defaultSettings;
  });

  afterEach(() => {
    vi.useRealTimers();
    appVM.state.settings = null;
  });

  it("leaves a task planned after this week out of the week and its numbers", async () => {
    vi.mocked(listWeek).mockResolvedValue([
      task({ id: "dcm204", expectedStartDate: "2026-11-05", exclusive: true }),
      task({ id: "trip", expectedStartDate: "2026-11-10", effortMinutes: 1440, exclusive: true }),
      task({ id: "dcm205", expectedStartDate: "2026-11-06", effortMinutes: 180, exclusive: true }),
    ]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    const vm = createWeekVM();
    await vm.load();

    expect(vm.days.value.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
    expect(vm.days.value[3].rows.map((row) => row.task.id)).toEqual(["dcm204"]);
    expect(vm.days.value[4].rows.map((row) => row.task.id)).toEqual(["dcm205"]);
    // The trip is next week's work: no lane, no plan end, no load, no conflict count.
    expect(vm.lanes.value.map((lane) => lane.task.id)).toEqual(["dcm204", "dcm205"]);
    expect(vm.planEnd.value).toBe("2026-11-06");
    expect([...vm.loads.value.keys()]).not.toContain("2026-11-10");
    expect(vm.conflictCount.value).toBe(0);
    // The bottom stack holds exactly the work planned after this week.
    expect(vm.laterTasks.value.map((task) => task.id)).toEqual(["trip"]);
    // The week set still holds it, so the pass queue and the task page keep it.
    expect(vm.state.tasks.map((task) => task.id)).toEqual(["dcm204", "trip", "dcm205"]);
  });

  it("orders the bottom stack by start date, then by hand", async () => {
    vi.mocked(listWeek).mockResolvedValue([
      task({ id: "third", expectedStartDate: "2026-11-18" }),
      task({ id: "first", expectedStartDate: "2026-11-09", sortOrder: 5 }),
      task({ id: "firstB", expectedStartDate: "2026-11-09", sortOrder: 2 }),
      task({ id: "second", expectedStartDate: "2026-11-12", sortOrder: 1 }),
      task({ id: "now", expectedStartDate: "2026-11-05" }),
    ]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    const vm = createWeekVM();
    await vm.load();

    expect(vm.laterTasks.value.map((task) => task.id)).toEqual([
      "firstB",
      "first",
      "second",
      "third",
    ]);
    expect(vm.weekTasks.value.map((task) => task.id)).toEqual(["now"]);
  });

  it("cuts a span that runs into next week at Friday", async () => {
    vi.mocked(listWeek).mockResolvedValue([
      task({ id: "a", expectedStartDate: "2026-11-05", effortMinutes: 1440 }),
    ]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    const vm = createWeekVM();
    await vm.load();

    expect(vm.days.value.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
    expect(vm.days.value[3].rows[0]).toMatchObject({ spans: true, days: 3, clamped: false });
    expect(vm.days.value[4].rows[0].task.id).toBe("a");
  });

  it("shows the past days and keeps finished work on the day it was done", async () => {
    vi.mocked(listWeek).mockResolvedValue([
      task({ id: "trip", expectedStartDate: "2026-11-02", effortMinutes: 1440, exclusive: true }),
    ]);
    vi.mocked(listWeekDone).mockResolvedValueOnce([
      task({
        id: "done",
        status: "done",
        actualFinishAt: new Date(2026, 10, 2, 16, 37).toISOString(),
      }),
    ]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 1, done: 1, delayed: 0 });
    const vm = createWeekVM();
    await vm.load();

    expect(vm.days.value.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
    expect(vm.days.value[0].isPast).toBe(true);
    // The task starts on its own day; the finished one reads below it and stays read-only.
    expect(vm.days.value[0].rows.map((row) => row.task.id)).toEqual(["trip", "done"]);
    expect(vm.days.value[0].rows[1]).toMatchObject({ history: true });
    expect(vm.days.value[1].rows[0].task.id).toBe("trip");
  });

  it("keeps a finished span on every day it covered", async () => {
    vi.setSystemTime(new Date(2026, 10, 5, 9, 0, 0));
    vi.mocked(listWeek).mockResolvedValue([]);
    vi.mocked(listWeekDone).mockResolvedValueOnce([
      task({
        id: "span",
        status: "done",
        expectedStartDate: "2026-11-03",
        effortMinutes: 1440,
        actualFinishAt: new Date(2026, 10, 5, 16, 37).toISOString(),
      }),
    ]);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 1, done: 1, delayed: 0 });
    const vm = createWeekVM();
    await vm.load();

    expect(vm.days.value.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
    for (const day of vm.days.value.slice(1, 4)) {
      expect(day.rows).toHaveLength(1);
      expect(day.rows[0]).toMatchObject({
        task: { id: "span", status: "done" },
        history: true,
        spans: true,
        days: 3,
        end: "2026-11-05",
      });
    }
  });
});

describe("weekVM across midnight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    appVM.state.settings = null;
  });

  async function loadedWith(tasks: Task[]) {
    vi.mocked(listWeek).mockResolvedValue(tasks);
    vi.mocked(listSuspended).mockResolvedValue([]);
    vi.mocked(weekStats).mockResolvedValue({ added: 0, done: 0, delayed: 0 });
    const vm = createWeekVM();
    await vm.load();
    return vm;
  }

  it("moves the today mark when the window stays open past midnight", async () => {
    const vm = await loadedWith([task({ id: "a", expectedStartDate: "2026-10-20" })]);
    expect(vm.today.value).toBe("2026-10-20");
    expect(vm.days.value[0]).toMatchObject({ date: "2026-10-20", isToday: true, isPast: false });

    vi.setSystemTime(new Date(2026, 9, 21, 0, 5, 0));
    await vm.load();

    expect(vm.today.value).toBe("2026-10-21");
    expect(vm.days.value[0]).toMatchObject({ date: "2026-10-20", isToday: false, isPast: true });
  });

  it("moves the week to the next Monday when the window stays open over the weekend", async () => {
    const vm = await loadedWith([task({ id: "a" })]);
    expect(vm.week.value[0]).toBe("2026-10-19");

    vi.setSystemTime(new Date(2026, 9, 24, 0, 5, 0));
    await vm.load();

    expect(vm.week.value).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
    ]);
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

    await vm.capture({
      raw: "交底",
      title: "交底",
      fields: CAPTURE_DEFAULTS,
      newProjectName: null,
    });
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

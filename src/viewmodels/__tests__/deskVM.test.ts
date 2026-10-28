import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  bootstrap: vi.fn(),
  getSettings: vi.fn(),
  listWeek: vi.fn(),
  setSettings: vi.fn(),
  setTaskStatus: vi.fn(),
  startTask: vi.fn(),
  suspendTask: vi.fn(),
}));

import {
  getSettings,
  listWeek,
  setSettings,
  setTaskStatus,
  startTask,
  suspendTask,
} from "../../model/ipc";
import type { DeskPin } from "../../model/types";
import { appVM } from "../appVM";
import { createDeskVM } from "../deskVM";
import { defaultSettings, task } from "./fixtures";

describe("deskVM", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0, 0));
  });

  afterEach(() => {
    appVM.state.settings = null;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("groups the week list by planned day", async () => {
    vi.mocked(listWeek).mockResolvedValue([
      task({ id: "a", effortDays: 0.5 }),
      task({ id: "b", effortDays: 0.5 }),
      task({ id: "c", startDate: "2026-10-22" }),
    ]);

    const vm = createDeskVM();
    await vm.load();

    expect(vm.days.value.map((day) => day.date)).toEqual(["2026-10-20", "2026-10-22"]);
    expect(vm.days.value[0].rows.map((row) => row.task.id)).toEqual(["a", "b"]);
    expect(vm.count.value).toBe(3);
  });

  it("keeps the previous list when a refresh fails", async () => {
    vi.mocked(listWeek)
      .mockResolvedValueOnce([task({ id: "a" })])
      .mockRejectedValueOnce(new Error("db"));

    const vm = createDeskVM();
    await vm.load();
    await vm.load();

    expect(vm.state.tasks.map((one) => one.id)).toEqual(["a"]);
    expect(vm.state.failed).toBe(true);
  });

  it("normalizes an unknown saved pin and reads the controls switch", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...defaultSettings,
      deskControls: true,
      deskPin: "normal" as unknown as DeskPin,
    });

    const vm = createDeskVM();
    await vm.loadConfig();

    expect(vm.state.pin).toBe("top");
    expect(vm.state.controls).toBe(true);
  });

  it("runs the quick status actions and reloads", async () => {
    vi.mocked(listWeek).mockResolvedValue([task({ id: "a" })]);
    vi.mocked(startTask).mockResolvedValue(task({ id: "a", status: "doing" }));
    vi.mocked(suspendTask).mockResolvedValue(task({ id: "a", suspended: true }));
    vi.mocked(setTaskStatus).mockResolvedValue(task({ id: "a", status: "done" }));

    const vm = createDeskVM();
    await vm.start(task({ id: "a" }));
    expect(startTask).toHaveBeenCalledWith("a");
    expect(listWeek).toHaveBeenCalledTimes(1);

    await vm.suspend(task({ id: "a" }));
    expect(suspendTask).toHaveBeenCalledWith("a", null, null);

    await vm.complete(task({ id: "a" }));
    expect(setTaskStatus).toHaveBeenCalledWith("a", "done");
    expect(vm.state.busy).toBe(false);
    expect(vm.state.actionError).toBe("");
  });

  it("keeps a failed action for the view", async () => {
    vi.mocked(startTask).mockRejectedValue("invalid_status");

    const vm = createDeskVM();
    await vm.start(task({ id: "a" }));

    expect(vm.state.actionError).toBe("invalid_status");
    expect(vm.state.busy).toBe(false);
  });

  it("persists a pin change and keeps the in-memory setting current", async () => {
    appVM.state.settings = { ...defaultSettings, deskPin: "top" };
    vi.mocked(setSettings).mockResolvedValue({ ...defaultSettings, deskPin: "bottom" });

    const vm = createDeskVM();
    await vm.setPin("bottom");

    expect(setSettings).toHaveBeenCalledWith({ deskPin: "bottom" });
    expect(vm.state.pin).toBe("bottom");
    expect(appVM.state.settings?.deskPin).toBe("bottom");
  });

  it("updates the in-memory widget position before the database write", async () => {
    appVM.state.settings = { ...defaultSettings, deskX: 10, deskY: 20 };
    vi.mocked(setSettings).mockResolvedValue({ ...defaultSettings, deskX: 30, deskY: 40 });

    const vm = createDeskVM();
    await vm.savePosition(30, 40);

    expect(setSettings).toHaveBeenCalledWith({ deskX: 30, deskY: 40 });
    expect(appVM.state.settings?.deskX).toBe(30);
    expect(appVM.state.settings?.deskY).toBe(40);
  });

  it("keeps the in-memory widget position when persisting it fails", async () => {
    appVM.state.settings = { ...defaultSettings, deskX: 10, deskY: 20 };
    vi.mocked(setSettings).mockRejectedValue(new Error("db"));

    const vm = createDeskVM();
    await expect(vm.savePosition(30, 40)).resolves.toBeUndefined();

    expect(appVM.state.settings?.deskX).toBe(30);
    expect(appVM.state.settings?.deskY).toBe(40);
  });

  it("persists a widget mode change", async () => {
    appVM.state.settings = { ...defaultSettings, deskEnabled: false };
    vi.mocked(setSettings).mockResolvedValue({ ...defaultSettings, deskEnabled: true });

    const vm = createDeskVM();
    await vm.setEnabled(true);

    expect(setSettings).toHaveBeenCalledWith({ deskEnabled: true });
    expect(appVM.state.settings?.deskEnabled).toBe(true);
  });

  it("keeps the window change when persisting the mode fails", async () => {
    vi.mocked(setSettings).mockRejectedValue(new Error("db"));

    const vm = createDeskVM();
    await expect(vm.setEnabled(false)).resolves.toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  bootstrap: vi.fn(),
  listOverdueTasks: vi.fn(),
  deferTask: vi.fn(),
}));

vi.mock("../weekVM", () => ({ weekVM: { reload: vi.fn() } }));
vi.mock("../tasksVM", () => ({ tasksVM: { reload: vi.fn() } }));
vi.mock("../windowModeVM", () => ({
  windowModeVM: { ensureFull: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../lib/dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/dialog")>();
  return { ...actual, askOverdueDefer: vi.fn(), askNotice: vi.fn() };
});

import { askConfirm, askNotice, askOverdueDefer, closeDialog } from "../../lib/dialog";
import { deferTask, listOverdueTasks } from "../../model/ipc";
import { appVM } from "../appVM";
import { createOverduePromptVM } from "../overduePromptVM";
import { defaultSettings, task } from "./fixtures";

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const overdue = [
  { id: "a", title: "交底", expectedFinishDate: "2026-11-10" },
  { id: "b", title: "报销", expectedFinishDate: "2026-11-11" },
];

describe("overduePromptVM", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 12, 9, 30, 0));
    appVM.state.settings = { ...defaultSettings, overduePrompt: true };
    vi.mocked(listOverdueTasks).mockResolvedValue(overdue);
    vi.mocked(askOverdueDefer).mockResolvedValue({
      dates: [
        { id: "a", finish: "2026-11-20" },
        { id: "b", finish: "2026-11-25" },
      ],
      reason: "等回复",
    });
    vi.mocked(deferTask).mockResolvedValue(task({ id: "a" }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("asks once and defers every task to its own day", async () => {
    const vm = createOverduePromptVM();
    await vm.check();
    await flush();

    expect(askOverdueDefer).toHaveBeenCalledTimes(1);
    expect(askOverdueDefer).toHaveBeenCalledWith(expect.any(String), overdue, {
      finish: "2026-11-12",
      min: "2026-11-12",
    });
    expect(vi.mocked(deferTask).mock.calls).toEqual([
      ["a", "2026-11-20", "等回复"],
      ["b", "2026-11-25", "等回复"],
    ]);
  });

  it("uses each task's default day when the dialog is dismissed", async () => {
    vi.mocked(askOverdueDefer).mockResolvedValue(null);
    const vm = createOverduePromptVM();
    await vm.check();
    await flush();

    expect(vi.mocked(deferTask).mock.calls).toEqual([
      ["a", "2026-11-12", ""],
      ["b", "2026-11-12", ""],
    ]);
  });

  it("waits for another dialog before it asks", async () => {
    const other = askConfirm("删除", "确认？");
    const vm = createOverduePromptVM();
    const checking = vm.check();
    await flush();
    expect(askOverdueDefer).not.toHaveBeenCalled();

    closeDialog(null);
    await checking;
    await flush();
    expect(askOverdueDefer).toHaveBeenCalledTimes(1);
    await expect(other).resolves.toBe(false);
  });

  it("does not ask when the prompt setting is off", async () => {
    appVM.state.settings = { ...defaultSettings, overduePrompt: false };
    const vm = createOverduePromptVM();
    await vm.check();
    await flush();

    expect(listOverdueTasks).not.toHaveBeenCalled();
    expect(askOverdueDefer).not.toHaveBeenCalled();
  });

  it("does not ask without overdue tasks", async () => {
    vi.mocked(listOverdueTasks).mockResolvedValue([]);
    const vm = createOverduePromptVM();
    await vm.check();
    await flush();

    expect(askOverdueDefer).not.toHaveBeenCalled();
  });

  it("reports one notice when a task cannot be deferred", async () => {
    vi.mocked(deferTask).mockRejectedValueOnce("db down");
    const vm = createOverduePromptVM();
    await vm.check();
    await flush();

    expect(deferTask).toHaveBeenCalledTimes(2);
    expect(askNotice).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a startup before nine", async () => {
    vi.setSystemTime(new Date(2026, 10, 12, 8, 59, 0));
    const vm = createOverduePromptVM();
    vm.startup();
    await flush();

    expect(listOverdueTasks).not.toHaveBeenCalled();
  });

  it("checks on an after-nine startup", async () => {
    const vm = createOverduePromptVM();
    vm.startup();
    await flush();

    expect(listOverdueTasks).toHaveBeenCalledTimes(1);
  });
});

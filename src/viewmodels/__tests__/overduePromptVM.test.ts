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
  return { ...actual, askAutoDefer: vi.fn(), askNotice: vi.fn() };
});

import { askAutoDefer, askConfirm, closeDialog } from "../../lib/dialog";
import { deferTask, listOverdueTasks } from "../../model/ipc";
import { appVM } from "../appVM";
import { createOverduePromptVM } from "../overduePromptVM";
import { defaultSettings, task } from "./fixtures";

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("overduePromptVM", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 12, 9, 30, 0));
    appVM.state.settings = { ...defaultSettings, overduePrompt: true };
    vi.mocked(listOverdueTasks).mockResolvedValue([
      { id: "a", title: "交底", expectedFinishDate: "2026-11-10" },
      { id: "b", title: "报销", expectedFinishDate: "2026-11-11" },
    ]);
    vi.mocked(askAutoDefer)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ finish: "2026-11-20", reason: "等回复" });
    vi.mocked(deferTask).mockResolvedValue(task({ id: "a" }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("asks in order and records the default when a dialog is dismissed", async () => {
    const vm = createOverduePromptVM();
    await vm.check();
    await flush();

    expect(vi.mocked(deferTask)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deferTask).mock.calls[0]).toEqual(["a", "2026-11-12", ""]);
    expect(vi.mocked(deferTask).mock.calls[1]).toEqual(["b", "2026-11-20", "等回复"]);
  });

  it("waits for another dialog before it asks", async () => {
    vi.mocked(listOverdueTasks).mockResolvedValue([
      { id: "a", title: "交底", expectedFinishDate: "2026-11-10" },
    ]);
    vi.mocked(askAutoDefer).mockReset();
    vi.mocked(askAutoDefer).mockResolvedValue(null);
    const other = askConfirm("删除", "确认？");
    const vm = createOverduePromptVM();
    await vm.check();
    await flush();
    expect(askAutoDefer).not.toHaveBeenCalled();

    closeDialog(null);
    await flush();
    expect(askAutoDefer).toHaveBeenCalledTimes(1);
    await expect(other).resolves.toBe(false);
  });

  it("stops the queue when the prompt setting is turned off", async () => {
    vi.mocked(askAutoDefer).mockReset();
    vi.mocked(askAutoDefer).mockImplementation(async () => {
      appVM.state.settings = { ...defaultSettings, overduePrompt: false };
      return { finish: "2026-11-20", reason: "" };
    });
    const vm = createOverduePromptVM();
    await vm.check();
    await flush();

    expect(deferTask).toHaveBeenCalledTimes(1);
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

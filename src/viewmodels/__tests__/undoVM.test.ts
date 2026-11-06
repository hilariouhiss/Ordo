import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../lib/dialog", () => ({ askNotice: vi.fn() }));

import { askNotice } from "../../lib/dialog";
import { UNDO_MS, createUndoVM } from "../undoVM";

describe("undoVM", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps only the latest action and drops it after the window", () => {
    const vm = createUndoVM();
    vm.pushUndo("first", vi.fn().mockResolvedValue(undefined));
    vm.pushUndo("second", vi.fn().mockResolvedValue(undefined));

    expect(vm.state.entry).toEqual({ message: "second" });

    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(vm.state.entry).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(vm.state.entry).toBeNull();
  });

  it("runs the action once, clears the entry and bumps the revision", async () => {
    const vm = createUndoVM();
    const run = vi.fn().mockResolvedValue(undefined);
    vm.pushUndo("已完成「交底」", run);

    await vm.undo();

    expect(run).toHaveBeenCalledTimes(1);
    expect(vm.state.entry).toBeNull();
    expect(vm.state.revision).toBe(1);

    await vm.undo();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a pending action", async () => {
    const vm = createUndoVM();
    await vm.undo();
    expect(vm.state.revision).toBe(0);
  });

  it("reports a failed restore and leaves the revision alone", async () => {
    const vm = createUndoVM();
    const run = vi.fn().mockRejectedValue("task_not_found");
    vm.pushUndo("已完成「交底」", run);

    await vm.undo();

    expect(askNotice).toHaveBeenCalledTimes(1);
    expect(vm.state.entry).toBeNull();
    expect(vm.state.revision).toBe(0);
  });

  it("dismisses without running the action", () => {
    const vm = createUndoVM();
    const run = vi.fn().mockResolvedValue(undefined);
    vm.pushUndo("已完成「交底」", run);

    vm.dismiss();

    expect(vm.state.entry).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

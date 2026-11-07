import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  setTaskStatus: vi.fn(),
  startTask: vi.fn(),
  suspendTask: vi.fn(),
  resumeTask: vi.fn(),
  updateTaskPatch: vi.fn(),
  waitTask: vi.fn(),
}));
vi.mock("../undoVM", () => ({ undoVM: { pushUndo: vi.fn() } }));

import {
  resumeTask,
  setTaskStatus,
  startTask,
  suspendTask,
  updateTaskPatch,
  waitTask,
} from "../../model/ipc";
import { undoVM } from "../undoVM";
import { createTaskRowVM } from "../taskRowVM";
import { task } from "./fixtures";

describe("taskRowVM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setTaskStatus).mockResolvedValue(task());
    vi.mocked(startTask).mockResolvedValue(task());
    vi.mocked(suspendTask).mockResolvedValue(task());
    vi.mocked(resumeTask).mockResolvedValue(task());
    vi.mocked(updateTaskPatch).mockResolvedValue(task());
    vi.mocked(waitTask).mockResolvedValue(task({ waiting: true }));
  });

  it("starts and suspends the task through the commands", async () => {
    const vm = createTaskRowVM();

    await vm.start(task({ id: "t1" }));
    await vm.suspend(task({ id: "t1" }), "2026-11-02", "等甲方");

    expect(startTask).toHaveBeenCalledWith("t1");
    expect(suspendTask).toHaveBeenCalledWith("t1", "2026-11-02", "等甲方");
  });

  it("toggles between done and todo", async () => {
    const vm = createTaskRowVM();

    await vm.toggleDone(task({ status: "doing" }));
    expect(setTaskStatus).toHaveBeenLastCalledWith("t1", "done");

    await vm.toggleDone(task({ status: "done" }));
    expect(setTaskStatus).toHaveBeenLastCalledWith("t1", "todo");
  });

  it("offers undo back to the status a completion replaced", async () => {
    const vm = createTaskRowVM();
    vi.mocked(setTaskStatus).mockResolvedValue(task({ status: "done" }));

    await vm.toggleDone(task({ id: "t1", title: "交底", status: "doing" }));

    const [message, run] = vi.mocked(undoVM.pushUndo).mock.calls[0];
    expect(String(message)).toContain("交底");
    vi.mocked(setTaskStatus).mockResolvedValue(task({ status: "doing" }));
    await run();
    expect(setTaskStatus).toHaveBeenLastCalledWith("t1", "doing");
  });

  it("undoes a suspension by bringing the task back", async () => {
    const vm = createTaskRowVM();
    vi.mocked(suspendTask).mockResolvedValue(task({ suspended: true }));

    await vm.suspend(task({ id: "t1", title: "交底" }), null, null);

    const [, run] = vi.mocked(undoVM.pushUndo).mock.calls[0];
    await run();
    expect(resumeTask).toHaveBeenCalledWith("t1");
  });

  it("waits through the command and offers undo back into the week", async () => {
    const vm = createTaskRowVM();

    await vm.wait(task({ id: "t1", title: "交底" }), "u2", "2026-11-15");

    expect(waitTask).toHaveBeenCalledWith("t1", "u2", "2026-11-15");
    const [message, run] = vi.mocked(undoVM.pushUndo).mock.calls[0];
    expect(String(message)).toContain("交底");
    await run();
    expect(resumeTask).toHaveBeenCalledWith("t1");
  });

  it("undo of a moved wait restores the old person and day", async () => {
    const vm = createTaskRowVM();

    await vm.wait(
      task({ id: "t1", waiting: true, waitingOnId: "u2", followUpDate: "2026-12-01" }),
      "u3",
      "2026-12-05",
    );
    const [, run] = vi.mocked(undoVM.pushUndo).mock.calls.at(-1)!;
    await run();

    expect(waitTask).toHaveBeenLastCalledWith("t1", "u2", "2026-12-01");
  });

  it("undo of a moved wait drops a day that has already passed", async () => {
    const vm = createTaskRowVM();

    await vm.wait(
      task({ id: "t1", waiting: true, waitingOnId: "u2", followUpDate: "2020-01-01" }),
      "u3",
      "2026-12-05",
    );
    const [, run] = vi.mocked(undoVM.pushUndo).mock.calls.at(-1)!;
    await run();

    expect(waitTask).toHaveBeenLastCalledWith("t1", "u2", null);
  });

  it("puts the recorded times back when the undo of a reopen re-completes", async () => {
    const vm = createTaskRowVM();
    const finished = task({
      id: "t1",
      title: "发版",
      status: "done",
      actualStartAt: "2026-10-19T01:00:00Z",
      actualFinishAt: "2026-10-20T09:00:00Z",
      actualEffortMinutes: 1920,
    });
    vi.mocked(setTaskStatus).mockResolvedValue(task({ status: "todo" }));

    await vm.toggleDone(finished);
    const [, run] = vi.mocked(undoVM.pushUndo).mock.calls[0];
    await run();

    expect(setTaskStatus).toHaveBeenLastCalledWith("t1", "done");
    expect(updateTaskPatch).toHaveBeenCalledWith("t1", {
      actualStartAt: "2026-10-19T01:00:00Z",
      actualFinishAt: "2026-10-20T09:00:00Z",
    });
  });

  it("only re-completes when the finished task never recorded a start", async () => {
    const vm = createTaskRowVM();
    vi.mocked(setTaskStatus).mockResolvedValue(task({ status: "todo" }));

    await vm.toggleDone(task({ id: "t1", status: "done", actualStartAt: null }));
    const [, run] = vi.mocked(undoVM.pushUndo).mock.calls[0];
    await run();

    expect(setTaskStatus).toHaveBeenLastCalledWith("t1", "done");
    expect(updateTaskPatch).not.toHaveBeenCalled();
  });

  it("ticks a subtask through its own status", async () => {
    const vm = createTaskRowVM();
    const child = task({ id: "s1", title: "收集", parentId: "t1" });
    vi.mocked(setTaskStatus).mockResolvedValue(task({ id: "s1", status: "done" }));

    await vm.toggleSubtask(child);

    expect(setTaskStatus).toHaveBeenLastCalledWith("s1", "done");
    const [message, run] = vi.mocked(undoVM.pushUndo).mock.calls[0];
    expect(String(message)).toContain("收集");
    await run();
    expect(setTaskStatus).toHaveBeenLastCalledWith("s1", "todo");
  });
});

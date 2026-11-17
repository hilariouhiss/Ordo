import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  setTaskStatus: vi.fn(),
  startTask: vi.fn(),
  parkTask: vi.fn(),
  resumeTask: vi.fn(),
  updateTaskPatch: vi.fn(),
}));
vi.mock("../undoVM", () => ({ undoVM: { pushUndo: vi.fn() } }));

import { parkTask, resumeTask, setTaskStatus, startTask, updateTaskPatch } from "../../model/ipc";
import { undoVM } from "../undoVM";
import { createTaskRowVM } from "../taskRowVM";
import { task } from "./fixtures";

const draft = { reason: "等甲方", until: "2026-11-02", personId: "u2" };

describe("taskRowVM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setTaskStatus).mockResolvedValue(task());
    vi.mocked(startTask).mockResolvedValue(task());
    vi.mocked(parkTask).mockResolvedValue(task({ parked: true }));
    vi.mocked(resumeTask).mockResolvedValue(task());
    vi.mocked(updateTaskPatch).mockResolvedValue(task());
  });

  it("starts and parks the task through the commands", async () => {
    const vm = createTaskRowVM();

    await vm.start(task({ id: "t1" }));
    await vm.park(task({ id: "t1" }), draft);

    expect(startTask).toHaveBeenCalledWith("t1");
    expect(parkTask).toHaveBeenCalledWith("t1", "2026-11-02", "等甲方", "u2");
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

  it("undo of a completion puts a parked task back on its park", async () => {
    const vm = createTaskRowVM();
    const parked = task({
      id: "t1",
      title: "交底",
      status: "doing",
      parked: true,
      parkUntil: "2999-12-01",
      parkReason: "等甲方",
      parkedOnId: "u2",
    });

    await vm.toggleDone(parked);
    const [, run] = vi.mocked(undoVM.pushUndo).mock.calls[0];
    await run();

    expect(setTaskStatus).toHaveBeenLastCalledWith("t1", "doing");
    expect(parkTask).toHaveBeenLastCalledWith("t1", "2999-12-01", "等甲方", "u2");
  });

  it("undoes a park by bringing the task back", async () => {
    const vm = createTaskRowVM();

    await vm.park(task({ id: "t1", title: "交底" }), draft);

    const [message, run] = vi.mocked(undoVM.pushUndo).mock.calls[0];
    expect(String(message)).toContain("交底");
    await run();
    expect(resumeTask).toHaveBeenCalledWith("t1");
  });

  it("undo of a resume puts the task back on its park", async () => {
    const vm = createTaskRowVM();

    await vm.resume(
      task({
        id: "t1",
        parked: true,
        parkUntil: "2999-12-06",
        parkReason: "等甲方",
        parkedOnId: "u2",
      }),
    );
    const [, run] = vi.mocked(undoVM.pushUndo).mock.calls.at(-1)!;
    await run();

    expect(parkTask).toHaveBeenLastCalledWith("t1", "2999-12-06", "等甲方", "u2");
  });

  it("undo of a resume drops a park day that has already passed", async () => {
    const vm = createTaskRowVM();

    await vm.resume(
      task({
        id: "t1",
        parked: true,
        parkUntil: "2020-01-01",
        parkReason: "等甲方",
        parkedOnId: "u2",
      }),
    );
    const [, run] = vi.mocked(undoVM.pushUndo).mock.calls.at(-1)!;
    await run();

    expect(parkTask).toHaveBeenLastCalledWith("t1", null, "等甲方", "u2");
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

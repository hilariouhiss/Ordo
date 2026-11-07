import { describe, expect, it } from "vite-plus/test";
import { canSuspendTask, canWaitTask, statusDisplay } from "../status";

describe("statusDisplay", () => {
  it("shows a suspended task as paused even while its status is doing", () => {
    expect(statusDisplay("doing", true)).toBe("suspended");
  });

  it("shows a suspended task as paused when it never started", () => {
    expect(statusDisplay("todo", true)).toBe("suspended");
  });

  it("keeps the stored status when the task is not suspended", () => {
    expect(statusDisplay("doing", false)).toBe("doing");
    expect(statusDisplay("todo", false)).toBe("todo");
  });

  it("keeps a done task done", () => {
    expect(statusDisplay("done", true)).toBe("done");
  });

  it("shows waiting before any stored status, and before a stale suspension", () => {
    expect(statusDisplay("doing", false, true)).toBe("waiting");
    expect(statusDisplay("todo", false, true)).toBe("waiting");
    expect(statusDisplay("todo", true, true)).toBe("waiting");
    expect(statusDisplay("done", false, true)).toBe("done");
  });
});

describe("canWaitTask", () => {
  it("allows any open task, waiting or not suspended", () => {
    expect(canWaitTask({ status: "todo", waiting: false })).toBe(true);
    expect(canWaitTask({ status: "doing", waiting: false })).toBe(true);
    expect(canWaitTask({ status: "doing", waiting: true })).toBe(true);
  });

  it("refuses a finished task only", () => {
    expect(canWaitTask({ status: "done", waiting: false })).toBe(false);
  });
});

describe("canSuspendTask", () => {
  it("allows a task that has not started or is doing", () => {
    expect(canSuspendTask({ status: "todo", suspended: false })).toBe(true);
    expect(canSuspendTask({ status: "doing", suspended: false })).toBe(true);
  });

  it("refuses a done or already suspended task", () => {
    expect(canSuspendTask({ status: "done", suspended: false })).toBe(false);
    expect(canSuspendTask({ status: "todo", suspended: true })).toBe(false);
  });
});

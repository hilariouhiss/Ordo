import { describe, expect, it } from "vite-plus/test";
import { canSuspendTask, statusDisplay } from "../status";

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

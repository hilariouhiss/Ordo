import { describe, expect, it } from "vite-plus/test";
import { canParkTask, statusDisplay } from "../status";

describe("statusDisplay", () => {
  it("shows a parked task as parked even while its stored status is doing", () => {
    expect(statusDisplay("doing", true)).toBe("parked");
    expect(statusDisplay("todo", true)).toBe("parked");
  });

  it("keeps the stored status when the task is not parked", () => {
    expect(statusDisplay("doing", false)).toBe("doing");
    expect(statusDisplay("todo", false)).toBe("todo");
  });

  it("keeps a done task done", () => {
    expect(statusDisplay("done", true)).toBe("done");
    expect(statusDisplay("done", false)).toBe("done");
  });
});

describe("canParkTask", () => {
  it("allows any open task, started or not", () => {
    expect(canParkTask({ status: "todo" })).toBe(true);
    expect(canParkTask({ status: "doing" })).toBe(true);
  });

  it("refuses a finished task", () => {
    expect(canParkTask({ status: "done" })).toBe(false);
  });
});

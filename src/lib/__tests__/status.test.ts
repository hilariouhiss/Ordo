import { describe, expect, it } from "vite-plus/test";
import { statusDisplay } from "../status";

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

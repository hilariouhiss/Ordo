import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { COMMANDS } from "../commands";
import { invokeCommand } from "../invoke";

const mockedInvoke = vi.mocked(invoke);

describe("invokeCommand", () => {
  afterEach(() => {
    mockedInvoke.mockReset();
  });

  it("returns the result on success", async () => {
    mockedInvoke.mockResolvedValue({ id: "1" });

    await expect(invokeCommand(COMMANDS.task.list)).resolves.toEqual({ id: "1" });
    expect(mockedInvoke).toHaveBeenCalledWith("task:list", undefined);
  });

  it("passes args through to invoke", async () => {
    mockedInvoke.mockResolvedValue(null);

    await invokeCommand(COMMANDS.task.create, { title: "新任务" });

    expect(mockedInvoke).toHaveBeenCalledWith("task:create", { title: "新任务" });
  });

  it("rethrows a normalized error for payload rejections", async () => {
    mockedInvoke.mockRejectedValue({ code: "validation", message: "标题必填" });

    await expect(invokeCommand(COMMANDS.task.create)).rejects.toEqual({
      code: "validation",
      message: "标题必填",
    });
  });

  it("normalizes string rejections", async () => {
    mockedInvoke.mockRejectedValue("database unavailable");

    await expect(invokeCommand(COMMANDS.task.list)).rejects.toEqual({
      code: "unknown",
      message: "database unavailable",
    });
  });
});

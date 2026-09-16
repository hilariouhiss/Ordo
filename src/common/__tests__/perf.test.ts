import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { COMMANDS } from "../ipc/commands";
import { invokeCommand } from "../ipc/invoke";
import { mark, markInteractive, recordCommand } from "../perf";

const mockedInvoke = vi.mocked(invoke);

interface Report {
  marks: { name: string; ms: number }[];
  commands: { name: string; count: number; totalMs: number; maxMs: number }[];
}

/** The report of the `perf:ready` call that was sent. */
function report(): Report {
  const call = mockedInvoke.mock.calls.find(
    ([command]) => command === COMMANDS.perf.ready,
  );
  const args = call?.[1] as { report: Report };
  return args.report;
}

describe("markInteractive", () => {
  afterEach(() => {
    mockedInvoke.mockReset();
  });

  it("reports count, total and max per command", () => {
    mockedInvoke.mockResolvedValue(undefined);
    recordCommand("task:list", 10);
    recordCommand("task:list", 30);
    recordCommand("task:create", 4);

    markInteractive();

    expect(mockedInvoke).toHaveBeenCalledWith(COMMANDS.perf.ready, {
      report: {
        marks: expect.any(Array),
        commands: [
          { name: "task:list", count: 2, totalMs: 40, maxMs: 30 },
          { name: "task:create", count: 1, totalMs: 4, maxMs: 4 },
        ],
      },
    });
  });

  it("reports the page timeline from navigation start", () => {
    mockedInvoke.mockResolvedValue(undefined);
    mark("shell-mounted");

    markInteractive();

    const marks = report().marks;
    expect(marks.map((entry) => entry.name)).toContain("shell-mounted");
    expect(marks[marks.length - 1]?.name).toBe("interactive");
    // Absolute `performance.now()` readings, so the whole timeline is ordered.
    expect(marks.map((entry) => entry.ms)).toEqual(
      [...marks].map((entry) => entry.ms).sort((a, b) => a - b),
    );
  });

  it("counts the round trips that go through invokeCommand", async () => {
    mockedInvoke.mockResolvedValue([]);

    await invokeCommand(COMMANDS.project.list);
    markInteractive();

    expect(report().commands).toContainEqual({
      name: "project:list",
      count: 1,
      totalMs: expect.any(Number),
      maxMs: expect.any(Number),
    });
  });

  it("swallows a failed report", async () => {
    mockedInvoke.mockRejectedValue(new Error("没有 IPC"));

    expect(() => markInteractive()).not.toThrow();
    await Promise.resolve();
  });
});

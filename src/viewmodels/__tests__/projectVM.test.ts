import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  aiEnrich: vi.fn(),
  capture: vi.fn(),
  getProjectSummary: vi.fn(),
  listProjectTasks: vi.fn(),
  listWeek: vi.fn(),
}));

import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { capture, getProjectSummary, listProjectTasks, listWeek } from "../../model/ipc";
import type { Task } from "../../model/types";
import { createProjectVM } from "../projectVM";
import { task } from "./fixtures";

const summary = {
  id: "p1",
  name: "项目",
  dueDate: null,
  total: 0,
  done: 0,
  byCategory: [],
};

describe("projectVM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listWeek).mockResolvedValue([]);
  });

  it("ignores a repeated capture while one is in flight", async () => {
    let resolve!: (value: Task) => void;
    vi.mocked(capture).mockReturnValue(
      new Promise<Task>((done) => {
        resolve = done;
      }),
    );
    vi.mocked(getProjectSummary).mockResolvedValue(summary);
    vi.mocked(listProjectTasks).mockResolvedValue([]);

    const vm = createProjectVM();
    const first = vm.captureInto("p1", {
      raw: "交底",
      title: "交底",
      fields: CAPTURE_DEFAULTS,
    });
    const second = vm.captureInto("p1", {
      raw: "交底",
      title: "交底",
      fields: CAPTURE_DEFAULTS,
    });
    resolve(task({ id: "t1" }));
    await Promise.all([first, second]);

    expect(capture).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  aiEnrich: vi.fn(),
  capture: vi.fn(),
  getProjectSummary: vi.fn(),
  listProjectTasks: vi.fn(),
  listWeek: vi.fn(),
}));

import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { closeDialog, dialogRequest } from "../../lib/dialog";
import { capture, getProjectSummary, listProjectTasks, listWeek } from "../../model/ipc";
import type { ProjectSummary, Task } from "../../model/types";
import { createProjectVM } from "../projectVM";
import { task } from "./fixtures";

const summary: ProjectSummary = {
  id: "p1",
  name: "项目",
  groupId: null,
  priority: "normal",
  total: 0,
  done: 0,
  byCategory: [],
};

describe("projectVM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listWeek).mockResolvedValue([]);
  });

  afterEach(() => {
    closeDialog(null);
    vi.useRealTimers();
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

  it("warns from the captured snapshot, not the enriched copy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0, 0));
    const blocker = task({ id: "x", title: "出差", exclusive: true });
    const captured = task({ id: "n", title: "新任务" });
    // AI already moved the stored copy off today; the notice must use the capture.
    const enriched = task({ id: "n", title: "新任务", startDate: "2026-11-30" });
    vi.mocked(capture).mockResolvedValue(captured);
    vi.mocked(getProjectSummary).mockResolvedValue(summary);
    vi.mocked(listProjectTasks).mockResolvedValue([]);
    vi.mocked(listWeek).mockResolvedValue([blocker, enriched]);

    const vm = createProjectVM();
    await vm.captureInto("p1", { raw: "新任务", title: "新任务", fields: CAPTURE_DEFAULTS });

    expect(dialogRequest.value?.kind).toBe("notice");
  });
});

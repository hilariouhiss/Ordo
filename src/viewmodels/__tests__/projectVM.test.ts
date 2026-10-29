import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  aiEnrich: vi.fn(),
  capture: vi.fn(),
  getProjectSummary: vi.fn(),
  listProjectTasks: vi.fn(),
}));

import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { closeDialog } from "../../lib/dialog";
import { capture, getProjectSummary, listProjectTasks } from "../../model/ipc";
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

  it("keeps a draft typed while the previous capture is still saving", async () => {
    let resolve!: (value: Task) => void;
    vi.mocked(capture).mockReturnValue(
      new Promise<Task>((done) => {
        resolve = done;
      }),
    );
    vi.mocked(getProjectSummary).mockResolvedValue(summary);
    vi.mocked(listProjectTasks).mockResolvedValue([]);

    const vm = createProjectVM();
    const saving = vm.captureInto("p1", {
      raw: "交底",
      title: "交底",
      fields: CAPTURE_DEFAULTS,
    });
    vm.state.draft = "下一条";
    resolve(task({ id: "t1" }));
    await saving;

    expect(vm.state.draft).toBe("下一条");
  });

  it("clears the draft after a successful capture when it was not changed", async () => {
    vi.mocked(capture).mockResolvedValue(task({ id: "t1" }));
    vi.mocked(getProjectSummary).mockResolvedValue(summary);
    vi.mocked(listProjectTasks).mockResolvedValue([]);

    const vm = createProjectVM();
    vm.state.draft = "交底";
    await vm.captureInto("p1", {
      raw: "交底",
      title: "交底",
      fields: CAPTURE_DEFAULTS,
    });

    expect(vm.state.draft).toBe("");
  });
});

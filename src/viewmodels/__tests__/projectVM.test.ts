import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  aiEnrich: vi.fn().mockResolvedValue(undefined),
  capture: vi.fn(),
  createMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getProjectSummary: vi.fn(),
  listProjectTasks: vi.fn(),
  renameMilestone: vi.fn(),
  setMilestoneDate: vi.fn(),
  setMilestoneDone: vi.fn(),
}));

import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { closeDialog } from "../../lib/dialog";
import {
  capture,
  createMilestone,
  deleteMilestone,
  getProjectSummary,
  listProjectTasks,
  renameMilestone,
  setMilestoneDate,
  setMilestoneDone,
} from "../../model/ipc";
import type { Milestone, ProjectSummary, Task } from "../../model/types";
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
  milestones: [],
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
      newProjectName: null,
    });
    const second = vm.captureInto("p1", {
      raw: "交底",
      title: "交底",
      fields: CAPTURE_DEFAULTS,
      newProjectName: null,
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
      newProjectName: null,
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
      newProjectName: null,
    });

    expect(vm.state.draft).toBe("");
  });
});

function milestone(over: Partial<Milestone> = {}): Milestone {
  return { id: "m1", title: "方案评审", dueDate: "2026-11-20", doneAt: null, ...over };
}

describe("projectVM milestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectSummary).mockResolvedValue(summary);
    vi.mocked(listProjectTasks).mockResolvedValue([]);
  });

  afterEach(() => {
    closeDialog(null);
  });

  it("loads the milestones with the summary", async () => {
    vi.mocked(getProjectSummary).mockResolvedValue({ ...summary, milestones: [milestone()] });
    const vm = createProjectVM();

    await vm.load("p1");

    expect(vm.state.milestones).toEqual([milestone()]);
  });

  it("adds a trimmed milestone and reloads", async () => {
    vi.mocked(createMilestone).mockResolvedValue(milestone());
    const vm = createProjectVM();

    await expect(vm.addMilestone("p1", "  方案评审 ", "2026-11-20")).resolves.toBe(true);

    expect(createMilestone).toHaveBeenCalledWith("p1", "方案评审", "2026-11-20");
    expect(getProjectSummary).toHaveBeenCalledTimes(1);
  });

  it("does not write an empty milestone", async () => {
    const vm = createProjectVM();

    await expect(vm.addMilestone("p1", "   ", "")).resolves.toBe(false);

    expect(createMilestone).not.toHaveBeenCalled();
  });

  it("records a failed milestone write instead of throwing", async () => {
    vi.mocked(createMilestone).mockRejectedValue("empty_milestone_title");
    const vm = createProjectVM();

    await expect(vm.addMilestone("p1", "方案评审", "")).resolves.toBe(false);

    expect(vm.state.milestoneError).toBe("empty_milestone_title");
    expect(getProjectSummary).not.toHaveBeenCalled();
  });

  it("renames, moves and removes through their commands", async () => {
    vi.mocked(renameMilestone).mockResolvedValue();
    vi.mocked(setMilestoneDate).mockResolvedValue();
    vi.mocked(deleteMilestone).mockResolvedValue();
    const vm = createProjectVM();
    const sample = milestone();

    await vm.renameMilestone("p1", sample, " 新名字 ");
    expect(renameMilestone).toHaveBeenCalledWith("m1", "新名字");
    await vm.setMilestoneDate("p1", sample, "");
    expect(setMilestoneDate).toHaveBeenCalledWith("m1", null);
    await vm.removeMilestone("p1", "m1");

    expect(deleteMilestone).toHaveBeenCalledWith("m1");
    expect(getProjectSummary).toHaveBeenCalledTimes(3);
  });

  it("treats a landed add as a success even when the refresh fails", async () => {
    vi.mocked(createMilestone).mockResolvedValue(milestone());
    vi.mocked(getProjectSummary).mockRejectedValue("boom");
    const vm = createProjectVM();

    await expect(vm.addMilestone("p1", "方案评审", "")).resolves.toBe(true);

    expect(vm.state.milestoneError).toBeTruthy();
  });

  it("adds only once while the first add is still saving", async () => {
    let resolve!: (saved: Milestone) => void;
    vi.mocked(createMilestone).mockReturnValue(
      new Promise<Milestone>((done) => {
        resolve = done;
      }),
    );
    const vm = createProjectVM();

    const first = vm.addMilestone("p1", "方案评审", "");
    const second = vm.addMilestone("p1", "方案评审", "");
    resolve(milestone());

    await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
    expect(createMilestone).toHaveBeenCalledTimes(1);
  });

  it("toggles a milestone done and open again", async () => {
    vi.mocked(setMilestoneDone).mockResolvedValue();
    const vm = createProjectVM();

    await vm.toggleMilestone("p1", milestone({ doneAt: null }));
    expect(setMilestoneDone).toHaveBeenCalledWith("m1", true);
    await vm.toggleMilestone("p1", milestone({ doneAt: "2026-10-30T00:00:00Z" }));

    expect(setMilestoneDone).toHaveBeenLastCalledWith("m1", false);
  });

  it("ignores an empty rename", async () => {
    const vm = createProjectVM();

    await expect(vm.renameMilestone("p1", milestone(), "   ")).resolves.toBe(false);

    expect(renameMilestone).not.toHaveBeenCalled();
  });
});

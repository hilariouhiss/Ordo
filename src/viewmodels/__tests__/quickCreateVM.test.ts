import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  capture: vi.fn(),
  aiEnrich: vi.fn(),
  createProject: vi.fn(),
  listProjectGroups: vi.fn(),
  listProjects: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

import { emit } from "@tauri-apps/api/event";
import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { aiEnrich, capture, createProject, listProjectGroups, listProjects } from "../../model/ipc";
import type { Project } from "../../model/types";
import { createQuickCreateVM } from "../quickCreateVM";
import { task } from "./fixtures";

const submission = {
  raw: "写方案 #项目",
  title: "写方案",
  fields: { ...CAPTURE_DEFAULTS, projectId: "p1" },
};

const project: Project = {
  id: "p9",
  name: "新项目",
  groupId: null,
  priority: "normal",
  archivedAt: null,
  members: [],
};

describe("quickCreateVM", () => {
  beforeEach(() => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(listProjectGroups).mockResolvedValue([]);
    vi.mocked(capture).mockResolvedValue(task());
    vi.mocked(aiEnrich).mockResolvedValue(undefined);
    vi.mocked(createProject).mockResolvedValue(project);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens and closes the create modes", () => {
    const vm = createQuickCreateVM();
    vm.openTask();
    expect(vm.state.mode).toBe("task");
    vm.close();
    expect(vm.state.mode).toBeNull();
    vm.openProject();
    expect(vm.state.mode).toBe("project");
  });

  it("creates a task and closes", async () => {
    const vm = createQuickCreateVM();
    vm.openTask();

    await expect(vm.createTask(submission)).resolves.toBe(true);

    expect(capture).toHaveBeenCalledWith("写方案", submission.fields);
    expect(aiEnrich).toHaveBeenCalledWith("t1");
    expect(emit).toHaveBeenCalledWith("capture:created", expect.objectContaining({ id: "t1" }));
    expect(vm.state.mode).toBeNull();
    expect(vm.state.error).toBe("");
  });

  it("keeps the task modal open with the error", async () => {
    vi.mocked(capture).mockRejectedValue(new Error("db down"));
    const vm = createQuickCreateVM();
    vm.openTask();

    await expect(vm.createTask(submission)).resolves.toBe(false);

    expect(vm.state.mode).toBe("task");
    expect(vm.state.error).toContain("db down");
    expect(vm.state.busy).toBe(false);
  });

  it("does not submit an empty title", async () => {
    const vm = createQuickCreateVM();
    vm.openTask();

    await expect(vm.createTask({ ...submission, title: "  " })).resolves.toBe(false);

    expect(capture).not.toHaveBeenCalled();
  });

  it("does not start a second create while one is running", async () => {
    const vm = createQuickCreateVM();
    vm.openTask();

    const first = vm.createTask(submission);
    await expect(vm.createTask(submission)).resolves.toBe(false);
    await expect(first).resolves.toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("creates a project and refreshes the list", async () => {
    const vm = createQuickCreateVM();
    vm.openProject();

    await expect(vm.createProject("  新项目 ")).resolves.toBe(true);

    expect(createProject).toHaveBeenCalledWith("新项目");
    expect(listProjects).toHaveBeenCalled();
    expect(vm.state.mode).toBeNull();
  });

  it("keeps the project modal open with the error", async () => {
    vi.mocked(createProject).mockRejectedValue("empty_project_name");
    const vm = createQuickCreateVM();
    vm.openProject();

    await expect(vm.createProject("x")).resolves.toBe(false);

    expect(vm.state.mode).toBe("project");
    expect(vm.state.error).toBe("empty_project_name");
  });

  it("does not submit an empty project name", async () => {
    const vm = createQuickCreateVM();
    vm.openProject();

    await expect(vm.createProject("   ")).resolves.toBe(false);

    expect(createProject).not.toHaveBeenCalled();
  });
});

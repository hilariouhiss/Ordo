import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  createProject: vi.fn(),
  listProjectGroups: vi.fn(),
  listProjects: vi.fn(),
}));

import { createProject, listProjectGroups, listProjects } from "../../model/ipc";
import type { Project } from "../../model/types";
import { createQuickCreateVM } from "../quickCreateVM";

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
    vi.mocked(createProject).mockResolvedValue(project);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens and closes the project dialog", () => {
    const vm = createQuickCreateVM();
    vm.openProject();
    expect(vm.state.mode).toBe("project");
    vm.close();
    expect(vm.state.mode).toBeNull();
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

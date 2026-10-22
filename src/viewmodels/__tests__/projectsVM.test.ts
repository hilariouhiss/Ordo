import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  bootstrap: vi.fn(),
}));

import { createProject, listProjects } from "../../model/ipc";
import type { ProjectSummary } from "../../model/types";
import { appVM } from "../appVM";
import { createProjectsVM } from "../projectsVM";

const project: ProjectSummary = {
  id: "p1",
  name: "项目",
  dueDate: null,
  total: 0,
  done: 0,
  byCategory: [],
};

describe("projectsVM", () => {
  beforeEach(() => {
    appVM.state.projects = [];
    vi.clearAllMocks();
  });

  it("writes the fetched projects into the shared cache", async () => {
    vi.mocked(listProjects).mockResolvedValue([project]);
    const vm = createProjectsVM();
    await vm.load();
    expect(appVM.state.projects).toEqual([project]);
  });

  it("refreshes the shared cache after create", async () => {
    vi.mocked(createProject).mockResolvedValue({
      id: "p1",
      name: "项目",
      dueDate: null,
      archivedAt: null,
      memberIds: [],
    });
    vi.mocked(listProjects).mockResolvedValue([project]);
    const vm = createProjectsVM();
    await vm.create("项目", null);
    expect(appVM.state.projects).toEqual([project]);
  });
});

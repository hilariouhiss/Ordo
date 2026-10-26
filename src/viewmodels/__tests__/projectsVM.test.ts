import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  listProjectGroups: vi.fn(),
  createProjectGroup: vi.fn(),
  renameProjectGroup: vi.fn(),
  deleteProjectGroup: vi.fn(),
  bootstrap: vi.fn(),
}));

import {
  createProject,
  createProjectGroup,
  deleteProjectGroup,
  listProjectGroups,
  listProjects,
  renameProjectGroup,
} from "../../model/ipc";
import type { Project, ProjectGroup, ProjectSummary } from "../../model/types";
import { appVM } from "../appVM";
import { createProjectsVM } from "../projectsVM";

const project: ProjectSummary = {
  id: "p1",
  name: "项目",
  groupId: null,
  total: 0,
  done: 0,
  byCategory: [],
};

const group: ProjectGroup = { id: "g1", name: "甲方 A" };

const created: Project = {
  id: "p1",
  name: "项目",
  groupId: null,
  archivedAt: null,
  memberIds: [],
};

describe("projectsVM", () => {
  beforeEach(() => {
    appVM.state.projects = [];
    vi.clearAllMocks();
    vi.mocked(listProjectGroups).mockResolvedValue([]);
  });

  it("writes fetched projects and groups into the VM", async () => {
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(listProjectGroups).mockResolvedValue([group]);
    const vm = createProjectsVM();

    await vm.load();

    expect(appVM.state.projects).toEqual([project]);
    expect(vm.state.groups).toEqual([group]);
  });

  it("refreshes the shared cache after create", async () => {
    vi.mocked(createProject).mockResolvedValue(created);
    vi.mocked(listProjects).mockResolvedValue([project]);
    const vm = createProjectsVM();

    await vm.create("项目");

    expect(createProject).toHaveBeenCalledWith("项目");
    expect(appVM.state.projects).toEqual([project]);
  });

  it("ignores a second create while the first is pending", async () => {
    let resolve!: (value: Project) => void;
    vi.mocked(createProject).mockReturnValue(
      new Promise<Project>((done) => {
        resolve = done;
      }),
    );
    vi.mocked(listProjects).mockResolvedValue([project]);
    const vm = createProjectsVM();

    const first = vm.create("项目");
    const second = vm.create("项目");
    resolve(created);
    await Promise.all([first, second]);

    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it("trims and reloads after creating a group", async () => {
    vi.mocked(createProjectGroup).mockResolvedValue(group);
    vi.mocked(listProjects).mockResolvedValue([]);
    const vm = createProjectsVM();

    const createdGroup = await vm.createGroup(" 甲方 A ");

    expect(createdGroup).toEqual(group);
    expect(createProjectGroup).toHaveBeenCalledWith("甲方 A");
    expect(listProjectGroups).toHaveBeenCalledTimes(1);
  });

  it("renames a group and reloads", async () => {
    vi.mocked(renameProjectGroup).mockResolvedValue();
    vi.mocked(listProjects).mockResolvedValue([]);
    const vm = createProjectsVM();

    await vm.renameGroup("g1", "甲方 B");

    expect(renameProjectGroup).toHaveBeenCalledWith("g1", "甲方 B");
    expect(listProjectGroups).toHaveBeenCalledTimes(1);
  });

  it("deletes a group and reloads", async () => {
    vi.mocked(deleteProjectGroup).mockResolvedValue();
    vi.mocked(listProjects).mockResolvedValue([]);
    const vm = createProjectsVM();

    await vm.removeGroup("g1");

    expect(deleteProjectGroup).toHaveBeenCalledWith("g1");
    expect(listProjectGroups).toHaveBeenCalledTimes(1);
  });
});

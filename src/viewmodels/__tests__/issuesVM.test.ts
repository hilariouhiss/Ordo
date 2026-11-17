import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  listIssues: vi.fn(),
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  deleteIssue: vi.fn(),
  createIssueTask: vi.fn(),
  updateTaskPatch: vi.fn(),
}));

import * as ipc from "../../model/ipc";
import type { Issue } from "../../model/types";
import { createIssuesVM } from "../issuesVM";
import { task } from "./fixtures";

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    projectId: "p1",
    number: "ISS-001",
    requirementId: null,
    title: "接口文档不一致",
    note: null,
    status: "open",
    createdAt: "2026-11-17T01:00:00Z",
    resolvedAt: null,
    tasks: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.listIssues).mockResolvedValue([issue()]);
});

describe("issuesVM", () => {
  it("loads the project's issues", async () => {
    const vm = createIssuesVM();

    await vm.load("p1");

    expect(vm.state.issues[0]?.number).toBe("ISS-001");
  });

  it("passes a status and a note through the patch", async () => {
    vi.mocked(ipc.updateIssue).mockResolvedValue(issue({ status: "doing" }));
    const vm = createIssuesVM();
    await vm.load("p1");

    await vm.update("i1", { status: "doing", note: " 对齐接口文档 " });

    expect(ipc.updateIssue).toHaveBeenCalledWith("i1", {
      status: "doing",
      note: " 对齐接口文档 ",
    });
  });

  it("links a task to the issue through the task patch", async () => {
    vi.mocked(ipc.updateTaskPatch).mockResolvedValue(task({ id: "t1" }));
    const vm = createIssuesVM();
    await vm.load("p1");

    await vm.linkTask("t1", "i1");
    expect(ipc.updateTaskPatch).toHaveBeenCalledWith("t1", { issueId: "i1" });
  });

  it("creates an issue task and reloads", async () => {
    vi.mocked(ipc.createIssueTask).mockResolvedValue(task({ id: "t2" }));
    const vm = createIssuesVM();
    await vm.load("p1");

    const ok = await vm.createTask("i1", " 对齐接口文档 ");

    expect(ok).toBe(true);
    expect(ipc.createIssueTask).toHaveBeenCalledWith("i1", "对齐接口文档");
    expect(ipc.listIssues).toHaveBeenCalledTimes(2);
  });
});

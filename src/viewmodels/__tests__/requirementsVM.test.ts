import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  listRequirementStatuses: vi.fn(),
  listRequirements: vi.fn(),
  listProjectDocuments: vi.fn(),
  createRequirement: vi.fn(),
  updateRequirement: vi.fn(),
  deleteRequirement: vi.fn(),
  advanceRequirement: vi.fn(),
  linkRequirementSection: vi.fn(),
  unlinkRequirementSection: vi.fn(),
  updateTaskPatch: vi.fn(),
  createRequirementTask: vi.fn(),
  saveRequirementStatuses: vi.fn(),
  createRequirementFromSection: vi.fn(),
  importDocument: vi.fn(),
  getDocument: vi.fn(),
  deleteDocument: vi.fn(),
  listRequirementChanges: vi.fn(),
}));
vi.mock("../../lib/fileBytes", () => ({ readBase64: vi.fn().mockResolvedValue("") }));

import * as ipc from "../../model/ipc";
import type {
  ProjectDocument,
  ProjectDocumentDetail,
  Requirement,
  RequirementStatus,
} from "../../model/types";
import { createRequirementsVM } from "../requirementsVM";
import { task } from "./fixtures";

const status: RequirementStatus = { id: "s1", name: "待办" };

function requirement(over: Partial<Requirement> = {}): Requirement {
  return {
    id: "r1",
    projectId: "p1",
    number: "REQ-001",
    title: "导出报表",
    statusId: "s1",
    categoryId: null,
    ownerId: null,
    sections: [],
    tasks: [],
    issues: [],
    ...over,
  };
}

function document(): ProjectDocument {
  return { id: "d1", title: "附件", sourceName: "附件.md", sections: [] };
}

function detail(): ProjectDocumentDetail {
  return {
    id: "d1",
    title: "附件",
    sourceName: "附件.md",
    sections: [{ id: "sec1", title: "范围", level: 1, body: "正文", requirements: [] }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.listRequirementStatuses).mockResolvedValue([status]);
  vi.mocked(ipc.listRequirements).mockResolvedValue([requirement()]);
  vi.mocked(ipc.listProjectDocuments).mockResolvedValue([document()]);
});

describe("requirementsVM", () => {
  it("loads the pipeline, the requirements and the document outlines together", async () => {
    const vm = createRequirementsVM();

    await vm.load("p1");

    expect(vm.state.statuses).toEqual([status]);
    expect(vm.state.requirements[0]?.number).toBe("REQ-001");
    expect(vm.state.documents[0]?.title).toBe("附件");
  });

  it("trims a new requirement and reloads the tab", async () => {
    vi.mocked(ipc.createRequirement).mockResolvedValue(requirement());
    const vm = createRequirementsVM();
    await vm.load("p1");

    const ok = await vm.add("p1", "  新需求  ");

    expect(ok).toBe(true);
    expect(ipc.createRequirement).toHaveBeenCalledWith("p1", "新需求");
    expect(ipc.listRequirements).toHaveBeenCalledTimes(2);
  });

  it("links and unlinks a task through the task patch", async () => {
    vi.mocked(ipc.updateTaskPatch).mockResolvedValue(task({ id: "t1" }));
    const vm = createRequirementsVM();
    await vm.load("p1");

    await vm.linkTask("r1", "t1");
    expect(ipc.updateTaskPatch).toHaveBeenCalledWith("t1", { requirementId: "r1" });

    await vm.unlinkTask("t1");
    expect(ipc.updateTaskPatch).toHaveBeenCalledWith("t1", { requirementId: null });
  });

  it("refuses an upload over the shared limit before reading it", async () => {
    const vm = createRequirementsVM();
    await vm.load("p1");

    const ok = await vm.upload("p1", { name: "big.pdf", size: 99 * 1024 * 1024 } as File);

    expect(ok).toBe(false);
    expect(vm.state.error).toBe("document_too_large");
    expect(ipc.importDocument).not.toHaveBeenCalled();
  });

  it("creates from a selection, closes the reader and focuses the new requirement", async () => {
    vi.mocked(ipc.getDocument).mockResolvedValue(detail());
    vi.mocked(ipc.createRequirementFromSection).mockResolvedValue(
      requirement({ id: "r2", title: "按列导出" }),
    );
    const vm = createRequirementsVM();
    await vm.load("p1");
    await vm.openDocument("d1");

    const ok = await vm.createFromSection("sec1", "按列导出", "按列导出，列由用户选择");

    expect(ok).toBe(true);
    expect(ipc.createRequirementFromSection).toHaveBeenCalledWith(
      "sec1",
      "按列导出",
      "按列导出，列由用户选择",
    );
    expect(vm.state.openDocumentId).toBeNull();
    expect(vm.state.focusRequirementId).toBe("r2");
  });

  it("saves the pipeline entries in their edited order", async () => {
    vi.mocked(ipc.saveRequirementStatuses).mockResolvedValue([status]);
    const vm = createRequirementsVM();
    await vm.load("p1");

    await vm.saveStatuses([
      { id: "s1", name: "待办" },
      { id: null, name: "  验收  " },
    ]);

    expect(ipc.saveRequirementStatuses).toHaveBeenCalledWith("p1", [
      { id: "s1", name: "待办" },
      { id: null, name: "验收" },
    ]);
  });
});

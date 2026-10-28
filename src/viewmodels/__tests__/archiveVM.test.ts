import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  archiveTask: vi.fn(),
  bootstrap: vi.fn(),
  createProject: vi.fn(),
  createProjectGroup: vi.fn(),
  deleteProject: vi.fn(),
  deleteProjectGroup: vi.fn(),
  deleteTask: vi.fn(),
  listArchive: vi.fn(),
  listProjectGroups: vi.fn(),
  listProjects: vi.fn(),
  renameProjectGroup: vi.fn(),
  restoreProject: vi.fn(),
  restoreTask: vi.fn(),
  setProjectGroup: vi.fn(),
}));

import { closeDialog, dialogRequest } from "../../lib/dialog";
import { t } from "../../lib/i18n";
import { listArchive, restoreTask } from "../../model/ipc";
import { createArchiveVM } from "../archiveVM";

const empty = { projects: [], tasks: [], canceled: [], done: [] };

describe("archiveVM", () => {
  afterEach(() => {
    closeDialog(null);
    vi.clearAllMocks();
  });

  it("reports a failed restore and does not reload the archive", async () => {
    vi.mocked(restoreTask).mockRejectedValue("boom");

    const vm = createArchiveVM();
    await vm.restore("t1");

    expect(dialogRequest.value?.kind).toBe("notice");
    expect(listArchive).not.toHaveBeenCalled();
  });

  it("reloads after a successful restore", async () => {
    vi.mocked(restoreTask).mockResolvedValue({ id: "t1" } as never);
    vi.mocked(listArchive).mockResolvedValue(empty);

    const vm = createArchiveVM();
    await vm.restore("t1");

    expect(listArchive).toHaveBeenCalledTimes(1);
    expect(dialogRequest.value).toBeNull();
  });

  it("reports a refresh failure without calling the action failed", async () => {
    vi.mocked(restoreTask).mockResolvedValue({ id: "t1" } as never);
    vi.mocked(listArchive).mockRejectedValue("db");

    const vm = createArchiveVM();
    await vm.restore("t1");

    expect(dialogRequest.value?.kind).toBe("notice");
    expect(dialogRequest.value?.title).toBe(t("common.refreshFailed"));
  });
});

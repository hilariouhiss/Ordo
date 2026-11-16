import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  capture: vi.fn(),
  aiEnrich: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

import { emit } from "@tauri-apps/api/event";
import { aiEnrich, capture } from "../../model/ipc";
import { createTaskCreateVM } from "../taskCreateVM";
import { task } from "./fixtures";

describe("taskCreateVM", () => {
  beforeEach(() => {
    vi.mocked(capture).mockResolvedValue(task());
    vi.mocked(aiEnrich).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves a finished task with its actual day, effort and attributes", async () => {
    const vm = createTaskCreateVM();
    vm.open();
    vm.state.form.title = "补回归清单";
    vm.state.form.status = "done";
    vm.state.form.expectedStartDate = "2026-11-13";
    vm.state.form.effortMinutes = 480;
    vm.state.form.actualStartDate = "2026-11-13";
    vm.state.form.actualEffortMinutes = 150;
    vm.state.form.categoryId = "c1";
    vm.state.form.tags = ["上线"];
    vm.state.form.note = "已经和测试过完";
    vm.state.form.exclusive = false;

    await expect(vm.save()).resolves.toBe(true);

    expect(capture).toHaveBeenCalledWith(
      "补回归清单",
      expect.objectContaining({
        expectedStartDate: "2026-11-13",
        actualStartDate: "2026-11-13",
        actualEffortMinutes: 150,
        categoryId: "c1",
        tags: ["上线"],
        note: "已经和测试过完",
        exclusive: false,
      }),
      null,
      true,
    );
    expect(vm.state.open).toBe(false);
    expect(emit).toHaveBeenCalledWith("capture:created", expect.objectContaining({ id: "t1" }));
  });

  it("a plain new task carries only the plan", async () => {
    const vm = createTaskCreateVM();
    vm.open();
    vm.state.form.title = "写方案";

    await expect(vm.save()).resolves.toBe(true);

    expect(capture).toHaveBeenCalledWith(
      "写方案",
      expect.objectContaining({ actualStartDate: null, actualEffortMinutes: null }),
      null,
      false,
    );
  });

  it("does not save an empty title", async () => {
    const vm = createTaskCreateVM();
    vm.open();
    vm.state.form.title = "   ";

    await expect(vm.save()).resolves.toBe(false);

    expect(capture).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the error", async () => {
    vi.mocked(capture).mockRejectedValue(new Error("db down"));
    const vm = createTaskCreateVM();
    vm.open();
    vm.state.form.title = "写方案";

    await expect(vm.save()).resolves.toBe(false);

    expect(vm.state.open).toBe(true);
    expect(vm.state.error).toContain("db down");
  });
});

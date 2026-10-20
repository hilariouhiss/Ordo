import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({ capture: vi.fn(), listWeek: vi.fn() }));

import { capture, listWeek } from "../../model/ipc";
import { createWeekVM } from "../weekVM";
import { task } from "./fixtures";

describe("weekVM", () => {
  it("capture stores the task and clears the draft", async () => {
    vi.mocked(listWeek).mockResolvedValue([]);
    vi.mocked(capture).mockResolvedValue(task({ id: "t1", title: "周五前把软件方案评审发老李" }));

    const vm = createWeekVM();
    await vm.load();
    vm.state.draft = "周五前把软件方案评审发老李";
    await vm.capture(vm.state.draft);

    expect(vm.state.tasks[0].id).toBe("t1");
    expect(vm.state.draft).toBe("");
  });

  it("ignores a blank draft", async () => {
    const vm = createWeekVM();
    await vm.capture("   ");
    expect(capture).not.toHaveBeenCalled();
  });
});

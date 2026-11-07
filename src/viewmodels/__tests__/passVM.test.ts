import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  passQueue: vi.fn(),
  passResolve: vi.fn(),
  markPassDone: vi.fn(),
}));

import { markPassDone, passQueue, passResolve } from "../../model/ipc";
import { appVM } from "../appVM";
import { createPassVM } from "../passVM";
import { defaultSettings, task } from "./fixtures";

describe("passVM", () => {
  it("resolves the current card and advances", async () => {
    vi.mocked(passQueue).mockResolvedValue([task({ id: "t1" }), task({ id: "t2" })]);
    vi.mocked(passResolve).mockResolvedValue(task({ id: "t1" }));

    const vm = createPassVM();
    await vm.start();
    expect(vm.current.value?.id).toBe("t1");

    await vm.resolve("keep");
    expect(passResolve).toHaveBeenCalledWith("t1", "keep", null, null);
    expect(vm.state.index).toBe(1);
    expect(vm.current.value?.id).toBe("t2");
  });

  it("passes a suspend reason with an optional date", async () => {
    vi.mocked(passQueue).mockResolvedValue([task({ id: "t1" })]);
    vi.mocked(passResolve).mockResolvedValue(task({ id: "t1" }));

    const vm = createPassVM();
    await vm.start();
    await vm.resolve("suspend", null, "等甲方");

    expect(passResolve).toHaveBeenCalledWith("t1", "suspend", null, "等甲方");
  });

  it("counts a wait and advances without asking the backend again", async () => {
    vi.mocked(passQueue).mockResolvedValue([task({ id: "t1" }), task({ id: "t2" })]);

    const vm = createPassVM();
    await vm.start();

    vm.markWaiting();

    expect(vm.state.counts.wait).toBe(1);
    expect(vm.state.index).toBe(1);
    expect(vm.current.value?.id).toBe("t2");
  });

  it("does not open the pass when there is nothing to go through", async () => {
    vi.mocked(passQueue).mockResolvedValue([]);

    const vm = createPassVM();
    await vm.start();
    expect(vm.state.open).toBe(false);
  });

  it("resets the counts when a pass reopens", async () => {
    vi.mocked(passQueue).mockResolvedValue([task({ id: "t1" }), task({ id: "t2" })]);
    vi.mocked(passResolve).mockResolvedValue(task({ id: "t1" }));

    const vm = createPassVM();
    await vm.start();
    await vm.resolve("keep");
    expect(vm.state.counts.keep).toBe(1);

    vm.close();
    await vm.start();

    expect(vm.state.counts.keep).toBe(0);
  });

  it("keeps the week the service cleared, so the Monday banner stays quiet", async () => {
    vi.mocked(passQueue).mockResolvedValue([task({ id: "t1" })]);
    vi.mocked(markPassDone).mockResolvedValue("2026-10-26");
    appVM.state.settings = { ...defaultSettings, lastPassWeek: "2026-10-19" };

    const vm = createPassVM();
    await vm.start();
    await vm.finish();

    expect(appVM.state.settings?.lastPassWeek).toBe("2026-10-26");
    expect(vm.state.open).toBe(false);
  });

  it("split returns the current card without advancing", async () => {
    vi.mocked(passQueue).mockResolvedValue([task({ id: "t1" }), task({ id: "t2" })]);

    const vm = createPassVM();
    await vm.start();
    expect(vm.splitCurrent()?.id).toBe("t1");
    expect(vm.state.index).toBe(0);
  });
});

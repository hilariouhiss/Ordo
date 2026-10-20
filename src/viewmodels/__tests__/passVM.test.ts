import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  passQueue: vi.fn(),
  passResolve: vi.fn(),
  markPassDone: vi.fn(),
}));

import { passQueue, passResolve } from "../../model/ipc";
import { createPassVM } from "../passVM";
import { task } from "./fixtures";

describe("passVM", () => {
  it("resolves the current card and advances", async () => {
    vi.mocked(passQueue).mockResolvedValue([task({ id: "t1" }), task({ id: "t2" })]);
    vi.mocked(passResolve).mockResolvedValue(task({ id: "t1" }));

    const vm = createPassVM();
    await vm.start();
    expect(vm.current.value?.id).toBe("t1");

    await vm.resolve("keep");
    expect(passResolve).toHaveBeenCalledWith("t1", "keep", null);
    expect(vm.state.index).toBe(1);
    expect(vm.current.value?.id).toBe("t2");
  });

  it("does not open the pass when there is nothing to go through", async () => {
    vi.mocked(passQueue).mockResolvedValue([]);

    const vm = createPassVM();
    await vm.start();
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

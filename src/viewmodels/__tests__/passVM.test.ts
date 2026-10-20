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
});

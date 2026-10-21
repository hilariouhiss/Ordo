import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({ capture: vi.fn(), aiEnrich: vi.fn() }));

import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { capture } from "../../model/ipc";
import { createCaptureVM } from "../captureVM";
import { task } from "./fixtures";

describe("captureVM", () => {
  it("saves and hides after a short delay", async () => {
    vi.useFakeTimers();
    vi.mocked(capture).mockResolvedValue(task({ id: "t1" }));
    const hide = vi.fn();
    const vm = createCaptureVM();

    await vm.save("买螺丝", CAPTURE_DEFAULTS, hide);
    expect(capture).toHaveBeenCalledWith("买螺丝", CAPTURE_DEFAULTS);
    expect(vm.state.saved).toBe(true);
    expect(hide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(800);
    expect(hide).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

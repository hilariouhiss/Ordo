import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({ capture: vi.fn(), aiEnrich: vi.fn() }));

import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { capture } from "../../model/ipc";
import type { Task } from "../../model/types";
import { createCaptureVM } from "../captureVM";
import { task } from "./fixtures";

describe("captureVM", () => {
  it("saves and hides after a short delay", async () => {
    vi.useFakeTimers();
    vi.mocked(capture).mockResolvedValue(task({ id: "t1" }));
    const hide = vi.fn();
    const vm = createCaptureVM();

    await expect(vm.save("买螺丝", CAPTURE_DEFAULTS, hide)).resolves.toBe(true);
    expect(capture).toHaveBeenCalledWith("买螺丝", CAPTURE_DEFAULTS);
    expect(vm.state.saved).toBe(true);
    expect(hide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(800);
    expect(hide).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("ignores a second save while the first is pending", async () => {
    vi.useFakeTimers();
    let resolve!: (value: Task) => void;
    vi.mocked(capture).mockReturnValue(
      new Promise<Task>((done) => {
        resolve = done;
      }),
    );
    const hide = vi.fn();
    const vm = createCaptureVM();

    const first = vm.save("买螺丝", CAPTURE_DEFAULTS, hide);
    const second = vm.save("买螺丝", CAPTURE_DEFAULTS, hide);
    resolve(task({ id: "t1" }));
    const results = await Promise.all([first, second]);

    expect(results).toEqual([true, false]);
    expect(capture).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(800);
    vi.useRealTimers();
  });
});

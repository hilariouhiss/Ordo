import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({ setSettings: vi.fn(), setMode: vi.fn() }));

import { setMode, setSettings } from "../../model/ipc";
import { createSettingsVM } from "../settingsVM";
import { defaultSettings } from "./fixtures";

describe("settingsVM", () => {
  it("passes the reminder options through to the backend", async () => {
    vi.mocked(setSettings).mockResolvedValue({
      ...defaultSettings,
      remindersLeadMinutes: 30,
      remindersDigest: false,
    });
    const vm = createSettingsVM();

    await expect(vm.save({ remindersLeadMinutes: 30, remindersDigest: false })).resolves.toBe(true);
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith({
      remindersLeadMinutes: 30,
      remindersDigest: false,
    });
  });

  it("switches the mode through the dedicated command", async () => {
    vi.mocked(setMode).mockResolvedValue({ ...defaultSettings, mode: "personal" });
    const vm = createSettingsVM();

    await expect(vm.switchMode("personal")).resolves.toBe(true);

    expect(vi.mocked(setMode)).toHaveBeenCalledWith("personal");
  });
});

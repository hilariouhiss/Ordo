import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({ setSettings: vi.fn() }));

import { setSettings } from "../../model/ipc";
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
});

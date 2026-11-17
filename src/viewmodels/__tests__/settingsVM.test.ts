import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  setSettings: vi.fn(),
  setMode: vi.fn(),
}));

vi.mock("../../lib/dialog", () => ({
  askNotice: vi.fn(),
  askNoticeOptOut: vi.fn(),
}));

import { askNoticeOptOut } from "../../lib/dialog";
import { setMode, setSettings } from "../../model/ipc";
import { appVM } from "../appVM";
import { createSettingsVM } from "../settingsVM";
import { defaultSettings } from "./fixtures";

beforeEach(() => {
  vi.clearAllMocks();
  appVM.state.settings = { ...defaultSettings };
});

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

  it("勾选「不再提示」后把开关写回设置", async () => {
    vi.mocked(setMode).mockResolvedValue({ ...defaultSettings, mode: "personal" });
    vi.mocked(askNoticeOptOut).mockResolvedValue(true);
    vi.mocked(setSettings).mockResolvedValue({
      ...defaultSettings,
      mode: "personal",
      modeHintDismissed: true,
    });
    const vm = createSettingsVM();

    await expect(vm.switchMode("personal")).resolves.toBe(true);

    expect(vi.mocked(askNoticeOptOut)).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      true,
    );
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith({ modeHintDismissed: true });
  });

  it("已经勾过不再提示时切换不再弹", async () => {
    vi.mocked(setMode).mockResolvedValue({
      ...defaultSettings,
      mode: "personal",
      modeHintDismissed: true,
    });
    const vm = createSettingsVM();

    await expect(vm.switchMode("personal")).resolves.toBe(true);

    expect(vi.mocked(askNoticeOptOut)).not.toHaveBeenCalled();
  });
});

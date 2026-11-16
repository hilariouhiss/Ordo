import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/** What `check()` answers with; each test swaps it. */
const checkMock = vi.fn();
const relaunchMock = vi.fn();
const getVersionMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...args: unknown[]) => getVersionMock(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));

import { createUpdatesVM, updateAction } from "../updatesVM";

/** A stand-in for the plugin's `Update`: records what was called on it. */
function fakeUpdate(version = "0.2.1") {
  const download = vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
    onEvent({ event: "Started", data: { contentLength: 1000 } });
    onEvent({ event: "Progress", data: { chunkLength: 400 } });
    onEvent({ event: "Progress", data: { chunkLength: 600 } });
    onEvent({ event: "Finished" });
  });
  const install = vi.fn(async () => {});
  const close = vi.fn();
  return { version, download, install, close };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("DEV", false);
  getVersionMock.mockResolvedValue("0.2.0");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("检查", () => {
  it("没有更新时回到 idle，记下检查时间", async () => {
    checkMock.mockResolvedValue(null);
    const vm = createUpdatesVM();

    await expect(vm.checkNow()).resolves.toBe("none");

    expect(vm.state.phase).toBe("idle");
    expect(vm.state.checkedAt).toBeTypeOf("number");
    expect(vm.state.error).toBeNull();
  });

  it("发现更新后卡片可见", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const vm = createUpdatesVM();

    await expect(vm.checkNow()).resolves.toBe("available");

    expect(vm.state.phase).toBe("available");
    expect(vm.state.version).toBe("0.2.1");
    expect(vm.visible.value).toBe(true);
  });

  it("检查失败只记错误，不抛给调用方", async () => {
    checkMock.mockRejectedValue(new Error("network down"));
    const vm = createUpdatesVM();

    await expect(vm.checkNow()).resolves.toBe("failed");

    expect(vm.state.phase).toBe("failed");
    expect(vm.state.error).toContain("network down");
  });

  it("开发构建里整条流程关闭", async () => {
    vi.stubEnv("DEV", true);
    const vm = createUpdatesVM();

    await expect(vm.checkNow()).resolves.toBe("disabled");
    expect(await vm.install()).toBe(false);
    expect(checkMock).not.toHaveBeenCalled();
  });
});

describe("关于页的按钮", () => {
  it("有版本时做安装，检查失败时回到检查", () => {
    expect(updateAction("available", true)).toBe("install");
    expect(updateAction("ready", true)).toBe("install");
    expect(updateAction("downloading", true)).toBe("install");
    expect(updateAction("installing", true)).toBe("install");
    expect(updateAction("failed", true)).toBe("check");
    expect(updateAction("idle", false)).toBe("check");
    expect(updateAction("checking", false)).toBe("check");
  });
});

describe("卡片", () => {
  it("关掉后同一版本本次运行不再出现，更高版本重新出现", async () => {
    checkMock.mockResolvedValue(fakeUpdate("0.2.1"));
    const vm = createUpdatesVM();
    await vm.checkNow();

    vm.dismiss();
    expect(vm.visible.value).toBe(false);

    checkMock.mockResolvedValue(fakeUpdate("0.2.2"));
    await vm.checkNow();

    expect(vm.state.version).toBe("0.2.2");
    expect(vm.visible.value).toBe(true);
  });
});

describe("安装", () => {
  it("先下载报进度，再安装并重启", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const vm = createUpdatesVM();
    await vm.checkNow();

    const seen: (number | null)[] = [];
    update.download.mockImplementationOnce(async (onEvent: (event: DownloadEvent) => void) => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      seen.push(vm.state.percent);
      onEvent({ event: "Progress", data: { chunkLength: 400 } });
      seen.push(vm.state.percent);
      onEvent({ event: "Progress", data: { chunkLength: 600 } });
      seen.push(vm.state.percent);
      onEvent({ event: "Finished" });
    });

    await expect(vm.install()).resolves.toBe(true);

    expect(seen).toEqual([0, 40, 100]);
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });

  it("下载失败停在 failed，不安装也不重启", async () => {
    const update = fakeUpdate();
    update.download.mockRejectedValueOnce(new Error("disk full"));
    checkMock.mockResolvedValue(update);
    const vm = createUpdatesVM();
    await vm.checkNow();

    await expect(vm.install()).resolves.toBe(false);

    expect(vm.state.phase).toBe("failed");
    expect(vm.state.error).toContain("disk full");
    expect(update.install).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("已下载过的版本重检时保留，不会重下", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const vm = createUpdatesVM();
    await vm.checkNow();
    await vm.install();
    const callsAfterInstall = update.download.mock.calls.length;

    checkMock.mockResolvedValue(fakeUpdate("0.2.1"));
    await vm.checkNow();

    expect(update.download.mock.calls.length).toBe(callsAfterInstall);
  });
});

describe("自动检查", () => {
  it("开发构建里什么都不做", async () => {
    vi.stubEnv("DEV", true);
    const vm = createUpdatesVM();

    const dispose = vm.start(true);
    await flush();

    expect(checkMock).not.toHaveBeenCalled();
    dispose();
  });

  it("关掉自动检查时不排检查，打开后从 3 秒起算", async () => {
    vi.useFakeTimers();
    checkMock.mockResolvedValue(null);
    const vm = createUpdatesVM();

    const dispose = vm.start(false);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(checkMock).not.toHaveBeenCalled();

    vm.applyAutoCheck(true);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(checkMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(checkMock).toHaveBeenCalledTimes(1);

    vm.applyAutoCheck(false);
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(checkMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("启动 3 秒后检查一次，之后每 6 小时一次，dispose 后停止", async () => {
    vi.useFakeTimers();
    checkMock.mockResolvedValue(null);
    const vm = createUpdatesVM();

    const dispose = vm.start(true);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(checkMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(checkMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(checkMock).toHaveBeenCalledTimes(2);

    dispose();
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(checkMock).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifications } from "../../../common/stores/notifications";

/** What `check()` answers with; each test swaps it. */
const checkMock = vi.fn();
const relaunchMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

import {
  AUTO_DOWNLOAD_STORAGE_KEY,
  automaticDownload,
  checkNow,
  dismissPrompt,
  resetUpdates,
  setAutoDownload,
  startAutoUpdate,
  startUpdate,
  updateState,
} from "../updates";

/** A stand-in for the plugin's `Update`: records what was called on it. */
function fakeUpdate(version = "0.1.5") {
  const download = vi.fn(async (onEvent: (event: unknown) => void) => {
    onEvent({ event: "Started", data: { contentLength: 1000 } });
    onEvent({ event: "Progress", data: { chunkLength: 400 } });
    onEvent({ event: "Progress", data: { chunkLength: 600 } });
    onEvent({ event: "Finished", data: {} });
  });
  const install = vi.fn(async () => {});
  return { version, body: "notes", date: "2026-09-24T00:00:00Z", download, install };
}

/** Lets the flow's promises settle (mock timers are off unless a test says so). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("DEV", false);
  localStorage.clear();
  resetUpdates();
});

afterEach(() => {
  resetUpdates();
  localStorage.clear();
  vi.useRealTimers();
});

describe("自动检查的启动条件", () => {
  it("dev 构建下整条流程都不启动", async () => {
    vi.stubEnv("DEV", true);

    const dispose = startAutoUpdate();
    await flush();

    expect(checkMock).not.toHaveBeenCalled();
    expect(updateState().phase).toBe("idle");
    dispose();
  });

  it("打包构建下启动时检查一次，之后每 6 小时一次", async () => {
    vi.useFakeTimers();
    checkMock.mockResolvedValue(null);

    const dispose = startAutoUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(checkMock).toHaveBeenCalledTimes(2);

    dispose();
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it("检查失败只记录，不打扰用户", async () => {
    checkMock.mockRejectedValue(new Error("network down"));

    const dispose = startAutoUpdate();
    await flush();

    expect(updateState().phase).toBe("failed");
    expect(updateState().error).toContain("network down");
    // 自动路径的失败不进 toast：那是每次断网都会弹一次的东西。
    expect(notifications()).toHaveLength(0);
    dispose();
  });

  it("没有更新时回到 idle 并记下检查时间", async () => {
    checkMock.mockResolvedValue(null);

    const dispose = startAutoUpdate();
    await flush();

    expect(updateState().phase).toBe("idle");
    expect(updateState().checkedAt).toBeTypeOf("number");
    dispose();
  });
});

describe("发现更新之后", () => {
  it("默认静默下好，但一步都不装", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await flush();

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(updateState().phase).toBe("ready");
    expect(updateState().version).toBe("0.1.5");
    expect(updateState().percent).toBe(100);
    // 安装只在用户点「更新」之后发生：没有倒计时，也没有自动重启。
    expect(update.install).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    dispose();
  });

  it("关掉静默下载后只停在 available，一个字节都不下", async () => {
    setAutoDownload(false);
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await flush();

    expect(update.download).not.toHaveBeenCalled();
    expect(updateState().phase).toBe("available");
    expect(updateState().version).toBe("0.1.5");
    dispose();
  });

  it("点「更新」时若还没下载，先下载再安装重启", async () => {
    setAutoDownload(false);
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await flush();
    expect(await startUpdate()).toBe(true);

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("已下载时点「更新」直接安装，不重复下载", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await flush();
    expect(await startUpdate()).toBe(true);

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("下载失败就不安装，并留下原因", async () => {
    setAutoDownload(false);
    const update = fakeUpdate();
    update.download.mockRejectedValue(new Error("network down"));
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await flush();

    expect(await startUpdate()).toBe(false);
    expect(update.install).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(updateState().phase).toBe("failed");
    expect(updateState().error).toContain("network down");
    dispose();
  });

  it("安装失败时留在能看见的状态里，且不重启", async () => {
    const update = fakeUpdate();
    update.install.mockRejectedValue(new Error("installer refused"));
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await flush();

    expect(await startUpdate()).toBe(false);
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(updateState().phase).toBe("failed");
    expect(updateState().error).toContain("installer refused");
    dispose();
  });

  it("「稍后」之后同一个版本保持安静，也不会反复重下", async () => {
    vi.useFakeTimers();
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await vi.advanceTimersByTimeAsync(0);
    dismissPrompt();
    expect(updateState().dismissedVersion).toBe("0.1.5");

    // 六小时后再检查：还是同一个版本，已经下好的东西留着。
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(updateState().dismissedVersion).toBe("0.1.5");

    // 更新的版本出现时，安静状态解除。
    checkMock.mockResolvedValue(fakeUpdate("0.1.6"));
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(updateState().dismissedVersion).toBeNull();
    expect(updateState().version).toBe("0.1.6");
    dispose();
  });
});

describe("静默下载这个设置", () => {
  it("默认开启，并写进 localStorage", () => {
    expect(automaticDownload()).toBe(true);

    setAutoDownload(false);
    expect(automaticDownload()).toBe(false);
    expect(localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY)).toBe("0");

    setAutoDownload(true);
    expect(localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY)).toBe("1");
  });

  it("下次启动沿用上次的选择", async () => {
    localStorage.setItem(AUTO_DOWNLOAD_STORAGE_KEY, "0");
    vi.resetModules();

    const fresh = await import("../updates");

    expect(fresh.automaticDownload()).toBe(false);
    fresh.resetUpdates();
  });
});

describe("手动检查", () => {
  it("dev 下被关掉，并告诉调用方为什么", async () => {
    vi.stubEnv("DEV", true);

    expect(await checkNow()).toBe("disabled");
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("打包构建下把结果交回调用方", async () => {
    checkMock.mockResolvedValue(null);
    expect(await checkNow()).toBe("none");

    checkMock.mockResolvedValue(fakeUpdate());
    expect(await checkNow()).toBe("available");

    checkMock.mockRejectedValue(new Error("offline"));
    expect(await checkNow()).toBe("failed");
    expect(updateState().error).toContain("offline");
  });
});

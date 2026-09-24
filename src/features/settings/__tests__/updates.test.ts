import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifications } from "../../../common/stores/notifications";
import { openDialogCount, registerDialog } from "../../../common/stores/dialogs";

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
  checkNow,
  countdownSeconds,
  installAndRestart,
  postpone,
  resetUpdates,
  startAutoUpdate,
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
  resetUpdates();
});

afterEach(() => {
  resetUpdates();
  vi.useRealTimers();
});

describe("自动更新的启动条件", () => {
  it("dev 构建下整条流程都不启动", async () => {
    vi.stubEnv("DEV", true);

    const dispose = startAutoUpdate();
    await flush();

    expect(checkMock).not.toHaveBeenCalled();
    expect(updateState().phase).toBe("idle");
    dispose();
  });

  it("打包构建下启动时检查一次，之后每 6 小时一次", async () => {
    vi.stubEnv("DEV", false);
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
    vi.stubEnv("DEV", false);
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
    vi.stubEnv("DEV", false);
    checkMock.mockResolvedValue(null);

    const dispose = startAutoUpdate();
    await flush();

    expect(updateState().phase).toBe("idle");
    expect(updateState().checkedAt).toBeTypeOf("number");
    dispose();
  });
});

describe("下载与重启", () => {
  it("发现新版本后下载到 ready，并记下进度", async () => {
    vi.stubEnv("DEV", false);
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await flush();

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(updateState().phase).toBe("ready");
    expect(updateState().version).toBe("0.1.5");
    expect(updateState().percent).toBe(100);
    // 下载与安装分开：安装发生在用户同意重启的那一刻，不是下载完就动手。
    expect(update.install).not.toHaveBeenCalled();
    dispose();
  });

  it("倒计时结束后安装并重启", async () => {
    vi.stubEnv("DEV", false);
    vi.useFakeTimers();
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(countdownSeconds()).toBe(5);

    await vi.advanceTimersByTimeAsync(5000);

    expect(update.install).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(updateState().phase).toBe("installing");
    dispose();
  });

  it("有弹窗开着时倒计时原地等，关掉之后继续走", async () => {
    vi.stubEnv("DEV", false);
    vi.useFakeTimers();
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const closeDialog = registerDialog();

    const dispose = startAutoUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(openDialogCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(5000);
    // 用户正在填表：不许在他打字时把窗口重启掉，倒计时也不该在数。
    expect(countdownSeconds()).toBeNull();
    expect(update.install).not.toHaveBeenCalled();

    closeDialog();
    // 关掉之后再从头数满 5 秒（第一个 tick 只是把 5 放回去）。
    await vi.advanceTimersByTimeAsync(6000);

    expect(update.install).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("「稍后」停掉倒计时，进度留在 ready，不再自动安装", async () => {
    vi.stubEnv("DEV", false);
    vi.useFakeTimers();
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await vi.advanceTimersByTimeAsync(0);
    postpone();
    expect(countdownSeconds()).toBeNull();
    expect(updateState().autoRestart).toBe(false);

    await vi.advanceTimersByTimeAsync(60000);

    expect(update.install).not.toHaveBeenCalled();
    expect(updateState().phase).toBe("ready");

    // 「立即重启」仍然可用：稍后只是不做那件事的自动版。
    await installAndRestart();
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("安装失败时留在能看见的状态里，且不重启", async () => {
    vi.stubEnv("DEV", false);
    const update = fakeUpdate();
    update.install.mockRejectedValue(new Error("installer refused"));
    checkMock.mockResolvedValue(update);

    const dispose = startAutoUpdate();
    await flush();

    expect(await installAndRestart()).toBe(false);
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(updateState().phase).toBe("failed");
    expect(updateState().error).toContain("installer refused");
    dispose();
  });
});

describe("手动检查", () => {
  it("dev 下被关掉，并告诉调用方为什么", async () => {
    vi.stubEnv("DEV", true);

    expect(await checkNow()).toBe("disabled");
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("打包构建下把结果交回调用方", async () => {
    vi.stubEnv("DEV", false);
    checkMock.mockResolvedValue(null);
    expect(await checkNow()).toBe("none");

    checkMock.mockResolvedValue(fakeUpdate());
    expect(await checkNow()).toBe("ready");

    checkMock.mockRejectedValue(new Error("offline"));
    expect(await checkNow()).toBe("failed");
    expect(updateState().error).toContain("offline");
  });
});

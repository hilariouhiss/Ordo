import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDialog, resetDialogs } from "../../../common/stores/dialogs";

const checkMock = vi.fn();
const installMock = vi.fn();
const relaunchMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

import { resetUpdates, startAutoUpdate, updateState } from "../updates";
import { UpdatePrompt } from "../components/UpdatePrompt";

/** An `Update` whose download reports half the bytes, then finishes. */
function fakeUpdate(version = "0.1.5") {
  return {
    version,
    body: "notes",
    date: "2026-09-24T00:00:00Z",
    download: vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      onEvent({ event: "Progress", data: { chunkLength: 1000 } });
      onEvent({ event: "Finished", data: {} });
    }),
    install: installMock,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("DEV", false);
  resetUpdates();
  resetDialogs();
  installMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  resetUpdates();
  resetDialogs();
  vi.useRealTimers();
});

describe("UpdatePrompt", () => {
  it("没有更新时不渲染任何东西", () => {
    const { container } = render(() => <UpdatePrompt />);
    expect(container.textContent).toBe("");
  });

  it("就绪后显示倒计时、版本与两个动作", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    expect(screen.getByText(/0\.1\.5/)).toBeTruthy();
    expect(screen.getByText(/秒后重启/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "现在重启" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "稍后" })).toBeTruthy();
    dispose();
  });

  it("点「稍后」后提示留着但不再自动重启", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    fireEvent.click(screen.getByRole("button", { name: "稍后" }));

    await waitFor(() => expect(screen.queryByText(/秒后重启/)).toBeNull());
    expect(screen.getByRole("button", { name: "立即重启" })).toBeTruthy();
    expect(installMock).not.toHaveBeenCalled();
    dispose();
  });

  it("「现在重启」立刻安装并重启", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    fireEvent.click(screen.getByRole("button", { name: "现在重启" }));

    await waitFor(() => expect(installMock).toHaveBeenCalledTimes(1));
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("有弹窗开着时不显示倒计时——重启在等它关掉", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    const closeDialog = registerDialog();
    render(() => <UpdatePrompt />);

    // 状态早就是 ready，但倒计时一步都不许走。
    expect(updateState().phase).toBe("ready");
    expect(screen.queryByText(/秒后重启/)).toBeNull();
    expect(screen.getByText(/正在等待/)).toBeTruthy();

    closeDialog();
    await waitFor(() => expect(screen.getByText(/秒后重启/)).toBeTruthy());
    dispose();
  });

  it("安装失败后把原因留在提示里", async () => {
    installMock.mockRejectedValue(new Error("installer refused"));
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    fireEvent.click(screen.getByRole("button", { name: "现在重启" }));

    expect(await screen.findByText(/installer refused/)).toBeTruthy();
    expect(relaunchMock).not.toHaveBeenCalled();
    dispose();
  });
});

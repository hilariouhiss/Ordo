import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkMock = vi.fn();
const installMock = vi.fn();
const relaunchMock = vi.fn();
const downloadMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

import { resetUpdates, setAutoDownload, startAutoUpdate, startUpdate } from "../updates";
import { UpdatePrompt } from "../components/UpdatePrompt";

/** An `Update` whose download reports the whole file, then finishes. */
function fakeUpdate(version = "0.1.5") {
  return {
    version,
    body: "notes",
    date: "2026-09-24T00:00:00Z",
    download: downloadMock,
    install: installMock,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("DEV", false);
  localStorage.clear();
  resetUpdates();
  installMock.mockResolvedValue(undefined);
  downloadMock.mockImplementation(async (onEvent: (event: unknown) => void) => {
    onEvent({ event: "Started", data: { contentLength: 1000 } });
    onEvent({ event: "Progress", data: { chunkLength: 1000 } });
    onEvent({ event: "Finished", data: {} });
  });
});

afterEach(() => {
  cleanup();
  resetUpdates();
  localStorage.clear();
});

describe("UpdatePrompt", () => {
  it("没有更新时不渲染任何东西", () => {
    const { container } = render(() => <UpdatePrompt />);
    expect(container.textContent).toBe("");
  });

  it("检查失败时也不打扰用户", async () => {
    checkMock.mockRejectedValue(new Error("offline"));
    const dispose = startAutoUpdate();
    await flush();
    const { container } = render(() => <UpdatePrompt />);

    expect(container.textContent).toBe("");
    dispose();
  });

  it("已下载时提示点击更新，并给出「更新 / 稍后」", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    expect(screen.getByText(/0\.1\.5 已下载/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "稍后" })).toBeTruthy();
    // 没有倒计时：卡片会一直等到有人按下按钮。
    expect(screen.queryByText(/秒后重启/)).toBeNull();
    expect(installMock).not.toHaveBeenCalled();
    dispose();
  });

  it("关掉静默下载时只说发现新版本，按钮是「下载并更新」", async () => {
    setAutoDownload(false);
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    expect(screen.getByText(/发现新版本 v0\.1\.5/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "下载并更新" })).toBeTruthy();
    expect(downloadMock).not.toHaveBeenCalled();
    dispose();
  });

  it("点「更新」安装并重启", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => expect(installMock).toHaveBeenCalledTimes(1));
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("「下载并更新」在点击之后才下载", async () => {
    setAutoDownload(false);
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    fireEvent.click(screen.getByRole("button", { name: "下载并更新" }));

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(installMock).toHaveBeenCalledTimes(1));
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("下载中显示百分比", async () => {
    setAutoDownload(false);
    let release: (() => void) | undefined;
    downloadMock.mockImplementation(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      onEvent({ event: "Progress", data: { chunkLength: 420 } });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    // The card stays mounted while the click's download runs.
    void startUpdate();

    expect(await screen.findByText(/正在下载 v0\.1\.5（42%）/)).toBeTruthy();
    release?.();
    dispose();
  });

  it("点「稍后」后卡片消失，且什么都不装", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    fireEvent.click(screen.getByRole("button", { name: "稍后" }));

    await waitFor(() => expect(screen.queryByText(/已下载/)).toBeNull());
    expect(installMock).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    dispose();
  });

  it("安装失败后把原因留在提示里", async () => {
    installMock.mockRejectedValue(new Error("installer refused"));
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    expect(await screen.findByText(/installer refused/)).toBeTruthy();
    expect(relaunchMock).not.toHaveBeenCalled();
    dispose();
  });

  it("右上角关闭按钮在任何状态下都在，点一下就收起卡片", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    // 不只是在失败时才有：正常的「发现新版本 / 已下载」也必须有出口。
    const close = screen.getByRole("button", { name: /关闭更新提示/ });
    fireEvent.click(close);

    await waitFor(() => expect(screen.queryByText(/已下载/)).toBeNull());
    expect(installMock).not.toHaveBeenCalled();
    dispose();
  });

  it("安装中不再给关闭按钮（那时已经没有可取消的事）", async () => {
    downloadMock.mockImplementation(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      onEvent({ event: "Finished", data: {} });
    });
    checkMock.mockResolvedValue(fakeUpdate());
    const dispose = startAutoUpdate();
    await flush();
    render(() => <UpdatePrompt />);

    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /关闭更新提示/ })).toBeNull(),
    );
    dispose();
  });
});

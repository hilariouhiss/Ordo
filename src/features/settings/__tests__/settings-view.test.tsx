/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import { clearNotifications, notifications } from "../../../common/stores/notifications";
import * as api from "../api";
import { SettingsView } from "../components/SettingsView";
import type { BackupSummary } from "../types";

const saveMock = vi.fn();
const openMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveMock(...args),
  open: (...args: unknown[]) => openMock(...args),
}));

vi.mock("../api", () => ({
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
  autostartEnabled: vi.fn(),
  setAutostart: vi.fn(),
}));

vi.mock("../../tasks/hooks", () => ({
  loadAll: vi.fn().mockResolvedValue(true),
  loadUnfinishedCounts: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../projects/hooks", () => ({ loadAll: vi.fn().mockResolvedValue(true) }));
vi.mock("../../namespaces/hooks", () => ({ loadAll: vi.fn().mockResolvedValue(true) }));

function summary(overrides: Partial<BackupSummary> = {}): BackupSummary {
  return {
    path: "C:\\backups\\ordo-backup-20260911-120000.json",
    exportedAt: "2026-09-11T12:00:00Z",
    counts: {
      namespaces: 1,
      projects: 2,
      boardColumns: 6,
      tasks: 12,
      subtasks: 3,
      tags: 4,
      comments: 5,
      timeEntries: 7,
      settings: 1,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearNotifications();
  // The OS is the source of truth for startup; nothing is registered until the
  // user asks for it.
  vi.mocked(api.autostartEnabled).mockResolvedValue(false);
});

afterEach(cleanup);

describe("SettingsView backup", () => {
  it("exports to the path chosen in the save dialog", async () => {
    saveMock.mockResolvedValue("C:\\backups\\chosen.json");
    vi.mocked(api.exportBackup).mockResolvedValue(summary({ path: "C:\\backups\\chosen.json" }));

    render(() => <SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "导出备份" }));

    await waitFor(() =>
      expect(api.exportBackup).toHaveBeenCalledWith("C:\\backups\\chosen.json"),
    );
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: expect.stringMatching(/^ordo-backup-.*\.json$/) }),
    );
    expect(await screen.findByText(/已导出 12 个任务/)).toBeTruthy();
  });

  it("does nothing when the save dialog is dismissed", async () => {
    saveMock.mockResolvedValue(null);

    render(() => <SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "导出备份" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(api.exportBackup).not.toHaveBeenCalled();
  });

  it("asks for confirmation before restoring, then reloads the stores", async () => {
    openMock.mockResolvedValue("C:\\backups\\from-disk.json");
    vi.mocked(api.importBackup).mockResolvedValue(summary());
    const tasks = await import("../../tasks/hooks");
    const projects = await import("../../projects/hooks");
    const namespaces = await import("../../namespaces/hooks");

    render(() => <SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "从备份恢复" }));

    // Nothing is touched until the user confirms: a restore replaces it all.
    const confirm = await screen.findByRole("button", { name: "确认恢复" });
    expect(api.importBackup).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() => expect(api.importBackup).toHaveBeenCalledWith("C:\\backups\\from-disk.json"));
    await waitFor(() => expect(tasks.loadAll).toHaveBeenCalled());
    await waitFor(() => expect(projects.loadAll).toHaveBeenCalled());
    // The namespace store gates the other loads (`loaded`), so a restore that
    // skipped it would keep resolving the restored projects against the names
    // the previous machine had.
    await waitFor(() => expect(namespaces.loadAll).toHaveBeenCalled());
    // 计数问的正是被恢复换掉的那张表：同机器恢复保留 id、跨机器恢复换掉全部
    // id，两种都要重取，否则侧边栏的箭头停在恢复前的数上。
    await waitFor(() => expect(tasks.loadUnfinishedCounts).toHaveBeenCalled());
    expect(notifications()[0]?.message).toContain("已从备份恢复 12 个任务、2 个项目、1 个命名空间");
  });

  it("surfaces a failed import and keeps the data as it was", async () => {
    openMock.mockResolvedValue("C:\\backups\\broken.json");
    vi.mocked(api.importBackup).mockRejectedValue({ code: "validation", message: "备份文件无法解析" });
    const tasks = await import("../../tasks/hooks");

    render(() => <SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "从备份恢复" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认恢复" }));

    await waitFor(() => expect(api.importBackup).toHaveBeenCalled());
    expect(notifications()[0]?.message).toBe("备份文件无法解析");
    expect(tasks.loadAll).not.toHaveBeenCalled();
    expect(tasks.loadUnfinishedCounts).not.toHaveBeenCalled();
  });

  it("shows the backup path and the restore time after a restore", async () => {
    openMock.mockResolvedValue("C:\\backups\\from-disk.json");
    vi.mocked(api.importBackup).mockResolvedValue(
      summary({ path: "C:\\backups\\from-disk.json" }),
    );

    render(() => <SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "从备份恢复" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认恢复" }));

    expect(await screen.findByText(/from-disk\.json/)).toBeTruthy();
    expect(screen.getByText(/2 个项目/)).toBeTruthy();
    expect(screen.getByText(/1 个命名空间/)).toBeTruthy();
  });
});

describe("SettingsView startup", () => {
  it("is off by default and registers nothing on its own", async () => {
    render(() => <SettingsView />);

    const toggle = (await screen.findByRole("checkbox", { name: "开机自启" })) as HTMLInputElement;
    await waitFor(() => expect(api.autostartEnabled).toHaveBeenCalled());
    expect(toggle.checked).toBe(false);
    expect(api.setAutostart).not.toHaveBeenCalled();
  });

  it("registers Ordo with the OS when switched on", async () => {
    vi.mocked(api.autostartEnabled).mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.mocked(api.setAutostart).mockResolvedValue(undefined);

    render(() => <SettingsView />);
    const toggle = (await screen.findByRole("checkbox", { name: "开机自启" })) as HTMLInputElement;
    await waitFor(() => expect(api.autostartEnabled).toHaveBeenCalledTimes(1));

    fireEvent.click(toggle);

    await waitFor(() => expect(api.setAutostart).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toggle.checked).toBe(true));
  });

  it("keeps the switch off and reports a refused change", async () => {
    vi.mocked(api.setAutostart).mockRejectedValue({
      code: "unknown",
      message: "无法写入登录项",
    });

    render(() => <SettingsView />);
    const toggle = (await screen.findByRole("checkbox", { name: "开机自启" })) as HTMLInputElement;

    fireEvent.click(toggle);

    await waitFor(() => expect(api.setAutostart).toHaveBeenCalledWith(true));
    expect(toggle.checked).toBe(false);
    await waitFor(() => expect(notifications()[0]?.message).toBe("无法写入登录项"));
  });
});

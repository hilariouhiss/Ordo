/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../common/components/__tests__/setup";
import { EVENTS } from "../../common/ipc/events";
import * as api from "../../features/tasks/api";
import { resetTasksStore } from "../../features/tasks/store";
import QuickAddDialog from "../QuickAddDialog";

const listenMock = vi.fn();
const hideMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide: (...args: unknown[]) => hideMock(...args) }),
}));

vi.mock("../../features/tasks/api", () => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listSubtasks: vi.fn(),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  completeSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  reorderSubtask: vi.fn(),
}));

function createdTask(title: string) {
  return {
    id: "t-new",
    projectId: null,
    title,
    note: null,
    priority: "none" as const,
    columnId: null,
    dueAt: null,
    completedAt: null,
    repeatRule: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-11T10:00:00Z",
    updatedAt: "2026-09-11T10:00:00Z",
    deletedAt: null,
  };
}

/** Fires the shortcut event the backend emits. */
function pressShortcut(): void {
  const handler = listenMock.mock.calls[0]?.[1] as (() => void) | undefined;
  handler?.();
}

beforeEach(() => {
  vi.clearAllMocks();
  listenMock.mockResolvedValue(() => {});
  hideMock.mockResolvedValue(undefined);
  vi.mocked(api.createTask).mockImplementation(async (payload) => createdTask(payload.title));
  resetTasksStore();
});

afterEach(cleanup);

describe("QuickAddDialog", () => {
  it("opens on the global shortcut and files the task into the inbox", async () => {
    render(() => <QuickAddDialog />);
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith(EVENTS.quickAdd, expect.any(Function)));

    expect(screen.queryByLabelText("任务标题")).toBeNull();
    pressShortcut();

    const input = await screen.findByLabelText("任务标题");
    fireEvent.input(input, { target: { value: "  写周报  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({ title: "写周报" }),
    );
    // The window parks itself again, so the user lands back where they were.
    await waitFor(() => expect(hideMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText("任务标题")).toBeNull());
  });

  it("adds through the button as well as the Enter key", async () => {
    render(() => <QuickAddDialog />);
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    pressShortcut();

    fireEvent.input(await screen.findByLabelText("任务标题"), {
      target: { value: "整理收件箱" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith({ title: "整理收件箱" }));
    await waitFor(() => expect(hideMock).toHaveBeenCalledTimes(1));
  });

  it("keeps the dialog open and the window visible when the task is rejected", async () => {
    vi.mocked(api.createTask).mockRejectedValue({ code: "validation", message: "标题不能为空" });
    render(() => <QuickAddDialog />);
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    pressShortcut();

    const input = await screen.findByLabelText("任务标题");
    fireEvent.input(input, { target: { value: "写周报" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(hideMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("任务标题")).toBeTruthy();
  });

  it("ignores a blank title", async () => {
    render(() => <QuickAddDialog />);
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    pressShortcut();

    const input = await screen.findByLabelText("任务标题");
    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(api.createTask).not.toHaveBeenCalled();
    expect(hideMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("任务标题")).toBeTruthy();
  });

  it("reopens empty after a cancelled entry", async () => {
    render(() => <QuickAddDialog />);
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    pressShortcut();
    fireEvent.input(await screen.findByLabelText("任务标题"), { target: { value: "半截输入" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByLabelText("任务标题")).toBeNull());
    expect(api.createTask).not.toHaveBeenCalled();

    pressShortcut();
    expect((await screen.findByLabelText("任务标题") as HTMLInputElement).value).toBe("");
  });

  it("renders without a Tauri runtime (browser dev server)", async () => {
    listenMock.mockRejectedValue(new Error("no tauri"));
    render(() => <QuickAddDialog />);
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    expect(screen.queryByLabelText("任务标题")).toBeNull();
  });
});

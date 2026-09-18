import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskViewer from "../TaskViewer";
import { closeTaskViewer, openTaskViewer } from "../../common/stores/taskViewer";
import * as taskStore from "../../features/tasks/store";
import type { Task } from "../../features/tasks/types";

vi.mock("../../features/tasks/api", () => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  reorderTask: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listDependencies: vi.fn().mockResolvedValue([]),
}));

vi.useFakeTimers();

function taskFixture(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: null,
    title: `任务 ${id}`,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt: null,
    repeatRule: null,
    complexity: null,
    parentTaskId: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  taskStore.resetTasksStore();
  closeTaskViewer();
});

afterEach(cleanup);

describe("TaskViewer", () => {
  it("opens the detail dialog for the focused task", () => {
    taskStore.setAll(
      [taskFixture("t1", { title: "海报设计评审", note: "本周五前完成" })],
      [],
    );

    render(() => <TaskViewer />);
    expect(screen.queryByRole("dialog")).toBeNull();

    openTaskViewer("t1");
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("海报设计评审");
    expect(dialog.textContent).toContain("本周五前完成");
  });

  it("renders nothing when the focused id has no live row", () => {
    render(() => <TaskViewer />);
    openTaskViewer("missing");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from the dialog and reopens the same task afterwards", () => {
    taskStore.setAll([taskFixture("t1")], []);
    render(() => <TaskViewer />);

    openTaskViewer("t1");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    openTaskViewer("t1");
    expect(screen.getByRole("dialog").textContent).toContain("任务 t1");
  });

  it("swaps to the editor from the detail and closes through it", () => {
    taskStore.setAll([taskFixture("t1", { title: "海报设计评审" })], []);
    render(() => <TaskViewer />);

    openTaskViewer("t1");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    // The editor replaces the detail; the title input is prefilled.
    const titleInput = screen.getByLabelText("标题") as HTMLInputElement;
    expect(titleInput.value).toBe("海报设计评审");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("标题")).toBeNull();
  });
});

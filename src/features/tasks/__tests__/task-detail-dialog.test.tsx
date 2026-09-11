/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import * as api from "../api";
import * as store from "../store";
import type { Comment, Subtask, Task } from "../types";
import { TaskDetailDialog } from "../components/TaskDetailDialog";

vi.mock("../api", () => ({
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
  listComments: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
}));

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
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function subtaskFixture(id: string, taskId: string, overrides: Partial<Subtask> = {}): Subtask {
  return {
    id,
    taskId,
    title: `子任务 ${id}`,
    done: false,
    sortOrder: id,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function commentFixture(id: string, body: string): Comment {
  return {
    id,
    taskId: TASK_ID,
    body,
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
  };
}

const TASK_ID = "task-1";

function seedSubtasks(subtasks: Subtask[]): void {
  store.setSubtasks(TASK_ID, subtasks);
}

function renderDetail(fixture: Task = taskFixture(TASK_ID)) {
  const onEdit = vi.fn();
  const onOpenChange = vi.fn();
  render(() => (
    <TaskDetailDialog open={true} onOpenChange={onOpenChange} task={fixture} onEdit={onEdit} />
  ));
  return { onEdit, onOpenChange };
}

function subtaskIdsInOrder(): string[] {
  return [...document.querySelectorAll("[data-subtask-id]")].map(
    (el) => el.getAttribute("data-subtask-id") ?? "",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listComments).mockResolvedValue([]);
  vi.mocked(api.createComment).mockResolvedValue(
    commentFixture("c-new", "新评论"),
  );
  store.resetTasksStore();
  store.setAll([taskFixture(TASK_ID)], []);
});

afterEach(cleanup);

describe("TaskDetailDialog", () => {
  it("shows the task's fields and the subtask completion progress", () => {
    store.setAll(
      [
        taskFixture(TASK_ID, {
          title: "发布周报",
          note: "先整理本周数据",
          priority: "high",
          dueAt: "2026-09-09T23:00:00Z",
        }),
      ],
      [],
    );
    seedSubtasks([
      subtaskFixture("s1", TASK_ID, { done: true }),
      subtaskFixture("s2", TASK_ID),
      subtaskFixture("s3", TASK_ID),
    ]);

    renderDetail();

    expect(screen.getByText("发布周报")).toBeTruthy();
    expect(screen.getByText("先整理本周数据")).toBeTruthy();
    expect(screen.getByText("高")).toBeTruthy();
    expect(screen.getByText("1/3 已完成")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
    expect(api.listSubtasks).not.toHaveBeenCalled(); // cache already held them
  });

  it("loads subtasks through subtask:list when opening without a cache", async () => {
    vi.mocked(api.listSubtasks).mockResolvedValue([subtaskFixture("s1", TASK_ID)]);

    renderDetail();

    // Both lazy sections show their loading placeholder until loaded.
    const statuses = screen.getAllByRole("status");
    expect(statuses.map((el) => el.textContent)).toEqual([
      "子任务加载中…",
      "评论加载中…",
    ]);
    expect(await screen.findByText("子任务 s1")).toBeTruthy();
    expect(api.listSubtasks).toHaveBeenCalledWith(TASK_ID);
  });

  it("adds a subtask from the input on Enter", async () => {
    seedSubtasks([]);
    vi.mocked(api.createSubtask).mockImplementation(async (_taskId, payload) =>
      subtaskFixture("created-1", TASK_ID, { title: payload.title }),
    );

    renderDetail();

    fireEvent.input(screen.getByLabelText("添加子任务"), {
      target: { value: "新的子任务" },
    });
    fireEvent.keyDown(screen.getByLabelText("添加子任务"), { key: "Enter" });

    expect(screen.getByText("新的子任务")).toBeTruthy(); // optimistic row
    await waitFor(() => expect(api.createSubtask).toHaveBeenCalledWith(TASK_ID, { title: "新的子任务" }));
    await waitFor(() =>
      expect((screen.getByLabelText("添加子任务") as HTMLInputElement).value).toBe(""),
    );
  });

  it("checks a subtask and the progress follows optimistically", async () => {
    seedSubtasks([
      subtaskFixture("s1", TASK_ID, { done: true, sortOrder: "a" }),
      subtaskFixture("s2", TASK_ID, { sortOrder: "b" }),
    ]);

    renderDetail();

    expect(screen.getByText("1/2 已完成")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "完成子任务 子任务 s2" }));

    expect(screen.getByText("2/2 已完成")).toBeTruthy();
    await waitFor(() => expect(api.completeSubtask).toHaveBeenCalledWith("s2", true));
  });

  it("inline-edits a subtask title on click (Enter commits, empty cancels)", async () => {
    seedSubtasks([subtaskFixture("s1", TASK_ID, { title: "旧标题" })]);

    renderDetail();
    fireEvent.click(screen.getByText("旧标题"));

    const input = screen.getByDisplayValue("旧标题") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "新标题" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalledWith("s1", { title: "新标题" }));
    expect(screen.getByText("新标题")).toBeTruthy();

    // Editing to whitespace-only does not hit the backend.
    fireEvent.click(screen.getByText("新标题"));
    const again = screen.getByDisplayValue("新标题") as HTMLInputElement;
    fireEvent.input(again, { target: { value: "   " } });
    fireEvent.keyDown(again, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("新标题")).toBeTruthy());
    expect(api.updateSubtask).toHaveBeenCalledTimes(1);
  });

  it("deletes a subtask from the row button", async () => {
    seedSubtasks([subtaskFixture("s1", TASK_ID, { title: "要删的" })]);
    vi.mocked(api.deleteSubtask).mockResolvedValue(undefined);

    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "删除子任务 要删的" }));

    await waitFor(() => expect(api.deleteSubtask).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.queryByText("要删的")).toBeNull());
  });

  it("moves a subtask up/down by passing the neighbours' sort keys", async () => {
    seedSubtasks([
      subtaskFixture("s1", TASK_ID, { sortOrder: "a" }),
      subtaskFixture("s2", TASK_ID, { sortOrder: "b" }),
      subtaskFixture("s3", TASK_ID, { sortOrder: "c" }),
    ]);
    // The hook reconciles with the returned authoritative list.
    vi.mocked(api.reorderSubtask).mockImplementation(async () => store.getSubtasks(TASK_ID));

    renderDetail();

    // Move up from the middle: target slot is the list head.
    fireEvent.click(screen.getByRole("button", { name: "上移子任务 子任务 s2" }));
    expect(subtaskIdsInOrder()).toEqual(["s2", "s1", "s3"]); // optimistic move
    await waitFor(() => expect(api.reorderSubtask).toHaveBeenCalledWith("s2", null, "a"));

    // Move down from the middle: target slot is the list tail.
    fireEvent.click(screen.getByRole("button", { name: "下移子任务 子任务 s1" }));
    await waitFor(() => expect(api.reorderSubtask).toHaveBeenCalledWith("s1", "c", null));
  });

  it("disables the move buttons at the list ends", () => {
    seedSubtasks([subtaskFixture("s1", TASK_ID), subtaskFixture("s2", TASK_ID)]);

    renderDetail();

    expect(
      (screen.getByRole("button", { name: "上移子任务 子任务 s1" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "下移子任务 子任务 s1" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "下移子任务 子任务 s2" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("routes the footer actions: edit callback, complete, delete", async () => {
    seedSubtasks([]);
    const pending = { resolve: (_task: Task) => {} } as { resolve: (task: Task) => void };
    vi.mocked(api.completeTask).mockReturnValue(
      new Promise((resolve) => {
        pending.resolve = resolve;
      }),
    );
    vi.mocked(api.softDeleteTask).mockResolvedValue(undefined);

    const { onEdit, onOpenChange } = renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: TASK_ID }));

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    // Optimistic completion flips the action label before the IPC resolves.
    expect(screen.getByRole("button", { name: "恢复为待办" })).toBeTruthy();
    pending.resolve(taskFixture(TASK_ID, { completedAt: "2026-09-09T12:00:00Z" }));
    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith(TASK_ID));

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(api.softDeleteTask).toHaveBeenCalledWith(TASK_ID));
  });
  it("loads comments through comment:list and adds one optimistically", async () => {
    vi.mocked(api.listComments).mockResolvedValue([
      commentFixture("c1", "首次评审意见"),
    ]);
    let resolveCreate!: (value: Comment) => void;
    vi.mocked(api.createComment).mockReturnValue(
      new Promise<Comment>((res) => {
        resolveCreate = res;
      }),
    );

    renderDetail();
    expect(await screen.findByText("首次评审意见")).toBeTruthy();
    expect(api.listComments).toHaveBeenCalledWith(TASK_ID);

    fireEvent.input(screen.getByLabelText("添加评论"), {
      target: { value: "补充一点" },
    });
    fireEvent.keyDown(screen.getByLabelText("添加评论"), { key: "Enter" });

    // Optimistic row appears before the backend answers.
    expect(screen.getByText("补充一点")).toBeTruthy();
    resolveCreate(commentFixture("c2", "补充一点"));
    await waitFor(() => expect(api.createComment).toHaveBeenCalledTimes(1));
    expect(
      (screen.getByLabelText("添加评论") as HTMLInputElement).value,
    ).toBe("");
  });

  it("deletes a comment from its row button", async () => {
    store.setComments(TASK_ID, [commentFixture("c1", "待删除的评论")]);
    vi.mocked(api.deleteComment).mockResolvedValue(undefined);

    renderDetail();
    expect(await screen.findByText("待删除的评论")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "删除评论 待删除的评论" }));

    await waitFor(() => expect(api.deleteComment).toHaveBeenCalledWith("c1"));
    expect(screen.queryByText("待删除的评论")).toBeNull();
  });

  it("inline-edits a comment body (Enter commits)", async () => {
    store.setComments(TASK_ID, [commentFixture("c1", "原始内容")]);
    vi.mocked(api.updateComment).mockResolvedValue(
      commentFixture("c1", "修改后的内容"),
    );

    renderDetail();
    fireEvent.click(await screen.findByText("原始内容"));
    const editor = screen.getByLabelText("编辑评论") as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: "修改后的内容" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() =>
      expect(api.updateComment).toHaveBeenCalledWith("c1", { body: "修改后的内容" }),
    );
    expect(await screen.findByText("修改后的内容")).toBeTruthy();
  });
});

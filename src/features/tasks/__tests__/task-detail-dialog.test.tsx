/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import * as api from "../api";
import * as store from "../store";
import type { Comment, Subtask, Task, TimeEntry } from "../types";
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
  listSubtasksAll: vi.fn().mockResolvedValue([]),
  listDependencies: vi.fn().mockResolvedValue([]),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  completeSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  reorderSubtask: vi.fn(),
  listComments: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  listTimeEntries: vi.fn(),
  createTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  startTimeEntry: vi.fn(),
  stopTimeEntry: vi.fn(),
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
    complexity: null,
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
    note: null,
    priority: "none",
    dueAt: null,
    complexity: null,
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

function timeEntryFixture(
  id: string,
  overrides: Partial<TimeEntry> = {},
): TimeEntry {
  return {
    id,
    taskId: TASK_ID,
    startedAt: "2026-09-09T09:00:00Z",
    endedAt: "2026-09-09T09:30:00Z",
    duration: 1800,
    createdAt: "2026-09-09T09:30:00Z",
    updatedAt: "2026-09-09T09:30:00Z",
    deletedAt: null,
    ...overrides,
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
  vi.mocked(api.listTimeEntries).mockResolvedValue([]);
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
          complexity: 4,
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
    expect(screen.getByText("复杂度 4")).toBeTruthy();
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
      "时间记录加载中…",
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

  it("lets the IME take the Enter that commits a composition (subtasks)", async () => {
    seedSubtasks([subtaskFixture("s1", TASK_ID, { title: "旧标题" })]);

    renderDetail();

    // Adding: Enter mid-composition must not file the half-typed title.
    fireEvent.input(screen.getByLabelText("添加子任务"), { target: { value: "新子任务" } });
    fireEvent.keyDown(screen.getByLabelText("添加子任务"), { key: "Enter", isComposing: true });
    expect(api.createSubtask).not.toHaveBeenCalled();

    // Committing an edit: same story, the title stays editable.
    fireEvent.click(screen.getByText("旧标题"));
    const editor = screen.getByDisplayValue("旧标题") as HTMLInputElement;
    fireEvent.input(editor, { target: { value: "新标题" } });
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
    expect(api.updateSubtask).not.toHaveBeenCalled();

    // The next Enter (composition finished) does go through.
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalledWith("s1", { title: "新标题" }));
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
  it("lets the IME take the Enter that commits a composition (comments)", async () => {
    store.setComments(TASK_ID, [commentFixture("c1", "原始内容")]);

    renderDetail();
    await screen.findByText("原始内容");

    // Adding: Enter mid-composition must not post the half-typed comment.
    fireEvent.input(screen.getByLabelText("添加评论"), { target: { value: "补充一点" } });
    fireEvent.keyDown(screen.getByLabelText("添加评论"), { key: "Enter", isComposing: true });
    expect(api.createComment).not.toHaveBeenCalled();

    // Committing an edit: same story, the editor stays open.
    fireEvent.click(screen.getByText("原始内容"));
    const editor = screen.getByLabelText("编辑评论") as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: "修改后的内容" } });
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
    expect(api.updateComment).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() =>
      expect(api.updateComment).toHaveBeenCalledWith("c1", { body: "修改后的内容" }),
    );
  });
});

describe("TaskDetailDialog time tracking", () => {
  it("lists the task's entries with their total", () => {
    store.setTimeEntries(TASK_ID, [
      timeEntryFixture("e1", { duration: 1800 }),
      timeEntryFixture("e2", { duration: 900, startedAt: "2026-09-08T09:00:00Z" }),
    ]);

    renderDetail();

    expect(screen.getByRole("heading", { name: "时间记录" })).toBeTruthy();
    expect(screen.getByText("共 45 分钟")).toBeTruthy();
    expect(screen.getByText("30 分钟")).toBeTruthy();
    expect(screen.getByText("15 分钟")).toBeTruthy();
    expect(api.listTimeEntries).not.toHaveBeenCalled(); // cache already held them
  });

  it("shows the live clock of a running timer", () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    store.setTimeEntries(TASK_ID, [
      timeEntryFixture("e1", { startedAt, endedAt: null, duration: 0 }),
    ]);

    renderDetail();

    expect(screen.getByText("00:01:30")).toBeTruthy();
    expect(screen.getByRole("button", { name: "停止计时" })).toBeTruthy();
  });

  it("starts the timer, then stops it through time:stop", async () => {
    store.setTimeEntries(TASK_ID, []);
    const running = timeEntryFixture("e2", {
      startedAt: new Date(Date.now() - 90_000).toISOString(),
      endedAt: null,
      duration: 0,
    });
    vi.mocked(api.startTimeEntry).mockResolvedValue(running);
    vi.mocked(api.stopTimeEntry).mockResolvedValue(
      timeEntryFixture("e2", { endedAt: "2026-09-09T09:31:30Z", duration: 91 }),
    );

    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "开始计时" }));

    await waitFor(() => expect(api.startTimeEntry).toHaveBeenCalledWith(TASK_ID));
    expect(await screen.findByText("00:01:30")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "停止计时" }));
    await waitFor(() => expect(api.stopTimeEntry).toHaveBeenCalledWith("e2"));
  });

  it("records a manual entry from the start time and minutes inputs", async () => {
    store.setTimeEntries(TASK_ID, []);
    vi.mocked(api.createTimeEntry).mockResolvedValue(
      timeEntryFixture("e3", { duration: 600 }),
    );

    renderDetail();

    fireEvent.input(screen.getByLabelText("开始时间"), {
      target: { value: "2026-09-09T09:00" },
    });
    fireEvent.input(screen.getByLabelText("时长（分钟）"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "记录" }));

    await waitFor(() =>
      expect(api.createTimeEntry).toHaveBeenCalledWith(TASK_ID, {
        startedAt: new Date(2026, 8, 9, 9, 0).toISOString(),
        duration: 600,
      }),
    );
    // The optimistic row lands in the list and the input clears.
    expect(await screen.findByText("10 分钟")).toBeTruthy();
    expect((screen.getByLabelText("时长（分钟）") as HTMLInputElement).value).toBe("");
  });

  it("rejects an invalid manual duration without calling the backend", () => {
    store.setTimeEntries(TASK_ID, []);

    renderDetail();

    fireEvent.input(screen.getByLabelText("时长（分钟）"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "记录" }));

    expect(screen.getByRole("alert").textContent).toBe("请输入大于 0 的分钟数");
    expect(api.createTimeEntry).not.toHaveBeenCalled();
  });

  it("edits an entry's length and deletes it", async () => {
    store.setTimeEntries(TASK_ID, [timeEntryFixture("e1", { duration: 1800 })]);
    vi.mocked(api.updateTimeEntry).mockResolvedValue(
      timeEntryFixture("e1", { duration: 2700 }),
    );
    vi.mocked(api.deleteTimeEntry).mockResolvedValue(undefined);

    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "编辑时长 30 分钟" }));
    const editor = screen.getByLabelText("修改时长（分钟）") as HTMLInputElement;
    fireEvent.input(editor, { target: { value: "45" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() =>
      expect(api.updateTimeEntry).toHaveBeenCalledWith("e1", { duration: 2700 }),
    );
    expect(await screen.findByText("45 分钟")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "删除时间记录 45 分钟" }));
    await waitFor(() => expect(api.deleteTimeEntry).toHaveBeenCalledWith("e1"));
    expect(screen.queryByText("45 分钟")).toBeNull();
  });

  it("lets the IME take the Enter that commits a composition (time entries)", async () => {
    store.setTimeEntries(TASK_ID, [timeEntryFixture("e1", { duration: 1800 })]);
    vi.mocked(api.updateTimeEntry).mockResolvedValue(
      timeEntryFixture("e1", { duration: 2700 }),
    );

    renderDetail();

    // Recording minutes: Enter mid-composition must not log a partial entry.
    fireEvent.input(screen.getByLabelText("时长（分钟）"), { target: { value: "10" } });
    fireEvent.keyDown(screen.getByLabelText("时长（分钟）"), { key: "Enter", isComposing: true });
    expect(api.createTimeEntry).not.toHaveBeenCalled();

    // Editing an entry's length: same story.
    fireEvent.click(screen.getByRole("button", { name: "编辑时长 30 分钟" }));
    const editor = screen.getByLabelText("修改时长（分钟）") as HTMLInputElement;
    fireEvent.input(editor, { target: { value: "45" } });
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
    expect(api.updateTimeEntry).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() =>
      expect(api.updateTimeEntry).toHaveBeenCalledWith("e1", { duration: 2700 }),
    );
  });

  it("loads entries through time:list when opening without a cache", async () => {
    vi.mocked(api.listTimeEntries).mockResolvedValue([
      timeEntryFixture("e1", { duration: 2700 }),
    ]);
    store.setSubtasks(TASK_ID, []);
    store.setComments(TASK_ID, []);

    renderDetail();

    expect(await screen.findByText("45 分钟")).toBeTruthy();
    expect(api.listTimeEntries).toHaveBeenCalledWith(TASK_ID);
  });
});

describe("任务详情的依赖区", () => {
  it("列出前置与后置，并且不把自身与已成环的候选列进来", async () => {
    store.setAll(
      [
        taskFixture(TASK_ID, { title: "写周报" }),
        taskFixture("b", { title: "收集数据" }),
        taskFixture("c", { title: "发布" }),
        taskFixture("d", { title: "整理素材" }),
      ],
      [],
    );
    store.setDependencies([
      { kind: "task", dependentId: TASK_ID, prerequisiteId: "b" },
      { kind: "task", dependentId: "c", prerequisiteId: TASK_ID },
    ]);
    render(() => (
      <TaskDetailDialog
        open
        onOpenChange={() => {}}
        task={store.getTask(TASK_ID)!}
        onEdit={() => {}}
      />
    ));

    const section = await screen.findByRole("region", { name: "依赖" });
    expect(within(section).getByText("收集数据")).toBeTruthy();
    expect(within(section).getByText("发布")).toBeTruthy();

    const search = () => within(section).getByLabelText("添加前置");
    const offered = (title: string) =>
      within(section).queryByRole("button", { name: `添加前置 ${title}` });

    // An unrelated task is offered, so the assertions below cannot pass just
    // because the candidate list never renders anything.
    fireEvent.input(search(), { target: { value: "整" } });
    expect(offered("整理素材")).toBeTruthy();

    fireEvent.input(search(), { target: { value: "收" } });
    // "收集数据" is already a prerequisite, so it is not offered again.
    expect(offered("收集数据")).toBeNull();

    // The task itself is never its own prerequisite.
    fireEvent.input(search(), { target: { value: "写" } });
    expect(offered("写周报")).toBeNull();

    // "发布" already waits for this task: adding it back would close a cycle.
    fireEvent.input(search(), { target: { value: "发" } });
    expect(offered("发布")).toBeNull();
  });
});

describe("子任务属性面板", () => {
  it("前置只列同一父任务下的兄弟子任务，属性保存时一次写回", async () => {
    seedSubtasks([
      subtaskFixture("s1", TASK_ID, { title: "收集数据" }),
      subtaskFixture("s2", TASK_ID, { title: "定稿" }),
    ]);
    vi.mocked(api.updateSubtask).mockResolvedValue(
      subtaskFixture("s2", TASK_ID, { title: "定稿", note: "先对齐口径" }),
    );

    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "展开子任务属性 定稿" }));

    // The picker offers the sibling and nothing else: a subtask is never its own
    // prerequisite, and cross-parent edges are rejected by the backend, so no
    // other subtask can appear here at all.
    const section = document.querySelector('[aria-label="子任务"]') as HTMLElement;
    const offered = () =>
      [...section.querySelectorAll("[aria-pressed]")].map((el) => el.textContent);
    expect(offered()).toEqual(["收集数据"]);

    // A prerequisite is a discrete write: one edge per click, no save step.
    fireEvent.click(screen.getByRole("button", { name: "收集数据", pressed: false }));
    expect(api.addDependency).toHaveBeenCalledWith({
      kind: "subtask",
      dependentId: "s2",
      prerequisiteId: "s1",
    });

    // The four attributes ride a single updateSubtask call, then the panel closes.
    fireEvent.input(screen.getByLabelText("描述"), { target: { value: "先对齐口径" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(api.updateSubtask).toHaveBeenCalledTimes(1));
    expect(api.updateSubtask).toHaveBeenCalledWith("s2", {
      note: "先对齐口径",
      priority: "none",
      dueAt: null,
      complexity: null,
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存" })).toBeNull());
  });
});

describe("任务详情的阻塞标记", () => {
  it("有未完成前置的任务在徽标区显示「阻塞中 · 还差 N 项」", () => {
    store.setAll(
      [taskFixture(TASK_ID), taskFixture("b", { title: "收集数据" })],
      [],
    );
    store.setDependencies([{ kind: "task", dependentId: TASK_ID, prerequisiteId: "b" }]);

    renderDetail();

    expect(screen.getByText("阻塞中 · 还差 1 项")).toBeTruthy();

    // Finishing the prerequisite clears it without reopening the dialog.
    store.patchTask("b", { completedAt: "2026-09-14T10:00:00Z" });
    expect(screen.queryByText("阻塞中 · 还差 1 项")).toBeNull();
    store.setDependencies([]);
  });

  it("已完成的任务不再戴阻塞徽标", () => {
    store.setAll(
      [
        taskFixture(TASK_ID, { completedAt: "2026-09-14T10:00:00Z" }),
        taskFixture("b", { title: "收集数据" }),
      ],
      [],
    );
    store.setDependencies([{ kind: "task", dependentId: TASK_ID, prerequisiteId: "b" }]);

    renderDetail();

    // The dialog is really showing the completed task, so the assertion below
    // cannot pass just because nothing rendered.
    expect(screen.getByText("任务 task-1")).toBeTruthy();
    expect(screen.queryByText(/阻塞中/)).toBeNull();
    store.setDependencies([]);
  });
});

describe("子任务行的阻塞标记", () => {
  it("前置未完成的子任务行戴紧凑阻塞标记", () => {
    seedSubtasks([
      subtaskFixture("s1", TASK_ID, { title: "收集数据", sortOrder: "a" }),
      subtaskFixture("s2", TASK_ID, { title: "定稿", sortOrder: "b" }),
    ]);
    store.setDependencies([{ kind: "subtask", dependentId: "s2", prerequisiteId: "s1" }]);

    renderDetail();

    expect(screen.getByText("阻塞中")).toBeTruthy();
    store.setDependencies([]);
  });

  it("已完成的子任务行不再戴标记", () => {
    seedSubtasks([
      subtaskFixture("s1", TASK_ID, { title: "收集数据", sortOrder: "a" }),
      subtaskFixture("s2", TASK_ID, { title: "定稿", done: true, sortOrder: "b" }),
    ]);
    store.setDependencies([{ kind: "subtask", dependentId: "s2", prerequisiteId: "s1" }]);

    renderDetail();

    expect(screen.getByText("定稿")).toBeTruthy();
    expect(screen.queryByText("阻塞中")).toBeNull();
    store.setDependencies([]);
  });
});

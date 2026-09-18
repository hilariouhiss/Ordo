import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import * as store from "../store";
import type { Comment, Task, TimeEntry } from "../types";
import { TaskDetailDialog } from "../components/TaskDetailDialog";

vi.mock("../api", () => ({
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
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
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
    parentTaskId: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

/** A child of the task under test: the same row with `parentTaskId` set. */
function childFixture(id: string, overrides: Partial<Task> = {}): Task {
  return taskFixture(id, { title: `子任务 ${id}`, parentTaskId: TASK_ID, sortOrder: id, ...overrides });
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

/** Puts children under the task under test: one snapshot, one collection — a
 * child is a row in `tasks`, so there is no cache to seed. */
function seedChildren(...children: Task[]): void {
  store.setAll([...store.tasks(), ...children], []);
}

function renderDetail(fixture: Task = taskFixture(TASK_ID)) {
  const onEdit = vi.fn();
  const onOpenChange = vi.fn();
  render(() => (
    <TaskDetailDialog open={true} onOpenChange={onOpenChange} task={fixture} onEdit={onEdit} />
  ));
  return { onEdit, onOpenChange };
}

function childIdsInOrder(): string[] {
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
  it("lists children straight from the store, with no loading gate", async () => {
    store.setAll(
      [
        taskFixture("t1"),
        taskFixture("c1", { parentTaskId: "t1", title: "收集数据" }),
      ],
      [],
    );
    renderDetail(taskFixture("t1"));

    expect(await screen.findByText("收集数据")).toBeTruthy();
  });

  it("opens the child's own detail from its row", async () => {
    store.setAll(
      [
        taskFixture("t1"),
        taskFixture("c1", { parentTaskId: "t1", title: "收集数据" }),
      ],
      [],
    );
    renderDetail(taskFixture("t1"));

    fireEvent.click(await screen.findByText("收集数据"));

    // The nested dialog is the child's: its title is the dialog heading now.
    expect(await screen.findByRole("heading", { name: "收集数据" })).toBeTruthy();
  });

  it("takes the child's dialog down with the host when the host closes", async () => {
    store.setAll(
      [
        taskFixture("t1"),
        taskFixture("c1", { parentTaskId: "t1", title: "收集数据" }),
      ],
      [],
    );
    // The list view's own wiring: 编辑 in a detail closes it and opens the
    // editor. Both the host's and the child's dialog call that same callback,
    // and closing the host is a *prop* change, not the nested dialog's own
    // `onOpenChange` — which is exactly why the nested one has to be gated on
    // `open` too, or it stays mounted over the editor.
    const [open, setOpen] = createSignal(true);
    render(() => (
      <TaskDetailDialog
        open={open()}
        onOpenChange={setOpen}
        task={taskFixture("t1")}
        onEdit={() => setOpen(false)}
      />
    ));

    fireEvent.click(await screen.findByText("收集数据"));
    const childDialog = (await screen.findByRole("heading", { name: "收集数据" })).closest(
      "[role='dialog']",
    ) as HTMLElement;

    fireEvent.click(within(childDialog).getByRole("button", { name: "编辑" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "收集数据" })).toBeNull());

    // Re-opening the host does not resurrect it: the stacked child is dropped
    // with the host, not merely hidden behind the closed one.
    setOpen(true);
    expect(await screen.findByRole("heading", { name: "任务 t1" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "收集数据" })).toBeNull();
  });

  it("shows the task's fields and the child completion progress", () => {
    store.setAll(
      [
        taskFixture(TASK_ID, {
          title: "发布周报",
          note: "先整理本周数据",
          priority: "high",
          dueAt: "2026-09-09T23:00:00Z",
          complexity: 4,
        }),
        childFixture("s1", { sortOrder: "a", completedAt: "2026-09-09T10:00:00Z" }),
        childFixture("s2", { sortOrder: "b" }),
        childFixture("s3", { sortOrder: "c" }),
      ],
      [],
    );

    renderDetail();

    expect(screen.getByText("发布周报")).toBeTruthy();
    expect(screen.getByText("先整理本周数据")).toBeTruthy();
    expect(screen.getByText("高")).toBeTruthy();
    expect(screen.getByText("复杂度 4")).toBeTruthy();
    expect(screen.getByText("1/3 已完成")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
  });

  it("keeps the loading placeholder on the two caches that still have one", async () => {
    renderDetail();

    // 子任务 no longer loads — it is a filter over the task snapshot — so only
    // the comment and time-entry caches show a placeholder.
    expect(screen.getAllByRole("status").map((el) => el.textContent)).toEqual([
      "评论加载中…",
      "时间记录加载中…",
    ]);
    expect(await screen.findByLabelText("添加评论")).toBeTruthy();
    expect(await screen.findByLabelText("时长（分钟）")).toBeTruthy();
  });

  it("adds a child task from the input on Enter", async () => {
    vi.mocked(api.createTask).mockResolvedValue(
      childFixture("created-1", { title: "新的子任务" }),
    );

    renderDetail();

    fireEvent.input(screen.getByLabelText("添加子任务"), {
      target: { value: "新的子任务" },
    });
    fireEvent.keyDown(screen.getByLabelText("添加子任务"), { key: "Enter" });

    expect(screen.getByText("新的子任务")).toBeTruthy(); // optimistic row
    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({
        title: "新的子任务",
        parentTaskId: TASK_ID,
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("添加子任务") as HTMLInputElement).value).toBe(""),
    );
  });

  it("lets the IME take the Enter that commits a composition (children)", async () => {
    seedChildren(childFixture("s1", { title: "旧标题" }));

    renderDetail();

    // Adding: Enter mid-composition must not file the half-typed title.
    fireEvent.input(screen.getByLabelText("添加子任务"), { target: { value: "新子任务" } });
    fireEvent.keyDown(screen.getByLabelText("添加子任务"), { key: "Enter", isComposing: true });
    expect(api.createTask).not.toHaveBeenCalled();

    // Renaming: same story, the title stays editable.
    fireEvent.click(screen.getByRole("button", { name: "重命名子任务 旧标题" }));
    const editor = screen.getByDisplayValue("旧标题") as HTMLInputElement;
    fireEvent.input(editor, { target: { value: "新标题" } });
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
    expect(api.updateTask).not.toHaveBeenCalled();

    // The next Enter (composition finished) does go through.
    vi.mocked(api.updateTask).mockResolvedValue(childFixture("s1", { title: "新标题" }));
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith("s1", { title: "新标题" }));
  });

  it("checks a child and the progress follows optimistically", async () => {
    seedChildren(
      childFixture("s1", { sortOrder: "a", completedAt: "2026-09-09T10:00:00Z" }),
      childFixture("s2", { sortOrder: "b" }),
    );

    renderDetail();

    expect(screen.getByText("1/2 已完成")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "完成子任务 子任务 s2" }));

    expect(screen.getByText("2/2 已完成")).toBeTruthy();
    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith("s2"));
  });

  it("renames a child in place (Enter commits, empty cancels)", async () => {
    seedChildren(childFixture("s1", { title: "旧标题" }));
    vi.mocked(api.updateTask).mockResolvedValue(childFixture("s1", { title: "新标题" }));

    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "重命名子任务 旧标题" }));

    const input = screen.getByDisplayValue("旧标题") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "新标题" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith("s1", { title: "新标题" }));
    expect(screen.getByText("新标题")).toBeTruthy();

    // Renaming to whitespace-only does not hit the backend.
    fireEvent.click(screen.getByRole("button", { name: "重命名子任务 新标题" }));
    const again = screen.getByDisplayValue("新标题") as HTMLInputElement;
    fireEvent.input(again, { target: { value: "   " } });
    fireEvent.keyDown(again, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("新标题")).toBeTruthy());
    expect(api.updateTask).toHaveBeenCalledTimes(1);
  });

  it("deletes a child from the row button", async () => {
    seedChildren(childFixture("s1", { title: "要删的" }));
    vi.mocked(api.softDeleteTask).mockResolvedValue(undefined);

    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "删除子任务 要删的" }));

    await waitFor(() => expect(api.softDeleteTask).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.queryByText("要删的")).toBeNull());
  });

  it("hands a child to the editor from the sliders button", () => {
    seedChildren(childFixture("s1", { title: "定稿" }));

    const { onEdit } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "编辑子任务 定稿" }));

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
  });

  it("moves a child up by passing the neighbours' sort keys", async () => {
    seedChildren(
      childFixture("s1", { sortOrder: "a" }),
      childFixture("s2", { sortOrder: "b" }),
      childFixture("s3", { sortOrder: "c" }),
    );
    // The backend owns both the keys and the positions, so the hook installs
    // the run it returns instead of guessing the order optimistically.
    vi.mocked(api.reorderTask).mockResolvedValue({
      moved: childFixture("s2", { sortOrder: "a" }),
      rebalanced: [{ id: "s1", sortOrder: "b" }],
    });

    renderDetail();

    // Move up from the middle: target slot is the list head.
    fireEvent.click(screen.getByRole("button", { name: "上移子任务 子任务 s2" }));

    await waitFor(() => expect(api.reorderTask).toHaveBeenCalledWith("s2", null, "a"));
    await waitFor(() => expect(childIdsInOrder()).toEqual(["s2", "s1", "s3"]));
  });

  it("moves a child down by passing the neighbours' sort keys", async () => {
    seedChildren(
      childFixture("s1", { sortOrder: "a" }),
      childFixture("s2", { sortOrder: "b" }),
      childFixture("s3", { sortOrder: "c" }),
    );
    vi.mocked(api.reorderTask).mockResolvedValue({
      moved: childFixture("s2", { sortOrder: "c" }),
      rebalanced: [{ id: "s3", sortOrder: "b" }],
    });

    renderDetail();

    // Move down from the middle to the tail: the slot after the last sibling
    // has no neighbour, so `next` is null.
    fireEvent.click(screen.getByRole("button", { name: "下移子任务 子任务 s2" }));

    await waitFor(() => expect(api.reorderTask).toHaveBeenCalledWith("s2", "c", null));
    await waitFor(() => expect(childIdsInOrder()).toEqual(["s1", "s3", "s2"]));
  });

  it("disables the move buttons at the list ends", () => {
    seedChildren(
      childFixture("s1", { sortOrder: "a" }),
      childFixture("s2", { sortOrder: "b" }),
    );

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
      { dependentId: TASK_ID, prerequisiteId: "b" },
      { dependentId: "c", prerequisiteId: TASK_ID },
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

  it("offers only top-level tasks as prerequisites", async () => {
    store.setAll(
      [
        taskFixture("t1"),
        taskFixture("top", { title: "顶层候选" }),
        taskFixture("child", { title: "子任务候选", parentTaskId: "top" }),
      ],
      [],
    );
    renderDetail(taskFixture("t1"));

    fireEvent.input(await screen.findByPlaceholderText("输入任务标题以添加前置"), {
      target: { value: "候选" },
    });

    expect(await screen.findByText("顶层候选")).toBeTruthy();
    expect(screen.queryByText("子任务候选")).toBeNull();
  });

  it("offers a child only its siblings as prerequisites", async () => {
    const parent = taskFixture("top", { title: "顶层候选" });
    const sibling = taskFixture("sib", { title: "兄弟候选", parentTaskId: "top", sortOrder: "a" });
    const self = taskFixture("kid", { title: "被看的子任务", parentTaskId: "top", sortOrder: "b" });
    store.setAll([parent, sibling, self], []);
    renderDetail(self);

    fireEvent.input(await screen.findByPlaceholderText("输入任务标题以添加前置"), {
      target: { value: "候选" },
    });

    // §7.4: a child's candidates are the tasks under the same parent — its
    // parent is not a step beside it, and neither is a task from elsewhere in
    // the app. Both match the search term, so the two assertions cannot pass by
    // the term matching nothing.
    expect(await screen.findByRole("button", { name: "添加前置 兄弟候选" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "添加前置 顶层候选" })).toBeNull();
  });
});

describe("子任务行的依赖是普通任务依赖", () => {
  it("子任务的前置就在它自己的详情依赖区里增删", async () => {
    store.setAll(
      [
        taskFixture(TASK_ID, { title: "写周报" }),
        childFixture("s1", { title: "收集数据", sortOrder: "a" }),
        childFixture("s2", { title: "定稿", sortOrder: "b" }),
      ],
      [],
    );
    store.setDependencies([{ dependentId: "s2", prerequisiteId: "s1" }]);
    vi.mocked(api.removeDependency).mockResolvedValue(undefined);

    // 定稿 has a detail of its own (R7c), and that is where its prerequisites
    // are managed now: the edge joins two task ids like any other, so nothing
    // about it is child-specific.
    renderDetail(childFixture("s2", { title: "定稿", sortOrder: "b" }));

    const section = await screen.findByRole("region", { name: "依赖" });
    expect(within(section).getByText("收集数据")).toBeTruthy();

    fireEvent.click(within(section).getByRole("button", { name: "移除前置 收集数据" }));
    await waitFor(() =>
      expect(api.removeDependency).toHaveBeenCalledWith({
        dependentId: "s2",
        prerequisiteId: "s1",
      }),
    );
    store.setDependencies([]);
  });
});

describe("任务详情的阻塞标记", () => {
  it("有未完成前置的任务在徽标区显示「阻塞中 · 还差 N 项」", () => {
    store.setAll(
      [taskFixture(TASK_ID), taskFixture("b", { title: "收集数据" })],
      [],
    );
    store.setDependencies([{ dependentId: TASK_ID, prerequisiteId: "b" }]);

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
    store.setDependencies([{ dependentId: TASK_ID, prerequisiteId: "b" }]);

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
    seedChildren(
      childFixture("s1", { title: "收集数据", sortOrder: "a" }),
      childFixture("s2", { title: "定稿", sortOrder: "b" }),
    );
    store.setDependencies([{ dependentId: "s2", prerequisiteId: "s1" }]);

    renderDetail();

    expect(screen.getByText("阻塞中")).toBeTruthy();
    store.setDependencies([]);
  });

  it("已完成的子任务行不再戴标记", () => {
    seedChildren(
      childFixture("s1", { title: "收集数据", sortOrder: "a" }),
      childFixture("s2", {
        title: "定稿",
        sortOrder: "b",
        completedAt: "2026-09-09T10:00:00Z",
      }),
    );
    store.setDependencies([{ dependentId: "s2", prerequisiteId: "s1" }]);

    renderDetail();

    expect(screen.getByText("定稿")).toBeTruthy();
    expect(screen.queryByText("阻塞中")).toBeNull();
    store.setDependencies([]);
  });
});

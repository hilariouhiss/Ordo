/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import * as api from "../api";
import * as store from "../store";
import type { Subtask, Task } from "../types";
import { SubtaskRow } from "../components/SubtaskRow";
import { CompletedView } from "../components/views/CompletedView";
import { InboxView } from "../components/views/InboxView";
import { TodayView } from "../components/views/TodayView";
import { UpcomingView } from "../components/views/UpcomingView";

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

// Only Date is faked: the views must derive "today" boundaries in the local
// timezone against a pinned clock, while waitFor keeps real timers.
vi.useFakeTimers({ toFake: ["Date"] });

/** 2026-09-09 12:00 in the test machine's local timezone. */
const NOW = new Date(2026, 8, 9, 12, 0);

/** ISO timestamp `dayOffset` days from today at `hour:minute` local time. */
function iso(dayOffset: number, hour: number, minute = 0): string {
  return new Date(2026, 8, 9 + dayOffset, hour, minute).toISOString();
}

function task(id: string, overrides: Partial<Task> = {}): Task {
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

function subtask(id: string, taskId: string, title: string, done = false): Subtask {
  return {
    id,
    taskId,
    title,
    done,
    sortOrder: "n",
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function selectFromCombobox(triggerName: RegExp, optionName: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name: triggerName }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
  store.resetTasksStore();
});

afterEach(cleanup);

describe("TodayView", () => {
  it("shows today and overdue tasks, hiding future, undated, and completed ones", () => {
    store.setAll(
      [
        task("today", { dueAt: iso(0, 23) }),
        task("overdue", { dueAt: iso(-1, 10) }),
        task("tomorrow", { dueAt: iso(1, 9) }),
        task("undated"),
        task("done", { dueAt: iso(0, 9), completedAt: iso(0, 10) }),
      ],
      [],
    );

    render(() => <TodayView />);

    expect(screen.getByText("任务 today")).toBeTruthy();
    expect(screen.getByText("任务 overdue")).toBeTruthy();
    expect(screen.getByText("昨天 10:00")).toBeTruthy();
    expect(screen.queryByText("任务 tomorrow")).toBeNull();
    expect(screen.queryByText("任务 undated")).toBeNull();
    expect(screen.queryByText("任务 done")).toBeNull();
    expect(screen.getByText("2 个任务")).toBeTruthy();
  });

  it("completing a task removes it instantly (optimistic) and calls task:complete", async () => {
    const item = task("t1", { dueAt: iso(0, 23) });
    store.setAll([item], []);
    const pending = deferred<Task>();
    vi.mocked(api.completeTask).mockReturnValue(pending.promise);

    render(() => <TodayView />);
    fireEvent.click(screen.getByRole("checkbox", { name: "完成 任务 t1" }));

    // Gone before the backend replied — the optimistic patch already ran.
    expect(screen.queryByText("任务 t1")).toBeNull();

    pending.resolve(task("t1", { dueAt: iso(0, 23), completedAt: iso(0, 12) }));
    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith("t1"));
  });

  it("a completed task shows up in the completed view", () => {
    store.setAll(
      [task("t1", { dueAt: iso(0, 23), completedAt: iso(0, 12) })],
      [],
    );

    render(() => <CompletedView />);

    expect(screen.getByText("任务 t1")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "恢复 任务 t1" })).toBeTruthy();
  });

  it("rolls the optimistic completion back when the backend rejects it", async () => {
    store.setAll([task("t1", { dueAt: iso(0, 23) })], []);
    vi.mocked(api.completeTask).mockRejectedValue({ code: "database", message: "写入失败" });

    render(() => <TodayView />);
    fireEvent.click(screen.getByRole("checkbox", { name: "完成 任务 t1" }));

    await waitFor(() => expect(api.completeTask).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("任务 t1")).toBeTruthy());
  });

  it("loads data on mount and shows the empty pane when nothing is due", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([]);
    vi.mocked(api.listTags).mockResolvedValue([]);

    render(() => <TodayView />);

    expect(screen.getByRole("status").textContent).toBe("加载中…");
    expect(await screen.findByText("今天没有到期任务")).toBeTruthy();
    expect(api.listTasks).toHaveBeenCalledTimes(1);
  });

  it("offers a working retry after a failed load", async () => {
    vi.mocked(api.listTasks)
      .mockRejectedValueOnce({ code: "database", message: "读取失败" })
      .mockResolvedValueOnce([task("t1", { dueAt: iso(0, 23) })]);
    vi.mocked(api.listTags).mockResolvedValue([]);

    render(() => <TodayView />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText("任务 t1")).toBeTruthy();
    expect(api.listTasks).toHaveBeenCalledTimes(2);
  });

  it("virtualizes: 10k tasks render only a window of rows", () => {
    const many = Array.from({ length: 10_000 }, (_, i) =>
      task(`big-${String(i).padStart(5, "0")}`, {
        dueAt: iso(0, 23),
        sortOrder: String(i).padStart(6, "0"),
      }),
    );
    store.setAll(many, []);

    render(() => <TodayView />);

    const rendered = screen.getAllByRole("listitem");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(50);
    expect(screen.getByText("任务 big-00000")).toBeTruthy();
    expect(screen.getByText("10000 个任务")).toBeTruthy();
  });

  it("opens the task detail (with subtask loading) when a row title is clicked", async () => {
    store.setAll([task("t1", { title: "旧标题", dueAt: iso(0, 23) })], []);

    render(() => <TodayView />);
    fireEvent.click(screen.getByText("旧标题"));

    expect(await screen.findByText("任务详情与子任务")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    await waitFor(() => expect(api.listSubtasks).toHaveBeenCalledWith("t1"));
  });

  it("opens the editor prefilled from the row menu", async () => {
    store.setAll([task("t1", { title: "旧标题", dueAt: iso(0, 23) })], []);

    render(() => <TodayView />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "任务操作：旧标题" }));
    fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "编辑" }));

    expect(await screen.findByText("编辑任务")).toBeTruthy();
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("旧标题");
  });

  it("soft-deletes a task from the row menu", async () => {
    store.setAll([task("t1", { dueAt: iso(0, 23) })], []);
    vi.mocked(api.softDeleteTask).mockResolvedValue(undefined);

    render(() => <TodayView />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "任务操作：任务 t1" }));
    fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "删除" }));

    await waitFor(() => expect(api.softDeleteTask).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.queryByText("任务 t1")).toBeNull());
  });
});

describe("InboxView", () => {
  it("lists uncompleted project-less tasks only", () => {
    store.setAll(
      [task("plain"), task("in-project", { projectId: "p1" }), task("done", { completedAt: iso(0, 11) })],
      [],
    );

    render(() => <InboxView />);

    expect(screen.getByText("任务 plain")).toBeTruthy();
    expect(screen.queryByText("任务 in-project")).toBeNull();
    expect(screen.queryByText("任务 done")).toBeNull();
  });

  it("creates a task through the dialog and shows it immediately", async () => {
    store.setAll([], []);
    const created = task("created-1", { title: "从视图新建的任务" });
    vi.mocked(api.createTask).mockResolvedValue(created);

    render(() => <InboxView />);
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));

    fireEvent.input(screen.getByLabelText("标题"), { target: { value: "从视图新建的任务" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(screen.queryByText("填写任务内容，标题必填")).toBeNull(),
    );
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "从视图新建的任务" }),
    );
    expect(screen.getByText("从视图新建的任务")).toBeTruthy();
  });
});

describe("UpcomingView", () => {
  it("lists tasks due within the selected range only", async () => {
    store.setAll(
      [task("in-3d", { dueAt: iso(3, 9) }), task("in-10d", { dueAt: iso(10, 9) }), task("today", { dueAt: iso(0, 23) })],
      [],
    );

    render(() => <UpcomingView />);

    expect(screen.getByText("任务 in-3d")).toBeTruthy();
    expect(screen.queryByText("任务 in-10d")).toBeNull();
    expect(screen.queryByText("任务 today")).toBeNull();

    await selectFromCombobox(/时间范围/, "未来 14 天");

    expect(screen.getByText("任务 in-3d")).toBeTruthy();
    expect(screen.getByText("任务 in-10d")).toBeTruthy();
  });

  it("defaults to due-date order (earliest first)", () => {
    store.setAll([
      task("later", { dueAt: iso(5, 9), sortOrder: "a" }),
      task("sooner", { dueAt: iso(2, 9), sortOrder: "z" }),
    ], []);

    render(() => <UpcomingView />);

    const ids = [
      ...(document.querySelector('[role="list"]') as HTMLElement).querySelectorAll("[data-task-id]"),
    ].map((el) => el.getAttribute("data-task-id"));
    expect(ids).toEqual(["sooner", "later"]);
  });
});

describe("CompletedView", () => {
  it("lists completed tasks and unchecking restores one to todo", async () => {
    const done = task("t1", { completedAt: iso(0, 11) });
    store.setAll([done, task("open")], []);
    vi.mocked(api.updateTask).mockResolvedValue(task("t1"));

    render(() => <CompletedView />);
    expect(screen.getByText("任务 t1")).toBeTruthy();
    expect(screen.queryByText("任务 open")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "恢复 任务 t1" }));

    expect(screen.queryByText("任务 t1")).toBeNull();
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith("t1", { completedAt: null }));
  });
});

describe("filtering and sorting", () => {
  it("filters by priority", async () => {
    store.setAll(
      [
        task("high", { dueAt: iso(0, 23), priority: "high" }),
        task("low", { dueAt: iso(0, 23), priority: "low" }),
      ],
      [],
    );

    render(() => <TodayView />);
    await selectFromCombobox(/优先级筛选/, "仅高");

    expect(screen.getByText("任务 high")).toBeTruthy();
    expect(screen.queryByText("任务 low")).toBeNull();
    expect(screen.getByText("1 个任务")).toBeTruthy();
  });

  it("filters by tag (any-of) through the tag dropdown", async () => {
    store.setAll(
      [
        task("work", { dueAt: iso(0, 23), tagIds: ["t-work"] }),
        task("life", { dueAt: iso(0, 23), tagIds: ["t-life"] }),
      ],
      [
        {
          id: "t-work",
          name: "工作",
          color: null,
          createdAt: "2026-09-01T10:00:00Z",
          updatedAt: "2026-09-01T10:00:00Z",
          deletedAt: null,
        },
        {
          id: "t-life",
          name: "生活",
          color: "#00aa00",
          createdAt: "2026-09-01T10:00:00Z",
          updatedAt: "2026-09-01T10:00:00Z",
          deletedAt: null,
        },
      ],
    );

    render(() => <TodayView />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "按标签筛选" }));
    fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "工作" }));

    await waitFor(() => expect(screen.getByText("1 个任务")).toBeTruthy());
    expect(screen.getByText("任务 work")).toBeTruthy();
    expect(screen.queryByText("任务 life")).toBeNull();
  });

  it("switches to due-date ordering on demand", async () => {
    store.setAll(
      [
        task("later", { dueAt: iso(0, 23), sortOrder: "a" }),
        task("sooner", { dueAt: iso(0, 20), sortOrder: "z" }),
      ],
      [],
    );

    render(() => <TodayView />);
    await selectFromCombobox(/排序方式/, "按截止日期");

    const ids = [
      ...(document.querySelector('[role="list"]') as HTMLElement).querySelectorAll("[data-task-id]"),
    ].map((el) => el.getAttribute("data-task-id"));
    expect(ids).toEqual(["sooner", "later"]);
  });
});

describe("任务行的子任务展开位", () => {
  it("shows a disclosure control and a done/total badge when the task has subtasks", async () => {
    store.setAll([task("t1")], []);
    store.setSubtasks("t1", [
      subtask("s1", "t1", "第一步", true),
      subtask("s2", "t1", "第二步", false),
      subtask("s3", "t1", "第三步", false),
    ]);
    vi.mocked(api.listTasks).mockResolvedValue([task("t1")]);

    render(() => <InboxView />);

    expect(await screen.findByRole("button", { name: "展开 任务 t1 的子任务" })).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("renders neither a disclosure control nor a badge for a childless task", async () => {
    store.setAll([task("t1")], []);
    store.setSubtasks("t1", []);
    vi.mocked(api.listTasks).mockResolvedValue([task("t1")]);

    render(() => <InboxView />);

    expect(await screen.findByText("任务 t1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /的子任务/ })).toBeNull();
    expect(screen.queryByText(/^\d+\/\d+$/)).toBeNull();
  });
});

describe("SubtaskRow", () => {
  it("toggles done through the callback and opens the parent's detail", () => {
    const parent = task("t1");
    const child = subtask("s1", "t1", "第一步");
    const onToggleDone = vi.fn();
    const onOpenDetail = vi.fn();

    render(() => (
      <SubtaskRow
        subtask={child}
        parent={parent}
        onToggleDone={onToggleDone}
        onOpenDetail={onOpenDetail}
      />
    ));

    fireEvent.click(screen.getByRole("checkbox", { name: "完成子任务 第一步" }));
    expect(onToggleDone).toHaveBeenCalledWith(parent, child, true);

    fireEvent.click(screen.getByText("第一步"));
    expect(onOpenDetail).toHaveBeenCalledWith(parent);
  });

  it("strikes through a done subtask", () => {
    render(() => (
      <SubtaskRow
        subtask={subtask("s1", "t1", "第一步", true)}
        parent={task("t1")}
        onToggleDone={vi.fn()}
        onOpenDetail={vi.fn()}
      />
    ));

    expect(screen.getByRole("checkbox", { name: "恢复子任务 第一步" })).toBeTruthy();
    expect(screen.getByText("第一步").className).toContain("line-through");
  });

  it("keeps the rail slot 20px wide and stretched to the row height", () => {
    const { container } = render(() => (
      <SubtaskRow
        subtask={subtask("s1", "t1", "第一步")}
        parent={task("t1")}
        onToggleDone={vi.fn()}
        onOpenDetail={vi.fn()}
      />
    ));

    // jsdom has no layout engine, so height/width cannot be measured here: the
    // class contract is the only assertable half. `w-5` (not `size-5`, which
    // would also pin a 20px *height* and, under the row's `items-center`, clamp
    // the rail to a 20px tick with a 36px break between rows) plus
    // `self-stretch`, which is what makes the rail span the full 56px row.
    const slot = (container.querySelector("[data-subtask-id]") as HTMLElement)
      .firstElementChild as HTMLElement;
    expect(slot.className).toContain("w-5");
    expect(slot.className).toContain("self-stretch");
    // ...and nothing may re-pin the cross size: `h-5`/`size-5` alongside them
    // is exactly the regression `self-stretch` cannot out-rank, because a
    // definite cross size makes `align-self: stretch` a no-op.
    expect(slot.className).not.toMatch(/\b(?:size|h)-\d/);
  });
});

describe("任务列表的层级展示", () => {
  function seedWithSubtasks() {
    store.setAll([task("t1"), task("t2")], []);
    store.setSubtasks("t1", [
      subtask("s1", "t1", "收集意见", true),
      subtask("s2", "t1", "定稿", false),
    ]);
    store.setSubtasks("t2", []);
  }

  it("starts collapsed and hides the children", async () => {
    seedWithSubtasks();
    render(() => <InboxView />);

    expect(await screen.findByText("任务 t1")).toBeTruthy();
    expect(screen.queryByText("收集意见")).toBeNull();
    expect(screen.getByText("1/2")).toBeTruthy();
    // The badge's digits stay visible; the label is what a screen reader reads.
    expect(screen.getByText("1/2").getAttribute("aria-label")).toBe("子任务 1/2 已完成");
  });

  it("expands to list the cached children in their seeded order and collapses again", async () => {
    seedWithSubtasks();
    render(() => <InboxView />);

    fireEvent.click(await screen.findByRole("button", { name: "展开 任务 t1 的子任务" }));

    // The view renders the cache's own order; `sortOrder` belongs to the Rust
    // query and is asserted there. This guards the flattening.
    const rendered = [
      ...(document.querySelector('[role="list"]') as HTMLElement).querySelectorAll(
        "[data-subtask-id]",
      ),
    ].map((el) => el.getAttribute("data-subtask-id"));
    expect(rendered).toEqual(["s1", "s2"]);

    expect(screen.getByText("收集意见")).toBeTruthy();
    expect(screen.getByText("定稿")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起 任务 t1 的子任务" }));
    expect(screen.queryByText("收集意见")).toBeNull();
  });

  it("completes a subtask optimistically and moves the parent's badge", async () => {
    seedWithSubtasks();
    const pending = deferred<Subtask>();
    vi.mocked(api.completeSubtask).mockReturnValue(pending.promise);
    render(() => <InboxView />);

    fireEvent.click(await screen.findByRole("button", { name: "展开 任务 t1 的子任务" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "完成子任务 定稿" }));

    // The badge moves in the same frame, before the backend answers.
    expect(screen.getByText("2/2")).toBeTruthy();
    expect(api.completeSubtask).toHaveBeenCalledWith("s2", true);

    pending.resolve(subtask("s2", "t1", "定稿", true));
    await waitFor(() => expect(screen.getByText("2/2")).toBeTruthy());
  });

  it("opens the parent's detail when a subtask title is clicked", async () => {
    seedWithSubtasks();
    render(() => <InboxView />);

    fireEvent.click(await screen.findByRole("button", { name: "展开 任务 t1 的子任务" }));
    fireEvent.click(screen.getByText("收集意见"));

    expect(await screen.findByText("任务详情与子任务")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "任务 t1" })).toBeTruthy();
  });

  it("keeps every child of an expanded task while a filter is active", async () => {
    store.setAll([task("t1", { priority: "high" }), task("t2", { priority: "low" })], []);
    store.setSubtasks("t1", [
      subtask("s1", "t1", "收集意见"),
      subtask("s2", "t1", "定稿"),
    ]);
    render(() => <InboxView />);

    expect(await screen.findByText("任务 t2")).toBeTruthy();

    await selectFromCombobox(/优先级筛选/, "仅高");
    fireEvent.click(await screen.findByRole("button", { name: "展开 任务 t1 的子任务" }));

    // The filter really ran: the low-priority task is gone.
    expect(screen.queryByText("任务 t2")).toBeNull();

    // Subtasks carry no priority, so they are never filtered: a badge reading
    // 0/2 above a single visible row would be lying.
    expect(screen.getByText("收集意见")).toBeTruthy();
    expect(screen.getByText("定稿")).toBeTruthy();
  });
});

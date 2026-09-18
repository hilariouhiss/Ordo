import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginDrag } from "../../../common/stores/drag";
import * as api from "../api";
import * as hooks from "../hooks";
import * as store from "../store";
import type { Task } from "../types";
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
  reorderTask: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listDependencies: vi.fn().mockResolvedValue([]),
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

/** A task row; a child is the same row with `parentTaskId` set (R7c). */
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

/** A top-level task plus two children that are *not* due today, so 今天 shows
 * only the parent until its disclosure opens. */
function seedParentWithTomorrowChildren() {
  store.setAll(
    [
      task("p1", { title: "写周报", dueAt: iso(0, 12), sortOrder: "a" }),
      task("c1", { title: "收集数据", parentTaskId: "p1", dueAt: iso(1, 9), sortOrder: "a" }),
      task("c2", { title: "定稿", parentTaskId: "p1", dueAt: iso(1, 10), sortOrder: "b" }),
      task("p2", { title: "读论文", dueAt: iso(0, 14), sortOrder: "b" }),
    ],
    [],
  );
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

  it("re-reads the day boundary when the window regains focus after midnight", () => {
    store.setAll(
      [
        task("tonight", { title: "今晚的活", dueAt: iso(0, 23), sortOrder: "a" }),
        task("tomorrow", { title: "明早的活", dueAt: iso(1, 9), sortOrder: "b" }),
      ],
      [],
    );

    render(() => <TodayView />);
    expect(screen.queryByText("明早的活")).toBeNull();

    // The session sat open past midnight with no store change in between.
    vi.setSystemTime(new Date(2026, 8, 10, 0, 30));
    window.dispatchEvent(new Event("focus"));

    expect(screen.getByText("明早的活")).toBeTruthy();
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

  it("keeps a row's DOM node when an unrelated task joins the store", () => {
    store.setAll(
      [
        task("t1", { dueAt: iso(0, 23), sortOrder: "a" }),
        task("t2", { dueAt: iso(0, 23), sortOrder: "b" }),
      ],
      [],
    );
    render(() => <TodayView />);

    const row = screen.getByText("任务 t1").closest("[data-key]");
    expect(row).toBeTruthy();

    // A store change that does not touch t1 at all: its row must be patched,
    // not destroyed and rebuilt (the row hosts a dropdown menu, and rebuilding
    // it drops focus and any open menu).
    store.upsertTask(task("later", { dueAt: iso(3, 9), sortOrder: "c" }));

    expect(screen.getByText("任务 t1").closest("[data-key]")).toBe(row);

    // …and reusing the row still updates what it shows.
    store.patchTask("t1", { title: "改过名的任务" });
    expect(screen.getByText("改过名的任务").closest("[data-key]")).toBe(row);
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

  it("opens the task detail when a row title is clicked", async () => {
    store.setAll([task("t1", { title: "旧标题", dueAt: iso(0, 23) })], []);

    render(() => <TodayView />);
    fireEvent.click(screen.getByText("旧标题"));

    expect(await screen.findByText("任务详情与子任务")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    // The child list needs no load of its own any more, so it never shows one.
    expect(screen.queryByText("子任务加载中…")).toBeNull();
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
  it("shows a disclosure control and a done/total badge when the task has children", async () => {
    store.setAll(
      [
        task("t1", { title: "写周报", dueAt: iso(0, 12), sortOrder: "a" }),
        task("s1", {
          title: "第一步",
          parentTaskId: "t1",
          dueAt: iso(1, 9),
          sortOrder: "a",
          completedAt: iso(0, 10),
        }),
        task("s2", { title: "第二步", parentTaskId: "t1", dueAt: iso(1, 10), sortOrder: "b" }),
        task("s3", { title: "第三步", parentTaskId: "t1", dueAt: iso(1, 11), sortOrder: "c" }),
      ],
      [],
    );

    render(() => <TodayView />);

    // The children are due tomorrow, so 今天 holds the parent alone: rule A does
    // not open it, and the disclosure is the row's own control.
    expect(await screen.findByRole("button", { name: "展开 写周报 的子任务" })).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("renders neither a disclosure control nor a badge for a childless task", async () => {
    store.setAll([task("t1")], []);

    render(() => <InboxView />);

    expect(await screen.findByText("任务 t1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /的子任务/ })).toBeNull();
    expect(screen.queryByText(/^\d+\/\d+$/)).toBeNull();
  });

  it("renders no disclosure control on a row rule A already opened", async () => {
    store.setAll(
      [
        task("t1", { title: "写周报", sortOrder: "a" }),
        task("s1", { title: "第一步", parentTaskId: "t1", sortOrder: "a" }),
      ],
      [],
    );

    render(() => <InboxView />);

    // s1 is an 收件箱 row of its own, so rule A leaves t1 open. A 收起 there
    // could not fold anything away — it only flips the local signal while
    // `isOpen` ORs the auto-open back in — so the row must not claim the action.
    expect(await screen.findByText("第一步")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /写周报 的子任务/ })).toBeNull();
    // The 20px slot stays (a bare span, not the button), so the checkbox below
    // stays in the column every other row shares.
    const slot = (document.querySelector('[data-task-id="t1"]') as HTMLElement)
      .firstElementChild as Element;
    expect(slot.tagName).toBe("SPAN");
    expect(slot.className).toContain("size-5");
  });
});

describe("SubtaskRow", () => {
  it("renders a child task row and checks it off", () => {
    render(() => (
      <SubtaskRow
        task={task("s1", { title: "第一步", parentTaskId: "t1", completedAt: null })}
        blocked={false}
        onToggleDone={vi.fn()}
        onOpenDetail={vi.fn()}
      />
    ));

    expect(screen.getByRole("checkbox", { name: "完成子任务 第一步" })).toBeTruthy();
  });

  it("routes the checkbox and the title to their callbacks", () => {
    const child = task("s1", { title: "第一步", parentTaskId: "t1" });
    const onToggleDone = vi.fn();
    const onOpenDetail = vi.fn();

    render(() => (
      <SubtaskRow
        task={child}
        blocked={false}
        onToggleDone={onToggleDone}
        onOpenDetail={onOpenDetail}
      />
    ));

    fireEvent.click(screen.getByRole("checkbox", { name: "完成子任务 第一步" }));
    expect(onToggleDone).toHaveBeenCalledWith(child, true);

    // A child is a task with a detail of its own (R7c), not a label on its
    // parent's — the title opens *that*.
    fireEvent.click(screen.getByText("第一步"));
    expect(onOpenDetail).toHaveBeenCalledWith(child);
  });

  it("strikes through a finished child", () => {
    render(() => (
      <SubtaskRow
        task={task("s1", { title: "第一步", parentTaskId: "t1", completedAt: iso(0, 10) })}
        blocked={false}
        onToggleDone={vi.fn()}
        onOpenDetail={vi.fn()}
      />
    ));

    expect(screen.getByRole("checkbox", { name: "恢复子任务 第一步" })).toBeTruthy();
    expect(screen.getByText("第一步").className).toContain("line-through");
  });

  it("shows the parent prefix only on a standalone child row", () => {
    const props = {
      task: task("s1", { title: "第一步", parentTaskId: "t1" }),
      blocked: false,
      onToggleDone: vi.fn(),
      onOpenDetail: vi.fn(),
      onOpenParent: vi.fn(),
    };
    const { unmount } = render(() => <SubtaskRow {...props} />);
    expect(screen.queryByText(/父任务/)).toBeNull();
    unmount();

    render(() => <SubtaskRow {...props} parentTitle="写周报" />);
    const prefix = screen.getByRole("button", { name: "打开父任务 写周报" });
    expect(prefix).toBeTruthy();
    // The prefix sits *after* the rail and the checkbox, not before them: the
    // rail's 20px column is what lines this row's checkbox up with every other
    // row's, and a prefix ahead of it pushes the checkbox out of that column.
    const checkbox = screen.getByRole("checkbox", { name: "完成子任务 第一步" });
    expect(
      checkbox.compareDocumentPosition(prefix) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the rail slot 20px wide and stretched to the row height", () => {
    const { container } = render(() => (
      <SubtaskRow
        task={task("s1", { title: "第一步", parentTaskId: "t1" })}
        blocked={false}
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
  function seedHierarchy() {
    store.setAll(
      [
        task("p1", { title: "写周报", dueAt: iso(0, 12) }),
        task("c1", { title: "收集数据", parentTaskId: "p1", dueAt: iso(0, 13) }),
        task("c2", { title: "定稿", parentTaskId: "p1", dueAt: iso(5, 12) }),
        task("p2", { title: "读论文", dueAt: iso(0, 14) }),
      ],
      [],
    );
  }

  it("groups a matched child under its parent instead of listing it twice", async () => {
    seedHierarchy();
    render(() => <TodayView />);

    // p1 and c1 both match "today"; the child renders under its parent, so
    // each title appears exactly once.
    expect(await screen.findAllByText("收集数据")).toHaveLength(1);
    expect(screen.getAllByText("收集数据")[0].closest("[data-subtask-id]")).toBeTruthy();
    // And the row carries no disclosure control at all: rule A is what has it
    // open, so 收起 there could not close anything.
    expect(screen.queryByRole("button", { name: "收起 写周报 的子任务" })).toBeNull();
  });

  it("keeps a child whose parent is missing as a prefixed top-level row", async () => {
    store.setAll(
      [
        task("p1", { title: "写周报", dueAt: iso(5, 12) }),   // not in 今天
        task("c1", { title: "收集数据", parentTaskId: "p1", dueAt: iso(0, 13) }),
      ],
      [],
    );
    render(() => <TodayView />);

    const prefix = await screen.findByRole("button", { name: "打开父任务 写周报" });
    expect(prefix).toBeTruthy();
    expect(screen.getByText("父任务 · 写周报")).toBeTruthy();
  });

  it("filters a standalone child but never a grouped one", async () => {
    store.setAll(
      [
        // p1 is 低, so 仅低 keeps it: c1 then has a parent on screen, which is
        // the whole point — a child only *rides* when its parent survived.
        task("p1", { title: "写周报", dueAt: iso(0, 12), priority: "low" }),
        task("c1", { title: "收集数据", parentTaskId: "p1", dueAt: iso(0, 13), priority: "high" }),
        task("p2", { title: "孤儿子任务", parentTaskId: "gone", dueAt: iso(0, 14), priority: "high" }),
      ],
      [],
    );
    render(() => <TodayView />);

    fireEvent.pointerDown(await screen.findByRole("button", { name: /全部优先级/ }));
    fireEvent.click(await screen.findByRole("option", { name: "仅低" }));

    // p2 stands on its own, so 仅低 drops it. c1 is 高 and still on screen,
    // as p1's child row: a grouped child is its parent's context and no
    // toolbar filter touches it.
    await waitFor(() => expect(screen.queryByText("孤儿子任务")).toBeNull());
    expect(screen.getByText("写周报")).toBeTruthy();
    expect(screen.getByText("收集数据").closest("[data-subtask-id]")).toBeTruthy();
  });

  it("counts the rows the view listed, not the top-level ones", async () => {
    seedHierarchy();
    render(() => <TodayView />);

    // The number is `visible()`: p1 + p2 are rows of the view, c1 rides under
    // p1 as its context and is not a row of its own, so it is not counted. The
    // count therefore holds still when a disclosure opens (§8.7) — p1 is
    // already open here because 今天 matched c1 itself.
    expect(await screen.findByText("2 个任务")).toBeTruthy();
    expect(screen.getByText("收集数据")).toBeTruthy();
  });

  it("counts a standalone child row as the row it is", async () => {
    store.setAll(
      [
        task("p1", { title: "写周报", dueAt: iso(5, 12) }), // not in 今天
        task("c1", { title: "收集数据", parentTaskId: "p1", dueAt: iso(0, 13) }),
      ],
      [],
    );
    render(() => <TodayView />);

    // c1's parent is out of view, so c1 stands on its own and is a row 今天
    // shows: the number counts rows, so it is 1 — the old `parentTaskId ===
    // null` formula printed 0 above this very row.
    expect(await screen.findByText("1 个任务")).toBeTruthy();
    expect(screen.getByText("收集数据")).toBeTruthy();
  });

  it("keeps a child of an expanded parent that the view itself did not match", async () => {
    seedParentWithTomorrowChildren();
    render(() => <TodayView />);

    expect(await screen.findByText("写周报")).toBeTruthy();
    // c1 and c2 are due tomorrow: not 今天 rows of their own, so they stay
    // hidden until the parent's disclosure opens (§8.6: children ride along).
    expect(screen.queryByText("收集数据")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开 写周报 的子任务" }));
    expect(screen.getByText("收集数据")).toBeTruthy();
    expect(screen.getByText("定稿")).toBeTruthy();
    // Still one row each, and the count still counts the parent only.
    expect(screen.getByText("2 个任务")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起 写周报 的子任务" }));
    expect(screen.queryByText("收集数据")).toBeNull();
  });

  it("opens the child's own detail from a child row of the list", async () => {
    seedParentWithTomorrowChildren();
    render(() => <TodayView />);

    fireEvent.click(await screen.findByRole("button", { name: "展开 写周报 的子任务" }));
    fireEvent.click(screen.getByText("收集数据"));

    expect(await screen.findByRole("heading", { name: "收集数据" })).toBeTruthy();
  });

  it("opens the parent's detail from a standalone child's prefix", async () => {
    store.setAll(
      [
        task("p1", { title: "写周报", dueAt: iso(5, 12) }),
        task("c1", { title: "收集数据", parentTaskId: "p1", dueAt: iso(0, 13) }),
      ],
      [],
    );
    render(() => <TodayView />);

    fireEvent.click(await screen.findByRole("button", { name: "打开父任务 写周报" }));

    expect(await screen.findByRole("heading", { name: "写周报" })).toBeTruthy();
  });

  /*
   * The row height lives in three places that cannot see each other:
   * `ROW_HEIGHT` (the virtualizer's only input), the `h-14` both row
   * components must carry to match it, and the 20px gutter that keeps their
   * checkboxes in one column. jsdom has no layout engine, so the classes are
   * the assertable half — pinned here once, rather than in three comments.
   * Tailwind's scale is 4px per unit: h-14 = 56px, (size|w)-5 = 20px.
   */
  it("pins the virtualizer, both row components and the gutter to one scale", async () => {
    /** The height (or width) utilities an element carries, as written. */
    const dimension = (element: Element, axis: "h" | "w") =>
      [...element.classList].filter((name) => new RegExp(`^(?:${axis}|size)-`).test(name));

    seedParentWithTomorrowChildren();
    render(() => <TodayView />);
    // The parent is the only 今天 row with children, and its children are not
    // in 今天 themselves, so the disclosure is what adds the two rows below.
    fireEvent.click(await screen.findByRole("button", { name: "展开 写周报 的子任务" }));

    const list = document.querySelector('[role="list"]') as HTMLElement;
    // Four flattened rows (p1, its two children, p2) at the virtualizer's
    // assumed 56px. A 60px row here would misplace every row below the fold.
    expect((list.firstElementChild as HTMLElement).style.height).toBe("224px");

    const rows = [...list.querySelectorAll<HTMLElement>("[data-task-id], [data-subtask-id]")];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      // Exactly one height class: a second one wins or loses by CSS source
      // order, which is how the rail slot broke before.
      expect(dimension(row, "h")).toEqual(["h-14"]);
    }

    // Disclosure slot (button with children, spacer without) and the child
    // rail: all three are the same 20px, which is what lines the checkboxes up.
    const [withChildren, childless] = [
      ...list.querySelectorAll<HTMLElement>("[data-task-id]"),
    ];
    expect(dimension(withChildren.firstElementChild as Element, "w")).toEqual(["size-5"]);
    expect(dimension(childless.firstElementChild as Element, "w")).toEqual(["size-5"]);
    expect(
      dimension(list.querySelector("[data-subtask-id]")!.firstElementChild as Element, "w"),
    ).toEqual(["w-5"]);
  });
});

describe("阻塞标记", () => {
  it("有未完成前置的任务行显示阻塞中与数量", () => {
    const blocked = task("a");
    const prerequisite = task("b");
    store.setAll([blocked, prerequisite], []);
    store.setDependencies([{ dependentId: "a", prerequisiteId: "b" }]);

    render(() => <InboxView />);
    expect(screen.getByText("阻塞中 · 还差 1 项")).toBeTruthy();

    // Finishing the prerequisite clears the badge.
    store.patchTask("b", { completedAt: "2026-09-14T10:00:00Z" });
    expect(screen.queryByText("阻塞中 · 还差 1 项")).toBeNull();
    store.setDependencies([]);
  });

  it("软删前置后阻塞标记立即消失，恢复后回来", async () => {
    store.setAll([task("a"), task("b")], []);
    store.setDependencies([{ dependentId: "a", prerequisiteId: "b" }]);
    vi.mocked(api.softDeleteTask).mockResolvedValue(undefined);

    render(() => <InboxView />);
    expect(screen.getByText("阻塞中 · 还差 1 项")).toBeTruthy();

    // The delete is optimistic — the row leaves the store at once, while the
    // edge list still holds the edge — so the badge has to go with the row,
    // not on the next load.
    await hooks.softDeleteTask("b");

    expect(store.tasksState.dependencies).toHaveLength(1);
    expect(screen.queryByText("阻塞中 · 还差 1 项")).toBeNull();

    vi.mocked(api.restoreTask).mockResolvedValue(task("b"));
    await hooks.restoreTask("b");

    expect(screen.getByText("阻塞中 · 还差 1 项")).toBeTruthy();
    store.setDependencies([]);
  });

  it("规则 A 打开的子任务行也带标记", () => {
    store.setAll(
      [
        task("a", { sortOrder: "a" }),
        task("s1", { title: "一", parentTaskId: "a", sortOrder: "a" }),
        task("s2", { title: "二", parentTaskId: "a", sortOrder: "b" }),
      ],
      [],
    );
    // A child's edges are ordinary edges: one task id on each end (R7c).
    store.setDependencies([{ dependentId: "s2", prerequisiteId: "s1" }]);

    render(() => <InboxView />);
    // Both children are 收件箱 rows themselves, so rule A has the parent open
    // and the marked child row is on screen without a click.
    expect(screen.getByText("一")).toBeTruthy();
    expect(screen.getByText("二")).toBeTruthy();
    expect(screen.getByText("阻塞中")).toBeTruthy();
    store.setDependencies([]);
  });
});

describe("完成后的行不再戴阻塞标记", () => {
  it("已完成的任务行不显示阻塞中（已完成视图）", () => {
    store.setAll(
      [task("a", { completedAt: iso(0, 12) }), task("b")],
      [],
    );
    store.setDependencies([{ dependentId: "a", prerequisiteId: "b" }]);

    render(() => <CompletedView />);

    // The row is on screen, so the missing badge is the gate, not a missing row.
    expect(screen.getByText("任务 a")).toBeTruthy();
    expect(screen.queryByText("阻塞中 · 还差 1 项")).toBeNull();

    store.setDependencies([]);
  });

  it("已完成的子任务行不戴阻塞中", () => {
    store.setAll(
      [
        task("a", { sortOrder: "a" }),
        task("s1", { title: "一", parentTaskId: "a", sortOrder: "a" }),
        task("s2", {
          title: "二",
          parentTaskId: "a",
          sortOrder: "b",
          completedAt: iso(0, 11),
        }),
      ],
      [],
    );
    store.setDependencies([{ dependentId: "s2", prerequisiteId: "s1" }]);

    render(() => <InboxView />);
    // s2 is finished, so 收件箱 does not hold it on its own: it is on screen as
    // a child of a, whose unfinished child s1 is an 收件箱 row — rule A opens
    // the parent, and *that* child row is the one under test.
    expect(screen.getByText("二")).toBeTruthy();
    expect(screen.queryByText("阻塞中")).toBeNull();

    store.setDependencies([]);
  });
});

/*
 * R7c: a task row is a drop target. Landing on it files the dragged task under
 * that row; the row lights up only when the write would be legal, because a
 * highlight that the service then refuses is a lie.
 */
describe("任务行的落点", () => {
  /** The row of a task, as the drop handler sees it. */
  const rowOf = (id: string) =>
    document.querySelector(`[data-task-id="${id}"]`) as HTMLElement;

  it("files a dragged task under the row it is dropped on", async () => {
    store.setAll(
      [
        task("p1", { title: "写周报", dueAt: iso(0, 12) }),
        task("t2", { title: "收集数据", dueAt: iso(0, 13) }),
      ],
      [],
    );
    vi.mocked(api.updateTask).mockResolvedValue(task("t2", { parentTaskId: "p1" }));
    render(() => <TodayView />);

    const source = rowOf("t2");
    const target = rowOf("p1");

    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    // The legal target takes the highlight; that is what makes the drop
    // predictable before the button comes up.
    expect(target.className).toContain("ring-1");

    fireEvent.drop(target);

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith("t2", { parentTaskId: "p1" }),
    );
    // The parent's project is the authority (`update_task` derives it), so the
    // patch carries nothing else.
    expect(vi.mocked(api.updateTask).mock.calls[0][1]).toEqual({ parentTaskId: "p1" });
  });

  it("refuses every drop the single-level rules reject", async () => {
    store.setAll(
      [
        task("p1", { title: "有子任务的", dueAt: iso(0, 12) }),
        task("c1", { title: "它的孩子", parentTaskId: "p1", dueAt: iso(0, 13) }),
        task("t2", { title: "被拖的", dueAt: iso(0, 14) }),
      ],
      [],
    );
    vi.mocked(api.updateTask).mockResolvedValue(task("t2"));
    render(() => <TodayView />);

    // Onto itself: nothing to do.
    fireEvent.dragStart(rowOf("t2"));
    fireEvent.drop(rowOf("t2"));

    // A task that already has children can never become a child itself — and
    // the row it hovers must not light up for it either.
    fireEvent.dragStart(rowOf("p1"));
    fireEvent.dragOver(rowOf("t2"));
    expect(rowOf("t2").className).not.toContain("ring-1");
    fireEvent.drop(rowOf("t2"));

    // A child row is not a drop target at all: a parent may not have a parent.
    fireEvent.dragStart(rowOf("t2"));
    fireEvent.drop(document.querySelector('[data-subtask-id="c1"]') as HTMLElement);

    // A drag carrying something other than a task (a project row, an OS file)
    // never lands here.
    beginDrag(new Event("dragstart") as DragEvent, { kind: "project", id: "p1" });
    fireEvent.drop(rowOf("t2"));

    expect(api.updateTask).not.toHaveBeenCalled();
  });
});

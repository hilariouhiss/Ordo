/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import * as boardStore from "../store";
import { BoardView } from "../components/BoardView";
import * as boardHooks from "../hooks";
import * as tasksHooks from "../../tasks/hooks";
import * as tasksStore from "../../tasks/store";
import type { BoardColumn } from "../types";
import type { Task } from "../../tasks/types";

vi.mock("../hooks", () => ({
  loadColumns: vi.fn(),
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
  moveTaskToColumn: vi.fn(),
}));

vi.mock("../../tasks/hooks", () => ({
  completeTask: vi.fn(),
  uncompleteTask: vi.fn(),
  softDeleteTask: vi.fn(),
}));

function column(id: string, overrides: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id,
    projectId: "proj-1",
    name: `列 ${id}`,
    position: "n",
    isDone: false,
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: "proj-1",
    title: `任务 ${id}`,
    note: null,
    priority: "high",
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

/**
 * Seeds the project's scope before render. The board itself never loads tasks —
 * `ProjectListView` guarantees the scope, and a deep link to the board is
 * covered by that same call — so a standalone `BoardView` reads whatever the
 * test put in the scope.
 */
function seedProject(tasks: Task[], projectId = "proj-1") {
  tasksStore.installPage(
    `project:${projectId}`,
    { rows: tasks, children: [], related: [], blocked: [], hasMore: false, cursor: null },
    false,
  );
}

function renderBoard() {
  boardStore.setColumns("proj-1", [
    column("c1", { name: "待办" }),
    column("c2", { name: "已完成", isDone: true, position: "o" }),
  ]);
  render(() => <BoardView projectId="proj-1" />);
}

/** A promise whose settlement the test decides. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  boardStore.resetBoardStore();
  tasksStore.resetTasksStore();
});

afterEach(cleanup);

describe("BoardView", () => {
  const laneIds = (columnId: string): (string | null)[] =>
    [...document.querySelectorAll(`[data-column-id="${columnId}"] [data-task-id]`)].map(
      (el) => el.getAttribute("data-task-id"),
    );

  it("renders columns with their ordered task cards", () => {
    seedProject([
      task("t1", { columnId: "c1", sortOrder: "n" }),
      task("t2", { columnId: "c1", sortOrder: "o" }),
      task("t3", { columnId: "c2", sortOrder: "n", completedAt: "2026-09-09T10:00:00Z" }),
    ]);
    renderBoard();

    // Column headers show names and live card counts.
    expect(screen.getByText("待办")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("任务 t1")).toBeTruthy();
    expect(screen.getByText("任务 t3")).toBeTruthy();
    // Cards follow the lane's own order.
    expect(laneIds("c1")).toEqual(["t1", "t2"]);
    // The done column is flagged.
    expect(screen.getByLabelText("完成列")).toBeTruthy();
  });

  it("shows every project task: no column means the first lane, 完成 the done one", () => {
    seedProject([
      // Created in the 列表 view: it carries no column at all, and used to be
      // invisible here.
      task("list-made", { columnId: null, title: "列表里建的任务" }),
      // 取消完成 left it pointing at the done column; it is open again, so it
      // belongs to the first open lane and not to 已完成.
      task("reopened", { columnId: "c2", title: "取消完成的任务" }),
      // Completed from the list: the stamp alone puts it in 已完成, whatever
      // column it was sitting in.
      task("finished", {
        columnId: "c1",
        title: "列表里完成的任务",
        completedAt: "2026-09-14T09:00:00Z",
      }),
    ]);
    renderBoard();

    expect(laneIds("c1")).toEqual(["list-made", "reopened"]);
    expect(laneIds("c2")).toEqual(["finished"]);
  });

  it("shows only this project's tasks: the fallback lane is not a catch-all", () => {
    // 收件箱任务：没有项目，也没有列。两个「没有」都让 `laneOf` 回落到第一个
    // 开放列，于是它曾经出现在每个项目的看板上。现在看板只读项目范围——它
    // 待在自己的 `all` 范围里，到不了这块看板。
    tasksStore.setAll(
      [
        task("inbox", { projectId: null, columnId: null, title: "收件箱里的任务" }),
        task("other-project", { projectId: "proj-2", columnId: null, title: "别的项目的任务" }),
      ],
      [],
    );
    seedProject([task("mine", { columnId: "c1" })]);
    renderBoard();

    expect(laneIds("c1")).toEqual(["mine"]);
    expect(screen.queryByText("收件箱里的任务")).toBeNull();
    expect(screen.queryByText("别的项目的任务")).toBeNull();
  });

  it("renders only top-level tasks as cards and badges their children", () => {
    seedProject([
      task("t1", { columnId: "c1" }),
      // The child carries the parent's column on purpose: the board must drop
      // it because of `parentTaskId`, not because it happens to have none.
      task("c1-child", { parentTaskId: "t1", columnId: "c1", title: "子任务" }),
    ]);
    renderBoard();

    expect(document.querySelector('[data-task-id="t1"]')).toBeTruthy();
    expect(document.querySelector('[data-task-id="c1-child"]')).toBeNull();
    expect(screen.getByText("0/1 个子任务")).toBeTruthy();
  });

  it("quick-completes a card through the checkbox", () => {
    seedProject([task("t1", { columnId: "c1" })]);
    renderBoard();

    fireEvent.click(screen.getByRole("checkbox", { name: "完成 任务 t1" }));

    expect(tasksHooks.completeTask).toHaveBeenCalledWith("t1");
  });

  it("drops a switched-away project's failure instead of covering the new board", async () => {
    const pending = deferred<boolean>();
    vi.mocked(boardHooks.loadColumns).mockReturnValue(pending.promise);
    // The project the user switches *to* already has its columns cached, so
    // nothing new is requested — the only response still in flight is the old
    // project's.
    boardStore.setColumns("proj-2", [
      column("c9", { projectId: "proj-2", name: "P2 待办" }),
    ]);

    const [projectId, setProjectId] = createSignal("proj-1");
    render(() => <BoardView projectId={projectId()} />);
    expect(boardHooks.loadColumns).toHaveBeenCalledWith("proj-1");

    setProjectId("proj-2");
    expect(screen.getByText("P2 待办")).toBeTruthy();

    pending.resolve(false);
    await waitFor(() => expect(screen.getByText("P2 待办")).toBeTruthy());

    // proj-1's failure is not proj-2's: no error pane over a board that loaded.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the insertion indicator while dragging and persists the drop", async () => {
    seedProject([task("t1", { columnId: "c1" })]);
    renderBoard();

    const card = document.querySelector('[data-task-id="t1"]') as HTMLElement;
    fireEvent.dragStart(card);

    // Hovering another column paints the absolute-positioned indicator.
    const target = document.querySelector('[data-drop-zone="c2"]') as HTMLElement;
    fireEvent.dragOver(target);
    expect(document.querySelector('[data-drop-indicator="c2"]')).toBeTruthy();

    fireEvent.dragLeave(target);
    expect(document.querySelector('[data-drop-indicator="c2"]')).toBeNull();

    // Dropping on the empty done column persists the move without keys.
    fireEvent.drop(target);
    await waitFor(() =>
      expect(boardHooks.moveTaskToColumn).toHaveBeenCalledWith("t1", "c2", null, null),
    );
  });
});

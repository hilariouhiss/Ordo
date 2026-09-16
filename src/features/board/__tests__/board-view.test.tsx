/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
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

function renderBoard() {
  boardStore.setColumns("proj-1", [
    column("c1", { name: "待办" }),
    column("c2", { name: "已完成", isDone: true, position: "o" }),
  ]);
  render(() => <BoardView projectId="proj-1" />);
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
    renderBoard();
    tasksStore.setAll(
      [
        task("t1", { columnId: "c1", sortOrder: "n" }),
        task("t2", { columnId: "c1", sortOrder: "o" }),
        task("t3", { columnId: "c2", sortOrder: "n", completedAt: "2026-09-09T10:00:00Z" }),
      ],
      [],
    );

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
    renderBoard();
    tasksStore.setAll(
      [
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
      ],
      [],
    );

    expect(laneIds("c1")).toEqual(["list-made", "reopened"]);
    expect(laneIds("c2")).toEqual(["finished"]);
  });

  it("shows only this project's tasks: the fallback lane is not a catch-all", () => {
    renderBoard();
    tasksStore.setAll(
      [
        task("mine", { columnId: "c1" }),
        // 收件箱任务：没有项目，也没有列。两个「没有」都让 `laneOf` 回落到第一个
        // 开放列，于是它曾经出现在每个项目的看板上——而列表视图按 projectId
        // 过滤，从来不显示它。
        task("inbox", { projectId: null, columnId: null, title: "收件箱里的任务" }),
        task("other-project", { projectId: "proj-2", columnId: null, title: "别的项目的任务" }),
      ],
      [],
    );

    expect(laneIds("c1")).toEqual(["mine"]);
    expect(screen.queryByText("收件箱里的任务")).toBeNull();
    expect(screen.queryByText("别的项目的任务")).toBeNull();
  });

  it("renders only top-level tasks as cards and badges their children", () => {
    renderBoard();
    tasksStore.setAll(
      [
        task("t1", { columnId: "c1" }),
        // The child carries the parent's column on purpose: the board must drop
        // it because of `parentTaskId`, not because it happens to have none.
        task("c1-child", { parentTaskId: "t1", columnId: "c1", title: "子任务" }),
      ],
      [],
    );

    expect(document.querySelector('[data-task-id="t1"]')).toBeTruthy();
    expect(document.querySelector('[data-task-id="c1-child"]')).toBeNull();
    expect(screen.getByText("0/1 个子任务")).toBeTruthy();
  });

  it("quick-completes a card through the checkbox", () => {
    renderBoard();
    tasksStore.setAll([task("t1", { columnId: "c1" })], []);

    fireEvent.click(screen.getByRole("checkbox", { name: "完成 任务 t1" }));

    expect(tasksHooks.completeTask).toHaveBeenCalledWith("t1");
  });

  it("shows the insertion indicator while dragging and persists the drop", async () => {
    renderBoard();
    tasksStore.setAll([task("t1", { columnId: "c1" })], []);

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

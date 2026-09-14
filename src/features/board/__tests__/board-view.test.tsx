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
  createColumn: vi.fn(),
  updateColumn: vi.fn(),
  deleteColumn: vi.fn(),
  moveTaskToColumn: vi.fn(),
}));

vi.mock("../../tasks/hooks", () => ({
  completeTask: vi.fn(),
  uncompleteTask: vi.fn(),
  softDeleteTask: vi.fn(),
  loadSubtasks: vi.fn(),
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
  it("renders columns with their ordered task cards", () => {
    renderBoard();
    tasksStore.setAll(
      [
        task("t1", { columnId: "c1", sortOrder: "n" }),
        task("t2", { columnId: "c1", sortOrder: "o" }),
        task("t3", { columnId: "c2", sortOrder: "n", completedAt: "2026-09-09T10:00:00Z" }),
        task("inbox", { columnId: null }),
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
    // Tasks without a column do not appear on the board.
    expect(screen.queryByText("任务 inbox")).toBeNull();
    // The done column is flagged.
    expect(screen.getByLabelText("完成列")).toBeTruthy();
  });

  it("quick-completes a card through the checkbox", () => {
    renderBoard();
    tasksStore.setAll([task("t1", { columnId: "c1" })], []);

    fireEvent.click(screen.getByRole("checkbox", { name: "完成 任务 t1" }));

    expect(tasksHooks.completeTask).toHaveBeenCalledWith("t1");
  });

  it("adds a column through the inline form", async () => {
    renderBoard();
    tasksStore.setAll([], []);

    fireEvent.click(screen.getByRole("button", { name: /添加列/ }));
    fireEvent.input(await screen.findByLabelText("新建列"), { target: { value: "评审" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() =>
      expect(boardHooks.createColumn).toHaveBeenCalledWith("proj-1", "评审"),
    );
  });

  it("renames a column through the header menu", async () => {
    renderBoard();
    tasksStore.setAll([], []);

    fireEvent.pointerDown(screen.getByRole("button", { name: "列操作：待办" }));
    const item = await screen.findByRole("menuitem", { name: "重命名" });
    fireEvent.pointerUp(item);
    fireEvent.input(await screen.findByLabelText("重命名列 待办"), {
      target: { value: "进行中" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(boardHooks.updateColumn).toHaveBeenCalledWith("c1", { name: "进行中" }),
    );
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNotifications,
  notifications,
} from "../../../common/stores/notifications";
import * as tasksStore from "../../tasks/store";
import type { Task } from "../../tasks/types";
import * as api from "../api";
import * as hooks from "../hooks";
import * as store from "../store";
import type { BoardColumn } from "../types";

vi.mock("../api", () => ({
  listBoardColumns: vi.fn(),
  addBoardColumn: vi.fn(),
  updateBoardColumn: vi.fn(),
  deleteBoardColumn: vi.fn(),
  moveTask: vi.fn(),
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
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt: null,
    repeatRule: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetBoardStore();
  tasksStore.resetTasksStore();
  clearNotifications();
});

afterEach(() => {
  clearNotifications();
});

describe("loadColumns", () => {
  it("fills the per-project cache", async () => {
    vi.mocked(api.listBoardColumns).mockResolvedValue([column("a"), column("b")]);

    const ok = await hooks.loadColumns("proj-1");

    expect(ok).toBe(true);
    expect(store.hasColumns("proj-1")).toBe(true);
    expect(store.getColumns("proj-1")).toHaveLength(2);
    expect(store.getColumn("b")?.name).toBe("列 b");
  });

  it("notifies and reports failure when loading fails", async () => {
    vi.mocked(api.listBoardColumns).mockRejectedValue({ code: "database", message: "数据库错误" });

    const ok = await hooks.loadColumns("proj-1");

    expect(ok).toBe(false);
    expect(notifications()).toHaveLength(1);
  });
});

describe("createColumn", () => {
  it("shows a trimmed optimistic column, then reconciles", async () => {
    store.setColumns("proj-1", [column("a")]);
    vi.mocked(api.addBoardColumn).mockResolvedValue(
      column("real-1", { name: "评审", position: "o" }),
    );

    const created = await hooks.createColumn("proj-1", "  评审  ");

    expect(created?.id).toBe("real-1");
    expect(api.addBoardColumn).toHaveBeenCalledWith({ projectId: "proj-1", name: "评审" });
    expect(store.getColumns("proj-1").map((c) => c.id)).toEqual(["a", "real-1"]);
  });

  it("removes the optimistic column and notifies on failure", async () => {
    store.setColumns("proj-1", [column("a")]);
    vi.mocked(api.addBoardColumn).mockRejectedValue({ code: "validation", message: "无效" });

    const created = await hooks.createColumn("proj-1", "评审");

    expect(created).toBeNull();
    expect(store.getColumns("proj-1").map((c) => c.id)).toEqual(["a"]);
    expect(notifications()).toHaveLength(1);
  });
});

describe("updateColumn", () => {
  it("patches name and isDone optimistically and reconciles", async () => {
    store.setColumns("proj-1", [column("a", { name: "待办" })]);
    vi.mocked(api.updateBoardColumn).mockResolvedValue(column("a", { name: "完成", isDone: true }));

    const saved = await hooks.updateColumn("a", { name: "完成", isDone: true });

    expect(saved?.isDone).toBe(true);
    expect(store.getColumn("a")?.name).toBe("完成");
    expect(store.getColumn("a")?.isDone).toBe(true);
  });

  it("rolls back when the backend rejects the write", async () => {
    store.setColumns("proj-1", [column("a", { name: "待办" })]);
    vi.mocked(api.updateBoardColumn).mockRejectedValue({ code: "validation", message: "无效" });

    const saved = await hooks.updateColumn("a", { name: "  " });

    expect(saved).toBeNull();
    expect(store.getColumn("a")?.name).toBe("待办");
  });
});

describe("deleteColumn", () => {
  it("removes the column and detaches its tasks; rollback restores both", async () => {
    store.setColumns("proj-1", [column("a"), column("b")]);
    tasksStore.setAll(
      [task("t1", { columnId: "a" }), task("t2", { columnId: "b" })],
      [],
    );
    const pending = new Promise<void>((resolve) => {
      vi.mocked(api.deleteBoardColumn).mockImplementation(() => {
        resolve();
        return Promise.reject(new Error("boom"));
      });
    });

    const removed = hooks.deleteColumn("a");
    await pending;

    // While in flight: column gone, its tasks detached.
    expect(store.getColumns("proj-1").map((c) => c.id)).toEqual(["b"]);
    expect(tasksStore.getTask("t1")?.columnId).toBeNull();
    expect(tasksStore.getTask("t2")?.columnId).toBe("b");

    await removed;

    // Failure rolled everything back.
    expect(store.getColumns("proj-1").map((c) => c.id)).toEqual(["a", "b"]);
    expect(tasksStore.getTask("t1")?.columnId).toBe("a");
    expect(notifications()).toHaveLength(1);

    // And a successful delete sticks.
    vi.mocked(api.deleteBoardColumn).mockResolvedValue();
    const ok = await hooks.deleteColumn("a");
    expect(ok).toBe(true);
    expect(store.getColumns("proj-1").map((c) => c.id)).toEqual(["b"]);
    expect(tasksStore.getTask("t1")?.columnId).toBeNull();
  });
});

describe("moveTaskToColumn", () => {
  it("stamps completed_at entering a done column and clears it leaving", async () => {
    store.setColumns("proj-1", [column("todo"), column("done", { isDone: true, position: "o" })]);
    tasksStore.setAll([task("t1")], []);
    vi.mocked(api.moveTask).mockResolvedValue(
      task("t1", { columnId: "done", completedAt: "2026-09-09T12:00:00Z" }),
    );

    const moved = await hooks.moveTaskToColumn("t1", "done", null, null);

    expect(moved?.completedAt).not.toBeNull();
    expect(tasksStore.getTask("t1")?.columnId).toBe("done");

    vi.mocked(api.moveTask).mockResolvedValue(task("t1", { columnId: "todo" }));
    const back = await hooks.moveTaskToColumn("t1", "todo", null, null);

    expect(back?.completedAt).toBeNull();
    expect(tasksStore.getTask("t1")?.completedAt).toBeNull();
  });

  it("moves within the done column without touching completed_at", async () => {
    store.setColumns("proj-1", [column("done", { isDone: true })]);
    tasksStore.setAll(
      [task("t1", { columnId: "done", completedAt: "2026-09-01T08:00:00Z" })],
      [],
    );
    vi.mocked(api.moveTask).mockResolvedValue(
      task("t1", { columnId: "done", completedAt: "2026-09-01T08:00:00Z", sortOrder: "o" }),
    );

    await hooks.moveTaskToColumn("t1", "done", null, null);

    expect(tasksStore.getTask("t1")?.completedAt).toBe("2026-09-01T08:00:00Z");
  });

  it("derives an optimistic sort key from the drop slot, then reconciles", async () => {
    store.setColumns("proj-1", [column("c1")]);
    tasksStore.setAll(
      [
        task("a", { columnId: "c1", sortOrder: "n" }),
        task("b", { columnId: "c1", sortOrder: "o" }),
        task("mover", { columnId: "c1", sortOrder: "z" }),
      ],
      [],
    );
    let seenOptimisticOrder: string[] | null = null;
    vi.mocked(api.moveTask).mockImplementation(() => {
      seenOptimisticOrder = [tasksStore.getTask("mover")!.sortOrder];
      return Promise.resolve(task("mover", { columnId: "c1", sortOrder: "no" }));
    });

    // Drop between a and b: the optimistic key must sort after "n" and before "o".
    await hooks.moveTaskToColumn("mover", "c1", "n", "o");

    expect(seenOptimisticOrder).not.toBeNull();
    const optimisticKey = seenOptimisticOrder![0];
    expect(optimisticKey > "n").toBe(true);
    expect(optimisticKey < "o").toBe(true);
    expect(tasksStore.getTask("mover")?.sortOrder).toBe("no");
    expect(api.moveTask).toHaveBeenCalledWith("mover", "c1", "n", "o");
  });

  it("rolls the task back to its original column when the move fails", async () => {
    store.setColumns("proj-1", [column("todo"), column("done", { isDone: true })]);
    tasksStore.setAll(
      [task("t1", { columnId: "todo", completedAt: null })],
      [],
    );
    vi.mocked(api.moveTask).mockRejectedValue({ code: "not_found", message: "任务不存在" });

    const moved = await hooks.moveTaskToColumn("t1", "done", null, null);

    expect(moved).toBeNull();
    const rolledBack = tasksStore.getTask("t1")!;
    expect(rolledBack.columnId).toBe("todo");
    expect(rolledBack.completedAt).toBeNull();
    expect(rolledBack.sortOrder).toBe("n");
    expect(notifications()).toHaveLength(1);
  });

  it("reports missing tasks or columns without calling the backend", async () => {
    store.setColumns("proj-1", [column("c1")]);

    expect(await hooks.moveTaskToColumn("ghost", "c1", null, null)).toBeNull();
    expect(await hooks.moveTaskToColumn("t1", "ghost", null, null)).toBeNull();
    expect(api.moveTask).not.toHaveBeenCalled();
    expect(notifications()).toHaveLength(2);
  });
});

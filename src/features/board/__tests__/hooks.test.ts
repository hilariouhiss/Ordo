import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNotifications,
  notifications,
} from "../../../common/stores/notifications";
import { blockedRequest, clearBlockedConfirm } from "../../tasks/blocked-confirm";
import * as tasksStore from "../../tasks/store";
import type { Task } from "../../tasks/types";
import * as api from "../api";
import * as hooks from "../hooks";
import * as store from "../store";
import type { BoardColumn } from "../types";

vi.mock("../api", () => ({
  listBoardColumns: vi.fn(),
  moveTask: vi.fn(),
}));

// A drop re-reads the sidebar counts afterwards (`tasks/hooks`), so the tasks
// api is stubbed too — the real one would reach for Tauri.
vi.mock("../../tasks/api", () => ({
  listUnfinishedCounts: vi.fn().mockResolvedValue([]),
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
    complexity: null,
    parentTaskId: null,
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
  clearBlockedConfirm();
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

describe("moveTaskToColumn", () => {
  it("stamps completed_at entering a done column and clears it leaving", async () => {
    store.setColumns("proj-1", [column("todo"), column("done", { isDone: true, position: "o" })]);
    tasksStore.setAll([task("t1")], []);
    vi.mocked(api.moveTask).mockResolvedValue({
      moved: task("t1", { columnId: "done", completedAt: "2026-09-09T12:00:00Z" }),
      rebalanced: [],
    });

    const moved = await hooks.moveTaskToColumn("t1", "done", null, null);

    expect(moved?.completedAt).not.toBeNull();
    expect(tasksStore.getTask("t1")?.columnId).toBe("done");

    vi.mocked(api.moveTask).mockResolvedValue({
      moved: task("t1", { columnId: "todo" }),
      rebalanced: [],
    });
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
    vi.mocked(api.moveTask).mockResolvedValue({
      moved: task("t1", {
        columnId: "done",
        completedAt: "2026-09-01T08:00:00Z",
        sortOrder: "o",
      }),
      rebalanced: [],
    });

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
      return Promise.resolve({
        moved: task("mover", { columnId: "c1", sortOrder: "no" }),
        rebalanced: [],
      });
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

/*
 * Entering a done column completes the card backend-side (`completed_at` plus
 * the repeat instance), so the drop is a completion entry point like the list
 * row's checkbox and has to pass the same soft-block gate. Confirming replays
 * the whole move: the drop also rewrites column/project/sort key.
 */
describe("moveTaskToColumn 的软阻塞", () => {
  function seedBlockedMove() {
    store.setColumns("proj-1", [column("todo"), column("done", { isDone: true, position: "o" })]);
    tasksStore.setAll([task("t1"), task("prereq")], []);
    tasksStore.setDependencies([{ dependentId: "t1", prerequisiteId: "prereq" }]);
  }

  it("拖进完成列先停请求，确认后完整重放一次移动", async () => {
    seedBlockedMove();
    vi.mocked(api.moveTask).mockResolvedValue({
      moved: task("t1", { columnId: "done", completedAt: "2026-09-09T12:00:00Z" }),
      rebalanced: [],
    });

    const moved = await hooks.moveTaskToColumn("t1", "done", "n", "o");

    expect(moved).toBeNull();
    expect(api.moveTask).not.toHaveBeenCalled();
    const pending = blockedRequest();
    expect(pending).toMatchObject({ id: "t1", title: "任务 t1" });
    expect(pending?.blockers.map((blocker) => blocker.id)).toEqual(["prereq"]);
    // Nothing moved yet: the card is still in its own column.
    expect(tasksStore.getTask("t1")?.columnId).toBeNull();

    await pending?.run();

    expect(api.moveTask).toHaveBeenCalledTimes(1);
    expect(api.moveTask).toHaveBeenCalledWith("t1", "done", "n", "o");
    expect(tasksStore.getTask("t1")?.columnId).toBe("done");
    expect(tasksStore.getTask("t1")?.completedAt).not.toBeNull();

    tasksStore.setDependencies([]);
    clearBlockedConfirm();
  });

  it("拖进非完成列不检查前置，直接移动", async () => {
    seedBlockedMove();
    vi.mocked(api.moveTask).mockResolvedValue({
      moved: task("t1", { columnId: "todo" }),
      rebalanced: [],
    });

    const moved = await hooks.moveTaskToColumn("t1", "todo", null, null);

    expect(api.moveTask).toHaveBeenCalledWith("t1", "todo", null, null);
    expect(moved?.columnId).toBe("todo");
    expect(blockedRequest()).toBeNull();

    tasksStore.setDependencies([]);
  });

  it("已完成的任务在完成列内重排不再确认", async () => {
    store.setColumns("proj-1", [column("done", { isDone: true })]);
    tasksStore.setAll(
      [task("t1", { columnId: "done", completedAt: "2026-09-01T08:00:00Z" }), task("prereq")],
      [],
    );
    tasksStore.setDependencies([{ dependentId: "t1", prerequisiteId: "prereq" }]);
    vi.mocked(api.moveTask).mockResolvedValue({
      moved: task("t1", {
        columnId: "done",
        completedAt: "2026-09-01T08:00:00Z",
        sortOrder: "o",
      }),
      rebalanced: [],
    });

    const moved = await hooks.moveTaskToColumn("t1", "done", null, null);

    expect(moved?.sortOrder).toBe("o");
    expect(blockedRequest()).toBeNull();
    expect(api.moveTask).toHaveBeenCalledTimes(1);

    tasksStore.setDependencies([]);
  });
});

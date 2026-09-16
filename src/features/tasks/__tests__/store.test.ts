import { beforeEach, describe, expect, it } from "vitest";
import type { Tag, Task } from "../types";
import * as store from "../store";

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
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function tag(id: string, name: string): Tag {
  return {
    id,
    name,
    color: null,
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
  };
}

describe("tasks store", () => {
  beforeEach(() => {
    store.resetTasksStore();
  });

  it("starts unloaded and empty", () => {
    expect(store.tasksState.loaded).toBe(false);
    expect(store.tasks()).toEqual([]);
    expect(store.tasksState.tags).toEqual([]);
  });

  it("setAll loads tasks and tags", () => {
    store.setAll([task("a")], [tag("t1", "工作")]);

    expect(store.tasksState.loaded).toBe(true);
    expect(store.getTask("a")?.title).toBe("任务 a");
    expect(store.getTag("t1")?.name).toBe("工作");
  });

  it("upsertTask appends new tasks and replaces existing ones", () => {
    store.setAll([task("a"), task("b")], []);

    store.upsertTask(task("c"));
    store.upsertTask(task("a", { title: "改名" }));

    expect(store.tasks().map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(store.getTask("a")?.title).toBe("改名");
  });

  it("patchTask merges partial fields and ignores unknown ids", () => {
    store.setAll([task("a")], []);

    store.patchTask("a", { priority: "high", dueAt: "2026-09-10T00:00:00Z" });
    store.patchTask("missing", { title: "无效果" });

    expect(store.getTask("a")?.priority).toBe("high");
    expect(store.getTask("a")?.dueAt).toBe("2026-09-10T00:00:00Z");
    expect(store.getTask("a")?.title).toBe("任务 a");
  });

  it("removeTask and insertTaskAt restore a task at its position", () => {
    store.setAll([task("a"), task("b"), task("c")], []);
    const snapshot = task("b");

    store.removeTask("b");
    expect(store.tasks().map((item) => item.id)).toEqual(["a", "c"]);

    store.insertTaskAt(1, snapshot);
    expect(store.tasks().map((item) => item.id)).toEqual(["a", "b", "c"]);

    // Out-of-range indices are clamped, not fatal.
    store.insertTaskAt(99, task("z"));
    expect(store.tasks().map((item) => item.id)).toEqual(["a", "b", "c", "z"]);
  });

  it("applyReorder patches the moved row and the keys the backend rewrote", () => {
    store.setAll([task("t1", { sortOrder: "n" }), task("t2", { sortOrder: "o" })], []);

    store.applyReorder(task("t2", { sortOrder: "a" }), [{ id: "t1", sortOrder: "b" }]);

    expect(store.getTask("t2")?.sortOrder).toBe("a");
    expect(store.getTask("t1")?.sortOrder).toBe("b");
    // `tasks()` sorts by key, so the patched keys alone put t2 first — the
    // scope's id list never has to be re-spliced.
    expect(store.tasks().map((item) => item.id)).toEqual(["t2", "t1"]);
  });

  describe("范围与规范表", () => {
    it("installPage 把行放进 byId，并按 id 去重范围列表", () => {
      store.installPage(
        "view:today",
        {
          rows: [task("t1", { title: "父标题" }), task("t2")],
          children: [task("c1", { parentTaskId: "t1" })],
          related: [{ id: "p9", title: "范围外的父" }],
          blocked: [{ taskId: "t1", count: 2 }],
          hasMore: true,
          cursor: "cur-1",
        },
        false,
      );

      expect(store.tasksState.scopes["view:today"]).toEqual(["t1", "t2"]);
      expect(store.getTask("c1")?.parentTaskId).toBe("t1");
      expect(store.tasksState.childrenByParent.t1).toEqual(["c1"]);
      expect(store.parentTitleOf("c1")).toBe("父标题");
      expect(store.blockedCountOf("t1")).toBe(2);
      expect(store.tasksState.scopeMeta["view:today"]).toMatchObject({
        loaded: true,
        hasMore: true,
        cursor: "cur-1",
        error: null,
      });

      // 追加一页：id 去重，游标推进。
      store.installPage(
        "view:today",
        {
          rows: [task("t2"), task("t3")],
          children: [],
          related: [],
          blocked: [],
          hasMore: false,
          cursor: null,
        },
        true,
      );
      expect(store.tasksState.scopes["view:today"]).toEqual(["t1", "t2", "t3"]);
      expect(store.tasksState.scopeMeta["view:today"]).toMatchObject({
        hasMore: false,
        cursor: null,
      });
    });

    it("同一行只存一份：范围只持 id", () => {
      store.setAll([task("t1", { title: "旧标题" })], []);
      store.installPage(
        "project:p1",
        {
          rows: [task("t1", { title: "新标题" })],
          children: [],
          related: [],
          blocked: [],
          hasMore: false,
          cursor: null,
        },
        false,
      );

      expect(store.getTask("t1")?.title).toBe("新标题");
      expect(store.tasks()[0]?.title).toBe("新标题");
    });

    it("childrenOf 按 sortOrder 排序，且知道父在范围外时的标题", () => {
      store.installPage(
        "view:today",
        {
          rows: [task("c1", { parentTaskId: "p9", sortOrder: "o" })],
          children: [task("c2", { parentTaskId: "p9", sortOrder: "n" })],
          related: [{ id: "p9", title: "范围外的父" }],
          blocked: [],
          hasMore: false,
          cursor: null,
        },
        false,
      );

      expect(store.childrenOf("p9").map((row) => row.id)).toEqual(["c2", "c1"]);
      expect(store.parentTitleOf("c1")).toBe("范围外的父");
      expect(store.parentTitleOf("t-missing")).toBe("（已删除）");
    });

    it("removeTask 把它从每个范围与子行索引里摘掉", () => {
      store.setAll([task("t1"), task("c1", { parentTaskId: "t1" })], []);
      store.installPage(
        "view:today",
        {
          rows: [task("t1")],
          children: [],
          related: [],
          blocked: [],
          hasMore: false,
          cursor: null,
        },
        false,
      );

      store.removeTask("t1");

      expect(store.getTask("t1")).toBeUndefined();
      // Gone from every scope; its child is a row of its own and stays.
      expect(store.tasks().map((row) => row.id)).toEqual(["c1"]);
      expect(store.tasksState.scopes["view:today"]).toEqual([]);

      // Removing the child clears it out of its parent's child index too.
      store.removeTask("c1");
      expect(store.childrenOf("t1")).toEqual([]);
    });

    it("scopeRows 按范围自己的顺序给行；未装载的范围是空的", () => {
      store.installPage(
        "project:p1",
        {
          rows: [task("t2", { sortOrder: "o" }), task("t1", { sortOrder: "n" })],
          children: [],
          related: [],
          blocked: [],
          hasMore: false,
          cursor: null,
        },
        false,
      );

      // 顺序是服务端给的（`ORDER BY sort_order, created_at, id`），不再客户端排一遍。
      expect(store.scopeRows("project:p1").map((row) => row.id)).toEqual(["t2", "t1"]);
      expect(store.scopeRows("project:p9")).toEqual([]);
    });

    it("项目范围的成员关系跟着行自己走（新建/改项目/删除）", () => {
      store.setAll([], []);
      store.installPage(
        "project:p1",
        {
          rows: [task("t1", { projectId: "p1" })],
          children: [],
          related: [],
          blocked: [],
          hasMore: false,
          cursor: null,
        },
        false,
      );

      // 新建一行：projectId 决定它进哪个范围——项目范围的谓词就是这一个字段，
      // 所以不必重写任何视图逻辑。
      store.upsertTask(task("t2", { projectId: "p1", sortOrder: "o" }));
      expect(store.scopeRows("project:p1").map((row) => row.id)).toEqual(["t1", "t2"]);

      // 换个项目：从旧范围出去、进新范围（新范围没装载就不凭空造）。
      store.patchTask("t2", { projectId: "p2" });
      expect(store.scopeRows("project:p1").map((row) => row.id)).toEqual(["t1"]);
      expect(store.scopeRows("project:p2")).toEqual([]);

      store.removeTask("t1");
      expect(store.scopeRows("project:p1")).toEqual([]);
    });

    it("同一个项目的整行 patch 不改范围顺序（改标题不该把行挪到尾）", () => {
      store.installPage(
        "project:p1",
        {
          rows: [task("t1", { projectId: "p1" }), task("t2", { projectId: "p1" })],
          children: [],
          related: [],
          blocked: [],
          hasMore: false,
          cursor: null,
        },
        false,
      );

      // `hooks.updateTask` 用后端返回的整行 reconcile，所以改名那次 patch 也带
      // `projectId`；值没变，顺序就该原样。
      store.patchTask("t1", task("t1", { projectId: "p1", title: "改名" }));

      expect(store.scopeRows("project:p1").map((row) => row.id)).toEqual(["t1", "t2"]);
      expect(store.getTask("t1")?.title).toBe("改名");
    });

    it("装载失败写进 scopeMeta.error，重试成功后清掉", () => {
      store.markScopeLoading("project:p1", true);
      expect(store.scopeMetaOf("project:p1")).toMatchObject({ loading: true, error: null });

      store.markScopeError("project:p1", "数据库连接锁失效");
      expect(store.scopeMetaOf("project:p1")).toMatchObject({
        loading: false,
        loaded: false,
        error: "数据库连接锁失效",
      });

      store.installPage(
        "project:p1",
        { rows: [task("t1")], children: [], related: [], blocked: [], hasMore: false, cursor: null },
        false,
      );
      expect(store.scopeMetaOf("project:p1")).toMatchObject({ loaded: true, error: null });
    });
  });

  it("tag mutators keep the list in sync", () => {
    store.setAll([], [tag("t1", "工作"), tag("t2", "生活")]);

    store.upsertTag(tag("t3", "学习"));
    store.patchTag("t1", { color: "#ff0000" });
    store.removeTag("t2");

    expect(store.tasksState.tags.map((item) => item.id)).toEqual(["t1", "t3"]);
    expect(store.getTag("t1")?.color).toBe("#ff0000");
  });

  describe("层级派生", () => {
    it("childrenOf returns one parent's children in sort order", () => {
      store.setAll(
        [
          task("p1", { sortOrder: "a" }),
          task("c2", { parentTaskId: "p1", sortOrder: "n" }),
          task("c1", { parentTaskId: "p1", sortOrder: "m" }),
          task("other", { sortOrder: "b" }),
          task("c3", { parentTaskId: "other", sortOrder: "a" }),
        ],
        [],
      );

      expect(store.childrenOf("p1").map((item) => item.id)).toEqual(["c1", "c2"]);
      expect(store.childrenOf("other").map((item) => item.id)).toEqual(["c3"]);
      expect(store.childrenOf("nobody")).toEqual([]);
    });

    it("topLevelTasks drops every child but keeps store order", () => {
      store.setAll(
        [
          task("p1", { sortOrder: "a" }),
          task("c1", { parentTaskId: "p1", sortOrder: "m" }),
          task("p2", { sortOrder: "b" }),
        ],
        [],
      );

      expect(store.topLevelTasks().map((item) => item.id)).toEqual(["p1", "p2"]);
    });

    it("hasChildren answers the disclosure question", () => {
      store.setAll([task("p1"), task("c1", { parentTaskId: "p1" })], []);

      expect(store.hasChildren("p1")).toBe(true);
      expect(store.hasChildren("c1")).toBe(false);
    });
  });

  it("resetTasksStore clears everything", () => {
    store.setAll([task("a")], [tag("t1", "工作")]);

    store.resetTasksStore();

    expect(store.tasksState.loaded).toBe(false);
    expect(store.tasks()).toEqual([]);
    expect(store.tasksState.tags).toEqual([]);
  });
});

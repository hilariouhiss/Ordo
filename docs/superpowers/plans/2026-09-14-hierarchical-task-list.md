# 任务列表层级展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有任务列表视图按层级展示子任务——可展开/收起，折叠时父任务行显示 `已完成/总数` 进度。

**Architecture:** 后端新增一个与 `task:list` 对称的全量查询 `subtask:listAll`，并入现有 `loadAll` 的 `Promise.all`，子任务随启动一次性载入 `subtasksByTask` 缓存。前端把「任务 + 展开的子任务」拍平成一段等高的 56px 行序列交给现有 `VirtualList`，因此不触碰虚拟滚动原语。展开状态是组件内的纯本地 signal，展开无需 IPC。

**Tech Stack:** Rust（rusqlite + refinery + Tauri 2 commands）、SolidJS + TypeScript、Vitest（jsdom）、Tailwind v4

**Spec:** `docs/superpowers/specs/2026-09-14-hierarchical-task-list-design.md`

## Global Constraints

- **SolidJS 不是 React**：用 `createSignal` / `createMemo` / `<Show>` / `<For>` / `class`（不是 `className`），没有 `useState` / `useEffect`。
- **Layering**：`commands.rs` 只做薄包装，业务在 `services.rs`，SQL **只**出现在 `repositories.rs`。
- **迁移不可改**：已应用的 `migrations/V*.sql` 永不修改，本计划不需要新迁移。
- **Tauri 命令命名**：`#[tauri::command(rename = "subtask:listAll")]`，Rust 函数名保持合法标识符；参数在 JS 侧是 camelCase。
- **测试命令**：前端 `pnpm test`（Vitest）、`pnpm typecheck`（`tsc --noEmit`，开了 `noUnusedLocals` + `noUnusedParameters`）；Rust 在 `src-tauri/` 下 `cargo test`。
- **文档必须同 commit**：`docs/PRD.md` 管功能范围，`docs/ARCHITECTURE.md` 管结构与数据流，`docs/IMPLEMENTATION_PLAN.md` 管任务分解。本计划把对应的文档改动**折进**每个改行为的任务，不单独留一个收尾任务。
- **reduced motion / 焦点环**：动效只用 `transform` / `opacity` / 独立 `scale`·`translate`；焦点指示统一用 `focus-ring` 工具类，不要再写 `focus-visible:ring-*`。
- **不要用 `class` 覆盖原语里已有的同类工具类**：Tailwind 按 CSS 源码顺序而非 class 属性顺序解决冲突，这类覆盖会静默失效。需要不同外观就给原语加 `variant`。
- **中文文案**：所有面向用户的字符串保持中文，与现有视图一致。
- **行高常量**：`TaskListView.tsx` 的 `ROW_HEIGHT = 56` 必须与 `TaskItemRow` 的 `h-14` 一致，`VirtualList` 是固定行高的。

---

### Task 1: 后端 `subtask:listAll`

**Files:**
- Modify: `src-tauri/src/repositories.rs`（在 `pub mod subtasks { ... }` 内，`list_by_task` 之后，约 456-466 行）
- Modify: `src-tauri/src/services.rs`（`list_subtasks` 之后，约 485-487 行）
- Modify: `src-tauri/src/commands.rs`（`subtask_list` 之后，约 102-105 行）
- Modify: `src-tauri/src/lib.rs`（`commands::subtask_list,` 之后，约 40 行）
- Test: `src-tauri/src/services.rs`（`#[cfg(test)] mod tests`，约 1336 行起）
- Modify: `docs/IMPLEMENTATION_PLAN.md`

**Interfaces:**
- Consumes: 现有的 `SUBTASK_COLUMNS`、`subtask_from_row`、`query_all`（`repositories.rs`）；`make_task` 测试工厂、`create_subtask`、`delete_subtask`、`soft_delete_task`（`services.rs`）
- Produces: `repositories::subtasks::list_all(conn: &Connection) -> Result<Vec<Subtask>, AppError>`；`services::list_all_subtasks(conn: &Connection) -> Result<Vec<Subtask>, AppError>`；Tauri 命令 `subtask:listAll`（无参数，返回 `Vec<Subtask>`）

- [ ] **Step 1: 写失败的测试**

在 `src-tauri/src/services.rs` 的 `mod tests` 内追加（放在已有的 subtask 相关测试附近）：

```rust
    #[test]
    fn list_all_subtasks_spans_tasks_and_skips_deleted_parents() {
        let conn = conn();
        let first = make_task(&conn, "第一个");
        let second = make_task(&conn, "第二个");

        let a = create_subtask(&conn, first.id, NewSubtask { title: "a".into() }).unwrap();
        let b = create_subtask(&conn, first.id, NewSubtask { title: "b".into() }).unwrap();
        let c = create_subtask(&conn, second.id, NewSubtask { title: "c".into() }).unwrap();

        // Soft-deleting a task does not cascade to its subtasks, so the query
        // has to exclude them by looking at the parent.
        let doomed = make_task(&conn, "要删的任务");
        create_subtask(&conn, doomed.id, NewSubtask { title: "陪葬".into() }).unwrap();
        soft_delete_task(&conn, doomed.id).unwrap();

        let all = list_all_subtasks(&conn).unwrap();

        // Assert per parent, not on one global sequence: the query orders by
        // `task_id`, which is a UUID, so the two tasks' blocks can arrive in
        // either order.
        let titles_of = |task_id: Uuid| -> Vec<String> {
            all.iter()
                .filter(|s| s.task_id == task_id)
                .map(|s| s.title.clone())
                .collect()
        };
        assert_eq!(titles_of(first.id), vec!["a", "b"]);
        assert_eq!(titles_of(second.id), vec!["c"]);
        assert_eq!(all.len(), 3, "the deleted task's subtask must not be returned");

        // A soft-deleted subtask disappears too.
        delete_subtask(&conn, b.id).unwrap();
        let after = list_all_subtasks(&conn).unwrap();
        assert_eq!(after.len(), 2);
        assert!(!after.iter().any(|s| s.id == b.id));
        assert!(after.iter().any(|s| s.id == c.id));
        assert!(after.iter().any(|s| s.id == a.id));
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test list_all_subtasks_spans_tasks_and_skips_deleted_parents`
Expected: 编译失败，`cannot find function `list_all_subtasks` in this scope`

- [ ] **Step 3: 实现 repository**

在 `src-tauri/src/repositories.rs` 的 `pub mod subtasks { ... }` 内，紧跟 `list_by_task` 之后插入：

```rust
    /// Every live subtask of every live task, for the eager load behind the
    /// hierarchical task list.
    ///
    /// `IN (SELECT ...)` rather than `JOIN tasks`: `SUBTASK_COLUMNS` has no
    /// table prefix, so a join would make its `id` and `deleted_at` ambiguous
    /// against `tasks` and force a second, prefixed copy of the column list.
    /// `tasks.id` is the primary key, so the subquery is an index lookup.
    ///
    /// The parent check is load-bearing: `soft_delete_task` does not cascade,
    /// so without it a deleted task's subtasks would ride along in every load
    /// forever, growing without bound as tasks are deleted.
    pub fn list_all(conn: &Connection) -> Result<Vec<Subtask>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {SUBTASK_COLUMNS} FROM subtasks \
                 WHERE deleted_at IS NULL \
                   AND task_id IN (SELECT id FROM tasks WHERE deleted_at IS NULL) \
                 ORDER BY task_id, sort_order, created_at, id"
            ),
            &[],
            subtask_from_row,
        )
    }
```

- [ ] **Step 4: 实现 service**

在 `src-tauri/src/services.rs` 的 `list_subtasks` 之后插入：

```rust
/// Every live subtask, across every live task.
///
/// The hierarchical task list has to know which rows have children, and how
/// many are done, before any of them is expanded. `task:list` carries no
/// subtask data and `subtask:list` is per task, so without this the list would
/// need one round trip per row.
pub fn list_all_subtasks(conn: &Connection) -> Result<Vec<Subtask>, AppError> {
    subtasks::list_all(conn)
}
```

- [ ] **Step 5: 实现 command 并注册**

在 `src-tauri/src/commands.rs` 的 `subtask_list` 之后插入：

```rust
#[tauri::command(rename = "subtask:listAll")]
pub fn subtask_list_all(db: State<'_, Db>) -> Result<Vec<Subtask>, AppError> {
    with_conn(&db, |conn| services::list_all_subtasks(conn))
}
```

在 `src-tauri/src/lib.rs` 的 `invoke_handler` 里，`commands::subtask_list,` 之后加一行：

```rust
            commands::subtask_list_all,
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd src-tauri && cargo test`
Expected: 全部通过，包括新增的 `list_all_subtasks_spans_tasks_and_skips_deleted_parents`

- [ ] **Step 7: 同步 IMPLEMENTATION_PLAN**

在 `docs/IMPLEMENTATION_PLAN.md` 的任务功能里程碑下，找到子任务相关的行（`T-06`），在它后面新增一行记录这次的层级展示与批量查询：

```markdown
| T-06b | 任务列表层级展示 | `src-tauri/src/repositories.rs`（`subtasks::list_all`）；`src-tauri/src/services.rs`（`list_all_subtasks`）；`src-tauri/src/commands.rs` + `lib.rs`（`subtask:listAll`）；前端 `TaskListView` 拍平成等高行、`TaskItemRow` 展开位与进度徽章、新增 `SubtaskRow` | 列表默认折叠且父行显示 `已完成/总数`；展开列出子任务；勾选子任务走现有乐观更新；看板与项目进度条口径不变 | T-06 | ✅ |
```

- [ ] **Step 8: Commit**

```bash
cd /c/Mine/Ordo
git add src-tauri/src/repositories.rs src-tauri/src/services.rs src-tauri/src/commands.rs src-tauri/src/lib.rs docs/IMPLEMENTATION_PLAN.md
git commit -m "feat: add subtask:listAll for the hierarchical task list"
```

---

### Task 2: 前端数据层 —— 批量载入子任务

**Files:**
- Modify: `src/common/ipc/commands.ts`
- Modify: `src/features/tasks/api.ts`
- Modify: `src/features/tasks/store.ts`
- Modify: `src/features/tasks/hooks.ts:72-81`（`loadAll`）
- Modify（仅为补齐 mock 工厂，各加一行）：`src/features/tasks/__tests__/hooks.test.ts`、`src/features/tasks/__tests__/reminders.test.ts`、`src/features/tasks/__tests__/task-detail-dialog.test.tsx`、`src/features/tasks/__tests__/task-views.test.tsx`、`src/features/projects/__tests__/project-list-view.test.tsx`、`src/features/search/__tests__/search-view.test.tsx`、`src/app/__tests__/quick-add-window.test.tsx`、`src/app/__tests__/task-viewer.test.tsx`
- Test: `src/features/tasks/__tests__/hooks.test.ts`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: Task 1 的命令名 `subtask:listAll`
- Produces: `api.listSubtasksAll(): Promise<Subtask[]>`；`store.setSubtasksAll(subtasks: Subtask[]): void`；`loadAll()` 现在同时填充任务、标签与全部子任务

> **注意这一步的连锁反应**：这 8 个测试文件都用**穷举式**模块工厂 `vi.mock("../api", () => ({ ... }))` 打桩。工厂没列出的导出在测试里是 `undefined`，`loadAll` 一调就抛 `api.listSubtasksAll is not a function`。所以新增 api 导出必须同步补齐这 8 处，否则大量测试会红。

- [ ] **Step 1: 写失败的测试**

在 `src/features/tasks/__tests__/hooks.test.ts` 的 `describe("loadAll")` 内追加：

```ts
  it("fills the subtask cache for every task, including childless ones", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([task("a"), task("b")]);
    vi.mocked(api.listTags).mockResolvedValue([]);
    vi.mocked(api.listSubtasksAll).mockResolvedValue([
      subtask("s1", "a", "第一步"),
      subtask("s2", "a", "第二步", true),
    ]);

    const ok = await hooks.loadAll();

    expect(ok).toBe(true);
    expect(store.getSubtasks("a").map((item) => item.title)).toEqual(["第一步", "第二步"]);
    // The childless task must still get an entry: `hasSubtasks` is what the
    // detail dialog reads to decide whether to fetch, and a missing key would
    // make it re-request data already in hand.
    expect(store.hasSubtasks("b")).toBe(true);
    expect(store.getSubtasks("b")).toEqual([]);
  });
```

这个文件里可能还没有 `subtask` 工厂，需要在已有 `task()` / `tag()` 工厂旁补一个：

```ts
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
```

（`Subtask` 类型已在该文件顶部 import 列表中。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/features/tasks/__tests__/hooks.test.ts`
Expected: FAIL —— `api.listSubtasksAll is not a function`

- [ ] **Step 3: 补齐 8 个 mock 工厂**

在这 8 个文件的 `vi.mock` 工厂对象里，紧跟 `listSubtasks: vi.fn(),` 之后各加一行：

```ts
  listSubtasksAll: vi.fn().mockResolvedValue([]),
```

`src/features/tasks/__tests__/hooks.test.ts`、`src/features/tasks/__tests__/reminders.test.ts`、`src/features/tasks/__tests__/task-detail-dialog.test.tsx`、`src/features/tasks/__tests__/task-views.test.tsx`、`src/features/projects/__tests__/project-list-view.test.tsx`、`src/features/search/__tests__/search-view.test.tsx`、`src/app/__tests__/quick-add-window.test.tsx`、`src/app/__tests__/task-viewer.test.tsx`。

**必须带 `mockResolvedValue([])` 而不是裸 `vi.fn()`。** 这些文件的 `beforeEach` 用的是 `vi.clearAllMocks()`，它只清调用记录、**不**清实现，所以工厂里给的默认值会一直生效；而裸 `vi.fn()` 返回 `undefined`，`loadAll` 拿到后会走进 `setSubtasksAll(undefined)` 抛错。给一个空数组做默认值，所有不关心子任务的既有用例零改动即可继续通过；关心子任务的用例在用例内用 `mockResolvedValue([...])` 覆盖。

- [ ] **Step 4: 加命令常量与 api 函数**

`src/common/ipc/commands.ts` 的 `subtask` 组里，`list` 之后加：

```ts
    listAll: "subtask:listAll",
```

`src/features/tasks/api.ts` 的 subtask 区块里，`listSubtasks` 之后加：

```ts
/** Every live subtask of every live task; backs the hierarchical list. */
export function listSubtasksAll(): Promise<Subtask[]> {
  return invokeCommand(COMMANDS.subtask.listAll);
}
```

- [ ] **Step 5: 加 store 的批量 setter**

`src/features/tasks/store.ts`，紧跟 `setSubtasks` 之后：

```ts
/**
 * Rebuilds the whole subtask cache from one bulk load.
 *
 * Every live task gets an entry, empty when it has no subtasks. That is what
 * `hasSubtasks` reads, and the task detail dialog uses it to decide whether to
 * fetch again — leaving a childless task without a key would make every such
 * dialog re-request data that is already in hand.
 *
 * Rebuilding rather than merging also drops the keys of tasks deleted since
 * the previous load.
 */
export function setSubtasksAll(subtasks: Subtask[]): void {
  const byTask: Record<string, Subtask[]> = {};
  for (const task of state.tasks) byTask[task.id] = [];
  for (const subtask of subtasks) {
    (byTask[subtask.taskId] ??= []).push(subtask);
  }
  setState("subtasksByTask", byTask);
}
```

- [ ] **Step 6: 并入 loadAll**

把 `src/features/tasks/hooks.ts` 的 `loadAll` 整个替换为：

```ts
export async function loadAll(): Promise<boolean> {
  try {
    const [tasks, tags, subtasks] = await Promise.all([
      api.listTasks(),
      api.listTags(),
      api.listSubtasksAll(),
    ]);
    // `setAll` first: `setSubtasksAll` seeds an entry per live task, so it has
    // to read the list this load just installed.
    store.setAll(tasks, tags);
    store.setSubtasksAll(subtasks);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}
```

- [ ] **Step 7: 跑全量测试，确认既有用例零改动通过**

Run: `pnpm test`
Expected: `Test Files 44 passed`，`Tests` 数为 373 + 新增 1 = 374，全部通过。

Step 3 给的 `mockResolvedValue([])` 默认值就是为了让这一步不需要任何逐个补桩：不关心子任务的用例拿到空数组，`setSubtasksAll` 正常执行，只是缓存里每个任务都是空的。若有失败，说明某个**任务 api 的 mock 工厂被漏掉了**（全仓共 8 处，见 Step 3 清单）——报错形态是 `api.listSubtasksAll is not a function`。

- [ ] **Step 8: 同步 ARCHITECTURE**

在 `docs/ARCHITECTURE.md` 描述前端数据流的小节里补一段（跟随现有 store 说明的位置）：

```markdown
- **子任务随启动全量载入**：`loadAll` 一次取回全部存活子任务（`subtask:listAll`），`setSubtasksAll` 按 `task_id` 分组重建 `subtasksByTask`，并为每个存活任务建好条目（无子任务则为空数组）。列表要在折叠状态下就显示「谁有子任务、做完几项」，逐行懒加载会变成 N 次 IPC。
- `subtask:list`（按任务）保留，作为兜底：新建且带初始子任务的任务，其子任务是后端插入的、id 不在创建响应里，所以 `createTask` 成功后会补拉一次（见 Task 3）；缓存里确实没有条目的任务，详情弹窗也仍会按需拉一次。`hasSubtasks` 就是判断这个的。
- 查询排除父任务已软删除的子任务——`soft_delete_task` 不级联，不排除的话每次载入都会带回一截随时间增长的死数据。
```

- [ ] **Step 9: Commit**

```bash
cd /c/Mine/Ordo
git add src/common/ipc/commands.ts src/features/tasks/api.ts src/features/tasks/store.ts src/features/tasks/hooks.ts src/features/tasks/__tests__ src/features/projects/__tests__/project-list-view.test.tsx src/features/search/__tests__/search-view.test.tsx src/app/__tests__ docs/ARCHITECTURE.md
git commit -m "feat: load every subtask up front so list rows can show progress"
```

---

### Task 3: 新建任务时补拉初始子任务

**Files:**
- Modify: `src/features/tasks/hooks.ts`（`createTask` 的成功分支，约 124-131 行）
- Test: `src/features/tasks/__tests__/hooks.test.ts`

**Interfaces:**
- Consumes: Task 2 留下的 `loadSubtasks(taskId: string): Promise<boolean>`
- Produces: 无新接口 —— `createTask` 签名不变

**为什么单独一个任务：** `createTask` 支持带初始子任务（`input.subtaskTitles`），但那批行是后端插入的，响应里只有 `Task`，拿不到子任务的 id。批量载入之后，新建任务在缓存里没有条目，于是它既不会显示三角也不显示进度——直到用户点开详情。这与「列表能看出子任务进度」的目标直接冲突，而一个审阅者完全可能认可批量载入却否掉这次额外 IPC，所以单独成任务。

- [ ] **Step 1: 写失败的测试**

在 `src/features/tasks/__tests__/hooks.test.ts` 里追加（与已有的 createTask 用例放在同一个 describe）：

```ts
  it("refetches subtasks after creating a task that carried initial ones", async () => {
    vi.mocked(api.createTask).mockResolvedValue(task("created"));
    vi.mocked(api.listSubtasks).mockResolvedValue([subtask("s1", "created", "第一步")]);

    await hooks.createTask({ title: "新任务", subtaskTitles: ["第一步"] });

    expect(api.listSubtasks).toHaveBeenCalledWith("created");
    await waitFor(() => expect(store.getSubtasks("created")).toHaveLength(1));
  });

  it("does not fetch subtasks when the new task carried none", async () => {
    vi.mocked(api.createTask).mockResolvedValue(task("created"));

    await hooks.createTask({ title: "新任务" });

    expect(api.listSubtasks).not.toHaveBeenCalled();
  });
```

该文件目前什么都不渲染，也没有从 `@solidjs/testing-library` 引入任何东西（`waitFor` 在全文件出现 0 次），所以要在顶部补一行 import：

```ts
import { waitFor } from "@solidjs/testing-library";
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/features/tasks/__tests__/hooks.test.ts`
Expected: FAIL —— 第一条断言 `listSubtasks` 未被调用

- [ ] **Step 3: 实现**

在 `src/features/tasks/hooks.ts` 的 `createTask` 成功分支里，`store.upsertTask(created);` 之后、`return created;` 之前插入：

```ts
      // The initial subtasks were inserted server-side, so their ids are not
      // in the response. Pull them now, or the new row would sit without a
      // disclosure control or a progress badge until someone opens its
      // detail. Fire-and-forget: the task itself must appear immediately.
      if (input.subtaskTitles?.length) void loadSubtasks(created.id);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/features/tasks/__tests__/hooks.test.ts`
Expected: PASS（含两条新用例）

- [ ] **Step 5: Commit**

```bash
cd /c/Mine/Ordo
git add src/features/tasks/hooks.ts src/features/tasks/__tests__/hooks.test.ts
git commit -m "fix: pull a new task's initial subtasks so its row shows progress"
```

---

### Task 4: `TaskItemRow` 的展开位与进度徽章

**Files:**
- Modify: `src/features/tasks/components/TaskItemRow.tsx`
- Modify: `src/features/tasks/components/TaskListView.tsx`（**仅**把四个新 props 传进去，见 Step 3 末尾）
- Test: `src/features/tasks/__tests__/task-views.test.tsx`（复用该文件已有的 `task()` 工厂、api mock 与 store 复位）

**Interfaces:**
- Consumes: `getSubtasks` from `../store`（只为 TaskListView 的过渡值）
- Produces: `TaskItemRowProps` 新增四个字段 —— `subtaskCount: number`、`subtaskDone: number`、`expanded: boolean`、`onToggleExpand: (task: Task) => void`。Task 6 依赖这些确切名字。

**为什么必须同时改 TaskListView：** 这四个字段是必填的，而 `TaskItemRow` 唯一的调用点就在 `TaskListView` 里。只加字段不改调用点，本任务的 commit 直接 typecheck 不过，本任务自己的 `InboxView` 用例也渲染不出徽章。Step 3 末尾给出一个最小过渡：传真实计数、`expanded={false}`、`onToggleExpand` 空实现——于是本任务是绿色且可独立验收的，展开行为仍完整留给 Task 6。

- [ ] **Step 1: 写失败的测试**

在 `src/features/tasks/__tests__/task-views.test.tsx` 内追加一个新的 describe（放在文件末尾）：

```tsx
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
```

该文件还没有 `subtask` 工厂，现在补一个（`Subtask` 类型需加进该文件的 type import）：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/features/tasks/__tests__/task-views.test.tsx`
Expected: FAIL —— 找不到 `展开 任务 t1 的子任务` 按钮

- [ ] **Step 3: 实现**

`src/features/tasks/components/TaskItemRow.tsx`：

在 lucide-solid 的 import 里加 `ChevronRight`：

```tsx
import { ChevronRight, MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-solid";
```

在 `TaskItemRowProps` 里加四个字段：

```tsx
  /** How many subtasks the task has; 0 hides the disclosure control. */
  subtaskCount: number;
  /** How many of them are done, for the collapsed progress badge. */
  subtaskDone: number;
  expanded: boolean;
  onToggleExpand: (task: Task) => void;
```

在行内**第一个子元素**（复选框之前）插入展开位。无子任务时渲染等宽占位块，两级行的复选框才会对齐成一列：

```tsx
      <Show
        when={props.subtaskCount > 0}
        fallback={<span class="size-5 shrink-0" aria-hidden="true" />}
      >
        <button
          type="button"
          class="flex size-5 shrink-0 items-center justify-center rounded text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-foreground focus-ring"
          aria-expanded={props.expanded}
          aria-label={`${props.expanded ? "收起" : "展开"} ${props.task.title} 的子任务`}
          onClick={() => props.onToggleExpand(props.task)}
        >
          <ChevronRight
            size={14}
            aria-hidden="true"
            class="transition-transform duration-150 ease-out"
            classList={{ "rotate-90": props.expanded }}
          />
        </button>
      </Show>
```

在行尾徽章簇的**最前面**（`<Show when={props.task.repeatRule}>` 之前）插入进度徽章：

```tsx
      <Show when={props.subtaskCount > 0}>
        <Badge>
          {props.subtaskDone}/{props.subtaskCount}
        </Badge>
      </Show>
```

`src/features/tasks/components/TaskListView.tsx`：四个字段是必填的，所以这里必须同步更新唯一的调用点，否则本任务 typecheck 不过。**只传值，不加任何展开逻辑**——拍平成行序列与展开状态是 Task 6 的事：

在 store 的 import 里补 `getSubtasks`：

```tsx
import { getSubtasks, tasksState } from "../store";
```

把现有的 `<TaskItemRow ... />` 调用替换为：

```tsx
              <TaskItemRow
                task={task}
                now={now()}
                subtaskCount={getSubtasks(task.id).length}
                subtaskDone={getSubtasks(task.id).filter((child) => child.done).length}
                expanded={false}
                onToggleExpand={() => {}}
                onToggleComplete={toggleComplete}
                onOpenDetail={openDetail}
                onEdit={openEdit}
                onDelete={removeTask}
              />
```

（Task 6 会把这几行换成由行数据携带的计数与真实展开状态。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm typecheck && pnpm test src/features/tasks/__tests__/task-views.test.tsx`
Expected: typecheck 无输出；测试 PASS（含新用例）

- [ ] **Step 5: Commit**

```bash
cd /c/Mine/Ordo
git add src/features/tasks/components/TaskItemRow.tsx src/features/tasks/components/TaskListView.tsx src/features/tasks/__tests__/task-views.test.tsx
git commit -m "feat: give task rows a disclosure control and subtask progress"
```

---

### Task 5: `SubtaskRow`

**Files:**
- Create: `src/features/tasks/components/SubtaskRow.tsx`
- Test: `src/features/tasks/__tests__/task-views.test.tsx`

**Interfaces:**
- Consumes: `Checkbox` from `../../../common/components`；`Subtask`、`Task` from `../types`
- Produces: `SubtaskRow`（默认导出无，具名导出）与它的 props —— `subtask: Subtask`、`parent: Task`、`onToggleDone: (parent: Task, subtask: Subtask, done: boolean) => void`、`onOpenDetail: (parent: Task) => void`。Task 6 依赖这些确切名字。

- [ ] **Step 1: 写失败的测试**

本步骤只测「子行能独立渲染」这一层：给定 subtask / parent 与两个回调，它能正确渲染、勾选、点击。**通过列表展开触达子行的集成测试属于 Task 6**——本任务结束时列表还没有展开逻辑，所以那类用例现在写不出来。

```tsx
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
});
```

在该文件顶部加 `import { SubtaskRow } from "../components/SubtaskRow";`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/features/tasks/__tests__/task-views.test.tsx`
Expected: FAIL —— 找不到模块 `../components/SubtaskRow`

- [ ] **Step 3: 实现**

创建 `src/features/tasks/components/SubtaskRow.tsx`：

```tsx
import { Checkbox } from "../../../common/components";
import type { Subtask, Task } from "../types";

export interface SubtaskRowProps {
  subtask: Subtask;
  /** The parent task. Clicking the title opens *its* detail — a subtask has
   * no detail view of its own; it is edited from inside the parent's. */
  parent: Task;
  onToggleDone: (parent: Task, subtask: Subtask, done: boolean) => void;
  onOpenDetail: (parent: Task) => void;
}

/**
 * One subtask under an expanded task row.
 *
 * Height and horizontal rhythm match `TaskItemRow` exactly — the virtualizer
 * is fixed-height, and the two rows' checkboxes only line up as a column if
 * both reserve the same 20px disclosure slot on the left. The guide line in
 * that slot is what makes the nesting readable once the checkboxes align.
 */
export function SubtaskRow(props: SubtaskRowProps) {
  return (
    <div
      class="group flex h-14 items-center gap-2.5 border-b border-border pl-3.5 pr-2 transition-colors duration-100 hover:bg-surface-hover/60"
      data-subtask-id={props.subtask.id}
    >
      <span aria-hidden="true" class="flex size-5 shrink-0 justify-center">
        <span class="w-px bg-border-strong" />
      </span>

      <Checkbox.Root
        checked={props.subtask.done}
        onChange={(done) => props.onToggleDone(props.parent, props.subtask, done)}
      >
        <Checkbox.Input
          aria-label={
            props.subtask.done
              ? `恢复子任务 ${props.subtask.title}`
              : `完成子任务 ${props.subtask.title}`
          }
        />
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox.Root>

      <button
        type="button"
        class="min-w-0 flex-1 truncate rounded-sm text-left text-sm text-muted-foreground transition-colors hover:text-primary focus-ring"
        title={props.subtask.title}
        onClick={() => props.onOpenDetail(props.parent)}
      >
        <span classList={{ "text-subtle-foreground line-through": props.subtask.done }}>
          {props.subtask.title}
        </span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/features/tasks/__tests__/task-views.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /c/Mine/Ordo
git add src/features/tasks/components/SubtaskRow.tsx src/features/tasks/__tests__/task-views.test.tsx
git commit -m "feat: add the SubtaskRow for nested list rows"
```

---

### Task 6: `TaskListView` 拍平成等高行 + 展开状态

**Files:**
- Modify: `src/features/tasks/components/TaskListView.tsx`
- Test: `src/features/tasks/__tests__/task-views.test.tsx`
- Modify: `docs/PRD.md`、`docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: Task 4 的 `TaskItemRowProps` 新字段；Task 5 的 `SubtaskRow` 与 `SubtaskRowProps`；`completeSubtask` from `../hooks`；`getSubtasks` from `../store`；`Subtask` from `../types`
- Produces: 无对外新接口 —— `TaskListViewProps` 不变，5 个调用点零改动

- [ ] **Step 1: 写失败的测试**

在 `src/features/tasks/__tests__/task-views.test.tsx` 追加：

```tsx
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
  });

  it("expands to list children in sort order and collapses again", async () => {
    seedWithSubtasks();
    render(() => <InboxView />);

    fireEvent.click(await screen.findByRole("button", { name: "展开 任务 t1 的子任务" }));
    expect(screen.getByText("收集意见")).toBeTruthy();
    expect(screen.getByText("定稿")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起 任务 t1 的子任务" }));
    expect(screen.queryByText("收集意见")).toBeNull();
  });

  it("completes a subtask optimistically and moves the parent's badge", async () => {
    seedWithSubtasks();
    vi.mocked(api.completeSubtask).mockResolvedValue(
      subtask("s2", "t1", "定稿", true),
    );
    render(() => <InboxView />);

    fireEvent.click(await screen.findByRole("button", { name: "展开 任务 t1 的子任务" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "完成子任务 定稿" }));

    await waitFor(() => expect(api.completeSubtask).toHaveBeenCalledWith("s2", true));
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
    store.setAll([task("t1", { priority: "high" })], []);
    store.setSubtasks("t1", [
      subtask("s1", "t1", "收集意见"),
      subtask("s2", "t1", "定稿"),
    ]);
    render(() => <InboxView />);

    await selectFromCombobox(/优先级筛选/, "仅高");
    fireEvent.click(await screen.findByRole("button", { name: "展开 任务 t1 的子任务" }));

    // Subtasks carry no priority, so they are never filtered: a badge reading
    // 0/2 above a single visible row would be lying.
    expect(screen.getByText("收集意见")).toBeTruthy();
    expect(screen.getByText("定稿")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/features/tasks/__tests__/task-views.test.tsx`
Expected: FAIL —— `Unable to find an element with the text: 收集意见`（展开按钮还没有行为）

- [ ] **Step 3: 实现**

`src/features/tasks/components/TaskListView.tsx`，import 区补三处：

```tsx
import { completeSubtask, completeTask, softDeleteTask, uncompleteTask } from "../hooks";
import { getSubtasks, tasksState } from "../store";
import type { Priority, Subtask, Task } from "../types";
import { SubtaskRow } from "./SubtaskRow";
```

在 `ROW_HEIGHT` 常量下方加行类型：

```tsx
/**
 * One rendered line. The tree is flattened into this, so every row keeps the
 * same 56px height the virtualizer assumes — teaching `VirtualList` to measure
 * variable rows would mean rewriting a primitive four other views depend on.
 */
type ListRow =
  | { kind: "task"; task: Task; subtaskCount: number; subtaskDone: number }
  | { kind: "subtask"; task: Task; subtask: Subtask };
```

在 `TaskListView` 组件内，紧跟 `const [now] = createSignal(new Date());` 之后加展开状态与拍平逻辑：

```tsx
  /** Expanded task ids. Local only: the subtasks are already in the store, so
   * expanding never hits the backend. */
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});

  const rows = createMemo<ListRow[]>(() =>
    visible().flatMap((task) => {
      const children = getSubtasks(task.id);
      const done = children.filter((child) => child.done).length;
      const head: ListRow = {
        kind: "task",
        task,
        subtaskCount: children.length,
        subtaskDone: done,
      };
      if (children.length === 0 || !expanded()[task.id]) return [head];
      return [head, ...children.map((subtask) => ({ kind: "subtask", task, subtask }))];
    }),
  );

  const toggleExpand = (task: Task) =>
    setExpanded((current) => ({ ...current, [task.id]: !current[task.id] }));

  const toggleSubtask = (task: Task, subtask: Subtask, done: boolean) => {
    void completeSubtask(task.id, subtask.id, done);
  };
```

把 `VirtualList` 整块替换为：

```tsx
        <VirtualList
          class="min-h-0 flex-1 overflow-y-auto"
          items={rows()}
          itemHeight={ROW_HEIGHT}
          getKey={(row) => (row.kind === "task" ? row.task.id : row.subtask.id)}
        >
          {(row) =>
            row.kind === "task" ? (
              <TaskItemRow
                task={row.task}
                now={now()}
                subtaskCount={row.subtaskCount}
                subtaskDone={row.subtaskDone}
                expanded={Boolean(expanded()[row.task.id])}
                onToggleExpand={toggleExpand}
                onToggleComplete={toggleComplete}
                onOpenDetail={openDetail}
                onEdit={openEdit}
                onDelete={removeTask}
              />
            ) : (
              <SubtaskRow
                subtask={row.subtask}
                parent={row.task}
                onToggleDone={toggleSubtask}
                onOpenDetail={openDetail}
              />
            )
          }
        </VirtualList>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm typecheck && pnpm test src/features/tasks/__tests__/task-views.test.tsx`
Expected: PASS（含 5 个新用例）

- [ ] **Step 5: 跑全量并人工确认虚拟滚动未回归**

Run: `pnpm test`
Expected: 全绿，尤其是 `task-views.test.tsx` 里那条「virtualizes: 10k tasks render only a window of rows」仍然通过——它正是「不碰 `VirtualList`」这个决定的守门测试。

- [ ] **Step 6: 同步 PRD 与 ARCHITECTURE**

`docs/PRD.md` 第 3.1 节任务部分，在子任务条目（约 59-60 行）之后补：

```markdown
- 任务列表按层级展示子任务：父任务行可展开/收起，折叠时显示子任务完成进度（`已完成/总数`）。筛选与排序只作用于顶级任务——子任务没有优先级、标签与截止日期，把某个父任务的子任务筛掉会让进度数字与可见行数不一致。
```

`docs/ARCHITECTURE.md` 的组件清单里，`features/tasks/components/` 一行补上 `SubtaskRow`：

```markdown
│   │   ├── components/           # TaskItemRow / SubtaskRow / TaskListView / 编辑器 / 看板卡
```

同一文件约 179 行的 IPC 命令清单还缺 Task 1 新增的命令（Task 1 的 brief 只覆盖了 IMPLEMENTATION_PLAN 的那一行），一并补上：

```markdown
  subtask:list, subtask:listAll, subtask:create, subtask:update, subtask:complete, subtask:delete, subtask:reorder
```

- [ ] **Step 7: 最终验证**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: typecheck 无输出；`Test Files 44 passed`；`Tests` = 373 + 本轮新增 12 条（Task 2 一条、Task 3 两条、Task 4 两条、Task 5 两条、Task 6 五条）= 385；`✓ built in`

- [ ] **Step 8: Commit**

```bash
cd /c/Mine/Ordo
git add src/features/tasks/components/TaskListView.tsx src/features/tasks/__tests__/task-views.test.tsx docs/PRD.md docs/ARCHITECTURE.md
git commit -m "feat: show subtasks nested under their task in every list view"
```

---

## 完成后的人工确认

自动化测试覆盖不到「看起来对不对」。合上前建议 `pnpm tauri dev` 手动过一遍：

1. 建一个项目，加 3 个任务，其中两个各带 3 条子任务
2. 进项目详情：任务行左边有三角，行尾有 `0/3`
3. 展开一条：子任务行缩进、有竖向导引线、复选框与父行严格对齐成一列
4. 勾掉两条子任务：父行变 `2/3`，无需刷新
5. 切换「按截止日期」排序、打开优先级筛选：展开的任务仍完整列出子任务
6. 切到收件箱 / 今天：同样有层级
7. 切看板：卡片行为**不变**（本次不动看板）
8. 深色模式下看一遍导引线与子任务标题的对比度

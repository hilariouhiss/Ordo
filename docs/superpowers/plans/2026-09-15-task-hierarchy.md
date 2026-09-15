# 任务层级：子任务并入任务树 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把并行的 `subtasks` 模型并入 `tasks` 自引用层级（`parent_task_id`，单层），让子任务成为真正的任务行，并让「拖任务到任务行 = 成为它的子任务」可用。

**Architecture:** 迁移 `V7` 用一条 `ALTER TABLE tasks ADD COLUMN parent_task_id`（**不重建表**：`task_search` 是按 rowid 记录的外部内容表，重建会打散索引并丢掉同步触发器）+ 一次 `INSERT … SELECT` 把 `subtasks` 行搬进 `tasks`，再 `DROP` 三张子任务表；id 全部保留，所以依赖边与提醒标记按 id 原地改写、不会重发。后端把子任务函数族换成任务侧的层级规则（单层校验、同级作用域、级联软删/恢复、项目跟随），退役 7 个 `subtask:*` 命令、新增 `task:reorder`。前端删掉 `subtasksByTask` 缓存与整套子任务协议，改为在同一份 `tasks` 集合上做派生（`childrenOf` / `topLevelTasks` / `hasChildren`），列表按「规则 A」把子任务渲染在父行之下或作为带父名前缀的顶层行，拖放复用已有的 `common/stores/drag.ts`。

**Tech Stack:** Rust（rusqlite 0.39 + refinery 0.9.2 + Tauri 2 commands）、SQLite FTS5（外部内容表 `task_search`）、SolidJS + TypeScript + Tailwind v4、Vitest（jsdom）、TanStack Solid Router

**Spec:** `docs/superpowers/specs/2026-09-15-task-hierarchy-design.md`

## Global Constraints

- **SolidJS 不是 React**：用 `createSignal` / `createMemo` / `createEffect` / `<Show>` / `<For>` / `class`（不是 `className`），没有 `useState` / `useEffect`。
- **Layering**：`commands.rs` 只做薄包装，业务在 `services.rs`，SQL **只**出现在 `repositories.rs`。
- **迁移不可改**：已应用的 `V1..V6` 永不修改；本次新增 `V7__task_hierarchy.sql`，`refinery::embed_migrations!` 在编译期自动收录。后续若需要补索引，再加 `V8`。
- **依赖锁定**：`rusqlite` 固定 **0.39**、`refinery` 固定 **0.9.2**，不得升级（AGENTS.md：refinery 0.9.2 只支持到 rusqlite 0.39）。
- **Tauri 命令命名**：`#[tauri::command(rename = "task:reorder")]`，Rust 函数名保持合法标识符（`task_reorder`）；每个新命令都必须在 `lib.rs` 的 `.invoke_handler(...)` 里注册，否则前端调用静默失败。JS 侧参数键是 camelCase。
- **前端边界**：`features/*/api.ts` 是唯一调用 `invoke` 的地方；组件经 `hooks.ts` 变更 store；`common/ipc/commands.ts` 是命令名的唯一来源。
- **乐观更新数据流**（所有写操作）：`用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果 reconcile → 失败回滚 + 通知`。
- **Tailwind v4 是 CSS-first**：主题在 `src/index.css` 的 `@theme` 里定义，**没有** `tailwind.config.js`，没有 PostCSS 配置；自定义样式用 `@utility`。不要用 `class` 去覆盖原语里已有的同类工具类（同属性冲突按 CSS 源码顺序解决，不按 class 顺序）。
- **动效与焦点**：动效只用 `transform` / `opacity`；焦点指示统一用 `focus-ring`。
- **中文文案**：所有面向用户的字符串保持中文；UI 继续说「子任务」，代码里用 `parentTaskId` / child 表达层级。
- **命令**：包管理用 **pnpm**（不是 npm/yarn）。出口必须全绿且零输出：
  - 前端：`pnpm typecheck`（`tsc --noEmit`）、`pnpm test`（Vitest）
  - Rust（在 `src-tauri/` 下）：`cargo fmt`（跑完 `git diff` 应为空）、`cargo clippy --all-targets -- -D warnings`（零 warning）、`cargo test`
- **文档必须同 commit**：行为/数据模型变更加 `docs/PRD.md`、结构与迁移加 `docs/ARCHITECTURE.md`；`docs/IMPLEMENTATION_PLAN.md` 的里程碑状态在收尾任务回写。
- **提交信息前缀**：`feat:` / `fix:` / `docs:` / `test:` / `refactor:`。

### 提交策略（与「每任务一提交」的偏差，先说清楚）

删掉三张表并换掉模型，**不存在中途全绿的切分**：`Task` 一旦去掉 `Subtask`，`services.rs` 与 `commands.rs` 立刻编译不过；后端切换完成后前端还在调用已退役的 `subtask:*`，应用在运行时是坏的。因此本计划把 17 个任务当作**评审单位**，而只设三个真正的提交点：

| 提交点 | 位置 | 内容 | 状态 |
| --- | --- | --- | --- |
| **A** | Task 8 末尾 | Rust 侧全部切换 + `ARCHITECTURE.md` | `cargo test` / `clippy` / `fmt` 全绿；前端仍指着退役命令，**应用此刻不可用** —— 只作检查点，不要单独发布 |
| **B** | Task 16 末尾 | 前端全部切换 + `PRD.md` | `pnpm typecheck` / `pnpm test` 全绿，应用可用 |
| **C** | Task 17 末尾 | `IMPLEMENTATION_PLAN.md` 里程碑回写 + 死代码清理 | 全量绿 |

每个任务末尾仍要求「验证」步骤（跑哪条命令、期望什么），只是不单独提交。

---

## File Structure

**Create**

- `src-tauri/migrations/V7__task_hierarchy.sql` —— 加自引用列 + 搬 `subtasks` 行 + 改写依赖边与提醒标记 + 删三张子任务表。

**Modify（Rust）**

- `src-tauri/src/models.rs` —— `Task` 加 `parent_task_id`；`NewTask` / `UpdateTask` 支持层级；删 `Subtask` / `NewSubtask` / `UpdateSubtask` / `DependencyKind` / `Dependency.kind`；`Reminder` 去掉两段式字段；`BackupData.subtasks` 改挂 `LegacySubtask`。
- `src-tauri/src/repositories.rs` —— `TASK_COLUMNS` 加列；`tasks::*` 读写层级；删 `SUBTASK_COLUMNS` / `subtask_from_row` / `pub mod subtasks`；`dependencies` 合并成单表、去掉 `kind`；`reminders` 删子任务候选与标记；备份导出/导入改 v4 且父先子后。
- `src-tauri/src/services.rs` —— 删子任务函数族；`create_task` / `update_task` 支持层级与全部层级规则；新增 `reorder_task`；`move_task` 拒绝子任务；`soft_delete_task` / `restore_task` 级联；`spawn_next_instance` 复制子任务行；`scan_reminders` 单轮；`BACKUP_VERSION = 4`。
- `src-tauri/src/commands.rs` —— 删 7 个 `subtask:*`，加 `task:reorder`。
- `src-tauri/src/lib.rs` —— 删 7 条注册，加 `commands::task_reorder`。
- `src-tauri/src/db.rs` —— 表清单去掉三张子任务表、加 `idx_tasks_parent`；改写裸 SQL 打到 `subtasks` 的测试。
- `src-tauri/src/scheduler.rs` —— 通知文案去掉「父任务 › 子任务」两段式；对应测试改写。

**Modify（前端）**

- `src/common/ipc/commands.ts` —— 删 `subtask` 块，`task` 块加 `reorder`。
- `src/features/tasks/types.ts` —— `Task` 加 `parentTaskId`；删子任务类型与 `DependencyKind`。
- `src/features/tasks/api.ts` —— 删 7 个子任务调用，加 `reorderTask`。
- `src/features/tasks/store.ts` —— 删子任务缓存与全部 mutator；新增 `childrenOf` / `topLevelTasks` / `hasChildren`。
- `src/features/tasks/hooks.ts` —— 删子任务 hooks 与 `loadSubtasks`；`createTask` 支持父任务；新增 `reorderTask`；`loadAll` 少一条腿；级联的乐观更新。
- `src/features/tasks/dependencies.ts` —— 索引只剩一套边，去掉所有 `kind` 参数。
- `src/features/tasks/blocked-confirm.ts` —— `BlockedRequest` 去掉 `kind` / `parentId`（保留 `blockers` 形状的变化见 Task 11）。
- `src/features/tasks/reminders.ts` —— 事件即任务本身，去掉两段式分支。
- `src/features/tasks/components/SubtaskRow.tsx` —— 渲染子任务 `Task`；新增「父任务」前缀行（规则 A 的顶层路径）。
- `src/features/tasks/components/SubtaskList.tsx` —— 数据来自 `childrenOf`，排序改用 `reorderTask`，行上的滑杆改为打开任务编辑器。
- `src/features/tasks/components/TaskListView.tsx` —— 单一 `Task` 行 + 规则 A 的行派生 + §8.6 筛选 + §8.7 计数。
- `src/features/tasks/components/TaskItemRow.tsx` —— 新增任务行落点（R7c）与「移出父任务」的可落性判定。
- `src/features/tasks/components/TaskDetailDialog.tsx` —— 子任务区去掉加载门，子任务标题打开自己的详情。
- `src/features/tasks/components/TaskEditorDialog.tsx` —— 新增「父任务」选择器。
- `src/features/tasks/components/TaskDependencies.tsx` —— 前置候选限定顶层任务。
- `src/features/board/components/BoardView.tsx` / `BoardCard.tsx` —— 卡片只取顶层任务、显示子任务进度徽标。
- `src/features/projects/components/ProjectListView.tsx` / `src/features/namespaces/components/NamespaceProjectsView.tsx` —— 传给 `ProjectProgress` 的任务切片先过滤 `parentTaskId === null`。
- `src/features/settings/types.ts` —— 备份计数的 `subtasks` 保持字段名（语义改为子任务行数）。
- `src/app/AppShell.tsx` —— R7b 的落点改写为「移进项目 + 移出父任务」。

**Delete**

- `src/features/tasks/components/SubtaskEditor.tsx` —— 子任务属性面板。子任务就是任务，编辑走 `TaskEditorDialog`，这个面板与它的「四个字段一次写回」协议一起作废。
- `src-tauri/src/repositories.rs` 内的 `SUBTASK_COLUMNS`、`subtask_from_row`、`pub mod subtasks`（含 `insert` / `get` / `list_by_task` / `list_all` / `set_sort_order` / `soft_delete` / `restore`）。
- `src-tauri/src/services.rs` 内的 `list_subtasks` / `list_all_subtasks` / `create_subtask` / `update_subtask` / `complete_subtask` / `delete_subtask` / `reorder_subtask`。
- `src-tauri/src/repositories.rs` 内 `pub mod reminders` 的 `SubtaskReminderCandidate` / `list_subtask_candidates` / `mark_subtask_fired`。
- **不删除** `src-tauri/migrations/` 下的任何文件 —— `V2`/`V4` 里的 `CREATE TABLE subtasks …` 必须留在原处，历史迁移是账本。
- **不删除** `src/features/tasks/components/SubtaskRow.tsx` 与 `SubtaskList.tsx` —— 文件名与 UI 术语保留，只是换成渲染任务行。

---

## M1 数据层

### Task 1: `V7` 迁移与 `db.rs` 表清单

**Files:**
- Create: `src-tauri/migrations/V7__task_hierarchy.sql`
- Modify: `src-tauri/src/db.rs`（表清单断言 `schema_contains_all_tables` 在 53–88 行；`v4_adds_attributes_and_dependency_tables` 在 197 行）
- Test: `src-tauri/src/db.rs`（`mod tests`）

**Interfaces:**
- Consumes: `db::test_conn()`（`db.rs:31`）、`embedded::migrations::runner()`（`db.rs:7-10`）
- Produces:
  - 列 `tasks.parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE`（可空）
  - 索引 `idx_tasks_parent ON tasks(parent_task_id)`
  - 表 `subtasks` / `subtask_dependencies` / `subtask_reminders` **不存在**
  - 搬迁后的子任务行：`id` 不变、`parent_task_id` 指向原 `task_id`、`project_id` 继承父任务、`column_id`/`repeat_rule` 为 `NULL`、`done=1` 变成非空 `completed_at`

- [ ] **Step 1: 写失败的迁移测试**

在 `src-tauri/src/db.rs` 的 `mod tests` 里（`after_each_migration` 之类的既有测试之后）追加两条测试。它们先建一个 **V6 状态的库**并塞入数据，再跑到最新：

```rust
    /// A V6 database with subtasks in it — the state a user's install is in
    /// right before this change ships.
    fn v6_connection_with_subtasks() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        embedded::migrations::runner()
            .set_target(refinery::Target::Version(6))
            .run(&mut conn)
            .unwrap();
        conn.execute_batch(
            "INSERT INTO projects (id, name, status, sort_order, created_at, updated_at) \
                 VALUES ('p1', '网站改版', 'active', 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO tasks (id, project_id, title, priority, sort_order, created_at, updated_at) \
                 VALUES ('t1', 'p1', '写周报', 'none', 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO subtasks (id, task_id, title, done, sort_order, created_at, updated_at) \
                 VALUES ('s1', 't1', '收集数据', 1, 'a', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z'),
                        ('s2', 't1', '汇总',     0, 'b', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
             INSERT INTO subtasks (id, task_id, title, done, sort_order, created_at, updated_at, deleted_at) \
                 VALUES ('s3', 't1', '删掉的', 0, 'c', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-04T00:00:00Z');
             INSERT INTO subtask_dependencies (subtask_id, depends_on, created_at) \
                 VALUES ('s2', 's1', '2026-01-02T00:00:00Z');
             INSERT INTO subtask_reminders (subtask_id, kind, sent_at) \
                 VALUES ('s1', 'due', '2026-01-03T00:00:00Z');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn v7_moves_subtasks_into_the_task_tree() {
        let mut conn = v6_connection_with_subtasks();
        embedded::migrations::runner().run(&mut conn).unwrap();

        // The three subtask tables are gone, the column and its index are here.
        let names: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for gone in ["subtasks", "subtask_dependencies", "subtask_reminders"] {
            assert!(!names.iter().any(|name| name == gone), "{gone} survived V7");
        }
        assert!(names.iter().any(|name| name == "idx_tasks_parent"));

        // Row conservation: soft-deleted children travel too, ids untouched.
        let moved: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE parent_task_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(moved, 3);
        let parent: Option<String> = conn
            .query_row("SELECT parent_task_id FROM tasks WHERE id = 's1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(parent.as_deref(), Some("t1"));

        // A child follows its parent's project; a child never lands on a board.
        let (project, column): (Option<String>, Option<String>) = conn
            .query_row("SELECT project_id, column_id FROM tasks WHERE id = 's1'", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(project.as_deref(), Some("p1"));
        assert_eq!(column, None);

        // done = 1 became a completion instant; done = 0 stayed open.
        let completed: Option<String> = conn
            .query_row("SELECT completed_at FROM tasks WHERE id = 's1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(completed.as_deref(), Some("2026-01-03T00:00:00Z"));
        let open: Option<String> = conn
            .query_row("SELECT completed_at FROM tasks WHERE id = 's2'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(open, None);

        // The edge was remapped rather than dropped, and the marker survived —
        // a re-fire would spam the user with reminders they already got.
        let edge: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_dependencies WHERE task_id = 's2' AND depends_on = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(edge, 1);
        let marker: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_reminders WHERE task_id = 's1' AND kind = 'due'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker, 1);
    }

    #[test]
    fn v7_keeps_migrated_children_searchable() {
        // `task_search` is a contentless FTS5 table over `tasks`, fed by the
        // `tasks_ai` trigger. Migrating by INSERT (not by rebuilding `tasks`)
        // is what keeps that trigger — and this assertion — honest.
        let mut conn = v6_connection_with_subtasks();
        embedded::migrations::runner().run(&mut conn).unwrap();

        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_search WHERE task_search MATCH '收集数据'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1, "a migrated child must be findable through search");
    }
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `cd src-tauri && cargo test db::tests::v7`
Expected: FAIL —— `v7_moves_subtasks_into_the_task_tree` 在第一条断言就挂（`subtasks survived V7`），因为 `V7` 还不存在。

- [ ] **Step 3: 写迁移文件**

创建 `src-tauri/migrations/V7__task_hierarchy.sql`（**逐字照抄，不要"改进"**）：

```sql
-- 任务层级：子任务并入任务树（单层，自引用）。
--
-- 子任务原本是一张独立表（V2 建立、V4 补属性）。它与 tasks 的列几乎重合，
-- 却要各自一套命令、依赖边、提醒标记与前端缓存。这里把 subtasks 行搬进
-- tasks，再删掉三张子任务表 —— 不重建 tasks：task_search 是按 rowid 记录的
-- 外部内容表，重建会打散索引并丢掉同步触发器。
--
-- ADD COLUMN 带 REFERENCES 只在默认值为 NULL 时合法（外键已启用），
-- 因此这里是可空的 TEXT 列；自引用与单层约束由服务层把关（§6.3）。

-- 自引用外键。任务只有软删（没有硬删路径），CASCADE 在这里是装饰性的；
-- 若某版 SQLite 拒绝在 ADD COLUMN 里带 ON DELETE 动作，退化成纯 REFERENCES 即可。
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE;

CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);

-- 子任务 → 带父任务的任务。project_id 跟父任务走（子任务不跨项目），
-- column_id 留空（子任务不上看板），repeat_rule 留空（子任务默认不重复）。
--
-- done 是布尔而 completed_at 是时刻：取 updated_at 作为完成时刻的最近似值
-- （它必然 >= 真正完成的时间点，且就是该行最后一次写入），created_at 兜底。
INSERT INTO tasks (id, project_id, parent_task_id, title, note, priority,
                   column_id, due_at, completed_at, repeat_rule, complexity,
                   sort_order, created_at, updated_at, deleted_at)
SELECT s.id, t.project_id, s.task_id, s.title, s.note, s.priority,
       NULL, s.due_at,
       CASE WHEN s.done = 1 THEN COALESCE(s.updated_at, s.created_at) END,
       NULL, s.complexity,
       s.sort_order, s.created_at, s.updated_at, s.deleted_at
FROM subtasks s
JOIN tasks t ON t.id = s.task_id;

-- 依赖边：子任务边改指任务。两端本来就是同一父任务下的兄弟，语义不变。
INSERT OR IGNORE INTO task_dependencies (task_id, depends_on, created_at)
SELECT subtask_id, depends_on, created_at FROM subtask_dependencies;

-- 提醒去重标记：subtask_id 的值就是搬迁后的任务 id。必须原样搬，
-- 否则「提前 1 小时 / 10 分钟 / 到期」会全部重发一遍。
INSERT OR IGNORE INTO task_reminders (task_id, kind, sent_at)
SELECT subtask_id, kind, sent_at FROM subtask_reminders;

DROP TABLE subtask_dependencies;
DROP TABLE subtask_reminders;
DROP TABLE subtasks;
```

- [ ] **Step 4: 跑测试，确认它通过**

Run: `cd src-tauri && cargo test db::tests::v7`
Expected: PASS（两条都过）。若 `ALTER TABLE … ON DELETE CASCADE` 被 SQLite 拒绝，按注释里的退化路径改成 `REFERENCES tasks(id)` 再跑一次 —— 迁移测试就是这条判断的依据。

- [ ] **Step 5: 同步 `db.rs` 的表清单与裸 SQL 测试**

`schema_contains_all_tables`（`db.rs:53-88`）的期望数组里删掉 `"subtasks"`、`"subtask_dependencies"`、`"subtask_reminders"` 三项，并加一行索引断言：

```rust
            "task_reminders",
            "task_dependencies",
            "idx_tasks_parent",
```

`v4_adds_attributes_and_dependency_tables`（`db.rs:197`）直接对 `subtasks` 跑裸 SQL，随表删除一起改写：它原本要证明「V4 给子任务补的四个属性有默认值」，现在这四个属性归 `tasks` 所有，改为对 `tasks` 断言 `complexity` 的 CHECK 边界，并把末尾对 `subtask_dependencies` / `subtask_reminders` 的插入改成 `task_dependencies` / `task_reminders`：

```rust
    #[test]
    fn v4_adds_attributes_and_dependency_tables() {
        let conn = migrated_connection();

        // A task written without the new column takes the documented default.
        conn.execute(
            "INSERT INTO tasks (id, title, priority, sort_order, created_at, updated_at) \
             VALUES ('t1', '写周报', 'none', 'a', ?1, ?1)",
            params!["2026-09-09T10:00:00Z"],
        )
        .unwrap();
        let complexity: Option<i64> = conn
            .query_row("SELECT complexity FROM tasks WHERE id = 't1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(complexity, None, "complexity starts unestimated");

        // The CHECK is real: 6 is not a valid estimate.
        assert!(
            conn.execute("UPDATE tasks SET complexity = 6 WHERE id = 't1'", [])
                .is_err()
        );

        // The edge table survived V7 as the only edge table, and its
        // self-reference CHECK still rejects a task depending on itself.
        // (Both endpoints exist, so the rejection can only come from the CHECK.)
        conn.execute(
            "INSERT INTO tasks (id, title, priority, sort_order, created_at, updated_at) \
             VALUES ('t2', '第二条', 'none', 'b', ?1, ?1)",
            params!["2026-09-09T10:00:00Z"],
        )
        .unwrap();
        assert!(
            conn.execute(
                "INSERT INTO task_dependencies (task_id, depends_on, created_at) \
                 VALUES ('t1', 't1', '2026-09-09T10:00:00Z')",
                [],
            )
            .is_err(),
            "an edge may not point at itself"
        );
    }
```

- [ ] **Step 6: 跑 `db` 的测试**

Run: `cd src-tauri && cargo test db::`
Expected: PASS。仓库/服务层的测试此刻仍然失败（它们还在用 `subtasks` 表与 `Subtask` 模型）—— 那是 Task 2–4 的工作，见「提交策略」。

---

### Task 2: 模型与仓库：`Task.parent_task_id`、删 `Subtask` 系、依赖单表

**Files:**
- Modify: `src-tauri/src/models.rs`（`Task` 154、`Subtask` 182、`legacy_subtask_priority` 176、`DependencyKind` 254、`Dependency` 264、`BackupData.subtasks` 290、`NewTask` 439、`UpdateTask` 458、`NewSubtask` 500、`UpdateSubtask` 510、`Reminder` 80）
- Modify: `src-tauri/src/repositories.rs`（`TASK_COLUMNS` 22、`task_from_row` 约 130、`tasks::insert` 约 261、`tasks::update` 约 311、`SUBTASK_COLUMNS` 26、`subtask_from_row` 155、`pub mod subtasks` 455–535、`pub mod dependencies` 1625、`pub mod reminders` 1766、`backup::export_all` 1502）
- Test: `src-tauri/src/repositories.rs`（`mod tests`，工厂 `sample_task` 约 1900）

**Interfaces:**
- Consumes: Task 1 的 `tasks.parent_task_id` 列与 `idx_tasks_parent`
- Produces:
  - `models::Task.parent_task_id: Option<Uuid>`（`#[serde(default)]`）
  - `models::NewTask.parent_task_id: Option<Uuid>`；`models::UpdateTask.parent_task_id: Patch<Uuid>`
  - `models::Dependency { dependent_id: Uuid, prerequisite_id: Uuid }`（**无 `kind`**）
  - `models::LegacySubtask`（仅供旧备份反序列化，字段与已退役的 `Subtask` 一致）
  - `models::Reminder { task_id, task_title, kind, due_at }`
  - `repositories::tasks::{insert, update, from_row, list, list_by_parent}`
  - `repositories::dependencies::{insert, remove, creates_cycle, list_all, list_live}`（均无 `kind` 参数）

- [ ] **Step 1: 写失败的仓库测试**

在 `src-tauri/src/repositories.rs` 的 `mod tests` 里追加（`sample_task` 工厂在同文件，照它的字面量补 `parent_task_id: None`）：

```rust
    #[test]
    fn task_parent_id_round_trips_and_clears() {
        let conn = conn();
        let parent = sample_task("a");
        tasks::insert(&conn, &parent).unwrap();

        let mut child = sample_task("b");
        child.parent_task_id = Some(parent.id);
        tasks::insert(&conn, &child).unwrap();
        assert_eq!(
            tasks::get(&conn, child.id).unwrap().unwrap().parent_task_id,
            Some(parent.id)
        );

        child.parent_task_id = None;
        assert!(tasks::update(&conn, &child).unwrap());
        assert_eq!(
            tasks::get(&conn, child.id).unwrap().unwrap().parent_task_id,
            None,
            "clearing the parent promotes the task back to the top level"
        );
    }

    #[test]
    fn list_by_parent_returns_only_that_parent_s_children_in_order() {
        let conn = conn();
        let parent = sample_task("a");
        tasks::insert(&conn, &parent).unwrap();
        let other = sample_task("a");
        tasks::insert(&conn, &other).unwrap();

        for (id, key, parent_id) in [
            ("c1", "b", Some(parent.id)),
            ("c2", "c", Some(parent.id)),
            ("c3", "a", Some(other.id)),
            ("c4", "a", None),
        ] {
            let mut task = sample_task(key);
            task.id = Uuid::new_v4();
            task.title = id.into();
            task.parent_task_id = parent_id;
            tasks::insert(&conn, &task).unwrap();
        }

        let children = tasks::list_by_parent(&conn, parent.id).unwrap();
        let titles: Vec<&str> = children.iter().map(|task| task.title.as_str()).collect();
        assert_eq!(titles, ["c1", "c2"], "sorted by sort_order, one parent only");
    }
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `cd src-tauri && cargo test repositories::tests::task_parent_id`
Expected: FAIL —— 编译错误 `no field parent_task_id on type Task`（以及 `list_by_parent` 不存在）。

- [ ] **Step 3: 改模型**

`src-tauri/src/models.rs`：

```rust
/// A task row (`tasks`). A task with `parent_task_id` set is a subtask; the
/// hierarchy is one level deep, which the service layer enforces.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub title: String,
    pub note: Option<String>,
    pub priority: Priority,
    pub column_id: Option<Uuid>,
    pub due_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub repeat_rule: Option<RepeatRule>,
    /// 1-5, or `None` when the task was never estimated.
    pub complexity: Option<i64>,
    /// Parent task, or `None` for a top-level task.
    ///
    /// `default` is load-bearing: a backup written before V7 has no
    /// `parentTaskId` key at all, and without it the whole document fails to
    /// parse (`subtasks.priority` set the precedent).
    #[serde(default)]
    pub parent_task_id: Option<Uuid>,
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}
```

删掉 `legacy_subtask_priority` 与 `Subtask`，换成只服务旧备份的类型（导入路径在 Task 3 用它；**不要**给它挂 `Serialize` 之外的任何行为）：

```rust
/// A subtask row as it appeared in `subtasks` before V7 — **only** a read
/// shape for old backup documents. Live data has no such thing any more: a
/// subtask is a [`Task`] with a parent (R7c).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacySubtask {
    pub id: Uuid,
    pub task_id: Uuid,
    pub title: String,
    #[serde(default)]
    pub note: Option<String>,
    /// Missing from backups exported before V4.
    #[serde(default)]
    pub priority: Priority,
    #[serde(default)]
    pub due_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub complexity: Option<i64>,
    #[serde(default)]
    pub done: bool,
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}
```

`DependencyKind` 与 `Dependency.kind` 删除：

```rust
/// One dependency edge: `prerequisite_id` must be finished before
/// `dependent_id` can be completed. Both endpoints are task ids — subtasks are
/// tasks now, so the two edge sets of V4 are one set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub dependent_id: Uuid,
    pub prerequisite_id: Uuid,
}
```

`Reminder` 去掉两段式；`NewTask` / `UpdateTask` 加层级；`BackupData.subtasks` 改类型：

```rust
pub struct Reminder {
    pub task_id: Uuid,
    pub task_title: String,
    pub kind: ReminderKind,
    pub due_at: DateTime<Utc>,
}
```

```rust
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    pub note: Option<String>,
    pub priority: Option<Priority>,
    pub project_id: Option<Uuid>,
    pub column_id: Option<Uuid>,
    pub due_at: Option<DateTime<Utc>>,
    /// 1-5 estimate, or `None` for an unestimated task (validated on write).
    pub complexity: Option<i64>,
    #[serde(default)]
    pub tag_ids: Vec<Uuid>,
    #[serde(default)]
    pub subtask_titles: Vec<String>,
    #[serde(default)]
    pub repeat_rule: Option<RepeatRule>,
    /// Parent task for a subtask; `None` (or absent) = top-level task.
    #[serde(default)]
    pub parent_task_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTask {
    pub title: Option<String>,
    #[serde(default)]
    pub note: Patch<String>,
    pub priority: Option<Priority>,
    #[serde(default)]
    pub project_id: Patch<Uuid>,
    #[serde(default)]
    pub column_id: Patch<Uuid>,
    #[serde(default)]
    pub due_at: Patch<DateTime<Utc>>,
    /// Replace/clear (`Patch::Set(None)`) the 1-5 estimate; missing leaves it
    /// unchanged.
    #[serde(default)]
    pub complexity: Patch<i64>,
    #[serde(default)]
    pub completed_at: Patch<DateTime<Utc>>,
    /// Replace the task's tag set; missing leaves the set unchanged.
    pub tag_ids: Option<Vec<Uuid>>,
    /// Replace/clear (`Patch::Set(None)`) the repeat rule; missing leaves it
    /// unchanged.
    #[serde(default)]
    pub repeat_rule: Patch<RepeatRule>,
    /// `Patch::Set(Some(id))` files the task under `id`; `Patch::Set(None)`
    /// promotes it back to the top level.
    #[serde(default)]
    pub parent_task_id: Patch<Uuid>,
}
```

```rust
    /// Subtasks as they were written before V7. Export never fills this in any
    /// more; import maps a non-empty array onto child task rows (R7c).
    #[serde(default)]
    pub subtasks: Vec<LegacySubtask>,
```

同时给 `BackupData::counts()` 改语义：`subtasks` 数的是**子任务行**——

```rust
            subtasks: self.tasks.iter().filter(|task| task.parent_task_id.is_some()).count(),
```

- [ ] **Step 4: 改仓库层**

`TASK_COLUMNS`（`repositories.rs:22`）在 `complexity` 后加列：

```rust
const TASK_COLUMNS: &str = "id, project_id, title, note, priority, column_id, due_at, \
                            completed_at, repeat_rule, complexity, parent_task_id, sort_order, \
                            created_at, updated_at, deleted_at";
```

`task_from_row`（约 130 行）在 `complexity` 之后加 `parent_task_id: row.get("parent_task_id")?,`；`tasks::insert` 与 `tasks::update`（约 261 / 311 行）的列清单与 `params!` 同样加一列（`task.parent_task_id.map(|id| id.to_string())`，注意占位符编号要整体后移）。

删除 `SUBTASK_COLUMNS`、`subtask_from_row` 与整个 `pub mod subtasks`。新增：

```rust
    /// A parent's children in `sort_order`; live rows only.
    pub fn list_by_parent(conn: &Connection, parent_id: Uuid) -> Result<Vec<Task>, AppError> {
        query_all(
            conn,
            &format!(
                "SELECT {TASK_COLUMNS} FROM tasks \
                 WHERE parent_task_id = ?1 AND deleted_at IS NULL \
                 ORDER BY sort_order, created_at, id"
            ),
            params![parent_id.to_string()],
            task_from_row,
        )
    }
```

`pub mod dependencies`：删 `edge_table`、`subtask_edge`，`task_edge` 改名 `edge_from_row` 并去掉 `kind` 字段，`insert` / `remove` / `creates_cycle` 去掉 `kind` 形参、直接把表名写死为 `task_dependencies`、列名 `task_id`。`list_all` 只查一张表：

```rust
    pub fn list_all(conn: &Connection) -> Result<Vec<Dependency>, AppError> {
        query_all(
            conn,
            "SELECT task_id, depends_on FROM task_dependencies ORDER BY task_id, depends_on",
            &[],
            edge_from_row,
        )
    }
```

`pub mod reminders`：删 `SubtaskReminderCandidate` / `list_subtask_candidates` / `mark_subtask_fired`；`list_candidates` 的 SQL 加层级无关（它扫全部任务，正是想要的），但注释里「task」不再需要与「subtask」区分。

- [ ] **Step 5: 跑仓库测试**

Run: `cd src-tauri && cargo test repositories::`
Expected: PASS（`repositories::tests` 全绿）。`cargo check` 仍会列出 `services.rs` / `commands.rs` / `scheduler.rs` 里的每一处 `Subtask` / `DependencyKind` 用法 —— 那就是 Task 3–4 的待办清单。

---

### Task 3: 备份格式 v4 与父先子后导入

**Files:**
- Modify: `src-tauri/src/models.rs`（`BackupData` 290、`BackupCounts` 321）
- Modify: `src-tauri/src/repositories.rs`（`backup::export_all` 1502、`backup::replace_all` 1550）
- Modify: `src-tauri/src/services.rs`（`BACKUP_VERSION` 约 1332）
- Test: `src-tauri/src/repositories.rs`（`mod tests`）

**Interfaces:**
- Consumes: Task 2 的 `models::LegacySubtask`、`Task.parent_task_id`
- Produces:
  - `services::BACKUP_VERSION: u32 = 4`
  - `backup::replace_all(conn, data: &BackupData) -> Result<(), AppError>` —— **父任务先插、子任务后插**，随后插旧档搬来的子任务行
  - `BackupData::counts().subtasks` = `tasks` 里 `parent_task_id.is_some()` 的行数

- [ ] **Step 1: 写失败的导入测试**

在 `src-tauri/src/repositories.rs` 的 `mod tests` 里追加：

```rust
    #[test]
    fn backup_import_inserts_parents_before_children() {
        let conn = conn();
        let parent = sample_task("a");
        let mut child = sample_task("b");
        child.parent_task_id = Some(parent.id);

        // Children first in the document: a naive `for task in &data.tasks`
        // would hit the self-referencing foreign key and fail the whole import.
        let data = BackupData {
            tasks: vec![child.clone(), parent.clone()],
            ..BackupData::default()
        };
        // The parent row must exist for the child's FK, so insert it into a
        // *second* connection's fresh schema through the import path itself.
        let fresh = conn();
        super::backup::replace_all(&fresh, &data).unwrap();

        assert_eq!(tasks::get(&fresh, parent.id).unwrap().unwrap(), parent);
        assert_eq!(
            tasks::get(&fresh, child.id).unwrap().unwrap().parent_task_id,
            Some(parent.id)
        );
    }

    #[test]
    fn backup_import_maps_legacy_subtasks_onto_child_tasks() {
        let conn = conn();
        let parent = sample_task("a");
        let legacy = LegacySubtask {
            id: Uuid::new_v4(),
            task_id: parent.id,
            title: "收集数据".into(),
            note: Some("从三个人那里收".into()),
            priority: Priority::High,
            due_at: None,
            complexity: Some(2),
            done: true,
            sort_order: "a".into(),
            created_at: ts(0),
            updated_at: ts(30),
            deleted_at: None,
        };
        let data = BackupData {
            tasks: vec![parent.clone()],
            subtasks: vec![legacy.clone()],
            ..BackupData::default()
        };

        let fresh = conn();
        super::backup::replace_all(&fresh, &data).unwrap();

        let moved = tasks::get(&fresh, legacy.id).unwrap().unwrap();
        assert_eq!(moved.parent_task_id, Some(parent.id));
        assert_eq!(moved.project_id, parent.project_id, "a child follows its parent");
        assert_eq!(moved.priority, Priority::High);
        assert_eq!(moved.complexity, Some(2));
        assert_eq!(moved.note.as_deref(), Some("从三个人那里收"));
        assert_eq!(
            moved.completed_at,
            Some(legacy.updated_at),
            "done = true lands as the row's last write time"
        );
        assert_eq!(fresh.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
    }
```

`repositories.rs` 的 `mod tests` 顶部已 `use super::*;`，因此 `LegacySubtask` / `Priority` / `BackupData` 需要按现有风格加进 `use crate::models::{…}`。

- [ ] **Step 2: 跑测试，确认它失败**

Run: `cd src-tauri && cargo test repositories::tests::backup_import`
Expected: FAIL —— `no field subtasks on type BackupData`（若 Task 2 尚未改 `BackupData`）或断言失败 `parent_task_id` 为 `None`（导入还没按父先子后）。

- [ ] **Step 3: 改导出与导入**

`backup::export_all`：删掉 `subtasks: all_rows(conn, "subtasks", SUBTASK_COLUMNS, subtask_from_row)?,` 一行，改为写空数组（`BackupData::default()` 的 `#[serde(default)]` 会让它在文档里以 `"subtasks": []` 出现，读旧档的路径不受影响）：

```rust
            tasks: all_rows(conn, "tasks", TASK_COLUMNS, task_from_row)?,
            // Written empty on purpose: children are already in `tasks`. The
            // field survives only so pre-V7 documents still have somewhere to
            // land on import (R7c).
            subtasks: Vec::new(),
```

`backup::replace_all`：DELETE 清单去掉 `"subtask_dependencies"` 与 `"subtasks"`（表已不存在），改成：

```rust
        for table in [
            "task_dependencies",
            "task_tags",
            "comments",
            "time_entries",
            "tasks",
            "board_columns",
            "projects",
            "namespaces",
            "tags",
            "settings",
        ] {
            conn.execute(&format!("DELETE FROM {table}"), [])?;
        }
```

任务插入改成两趟（自引用外键要求父行先存在），并把旧档的 `subtasks` 映射成子任务行：

```rust
        // Parents first: `tasks.parent_task_id` references `tasks`, so a child
        // inserted before its parent fails the foreign key.
        for task in data.tasks.iter().filter(|task| task.parent_task_id.is_none()) {
            tasks::insert(conn, task)?;
        }
        for task in data.tasks.iter().filter(|task| task.parent_task_id.is_some()) {
            tasks::insert(conn, task)?;
        }
        // Pre-V7 documents carried subtasks in their own array; they are child
        // task rows now. Same mapping as the V7 migration, minus the SQL.
        for legacy in &data.subtasks {
            let project_id = data
                .tasks
                .iter()
                .find(|task| task.id == legacy.task_id)
                .and_then(|parent| parent.project_id);
            tasks::insert(
                conn,
                &Task {
                    id: legacy.id,
                    project_id,
                    title: legacy.title.clone(),
                    note: legacy.note.clone(),
                    priority: legacy.priority,
                    column_id: None,
                    due_at: legacy.due_at,
                    completed_at: legacy.done.then_some(legacy.updated_at),
                    repeat_rule: None,
                    complexity: legacy.complexity,
                    parent_task_id: Some(legacy.task_id),
                    sort_order: legacy.sort_order.clone(),
                    created_at: legacy.created_at,
                    updated_at: legacy.updated_at,
                    deleted_at: legacy.deleted_at,
                },
            )?;
        }
```

边插入去掉 `kind`：

```rust
        for edge in &data.dependencies {
            dependencies::insert(conn, edge.dependent_id, edge.prerequisite_id, Utc::now())?;
        }
```

- [ ] **Step 4: 升版本号**

`services.rs` 的常量（约 1332 行）：

```rust
/// Generation of the backup format. Bumped to 4 when subtasks became child
/// tasks (R7c): an older build reading a v4 file would not know what
/// `parentTaskId` means and would show every child at the top level, so
/// `import_backup` refuses anything newer than this value.
pub const BACKUP_VERSION: u32 = 4;
```

- [ ] **Step 5: 跑备份测试**

Run: `cd src-tauri && cargo test backup`
Expected: PASS —— 新增两条通过；`version_one_backups_still_import`、`version_two_backups_import_with_every_project_ungrouped`、`import_accepts_backups_written_before_subtasks_had_attributes` 仍失败（它们在 `services.rs` 里，等 Task 4 修完编译），这是预期的。

---

## M2 后端

### Task 4: 服务层与命令面切换（退役 `subtask:*`，新增 `task:reorder`）

**Files:**
- Modify: `src-tauri/src/services.rs`（子任务函数族 537–686、`create_task_in_tx` 324–396、`update_task` 398–446、`validate_dependency` 719、`spawn_next_instance` 114–182、测试工厂 1679）
- Modify: `src-tauri/src/commands.rs`（子任务命令 101–160）
- Modify: `src-tauri/src/lib.rs`（注册 40–46）
- Modify: `src-tauri/src/scheduler.rs`（`notification_texts` 34–48、其测试 127）
- Test: `src-tauri/src/services.rs`（`mod tests`）

**Interfaces:**
- Consumes: Task 2 的模型与仓库；Task 3 的备份映射
- Produces:
  - `services::create_task(conn, input: NewTask) -> Result<Task, AppError>` —— 认得 `parent_task_id`
  - `services::update_task(conn, id, patch: UpdateTask) -> Result<Task, AppError>` —— 认得 `Patch::Set` 的 `parent_task_id`
  - `services::reorder_task(conn, id, prev: Option<String>, next: Option<String>) -> Result<Vec<Task>, AppError>` —— 返回**同一父任务下的兄弟**（顶层任务返回同一列/无列的兄弟）的权威顺序
  - `services::list_subtasks*` / `create_subtask` / `update_subtask` / `complete_subtask` / `delete_subtask` / `reorder_subtask` **不存在**
  - 命令 `task:reorder` → `commands::task_reorder(db, task_id, prev, next)`

- [ ] **Step 1: 写失败的服务测试**

在 `src-tauri/src/services.rs` 的 `mod tests` 里追加。工厂都用既有的：`make_task`（1643）、`make_new_task`（1664）、`make_project`（2488，返回 `Project` 并顺带建好三列默认看板）、`first_column`（2502）—— 只需新增一个 `make_child`：

```rust
    /// Creates a child of `parent` through the public path.
    fn make_child(conn: &Connection, parent: &Task, title: &str) -> Task {
        create_task(
            conn,
            NewTask {
                parent_task_id: Some(parent.id),
                ..make_new_task(title)
            },
        )
        .unwrap()
    }

    #[test]
    fn creating_a_child_records_its_parent_and_inherits_the_project() {
        let conn = conn();
        let project = make_project(&conn, "网站改版");
        let mut parent = make_new_task("写周报");
        parent.project_id = Some(project.id);
        parent.column_id = Some(first_column(&conn, project.id).id);
        let parent = create_task(&conn, parent).unwrap();

        let child = make_child(&conn, &parent, "收集数据");

        assert_eq!(child.parent_task_id, Some(parent.id));
        assert_eq!(child.project_id, Some(project.id), "a child follows its parent");
        assert_eq!(child.column_id, None, "a child never lands on a board");
        assert_eq!(child.repeat_rule, None);
    }

    #[test]
    fn reorder_task_moves_within_the_siblings() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let first = make_child(&conn, &parent, "一");
        let second = make_child(&conn, &parent, "二");
        let third = make_child(&conn, &parent, "三");

        // Move the third before the first: prev = None, next = first's key.
        let ordered = reorder_task(&conn, third.id, None, Some(first.sort_order.clone())).unwrap();

        let titles: Vec<&str> = ordered.iter().map(|task| task.title.as_str()).collect();
        assert_eq!(titles, ["三", "一", "二"]);
        assert_eq!(
            ordered.iter().find(|task| task.id == second.id).unwrap().sort_order,
            second.sort_order,
            "an untouched sibling keeps its key"
        );
    }

    #[test]
    fn creating_a_child_records_its_parent_and_stays_off_the_board() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");

        let child = make_child(&conn, &parent, "收集数据");

        assert_eq!(child.parent_task_id, Some(parent.id));
        assert_eq!(child.column_id, None, "a child never lands on a board");
        assert_eq!(child.repeat_rule, None);
        assert_eq!(child.project_id, parent.project_id, "a child follows its parent");
    }
```

另外，`NewTask` / `Task` / `UpdateTask` 的结构体字面量在 Rust 里必须写全，所以 `cargo check` 会列出所有要补 `parent_task_id` 的地方：`make_task`（1643）、`make_new_task`（1664）、`make_column_task`（2514）、`make_task_in`（4060）、`spawn_next_instance` 内部的 `NewTask`，以及 `repositories.rs::tests::sample_task` 与 `models.rs` 的序列化测试。先照 `cargo check` 的清单补完，测试才跑得起来。

- [ ] **Step 2: 跑测试，确认它失败**

Run: `cd src-tauri && cargo test services::tests::creating_a_child`
Expected: FAIL —— 先是一串编译错误（`NewTask` 没有 `parent_task_id` 字段的情况已由 Task 2 解决，此后是 `make_new_task` 字面量缺口、`create_subtask` 等函数已删的引用）。把编译错误清干净后，断言失败于 `child.parent_task_id == None`。

- [ ] **Step 3: 删子任务函数族，把规则搬进任务侧**

`services.rs`：删 `list_subtasks`（537）、`list_all_subtasks`（547）、`create_subtask`（551）、`update_subtask`（593）、`complete_subtask`（625）、`delete_subtask`（640）、`reorder_subtask`（651）与「Subtasks」小节标题。

`create_task_in_tx`（324）里，同级集合按「有没有父任务」分岔 —— **这是本次最容易漏的地方**，`sort_order` 的键空间是全表唯一，但「同级」的判定完全不同：

```rust
    // `sort_order` is one global key sequence, but "the siblings" means two
    // different sets: a child appends after its parent's other children, a
    // top-level task after the tasks of its column. The second filter needs
    // `parent_task_id IS NULL` because a child's `column_id` is NULL — without
    // it, a new column-less task would append into the children's key range.
    let all = tasks::list(conn)?;
    let siblings: Vec<(Uuid, String)> = match input.parent_task_id {
        Some(parent_id) => all
            .into_iter()
            .filter(|t| t.parent_task_id == Some(parent_id))
            .map(|t| (t.id, t.sort_order))
            .collect(),
        None => all
            .into_iter()
            .filter(|t| t.column_id == input.column_id && t.parent_task_id.is_none())
            .map(|t| (t.id, t.sort_order))
            .collect(),
    };
```

同一函数里：`Task { … }` 字面量加 `parent_task_id: input.parent_task_id`；`input.subtask_titles` 的循环改为建子任务**行**：

```rust
    // `subtaskTitles` still means "also create these subtasks": each becomes a
    // child task under the one being created.
    let mut last_key: Option<String> = None;
    for raw_title in &input.subtask_titles {
        let key = match &last_key {
            None => sort::first(),
            Some(last) => sort::after(last)?,
        };
        tasks::insert(
            conn,
            &Task {
                id: Uuid::new_v4(),
                project_id: input.project_id,
                title: validated_name(raw_title)?,
                note: None,
                priority: Priority::None,
                column_id: None,
                due_at: None,
                completed_at: None,
                repeat_rule: None,
                complexity: None,
                parent_task_id: Some(task.id),
                sort_order: key.clone(),
                created_at: now,
                updated_at: now,
                deleted_at: None,
            },
        )?;
        last_key = Some(key);
    }
```

`update_task`（398）加层级分支（校验在 Task 6 补；这里先把值写进去）：

```rust
    if let Patch::Set(parent_task_id) = patch.parent_task_id {
        task.parent_task_id = parent_task_id;
    }
```

`spawn_next_instance`（114）：删掉 `subtasks::list_by_task` 之后的复制循环，改成复制子任务**行**。取原来那份 `originals`，换成 `tasks::list_by_parent(conn, task.id)?`，插入时补 `parent_task_id: Some(spawned.id)`、`project_id: spawned.project_id`、`column_id: None`、`completed_at: None`；`due_at` 仍按 `next_due` 推进。重复实例本身也要继承父任务（§9.5）：构造 `NewTask` 时多传一个 `parent_task_id: task.parent_task_id`。

新增：

```rust
/// Moves a task between its siblings: `prev`/`next` are the sort keys of the
/// rows surrounding the target slot (either may be omitted at the list ends).
/// Returns the sibling set in its new authoritative order, because other rows'
/// keys change whenever a rebalance kicks in.
///
/// The sibling scope follows the hierarchy: a child moves among its parent's
/// other children, a top-level task among the tasks of its own column.
pub fn reorder_task(
    conn: &Connection,
    id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Vec<Task>, AppError> {
    let moved = tasks::get(conn, id)?.ok_or_else(|| not_found("任务", id))?;

    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    let siblings: Vec<(Uuid, String)> = match moved.parent_task_id {
        Some(parent_id) => tasks::list_by_parent(&tx, parent_id)?,
        None => tasks::list(&tx)?
            .into_iter()
            .filter(|t| t.column_id == moved.column_id && t.parent_task_id.is_none())
            .collect(),
    }
    .into_iter()
    .filter(|t| t.id != id)
    .map(|t| (t.id, t.sort_order))
    .collect();

    match resolve_slot(&siblings, prev, next)? {
        Slot::Key(key) => {
            if !tasks::set_sort_order(&tx, id, &key, now)? {
                return Err(not_found("任务", id));
            }
        }
        Slot::Rebalance(target) => {
            let mut ordered = siblings;
            ordered.insert(target.min(ordered.len()), (id, moved.sort_order.clone()));
            let fresh = sort::spread(ordered.len());
            for ((sibling_id, _), key) in ordered.iter().zip(fresh) {
                if !tasks::set_sort_order(&tx, *sibling_id, &key, now)? {
                    return Err(not_found("任务", *sibling_id));
                }
            }
        }
    }
    tx.commit()?;

    let mut list = match moved.parent_task_id {
        Some(parent_id) => tasks::list_by_parent(conn, parent_id)?,
        None => tasks::list(conn)?
            .into_iter()
            .filter(|t| t.column_id == moved.column_id && t.parent_task_id.is_none())
            .collect(),
    };
    list.sort_by(|a, b| a.sort_order.cmp(&b.sort_order));
    Ok(list)
}
```

`validate_dependency`（719）：删 `DependencyKind` 的 match，只留「两端都是存活任务 + 不自引用 + 不成环」：

```rust
fn validate_dependency(
    conn: &Connection,
    dependent_id: Uuid,
    prerequisite_id: Uuid,
) -> Result<(), AppError> {
    if dependent_id == prerequisite_id {
        return Err(AppError::Validation("不能依赖自身".into()));
    }
    if tasks::get(conn, dependent_id)?.is_none() {
        return Err(not_found("任务", dependent_id));
    }
    if tasks::get(conn, prerequisite_id)?.is_none() {
        return Err(not_found("任务", prerequisite_id));
    }
    if dependencies::creates_cycle(conn, dependent_id, prerequisite_id)? {
        return Err(AppError::Validation("会形成循环依赖".into()));
    }
    Ok(())
}
```

`add_dependency` / `remove_dependency` / `list_dependencies` 与 `commands.rs` 的 `dependency:*` 三个命令同步去掉 `kind` 形参与字段。

`scan_reminders`（1590）：删第二个 `list_subtask_candidates` 循环，`fired.push(Reminder { task_id, task_title, kind, due_at })`（去掉 `subtask_id` / `subtask_title`）。

- [ ] **Step 4: 切换命令面**

`commands.rs`：删 101–160 行整段 `subtask:*`（7 个），在 `task:*` 块里加：

```rust
/// Moves a task between its siblings (`prev`/`next` are the neighbours' sort
/// keys, either omitted at the ends); returns the sibling set in new order.
#[tauri::command(rename = "task:reorder")]
pub fn task_reorder(
    db: State<'_, Db>,
    task_id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Vec<Task>, AppError> {
    with_conn(&db, |conn| services::reorder_task(conn, task_id, prev, next))
}
```

`lib.rs`：删 `commands::subtask_list` … `commands::subtask_reorder` 七条，在 `commands::task_restore` 附近加 `commands::task_reorder`。

`scheduler.rs` 的 `notification_texts`：

```rust
fn notification_texts(reminder: &Reminder) -> (String, String) {
    let time = reminder.due_at.with_timezone(&Local).format("%H:%M");
    let subject = &reminder.task_title;
    let body = match reminder.kind {
        ReminderKind::Advance1h => format!("「{subject}」将于 1 小时后（{time}）到期"),
        ReminderKind::Advance10m => format!("「{subject}」将于 10 分钟后（{time}）到期"),
        ReminderKind::Due => format!("「{subject}」已到截止时间（{time}）"),
    };
    ("Ordo 任务提醒".to_string(), body)
}
```

- [ ] **Step 5: 修存量测试，跑全量**

存量测试的处置（spec §10 的清单，逐条落到这里）：

- **改写**（断言对象从 `Subtask` 换成子任务 `Task`）：`repeat_instance_copies_subtask_attributes_and_shifts_their_dates`（除既有的属性与日期断言外，再加一条 §9.5 的断言：生成的下一实例 `parent_task_id` 等于原任务的 `parent_task_id` —— 子任务的重复实例仍是同一个父任务的子任务）、`subtask_crud_appends_in_order_and_toggles_done`、`subtask_attributes_roundtrip_and_patch_semantics_hold`、`reorder_subtask_moves_within_the_list`、`reorder_subtask_rejects_bad_input`、`reorder_subtask_rebalances_when_exhausted`、`appending_past_the_length_threshold_rebalances_siblings`、`subtasks_are_scoped_to_their_task_and_ordered`、`subtask_fields_serialize_as_camel_case`、`create_task_with_tags_and_subtasks_is_atomic`、`backup_round_trip_restores_every_table`。名字里带 `subtask` 的可以保留（UI 术语不变），但函数体里的 `make_subtask` 改成 `make_child`、`subtasks::list_by_task` 改成 `tasks::list_by_parent`、`create_subtask`/`update_subtask`/`complete_subtask`/`delete_subtask` 改成 `create_task`/`update_task`/`complete_task`/`soft_delete_task`。
- **删除或改判**：`completing_the_parent_stops_its_subtask_reminders`（§9.3 改了规则，由 Task 7 的新测试取代）、`list_all_subtasks_spans_tasks_and_skips_deleted_parents`（命令退役）、`dependency_edges_are_scoped_and_acyclic` 与 `repeat_instances_do_not_inherit_dependency_edges` 里 `DependencyKind::Subtask` 的段落、`scheduler.rs::subtask_reminders_name_the_parent_and_the_subtask`（改为 `notifications_name_the_task_itself`）。
- **必须继续通过**：`version_one_backups_still_import`、`version_two_backups_import_with_every_project_ungrouped`、`import_accepts_backups_written_before_subtasks_had_attributes`。

Run: `cd src-tauri && cargo test`
Expected: PASS，且 `cargo clippy --all-targets -- -D warnings` 零输出。

- [ ] **Step 6: 不要提交（见「提交策略」）**

本任务结束时 `pnpm typecheck` 仍是绿的（前端还没动），但应用在运行时已经指着不存在的命令。检查点在 Task 8 末尾。

---

### Task 5: 同级作用域与看板拒绝子任务

**Files:**
- Modify: `src-tauri/src/services.rs`（`create_task_in_tx` 的同级过滤已在 Task 4 落地；`move_task` 956–1030）
- Test: `src-tauri/src/services.rs`（`mod tests`）

**Interfaces:**
- Consumes: Task 4 的 `create_task_in_tx` / `move_task`
- Produces: `services::move_task` 对子任务返回 `AppError::Validation`

- [ ] **Step 1: 复用既有工厂，再写三条失败测试**

工厂一律复用：`make_project`（2488，返回 `Project`，顺带建好三列默认看板）、`first_column`（2502）、`done_column`（2506）、`make_column_task`（2514）。本任务不需要新增工厂 —— `make_child` 在 Task 4 已加。三条测试：

```rust
    #[test]
    fn a_new_top_level_task_does_not_join_the_children_s_key_range() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        // Column-less top-level task: without `parent_task_id IS NULL` its
        // append would land inside the children's key range.
        let loose = make_task(&conn, "随手记");

        assert!(
            loose.sort_order > child.sort_order,
            "a top-level task appends after the top-level scale, not the children's"
        );
        let siblings = tasks::list_by_parent(&conn, parent.id).unwrap();
        assert_eq!(siblings.len(), 1, "the new task is not one of the children");
    }

    #[test]
    fn creating_a_child_appends_after_its_siblings_only() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let other = make_task(&conn, "别的任务");
        let first = make_child(&conn, &parent, "一");
        let second = make_child(&conn, &parent, "二");

        assert!(second.sort_order > first.sort_order);
        let siblings = tasks::list_by_parent(&conn, parent.id).unwrap();
        let ids: Vec<Uuid> = siblings.iter().map(|task| task.id).collect();
        assert_eq!(ids, [first.id, second.id], "only this parent's children");
        assert!(!ids.contains(&other.id));
    }

    #[test]
    fn move_task_rejects_a_child() {
        let conn = conn();
        let project = make_project(&conn, "网站改版");
        let column = first_column(&conn, project.id);
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        let error = move_task(&conn, child.id, column.id, None, None).unwrap_err();

        assert_eq!(error.code(), "validation");
    }
```

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `cd src-tauri && cargo test services::tests::a_new_top_level_task services::tests::creating_a_child_appends services::tests::move_task_rejects_a_child`
Expected: `move_task_rejects_a_child` FAIL（子任务被当成卡片移入列），另外两条视 Task 4 的同级过滤是否已落对而通过或失败 —— 这正是它们存在的意义。

- [ ] **Step 3: 加 `move_task` 的拒绝**

在 `move_task` 取到 `moved` 之后立刻判：

```rust
    if moved.parent_task_id.is_some() {
        return Err(AppError::Validation(
            "子任务不能移到看板列：它随父任务归档，不上看板".into(),
        ));
    }
```

同级过滤再加一道保险（迁移来的子任务若因历史数据带上 `column_id`，也不该混进列内顺序）：

```rust
    let siblings: Vec<(Uuid, String)> = tasks::list(&tx)?
        .into_iter()
        .filter(|t| t.column_id == Some(column_id) && t.parent_task_id.is_none() && t.id != task_id)
        .map(|t| (t.id, t.sort_order))
        .collect();
```

- [ ] **Step 4: 跑测试，确认全部通过**

Run: `cd src-tauri && cargo test services::tests`
Expected: PASS。

---

### Task 6: 单层校验、级联软删/恢复与项目跟随

**Files:**
- Modify: `src-tauri/src/services.rs`（`create_task_in_tx` 324、`update_task` 398、`soft_delete_task` 466、`restore_task` 473）
- Modify: `src-tauri/src/repositories.rs`（`tasks::{soft_delete, restore}` 需要按父批量操作；新增 `soft_delete_children` / `restore_children`）
- Test: `src-tauri/src/services.rs`

**Interfaces:**
- Consumes: Task 4 的 `create_task_in_tx` / `update_task`
- Produces:
  - `repositories::tasks::set_children_deleted(conn, parent_id: Uuid, at: DateTime<Utc>, deleted: bool) -> Result<usize, AppError>`
  - `services::create_task` / `update_task` 的层级校验：父任务存活、父任务自身无父、不自引用、有子任务的任务不能变成子任务
  - `update_task` 改父任务时子任务跟随父任务的项目

- [ ] **Step 1: 加一个测试工厂，再写六条失败测试**

`services.rs` 的 `mod tests` 里只补 `no_patch`（`make_child` / `make_project` 在 Task 4/5 已加；「带项目的任务」直接用既有的 `make_task_in(conn, Some(project.id), Vec::new(), title)`）：

```rust
    /// `UpdateTask` with every field "unchanged", so a test can patch one:
    /// `UpdateTask { parent_task_id: Patch::Set(Some(id)), ..no_patch() }`.
    /// `UpdateTask` has no `Default` derive (the `Patch` variants carry the
    /// intent), so the literal has to be spelled out once, here.
    fn no_patch() -> UpdateTask {
        UpdateTask {
            title: None,
            note: Patch::Unchanged,
            priority: None,
            project_id: Patch::Unchanged,
            column_id: Patch::Unchanged,
            due_at: Patch::Unchanged,
            complexity: Patch::Unchanged,
            completed_at: Patch::Unchanged,
            tag_ids: None,
            repeat_rule: Patch::Unchanged,
            parent_task_id: Patch::Unchanged,
        }
    }
```

然后是六条测试：

```rust
    #[test]
    fn a_parent_must_be_a_live_top_level_task() {
        let conn = conn();
        let grandparent = make_task(&conn, "顶层");
        let parent = make_child(&conn, &grandparent, "中间的");
        let loose = make_task(&conn, "孤儿");

        let nested = create_task(
            &conn,
            NewTask { parent_task_id: Some(parent.id), ..make_new_task("第三层") },
        )
        .unwrap_err();
        assert_eq!(nested.code(), "validation", "the hierarchy is one level deep");

        soft_delete_task(&conn, loose.id).unwrap();
        let gone = create_task(
            &conn,
            NewTask { parent_task_id: Some(loose.id), ..make_new_task("挂在已删任务下") },
        )
        .unwrap_err();
        assert_eq!(gone.code(), "not_found");
    }

    #[test]
    fn a_task_cannot_become_its_own_parent() {
        let conn = conn();
        let task = make_task(&conn, "写周报");

        let error = update_task(
            &conn,
            task.id,
            UpdateTask { parent_task_id: Patch::Set(Some(task.id)), ..no_patch() },
        )
        .unwrap_err();

        assert_eq!(error.code(), "validation");
    }

    #[test]
    fn a_task_with_children_cannot_become_a_child() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        make_child(&conn, &parent, "收集数据");
        let target = make_task(&conn, "别的任务");

        let error = update_task(
            &conn,
            parent.id,
            UpdateTask { parent_task_id: Patch::Set(Some(target.id)), ..no_patch() },
        )
        .unwrap_err();

        assert_eq!(error.code(), "validation", "one level means a parent has no parent");
    }

    #[test]
    fn re_parenting_a_task_moves_it_into_the_new_parent_s_project() {
        let conn = conn();
        let (first_project, second_project) = (make_project(&conn, "A"), make_project(&conn, "B"));
        let target = make_task_in(&conn, Some(second_project.id), Vec::new(), "目标任务");
        let mut loose = make_new_task("被拖的");
        loose.project_id = Some(first_project.id);
        let loose = create_task(&conn, loose).unwrap();

        let moved = update_task(
            &conn,
            loose.id,
            UpdateTask { parent_task_id: Patch::Set(Some(target.id)), ..no_patch() },
        )
        .unwrap();

        assert_eq!(moved.parent_task_id, Some(target.id));
        assert_eq!(moved.project_id, Some(second_project.id), "a child follows its parent");
        assert_eq!(moved.column_id, None);
    }

    #[test]
    fn completing_a_parent_leaves_its_children_open() {
        // §9.1: completion does not cascade — a child has its own state and its
        // own place in the views.
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        complete_task(&conn, parent.id).unwrap();

        let reloaded = tasks::get(&conn, child.id).unwrap().unwrap();
        assert_eq!(reloaded.completed_at, None);
        assert_eq!(reloaded.parent_task_id, Some(parent.id));
    }

    #[test]
    fn soft_deleting_and_restoring_a_parent_takes_its_children_along() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let first = make_child(&conn, &parent, "一");
        let second = make_child(&conn, &parent, "二");

        soft_delete_task(&conn, parent.id).unwrap();
        assert!(tasks::get(&conn, first.id).unwrap().is_none());
        assert!(tasks::get(&conn, second.id).unwrap().is_none());

        restore_task(&conn, parent.id).unwrap();
        assert!(tasks::get(&conn, first.id).unwrap().is_some());
        assert!(tasks::get(&conn, second.id).unwrap().is_some());
    }

    #[test]
    fn moving_a_parent_to_another_project_moves_its_children() {
        let conn = conn();
        let (first, second) = (make_project(&conn, "A"), make_project(&conn, "B"));
        let parent = make_task_in(&conn, Some(first.id), Vec::new(), "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        update_task(
            &conn,
            parent.id,
            UpdateTask { project_id: Patch::Set(Some(second.id)), ..no_patch() },
        )
        .unwrap();

        assert_eq!(
            tasks::get(&conn, child.id).unwrap().unwrap().project_id,
            Some(second.id),
            "a child must not be left behind in the old project"
        );
    }
```

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `cd src-tauri && cargo test services::tests::a_parent_must_be services::tests::a_task_cannot_become services::tests::a_task_with_children services::tests::re_parenting services::tests::soft_deleting_and_restoring`
Expected: 六条全部 FAIL（校验、级联、项目跟随都还没写）。

- [ ] **Step 3: 加校验**

`services.rs` 顶层加一个共享校验：

```rust
/// The one-level rule: `parent_id` must be a live task that is itself a
/// top-level task. Returns the parent row so callers can inherit its project.
fn validate_parent(conn: &Connection, parent_id: Uuid) -> Result<Task, AppError> {
    let parent = tasks::get(conn, parent_id)?.ok_or_else(|| not_found("父任务", parent_id))?;
    if parent.parent_task_id.is_some() {
        return Err(AppError::Validation(
            "子任务下不能再挂子任务：层级只有一层".into(),
        ));
    }
    Ok(parent)
}
```

`create_task_in_tx`：在取同级之前，若有父任务就校验并继承范围：

```rust
    let parent = match input.parent_task_id {
        Some(parent_id) => Some(validate_parent(conn, parent_id)?),
        None => None,
    };
    // A child lives inside its parent: same project, never on a board.
    let project_id = parent.as_ref().map(|task| task.project_id).unwrap_or(input.project_id);
    let column_id = if parent.is_some() { None } else { input.column_id };
```

（后续 `Task { … }`、`subtask_titles` 循环与 `siblings` 过滤都用这两个局部变量。）

`update_task`：把层级分支换成带校验的版本，并让子任务跟随项目：

```rust
    if let Patch::Set(parent_task_id) = patch.parent_task_id {
        match parent_task_id {
            Some(parent_id) => {
                if parent_id == id {
                    return Err(AppError::Validation("任务不能以自己为父任务".into()));
                }
                let parent = validate_parent(conn, parent_id)?;
                if !tasks::list_by_parent(conn, id)?.is_empty() {
                    return Err(AppError::Validation(
                        "该任务还有子任务，不能变成别人的子任务".into(),
                    ));
                }
                task.parent_task_id = Some(parent_id);
                task.project_id = parent.project_id;
                task.column_id = None;
            }
            None => task.parent_task_id = None,
        }
    }
    // A parent's project change takes its children with it, or they would be
    // filed in the old project while pointing at a parent in the new one.
    if let Patch::Set(project_id) = patch.project_id {
        task.project_id = project_id;
        for child in tasks::list_by_parent(conn, id)? {
            let mut moved = child;
            moved.project_id = project_id;
            moved.updated_at = Utc::now();
            tasks::update(conn, &moved)?;
        }
    }
```

- [ ] **Step 4: 加级联软删/恢复**

`repositories.rs` 的 `pub mod tasks` 里加：

```rust
    /// Soft-deletes or restores every child of `parent_id`; returns the count.
    pub fn set_children_deleted(
        conn: &Connection,
        parent_id: Uuid,
        at: DateTime<Utc>,
        deleted: bool,
    ) -> Result<usize, AppError> {
        let affected = if deleted {
            conn.execute(
                "UPDATE tasks SET deleted_at = ?1, updated_at = ?1 \
                 WHERE parent_task_id = ?2 AND deleted_at IS NULL",
                params![at, parent_id.to_string()],
            )?
        } else {
            conn.execute(
                "UPDATE tasks SET deleted_at = NULL, updated_at = ?1 \
                 WHERE parent_task_id = ?2 AND deleted_at IS NOT NULL",
                params![at, parent_id.to_string()],
            )?
        };
        Ok(affected)
    }
```

`services.rs` 的软删/恢复改成同一事务：

```rust
pub fn soft_delete_task(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    if !tasks::soft_delete(&tx, id, now)? {
        return Err(not_found("任务", id));
    }
    // Children exist only through their parent (§9.2): leaving them live would
    // produce orphan rows, and restoring the parent could not bring them back.
    tasks::set_children_deleted(&tx, id, now, true)?;
    tx.commit()?;
    Ok(())
}

pub fn restore_task(conn: &Connection, id: Uuid) -> Result<Task, AppError> {
    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    if !tasks::restore(&tx, id, now)? {
        return Err(not_found("任务", id));
    }
    tasks::set_children_deleted(&tx, id, now, false)?;
    tx.commit()?;
    tasks::get(conn, id)?.ok_or_else(|| not_found("任务", id))
}
```

- [ ] **Step 5: 跑测试**

Run: `cd src-tauri && cargo test services::tests`
Expected: PASS。

---

### Task 7: 提醒：单轮候选与 payload 简化

**Files:**
- Modify: `src-tauri/src/services.rs`（`scan_reminders` 1585–1625）
- Modify: `src-tauri/src/repositories.rs`（`pub mod reminders`）
- Modify: `src-tauri/src/scheduler.rs`（`notification_texts`；测试）
- Test: `src-tauri/src/services.rs`、`src-tauri/src/scheduler.rs`

**Interfaces:**
- Consumes: Task 2 的 `Reminder`（无子任务字段）、单张 `task_reminders`
- Produces: `services::scan_reminders(conn, now) -> Result<Vec<Reminder>, AppError>` 只扫一遍 `tasks`

- [ ] **Step 1: 写失败的提醒测试**

```rust
    #[test]
    fn child_due_dates_fire_their_own_reminders() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let due = Utc.with_ymd_and_hms(2026, 9, 9, 12, 0, 0).unwrap();
        let child = create_task(
            &conn,
            NewTask {
                parent_task_id: Some(parent.id),
                due_at: Some(due),
                ..make_new_task("收集数据")
            },
        )
        .unwrap();

        let fired = scan_reminders(&conn, due - chrono::Duration::minutes(60)).unwrap();

        let mine = fired.iter().find(|reminder| reminder.task_id == child.id).unwrap();
        assert_eq!(mine.task_title, "收集数据", "the reminder names the child itself");
        assert!(fired.iter().all(|reminder| reminder.task_id != parent.id));
    }

    #[test]
    fn completing_the_parent_no_longer_silences_its_children() {
        // Replaces `completing_the_parent_stops_its_subtask_reminders` (§9.3).
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let due = Utc.with_ymd_and_hms(2026, 9, 9, 12, 0, 0).unwrap();
        let child = create_task(
            &conn,
            NewTask {
                parent_task_id: Some(parent.id),
                due_at: Some(due),
                ..make_new_task("收集数据")
            },
        )
        .unwrap();

        complete_task(&conn, parent.id).unwrap();
        let fired = scan_reminders(&conn, due - chrono::Duration::minutes(60)).unwrap();

        assert!(
            fired.iter().any(|reminder| reminder.task_id == child.id),
            "a child keeps its own schedule (§9.3)"
        );
    }

    #[test]
    fn a_soft_deleted_parent_takes_its_children_out_of_the_scan() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let due = Utc.with_ymd_and_hms(2026, 9, 9, 12, 0, 0).unwrap();
        let child = create_task(
            &conn,
            NewTask {
                parent_task_id: Some(parent.id),
                due_at: Some(due),
                ..make_new_task("收集数据")
            },
        )
        .unwrap();

        soft_delete_task(&conn, parent.id).unwrap();
        let fired = scan_reminders(&conn, due - chrono::Duration::minutes(60)).unwrap();

        assert!(fired.iter().all(|reminder| reminder.task_id != child.id));
    }
```

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `cd src-tauri && cargo test services::tests::child_due_dates services::tests::completing_the_parent_no_longer services::tests::a_soft_deleted_parent_takes`
Expected: `child_due_dates_fire_their_own_reminders` FAIL（`task_title` 是父任务标题，或根本没触发），后两条视 Task 2–4 的状态失败。

- [ ] **Step 3: 收敛扫描**

`services.rs` 的 `scan_reminders` 删掉 `list_subtask_candidates` 那一轮，只留：

```rust
    for candidate in reminders::list_candidates(conn, cutoff, horizon)? {
        for kind in due_kinds(now, candidate.due_at) {
            if reminders::mark_fired(&tx, candidate.id, kind, now)? {
                fired.push(Reminder {
                    task_id: candidate.id,
                    task_title: candidate.title.clone(),
                    kind,
                    due_at: candidate.due_at,
                });
            }
        }
    }
```

`repositories.rs` 的 `pub mod reminders` 里删 `SubtaskReminderCandidate`、`list_subtask_candidates`、`mark_subtask_fired`；`list_candidates` 的 SQL 不变（子任务已是 `tasks` 里的行，未完成、未软删、有 `due_at` 三个条件自然覆盖 §9.3）。

- [ ] **Step 4: 改通知文案与其测试**

`scheduler.rs` 的 `notification_texts` 用 Task 4 Step 4 给的版本（单段 subject）。测试 `subtask_reminders_name_the_parent_and_the_subtask` 改名为 `notifications_name_the_task_itself` 并改写断言：

```rust
    #[test]
    fn notifications_name_the_task_itself() {
        let reminder = Reminder {
            task_id: Uuid::nil(),
            task_title: "收集数据".into(),
            kind: ReminderKind::Due,
            due_at: Utc.with_ymd_and_hms(2026, 9, 9, 12, 0, 0).unwrap(),
        };

        let (title, body) = notification_texts(&reminder);

        assert_eq!(title, "Ordo 任务提醒");
        assert!(body.contains("收集数据"));
        assert!(!body.contains('›'), "no two-level subject any more");
    }
```

- [ ] **Step 5: 跑提醒测试**

Run: `cd src-tauri && cargo test reminder`
Expected: PASS（`services::tests` 与 `scheduler::tests` 的提醒用例全绿）。

---

### Task 8: 统计口径与索引断言（提交点 A）

**Files:**
- Modify: `src-tauri/src/repositories.rs`（`stats::trend_sql` 1311、`PROJECT_PROGRESS_SQL` 1414、索引计划断言 1467）
- Test: `src-tauri/src/repositories.rs`、`src-tauri/src/services.rs`
- Modify: `docs/ARCHITECTURE.md`（§4.2 实体表、迁移清单、提醒规则、统计口径）

**Interfaces:**
- Consumes: Task 5–7 的服务层
- Produces: `stats:trend` 与 `stats:projectProgress` 只数顶层任务

- [ ] **Step 1: 写失败的口径测试**

在 `repositories.rs` 的 `mod tests`（stats 部分）里追加：

```rust
    #[test]
    fn trend_counts_top_level_tasks_only() {
        let conn = conn();
        let parent = sample_task("a");
        tasks::insert(&conn, &parent).unwrap();
        let mut child = sample_task("b");
        child.parent_task_id = Some(parent.id);
        child.completed_at = Some(ts(10));
        tasks::insert(&conn, &child).unwrap();
        let mut done_parent = sample_task("c");
        done_parent.completed_at = Some(ts(20));
        tasks::insert(&conn, &done_parent).unwrap();

        let points = stats::completion_trend(
            &conn,
            &TrendQuery { from: ts(0), to: ts(60), granularity: StatsGranularity::Day, offset_minutes: 0 },
        )
        .unwrap();

        let total: i64 = points.iter().map(|point| point.value).sum();
        assert_eq!(total, 1, "a child is a breakdown inside its parent, not a second completion");
    }

    #[test]
    fn project_progress_counts_top_level_tasks_only() {
        let conn = conn();
        // …插入一个项目、一个顶层任务与它的一个子任务（子任务 completed）…
        let progress = stats::project_progress(&conn).unwrap();

        assert_eq!((progress[0].total, progress[0].completed), (1, 0));
    }
```

`TrendQuery` 的字段名照 `models.rs` 里的实际定义写（`granularity` / `offset_minutes`）；`ProjectProgress` 的断言沿用同文件既有的 `project_progress_*` 用例写法。

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `cd src-tauri && cargo test repositories::tests::trend_counts repositories::tests::project_progress_counts`
Expected: FAIL —— 两条都把子任务数了进去。

- [ ] **Step 3: 加层级条件**

`stats::trend_sql`（1311）：

```rust
             WHERE deleted_at IS NULL AND parent_task_id IS NULL \
               AND completed_at >= ?1 AND completed_at < ?2 \
```

`PROJECT_PROGRESS_SQL`（1414）：

```rust
         LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL \
              AND t.parent_task_id IS NULL \
```

- [ ] **Step 4: 复验索引计划断言**

Run: `cd src-tauri && cargo test repositories::tests::stats`
Expected: PASS，特别是 `trend.contains("SEARCH tasks USING INDEX idx_tasks_completed_at")` 那条。**若它失败**（SQLite 因为新条件退回全表扫描），不要改 `V7` —— 新增 `src-tauri/migrations/V8__stats_top_level_index.sql`，把索引扩成覆盖新谓词的形式（例如 `CREATE INDEX idx_tasks_completed_at_top ON tasks(completed_at) WHERE parent_task_id IS NULL;`），并在同一提交里同步 `ARCHITECTURE.md` 的索引清单。

- [ ] **Step 5: 同步 `docs/ARCHITECTURE.md`**

- §4.2 实体表：`Subtask` 行删除；`Task` 行加 `parent_task_id(可空→子任务，单层)`；`Dependency` 的描述改成「一张 `task_dependencies`，两端都是任务」。
- 迁移清单加一条 `> **任务层级（V7）**：…`，写清「不重建 `tasks` 的原因（`task_search` 按 rowid 的外部内容表）」「`done → completed_at` 取 `updated_at`」「提醒标记原样搬迁以免重发」「`subtask:*` 七个命令退役、`task:reorder` 新增」。
- 提醒小节（原文 267 行的两轮扫描与「父任务完成即静默子任务」）：改成单轮扫描 `tasks` + 子任务独立提醒。
- 统计小节（273 行）：`stats:projectProgress` 的返回去掉 `due_at`（R2 已做），补「两个统计都只数顶层任务」。

- [ ] **Step 6: 全量验证并提交（提交点 A）**

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test
```

Expected: `cargo fmt` 之后 `git diff` 为空、`clippy` 零输出、`cargo test` 全绿（约 126 条，条数会因合并而略减）。

```bash
git add src-tauri/migrations/V7__task_hierarchy.sql src-tauri/src/models.rs src-tauri/src/repositories.rs src-tauri/src/services.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/db.rs src-tauri/src/scheduler.rs docs/ARCHITECTURE.md
git commit -m "refactor: move subtasks into the task tree"
```

---

## M3 前端数据层

### Task 9: 类型、IPC 常量与 api

**Files:**
- Modify: `src/common/ipc/commands.ts`（`task` 块 11–17、`subtask` 块 16–23）
- Modify: `src/features/tasks/types.ts`（`Task` 35、`Subtask` 53、`DependencyKind` 176、`Dependency` 182、`NewTask` 96、`UpdateTask` 109）
- Modify: `src/features/tasks/api.ts`（`subtask:*` 段 71–108）
- Test: `src/features/tasks/__tests__/hooks.test.ts`（它的 `vi.mock("../api", …)` 工厂必须与 `api.ts` 的导出面一致，否则所有用例一起炸）

**Interfaces:**
- Consumes: Task 8 的后端命令面
- Produces:
  - `COMMANDS.task.reorder = "task:reorder"`；`COMMANDS.subtask` **不存在**
  - `Task.parentTaskId: string | null`；`NewTask.parentTaskId?: string | null`；`UpdateTask.parentTaskId?: string | null`
  - `Dependency { dependentId: string; prerequisiteId: string }`
  - `api.reorderTask(taskId: string, prev: string | null, next: string | null): Promise<Task[]>`

- [ ] **Step 1: 写失败的 api 测试**

在 `src/features/tasks/__tests__/hooks.test.ts` 顶部把 `vi.mock("../api", …)` 工厂里的七个 `listSubtasks/listSubtasksAll/createSubtask/updateSubtask/completeSubtask/deleteSubtask/reorderSubtask` 换成：

```ts
  reorderTask: vi.fn(),
```

**同一个改动要落到每一个把任务 api 逐项列出的 mock 工厂**，否则那些文件里的 `api.reorderTask` 是 `undefined`：`src/features/tasks/__tests__/{hooks,reminders,task-detail-dialog,task-views}.test.*`、`src/app/__tests__/{app-shell-sidebar,quick-add-window,task-viewer}.test.tsx`。

并在 `describe("tags")` 之前加一段：

```ts
describe("reorderTask", () => {
  it("posts the neighbour keys and returns the authoritative siblings", async () => {
    const ordered = [task("t2"), task("t1")];
    vi.mocked(api.reorderTask).mockResolvedValue(ordered);

    const result = await hooks.reorderTask("t1", null, "m");

    expect(api.reorderTask).toHaveBeenCalledWith("t1", null, "m");
    expect(result?.map((item) => item.id)).toEqual(["t2", "t1"]);
    expect(store.tasksState.tasks.map((item) => item.id)).toEqual(["t2", "t1"]);
  });
});
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run src/features/tasks/__tests__/hooks.test.ts -t reorderTask`
Expected: FAIL —— `api.reorderTask is not a function` / `hooks.reorderTask is not a function`。

- [ ] **Step 3: 改类型与命令常量**

`src/common/ipc/commands.ts`：`subtask` 块整块删除，`task` 块加一行 `reorder: "task:reorder",`。

`src/features/tasks/types.ts`：

```ts
export interface Task {
  id: string;
  projectId: string | null;
  title: string;
  note: string | null;
  priority: Priority;
  columnId: string | null;
  dueAt: string | null;
  completedAt: string | null;
  repeatRule: RepeatRule | null;
  complexity: number | null;
  /** Parent task; `null` for a top-level task. The hierarchy is one level. */
  parentTaskId: string | null;
  tagIds: string[];
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

删 `Subtask`、`NewSubtask`、`UpdateSubtask`、`DependencyKind`；`Dependency` 去掉 `kind`；`NewTask` / `UpdateTask` 加 `parentTaskId?: string | null`（`UpdateTask` 的注释写明 `null` = 移出父任务）。

- [ ] **Step 4: 改 api**

`src/features/tasks/api.ts` 删 `// --- subtask:* ---` 整段与相关 import，加：

```ts
/** Moves a task between its siblings; returns the sibling set in new order. */
export function reorderTask(
  taskId: string,
  prev: string | null,
  next: string | null,
): Promise<Task[]> {
  return invokeCommand(COMMANDS.task.reorder, { taskId, prev, next });
}
```

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run src/features/tasks/__tests__/hooks.test.ts`
Expected: 除依赖子任务缓存的用例外全绿（那些用例在 Task 10/11 改写）。`pnpm typecheck` 此刻会报出所有引用 `Subtask` / `subtasksByTask` / `subtask:*` 的文件 —— 那就是 Task 10–16 的清单。

---

### Task 10: store 派生与缓存删除

**Files:**
- Modify: `src/features/tasks/store.ts`（类型 14–40、`getSubtasks` 53、`hasSubtasks` 58、mutator 段 195–283、`resetTasksStore` 331）
- Test: `src/features/tasks/__tests__/store.test.ts`

**Interfaces:**
- Consumes: Task 9 的 `Task.parentTaskId`
- Produces:
  - `childrenOf(taskId: string): Task[]` —— 该父任务的子任务，按 `sortOrder` 升序
  - `topLevelTasks(): Task[]` —— `parentTaskId === null` 的任务，保持 store 顺序
  - `hasChildren(taskId: string): boolean`
  - `store.tasksState` 不再有 `subtasksByTask`

- [ ] **Step 1: 写失败的 store 测试**

在 `src/features/tasks/__tests__/store.test.ts` 里追加：

```ts
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
```

（`task()` 是文件里既有的工厂，需要给它的字面量补 `parentTaskId: null`。）

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `pnpm vitest run src/features/tasks/__tests__/store.test.ts -t 层级派生`
Expected: FAIL —— `store.childrenOf is not a function`。

- [ ] **Step 3: 加派生、删缓存**

`src/features/tasks/store.ts`：`TasksState` 去掉 `subtasksByTask`；删 `getSubtasks` / `hasSubtasks` / `setSubtasks` / `setSubtasksAll` / `upsertSubtask` / `patchSubtask` / `removeSubtask` / `insertSubtaskAt`；`resetTasksStore` 去掉 `subtasksByTask: {}`。新增（放在 `getTag` 之后）：

```ts
/**
 * A parent's children, in `sortOrder`. The whole hierarchy arrives in one
 * `task:list` snapshot (R7c), so this is a filter — there is no cache, no
 * loading state, and no second protocol to keep in sync.
 */
export function childrenOf(taskId: string): Task[] {
  return state.tasks
    .filter((task) => task.parentTaskId === taskId)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0));
}

/** Top-level tasks, in the store's own order. */
export function topLevelTasks(): Task[] {
  return state.tasks.filter((task) => task.parentTaskId === null);
}

/** Whether a task has children — the disclosure arrow and the badge. */
export function hasChildren(taskId: string): boolean {
  return state.tasks.some((task) => task.parentTaskId === taskId);
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run src/features/tasks/__tests__/store.test.ts`
Expected: PASS。

---

### Task 11: hooks、dependencies、blocked-confirm 与 reminders

**Files:**
- Modify: `src/features/tasks/hooks.ts`（`loadAll` 80、`reloadTasks` 108、`loadSubtasks` 120、`createTask` 134、`updateTask`、`titleOf` 261、子任务段 402–520）
- Modify: `src/features/tasks/dependencies.ts`（全文，`entityKey` 14 起）
- Modify: `src/features/tasks/blocked-confirm.ts`（全文）
- Modify: `src/features/tasks/components/BlockedConfirmHost.tsx`
- Modify: `src/features/tasks/reminders.ts`（`Reminder` 22–46）
- Test: `src/features/tasks/__tests__/{hooks,dependencies,blocked-confirm,reminders}.test.*`

**Interfaces:**
- Consumes: Task 10 的 `childrenOf` 等派生
- Produces:
  - `hooks.createTask(input: NewTask)` 透传 `parentTaskId`
  - `hooks.reorderTask(taskId, prev: string | null, next: string | null): Promise<Task[] | null>`
  - `hooks.loadAll()` = `listTasks + listTags + listDependencies` 三条
  - `dependencies.buildIndex(edges, live)` / `liveSet(tasks)` / `completionSet(tasks)` / `blockersOf(index, done, id)` / `isBlocked(index, done, id)` / `successorsOf(index, id)` / `wouldCycle(index, dependentId, prerequisiteId)` —— 全部去掉 `kind`
  - `blocked-confirm.BlockerRef { id, title }`；`BlockedRequest { id, title, blockers, run }`

- [ ] **Step 1: 写失败的测试**

`dependencies.test.ts`：把 `wouldCycle(index, "task", "C", "A")` 一类调用改成 `wouldCycle(index, "C", "A")`，并保留原断言（成环检测语义不变）：

```ts
    expect(wouldCycle(index, "C", "A")).toBe(true);
    expect(wouldCycle(index, "A", "A")).toBe(true);
    expect(wouldCycle(index, "A", "B")).toBe(false);
    expect(wouldCycle(index, "A", "E")).toBe(false);
```

`hooks.test.ts` 追加：

```ts
describe("层级", () => {
  it("createTask files a new task under its parent", async () => {
    vi.mocked(api.createTask).mockImplementation(async (payload) =>
      task("new-1", { title: payload.title, parentTaskId: payload.parentTaskId ?? null }),
    );

    await hooks.createTask({ title: "收集数据", parentTaskId: "p1" });

    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: "p1" }),
    );
  });

  it("soft-deleting a parent removes its children in the same tick", async () => {
    store.setAll([task("p1"), task("c1", { parentTaskId: "p1" })], []);
    vi.mocked(api.softDeleteTask).mockResolvedValue(undefined);

    await hooks.softDeleteTask("p1");

    expect(store.getTask("p1")).toBeUndefined();
    expect(store.getTask("c1")).toBeUndefined();
  });

  it("restoring a parent re-reads the list so its children come back too", async () => {
    // `restoreTask` is not optimistic — it waits for the authoritative row.
    // The server restores the children in the same transaction, but the single
    // returned row cannot carry them, so the hook re-reads the list.
    store.setAll([], []);
    vi.mocked(api.restoreTask).mockResolvedValue(task("p1"));
    vi.mocked(api.listTasks).mockResolvedValue([
      task("p1"),
      task("c1", { parentTaskId: "p1" }),
    ]);

    await hooks.restoreTask("p1");

    expect(store.getTask("p1")).toBeDefined();
    await waitFor(() => expect(store.getTask("c1")).toBeDefined());
  });
});
```

`blocked-confirm.test.tsx` 的 `park()` 里的请求字面量改成：

```tsx
  const request: BlockedRequest = {
    id: "a",
    title: "写周报",
    blockers: [{ id: "b", title: "收集数据" }],
    run,
  };
```

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `pnpm vitest run src/features/tasks/__tests__/dependencies.test.ts src/features/tasks/__tests__/hooks.test.ts`
Expected: FAIL —— 参数个数与类型不匹配（`wouldCycle` 仍要 4 个参数）、`parentTaskId` 未透传。

- [ ] **Step 3: 收敛依赖派生**

`dependencies.ts`：删 `entityKey` 的 `kind` 参数与 `DependencyKind` import；`liveSet(tasks)` / `completionSet(tasks)` 只收任务数组（子任务也是任务，`completedAt !== null` 即完成）；`buildIndex(edges, live)` 直接用 `edge.dependentId` / `edge.prerequisiteId` 作键；`edgeEquals` 去掉 `kind` 比较。`Subtask` import 一并删除。

- [ ] **Step 4: 改 hooks**

- `loadAll`：`Promise.all([api.listTasks(), api.listTags(), api.listDependencies()])`，删 `store.setSubtasksAll(...)` 一行，注释改成「四个字段现在都在同一份快照里」。
- `loadSubtasks` 整个函数删除。
- `createTask`：乐观行加 `parentTaskId: input.parentTaskId ?? null`；末尾 `if (input.subtaskTitles?.length) void loadSubtasks(created.id);` 改成 `if (input.subtaskTitles?.length) void reloadTasks();`，注释说明「子任务是同一集合里的行，重新拉一次列表即可」。
- `updateTask` 的乐观补丁加 `if ("parentTaskId" in patch) optimisticPatch.parentTaskId = patch.parentTaskId ?? null;`。
- 子任务段（`createSubtask` / `updateSubtask` / `completeSubtask` / `deleteSubtask` / `reorderSubtask`）整段删除，换成：

```ts
/** Moves a task between its siblings; reconciles the whole sibling set. */
export function reorderTask(
  taskId: string,
  prev: string | null,
  next: string | null,
): Promise<Task[] | null> {
  return optimistic(
    () => {},
    () => {},
    async () => {
      const ordered = await api.reorderTask(taskId, prev, next);
      for (const task of ordered) store.patchTask(task.id, task);
      return ordered;
    },
  );
}
```

（顺序不是乐观可推的量：重排可能给整组兄弟换键，所以这里不做乐观更新，只把权威结果贴回 store —— 注释里写明这一点。）

- `softDeleteTask`：乐观阶段把子任务一起摘掉，回滚时按索引一起插回：

```ts
  const children = store.childrenOf(taskId);
  return optimistic(
    () => {
      store.removeTask(taskId);
      for (const child of children) store.removeTask(child.id);
    },
    () => {
      store.insertTaskAt(index, snapshot);
      for (const child of children) store.upsertTask(child);
    },
    async () => {
      await api.softDeleteTask(taskId);
      return true;
    },
  );
```

- `restoreTask`：服务端在同一事务里恢复子任务，但 `task:restore` 只回一行，所以拿到权威行之后再拉一次列表（`reloadTasks`），否则子任务要等下一次导航才回来：

```ts
export async function restoreTask(taskId: string): Promise<Task | null> {
  try {
    const restored = await api.restoreTask(taskId);
    store.upsertTask(restored);
    // The server restored the children in the same transaction; the single
    // returned row cannot carry them, so pull the list once more.
    void reloadTasks();
    return restored;
  } catch (error) {
    return reportFailure(error);
  }
}
```

- `titleOf`（261）：只查 store 里的任务：

```ts
function titleOf(id: string): string {
  return store.getTask(id)?.title ?? "（已删除）";
}
```

- `blocked-confirm.ts`：`BlockerRef` 去掉 `kind`，`BlockedRequest` 去掉 `kind` 与 `parentId`；`components/BlockedConfirmHost.tsx` 里凡是用到 `request.kind` / `request.parentId` 的分支一并删掉（它只用 `title` 与 `blockers`）。
- `reminders.ts`：事件类型去掉 `subtaskId` / `subtaskTitle`，`subject` 直接用 `reminder.taskTitle`。

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run src/features/tasks/__tests__/dependencies.test.ts src/features/tasks/__tests__/hooks.test.ts src/features/tasks/__tests__/blocked-confirm.test.tsx src/features/tasks/__tests__/reminders.test.ts`
Expected: PASS。

---

## M4 前端渲染

### Task 12: `SubtaskRow` 与 `SubtaskList` 改造、删除 `SubtaskEditor`

**Files:**
- Modify: `src/features/tasks/components/SubtaskRow.tsx`
- Modify: `src/features/tasks/components/SubtaskList.tsx`
- Delete: `src/features/tasks/components/SubtaskEditor.tsx`
- Test: `src/features/tasks/__tests__/task-views.test.tsx`（`SubtaskRow` 的独立用例 460–505 行）、`src/features/tasks/__tests__/task-detail-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 10 的 `childrenOf` / `hasChildren`；Task 11 的 `reorderTask` / `createTask` / `updateTask`
- Produces:
  - `SubtaskRowProps { task: Task; parentTitle?: string | null; blocked: boolean; onToggleDone: (task: Task, done: boolean) => void; onOpenDetail: (task: Task) => void; onOpenParent?: (parentId: string) => void }`
  - `SubtaskListProps { taskId: string }`（签名不变，数据换成 `childrenOf(taskId)`）

- [ ] **Step 1: 写失败的测试**

`task-views.test.tsx` 里 `SubtaskRow` 的两条独立用例改成传任务行，并新增前缀行的一条：

```tsx
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
    expect(screen.getByRole("button", { name: "打开父任务 写周报" })).toBeTruthy();
  });
```

**必须保住的既有两条契约**（原样保留，只改传参）：`keeps the rail slot 20px wide and stretched to the row height`（`w-5` + `self-stretch`，且 `className` 不得匹配 `/\b(?:size|h)-\d/`）与 `pins the virtualizer, both row components and the gutter to one scale`（4 行 = `224px`、每行恰好一个 `h-14`、展开槽位 `size-5` vs 引导槽位 `w-5`）。

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `pnpm vitest run src/features/tasks/__tests__/task-views.test.tsx -t "parent prefix"`
Expected: FAIL —— `SubtaskRow` 仍在收 `subtask` / `parent` prop。

- [ ] **Step 3: 改 `SubtaskRow`**

保持 `<div class="flex h-14 items-center gap-2.5 border-b border-border pl-3.5 pr-2 …">` 与那个 `w-5 shrink-0 self-stretch` 的引导槽位**一字不动**（契约钉在这里）。把 `props.subtask` 换成 `props.task`，完成状态从 `props.task.completedAt !== null` 读，勾选回调改成 `props.onToggleDone(props.task, done)`；在引导槽位之前加前缀块：

```tsx
      <Show when={props.parentTitle}>
        {(title) => (
          <button
            type="button"
            class="min-w-0 shrink-0 truncate rounded-sm text-xs text-subtle-foreground transition-colors hover:text-primary focus-ring"
            title={`父任务：${title()}`}
            aria-label={`打开父任务 ${title()}`}
            onClick={() => props.onOpenParent?.(props.task.parentTaskId as string)}
          >
            父任务 · {title()}
          </button>
        )}
      </Show>
```

- [ ] **Step 4: 改 `SubtaskList`，删 `SubtaskEditor`**

- `subtasks` 改为 `createMemo(() => childrenOf(props.taskId))`，`doneCount` 改为 `filter((item) => item.completedAt !== null)`。
- 行内编辑调 `updateTask(subtask.id, { title })`；勾选调 `completeTask` / `uncompleteTask`；删除调 `softDeleteTask`；上/下移调 `reorderTask(id, prevKey, nextKey)`（`prevKey`/`nextKey` 取自 `subtasks()` 里相邻两项的 `sortOrder`）。
- 滑杆按钮不再展开属性面板，改为 `onEdit(subtask)`：把它交给父组件的编辑回调（`TaskDetailDialog` 打开的 `TaskEditorDialog`）。
- 删 `SubtaskEditor.tsx` 文件与它的 import。

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run src/features/tasks/__tests__/task-views.test.tsx src/features/tasks/__tests__/task-detail-dialog.test.tsx`
Expected: PASS（`task-detail-dialog` 里依赖属性面板的用例在 Task 13 改写；这一步先保证 `SubtaskRow` 与行高契约绿）。

---

### Task 13: `TaskDetailDialog` 与 `TaskEditorDialog` 的父任务选择

**Files:**
- Modify: `src/features/tasks/components/TaskDetailDialog.tsx`（import 4、effect 80、子任务区 165–172）
- Modify: `src/features/tasks/components/TaskEditorDialog.tsx`（signals 57–67、re-seed 70–92、表单 180+）
- Test: `src/features/tasks/__tests__/task-detail-dialog.test.tsx`、`src/features/tasks/__tests__/task-editor-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 10 的 `childrenOf`；Task 11 的 `createTask` / `updateTask`
- Produces:
  - `TaskDetailDialog` 的子任务区不再有 `hasSubtasks` 加载门
  - `TaskEditorDialogProps` 不变；表单新增「父任务」`Select`（哨兵 `"none"` = 顶层）

- [ ] **Step 1: 写失败的测试**

`task-detail-dialog.test.tsx`（工厂是 `taskFixture` / `renderDetail`；`seedSubtasks` 随子任务缓存一起删掉）：

```tsx
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
```

`task-editor-dialog.test.tsx`（工厂是 `taskFixture` / `renderDialog`）：

```tsx
  it("files a task under the picked parent", async () => {
    store.setAll(
      [taskFixture("p1", { title: "写周报" }), taskFixture("t1", { title: "收集数据" })],
      [],
    );
    renderDialog(taskFixture("t1"));

    fireEvent.pointerDown(screen.getByRole("button", { name: /父任务/ }));
    fireEvent.click(await screen.findByRole("option", { name: "写周报" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(hooks.updateTask).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ parentTaskId: "p1" }),
      ),
    );
  });
```

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `pnpm vitest run src/features/tasks/__tests__/task-editor-dialog.test.tsx -t "picked parent"`
Expected: FAIL —— 没有「父任务」这个 select（`getByRole("button", { name: /父任务/ })` 找不到）。

- [ ] **Step 3: 改详情弹窗**

- 删 `hasSubtasks` / `loadSubtasks` 的 import 与调用（effect 里的那一行、子任务区的 `fallback={<SectionLoading …/>}`）。
- 子任务区直接渲染 `<SubtaskList taskId={task().id} />`；评论与时间记录仍保留各自的加载门（那两套缓存没变）。
- 子任务行点标题时打开**子任务自己的详情**：详情弹窗自己再挂一个 `TaskDetailDialog`（单层，不会有递归深度问题），用一个本地 signal 保存「当前查看的子任务 id」，`<Show when={viewingChild()}>` 里渲染嵌套的那个弹窗；嵌套弹窗关闭时清空该 signal。

- [ ] **Step 4: 改编辑器**

- 加 `const [parentId, setParentId] = createSignal<string | null>(null);`，re-seed 里 `setParentId(task?.parentTaskId ?? null);`。
- 候选 = `tasksState.tasks.filter((item) => item.parentTaskId === null && item.id !== props.task?.id)`，外加哨兵 `{ id: null, name: "（顶层任务）" }`；`optionValue={(option) => option.id ?? "none"}`（真哨兵字符串，Kobalte 把 `""` 读作「未选中」）。
- 选中父任务时同步把「项目」与父任务对齐（子任务跟随父任务的项目）：payload 里 `projectId: parentId() ? getTask(parentId()!)?.projectId ?? null : (props.task ? props.task.projectId : props.defaultProjectId ?? null)`。
- `onChange` 沿用既有防护：`if (id === parentId()) return;`（Kobalte 挂载时会用初值触发一次）。

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run src/features/tasks/__tests__/task-detail-dialog.test.tsx src/features/tasks/__tests__/task-editor-dialog.test.tsx`
Expected: PASS。

---

### Task 14: `TaskListView` 的规则 A、筛选与计数

**Files:**
- Modify: `src/features/tasks/components/TaskListView.tsx`（`ListRow` 25–34、`visible` 98–104、`rows` 118–148、渲染 335–365、计数 204）
- Test: `src/features/tasks/__tests__/task-views.test.tsx`

**Interfaces:**
- Consumes: Task 10 的 `childrenOf` / `topLevelTasks`；Task 11 的精简派生；Task 12 的 `SubtaskRowProps`
- Produces:
  - `type ListRow = { kind: "task"; task: Task; childCount: number; childDone: number; blockerCount: number } | { kind: "child"; task: Task; blocked: boolean; parentTitle: string | null }`
  - 「n 个任务」= `visible().filter((task) => task.parentTaskId === null).length`

- [ ] **Step 1: 写失败的测试**

`task-views.test.tsx` 的 `任务列表的层级展示` 段改成：

```tsx
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
        task("p1", { title: "写周报", dueAt: iso(0, 12) }),
        task("c1", { title: "收集数据", parentTaskId: "p1", dueAt: iso(0, 13), priority: "high" }),
        task("p2", { title: "孤儿子任务", parentTaskId: "gone", dueAt: iso(0, 14), priority: "high" }),
      ],
      [],
    );
    render(() => <TodayView />);

    fireEvent.pointerDown(await screen.findByRole("button", { name: /全部优先级/ }));
    fireEvent.click(await screen.findByRole("option", { name: "仅低" }));

    // p2 is a row of its own: the filter drops it. c1 rides under its parent,
    // which the filter also dropped — so 今天 is empty now.
    await waitFor(() => expect(screen.queryByText("写周报")).toBeNull());
    expect(screen.queryByText("收集数据")).toBeNull();
    expect(screen.queryByText("孤儿子任务")).toBeNull();
  });

  it("counts top-level rows only, so expanding never changes the number", async () => {
    seedHierarchy();
    render(() => <TodayView />);

    // p1 + p2 are top-level; c1 rides under p1 and is not counted.
    expect(await screen.findByText("2 个任务")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /展开 写周报/ }));
    expect(screen.getByText("2 个任务")).toBeTruthy();
  });
```

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `pnpm vitest run src/features/tasks/__tests__/task-views.test.tsx -t "groups a matched child"`
Expected: FAIL —— 子任务行还在按「展开的父任务」单独追加，`c1` 要么出现两次要么不出现（现有实现里 `c1` 自己也会作为顶层任务行参与 `visible()`）。

- [ ] **Step 3: 改写行派生**

```tsx
/** A standalone child: its parent is not in this view (rule A, §8.1). */
type ListRow =
  | {
      kind: "task";
      task: Task;
      childCount: number;
      childDone: number;
      blockerCount: number;
    }
  | { kind: "child"; task: Task; blocked: boolean; parentTitle: string | null };

  // The view predicate (今天/收件箱/…) already ran; this adds the toolbar
  // filters, and §8.6 decides who they touch: a row that stands on its own is
  // filtered, a child riding under its parent is context and never is.
  const visible = createMemo(() => {
    const filter = { priority: priorityFilter(), tagIds: tagFilter() };
    const all = props.tasks();
    const top = applyFilter(
      all.filter((task) => task.parentTaskId === null),
      filter,
    );
    const topIds = new Set(top.map((task) => task.id));
    const standaloneChildren = applyFilter(
      all.filter(
        (task) => task.parentTaskId !== null && !topIds.has(task.parentTaskId as string),
      ),
      filter,
    );
    return sortTasks([...top, ...standaloneChildren], sortMode(), tasksState.tags);
  });

  const rows = createMemo<ListRow[]>(() => {
    const live = liveSet(tasksState.tasks);
    const index = buildIndex(tasksState.dependencies, live);
    const done = completionSet(tasksState.tasks);
    const matched = visible();
    const matchedIds = new Set(matched.map((task) => task.id));
    // A child that matched on its own opens its parent (§8.1): the two paths
    // point at the same child rows, and the parent's position wins (§8.2).
    const autoOpen = new Set(
      matched
        .filter((task) => task.parentTaskId !== null && matchedIds.has(task.parentTaskId))
        .map((task) => task.parentTaskId as string),
    );
    const isOpen = (id: string) => Boolean(expanded()[id]) || autoOpen.has(id);
    const blockedOf = (task: Task) =>
      task.completedAt === null && isBlocked(index, done, task.id);

    const out: ListRow[] = [];
    for (const task of matched) {
      if (task.parentTaskId !== null) {
        out.push({
          kind: "child",
          task,
          blocked: blockedOf(task),
          parentTitle: getTask(task.parentTaskId)?.title ?? "（已删除）",
        });
        continue;
      }
      const children = childrenOf(task.id);
      out.push({
        kind: "task",
        task,
        childCount: children.length,
        childDone: children.filter((child) => child.completedAt !== null).length,
        blockerCount:
          task.completedAt === null ? blockersOf(index, done, task.id).length : 0,
      });
      if (children.length === 0 || !isOpen(task.id)) continue;
      for (const child of children) {
        out.push({ kind: "child", task: child, blocked: blockedOf(child), parentTitle: null });
      }
    }
    return out;
  });
```

- [ ] **Step 4: 改渲染与计数**

- `getKey={(row) => row.task.id}`（两种行都带 `task`）。
- `TaskItemRow` 的 `subtaskCount` / `subtaskDone` 传 `row.childCount` / `row.childDone`；`onToggleExpand` 只对 `kind === "task"` 的行有效。
- `SubtaskRow` 传 `task={row.task}` / `parentTitle={row.parentTitle}` / `blocked={row.blocked}`；勾选处理用 `completeTask(child.id)` / `uncompleteTask(child.id)`（不再有 `completeSubtask`）。
- 计数（204 行）：`{visible().filter((task) => task.parentTaskId === null).length} 个任务`。
- 空态判断（292 / 302 行）继续用 `visible().length > 0` —— 只剩「行内分组的子任务」时父行仍在 `visible()` 里，所以不算空（§8.7）。

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run src/features/tasks/__tests__/task-views.test.tsx`
Expected: PASS，包括两条钉死的契约用例。

---

### Task 15: 依赖候选、看板徽标、进度口径与 `AppShell` 落点

**Files:**
- Modify: `src/features/tasks/components/TaskDependencies.tsx`（候选 32–39）
- Modify: `src/features/board/components/BoardView.tsx` / `BoardCard.tsx`
- Modify: `src/features/projects/components/ProjectListView.tsx` / `src/features/namespaces/components/NamespaceProjectsView.tsx`（传给 `ProjectProgress` 的切片）
- Modify: `src/app/AppShell.tsx`（`ProjectLink` 的 `onDrop`）
- Test: `src/features/tasks/__tests__/task-detail-dialog.test.tsx`、`src/features/board/__tests__/board-view.test.tsx`、`src/features/projects/__tests__/project-progress.test.tsx`、`src/app/__tests__/app-shell-sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 10 的 `topLevelTasks` / `childrenOf`；Task 11 的精简派生
- Produces: `AppShell` 的任务落点调用 `updateTask(id, { projectId, parentTaskId: null })`

- [ ] **Step 1: 写失败的测试**

`app-shell-sidebar.test.tsx`（R7b 的用例改断言）：

```tsx
  it("unfiles a dragged child task when it lands on a project row", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.updateTask).mockResolvedValue(task("t1", { projectId: "p1" }));
    renderShell();

    const target = await screen.findByRole("link", { name: "杂事" });
    setTasks([task("t1", { parentTaskId: "p9" })], []);
    const row = (await waitFor(() => {
      const element = document.querySelector('[data-task-id="t1"]');
      if (!element) throw new Error("task row not rendered yet");
      return element;
    })) as HTMLElement;

    fireEvent.dragStart(row);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(() =>
      expect(tasksApi.updateTask).toHaveBeenCalledWith("t1", {
        projectId: "p1",
        parentTaskId: null,
      }),
    );
  });
```

`task-detail-dialog.test.tsx`：

```tsx
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
```

`board-view.test.tsx`：

```tsx
  it("renders only top-level tasks as cards and badges their children", () => {
    renderBoard();
    tasksStore.setAll(
      [
        task("t1", { columnId: "c1" }),
        task("c1-child", { parentTaskId: "t1", title: "子任务" }),
      ],
      [],
    );

    expect(document.querySelector('[data-task-id="t1"]')).toBeTruthy();
    expect(document.querySelector('[data-task-id="c1-child"]')).toBeNull();
    expect(screen.getByText("0/1 个子任务")).toBeTruthy();
  });
```

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `pnpm vitest run src/features/board/__tests__/board-view.test.tsx -t "only top-level"`
Expected: FAIL —— 子任务被当成卡片渲染出来（它的 `columnId` 是 null，但现在的看板把「任务」一律当卡片）。

- [ ] **Step 3: 收敛候选与看板**

- `TaskDependencies.tsx`：候选来源改成 `topLevelTasks()`；`entityKey` / `blockersOf` / `wouldCycle` / `successorsOf` 的调用去掉 `"task"` 参数。
- `BoardView.tsx`：卡片集合加 `.filter((task) => task.parentTaskId === null)`；`BoardCard.tsx` 显示 `n/m 个子任务` 徽标（数据来自 `childrenOf(task.id)`），行内不再出现子任务。
- `AppShell.tsx` 的 `ProjectLink.onDrop` —— 落到项目行同时清父任务（§9.4：脱离父任务 + 移进该项目）：

```tsx
        const dragged = getTask(id);
        const wasChild = dragged?.parentTaskId !== null;
        void updateTask(id, { projectId: props.project.id, parentTaskId: null }).then((saved) => {
          // §9.4: 用户以为只是换了项目，其实父子关系也断了 —— 说一句。
          if (saved && wasChild) pushInfo(`「${saved.title}」已移出父任务并归入「${props.project.name}」`);
        });
```

（`pushInfo` 从 `../common/stores/notifications` 引入 —— 该模块已有这个中性级别，不必新增通道。）

同一处 `onDragOver` 的短路判断改成「已在该项目、且本来就不是子任务」：`const current = getTask(id); if (!current || (current.projectId === props.project.id && current.parentTaskId === null)) return;`。

- `ProjectListView.tsx` / `NamespaceProjectsView.tsx`（§8.5）：`ProjectProgress` 的数字来自调用方传进去的切片，所以「只数顶层任务」在调用点完成：

```tsx
        <ProjectProgress tasks={tasks().filter((task) => task.parentTaskId === null)} />
```

两处 `<ProjectProgress …>` 都要改：项目详情页那一处、命名空间页的汇总与每个项目卡片各一处。

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run src/features/tasks/__tests__/task-detail-dialog.test.tsx src/features/board/__tests__/board-view.test.tsx src/app/__tests__/app-shell-sidebar.test.tsx`
Expected: PASS。

---

## M5 交互（拖放）

### Task 16: R7c 落点——把任务拖成另一个任务的子任务（提交点 B）

**Files:**
- Modify: `src/features/tasks/components/TaskItemRow.tsx`（props 34–56、根 div 57–66）
- Modify: `src/features/tasks/components/TaskListView.tsx`（把拖放回调接到行上）
- Test: `src/features/tasks/__tests__/task-views.test.tsx`

**Interfaces:**
- Consumes: `common/stores/drag.ts` 的 `beginDrag` / `endDrag` / `draggedId(event, "task")`；Task 11 的 `updateTask`
- Produces: 拖到任务行 = `updateTask(draggedId, { parentTaskId: target.id })`

- [ ] **Step 1: 写失败的测试**

```tsx
  it("files a dragged task under the row it is dropped on", async () => {
    store.setAll(
      [task("p1", { title: "写周报", dueAt: iso(0, 12) }), task("t2", { title: "收集数据", dueAt: iso(0, 13) })],
      [],
    );
    vi.mocked(api.updateTask).mockResolvedValue(task("t2", { parentTaskId: "p1" }));
    render(() => <TodayView />);

    const source = document.querySelector('[data-task-id="t2"]') as HTMLElement;
    const target = document.querySelector('[data-task-id="p1"]') as HTMLElement;

    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith("t2", { parentTaskId: "p1" }),
    );
  });

  it("refuses to drop a task onto itself or onto a parent candidate", async () => {
    store.setAll(
      [
        task("p1", { title: "有子任务的", dueAt: iso(0, 12) }),
        task("c1", { title: "它的孩子", parentTaskId: "p1", dueAt: iso(0, 13) }),
        task("t2", { title: "被拖的", dueAt: iso(0, 14) }),
      ],
      [],
    );
    vi.mocked(api.updateTask).mockResolvedValue(null);
    render(() => <TodayView />);

    const byId = (id: string) => document.querySelector(`[data-task-id="${id}"]`) as HTMLElement;

    // Onto itself: nothing to do.
    fireEvent.dragStart(byId("t2"));
    fireEvent.drop(byId("t2"));
    // Onto a task that already has children: it can never take a parent.
    fireEvent.dragStart(byId("t2"));
    fireEvent.drop(byId("p1"));

    expect(api.updateTask).not.toHaveBeenCalled();
  });
```

（`task-views.test.tsx` 顶部已经 `vi.mock("../api", …)`，所以断言打在 `api.updateTask` 上：拖放路径最终就是通过 hooks 调它。）

- [ ] **Step 2: 跑测试，确认它们失败**

Run: `pnpm vitest run src/features/tasks/__tests__/task-views.test.tsx -t "files a dragged task"`
Expected: FAIL —— 任务行只有拖源（R7b 接的 `beginDrag`），没有任何 `onDrop`。

- [ ] **Step 3: 给任务行加落点**

`TaskItemRow.tsx` 的 props 加一个回调（沿用 R7b 的分工：行只报告「谁落在了我身上」，写库由列表层做）：

```tsx
  /** R7c: a task dragged onto this row becomes its child. The row refuses
   * when the drop could not be legal — the caller writes, it decides. */
  onDropTask?: (draggedId: string, target: Task) => void;
```

根 div：

```tsx
      onDragOver={(event) => {
        const dragged = draggedId(event, "task");
        if (!dragged || !props.onDropTask || !canAcceptChild(dragged, props.task)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        setChildOver(true);
      }}
      onDragLeave={() => setChildOver(false)}
      onDrop={(event) => {
        const dragged = draggedId(event, "task");
        setChildOver(false);
        if (!dragged || !canAcceptChild(dragged, props.task)) return;
        event.preventDefault();
        endDrag();
        props.onDropTask?.(dragged, props.task);
      }}
```

`canAcceptChild` 与父任务选择器共用同一份规则，放 `src/features/tasks/hierarchy.ts`（新文件，纯函数，便于表驱动测试）：

```ts
/**
 * Whether `childId` may be filed under `parent` (R7c). The rules are the
 * service's, restated here so the drop highlight can answer before the write:
 * one level deep, no self-parenting, and a task that already has children can
 * never become a child itself.
 */
export function canAcceptChild(childId: string, parent: Task): boolean {
  if (childId === parent.id) return false;
  if (parent.parentTaskId !== null) return false;
  const child = getTask(childId);
  if (!child) return false;
  if (child.parentTaskId === parent.id) return false;
  return !hasChildren(childId);
}
```

- [ ] **Step 4: 列表层写库**

```tsx
  const dropOnTask = (draggedId: string, target: Task) => {
    void updateTask(draggedId, { parentTaskId: target.id });
  };
```

传给每一行 `<TaskItemRow … onDropTask={dropOnTask} />`。

- [ ] **Step 5: 跑测试与全量前端校验并提交（提交点 B）**

Run: `pnpm vitest run src/features/tasks/__tests__/task-views.test.tsx && pnpm typecheck && pnpm test`
Expected: 全绿。

```bash
git add src/common/ipc/commands.ts src/features/tasks src/features/board src/features/projects/components/ProjectListView.tsx src/features/namespaces/components/NamespaceProjectsView.tsx src/features/settings/types.ts src/app/AppShell.tsx src/app/__tests__/app-shell-sidebar.test.tsx docs/PRD.md
git commit -m "feat: render the task hierarchy and drop tasks onto tasks"
```

---

## M6 文档与收尾

### Task 17: 文档同步、死代码清理与全量验证（提交点 C）

**Files:**
- Modify: `docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/CHANGE_REQUESTS.md`
- 清理：全仓库搜 `subtask:` / `subtasksByTask` / `getSubtasks` / `hasSubtasks` / `DependencyKind` 的残留
- Test: 全量

**Interfaces:**
- Consumes: 前 16 个任务的全部产物
- Produces: 无新接口；这一任务只让文档与死代码跟上

- [ ] **Step 1: 清理残留**

Run: `grep -rn "subtasksByTask\|getSubtasks\|hasSubtasks\|DependencyKind\|subtask:list\|createSubtask\|completeSubtask\|SubtaskEditor" src/ src-tauri/src/ | grep -v __tests__`
Expected: 空输出。任何命中都是漏改的调用点；一并清掉（`__tests__` 里的命中说明有死测试，一并删）。

- [ ] **Step 2: 同步 `docs/PRD.md`**

- §2.1 任务：把「子任务」的描述从「独立实体」改成「子任务就是有父任务的任务，单层，拥有标签/评论/时间记录/依赖与自己的详情弹窗」。
- §2.1 的截止与提醒：补一句「子任务按自己的截止时间独立提醒，不再因父任务完成而静默」。
- 核心实体列表：删 `Subtask` 一行，`Task` 行补 `parent_task_id`。
- 视图规则：把规则 A（父在同视图则子任务行内分组；父不在则子任务带「父任务 · X」前缀独立成行）、§8.6 的筛选规则、§8.7 的计数规则各写一句。
- 拖放：R7c（任务落到任务行 = 变成子任务）与 R7b 的落点合并成一段。

- [ ] **Step 3: 同步 `docs/IMPLEMENTATION_PLAN.md`**

在里程碑总览表加一行，并在任务明细里补一节：

```markdown
| M10 任务层级 | `tasks.parent_task_id` + V7 迁移 + 子任务并入任务树 + R7c 拖放 | R7c（`CHANGE_REQUESTS.md` §7）、`specs/2026-09-15-task-hierarchy-design.md` | 迁移守恒、单层校验、规则 A、拖放可落性 |
```

M10 明细按本计划的 6 个里程碑各列一行（数据层 / 后端 / 前端数据层 / 前端渲染 / 交互 / 文档），状态标 ✅。

- [ ] **Step 4: 同步 `docs/CHANGE_REQUESTS.md`**

§7 的「在写出这份 spec 并被评审前不动 R7c 的代码」改成落地说明，附三个提交点的 hash；§4 的 P6 行标 ✅。

- [ ] **Step 5: 全量验证**

```bash
pnpm typecheck && pnpm test
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test
```

Expected: 前端 `tsc` 零输出、Vitest 全绿；`cargo fmt` 后 `git diff` 为空、`clippy` 零输出、`cargo test` 全绿。

- [ ] **Step 6: 手动冒烟（无法自动化的那几条）**

Run: `pnpm tauri dev`（需要 `pnpm dev` 在 1420 端口；`cargo build` 的 dev 产物会连 `build.devUrl`，单独跑二进制只会显示连接错误）

逐条确认：
1. 拖一个任务到另一个任务行 → 它出现在对方下面，缩进 20px、有引导线；刷新后仍在。
2. 拖一个有子任务的任务到别的任务上 → 落点不高亮、松手无变化。
3. 拖一个顶层任务到侧边栏项目行 → 进那个项目；拖一个子任务到项目行 → 同时脱离父任务。
4. 到「今天」视图确认子任务凭自己的到期时间出现；父任务不满足条件时它以「父任务 · X」前缀出现。
5. 重启应用，确认迁移后的旧子任务仍在原位、且能被搜索到。

- [ ] **Step 7: 提交（提交点 C）**

```bash
git add docs/PRD.md docs/ARCHITECTURE.md docs/IMPLEMENTATION_PLAN.md docs/CHANGE_REQUESTS.md
git commit -m "docs: record the task hierarchy milestone"
```

---

## 自查（写计划时留下的三处判断）

1. **`BackupData.subtasks` 的元素类型**：spec §6.1 说「删除 `Subtask`」，§5.2 说该字段保留用于读旧档 —— 两者只能靠一个新类型名同时成立，本计划用 `LegacySubtask`（只派生 `Deserialize`）。spec 没有给这个名字。
2. **§8.7 的计数**：spec 写「只数顶层行（`parentTaskId === null`）」。按字面实现时，规则的例外（父任务不在结果里、以「父任务 · X」前缀独立成行的子任务）也不计入，尽管它是一条看得见的行。计划按字面实现并加了断言；若想让它计入，改 `visible().filter(...)` 那一处即可。
3. **`reorder_task` 的作用域**：spec §6.3 说「同一父任务下的兄弟」或「同一列的顶层任务」。返回值的排序基准因此有两条腿（`list_by_parent` / `list` 后按 `column_id` 过滤再排序），本计划把两条都写在 `reorder_task` 里而不是下沉到仓库层 —— `tasks::list` 已经是全表查询，多一个 `list_by_scope` 只会多一条 SQL 而没有新语义。

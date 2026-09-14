# 任务属性扩展与依赖顺序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给任务加复杂度、给子任务加描述/优先级/截止日期/复杂度，并让任务之间、子任务之间可以设置「谁必须先完成」，被前置卡住的项在列表上显示「阻塞中」、完成时弹一次软确认。

**Architecture:** 迁移 V4 加列 + 两张边表（`task_dependencies` / `subtask_dependencies`）+ 一张子任务提醒去重表（`subtask_reminders`）。依赖边随启动一次性全量拉到前端（与 `subtask:listAll` 同一模式），阻塞状态在前端用纯函数 + `createMemo` 派生，后端只负责存在性 / 同父 / 自依赖 / 环检测四条校验。完成动作的软阻塞收敛在 `hooks.ts` 一处：被阻塞时不落库，把请求交给一个全局宿主组件弹确认框，因此 5 个完成入口（任务行、看板卡、详情弹窗、子任务行 ×2）零改动。

**Tech Stack:** Rust（rusqlite + refinery + Tauri 2 commands）、SolidJS + TypeScript、Vitest（jsdom）、Tailwind v4

**Spec:** `docs/superpowers/specs/2026-09-14-task-attributes-and-dependencies-design.md`

## Global Constraints

- **SolidJS 不是 React**：用 `createSignal` / `createMemo` / `<Show>` / `<For>` / `class`（不是 `className`），没有 `useState` / `useEffect`。
- **Layering**：`commands.rs` 只做薄包装，业务在 `services.rs`，**SQL 只出现在 `repositories.rs`**。
- **迁移不可改**：已应用的 `V1`–`V3` 永不修改，只能新增 `V4__*.sql`。
- **Tauri 命令命名**：`#[tauri::command(rename = "dependency:listAll")]`，Rust 函数名保持合法标识符；JS 侧参数键是 camelCase。
- **Patch 语义**：字段缺失 = 不动，显式 `null` = 清空。任何可空列的可选更新都必须走 `Patch<T>`，不能用 `Option<Option<T>>`。
- **软删除不级联**：`deleted_at` 是唯一删除方式，查询默认过滤 `deleted_at IS NULL`。
- **复杂度**：`Option<i64>`，取值范围 `1..=5` 或 `NULL`；服务层校验 + DB `CHECK` 兜底；越界报 `AppError::Validation`。
- **测试/收口命令**：`cd src-tauri && cargo test`；仓库根 `pnpm test`、`pnpm typecheck`。`cargo fmt` 与 `cargo clippy --all-targets -- -D warnings` 必须零输出。
- **文档必须同 commit**：`docs/PRD.md`（功能范围）、`docs/ARCHITECTURE.md`（结构/数据流/命令清单）、`docs/IMPLEMENTATION_PLAN.md`（任务分解）。本计划把文档改动**折进**每个改行为的任务。
- **中文文案**：所有面向用户的字符串保持中文，与现有视图一致。
- **动效与焦点**：只用 `transform` / `opacity`；焦点指示统一 `focus-ring` 工具类。
- **不要用 `class` 覆盖原语里的同类工具类**：Tailwind 按 CSS 源码顺序解决冲突，覆盖会静默失效；需要不同外观就给原语加 `variant`。
- **Kobalte `Select` 的 `onChange` 会在挂载时用初始值触发一次**：把 `onChange` 当「用户选了」的代码必须忽略同值调用；`optionValue` 返回 `""` 会被当成「没选中」，用真实哨兵字符串（本计划统一用 `"none"`）。

---

### Task 1: 迁移 V4（新列 + 三张新表）

**Files:**
- Create: `src-tauri/migrations/V4__task_attributes_and_dependencies.sql`
- Modify: `src-tauri/src/db.rs`（`schema_contains_all_tables` 的表名清单约 66-79 行；测试模块末尾加新用例）
- Modify: `docs/ARCHITECTURE.md`（§4 数据模型的 Schema 摘要）

**Interfaces:**
- Consumes: `V1` 已开启的 `PRAGMA foreign_keys = ON`；`db::test_conn()`（跑全部迁移的内存库）
- Produces: `tasks.complexity`；`subtasks.{note, priority, due_at, complexity}`；表 `task_dependencies(task_id, depends_on, created_at)`、`subtask_dependencies(subtask_id, depends_on, created_at)`、`subtask_reminders(subtask_id, kind, sent_at)`

- [ ] **Step 1: 写迁移文件**

创建 `src-tauri/migrations/V4__task_attributes_and_dependencies.sql`：

```sql
-- Migration V4: task/subtask attributes and dependency edges.
--
-- Attributes: tasks gain a 1-5 complexity; subtasks gain the description,
-- priority, due date and complexity they were missing.
--
-- Dependencies: `(dependent, depends_on)` reads "dependent waits for
-- depends_on". Both edge tables follow the `task_tags` convention (pure join
-- table: composite key, no UUID/audit columns); `subtask_reminders` mirrors
-- V3's `task_reminders`, which cannot be reused because it is WITHOUT ROWID
-- and a nullable source column cannot join that primary key.
--
-- The index on `depends_on` is load-bearing: both the reverse lookup ("who is
-- waiting for me") and the cycle check walk that side.

ALTER TABLE tasks ADD COLUMN complexity INTEGER
    CHECK (complexity IS NULL OR complexity BETWEEN 1 AND 5);

ALTER TABLE subtasks ADD COLUMN note       TEXT;
ALTER TABLE subtasks ADD COLUMN priority   TEXT NOT NULL DEFAULT 'none'
    CHECK (priority IN ('high', 'medium', 'low', 'none'));
ALTER TABLE subtasks ADD COLUMN due_at     TEXT;
ALTER TABLE subtasks ADD COLUMN complexity INTEGER
    CHECK (complexity IS NULL OR complexity BETWEEN 1 AND 5);

CREATE TABLE task_dependencies (
    task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on),
    CHECK (task_id <> depends_on)
) WITHOUT ROWID;

CREATE INDEX idx_task_dependencies_depends_on ON task_dependencies(depends_on);

CREATE TABLE subtask_dependencies (
    subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (subtask_id, depends_on),
    CHECK (subtask_id <> depends_on)
) WITHOUT ROWID;

CREATE INDEX idx_subtask_dependencies_depends_on ON subtask_dependencies(depends_on);

CREATE TABLE subtask_reminders (
    subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('advance_1h', 'advance_10m', 'due')),
    sent_at    TEXT NOT NULL,
    PRIMARY KEY (subtask_id, kind)
) WITHOUT ROWID;
```

- [ ] **Step 2: 把新表加进 db.rs 的表名清单**

`src-tauri/src/db.rs` 的 `schema_contains_all_tables` 里，`for expected in [...]` 数组在 `"task_reminders",` 之后追加：

```rust
            "task_dependencies",
            "subtask_dependencies",
            "subtask_reminders",
```

- [ ] **Step 3: 写失败的测试**

`src-tauri/src/db.rs` 的 `mod tests` 内追加：

```rust
    #[test]
    fn v4_adds_attributes_and_dependency_tables() {
        let conn = migrated_connection();
        let stamp = "2026-01-01T00:00:00Z";
        let insert_task = |id: &str, complexity: Option<i64>| {
            conn.execute(
                "INSERT INTO tasks (id, title, priority, sort_order, created_at, updated_at, complexity) \
                 VALUES (?1, 'T', 'none', 'a', ?2, ?2, ?3)",
                rusqlite::params![id, stamp, complexity],
            )
        };
        insert_task("t1", Some(3)).unwrap();
        insert_task("t2", None).unwrap();
        assert!(insert_task("t3", Some(6)).is_err(), "complexity 6 must be rejected");
        assert!(insert_task("t4", Some(0)).is_err(), "complexity 0 must be rejected");

        // A subtask written without the new column takes the documented defaults.
        conn.execute(
            "INSERT INTO subtasks (id, task_id, title, sort_order, created_at, updated_at) \
             VALUES ('s1', 't1', 'S', 'a', ?1, ?1)",
            rusqlite::params![stamp],
        )
        .unwrap();
        let (priority, note, due, complexity): (
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT priority, note, due_at, complexity FROM subtasks WHERE id = 's1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(priority, "none");
        assert_eq!(note, None);
        assert_eq!(due, None);
        assert_eq!(complexity, None);

        let insert_edge = |dependent: &str, prerequisite: &str| {
            conn.execute(
                "INSERT INTO task_dependencies (task_id, depends_on, created_at) \
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![dependent, prerequisite, stamp],
            )
        };
        insert_edge("t1", "t2").unwrap();
        assert!(insert_edge("t1", "t2").is_err(), "duplicate edge must be rejected");
        assert!(insert_edge("t1", "t1").is_err(), "self-dependency must be rejected");
        assert!(insert_edge("t1", "missing").is_err(), "unknown endpoint must be rejected");

        conn.execute(
            "INSERT INTO subtask_dependencies (subtask_id, depends_on, created_at) \
             VALUES ('s1', 's1', ?1)",
            rusqlite::params![stamp],
        )
        .expect_err("self-dependency must be rejected");
        conn.execute(
            "INSERT INTO subtask_reminders (subtask_id, kind, sent_at) VALUES ('s1', 'due', ?1)",
            rusqlite::params![stamp],
        )
        .unwrap();
    }
```

- [ ] **Step 4: 跑测试**

Run: `cd src-tauri && cargo test db::`
Expected: PASS（`schema_contains_all_tables` 与 `v4_adds_attributes_and_dependency_tables` 都过；若 Step 1 忘了某张表，第一个会失败）

- [ ] **Step 5: 更新 ARCHITECTURE §4**

在 `docs/ARCHITECTURE.md` 的 Schema 摘要里，把三个新表与 `complexity` 列加进去（表格或列表形式跟随该节现有写法），并写明：`task_dependencies` / `subtask_dependencies` 是纯连接表，边的方向是「依赖方 → 前置」。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/migrations/V4__task_attributes_and_dependencies.sql src-tauri/src/db.rs docs/ARCHITECTURE.md
git commit -m "feat: add V4 migration for task attributes and dependency edges"
```

---

### Task 2: 任务复杂度全链路

**Files:**
- Modify: `src-tauri/src/models.rs`（`Task` 约 114-131 行、`NewTask` 约 350-365 行、`UpdateTask` 约 367-388 行；`mod tests` 的 `Task { .. }` 字面量约 638、668 行与 `task_fields_serialize_as_camel_case` 的键清单）
- Modify: `src-tauri/src/repositories.rs`（`TASK_COLUMNS` 22-24 行；`task_from_row` 116-139 行；`tasks::insert`；`tasks::update` 约 279-299 行；`sample_task` 约 1532 行）
- Modify: `src-tauri/src/services.rs`（`create_task_in_tx` 约 282-345 行；`update_task` 约 350-392 行；`spawn_next_instance` 的 `NewTask` 字面量约 127 行；测试工厂 `make_task` / `make_task_in` 约 1374、3098 行）
- Modify: `docs/PRD.md`（§2.1 任务模型字段表加「复杂度」行）
- Test: `src-tauri/src/services.rs`（`mod tests`）

**Interfaces:**
- Consumes: Task 1 的 `tasks.complexity` 列
- Produces: `Task.complexity: Option<i64>`、`NewTask.complexity: Option<i64>`、`UpdateTask.complexity: Patch<i64>`；`services::validated_complexity(value: Option<i64>) -> Result<Option<i64>, AppError>`

- [ ] **Step 1: 写失败的测试**

`src-tauri/src/services.rs` 的 `mod tests` 内追加：

```rust
    #[test]
    fn complexity_roundtrips_and_rejects_out_of_range() {
        let conn = conn();
        let task = create_task(
            &conn,
            NewTask {
                complexity: Some(4),
                ..make_new_task("有复杂度")
            },
        )
        .unwrap();
        assert_eq!(task.complexity, Some(4));
        assert_eq!(tasks::get(&conn, task.id).unwrap().unwrap().complexity, Some(4));

        // Patch semantics: missing leaves the value, explicit null clears it.
        let renamed = update_task(
            &conn,
            task.id,
            UpdateTask {
                title: Some("改名".into()),
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Unchanged,
                complexity: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(renamed.complexity, Some(4), "missing complexity must not clear it");

        let cleared = update_task(
            &conn,
            task.id,
            UpdateTask {
                title: None,
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Unchanged,
                complexity: Patch::Set(None),
            },
        )
        .unwrap();
        assert_eq!(cleared.complexity, None);

        assert_eq!(
            update_task(
                &conn,
                task.id,
                UpdateTask {
                    title: None,
                    note: Patch::Unchanged,
                    priority: None,
                    project_id: Patch::Unchanged,
                    column_id: Patch::Unchanged,
                    due_at: Patch::Unchanged,
                    completed_at: Patch::Unchanged,
                    tag_ids: None,
                    repeat_rule: Patch::Unchanged,
                    complexity: Patch::Set(Some(6)),
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );
        assert_eq!(
            create_task(
                &conn,
                NewTask {
                    complexity: Some(0),
                    ..make_new_task("越界")
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );
    }
```

> 这里**不**给 `UpdateTask` 加 `#[derive(Default)]`：`Patch<T>` 的 `Default` 带 `T: Default` 约束，而 `RepeatRule` 没有实现 `Default`，加了会编译不过。照现有测试的写法把 10 个字段写全即可。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test complexity_roundtrips_and_rejects_out_of_range`
Expected: 编译失败 —— `struct NewTask has no field named complexity` / `no function make_new_task`

- [ ] **Step 3: 模型层**

`src-tauri/src/models.rs`：

```rust
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
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}
```

`NewTask` 加 `pub complexity: Option<i64>,`（放在 `due_at` 之后）；`UpdateTask` 加 `#[serde(default)] pub complexity: Patch<i64>,`（放在 `due_at` 之后）。`UpdateTask` 的其它 derive 保持不变——不要加 `Default`，理由见 Step 1 末尾。

同一文件 `mod tests` 里两处 `Task { .. }` 字面量补 `complexity: None,`；`task_fields_serialize_as_camel_case` 的 `sorted_keys` 期望数组补 `"complexity"`（按字母序排在 `"completedAt"` 与 `"createdAt"` 之间）。

- [ ] **Step 4: 仓储层**

`src-tauri/src/repositories.rs`：

```rust
const TASK_COLUMNS: &str = "id, project_id, title, note, priority, column_id, due_at, \
                            completed_at, repeat_rule, complexity, sort_order, created_at, \
                            updated_at, deleted_at";
```

`task_from_row` 在 `repeat_rule` 之后加 `complexity: row.get("complexity")?,`。

`tasks::insert` 的列清单加 `complexity`（放在 `repeat_rule` 之后），占位符顺延为 `?14`，`params![]` 在 `repeat_rule_as_json(...)` 之后加 `task.complexity,`。

`tasks::update` 的 `SET` 加 `complexity = ?9`，其余占位符顺延：

```rust
            "UPDATE tasks SET project_id = ?1, title = ?2, note = ?3, priority = ?4, \
             column_id = ?5, due_at = ?6, completed_at = ?7, repeat_rule = ?8, \
             complexity = ?9, sort_order = ?10, updated_at = ?11 \
             WHERE id = ?12 AND deleted_at IS NULL",
```

`sample_task` 工厂补 `complexity: None,`。

- [ ] **Step 5: 服务层**

`src-tauri/src/services.rs` 加校验函数（放在 `validate_repeat_rule` 之后）：

```rust
/// Complexity is a 1-5 estimate or `None`; anything else is a client bug.
fn validated_complexity(value: Option<i64>) -> Result<Option<i64>, AppError> {
    match value {
        Some(level) if !(1..=5).contains(&level) => {
            Err(AppError::Validation("复杂度需在 1-5 之间".into()))
        }
        other => Ok(other),
    }
}
```

`create_task_in_tx` 里，`let now = Utc::now();` 之后加：

```rust
    let complexity = validated_complexity(input.complexity)?;
```

并在构造的 `Task { .. }` 里加 `complexity,`。

`update_task` 里，`due_at` 那一段之后加：

```rust
    if let Patch::Set(complexity) = patch.complexity {
        task.complexity = validated_complexity(complexity)?;
    }
```

`spawn_next_instance` 的 `NewTask { .. }` 字面量加 `complexity: task.complexity,`（重复实例继承复杂度）。

测试工厂 `make_task` / `make_task_in` 的 `NewTask { .. }` 字面量加 `complexity: None,`；再新增计划里用到的简写工厂（放在 `make_task` 之后）：

```rust
    /// `NewTask` with everything unset but the title, for tests that only care
    /// about one field: `NewTask { complexity: Some(4), ..make_new_task("x") }`.
    fn make_new_task(title: &str) -> NewTask {
        NewTask {
            title: title.into(),
            note: None,
            priority: None,
            project_id: None,
            column_id: None,
            due_at: None,
            tag_ids: Vec::new(),
            subtask_titles: Vec::new(),
            repeat_rule: None,
            complexity: None,
        }
    }
```

其余出现 `NewTask { .. }` / `UpdateTask { .. }` 字面量的测试（约 1438、1473、1495、1556、1599、1622、3106 行）各补一行 `complexity: None,` 或 `complexity: Patch::Unchanged,`；`cargo check` 会逐个点名，照着报错补即可。

- [ ] **Step 6: 跑测试**

Run: `cd src-tauri && cargo test complexity_roundtrips_and_rejects_out_of_range`
Expected: PASS

- [ ] **Step 7: 全量 Rust 测试**

Run: `cd src-tauri && cargo test`
Expected: 全部 PASS（若失败，基本都是漏补字段的字面量）

- [ ] **Step 8: 更新 PRD**

`docs/PRD.md` §2.1 的任务模型字段表在「截止时间」之后加一行：

```markdown
| 复杂度 | 1–5 的难度估计，未评估时为空 | 否 |
```

- [ ] **Step 9: 提交**

```bash
git add src-tauri/src/models.rs src-tauri/src/repositories.rs src-tauri/src/services.rs docs/PRD.md
git commit -m "feat: give tasks a complexity estimate"
```

---

### Task 3: 子任务四属性全链路 + 重复实例照抄

**Files:**
- Modify: `src-tauri/src/models.rs`（`Subtask` 约 133-145 行、`NewSubtask` 约 407 行、`UpdateSubtask` 约 411-416 行；`mod tests` 的 `Subtask { .. }` 字面量约 784 行与键清单）
- Modify: `src-tauri/src/repositories.rs`（`SUBTASK_COLUMNS` 26-27 行；`subtask_from_row` 152-163 行；`subtasks::insert` / `subtasks::update`；`sample_subtask` 约 1561 行）
- Modify: `src-tauri/src/services.rs`（`create_task_in_tx` 的初始子任务循环约 322-342 行；`create_subtask` 约 500-535 行；`update_subtask` 约 537-554 行；`complete_subtask` 约 557-566 行；`spawn_next_instance` 约 96-140 行）
- Modify: `docs/PRD.md`（§2.1 子任务段落）
- Test: `src-tauri/src/services.rs`（`mod tests`）

**Interfaces:**
- Consumes: Task 1 的四个子任务列；Task 2 的 `validated_complexity`；既有的 `next_due(due, rule)`
- Produces: `Subtask.{note, priority, due_at, complexity}`；`NewSubtask.{note, priority, due_at, complexity}`；`UpdateSubtask.{note, priority, due_at, complexity}`

- [ ] **Step 1: 写失败的测试**

`src-tauri/src/services.rs` 的 `mod tests` 内追加：

```rust
    #[test]
    fn subtask_attributes_roundtrip_and_patch_semantics_hold() {
        let conn = conn();
        let task = make_task(&conn, "父任务");
        let due = Utc.with_ymd_and_hms(2026, 9, 20, 9, 0, 0).unwrap();

        let subtask = create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "收集数据".into(),
                note: Some("先拉近三个月".into()),
                priority: Some(Priority::High),
                due_at: Some(due),
                complexity: Some(2),
            },
        )
        .unwrap();
        assert_eq!(subtask.note.as_deref(), Some("先拉近三个月"));
        assert_eq!(subtask.priority, Priority::High);
        assert_eq!(subtask.due_at, Some(due));
        assert_eq!(subtask.complexity, Some(2));

        // Missing fields stay, explicit null clears (same Patch rules as tasks).
        let renamed = update_subtask(
            &conn,
            subtask.id,
            UpdateSubtask {
                title: Some("收集数据 v2".into()),
                done: None,
                note: Patch::Unchanged,
                priority: None,
                due_at: Patch::Unchanged,
                complexity: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(renamed.title, "收集数据 v2");
        assert_eq!(renamed.note.as_deref(), Some("先拉近三个月"));
        assert_eq!(renamed.complexity, Some(2));

        let cleared = update_subtask(
            &conn,
            subtask.id,
            UpdateSubtask {
                title: None,
                done: None,
                note: Patch::Set(None),
                priority: None,
                due_at: Patch::Set(None),
                complexity: Patch::Set(None),
            },
        )
        .unwrap();
        assert_eq!(cleared.note, None);
        assert_eq!(cleared.due_at, None);
        assert_eq!(cleared.complexity, None);
        assert_eq!(cleared.priority, Priority::High, "priority is not nullable");

        assert_eq!(
            update_subtask(
                &conn,
                subtask.id,
                UpdateSubtask {
                    title: None,
                    done: None,
                    note: Patch::Unchanged,
                    priority: None,
                    due_at: Patch::Unchanged,
                    complexity: Patch::Set(Some(9)),
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );

        // A subtask created through the bare-title path takes the defaults.
        let plain = create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "默认值".into(),
                note: None,
                priority: None,
                due_at: None,
                complexity: None,
            },
        )
        .unwrap();
        assert_eq!(plain.priority, Priority::None);
        assert_eq!(plain.complexity, None);
    }

    #[test]
    fn repeat_instance_copies_subtask_attributes_and_shifts_their_dates() {
        let conn = conn();
        let due = Utc.with_ymd_and_hms(2026, 9, 20, 9, 0, 0).unwrap();
        let task = create_task(
            &conn,
            NewTask {
                due_at: Some(due),
                repeat_rule: Some(RepeatRule {
                    freq: RepeatFreq::Weekly,
                    interval: 1,
                    paused: false,
                }),
                ..make_new_task("每周复盘")
            },
        )
        .unwrap();
        let subtask = create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "整理指标".into(),
                note: Some("看漏斗".into()),
                priority: Some(Priority::Low),
                due_at: Some(due),
                complexity: Some(3),
            },
        )
        .unwrap();
        complete_subtask(&conn, subtask.id, true).unwrap();

        let next = complete_task(&conn, task.id).unwrap();
        assert!(next.completed_at.is_some());

        let spawned = list_tasks(&conn)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.task.id != task.id)
            .expect("the repeat instance must exist")
            .task;
        let copied = list_subtasks(&conn, spawned.id).unwrap();
        assert_eq!(copied.len(), 1);
        assert_eq!(copied[0].note.as_deref(), Some("看漏斗"));
        assert_eq!(copied[0].priority, Priority::Low);
        assert_eq!(copied[0].complexity, Some(3));
        assert!(!copied[0].done, "a fresh instance starts uncompleted");
        assert_eq!(
            copied[0].due_at,
            Some(due + chrono::Duration::weeks(1)),
            "a copied subtask's due date advances with the parent"
        );
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test subtask_attributes_roundtrip_and_patch_semantics_hold`
Expected: 编译失败 —— `struct NewSubtask has no field named note`

- [ ] **Step 3: 模型层**

`src-tauri/src/models.rs`：

```rust
pub struct Subtask {
    pub id: Uuid,
    pub task_id: Uuid,
    pub title: String,
    /// Free-form description; `None` when unset.
    pub note: Option<String>,
    pub priority: Priority,
    pub due_at: Option<DateTime<Utc>>,
    /// 1-5, or `None` when never estimated.
    pub complexity: Option<i64>,
    pub done: bool,
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}
```

`NewSubtask` 与 `UpdateSubtask`：

```rust
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSubtask {
    pub title: String,
    pub note: Option<String>,
    pub priority: Option<Priority>,
    pub due_at: Option<DateTime<Utc>>,
    pub complexity: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSubtask {
    pub title: Option<String>,
    pub done: Option<bool>,
    #[serde(default)]
    pub note: Patch<String>,
    pub priority: Option<Priority>,
    #[serde(default)]
    pub due_at: Patch<DateTime<Utc>>,
    #[serde(default)]
    pub complexity: Patch<i64>,
}
```

`models.rs` 的 `mod tests` 里 `Subtask { .. }` 字面量补四个字段，`subtask_fields_serialize_as_camel_case` 的键清单补 `"complexity"`、`"dueAt"`、`"note"`、`"priority"`（数组本身看起来是按字母序，照该测试的写法排）。

- [ ] **Step 4: 仓储层**

`src-tauri/src/repositories.rs`：

```rust
const SUBTASK_COLUMNS: &str = "id, task_id, title, note, priority, due_at, complexity, done, \
                               sort_order, created_at, updated_at, deleted_at";
```

`subtask_from_row`：

```rust
fn subtask_from_row(row: &Row<'_>) -> Result<Subtask, AppError> {
    let priority_text: String = row.get("priority")?;
    Ok(Subtask {
        id: parse_uuid(row.get("id")?)?,
        task_id: parse_uuid(row.get("task_id")?)?,
        title: row.get("title")?,
        note: row.get("note")?,
        priority: priority_from_text(&priority_text)?,
        due_at: row.get("due_at")?,
        complexity: row.get("complexity")?,
        done: row.get("done")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}
```

`subtasks::insert` / `subtasks::update` 按同样顺序加列（insert 用 `priority_as_text(subtask.priority)`），`sample_subtask` 工厂补四个字段的默认值。

- [ ] **Step 5: 服务层**

`create_task_in_tx` 的初始子任务循环里，`Subtask { .. }` 字面量补默认值：

```rust
                note: None,
                priority: Priority::None,
                due_at: None,
                complexity: None,
```

`create_subtask`：在 `let title = validated_name(&input.title)?;` 之后加

```rust
    let complexity = validated_complexity(input.complexity)?;
```

构造的 `Subtask { .. }` 补：

```rust
        note: input.note,
        priority: input.priority.unwrap_or(Priority::None),
        due_at: input.due_at,
        complexity,
```

`update_subtask` 加四个 patch 分支（放在 `done` 之后）：

```rust
    if let Patch::Set(note) = patch.note {
        subtask.note = note;
    }
    if let Some(priority) = patch.priority {
        subtask.priority = priority;
    }
    if let Patch::Set(due_at) = patch.due_at {
        subtask.due_at = due_at;
    }
    if let Patch::Set(complexity) = patch.complexity {
        subtask.complexity = validated_complexity(complexity)?;
    }
```

`complete_subtask` 的 `UpdateSubtask { title, done }` 字面量补 `note: Patch::Unchanged, priority: None, due_at: Patch::Unchanged, complexity: Patch::Unchanged,`。

`spawn_next_instance`：删掉现在的 `subtask_titles` 收集，改成读完整行之后再复制。函数体的 `let Some(due) = task.due_at else { .. };` 之后：

```rust
    // Copies keep the subtask's attributes; `due_at` advances by the same
    // period as the parent (a copy whose date stayed put would be born
    // overdue). Dependency edges are deliberately NOT inherited: they would
    // point at the previous instance's rows.
    let originals = subtasks::list_by_task(conn, task.id)?;
```

`NewTask { .. }` 里的 `subtask_titles,` 改成 `subtask_titles: Vec::new(),`，并把 `create_task_in_tx(...)?;` 改成接收返回值：

```rust
    let spawned = create_task_in_tx(
        conn,
        NewTask {
            // ...unchanged fields...
            subtask_titles: Vec::new(),
            complexity: task.complexity,
        },
    )?;

    let mut last_key: Option<String> = None;
    for original in originals {
        let key = match &last_key {
            None => sort::first(),
            Some(last) => sort::after(last)?,
        };
        subtasks::insert(
            conn,
            &Subtask {
                id: Uuid::new_v4(),
                task_id: spawned.id,
                title: original.title,
                note: original.note,
                priority: original.priority,
                due_at: original.due_at.map(|date| next_due(date, &rule)),
                complexity: original.complexity,
                done: false,
                sort_order: key.clone(),
                created_at: spawned.created_at,
                updated_at: spawned.created_at,
                deleted_at: None,
            },
        )?;
        last_key = Some(key);
    }
    Ok(())
```

其余 `NewSubtask { .. }` / `Subtask { .. }` 字面量（测试里的 `make_subtask`、约 1738、1763、1857、1867、1900、3513 行）补新字段；`cargo check` 逐个点名。

- [ ] **Step 6: 跑测试**

Run: `cd src-tauri && cargo test subtask_`
Expected: PASS（含新用例与既有的子任务用例）

- [ ] **Step 7: 更新 PRD**

`docs/PRD.md` §2.1 的「子任务」段落改成（替换原来那两条 bullet）：

```markdown
- 任务可包含多级子任务（至少支持一级，v1 可限制为一级）。
- 子任务具备标题、描述、优先级、截止日期、复杂度、独立完成状态与排序；父任务可展示子任务完成进度。子任务截止日期同样触发提前提醒与到期提醒。
- 子任务之间可设置前置关系（见「依赖与完成顺序」），任务列表按层级展示子任务：父任务行可展开/收起，折叠时显示子任务完成进度（`已完成/总数`）。筛选与排序仍只作用于顶级任务——把某个父任务的子任务筛掉会让进度数字与可见行数不一致。
```

- [ ] **Step 8: 提交**

```bash
git add src-tauri/src/models.rs src-tauri/src/repositories.rs src-tauri/src/services.rs docs/PRD.md
git commit -m "feat: give subtasks a description, priority, due date and complexity"
```

---

### Task 4: 依赖边后端（模型 + 仓储 + 四条校验 + 三个命令）

**Files:**
- Modify: `src-tauri/src/models.rs`（在 `TaskTagLink` 附近加依赖模型）
- Modify: `src-tauri/src/repositories.rs`（在 `pub mod reminders` 之前新增 `pub mod dependencies`）
- Modify: `src-tauri/src/services.rs`（在 `reorder_subtask` 之后加三个函数）
- Modify: `src-tauri/src/commands.rs`（在 `subtask:reorder` 之后加 `dependency:*`）
- Modify: `src-tauri/src/lib.rs`（`invoke_handler` 清单）
- Modify: `docs/ARCHITECTURE.md`（§3.2 命令清单 + 依赖语义）
- Modify: `docs/PRD.md`（§2.1 新增「依赖与完成顺序」小节）
- Test: `src-tauri/src/services.rs`（`mod tests`）

**Interfaces:**
- Consumes: Task 1 的两张边表；既有的 `query_all` / `query_one` / `parse_uuid` / `not_found`
- Produces: `models::{Dependency, DependencyKind}`；`repositories::dependencies::{insert, remove, creates_cycle, list_live, list_all}`；`services::{list_dependencies, add_dependency, remove_dependency}`；Tauri 命令 `dependency:listAll` / `dependency:add` / `dependency:remove`

- [ ] **Step 1: 写失败的测试**

`src-tauri/src/services.rs` 的 `mod tests` 内追加：

```rust
    #[test]
    fn dependencies_are_added_idempotently_and_listed_live_only() {
        let conn = conn();
        let a = make_task(&conn, "A");
        let b = make_task(&conn, "B");

        let edge = add_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        assert_eq!(edge.prerequisite_id, b.id);
        // Adding the same edge twice is a no-op, not an error.
        add_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 1);

        // Soft-deleting the prerequisite hides the edge (A is no longer blocked)
        // but keeps it in the table: restoring brings the relation back.
        soft_delete_task(&conn, b.id).unwrap();
        assert!(list_dependencies(&conn).unwrap().is_empty());
        restore_task(&conn, b.id).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 1);

        // Removing is idempotent too.
        remove_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        remove_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        assert!(list_dependencies(&conn).unwrap().is_empty());
    }

    #[test]
    fn dependency_edges_are_scoped_and_acyclic() {
        let conn = conn();
        let a = make_task(&conn, "A");
        let b = make_task(&conn, "B");
        let c = make_task(&conn, "C");

        // A → B → C, then C → A would close a three-node cycle.
        add_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        add_dependency(&conn, dependency(DependencyKind::Task, b.id, c.id)).unwrap();
        assert_eq!(
            add_dependency(&conn, dependency(DependencyKind::Task, c.id, a.id))
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            add_dependency(&conn, dependency(DependencyKind::Task, a.id, a.id))
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            add_dependency(&conn, dependency(DependencyKind::Task, a.id, Uuid::new_v4()))
                .unwrap_err()
                .code(),
            "not_found"
        );

        // Subtask edges must stay inside one parent task.
        let other = make_task(&conn, "D");
        let first = make_subtask(&conn, a.id, "1");
        let second = make_subtask(&conn, a.id, "2");
        let foreign = make_subtask(&conn, other.id, "x");
        add_dependency(&conn, dependency(DependencyKind::Subtask, first.id, second.id)).unwrap();
        assert_eq!(
            add_dependency(&conn, dependency(DependencyKind::Subtask, first.id, foreign.id))
                .unwrap_err()
                .code(),
            "validation"
        );
        // A subtask edge does not leak into the task graph.
        assert_eq!(list_dependencies(&conn).unwrap().len(), 3);
        assert_eq!(
            list_dependencies(&conn)
                .unwrap()
                .iter()
                .filter(|edge| edge.kind == DependencyKind::Subtask)
                .count(),
            1
        );
    }
```

并在 `mod tests` 顶部加一个构造依赖的小工厂：

```rust
    fn dependency(kind: DependencyKind, dependent_id: Uuid, prerequisite_id: Uuid) -> Dependency {
        Dependency {
            kind,
            dependent_id,
            prerequisite_id,
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test dependencies_are_added_idempotently`
Expected: 编译失败 —— `cannot find type DependencyKind in this scope`

- [ ] **Step 3: 模型**

`src-tauri/src/models.rs`（放在 `TaskTagLink` 之前）：

```rust
/// Which edge table a dependency lives in — tasks depend on tasks, subtasks on
/// their siblings inside one parent task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DependencyKind {
    Task,
    Subtask,
}

/// One dependency edge: `prerequisite_id` must be finished before
/// `dependent_id` can be completed. The reverse relation ("who is waiting for
/// me") is read off the same rows, never stored twice.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub kind: DependencyKind,
    pub dependent_id: Uuid,
    pub prerequisite_id: Uuid,
}
```

- [ ] **Step 4: 仓储**

`src-tauri/src/repositories.rs`：在 `pub mod reminders` 之前插入（`models` 的 `use` 清单同时加 `Dependency, DependencyKind`）：

```rust
/// Dependency edges (`task_dependencies` / `subtask_dependencies`).
///
/// The two tables have the same shape, so the table and column names are
/// resolved from the kind and interpolated into otherwise identical SQL — both
/// values are compile-time constants, never user input.
pub mod dependencies {
    use super::*;

    fn edge_table(kind: DependencyKind) -> (&'static str, &'static str) {
        match kind {
            DependencyKind::Task => ("task_dependencies", "task_id"),
            DependencyKind::Subtask => ("subtask_dependencies", "subtask_id"),
        }
    }

    fn task_edge(row: &Row<'_>) -> Result<Dependency, AppError> {
        Ok(Dependency {
            kind: DependencyKind::Task,
            dependent_id: parse_uuid(row.get("task_id")?)?,
            prerequisite_id: parse_uuid(row.get("depends_on")?)?,
        })
    }

    fn subtask_edge(row: &Row<'_>) -> Result<Dependency, AppError> {
        Ok(Dependency {
            kind: DependencyKind::Subtask,
            dependent_id: parse_uuid(row.get("subtask_id")?)?,
            prerequisite_id: parse_uuid(row.get("depends_on")?)?,
        })
    }

    /// Adds one edge; an existing `(dependent, prerequisite)` pair is a no-op
    /// (the composite primary key dedups via `INSERT OR IGNORE`).
    pub fn insert(
        conn: &Connection,
        kind: DependencyKind,
        dependent_id: Uuid,
        prerequisite_id: Uuid,
        at: DateTime<Utc>,
    ) -> Result<(), AppError> {
        let (table, column) = edge_table(kind);
        conn.execute(
            &format!(
                "INSERT OR IGNORE INTO {table} ({column}, depends_on, created_at) \
                 VALUES (?1, ?2, ?3)"
            ),
            params![dependent_id.to_string(), prerequisite_id.to_string(), at],
        )?;
        Ok(())
    }

    /// Deletes one edge; a missing edge is a no-op, so the command is
    /// idempotent like the client's optimistic update assumes.
    pub fn remove(
        conn: &Connection,
        kind: DependencyKind,
        dependent_id: Uuid,
        prerequisite_id: Uuid,
    ) -> Result<(), AppError> {
        let (table, column) = edge_table(kind);
        conn.execute(
            &format!("DELETE FROM {table} WHERE {column} = ?1 AND depends_on = ?2"),
            params![dependent_id.to_string(), prerequisite_id.to_string()],
        )?;
        Ok(())
    }

    /// Whether adding `dependent → prerequisite` would close a cycle: start at
    /// the prerequisite and walk *its* prerequisites; if the dependent turns up,
    /// the new edge would close the loop.
    ///
    /// `UNION` (not `UNION ALL`) dedups the recursive step, which also bounds
    /// the walk if a cycle ever reached the table by another route.
    pub fn creates_cycle(
        conn: &Connection,
        kind: DependencyKind,
        dependent_id: Uuid,
        prerequisite_id: Uuid,
    ) -> Result<bool, AppError> {
        let (table, column) = edge_table(kind);
        let sql = format!(
            "WITH RECURSIVE chain(id) AS ( \
                 SELECT ?1 \
                 UNION \
                 SELECT d.depends_on FROM {table} d JOIN chain ON d.{column} = chain.id \
             ) SELECT EXISTS(SELECT 1 FROM chain WHERE id = ?2)"
        );
        query_one(conn, &sql, params![
            prerequisite_id.to_string(),
            dependent_id.to_string()
        ], |row| row.get::<_, bool>(0))
        .map(|value| value.unwrap_or(false))
    }

    /// Every edge whose endpoints are both live — what `dependency:listAll`
    /// returns. Soft-deleted endpoints are filtered out rather than their edges
    /// deleted, so deleting a prerequisite unblocks its dependents and
    /// restoring it brings the relation back.
    pub fn list_live(conn: &Connection) -> Result<Vec<Dependency>, AppError> {
        let mut edges = query_all(
            conn,
            "SELECT task_id, depends_on FROM task_dependencies d \
             WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NULL) \
               AND depends_on IN (SELECT id FROM tasks WHERE deleted_at IS NULL) \
             ORDER BY task_id, depends_on",
            &[],
            task_edge,
        )?;
        edges.extend(query_all(
            conn,
            "SELECT subtask_id, depends_on FROM subtask_dependencies d \
             WHERE subtask_id IN (SELECT id FROM subtasks WHERE deleted_at IS NULL) \
               AND depends_on IN (SELECT id FROM subtasks WHERE deleted_at IS NULL) \
               AND subtask_id IN (SELECT s.id FROM subtasks s JOIN tasks t ON t.id = s.task_id \
                                   WHERE t.deleted_at IS NULL) \
             ORDER BY subtask_id, depends_on",
            &[],
            subtask_edge,
        )?);
        Ok(edges)
    }

    /// Every edge, soft-deleted endpoints included: a backup is a copy of the
    /// database, not a view of it.
    pub fn list_all(conn: &Connection) -> Result<Vec<Dependency>, AppError> {
        let mut edges = query_all(
            conn,
            "SELECT task_id, depends_on FROM task_dependencies ORDER BY task_id, depends_on",
            &[],
            task_edge,
        )?;
        edges.extend(query_all(
            conn,
            "SELECT subtask_id, depends_on FROM subtask_dependencies \
             ORDER BY subtask_id, depends_on",
            &[],
            subtask_edge,
        )?);
        Ok(edges)
    }
}
```

> 子任务那条 `list_live` 只校验依赖方一侧的父任务：写入侧的「同父」校验保证了另一端同属一个任务，而 `subtasks.task_id` 创建后不会再变。

- [ ] **Step 5: 服务**

`src-tauri/src/services.rs`（`use crate::models::{...}` 加 `Dependency, DependencyKind`；`use crate::repositories::{...}` 加 `dependencies`），在 `reorder_subtask` 之后插入：

```rust
// ---------------------------------------------------------------------------
// Dependency edges
// ---------------------------------------------------------------------------

/// Every live dependency edge; the frontend derives blocked state from these.
pub fn list_dependencies(conn: &Connection) -> Result<Vec<Dependency>, AppError> {
    dependencies::list_live(conn)
}

/// Adds `dependent → prerequisite` after validating it. Idempotent: adding an
/// edge that already exists returns it unchanged.
pub fn add_dependency(conn: &Connection, input: Dependency) -> Result<Dependency, AppError> {
    validate_dependency(conn, input.kind, input.dependent_id, input.prerequisite_id)?;
    dependencies::insert(
        conn,
        input.kind,
        input.dependent_id,
        input.prerequisite_id,
        Utc::now(),
    )?;
    Ok(input)
}

pub fn remove_dependency(conn: &Connection, input: Dependency) -> Result<(), AppError> {
    dependencies::remove(conn, input.kind, input.dependent_id, input.prerequisite_id)
}

/// The four rules an edge must satisfy: both endpoints live, subtask edges
/// inside one parent task, no self-reference, and no cycles. The frontend also
/// filters cyclic candidates out of its picker, but that is a convenience —
/// this check is the authority.
fn validate_dependency(
    conn: &Connection,
    kind: DependencyKind,
    dependent_id: Uuid,
    prerequisite_id: Uuid,
) -> Result<(), AppError> {
    if dependent_id == prerequisite_id {
        return Err(AppError::Validation("不能依赖自身".into()));
    }
    match kind {
        DependencyKind::Task => {
            if tasks::get(conn, dependent_id)?.is_none() {
                return Err(not_found("任务", dependent_id));
            }
            if tasks::get(conn, prerequisite_id)?.is_none() {
                return Err(not_found("任务", prerequisite_id));
            }
        }
        DependencyKind::Subtask => {
            let dependent = subtasks::get(conn, dependent_id)?
                .ok_or_else(|| not_found("子任务", dependent_id))?;
            let prerequisite = subtasks::get(conn, prerequisite_id)?
                .ok_or_else(|| not_found("子任务", prerequisite_id))?;
            if dependent.task_id != prerequisite.task_id {
                return Err(AppError::Validation("子任务依赖需在同一个任务内".into()));
            }
        }
    }
    if dependencies::creates_cycle(conn, kind, dependent_id, prerequisite_id)? {
        return Err(AppError::Validation("会形成循环依赖".into()));
    }
    Ok(())
}
```

- [ ] **Step 6: 命令**

`src-tauri/src/commands.rs`（`use crate::models::{...}` 加 `Dependency`），在 `subtask:reorder` 之后：

```rust
// --- dependency:* ----------------------------------------------------------

#[tauri::command(rename = "dependency:listAll")]
pub fn dependency_list_all(db: State<'_, Db>) -> Result<Vec<Dependency>, AppError> {
    with_conn(&db, services::list_dependencies)
}

#[tauri::command(rename = "dependency:add")]
pub fn dependency_add(db: State<'_, Db>, payload: Dependency) -> Result<Dependency, AppError> {
    with_conn(&db, |conn| services::add_dependency(conn, payload))
}

#[tauri::command(rename = "dependency:remove")]
pub fn dependency_remove(db: State<'_, Db>, payload: Dependency) -> Result<(), AppError> {
    with_conn(&db, |conn| services::remove_dependency(conn, payload))
}
```

`src-tauri/src/lib.rs` 的 `invoke_handler` 清单在 `commands::subtask_reorder,` 之后加：

```rust
            commands::dependency_list_all,
            commands::dependency_add,
            commands::dependency_remove,
```

- [ ] **Step 7: 跑测试**

Run: `cd src-tauri && cargo test dependency`
Expected: PASS（两个新用例）

- [ ] **Step 8: 文档**

`docs/ARCHITECTURE.md`：
- §3.2 的 IPC 命令清单加三个 `dependency:*` 命令及其参数/返回；
- 依赖语义小节写清：边方向「依赖方 → 前置」、四条校验、环检测用递归 CTE、**软删除不删边**（端点被软删时该边从 `listAll` 消失 ⇒ 被阻塞方自动解锁，恢复后自动回来）、以及「`sort_order`（显示顺序）与依赖（可执行顺序）互相独立」。

`docs/PRD.md` §2.1 在「任务视图」之前加：

```markdown
**依赖与完成顺序：**

- 任务之间、同一任务下的子任务之间可设置前置关系（「B 完成前 A 被阻塞」）；任务级依赖可跨项目，子任务依赖限同一父任务内。
- 循环依赖被拒绝；同一前置重复添加、删除不存在的依赖都是幂等的。
- 被阻塞的任务/子任务在列表上显示「阻塞中」并给出还差几项；点击完成时先确认一次（软阻塞，不禁止完成），确认后照常完成。
- 前置被删除（软删除）时依赖自动解除，恢复前置后依赖随之恢复。
```

- [ ] **Step 9: 提交**

```bash
git add src-tauri/src/models.rs src-tauri/src/repositories.rs src-tauri/src/services.rs src-tauri/src/commands.rs src-tauri/src/lib.rs docs/ARCHITECTURE.md docs/PRD.md
git commit -m "feat: add task and subtask dependency edges"
```

---

### Task 5: 备份携带依赖边

**Files:**
- Modify: `src-tauri/src/models.rs`（`BackupData` 约 205-230 行及其文档注释）
- Modify: `src-tauri/src/repositories.rs`（`backup::export_all` 约 1357 行、`backup::replace_all` 约 1403 行）
- Modify: `src-tauri/src/services.rs`（`BACKUP_VERSION` 约 1087 行）
- Test: `src-tauri/src/services.rs`（`mod tests`，备份用例附近）

**Interfaces:**
- Consumes: Task 4 的 `repositories::dependencies::list_all`
- Produces: `BackupData.dependencies: Vec<Dependency>`；`BACKUP_VERSION = 2`

- [ ] **Step 1: 写失败的测试**

`src-tauri/src/services.rs` 的 `mod tests` 内追加（备份用例附近）：

```rust
    #[test]
    fn backup_roundtrips_dependency_edges() {
        let conn = conn();
        let a = make_task(&conn, "A");
        let b = make_task(&conn, "B");
        let first = make_subtask(&conn, a.id, "1");
        let second = make_subtask(&conn, a.id, "2");
        add_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        add_dependency(&conn, dependency(DependencyKind::Subtask, first.id, second.id)).unwrap();

        let path = std::env::temp_dir().join(format!("ordo-backup-{}.json", Uuid::new_v4()));
        export_backup(&conn, &path).unwrap();

        // Wiping the edges (rather than the whole database) keeps this test
        // focused: the import has to restore them from the document.
        remove_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        remove_dependency(&conn, dependency(DependencyKind::Subtask, first.id, second.id)).unwrap();
        assert!(list_dependencies(&conn).unwrap().is_empty());

        import_backup(&conn, &path).unwrap();
        let restored = list_dependencies(&conn).unwrap();
        assert_eq!(restored.len(), 2);
        assert!(restored.iter().any(|edge| edge.kind == DependencyKind::Task));
        assert!(restored.iter().any(|edge| edge.kind == DependencyKind::Subtask));

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn version_one_backups_still_import() {
        let conn = conn();
        // A v1 document predates `dependencies`; `#[serde(default)]` must let it
        // through instead of failing the whole import.
        let document = serde_json::json!({
            "format": BACKUP_FORMAT,
            "version": 1,
            "exportedAt": "2026-01-01T00:00:00Z",
            "data": {
                "projects": [], "boardColumns": [], "tags": [], "tasks": [],
                "subtasks": [], "taskTags": [], "comments": [], "timeEntries": [],
                "settings": []
            }
        });
        let path = std::env::temp_dir().join(format!("ordo-backup-{}.json", Uuid::new_v4()));
        std::fs::write(&path, serde_json::to_string(&document).unwrap()).unwrap();
        import_backup(&conn, &path).unwrap();

        std::fs::remove_file(&path).ok();
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test backup_roundtrips_dependency_edges`
Expected: 编译失败 —— `no field dependencies on type BackupData`

- [ ] **Step 3: 模型**

`src-tauri/src/models.rs` 的 `BackupData` 加字段，并更新文档注释：

```rust
/// Every user-data table, exactly as a backup carries them.
///
/// Soft-deleted rows are included on purpose: a backup is a copy of the
/// database, not a view of it — `dependencies` therefore carries edges whose
/// endpoints are soft-deleted too. `task_reminders` and `subtask_reminders`
/// stay out: those markers only dedup notifications and are rebuilt by the
/// scheduler.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupData {
    // ...existing fields...
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
}
```

- [ ] **Step 4: 仓储**

`export_all` 在 `settings:` 之前加：

```rust
            dependencies: dependencies::list_all(conn)?,
```

`replace_all`：`DELETE FROM` 清单最前面加两张边表（先删边，再删端点）：

```rust
        for table in [
            "task_dependencies",
            "subtask_dependencies",
            "task_tags",
            // ...existing entries...
        ] {
```

插入阶段放在 `for subtask in &data.subtasks { .. }` 之后（边必须在端点之后插入，否则外键报错）：

```rust
        for edge in &data.dependencies {
            dependencies::insert(
                conn,
                edge.kind,
                edge.dependent_id,
                edge.prerequisite_id,
                Utc::now(),
            )?;
        }
```

> `backup` 模块需要 `use super::dependencies;`：该模块通过 `use super::*;` 引入父模块作用域，父模块顶部已经 `use` 了 `crate::models::{Dependency, DependencyKind}`（Task 4 Step 4 加的），照 `task_tags::` 的既有写法调用即可。

- [ ] **Step 5: 升备份版本**

`src-tauri/src/services.rs`：

```rust
/// Generation of the backup format. Bumped to 2 when dependency edges joined
/// the document: an older build reading a v2 file would silently drop them,
/// so `import_backup` refuses anything newer than this value.
pub const BACKUP_VERSION: u32 = 2;
```

- [ ] **Step 6: 跑测试**

Run: `cd src-tauri && cargo test backup`
Expected: PASS（新用例 + 既有的备份用例）

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/models.rs src-tauri/src/repositories.rs src-tauri/src/services.rs
git commit -m "feat: carry dependency edges in backups"
```

---

### Task 6: 子任务截止日期进提醒

**Files:**
- Modify: `src-tauri/src/models.rs`（`Reminder` 约 72-81 行；`mod tests` 的 `reminder_payloads_serialize_as_camel_case` 约 950 行）
- Modify: `src-tauri/src/repositories.rs`（`pub mod reminders` 约 1456-1520 行）
- Modify: `src-tauri/src/services.rs`（`scan_reminders` 约 1329-1357 行）
- Modify: `src-tauri/src/scheduler.rs`（`notification_texts` 约 28-45 行；测试的 `Reminder { .. }` 字面量约 92 行）
- Modify: `docs/ARCHITECTURE.md`（提醒链路小节补子任务分支）
- Test: `src-tauri/src/services.rs`（`mod tests`）

**Interfaces:**
- Consumes: Task 1 的 `subtask_reminders` 表；既有的 `REMINDER_KIND_LEADS`、`mark_fired`、`list_candidates`、测试工厂 `make_due_task`
- Produces: `Reminder.{subtask_id, subtask_title}`；`repositories::reminders::{mark_subtask_fired, list_subtask_candidates}`

- [ ] **Step 1: 写失败的测试**

`src-tauri/src/services.rs` 的 `mod tests` 内追加：

```rust
    #[test]
    fn subtask_due_dates_fire_their_own_reminders() {
        let conn = conn();
        let base = Utc.with_ymd_and_hms(2026, 9, 11, 12, 0, 0).unwrap();
        let due = base + chrono::Duration::hours(2);
        let task = make_due_task(&conn, "父任务", due);
        let subtask = create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "收集数据".into(),
                note: None,
                priority: None,
                due_at: Some(due),
                complexity: None,
            },
        )
        .unwrap();

        let fired = scan_reminders(&conn, due - chrono::Duration::hours(1)).unwrap();
        // The task's own 1-hour reminder plus the subtask's.
        assert_eq!(fired.len(), 2);
        let subtask_hit = fired
            .iter()
            .find(|reminder| reminder.subtask_id == Some(subtask.id))
            .expect("the subtask reminder must fire");
        assert_eq!(subtask_hit.task_id, task.id, "taskId stays the parent");
        assert_eq!(subtask_hit.task_title, "父任务");
        assert_eq!(subtask_hit.subtask_title.as_deref(), Some("收集数据"));

        // The next scan fires the *next* kind, not the 1-hour one again: the
        // marker table dedups per (subtask, kind).
        let later_scan = scan_reminders(&conn, due - chrono::Duration::minutes(5)).unwrap();
        let repeats: Vec<&Reminder> = later_scan
            .iter()
            .filter(|reminder| reminder.subtask_id == Some(subtask.id))
            .collect();
        assert_eq!(repeats.len(), 1);
        assert_eq!(repeats[0].kind, ReminderKind::Advance10m);
        let later = base + chrono::Duration::hours(5);
        let second = make_due_task(&conn, "第二个父任务", later);
        let pending = create_subtask(
            &conn,
            second.id,
            NewSubtask {
                title: "写结论".into(),
                note: None,
                priority: None,
                due_at: Some(later),
                complexity: None,
            },
        )
        .unwrap();
        complete_subtask(&conn, pending.id, true).unwrap();
        assert!(
            scan_reminders(&conn, later - chrono::Duration::minutes(5))
                .unwrap()
                .iter()
                .all(|reminder| reminder.subtask_id != Some(pending.id)),
            "a done subtask must not remind"
        );
    }

    #[test]
    fn completing_the_parent_stops_its_subtask_reminders() {
        let conn = conn();
        let base = Utc.with_ymd_and_hms(2026, 9, 11, 12, 0, 0).unwrap();
        let due = base + chrono::Duration::hours(2);
        let task = make_due_task(&conn, "父任务", due);
        create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "子任务".into(),
                note: None,
                priority: None,
                due_at: Some(due),
                complexity: None,
            },
        )
        .unwrap();
        complete_task(&conn, task.id).unwrap();

        let fired = scan_reminders(&conn, due - chrono::Duration::hours(1)).unwrap();
        assert!(
            fired.iter().all(|reminder| reminder.subtask_id.is_none()),
            "a completed parent task silences its subtasks"
        );
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test subtask_due_dates_fire_their_own_reminders`
Expected: 编译失败 —— `no field subtask_id on type Reminder`

- [ ] **Step 3: 模型**

`src-tauri/src/models.rs`：

```rust
/// A reminder the scheduler has fired, broadcast to the frontend as a
/// `reminder:triggered` event.
///
/// `task_id`/`task_title` always name the owning task: for a subtask reminder
/// that is the *parent*, so the frontend's click-to-locate can open the task
/// it belongs to without a special case.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub task_id: Uuid,
    pub task_title: String,
    pub kind: ReminderKind,
    pub due_at: DateTime<Utc>,
    /// Set when this reminder belongs to a subtask rather than the task.
    #[serde(default)]
    pub subtask_id: Option<Uuid>,
    #[serde(default)]
    pub subtask_title: Option<String>,
}
```

`reminder_payloads_serialize_as_camel_case` 的键清单补 `"subtaskId"`、`"subtaskTitle"`（按该测试的字母序位置），并给字面量补 `subtask_id: None, subtask_title: None,`。

- [ ] **Step 4: 仓储**

`src-tauri/src/repositories.rs` 的 `pub mod reminders` 内在 `mark_fired` 之后加：

```rust
    /// Records that a subtask reminder fired; same dedup contract as
    /// [`mark_fired`], against its own marker table.
    pub fn mark_subtask_fired(
        conn: &Connection,
        subtask_id: Uuid,
        kind: ReminderKind,
        at: DateTime<Utc>,
    ) -> Result<bool, AppError> {
        let affected = conn.execute(
            "INSERT OR IGNORE INTO subtask_reminders (subtask_id, kind, sent_at) \
             VALUES (?1, ?2, ?3)",
            params![subtask_id.to_string(), kind_as_text(kind), at],
        )?;
        Ok(affected == 1)
    }
```

并在 `list_candidates` 之后加：

```rust
    /// A live, incomplete, due-dated subtask of a live, unfinished task.
    pub struct SubtaskReminderCandidate {
        pub id: Uuid,
        /// The parent task, for the notification's subject line.
        pub task_id: Uuid,
        pub title: String,
        pub task_title: String,
        pub due_at: DateTime<Utc>,
    }

    /// Subtasks whose reminders may be triggerable: not soft-deleted, not done,
    /// `due_at` in `(cutoff, horizon]`, under a task that is itself live and
    /// unfinished. The join is also how the parent title reaches the
    /// notification text without a second query.
    pub fn list_subtask_candidates(
        conn: &Connection,
        cutoff: DateTime<Utc>,
        horizon: DateTime<Utc>,
    ) -> Result<Vec<SubtaskReminderCandidate>, AppError> {
        query_all(
            conn,
            "SELECT s.id, s.task_id, s.title, s.due_at, t.title AS task_title \
             FROM subtasks s JOIN tasks t ON t.id = s.task_id \
             WHERE s.deleted_at IS NULL AND s.done = 0 \
               AND t.deleted_at IS NULL AND t.completed_at IS NULL \
               AND s.due_at IS NOT NULL AND s.due_at > ?1 AND s.due_at <= ?2 \
             ORDER BY s.due_at, s.id",
            params![cutoff, horizon],
            |row| {
                Ok(SubtaskReminderCandidate {
                    id: parse_uuid(row.get("id")?)?,
                    task_id: parse_uuid(row.get("task_id")?)?,
                    title: row.get("title")?,
                    task_title: row.get("task_title")?,
                    due_at: row.get("due_at")?,
                })
            },
        )
    }
```

- [ ] **Step 5: 服务**

`src-tauri/src/services.rs`：把 `scan_reminders` 的循环条件抽成一个纯函数，再跑两遍候选：

```rust
/// The reminder kinds whose lead time has arrived for `due_at`. Once a due
/// time has passed only the due reminder applies: catching up a stale "in 1
/// hour" after downtime would be noise.
fn due_kinds(now: DateTime<Utc>, due_at: DateTime<Utc>) -> Vec<ReminderKind> {
    REMINDER_KIND_LEADS
        .iter()
        .filter(|(_, lead)| now >= due_at - chrono::Duration::minutes(*lead))
        .filter(|(_, lead)| *lead == 0 || now < due_at)
        .map(|(kind, _)| *kind)
        .collect()
}

pub fn scan_reminders(conn: &Connection, now: DateTime<Utc>) -> Result<Vec<Reminder>, AppError> {
    let cutoff = now - chrono::Duration::hours(REMINDER_CATCHUP_HOURS);
    let horizon = now + chrono::Duration::hours(1);

    let tx = conn.unchecked_transaction()?;
    let mut fired = Vec::new();

    for candidate in reminders::list_candidates(conn, cutoff, horizon)? {
        for kind in due_kinds(now, candidate.due_at) {
            if reminders::mark_fired(&tx, candidate.id, kind, now)? {
                fired.push(Reminder {
                    task_id: candidate.id,
                    task_title: candidate.title.clone(),
                    kind,
                    due_at: candidate.due_at,
                    subtask_id: None,
                    subtask_title: None,
                });
            }
        }
    }

    for candidate in reminders::list_subtask_candidates(conn, cutoff, horizon)? {
        for kind in due_kinds(now, candidate.due_at) {
            if reminders::mark_subtask_fired(&tx, candidate.id, kind, now)? {
                fired.push(Reminder {
                    task_id: candidate.task_id,
                    task_title: candidate.task_title.clone(),
                    kind,
                    due_at: candidate.due_at,
                    subtask_id: Some(candidate.id),
                    subtask_title: Some(candidate.title.clone()),
                });
            }
        }
    }

    tx.commit()?;
    Ok(fired)
}
```

- [ ] **Step 6: 通知文案**

`src-tauri/src/scheduler.rs`：

```rust
fn notification_texts(reminder: &Reminder) -> (String, String) {
    let time = reminder.due_at.with_timezone(&Local).format("%H:%M");
    // A subtask reminder names both levels: the task alone would be ambiguous
    // when a task carries several dated subtasks.
    let subject = match &reminder.subtask_title {
        Some(subtask) => format!("{} › {}", reminder.task_title, subtask),
        None => reminder.task_title.clone(),
    };
    let body = match reminder.kind {
        ReminderKind::Advance1h => format!("「{subject}」将于 1 小时后（{time}）到期"),
        ReminderKind::Advance10m => format!("「{subject}」将于 10 分钟后（{time}）到期"),
        ReminderKind::Due => format!("「{subject}」已到截止时间（{time}）"),
    };
    ("Ordo 任务提醒".to_string(), body)
}
```

`scheduler.rs` 测试里的 `Reminder { .. }` 字面量补 `subtask_id: None, subtask_title: None,`；并加一条断言（放在既有文案测试之后）：

```rust
    #[test]
    fn subtask_reminders_name_the_parent_and_the_subtask() {
        let (_, body) = notification_texts(&Reminder {
            task_id: Uuid::nil(),
            task_title: "写周报".into(),
            kind: ReminderKind::Due,
            due_at: Utc.with_ymd_and_hms(2026, 9, 11, 12, 0, 0).unwrap(),
            subtask_id: Some(Uuid::nil()),
            subtask_title: Some("收集数据".into()),
        });
        assert!(body.contains("写周报 › 收集数据"), "unexpected body: {body}");
    }
```

> 若 `scheduler.rs` 的测试模块没有 import `Uuid` / `Utc`，按该文件现有的 `use` 补上（`chrono::Utc`、`uuid::Uuid`）。

- [ ] **Step 7: 跑测试**

Run: `cd src-tauri && cargo test reminder`
Expected: PASS（新增三条 + 既有的 `scan_reminders_fires_each_kind_once_at_its_lead_time`）

- [ ] **Step 8: 更新 ARCHITECTURE**

`docs/ARCHITECTURE.md` 的提醒链路小节补一句：`task_reminders` 与 `subtask_reminders` 是两张同构的去重标记表（子任务不能用前者：`WITHOUT ROWID` 的主键列不允许 NULL）；子任务提醒的候选要求父任务存活且未完成，事件里 `taskId` 始终是父任务，因此前端定位逻辑无需特殊分支。

- [ ] **Step 9: 提交**

```bash
git add src-tauri/src/models.rs src-tauri/src/repositories.rs src-tauri/src/services.rs src-tauri/src/scheduler.rs docs/ARCHITECTURE.md
git commit -m "feat: remind on subtask due dates"
```

---

### Task 7: 前端契约层（类型 / IPC / store / 纯函数）

**Files:**
- Modify: `src/features/tasks/types.ts`
- Modify: `src/common/ipc/commands.ts`
- Modify: `src/features/tasks/api.ts`
- Modify: `src/features/tasks/store.ts`
- Modify: `src/features/tasks/hooks.ts`（`loadAll`）
- Modify: `src/features/tasks/complexity.ts`（新建）
- Modify: `src/features/tasks/dependencies.ts`（新建）
- Test: `src/features/tasks/__tests__/dependencies.test.ts`（新建）、`src/features/tasks/__tests__/complexity.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2/3/4/6 的 Rust 契约
- Produces: `Task.complexity`；`Subtask.{note,priority,dueAt,complexity}`；`Dependency`、`DependencyKind`；`api.{listDependencies,addDependency,removeDependency}`；`store.{setDependencies,addDependencyEdge,removeDependencyEdge}`；`dependencies.{entityKey,buildIndex,completionSet,blockersOf,isBlocked,successorsOf,wouldCycle,edgeEquals}`；`complexity.{COMPLEXITY_OPTIONS,complexityOptionValue,complexityFromOption,complexityLabel}`

- [ ] **Step 1: 写失败的测试（纯函数）**

创建 `src/features/tasks/__tests__/dependencies.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  blockersOf,
  buildIndex,
  completionSet,
  edgeEquals,
  entityKey,
  isBlocked,
  successorsOf,
  wouldCycle,
} from "../dependencies";
import type { Dependency, Subtask, Task } from "../types";

function edge(dependentId: string, prerequisiteId: string): Dependency {
  return { kind: "task", dependentId, prerequisiteId };
}

function task(id: string, completedAt: string | null = null): Task {
  return {
    id,
    projectId: null,
    title: id,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt,
    repeatRule: null,
    tagIds: [],
    complexity: null,
    sortOrder: "a",
    createdAt: "2026-09-14T00:00:00Z",
    updatedAt: "2026-09-14T00:00:00Z",
    deletedAt: null,
  };
}

describe("dependency derivations", () => {
  // A → B → C plus the diamond A → D → C, so the walk has to survive both a
  // chain and a merge.
  const edges = [edge("A", "B"), edge("B", "C"), edge("A", "D"), edge("D", "C")];
  const index = buildIndex(edges);
  const tasks = [task("A"), task("B", "2026-09-14T10:00:00Z"), task("C"), task("D")];

  it("lists the unfinished prerequisites only", () => {
    const done = completionSet(tasks, {});
    expect(blockersOf(index, done, "task", "A")).toEqual(["B", "D"]);
    expect(blockersOf(index, done, "task", "B")).toEqual(["C"]);
    expect(isBlocked(index, done, "task", "A")).toBe(true);
    expect(isBlocked(index, done, "task", "D")).toBe(true);
  });

  it("treats a completed prerequisite as satisfied", () => {
    const done = completionSet(tasks, {});
    // B is complete, so A's only remaining blocker is D.
    expect(blockersOf(index, done, "task", "A")).toEqual(["D"]);
    expect(isBlocked(index, done, "task", "B")).toBe(true);
  });

  it("finds successors in the other direction", () => {
    expect(successorsOf(index, "task", "C")).toEqual(["B", "D"]);
    expect(successorsOf(index, "task", "A")).toEqual([]);
  });

  it("detects the edges that would close a cycle", () => {
    expect(wouldCycle(index, "task", "C", "A")).toBe(true);
    expect(wouldCycle(index, "task", "A", "A")).toBe(true);
    expect(wouldCycle(index, "task", "B", "A")).toBe(false);
    expect(wouldCycle(index, "task", "A", "E")).toBe(false);
  });

  it("keeps task and subtask graphs apart", () => {
    const mixed = buildIndex([
      { kind: "task", dependentId: "X", prerequisiteId: "Y" },
      { kind: "subtask", dependentId: "S1", prerequisiteId: "S2" },
    ]);
    expect(blockersOf(mixed, new Set(), "task", "X")).toEqual(["Y"]);
    expect(blockersOf(mixed, new Set(), "subtask", "S1")).toEqual(["S2"]);
    expect(blockersOf(mixed, new Set(), "task", "S1")).toEqual([]);
  });

  it("reads a done subtask out of the per-task cache", () => {
    const subtasks = {
      t1: [
        { id: "S1", taskId: "t1", title: "一", done: true },
        { id: "S2", taskId: "t1", title: "二", done: false },
      ] as Subtask[],
    };
    const done = completionSet([task("t1")], subtasks);
    const subIndex = buildIndex([
      { kind: "subtask", dependentId: "S2", prerequisiteId: "S1" },
    ]);
    expect(done.has(entityKey("subtask", "S1"))).toBe(true);
    expect(isBlocked(subIndex, done, "subtask", "S2")).toBe(false);
    expect(isBlocked(subIndex, done, "subtask", "S1")).toBe(false);
  });

  it("compares edges by kind and both endpoints", () => {
    expect(edgeEquals(edge("A", "B"), edge("A", "B"))).toBe(true);
    expect(edgeEquals(edge("A", "B"), edge("B", "A"))).toBe(false);
    expect(
      edgeEquals(edge("A", "B"), { kind: "subtask", dependentId: "A", prerequisiteId: "B" }),
    ).toBe(false);
  });
});
```

同时创建 `src/features/tasks/__tests__/complexity.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  COMPLEXITY_OPTIONS,
  complexityFromOption,
  complexityLabel,
  complexityOptionValue,
} from "../complexity";

describe("complexity vocabulary", () => {
  it("round-trips every option through its sentinel value", () => {
    for (const option of COMPLEXITY_OPTIONS) {
      expect(complexityOptionValue(complexityFromOption(option.value))).toBe(option.value);
    }
  });

  it("never uses the empty string as an option value", () => {
    // Kobalte's Select reads `""` as "nothing selected" and renders a blank
    // trigger, so 未评估 needs a real sentinel.
    expect(COMPLEXITY_OPTIONS.every((option) => option.value !== "")).toBe(true);
  });

  it("labels only real estimates", () => {
    expect(complexityLabel(3)).toBe("复杂度 3");
    expect(complexityLabel(null)).toBeNull();
    expect(complexityLabel(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test dependencies.test complexity.test`
Expected: 失败 —— 无法解析 `../dependencies` / `../complexity`

- [ ] **Step 3: 类型与 IPC**

`src/features/tasks/types.ts`：`Task` 加 `complexity: number | null;`（放在 `repeatRule` 之后）；`Subtask` 加：

```ts
  note: string | null;
  priority: Priority;
  dueAt: string | null;
  /** 1–5, or `null` when never estimated. */
  complexity: number | null;
```

`NewTask` 加 `complexity?: number | null;`；`UpdateTask` 加 `complexity?: number | null;`；`NewSubtask` 与 `UpdateSubtask`：

```ts
export interface NewSubtask {
  title: string;
  note?: string | null;
  priority?: Priority;
  dueAt?: string | null;
  complexity?: number | null;
}

export interface UpdateSubtask {
  title?: string;
  done?: boolean;
  note?: string | null;
  priority?: Priority;
  dueAt?: string | null;
  complexity?: number | null;
}
```

文件末尾加依赖类型：

```ts
/** Which edge set a dependency lives in (`DependencyKind` on the Rust side). */
export type DependencyKind = "task" | "subtask";

/**
 * One dependency edge: `prerequisiteId` must be finished before
 * `dependentId` can be completed.
 */
export interface Dependency {
  kind: DependencyKind;
  dependentId: string;
  prerequisiteId: string;
}
```

`src/common/ipc/commands.ts` 在 `subtask` 之后加：

```ts
  dependency: {
    listAll: "dependency:listAll",
    add: "dependency:add",
    remove: "dependency:remove",
  },
```

`src/features/tasks/api.ts` 在 subtask 段之后加：

```ts
// --- dependency:* ------------------------------------------------------------

/** Every live edge; the store derives blocked state from the full set. */
export function listDependencies(): Promise<Dependency[]> {
  return invokeCommand(COMMANDS.dependency.listAll);
}

/** Idempotent: an edge that already exists comes back unchanged. */
export function addDependency(payload: Dependency): Promise<Dependency> {
  return invokeCommand(COMMANDS.dependency.add, { payload });
}

/** Idempotent: removing an edge that is already gone is not an error. */
export function removeDependency(payload: Dependency): Promise<void> {
  return invokeCommand(COMMANDS.dependency.remove, { payload });
}
```

（`import type` 里加 `Dependency`。）

- [ ] **Step 4: 复杂度词表**

创建 `src/features/tasks/complexity.ts`：

```ts
/**
 * The complexity vocabulary: one definition serves the task editor, the
 * subtask panel and the detail badges.
 *
 * `optionValue` returns a string, not a number: Kobalte's Select treats `""`
 * as "nothing selected" and renders a blank trigger, so 未评估 travels as the
 * sentinel `"none"` (the same reason `quick-add`'s project picker does).
 */

export const COMPLEXITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "未评估" },
  { value: "1", label: "1 · 很简单" },
  { value: "2", label: "2 · 简单" },
  { value: "3", label: "3 · 一般" },
  { value: "4", label: "4 · 复杂" },
  { value: "5", label: "5 · 很复杂" },
];

/** Stored value → the Select's sentinel value. */
export function complexityOptionValue(value: number | null | undefined): string {
  return value == null ? "none" : String(value);
}

/** The Select's sentinel value → the stored value. */
export function complexityFromOption(value: string): number | null {
  return value === "none" ? null : Number(value);
}

/** Badge text for a set complexity; `null` when there is nothing to show. */
export function complexityLabel(value: number | null | undefined): string | null {
  return value == null ? null : `复杂度 ${value}`;
}
```

- [ ] **Step 5: 依赖纯函数**

创建 `src/features/tasks/dependencies.ts`：

```ts
/**
 * Dependency-graph derivations — all pure, so the blocked/cyclic rules are
 * table-tested instead of click-tested.
 *
 * The full edge set arrives with the task list, so "is this blocked?" is a
 * local computation. Callers build the index and the completion set once per
 * render pass (inside a `createMemo`) and then ask per row; the per-row cost is
 * that row's own prerequisite count, not the size of the graph.
 */

import type { Dependency, DependencyKind, Subtask, Task } from "./types";

/** One entity's key in the index maps and the completion set. */
export function entityKey(kind: DependencyKind, id: string): string {
  return `${kind}:${id}`;
}

export interface DependencyIndex {
  /** dependent key → its prerequisite ids, in insertion order */
  prerequisites: Map<string, string[]>;
  /** prerequisite key → the ids waiting for it */
  successors: Map<string, string[]>;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

export function buildIndex(dependencies: readonly Dependency[]): DependencyIndex {
  const prerequisites = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const edge of dependencies) {
    push(prerequisites, entityKey(edge.kind, edge.dependentId), edge.prerequisiteId);
    push(successors, entityKey(edge.kind, edge.prerequisiteId), edge.dependentId);
  }
  return { prerequisites, successors };
}

/** Keys of every finished entity: completed tasks and done subtasks. */
export function completionSet(
  tasks: readonly Task[],
  subtasksByTask: Record<string, readonly Subtask[]>,
): Set<string> {
  const done = new Set<string>();
  for (const task of tasks) {
    if (task.completedAt !== null) done.add(entityKey("task", task.id));
  }
  for (const list of Object.values(subtasksByTask)) {
    for (const subtask of list) {
      if (subtask.done) done.add(entityKey("subtask", subtask.id));
    }
  }
  return done;
}

/** Ids of the entity's prerequisites that are still unfinished. */
export function blockersOf(
  index: DependencyIndex,
  done: ReadonlySet<string>,
  kind: DependencyKind,
  id: string,
): string[] {
  const prerequisites = index.prerequisites.get(entityKey(kind, id)) ?? [];
  return prerequisites.filter(
    (prerequisiteId) => !done.has(entityKey(kind, prerequisiteId)),
  );
}

export function isBlocked(
  index: DependencyIndex,
  done: ReadonlySet<string>,
  kind: DependencyKind,
  id: string,
): boolean {
  return blockersOf(index, done, kind, id).length > 0;
}

/** Ids of the entities that list `id` as a prerequisite. */
export function successorsOf(
  index: DependencyIndex,
  kind: DependencyKind,
  id: string,
): string[] {
  return index.successors.get(entityKey(kind, id)) ?? [];
}

/**
 * Whether `dependent → prerequisite` would close a cycle: walk up from the
 * prerequisite along its own prerequisites, and reaching the dependent means
 * the new edge closes the loop. The visited set keeps a pre-existing cycle
 * from looping forever.
 */
export function wouldCycle(
  index: DependencyIndex,
  kind: DependencyKind,
  dependentId: string,
  prerequisiteId: string,
): boolean {
  if (dependentId === prerequisiteId) return true;
  const target = entityKey(kind, dependentId);
  const seen = new Set<string>();
  const stack = [entityKey(kind, prerequisiteId)];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of index.prerequisites.get(current) ?? []) {
      stack.push(entityKey(kind, next));
    }
  }
  return false;
}

/** Whether two edges point at the same pair (used for optimistic inserts). */
export function edgeEquals(left: Dependency, right: Dependency): boolean {
  return (
    left.kind === right.kind &&
    left.dependentId === right.dependentId &&
    left.prerequisiteId === right.prerequisiteId
  );
}
```

- [ ] **Step 6: store**

`src/features/tasks/store.ts`：`TasksState` 加 `/** All live dependency edges, loaded with the task list. */ dependencies: Dependency[];`，`createStore` 初始值加 `dependencies: []`，`import type` 加 `Dependency`，并在 `setAll` 之后加：

```ts
/** Replaces the whole edge set (the dependency load's own snapshot). */
export function setDependencies(dependencies: Dependency[]): void {
  setState("dependencies", dependencies);
}

/** Adds one edge if it is not already there (optimistic insert). */
export function addDependencyEdge(edge: Dependency): void {
  setState(
    "dependencies",
    produce((list: Dependency[]) => {
      if (!list.some((item) => edgeEquals(item, edge))) list.push(edge);
    }),
  );
}

/** Removes one edge; missing edges are a no-op (optimistic delete). */
export function removeDependencyEdge(edge: Dependency): void {
  setState(
    "dependencies",
    produce((list: Dependency[]) => {
      const index = list.findIndex((item) => edgeEquals(item, edge));
      if (index !== -1) list.splice(index, 1);
    }),
  );
}
```

（顶部 `import { edgeEquals } from "./dependencies";`。）

- [ ] **Step 7: loadAll 拉依赖**

`src/features/tasks/hooks.ts` 的 `loadAll`：

```ts
export async function loadAll(): Promise<boolean> {
  try {
    const [tasks, tags, subtasks, dependencies] = await Promise.all([
      api.listTasks(),
      api.listTags(),
      api.listSubtasksAll(),
      api.listDependencies(),
    ]);
    // Both calls are fed by this load's own snapshot.
    store.setAll(tasks, tags);
    store.setSubtasksAll(subtasks, tasks.map((task) => task.id));
    store.setDependencies(dependencies);
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}
```

`reloadTasks`（中途刷新）**保持不变**：依赖是低频写入，且 `setDependencies` 是盲替换，中途重跑会覆盖用户刚添加的边。

- [ ] **Step 8: 跑测试 + 类型检查**

Run: `pnpm test dependencies.test complexity.test`
Expected: PASS

Run: `pnpm typecheck`
Expected: 出现一批「缺少 `complexity` / `note` / `priority` / `dueAt`」的错误 —— 它们全部来自测试夹具里的 `Task` / `Subtask` 字面量。逐处补上默认值（任务 `complexity: null`；子任务 `note: null, priority: "none", dueAt: null, complexity: null`），直到 `pnpm typecheck` 零输出。这是**本任务的一部分**，不是遗留问题。

- [ ] **Step 9: 全量前端测试**

Run: `pnpm test`
Expected: 全部 PASS

- [ ] **Step 10: 提交**

```bash
git add src/features/tasks/types.ts src/features/tasks/api.ts src/features/tasks/store.ts src/features/tasks/hooks.ts src/features/tasks/complexity.ts src/features/tasks/dependencies.ts src/common/ipc/commands.ts src/features/tasks/__tests__/dependencies.test.ts src/features/tasks/__tests__/complexity.test.ts
git add -u src
git commit -m "feat: load dependency edges and derive blocked state in the frontend"
```

---

### Task 8: 依赖写入与软阻塞收敛（hooks + 确认宿主）

**Files:**
- Create: `src/features/tasks/blocked-confirm.ts`
- Create: `src/features/tasks/components/BlockedConfirmHost.tsx`
- Modify: `src/features/tasks/hooks.ts`（`completeTask` 约 194-210 行、`completeSubtask` 约 387-406 行；文件末尾加依赖写入与 force 版本）
- Modify: `src/app/AppShell.tsx`（`<Toaster />` 之前挂 `<BlockedConfirmHost />`）
- Test: `src/features/tasks/__tests__/hooks.test.ts`、`src/features/tasks/__tests__/blocked-confirm.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 7 的 `dependencies.ts`、`store.{setDependencies,addDependencyEdge,removeDependencyEdge}`、`api.{addDependency,removeDependency}`
- Produces: `blocked-confirm.{blockedRequest,requestBlockedConfirm,clearBlockedConfirm,BlockedRequest,BlockerRef}`；`hooks.{addDependency,removeDependency,forceCompleteTask,forceCompleteSubtask}`

- [ ] **Step 1: 写失败的测试**

在 `src/features/tasks/__tests__/hooks.test.ts` 的 `vi.mock("../api", ...)` 工厂里补三行：

```ts
  listDependencies: vi.fn().mockResolvedValue([]),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
```

并追加用例：

```ts
describe("依赖与软阻塞", () => {
  it("被阻塞时不落库，force 版本才发 IPC", async () => {
    const blocked = task("a");
    const prerequisite = task("b");
    store.setAll([blocked, prerequisite], []);
    store.setDependencies([{ kind: "task", dependentId: "a", prerequisiteId: "b" }]);

    const result = await hooks.completeTask("a");
    expect(result).toBeNull();
    expect(api.completeTask).not.toHaveBeenCalled();
    expect(blockedRequest()?.blockers.map((blocker) => blocker.id)).toEqual(["b"]);
    expect(blockedRequest()?.title).toBe("a");

    vi.mocked(api.completeTask).mockResolvedValue({ ...blocked, completedAt: "2026-09-14T10:00:00Z" });
    await hooks.forceCompleteTask("a");
    expect(api.completeTask).toHaveBeenCalledWith("a");
    store.setDependencies([]);
    clearBlockedConfirm();
  });

  it("前置已完成时直接完成，不弹确认", async () => {
    const dependent = task("a");
    const done = task("b", { completedAt: "2026-09-14T09:00:00Z" });
    store.setAll([dependent, done], []);
    store.setDependencies([{ kind: "task", dependentId: "a", prerequisiteId: "b" }]);
    vi.mocked(api.completeTask).mockResolvedValue({
      ...dependent,
      completedAt: "2026-09-14T10:00:00Z",
    });

    await hooks.completeTask("a");

    expect(api.completeTask).toHaveBeenCalledWith("a");
    expect(blockedRequest()).toBeNull();
    store.setDependencies([]);
  });

  it("添加与删除依赖走乐观更新并调用 api", async () => {
    store.setAll([task("a"), task("b")], []);
    vi.mocked(api.addDependency).mockResolvedValue({
      kind: "task",
      dependentId: "a",
      prerequisiteId: "b",
    });

    await hooks.addDependency("task", "a", "b");

    expect(store.tasksState.dependencies).toEqual([
      { kind: "task", dependentId: "a", prerequisiteId: "b" },
    ]);
    expect(api.addDependency).toHaveBeenCalledWith({
      kind: "task",
      dependentId: "a",
      prerequisiteId: "b",
    });

    vi.mocked(api.removeDependency).mockResolvedValue(undefined);
    await hooks.removeDependency("task", "a", "b");
    expect(store.tasksState.dependencies).toEqual([]);
  });
});
```

（文件顶部 `import { blockedRequest, clearBlockedConfirm } from "../blocked-confirm";`；若现有 `task()` 工厂不接受 `completedAt` 覆盖，用它的 `overrides` 参数即可 —— 该文件已有同样的用法。）

再创建 `src/features/tasks/__tests__/blocked-confirm.test.tsx`：

```tsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { BlockedConfirmHost } from "../components/BlockedConfirmHost";
import { clearBlockedConfirm, requestBlockedConfirm } from "../blocked-confirm";
import { forceCompleteTask } from "../hooks";

vi.mock("../hooks", () => ({
  forceCompleteTask: vi.fn().mockResolvedValue(null),
  forceCompleteSubtask: vi.fn().mockResolvedValue(null),
}));

describe("BlockedConfirmHost", () => {
  beforeEach(() => {
    // The mock's call history is shared across the two cases below.
    vi.clearAllMocks();
  });

  it("列出未完成前置，确认后完成并关闭", async () => {
    requestBlockedConfirm({
      kind: "task",
      id: "a",
      parentId: null,
      title: "写周报",
      blockers: [{ kind: "task", id: "b", title: "收集数据" }],
    });
    render(() => <BlockedConfirmHost />);

    expect(screen.getByText(/写周报/)).toBeTruthy();
    expect(screen.getByText("收集数据")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "仍要完成" }));
    expect(forceCompleteTask).toHaveBeenCalledWith("a");
  });

  it("取消只关闭对话框", () => {
    requestBlockedConfirm({
      kind: "task",
      id: "a",
      parentId: null,
      title: "写周报",
      blockers: [],
    });
    render(() => <BlockedConfirmHost />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(forceCompleteTask).not.toHaveBeenCalled();
    clearBlockedConfirm();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test blocked-confirm hooks.test`
Expected: 失败 —— 无法解析 `../blocked-confirm`、`../components/BlockedConfirmHost`

- [ ] **Step 3: 待确认请求的 store**

创建 `src/features/tasks/blocked-confirm.ts`：

```ts
/**
 * The pending "this item is still blocked" confirmation.
 *
 * The completion hooks cannot render UI, and every completion entry point (list
 * row, board card, detail dialog, subtask row) goes through them — so the
 * blocked case parks the request here and a single host component
 * (`components/BlockedConfirmHost.tsx`, mounted once by the app shell) turns it
 * into a dialog. Callers keep treating `null` as "did not complete".
 */

import { createSignal } from "solid-js";
import type { DependencyKind } from "./types";

/** One unfinished prerequisite, resolved for display. */
export interface BlockerRef {
  kind: DependencyKind;
  id: string;
  title: string;
}

export interface BlockedRequest {
  kind: DependencyKind;
  /** The entity the user is trying to complete. */
  id: string;
  /** Parent task of a subtask; `null` for a task. */
  parentId: string | null;
  title: string;
  blockers: BlockerRef[];
}

const [request, setRequest] = createSignal<BlockedRequest | null>(null);

/** The request awaiting confirmation, or `null`. */
export function blockedRequest(): BlockedRequest | null {
  return request();
}

export function requestBlockedConfirm(next: BlockedRequest): void {
  setRequest(next);
}

export function clearBlockedConfirm(): void {
  setRequest(null);
}
```

- [ ] **Step 4: hooks（依赖写入 + 完成拦截）**

`src/features/tasks/hooks.ts`：

顶部 import 加：

```ts
import { requestBlockedConfirm } from "./blocked-confirm";
import {
  blockersOf,
  buildIndex,
  completionSet,
  edgeEquals,
} from "./dependencies";
```

`import type` 加 `Dependency, DependencyKind`。

把现有的 `completeTask` 函数体改名为 `applyCompleteTask`，并在其后加拦截版本：

```ts
/**
 * Completing something with an unfinished prerequisite needs one confirmation
 * first: the action is not refused (a local single-user tool must not lock its
 * owner out), but it does not happen silently either.
 */
function blockedRequestFor(
  kind: DependencyKind,
  id: string,
  title: string,
  parentId: string | null,
): BlockedRequest | null {
  const index = buildIndex(store.tasksState.dependencies);
  const done = completionSet(store.tasksState.tasks, store.tasksState.subtasksByTask);
  const blockers = blockersOf(index, done, kind, id);
  if (blockers.length === 0) return null;
  return {
    kind,
    id,
    parentId,
    title,
    blockers: blockers.map((blockerId) => ({
      kind,
      id: blockerId,
      title: titleOf(kind, blockerId),
    })),
  };
}

/** Title of a task or subtask by id, for the confirmation list. */
function titleOf(kind: DependencyKind, id: string): string {
  if (kind === "task") return store.getTask(id)?.title ?? "（已删除）";
  for (const list of Object.values(store.tasksState.subtasksByTask)) {
    const found = list.find((item) => item.id === id);
    if (found) return found.title;
  }
  return "（已删除）";
}

export function completeTask(taskId: string): Promise<Task | null> {
  const current = store.getTask(taskId);
  if (!current) return Promise.resolve(missingEntity("任务"));
  const blocked = blockedRequestFor("task", taskId, current.title, null);
  if (blocked) {
    requestBlockedConfirm(blocked);
    return Promise.resolve(null);
  }
  return applyCompleteTask(taskId);
}

/** Completion that skips the dependency check; only `BlockedConfirmHost` calls it. */
export function forceCompleteTask(taskId: string): Promise<Task | null> {
  return applyCompleteTask(taskId);
}
```

`completeSubtask` 同样处理：现有函数体改名 `applyCompleteSubtask`，再加：

```ts
export function completeSubtask(
  taskId: string,
  subtaskId: string,
  done: boolean,
): Promise<Subtask | null> {
  if (done) {
    const current = store.getSubtasks(taskId).find((item) => item.id === subtaskId);
    if (!current) return Promise.resolve(missingEntity("子任务"));
    const blocked = blockedRequestFor("subtask", subtaskId, current.title, taskId);
    if (blocked) {
      requestBlockedConfirm(blocked);
      return Promise.resolve(null);
    }
  }
  return applyCompleteSubtask(taskId, subtaskId, done);
}

/** Completion that skips the dependency check; only `BlockedConfirmHost` calls it. */
export function forceCompleteSubtask(
  taskId: string,
  subtaskId: string,
): Promise<Subtask | null> {
  return applyCompleteSubtask(taskId, subtaskId, true);
}
```

文件末尾（`// --- subtasks ---` 段之后）加依赖写入：

```ts
// --- dependencies ------------------------------------------------------------

/** Adds `dependent → prerequisite` optimistically; rolls back with a toast. */
export function addDependency(
  kind: DependencyKind,
  dependentId: string,
  prerequisiteId: string,
): Promise<boolean | null> {
  const edge: Dependency = { kind, dependentId, prerequisiteId };
  const before = [...store.tasksState.dependencies];

  return optimistic(
    () => store.addDependencyEdge(edge),
    () => store.setDependencies(before),
    async () => {
      await api.addDependency(edge);
      return true;
    },
  );
}

export function removeDependency(
  kind: DependencyKind,
  dependentId: string,
  prerequisiteId: string,
): Promise<boolean | null> {
  const edge: Dependency = { kind, dependentId, prerequisiteId };
  const before = [...store.tasksState.dependencies];
  if (!before.some((item) => edgeEquals(item, edge))) {
    return Promise.resolve(missingEntity("依赖"));
  }

  return optimistic(
    () => store.removeDependencyEdge(edge),
    () => store.setDependencies(before),
    async () => {
      await api.removeDependency(edge);
      return true;
    },
  );
}
```

`import type { BlockedRequest } from "./blocked-confirm";` 也加进类型导入。

- [ ] **Step 5: 确认宿主组件**

创建 `src/features/tasks/components/BlockedConfirmHost.tsx`：

```tsx
import { For, Show } from "solid-js";
import { Button, Dialog } from "../../../common/components";
import { blockedRequest, clearBlockedConfirm } from "../blocked-confirm";
import { forceCompleteSubtask, forceCompleteTask } from "../hooks";

/**
 * The one place a blocked completion is confirmed. Mounted once by the app
 * shell, so none of the completion entry points has to know about it: they go
 * through `completeTask` / `completeSubtask`, which park the request here.
 */
export function BlockedConfirmHost() {
  const request = () => blockedRequest();

  async function confirm(): Promise<void> {
    const pending = request();
    if (!pending) return;
    clearBlockedConfirm();
    if (pending.kind === "task") {
      await forceCompleteTask(pending.id);
    } else if (pending.parentId) {
      await forceCompleteSubtask(pending.parentId, pending.id);
    }
  }

  return (
    <Show when={request()}>
      {(pending) => (
        <Dialog.Root
          open={true}
          onOpenChange={(open) => {
            if (!open) clearBlockedConfirm();
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay />
            <Dialog.Content aria-labelledby="blocked-confirm-title">
              <Dialog.Title id="blocked-confirm-title">前置尚未完成</Dialog.Title>
              <Dialog.Description>
                「{pending().title}」还有 {pending().blockers.length} 项前置未完成：
              </Dialog.Description>
              <Dialog.CloseButton aria-label="关闭" />

              <ul class="mt-3.5 flex flex-col gap-1.5">
                <For each={pending().blockers}>
                  {(blocker) => (
                    <li class="truncate rounded-md bg-surface-hover px-2.5 py-1.5 text-sm text-muted-foreground">
                      {blocker.title}
                    </li>
                  )}
                </For>
              </ul>

              <div class="mt-5 flex justify-end gap-2 border-t border-border pt-4">
                <Button variant="secondary" onClick={clearBlockedConfirm}>
                  取消
                </Button>
                <Button onClick={() => void confirm()}>仍要完成</Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </Show>
  );
}
```

`src/app/AppShell.tsx`：`import { BlockedConfirmHost } from "../features/tasks/components/BlockedConfirmHost";`，并在 `<Toaster />` 之前加 `<BlockedConfirmHost />`。

- [ ] **Step 6: 跑测试**

Run: `pnpm test blocked-confirm hooks.test`
Expected: PASS

Run: `pnpm typecheck`
Expected: 零输出

- [ ] **Step 7: 提交**

```bash
git add src/features/tasks/blocked-confirm.ts src/features/tasks/components/BlockedConfirmHost.tsx src/features/tasks/hooks.ts src/app/AppShell.tsx src/features/tasks/__tests__/blocked-confirm.test.tsx src/features/tasks/__tests__/hooks.test.ts
git commit -m "feat: confirm completions that are still blocked"
```

---

### Task 9: 任务复杂度与依赖编辑界面

**Files:**
- Modify: `src/features/tasks/components/TaskEditorDialog.tsx`
- Modify: `src/features/tasks/components/TaskDetailDialog.tsx`
- Create: `src/features/tasks/components/TaskDependencies.tsx`
- Test: `src/features/tasks/__tests__/task-detail-dialog.test.tsx`、`src/features/tasks/__tests__/task-editor-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 7 的 `complexity.ts` / `dependencies.ts` / `store.dependencies`；Task 8 的 `hooks.{addDependency,removeDependency}`
- Produces: `<TaskDependencies taskId={string} />`；`TaskEditorDialog` 递交 `complexity`

- [ ] **Step 1: 写失败的测试**

在 `src/features/tasks/__tests__/task-detail-dialog.test.tsx` 里，`vi.mock("../api", ...)` 工厂补 `listDependencies: vi.fn().mockResolvedValue([]), addDependency: vi.fn(), removeDependency: vi.fn(),`，并追加：

```tsx
describe("任务详情的依赖区", () => {
  it("列出前置与后置，并且不把自身与已成环的候选列进来", async () => {
    store.setAll(
      [task(TASK_ID, { title: "写周报" }), task("b", { title: "收集数据" }), task("c", { title: "发布" })],
      [],
    );
    store.setDependencies([
      { kind: "task", dependentId: TASK_ID, prerequisiteId: "b" },
      { kind: "task", dependentId: "c", prerequisiteId: TASK_ID },
    ]);
    render(() => (
      <TaskDetailDialog open onOpenChange={() => {}} task={store.getTask(TASK_ID)!} onEdit={() => {}} />
    ));

    const section = await screen.findByRole("region", { name: "依赖" });
    expect(within(section).getByText("收集数据")).toBeTruthy();
    expect(within(section).getByText("发布")).toBeTruthy();

    fireEvent.input(within(section).getByLabelText("添加前置"), { target: { value: "收" } });
    // "收集数据" is already a prerequisite, so the candidate list stays empty.
    expect(within(section).queryByRole("button", { name: "添加前置 收集数据" })).toBeNull();
  });
});
```

（`within` 从 `@solidjs/testing-library` 导入；`task()` 工厂沿用该文件已有的 helper，并给它补上 `complexity: null`。）

在 `src/features/tasks/__tests__/task-editor-dialog.test.tsx` 追加一条：

```tsx
  it("提交时带上复杂度", async () => {
    vi.mocked(api.createTask).mockResolvedValue(task("new"));
    render(() => <TaskEditorDialog open onOpenChange={() => {}} />);

    fireEvent.input(screen.getByLabelText("标题"), { target: { value: "估算" } });
    // Kobalte Select: open the trigger, then pick the option by its label.
    fireEvent.click(screen.getByRole("button", { name: "复杂度" }));
    fireEvent.click(await screen.findByRole("option", { name: "3 · 一般" }));

    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(vi.mocked(api.createTask).mock.calls[0][0]).toMatchObject({ complexity: 3 });
  });
```

> 断言写成 `toMatchObject` 而不是整体相等：创建 payload 还带着 `note`、`projectId`、`tagIds` 等字段，本用例只关心复杂度接线是否接通。若该测试文件里 Kobalte 的 option 查询方式与上面不同，沿用文件内既有的 select 交互 helper。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test task-detail-dialog task-editor-dialog`
Expected: 失败 —— 找不到 `依赖` region / 「复杂度」控件

- [ ] **Step 3: 编辑器加复杂度**

`src/features/tasks/components/TaskEditorDialog.tsx`：

```tsx
import {
  COMPLEXITY_OPTIONS,
  complexityFromOption,
  complexityOptionValue,
} from "../complexity";

  const [complexity, setComplexity] = createSignal<number | null>(null);
```

`createEffect` 的回填块加 `setComplexity(task?.complexity ?? null);`，选中项与 handler：

```tsx
  const selectedComplexity = () =>
    COMPLEXITY_OPTIONS.find((option) => option.value === complexityOptionValue(complexity())) ??
    COMPLEXITY_OPTIONS[0];
```

在「优先级」`Select.Root` 之后插入同样的 `Select.Root`：

```tsx
            <Select.Root
              options={COMPLEXITY_OPTIONS}
              optionValue={(option) => option.value}
              optionTextValue={(option) => option.label}
              itemToString={(option) => option.label}
              value={selectedComplexity()}
              onChange={(option) => setComplexity(complexityFromOption(option?.value ?? "none"))}
            >
              <Select.Label>复杂度</Select.Label>
              <Select.Trigger>
                <Select.Value>{selectedComplexity().label}</Select.Value>
                <Select.Icon />
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
            </Select.Root>
```

提交 payload 里加 `complexity: complexity(),`。

- [ ] **Step 4: 依赖区组件**

创建 `src/features/tasks/components/TaskDependencies.tsx`：

```tsx
import { For, Show, createMemo, createSignal } from "solid-js";
import { X } from "lucide-solid";
import { iconButtonClass } from "../../../common/components";
import { addDependency, removeDependency } from "../hooks";
import { buildIndex, completionSet, entityKey, successorsOf, wouldCycle } from "../dependencies";
import { getTask, tasksState } from "../store";

export interface TaskDependenciesProps {
  taskId: string;
}

/**
 * 任务详情的依赖区：前置可增可删，后置只读。
 *
 * 候选列表在前端先滤掉自身、已添加的和必然成环的任务 —— 后端仍然会拒绝成环
 * （它是权威），但让用户点到一个必然报错的选项是纯粹的浪费。
 */
export function TaskDependencies(props: TaskDependenciesProps) {
  const [query, setQuery] = createSignal("");

  const index = createMemo(() => buildIndex(tasksState.dependencies));
  const done = createMemo(() => completionSet(tasksState.tasks, tasksState.subtasksByTask));

  const titleOf = (id: string) => getTask(id)?.title ?? "（已删除）";
  const prerequisites = createMemo(
    () => index().prerequisites.get(entityKey("task", props.taskId)) ?? [],
  );
  const successors = createMemo(() => successorsOf(index(), "task", props.taskId));

  const candidates = createMemo(() => {
    const term = query().trim().toLowerCase();
    if (!term) return [];
    const taken = new Set(prerequisites());
    return tasksState.tasks
      .filter((task) => task.id !== props.taskId && !taken.has(task.id))
      .filter((task) => task.title.toLowerCase().includes(term))
      .filter((task) => !wouldCycle(index(), "task", props.taskId, task.id))
      .slice(0, 6);
  });

  return (
    <section aria-label="依赖">
      <h3 class="text-sm font-medium text-foreground">依赖</h3>

      <p class="mt-1.5 text-xs text-muted-foreground">
        前置完成后这项才算解锁；被阻塞时完成需要一次确认。
      </p>

      <ul class="mt-2 flex flex-col gap-1.5">
        <For each={prerequisites()} fallback={<li class="text-xs text-subtle-foreground">暂无前置</li>}>
          {(id) => (
            <li class="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
              <span
                class="min-w-0 flex-1 truncate"
                classList={{ "text-subtle-foreground line-through": done().has(entityKey("task", id)) }}
              >
                {titleOf(id)}
              </span>
              <button
                type="button"
                class={iconButtonClass}
                aria-label={`移除前置 ${titleOf(id)}`}
                onClick={() => void removeDependency("task", props.taskId, id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          )}
        </For>
      </ul>

      <div class="mt-2.5 flex flex-col gap-1.5">
        <input
          type="text"
          aria-label="添加前置"
          placeholder="输入任务标题以添加前置"
          class="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-foreground transition duration-150 ease-out placeholder:text-subtle-foreground hover:border-border-strong focus-ring"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <For each={candidates()}>
          {(candidate) => (
            <button
              type="button"
              class="truncate rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
              aria-label={`添加前置 ${candidate.title}`}
              onClick={() => {
                void addDependency("task", props.taskId, candidate.id);
                setQuery("");
              }}
            >
              {candidate.title}
            </button>
          )}
        </For>
      </div>

      <Show when={successors().length > 0}>
        <p class="mt-3 text-xs text-muted-foreground">
          后置（等待本任务）：
          <For each={successors()}>
            {(id, position) => (
              <span>
                {position() > 0 ? "、" : ""}
                {titleOf(id)}
              </span>
            )}
          </For>
        </p>
      </Show>
    </section>
  );
}
```

`src/features/tasks/components/TaskDetailDialog.tsx`：import `TaskDependencies` 与 `complexityLabel`，徽标区在优先级之后加：

```tsx
            <Show when={complexityLabel(task().complexity)}>
              {(label) => <Badge variant="outline">{label()}</Badge>}
            </Show>
```

在子任务区（`mt-5 border-t ... SubtaskList`）之前插入：

```tsx
          <div class="mt-5 border-t border-border pt-5">
            <TaskDependencies taskId={task().id} />
          </div>
```

- [ ] **Step 5: 跑测试**

Run: `pnpm test task-detail-dialog task-editor-dialog`
Expected: PASS

Run: `pnpm typecheck`
Expected: 零输出

- [ ] **Step 6: 提交**

```bash
git add src/features/tasks/components/TaskEditorDialog.tsx src/features/tasks/components/TaskDetailDialog.tsx src/features/tasks/components/TaskDependencies.tsx src/features/tasks/__tests__/task-detail-dialog.test.tsx src/features/tasks/__tests__/task-editor-dialog.test.tsx
git commit -m "feat: edit task complexity and dependencies"
```

---

### Task 10: 子任务属性面板、行内阻塞标记与收口

**Files:**
- Create: `src/features/tasks/components/SubtaskEditor.tsx`
- Modify: `src/features/tasks/components/SubtaskList.tsx`
- Modify: `src/features/tasks/components/TaskItemRow.tsx`
- Modify: `src/features/tasks/components/SubtaskRow.tsx`
- Modify: `src/features/tasks/components/TaskListView.tsx`
- Modify: `src/features/tasks/reminders.ts`
- Modify: `docs/PRD.md`（§2.1 验收要点补一条）
- Modify: `docs/IMPLEMENTATION_PLAN.md`（新增里程碑条目）
- Test: `src/features/tasks/__tests__/task-views.test.tsx`、`src/features/tasks/__tests__/reminders.test.ts`

**Interfaces:**
- Consumes: Task 9 的 `TaskDependencies` 写法与 `complexity.ts`；Task 7 的 `dependencies.ts`
- Produces: `<SubtaskEditor taskId={string} subtask={Subtask} onClose={() => void} />`；`TaskItemRowProps.{blocked, blockerCount}`；`SubtaskRowProps.blocked`

- [ ] **Step 1: 写失败的测试**

`src/features/tasks/__tests__/task-views.test.tsx` 追加：

```tsx
describe("阻塞标记", () => {
  it("有未完成前置的任务行显示阻塞中与数量", () => {
    const blocked = task("a");
    const prerequisite = task("b");
    store.setAll([blocked, prerequisite], []);
    store.setDependencies([{ kind: "task", dependentId: "a", prerequisiteId: "b" }]);

    render(() => <InboxView />);
    expect(screen.getByText("阻塞中 · 还差 1 项")).toBeTruthy();

    // Finishing the prerequisite clears the badge.
    store.patchTask("b", { completedAt: "2026-09-14T10:00:00Z" });
    expect(screen.queryByText("阻塞中 · 还差 1 项")).toBeNull();
    store.setDependencies([]);
  });

  it("展开后未完成前置的子任务行也带标记", () => {
    const parent = task("a");
    const first = subtask("s1", "a", "一");
    const second = subtask("s2", "a", "二");
    store.setAll([parent], []);
    store.setSubtasksAll([first, second], ["a"]);
    store.setDependencies([{ kind: "subtask", dependentId: "s2", prerequisiteId: "s1" }]);

    render(() => <InboxView />);
    fireEvent.click(screen.getByRole("button", { name: "展开 a 的子任务" }));
    expect(screen.getByText("阻塞中")).toBeTruthy();
    store.setDependencies([]);
  });
});
```

（沿用该文件已有的 `task()` / `subtask()` 工厂与 `store` 导入方式；`InboxView` 是该文件里已经在用的视图组件，若该 describe 需要 `vi.mock("../api")` 里补 `listDependencies`，照 Task 9 的做法补齐。）

`src/features/tasks/__tests__/reminders.test.ts` 追加：

```ts
  it("子任务提醒把父任务与子任务都写进文案", () => {
    expect(
      formatReminderMessage({
        taskId: "t1",
        taskTitle: "写周报",
        subtaskId: "s1",
        subtaskTitle: "收集数据",
        kind: "advance_10m",
        dueAt: "2026-09-14T10:00:00Z",
      }),
    ).toContain("写周报 › 收集数据");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test task-views reminders`
Expected: 失败 —— 找不到 `阻塞中` 文案 / 文案里没有 `›`

- [ ] **Step 3: 子任务属性面板**

创建 `src/features/tasks/components/SubtaskEditor.tsx`：

```tsx
import { For, Show, createMemo, createSignal } from "solid-js";
import { Button, Select, TextField } from "../../../common/components";
import { COMPLEXITY_OPTIONS, complexityFromOption, complexityOptionValue } from "../complexity";
import { isoToLocalInputValue, localInputValueToIso } from "../../../common/utils/datetime";
import { buildIndex, entityKey, wouldCycle } from "../dependencies";
import { addDependency, removeDependency, updateSubtask } from "../hooks";
import { PRIORITY_OPTIONS } from "../priority";
import { getSubtasks, tasksState } from "../store";
import type { Subtask } from "../types";

export interface SubtaskEditorProps {
  taskId: string;
  subtask: Subtask;
  onClose: () => void;
}

/**
 * 一个子任务的属性面板，就地展开在它的行下方：描述、优先级、截止时间、复杂度
 * 与前置子任务。
 *
 * 四个字段一次写回（`updateSubtask` 一次 IPC），而不是每敲一键发一次；依赖的
 * 勾选是离散动作，各自立即落库。
 */
export function SubtaskEditor(props: SubtaskEditorProps) {
  const [note, setNote] = createSignal(props.subtask.note ?? "");
  const [priority, setPriority] = createSignal(props.subtask.priority);
  const [dueLocal, setDueLocal] = createSignal(isoToLocalInputValue(props.subtask.dueAt));
  const [complexity, setComplexity] = createSignal<number | null>(props.subtask.complexity);
  const [saving, setSaving] = createSignal(false);

  const siblings = createMemo(() =>
    getSubtasks(props.taskId).filter((item) => item.id !== props.subtask.id),
  );
  const index = createMemo(() => buildIndex(tasksState.dependencies));
  const prerequisites = createMemo(
    () => index().prerequisites.get(entityKey("subtask", props.subtask.id)) ?? [],
  );

  const selectedPriority = () =>
    PRIORITY_OPTIONS.find((option) => option.value === priority()) ??
    PRIORITY_OPTIONS[PRIORITY_OPTIONS.length - 1];
  const selectedComplexity = () =>
    COMPLEXITY_OPTIONS.find((option) => option.value === complexityOptionValue(complexity())) ??
    COMPLEXITY_OPTIONS[0];

  async function save(): Promise<void> {
    if (saving()) return;
    setSaving(true);
    const saved = await updateSubtask(props.taskId, props.subtask.id, {
      note: note().trim() ? note().trim() : null,
      priority: priority(),
      dueAt: localInputValueToIso(dueLocal()),
      complexity: complexity(),
    });
    setSaving(false);
    if (saved) props.onClose();
  }

  return (
    <div class="mb-1.5 flex flex-col gap-3 rounded-md border border-border bg-surface px-2.5 py-2.5">
      <TextField.Root value={note()} onChange={setNote}>
        <TextField.Label>描述</TextField.Label>
        <TextField.TextArea placeholder="补充说明（可选）" />
      </TextField.Root>

      <div class="flex flex-wrap gap-2">
        <Select.Root
          options={PRIORITY_OPTIONS}
          optionValue={(option) => option.value}
          optionTextValue={(option) => option.label}
          itemToString={(option) => option.label}
          value={selectedPriority()}
          onChange={(option) => setPriority(option?.value ?? "none")}
        >
          <Select.Label class="sr-only">子任务优先级</Select.Label>
          <Select.Trigger class="w-24">
            <Select.Value>{selectedPriority().label}</Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Content>
            <Select.Listbox />
          </Select.Content>
        </Select.Root>

        <Select.Root
          options={COMPLEXITY_OPTIONS}
          optionValue={(option) => option.value}
          optionTextValue={(option) => option.label}
          itemToString={(option) => option.label}
          value={selectedComplexity()}
          onChange={(option) => setComplexity(complexityFromOption(option?.value ?? "none"))}
        >
          <Select.Label class="sr-only">子任务复杂度</Select.Label>
          <Select.Trigger class="w-32">
            <Select.Value>{selectedComplexity().label}</Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Content>
            <Select.Listbox />
          </Select.Content>
        </Select.Root>

        <TextField.Root class="w-52" value={dueLocal()} onChange={setDueLocal}>
          <TextField.Label class="sr-only">子任务截止时间</TextField.Label>
          <TextField.Input type="datetime-local" aria-label="子任务截止时间" />
        </TextField.Root>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">前置子任务</span>
        <div class="flex flex-wrap gap-1.5">
          <For each={siblings()}>
            {(sibling) => {
              const selected = () => prerequisites().includes(sibling.id);
              return (
                <button
                  type="button"
                  aria-pressed={selected()}
                  disabled={!selected() && wouldCycle(index(), "subtask", props.subtask.id, sibling.id)}
                  class="rounded-md border px-2 py-1 text-xs transition-colors focus-ring disabled:opacity-40"
                  classList={{
                    "border-primary bg-primary/10 text-primary": selected(),
                    "border-border bg-surface text-muted-foreground hover:bg-surface-hover":
                      !selected(),
                  }}
                  onClick={() =>
                    void (selected()
                      ? removeDependency("subtask", props.subtask.id, sibling.id)
                      : addDependency("subtask", props.subtask.id, sibling.id))
                  }
                >
                  {sibling.title}
                </button>
              );
            }}
          </For>
          <Show when={siblings().length === 0}>
            <span class="text-xs text-subtle-foreground">这是唯一的子任务</span>
          </Show>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={props.onClose}>
          取消
        </Button>
        <Button size="sm" disabled={saving()} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 子任务行接上属性面板**

`src/features/tasks/components/SubtaskList.tsx`：加 `const [propertyId, setPropertyId] = createSignal<string | null>(null);`，在每行的删除按钮之前加一个属性按钮（`SlidersHorizontal`），并在 `</li>` 之前（`<For>` 回调的返回里）把面板放在行下方 —— 由于 `<li>` 是行容器，把整行与面板包进一个 `<li>`：

```tsx
            <li class="flex flex-col">
              <div class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover">
                {/* ...现有的 checkbox / 标题 / 上下移 / 删除按钮原样保留... */}
                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`${propertyId() === subtask.id ? "收起" : "展开"}子任务属性 ${subtask.title}`}
                  aria-expanded={propertyId() === subtask.id}
                  onClick={() =>
                    setPropertyId((current) => (current === subtask.id ? null : subtask.id))
                  }
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                </button>
              </div>
              <Show when={propertyId() === subtask.id}>
                <SubtaskEditor
                  taskId={props.taskId}
                  subtask={subtask}
                  onClose={() => setPropertyId(null)}
                />
              </Show>
            </li>
```

同时给行上的标题后面补两个紧凑标记（在标题按钮之后、上下移按钮之前）：

```tsx
              <Show when={PRIORITY_BADGES[subtask.priority]}>
                {(badge) => (
                  <Badge variant={badge().variant} size="sm">
                    {badge().label}
                  </Badge>
                )}
              </Show>
              <Show when={subtask.dueAt}>
                <Badge variant={isOverdue(subtask.dueAt, new Date()) ? "danger" : "outline"} size="sm">
                  {formatDueLabel(subtask.dueAt, new Date())}
                </Badge>
              </Show>
```

（import `Badge`、`SlidersHorizontal`、`PRIORITY_BADGES`、`isOverdue`、`formatDueLabel`、`SubtaskEditor`。）

- [ ] **Step 5: 列表行的阻塞标记**

`src/features/tasks/components/TaskItemRow.tsx`：props 加

```tsx
  /** Whether an unfinished prerequisite is holding this task back. */
  blocked: boolean;
  /** How many prerequisites are still unfinished. */
  blockerCount: number;
```

在标签 `For` 之后、截止时间 `Show` 之前插入：

```tsx
      <Show when={props.blocked}>
        <Badge variant="warning">
          <Lock size={11} aria-hidden="true" />
          <span aria-hidden="true">阻塞中 · 还差 {props.blockerCount} 项</span>
          <span class="sr-only">
            阻塞中，还有 {props.blockerCount} 项前置未完成
          </span>
        </Badge>
      </Show>
```

（`import { Lock } from "lucide-solid"`。）

`src/features/tasks/components/SubtaskRow.tsx`：props 加 `blocked: boolean;`，在标题按钮之后加：

```tsx
      <Show when={props.blocked}>
        <Badge variant="warning" size="sm" title="前置子任务未完成">
          阻塞中
        </Badge>
      </Show>
```

`src/features/tasks/components/TaskListView.tsx`：`ListRow` 的任务分支加 `blockerCount: number`，`rows` memo 改成一次建索引：

```tsx
  const rows = createMemo<ListRow[]>(() => {
    const index = buildIndex(tasksState.dependencies);
    const done = completionSet(tasksState.tasks, tasksState.subtasksByTask);
    return visible().flatMap((task) => {
      const children = getSubtasks(task.id);
      const head: ListRow = {
        kind: "task",
        task,
        subtaskCount: children.length,
        subtaskDone: children.filter((child) => child.done).length,
        blockerCount: blockersOf(index, done, "task", task.id).length,
      };
      if (children.length === 0 || !expanded()[task.id]) return [head];
      return [
        head,
        ...children.map(
          (subtask): ListRow => ({
            kind: "subtask",
            task,
            subtask,
            blocked: isBlocked(index, done, "subtask", subtask.id),
          }),
        ),
      ];
    });
  });
```

传给行组件：

```tsx
                blocked={row.blockerCount > 0}
                blockerCount={row.blockerCount}
```

（`ListRow` 的 subtask 分支加 `blocked: boolean`，`SubtaskRow` 传 `blocked={row.blocked}`；import 见 Task 7 的 `dependencies.ts`。文件头那段 ROW_HEIGHT 注释不用改：新增的徽标不改变行高。）

- [ ] **Step 6: 提醒文案**

`src/features/tasks/reminders.ts`：`ReminderPayload` 加两个可选字段并改写文案：

```ts
  /** Set when the reminder belongs to a subtask; `taskId` is then its parent. */
  subtaskId?: string | null;
  subtaskTitle?: string | null;
```

```ts
export function formatReminderMessage(reminder: ReminderPayload): string {
  const due = new Date(reminder.dueAt);
  const time = Number.isNaN(due.getTime()) ? "" : format(due, "HH:mm");
  // The parent alone would be ambiguous when one task carries several dated
  // subtasks, so a subtask reminder names both levels.
  const subject = reminder.subtaskTitle
    ? `${reminder.taskTitle} › ${reminder.subtaskTitle}`
    : reminder.taskTitle;
  switch (reminder.kind) {
    case "advance_1h":
      return `「${subject}」将于 1 小时后（${time}）到期`;
    case "advance_10m":
      return `「${subject}」将于 10 分钟后（${time}）到期`;
    case "due":
      return `「${subject}」已到截止时间（${time}）`;
  }
}
```

`locatePendingReminder` 不动：`taskId` 始终是父任务，点通知落在父任务详情上，子任务就在其中。

- [ ] **Step 7: 跑测试**

Run: `pnpm test`
Expected: 全部 PASS

- [ ] **Step 8: 文档收口**

`docs/PRD.md` §2.1 的验收要点补一条：

```markdown
- 被前置阻塞的任务/子任务在列表上明确标出，完成时给出一次确认；循环依赖被拒绝。
```

`docs/IMPLEMENTATION_PLAN.md`：在里程碑表末尾新增一节（跟随该文件既有表格写法），条目包括「任务/子任务属性扩展」「依赖与完成顺序（含子任务提醒）」，验收标准写「属性可编辑并持久化；依赖可增删且拒绝成环；被阻塞项有标记且完成需确认；备份携带依赖边；`cargo test` / `pnpm test` / `pnpm typecheck` 全绿」，状态标 ✅。

- [ ] **Step 9: 收口验证**

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test
```

Run: `pnpm typecheck && pnpm test`
Expected: `cargo fmt` 与 `cargo clippy` 零输出；`cargo test`、`pnpm typecheck`（零输出）、`pnpm test` 全绿

手工验证（`pnpm tauri dev`）：
1. 新建任务填复杂度 → 详情徽标显示「复杂度 3」；
2. 给 A 添加前置 B → A 行出现「阻塞中 · 还差 1 项」，勾 A 弹确认，取消后 A 仍未完成，确认后完成；
3. 完成 B → A 的徽标消失；
4. 试图把 B 的前置设为 A → 候选列表里查不到 A（成环被预过滤），直接调 `dependency:add` 也会被后端拒绝；
5. 子任务展开属性面板，填描述/优先级/截止时间/复杂度并保存 → 行上出现优先级与截止标记；给子任务设前置，勾选时弹确认；
6. 给子任务设一个 1 小时内的截止时间 → 到点收到系统通知，文案是「父任务 › 子任务」；
7. 导出备份再导入 → 依赖关系仍在（重开应用确认徽标恢复）。

- [ ] **Step 10: 提交**

```bash
git add src/features/tasks/components/SubtaskEditor.tsx src/features/tasks/components/SubtaskList.tsx src/features/tasks/components/TaskItemRow.tsx src/features/tasks/components/SubtaskRow.tsx src/features/tasks/components/TaskListView.tsx src/features/tasks/reminders.ts src/features/tasks/__tests__/task-views.test.tsx src/features/tasks/__tests__/reminders.test.ts docs/PRD.md docs/IMPLEMENTATION_PLAN.md
git commit -m "feat: show subtask attributes and blocked state in the lists"
```

---

## 附：任务之间的依赖关系

- Task 1 是其余全部任务的前置（列与表）。
- Task 2、3 互不依赖，但都要动 `models.rs` / `repositories.rs` / `services.rs` 的同一批字面量 → **顺序执行**，避免冲突。
- Task 4 依赖 Task 1；Task 5 依赖 Task 4；Task 6 依赖 Task 1、3（`subtask_reminders` 的候选扫描要读子任务行）。
- Task 7 依赖 Task 2、3、4、6（类型要与四份 Rust 契约同时对齐）；Task 8 依赖 Task 7；Task 9、10 依赖 Task 8。
- Task 10 是唯一的收口任务：它跑全量测试、clippy、手工验证并回写 IMPLEMENTATION_PLAN。

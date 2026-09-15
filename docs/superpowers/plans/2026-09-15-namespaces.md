# 命名空间 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入命名空间——一个可把多个相关项目收在一起的容器——让侧边栏按命名空间分组显示项目，并提供一个组内项目列表 + 汇总进度的命名空间页。

**Architecture:** 后端加一张与 `projects` 同构的 `namespaces` 表，项目通过**可空外键** `projects.namespace_id`（`ON DELETE SET NULL`）归属至多一个命名空间；命令面与项目逐条对齐（`list/create/update/archive/restore`，无重排、无硬删），归档只翻转 `status`、**不级联**其下项目。前端新增 `features/namespaces/`（类型 / IPC / store / hooks，逐字对齐 `features/projects/`），分组是一个**纯派生**：拿存活命名空间集合判定归属，指向已消失命名空间的项目回落为「未归属」显示在根级，而不是从导航里消失。汇总数字全部由前端 store 实时派生（复用 `ProjectProgress`），不新增后端聚合命令。

**Tech Stack:** Rust（rusqlite 0.39 + refinery 0.9.2 迁移 + Tauri 2 commands）、SolidJS + TypeScript + Tailwind v4、Vitest（jsdom）、TanStack Solid Router

**Spec:** `docs/superpowers/specs/2026-09-15-namespaces-design.md`

## Global Constraints

- **SolidJS 不是 React**：用 `createSignal` / `createMemo` / `<Show>` / `<For>` / `class`（不是 `className`），没有 `useState` / `useEffect`。
- **Layering**：`commands.rs` 只做薄包装，业务在 `services.rs`，SQL **只**出现在 `repositories.rs`。
- **迁移不可改**：已应用的 `migrations/V1..V4.sql` 永不修改；本次新增 `V5__namespaces.sql`，`refinery::embed_migrations!` 在编译期自动收录。
- **依赖锁定**：`rusqlite` 固定 0.39、`refinery` 固定 0.9.2，不得升级（AGENTS.md）。
- **Tauri 命令命名**：`#[tauri::command(rename = "namespace:list")]`，Rust 函数名保持合法标识符；参数在 JS 侧是 camelCase。
- **前端边界**：`features/*/api.ts` 是唯一调用 `invoke` 的地方；组件经 `hooks.ts` 变更 store；`features` 之间不互相 import 内部实现，共享逻辑下沉 `common/`。
- **乐观更新数据流**（所有写操作）：`用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果 reconcile → 失败回滚 + 通知`。
- **Kobalte `Select` 两个坑**：挂载时会用一个初值调一次 `onChange`（必须忽略「与当前值相同」的那次），`optionValue` 返回 `""` 会被读成「未选择」（用真哨兵 `"none"`）。
- **不要用 `class` 覆盖原语里已有的同类工具类**：Tailwind 按 CSS 源码顺序（而非 class 属性顺序）解决同属性冲突，这类覆盖会静默失效。
- **动效与焦点**：动效只用 `transform` / `opacity` / 独立 `scale`·`translate`；焦点指示统一用 `focus-ring` 工具类。
- **中文文案**：所有面向用户的字符串保持中文，与现有视图一致。
- **测试命令**：Rust 在 `src-tauri/` 下 `cargo test`；前端 `pnpm test`（Vitest）、`pnpm typecheck`（`tsc --noEmit`，开了 `noUnusedLocals` + `noUnusedParameters`）。出口还必须过 `cargo fmt` 与 `cargo clippy --all-targets -- -D warnings`（零输出）。
- **文档必须同 commit**：行为/数据模型变更加 `docs/PRD.md`、结构/命令变更加 `docs/ARCHITECTURE.md`；`docs/IMPLEMENTATION_PLAN.md` 的 M9 状态在收口任务里回写。
- **`ProjectStatus` 复用**：命名空间与项目共用 `models::ProjectStatus`（同一组 `active`/`archived` 取值、同一张 `CHECK` 约束）与仓储层的 `project_status_as_text` / `project_status_from_text`。**不要**为此新增同形枚举，也不要顺手重命名它们——重命名会波及前端类型与统计，收益为零。

---

### Task 1: V5 迁移 + `Namespace` 模型 + `projects.namespace_id` 全链路

**Files:**
- Create: `src-tauri/migrations/V5__namespaces.sql`
- Modify: `src-tauri/src/models.rs`（`Project` / `NewProject` / `UpdateProject` / 新增三个命名空间类型 / `models` 测试）
- Modify: `src-tauri/src/repositories.rs`（`PROJECT_COLUMNS`、`project_from_row`、`projects::insert`、`projects::update`、测试工厂 `sample_project`）
- Modify: `src-tauri/src/services.rs`（`create_project`、`update_project` 存 `namespace_id`；测试工厂 `make_project`）
- Modify: `src-tauri/src/db.rs`（表清单断言 + V5 对旧数据的回落测试）
- Modify: `docs/ARCHITECTURE.md`（§4.2 实体表与关系图）、`docs/PRD.md`（§7 数据模型概述）

**Interfaces:**
- Consumes: 既有 `query_one` / `query_all` / `parse_uuid` / `PROJECT_COLUMNS` / `project_from_row`（`repositories.rs`）；`validated_name`（`services.rs:56`）
- Produces:
  - 表 `namespaces(id, name, description, color, icon, status, sort_order, created_at, updated_at, deleted_at)`，列 `projects.namespace_id TEXT REFERENCES namespaces(id) ON DELETE SET NULL` + 索引 `idx_projects_namespace`
  - `models::Namespace { id: Uuid, name: String, description: Option<String>, color: Option<String>, icon: Option<String>, status: ProjectStatus, sort_order: String, created_at: DateTime<Utc>, updated_at: DateTime<Utc>, deleted_at: Option<DateTime<Utc>> }`
  - `models::NewNamespace { name: String, description: Option<String>, color: Option<String>, icon: Option<String> }`
  - `models::UpdateNamespace { name: Option<String>, description: Patch<String>, color: Patch<String>, icon: Patch<String> }`
  - `models::Project.namespace_id: Option<Uuid>`；`NewProject.namespace_id: Option<Uuid>`；`UpdateProject.namespace_id: Patch<Uuid>`
  - `services::create_project` / `update_project` 已能存取 `namespace_id`（**校验留到 Task 3**）

- [ ] **Step 1: 写迁移文件**

创建 `src-tauri/migrations/V5__namespaces.sql`：

```sql
-- Migration V5: namespaces — an optional container grouping related projects.
--
-- A project belongs to at most one namespace, so the relation is a nullable
-- foreign key on `projects` rather than a join table (a join table would only
-- add a table, an index and a second write path for a "at most one" relation).
--
-- `ON DELETE SET NULL` only matters for hard deletes; the command surface
-- never hard-deletes a namespace (`deleted_at` stays reserved, exactly as for
-- projects), so the live rule is the frontend's: a project whose namespace no
-- longer resolves is shown as ungrouped instead of disappearing.
--
-- The column is added with a NULL default, which is what SQLite requires for
-- `ADD COLUMN ... REFERENCES` while foreign keys are enabled (V1 turns them on,
-- and `db.rs` asserts they are enforced).

CREATE TABLE namespaces (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT,
    icon        TEXT,
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
    sort_order  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

ALTER TABLE projects ADD COLUMN namespace_id TEXT
    REFERENCES namespaces(id) ON DELETE SET NULL;

CREATE INDEX idx_projects_namespace ON projects(namespace_id);
```

- [ ] **Step 2: 加模型**

在 `src-tauri/src/models.rs` 里，`Project` 结构体（约 95 行）的 `icon` 与 `due_at` 之间插入字段，并在紧跟 `Project` 之后新增 `Namespace`：

```rust
/// A project row (`projects`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    /// Namespace this project is filed under, or `None` for the root list.
    ///
    /// `default` is load-bearing: a backup written before V5 has no
    /// `namespaceId` key at all, and without it the whole document fails to
    /// parse (`subtasks.priority` set the precedent).
    #[serde(default)]
    pub namespace_id: Option<Uuid>,
    pub due_at: Option<DateTime<Utc>>,
    pub status: ProjectStatus,
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A namespace row (`namespaces`): an optional container grouping related
/// projects. Mirrors [`Project`] minus the due date — a deadline belongs to the
/// project, not to the container.
///
/// The lifecycle state reuses [`ProjectStatus`]: same two values, same CHECK
/// constraint, same text mapping in the repository layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Namespace {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub status: ProjectStatus,
    pub sort_order: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}
```

在 `NewProject`（约 489 行）与 `UpdateProject`（约 503 行）里加字段，并在它们之后新增两个写入载荷：

```rust
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    /// Namespace to file the new project under; `None` (or absent) = root list.
    #[serde(default)]
    pub namespace_id: Option<Uuid>,
    #[serde(default)]
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProject {
    pub name: Option<String>,
    #[serde(default)]
    pub description: Patch<String>,
    #[serde(default)]
    pub color: Patch<String>,
    #[serde(default)]
    pub icon: Patch<String>,
    /// Re-file the project; `Patch::Set(None)` moves it back to the root list.
    #[serde(default)]
    pub namespace_id: Patch<Uuid>,
    #[serde(default)]
    pub due_at: Patch<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNamespace {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNamespace {
    pub name: Option<String>,
    #[serde(default)]
    pub description: Patch<String>,
    #[serde(default)]
    pub color: Patch<String>,
    #[serde(default)]
    pub icon: Patch<String>,
}
```

- [ ] **Step 3: 补上因此编译不过的字面量**

Rust 的结构体字面量必须写全字段。这一批站点是**已知的全部**（`cargo check` 会核对，若有遗漏会点名）：

| 位置 | 字面量 | 补什么 |
| --- | --- | --- |
| `models.rs:786`（`project_fields_serialize_as_camel_case`） | `Project` | `namespace_id: None,` + 期望键数组加 `"namespaceId"` |
| `repositories.rs:1812`（测试工厂 `sample_project`） | `Project` | `namespace_id: None,` |
| `services.rs:2371`（测试工厂 `make_project`） | `NewProject` | `namespace_id: None,` |
| `services.rs:2472`（空白名的 `create_project` 用例） | `NewProject` | `namespace_id: None,` |
| `services.rs:2492`、`services.rs:2507`（改名/校验用例） | `UpdateProject` | `namespace_id: Patch::Unchanged,` |
| `services.rs:779`（`create_project` 本体） | `Project` | Step 5 处理 |

Run: `cd src-tauri && cargo check`
Expected: 只剩 Step 4/5 尚未完成的报错（若有别的字面量漏了，编译器会在这里点名）

在 **`models.rs` 的 `project_fields_serialize_as_camel_case` 测试**（约 786 行）里给 `Project { ... }` 加 `namespace_id: None,`，并把 `sorted_keys(&value)` 的期望数组补上 `"namespaceId"`（字母序在 `"name"` 与 `"sortOrder"` 之间）：

```rust
        assert_eq!(
            sorted_keys(&value),
            [
                "color",
                "createdAt",
                "deletedAt",
                "description",
                "dueAt",
                "icon",
                "id",
                "name",
                "namespaceId",
                "sortOrder",
                "status",
                "updatedAt",
            ]
            .map(String::from)
            .to_vec()
        );
```

在 `repositories.rs` 的测试工厂 `sample_project`（约 1811 行）里加 `namespace_id: None,`（位置同 `Project`）；在 `services.rs` 的测试工厂 `make_project` 里，`create_project` 的入参补 `namespace_id: None,`；`services.rs:2472` 的 `NewProject` 与 `services.rs:2492` / `services.rs:2507` 的 `UpdateProject` 按上表补齐。

- [ ] **Step 4: 仓储层打通这一列**

在 `src-tauri/src/repositories.rs`：

```rust
const PROJECT_COLUMNS: &str = "id, name, description, color, icon, namespace_id, due_at, status, \
                               sort_order, created_at, updated_at, deleted_at";
```

`project_from_row`（约 171 行）在 `icon` 之后插入：

```rust
        icon: row.get("icon")?,
        namespace_id: row
            .get::<_, Option<String>>("namespace_id")?
            .map(parse_uuid)
            .transpose()?,
        due_at: row.get("due_at")?,
```

`projects::insert`：

```rust
    pub fn insert(conn: &Connection, project: &Project) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO projects (id, name, description, color, icon, namespace_id, due_at, \
             status, sort_order, created_at, updated_at, deleted_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                project.id.to_string(),
                project.name,
                project.description,
                project.color,
                project.icon,
                project.namespace_id.map(|id| id.to_string()),
                project.due_at,
                project_status_as_text(project.status),
                project.sort_order,
                project.created_at,
                project.updated_at,
                project.deleted_at,
            ],
        )?;
        Ok(())
    }
```

`projects::update`（注意参数序号整体后移一位）：

```rust
    pub fn update(conn: &Connection, project: &Project) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE projects SET name = ?1, description = ?2, color = ?3, icon = ?4, \
             namespace_id = ?5, due_at = ?6, status = ?7, sort_order = ?8, updated_at = ?9 \
             WHERE id = ?10 AND deleted_at IS NULL",
            params![
                project.name,
                project.description,
                project.color,
                project.icon,
                project.namespace_id.map(|id| id.to_string()),
                project.due_at,
                project_status_as_text(project.status),
                project.sort_order,
                project.updated_at,
                project.id.to_string(),
            ],
        )?;
        Ok(affected == 1)
    }
```

- [ ] **Step 5: 服务层把入参写进行**

`services::create_project`（约 763 行）里，`Project { ... }` 字面量在 `icon` 之后加：

```rust
        icon: input.icon,
        namespace_id: input.namespace_id,
```

`services::update_project`（约 819 行）里，紧跟 `icon` 的 patch 分支之后加：

```rust
    if let Patch::Set(namespace_id) = patch.namespace_id {
        // Existence is checked in Task 3; this task only carries the value.
        project.namespace_id = namespace_id;
    }
```

- [ ] **Step 6: 写失败的测试**

在 `src-tauri/src/repositories.rs` 的 `mod tests` 里，`project_round_trips_and_orders_by_sort_order` 之后追加：

```rust
    #[test]
    fn project_namespace_id_round_trips_and_clears() {
        let conn = conn();
        // A real namespace row, because the FK is enforced (same reason the
        // task/column fixtures above use `Uuid::new_v4()`).
        let namespace_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO namespaces (id, name, status, sort_order, created_at, updated_at) \
             VALUES (?1, '工作', 'active', 'a', ?2, ?2)",
            params![namespace_id.to_string(), ts(0)],
        )
        .unwrap();

        let mut project = sample_project("n");
        project.namespace_id = Some(namespace_id);
        projects::insert(&conn, &project).unwrap();
        assert_eq!(
            projects::get(&conn, project.id)
                .unwrap()
                .unwrap()
                .namespace_id,
            project.namespace_id
        );

        let mut moved_out = project.clone();
        moved_out.namespace_id = None;
        assert!(projects::update(&conn, &moved_out).unwrap());
        assert_eq!(
            projects::get(&conn, project.id)
                .unwrap()
                .unwrap()
                .namespace_id,
            None,
            "an explicit NULL moves the project back to the root list"
        );
    }

    #[test]
    fn project_insert_rejects_an_unknown_namespace() {
        let conn = conn();
        let mut project = sample_project("n");
        project.namespace_id = Some(Uuid::new_v4());

        assert!(
            projects::insert(&conn, &project).is_err(),
            "the nullable FK is real: project writes cannot invent a namespace"
        );
    }
```

在 `src-tauri/src/db.rs` 的 `mod tests` 里，把表清单断言的数组加上 `"namespaces"`（放在 `"projects"` 之前），并新增一条迁移测试：

```rust
    #[test]
    fn v5_files_existing_projects_under_no_namespace() {
        // A user's database before this change ships is at V4 with rows in it;
        // the column must arrive as NULL for every one of them.
        let mut conn = Connection::open_in_memory().unwrap();
        embedded::migrations::runner()
            .set_target(refinery::Target::Version(4))
            .run(&mut conn)
            .unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, status, sort_order, created_at, updated_at) \
             VALUES ('p1', '旧项目', 'active', 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        embedded::migrations::runner().run(&mut conn).unwrap();

        let namespace_id: Option<String> = conn
            .query_row("SELECT namespace_id FROM projects WHERE id = 'p1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(namespace_id, None);
    }
```

- [ ] **Step 7: 跑测试**

Run: `cd src-tauri && cargo test`
Expected: 全绿（`cargo check` 在 Step 3 报出的字面量错误此时已全部修完）

- [ ] **Step 8: 文档同步**

`docs/ARCHITECTURE.md` §4.2：实体关系图加一行 `Namespace 1 ──── * Project`，实体表在 **Project** 行之前插入一行：

```markdown
| **Namespace** | name, description, color, icon, status(active/archived), sort_order(字典序键)；项目经可空外键 `projects.namespace_id` 归属至多一个命名空间 |
```

`docs/PRD.md` §7：核心实体列表在 **Project** 之前插入：

```markdown
- **Namespace**：命名空间，把多个相关项目收在一个容器下（单层，项目至多归属一个）。
```

- [ ] **Step 9: 提交**

```bash
git add src-tauri/migrations/V5__namespaces.sql src-tauri/src/models.rs src-tauri/src/repositories.rs src-tauri/src/services.rs src-tauri/src/db.rs docs/ARCHITECTURE.md docs/PRD.md
git commit -m "feat: add the namespaces table and a nullable project namespace"
```

---

### Task 2: 命名空间仓储与服务（`namespace:*` 命令）

**Files:**
- Modify: `src-tauri/src/repositories.rs`（新增 `pub mod namespaces`，放在 `pub mod projects` 之后；测试）
- Modify: `src-tauri/src/services.rs`（`list/create/update/set_status/archive/restore_namespace`；测试 + `make_namespace` 工厂）
- Modify: `src-tauri/src/commands.rs`（`namespace:*` 五个命令）
- Modify: `src-tauri/src/lib.rs`（注册）+ `src/common/ipc/commands.ts`（命令常量）
- Modify: `docs/ARCHITECTURE.md`（§3.2 命令清单）、`docs/IMPLEMENTATION_PLAN.md`（§3 命令清单）

**Interfaces:**
- Consumes: Task 1 的 `Namespace` / `NewNamespace` / `UpdateNamespace`；`append_key`（`services.rs:188`）、`validated_name`（`services.rs:56`）、`not_found`（`services.rs:43`）；`project_status_as_text` / `project_status_from_text`（`repositories.rs:88,95`）
- Produces:
  - `repositories::namespaces::{insert, get, list, update, set_status, set_sort_order}`
  - `services::{list_namespaces, create_namespace, update_namespace, set_namespace_status, archive_namespace, restore_namespace}`
  - Tauri 命令 `namespace:list` / `namespace:create` / `namespace:update` / `namespace:archive` / `namespace:restore`
  - `COMMANDS.namespace.{list,create,update,archive,restore}`

- [ ] **Step 1: 写失败的仓储测试**

在 `src-tauri/src/repositories.rs` 的 `mod tests` 里，`project_archive_and_restore_flip_status` 之后追加：

```rust
    fn sample_namespace(sort_order: &str) -> Namespace {
        Namespace {
            id: Uuid::new_v4(),
            name: "工作".into(),
            description: None,
            color: None,
            icon: None,
            status: ProjectStatus::Active,
            sort_order: sort_order.into(),
            created_at: ts(0),
            updated_at: ts(0),
            deleted_at: None,
        }
    }

    #[test]
    fn namespace_round_trips_and_orders_by_sort_order() {
        let conn = conn();
        let mid = sample_namespace("n");
        let last = sample_namespace("t");
        let first = sample_namespace("a");
        for namespace in [&mid, &last, &first] {
            namespaces::insert(&conn, namespace).unwrap();
        }

        assert_eq!(namespaces::get(&conn, first.id).unwrap().unwrap(), first);
        assert_eq!(namespaces::get(&conn, Uuid::new_v4()).unwrap(), None);
        assert_eq!(namespaces::list(&conn).unwrap(), vec![first, mid, last]);
    }

    #[test]
    fn namespace_update_persists_every_field_and_archive_flips_status() {
        let conn = conn();
        let namespace = sample_namespace("n");
        namespaces::insert(&conn, &namespace).unwrap();

        let mut edited = namespace.clone();
        edited.name = "工作（2026）".into();
        edited.description = Some("主线项目".into());
        edited.color = Some("#6366f1".into());
        edited.icon = Some("briefcase".into());
        edited.updated_at = ts(5);
        assert!(namespaces::update(&conn, &edited).unwrap());
        assert_eq!(namespaces::get(&conn, namespace.id).unwrap().unwrap(), edited);

        assert!(!namespaces::update(&conn, &sample_namespace("n")).unwrap());

        assert!(namespaces::set_status(&conn, namespace.id, ProjectStatus::Archived, ts(10)).unwrap());
        let archived = namespaces::get(&conn, namespace.id).unwrap().unwrap();
        assert_eq!(archived.status, ProjectStatus::Archived);
        assert_eq!(archived.updated_at, ts(10));
        // Archived is a state, not a soft delete: the row stays listed.
        assert_eq!(namespaces::list(&conn).unwrap().len(), 1);
        // Repeating the state is a no-op.
        assert!(!namespaces::set_status(&conn, namespace.id, ProjectStatus::Archived, ts(11)).unwrap());
        assert!(namespaces::set_status(&conn, namespace.id, ProjectStatus::Active, ts(20)).unwrap());
    }
```

这条用例的 id 必须是**真正的 UUID**：`uuid` 只接受 32/36/38/45 字符的写法，计划初稿里写死的 `'ns-1'` 会让 `Uuid::parse_str` 直接 `Err`，而且外键也匹配不上（写入时绑的是同一个 `Uuid::to_string()`）。落地版本用的是 `Uuid::new_v4()`，与仓库里既有的 task/column 夹具同一个理由（`repositories.rs:1857`）。

`mod tests` 顶部的 `use super::*;` 已经带进 `Namespace`（`repositories.rs` 的 `use crate::models::{...}` 需要加上它，见 Step 3）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test namespace_ 2>&1 | tail -20`
Expected: 编译失败，报 `namespaces` 未定义 / `Namespace` 未导入

- [ ] **Step 3: 写仓储模块**

`src-tauri/src/repositories.rs` 顶部 `use crate::models::{...}` 的列表里加上 `Namespace`（保持字母序：`BoardColumn, Comment, Dependency, DependencyKind, Namespace, Priority, Project, ...`）。

在 `pub mod projects { ... }` 之后新增（逐行对齐 `projects` 模块，包括 `set_status` 的「已是目标状态就返回 false」语义）：

```rust
/// Namespace CRUD (`namespaces` table).
///
/// Same lifecycle as [`projects`]: archiving flips `status`, `deleted_at` is
/// reserved for real deletion (unused by the v1 command surface). The status
/// text helpers are the project ones — both tables share `ProjectStatus`.
pub mod namespaces {
    use super::*;

    pub fn insert(conn: &Connection, namespace: &Namespace) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO namespaces (id, name, description, color, icon, status, sort_order, \
             created_at, updated_at, deleted_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                namespace.id.to_string(),
                namespace.name,
                namespace.description,
                namespace.color,
                namespace.icon,
                project_status_as_text(namespace.status),
                namespace.sort_order,
                namespace.created_at,
                namespace.updated_at,
                namespace.deleted_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, id: Uuid) -> Result<Option<Namespace>, AppError> {
        query_one(
            conn,
            "SELECT id, name, description, color, icon, status, sort_order, created_at, \
             updated_at, deleted_at FROM namespaces WHERE id = ?1 AND deleted_at IS NULL",
            params![id.to_string()],
            namespace_from_row,
        )
    }

    /// All non-deleted namespaces (archived ones included; the navigation
    /// filters by `status`), ordered like the project list.
    pub fn list(conn: &Connection) -> Result<Vec<Namespace>, AppError> {
        query_all(
            conn,
            "SELECT id, name, description, color, icon, status, sort_order, created_at, \
             updated_at, deleted_at FROM namespaces WHERE deleted_at IS NULL \
             ORDER BY sort_order, created_at, id",
            &[],
            namespace_from_row,
        )
    }

    /// Full-row update; returns false when the namespace is missing or deleted.
    pub fn update(conn: &Connection, namespace: &Namespace) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE namespaces SET name = ?1, description = ?2, color = ?3, icon = ?4, \
             status = ?5, sort_order = ?6, updated_at = ?7 \
             WHERE id = ?8 AND deleted_at IS NULL",
            params![
                namespace.name,
                namespace.description,
                namespace.color,
                namespace.icon,
                project_status_as_text(namespace.status),
                namespace.sort_order,
                namespace.updated_at,
                namespace.id.to_string(),
            ],
        )?;
        Ok(affected == 1)
    }

    /// Archive/restore flip (`status`); returns false on missing/deleted rows
    /// or when already in the requested state.
    pub fn set_status(
        conn: &Connection,
        id: Uuid,
        status: ProjectStatus,
        at: DateTime<Utc>,
    ) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE namespaces SET status = ?1, updated_at = ?2 \
             WHERE id = ?3 AND deleted_at IS NULL AND status != ?1",
            params![project_status_as_text(status), at, id.to_string()],
        )?;
        Ok(affected == 1)
    }

    /// Targeted `sort_order` write used by service-level rebalances.
    pub fn set_sort_order(
        conn: &Connection,
        id: Uuid,
        sort_order: &str,
        at: DateTime<Utc>,
    ) -> Result<bool, AppError> {
        let affected = conn.execute(
            "UPDATE namespaces SET sort_order = ?1, updated_at = ?2 \
             WHERE id = ?3 AND deleted_at IS NULL",
            params![sort_order, at, id.to_string()],
        )?;
        Ok(affected == 1)
    }
}
```

在 `project_from_row` 之后加行映射：

```rust
fn namespace_from_row(row: &Row<'_>) -> Result<Namespace, AppError> {
    let status_text: String = row.get("status")?;
    Ok(Namespace {
        id: parse_uuid(row.get("id")?)?,
        name: row.get("name")?,
        description: row.get("description")?,
        color: row.get("color")?,
        icon: row.get("icon")?,
        status: project_status_from_text(&status_text)?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}
```

- [ ] **Step 4: 跑仓储测试**

Run: `cd src-tauri && cargo test repositories::tests::namespace_`
Expected: `namespace_round_trips_and_orders_by_sort_order`、`namespace_update_persists_every_field_and_archive_flips_status` 两条 PASS

- [ ] **Step 5: 写失败的服务测试**

在 `src-tauri/src/services.rs` 的 `mod tests` 里，`make_project` 之前加工厂：

```rust
    fn make_namespace(conn: &Connection, name: &str) -> Namespace {
        create_namespace(
            conn,
            NewNamespace {
                name: name.into(),
                description: None,
                color: None,
                icon: None,
            },
        )
        .unwrap()
    }
```

`mod tests` 顶部的 `use super::*;` 覆盖 `Namespace` / `NewNamespace` / `UpdateNamespace`（服务层的 `use crate::models::{...}` 需要加上它们，见 Step 6）。

在 `project_update_patches_and_archive_restores` 之后追加：

```rust
    #[test]
    fn namespace_create_appends_and_validates() {
        let conn = conn();
        let first = make_namespace(&conn, "工作");
        let second = make_namespace(&conn, "学习");
        assert!(first.sort_order < second.sort_order);
        assert_eq!(
            list_namespaces(&conn)
                .unwrap()
                .iter()
                .map(|n| n.name.as_str())
                .collect::<Vec<_>>(),
            vec!["工作", "学习"]
        );

        let err = create_namespace(
            &conn,
            NewNamespace {
                name: "   ".into(),
                description: None,
                color: None,
                icon: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "validation");
    }

    #[test]
    fn namespace_update_patches_and_archive_restores() {
        let conn = conn();
        let namespace = make_namespace(&conn, "旧名");

        let renamed = update_namespace(
            &conn,
            namespace.id,
            UpdateNamespace {
                name: Some("新名".into()),
                description: Patch::Set(Some("主线项目".into())),
                color: Patch::Set(Some("#6366f1".into())),
                icon: Patch::Set(None),
            },
        )
        .unwrap();
        assert_eq!(renamed.name, "新名");
        assert_eq!(renamed.description.as_deref(), Some("主线项目"));
        assert_eq!(renamed.color.as_deref(), Some("#6366f1"));

        assert_eq!(
            update_namespace(
                &conn,
                namespace.id,
                UpdateNamespace {
                    name: Some("  ".into()),
                    description: Patch::Unchanged,
                    color: Patch::Unchanged,
                    icon: Patch::Unchanged,
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );

        let archived = archive_namespace(&conn, namespace.id).unwrap();
        assert_eq!(archived.status, ProjectStatus::Archived);
        // Archiving twice is a no-op returning the unchanged row; archived
        // namespaces still list (navigation filters by status).
        assert_eq!(
            archive_namespace(&conn, namespace.id).unwrap().status,
            ProjectStatus::Archived
        );
        assert_eq!(list_namespaces(&conn).unwrap().len(), 1);

        let restored = restore_namespace(&conn, namespace.id).unwrap();
        assert_eq!(restored.status, ProjectStatus::Active);
        assert_eq!(
            archive_namespace(&conn, Uuid::new_v4()).unwrap_err().code(),
            "not_found"
        );
    }

    #[test]
    fn archiving_a_namespace_leaves_its_projects_alone() {
        let conn = conn();
        let namespace = make_namespace(&conn, "工作");
        let project = create_project(
            &conn,
            NewProject {
                name: "网站改版".into(),
                description: None,
                color: None,
                icon: None,
                namespace_id: Some(namespace.id),
                due_at: None,
            },
        )
        .unwrap();

        archive_namespace(&conn, namespace.id).unwrap();

        let after = projects::get(&conn, project.id).unwrap().unwrap();
        assert_eq!(after.status, ProjectStatus::Active, "group archive is not a cascade");
        assert_eq!(after.namespace_id, Some(namespace.id), "the filing survives");
    }
```

- [ ] **Step 6: 写服务函数**

`src-tauri/src/services.rs` 顶部 `use crate::models::{...}` 里加 `Namespace, NewNamespace, UpdateNamespace`。

在 `// Projects & board` 那一节之后新增一节：

```rust
// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

pub fn list_namespaces(conn: &Connection) -> Result<Vec<Namespace>, AppError> {
    namespaces::list(conn)
}

/// Creates a namespace, appending it after the last existing one. Mirrors
/// `create_project` minus the default board columns: a namespace holds
/// projects, not tasks.
pub fn create_namespace(conn: &Connection, input: NewNamespace) -> Result<Namespace, AppError> {
    let name = validated_name(&input.name)?;
    let now = Utc::now();
    let siblings: Vec<(Uuid, String)> = namespaces::list(conn)?
        .into_iter()
        .map(|namespace| (namespace.id, namespace.sort_order))
        .collect();
    let (sort_order, rebalanced) = append_key(&siblings)?;

    let tx = conn.unchecked_transaction()?;
    for (id, key) in &rebalanced {
        if !namespaces::set_sort_order(&tx, *id, key, now)? {
            return Err(not_found("命名空间", *id));
        }
    }

    let namespace = Namespace {
        id: Uuid::new_v4(),
        name,
        description: input.description,
        color: input.color,
        icon: input.icon,
        status: ProjectStatus::Active,
        sort_order,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    namespaces::insert(&tx, &namespace)?;
    tx.commit()?;
    Ok(namespace)
}

/// Applies a partial patch (missing = unchanged, `Patch::Set` = replace).
pub fn update_namespace(
    conn: &Connection,
    id: Uuid,
    patch: UpdateNamespace,
) -> Result<Namespace, AppError> {
    let mut namespace = namespaces::get(conn, id)?.ok_or_else(|| not_found("命名空间", id))?;
    if let Some(name) = &patch.name {
        namespace.name = validated_name(name)?;
    }
    if let Patch::Set(description) = patch.description {
        namespace.description = description;
    }
    if let Patch::Set(color) = patch.color {
        namespace.color = color;
    }
    if let Patch::Set(icon) = patch.icon {
        namespace.icon = icon;
    }
    namespace.updated_at = Utc::now();
    if !namespaces::update(conn, &namespace)? {
        return Err(not_found("命名空间", id));
    }
    Ok(namespace)
}

/// Archives (or restores) a namespace; repeating the current state is a no-op
/// returning the unchanged row.
///
/// Projects inside are deliberately untouched: archiving a group must not
/// silently flip the state of everything filed under it.
pub fn set_namespace_status(
    conn: &Connection,
    id: Uuid,
    status: ProjectStatus,
) -> Result<Namespace, AppError> {
    let namespace = namespaces::get(conn, id)?.ok_or_else(|| not_found("命名空间", id))?;
    if namespace.status != status && !namespaces::set_status(conn, id, status, Utc::now())? {
        return Err(not_found("命名空间", id));
    }
    namespaces::get(conn, id)?.ok_or_else(|| not_found("命名空间", id))
}

pub fn archive_namespace(conn: &Connection, id: Uuid) -> Result<Namespace, AppError> {
    set_namespace_status(conn, id, ProjectStatus::Archived)
}

pub fn restore_namespace(conn: &Connection, id: Uuid) -> Result<Namespace, AppError> {
    set_namespace_status(conn, id, ProjectStatus::Active)
}
```

- [ ] **Step 7: 跑服务测试**

Run: `cd src-tauri && cargo test -- namespace_ archiving_a_namespace`（libtest 的过滤器只能跟在 `--` 之后传多个；`cargo test A B` 会被 cargo 自己拒掉）
Expected: 三条新测试全部 PASS（`namespace_create_appends_and_validates`、`namespace_update_patches_and_archive_restores`、`archiving_a_namespace_leaves_its_projects_alone`）；`cargo test namespace` 还会带上 Task 1 的 `v5_files_existing_projects_under_no_namespace` 与 `project_namespace_id_round_trips_and_clears`，那是同名过滤器捎带的，不是本任务的新用例

- [ ] **Step 8: 注册命令**

`src-tauri/src/commands.rs` 的 `use crate::models::{...}` 加 `Namespace, NewNamespace, UpdateNamespace`；在 `// --- project:* ---` 之后加一节：

```rust
// --- namespace:* -----------------------------------------------------------

#[tauri::command(rename = "namespace:list")]
pub fn namespace_list(db: State<'_, Db>) -> Result<Vec<Namespace>, AppError> {
    with_conn(&db, services::list_namespaces)
}

#[tauri::command(rename = "namespace:create")]
pub fn namespace_create(db: State<'_, Db>, payload: NewNamespace) -> Result<Namespace, AppError> {
    with_conn(&db, |conn| services::create_namespace(conn, payload))
}

#[tauri::command(rename = "namespace:update")]
pub fn namespace_update(
    db: State<'_, Db>,
    namespace_id: Uuid,
    payload: UpdateNamespace,
) -> Result<Namespace, AppError> {
    with_conn(&db, |conn| {
        services::update_namespace(conn, namespace_id, payload)
    })
}

#[tauri::command(rename = "namespace:archive")]
pub fn namespace_archive(db: State<'_, Db>, namespace_id: Uuid) -> Result<Namespace, AppError> {
    with_conn(&db, |conn| services::archive_namespace(conn, namespace_id))
}

#[tauri::command(rename = "namespace:restore")]
pub fn namespace_restore(db: State<'_, Db>, namespace_id: Uuid) -> Result<Namespace, AppError> {
    with_conn(&db, |conn| services::restore_namespace(conn, namespace_id))
}
```

`src-tauri/src/lib.rs` 的 `invoke_handler` 列表里，在 `commands::project_restore,` 之后插入：

```rust
            commands::namespace_list,
            commands::namespace_create,
            commands::namespace_update,
            commands::namespace_archive,
            commands::namespace_restore,
```

`src/common/ipc/commands.ts` 的 `COMMANDS` 里，`project` 之后插入：

```ts
  namespace: {
    list: "namespace:list",
    create: "namespace:create",
    update: "namespace:update",
    archive: "namespace:archive",
    restore: "namespace:restore",
  },
```

- [ ] **Step 9: 文档同步 + 全量测试 + 提交**

`docs/ARCHITECTURE.md` §3.2 与 `docs/IMPLEMENTATION_PLAN.md` §3 的命令清单里，在 `project:list|create|update|archive|restore` 之后各加一行：

```
namespace:list, namespace:create, namespace:update, namespace:archive, namespace:restore
```

Run: `cd src-tauri && cargo test && cargo fmt && cargo clippy --all-targets -- -D warnings`
Expected: 全绿；`cargo fmt` 与 `clippy` 零输出

```bash
git add src-tauri/src/repositories.rs src-tauri/src/services.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/common/ipc/commands.ts docs/ARCHITECTURE.md docs/IMPLEMENTATION_PLAN.md
git commit -m "feat: add namespace CRUD behind its own command group"
```

---

### Task 3: 项目写入的 `namespaceId` 存在性校验

**Files:**
- Modify: `src-tauri/src/services.rs`（`validate_namespace_ref` + `create_project` / `update_project` 调用；测试）
- Modify: `docs/ARCHITECTURE.md`（§4.2 记一句归属校验）

**Interfaces:**
- Consumes: `repositories::namespaces::get`（Task 2）、`not_found`（`services.rs:43`）
- Produces: `services` 内部 `fn validate_namespace_ref(conn: &Connection, id: Option<Uuid>) -> Result<(), AppError>`；`create_project` / `update_project` 传不存在的命名空间时返回 `NotFound`

- [ ] **Step 1: 写失败的测试**

在 `src-tauri/src/services.rs` 的 `mod tests` 里，`archiving_a_namespace_leaves_its_projects_alone` 之后追加：

```rust
    #[test]
    fn project_writes_reject_an_unknown_or_deleted_namespace() {
        let conn = conn();
        let ghost = Uuid::new_v4();

        let created = create_project(
            &conn,
            NewProject {
                name: "孤儿项目".into(),
                description: None,
                color: None,
                icon: None,
                namespace_id: Some(ghost),
                due_at: None,
            },
        )
        .unwrap_err();
        assert_eq!(created.code(), "not_found");

        let project = make_project(&conn, "网站改版");
        assert_eq!(
            update_project(
                &conn,
                project.id,
                UpdateProject {
                    name: None,
                    description: Patch::Unchanged,
                    color: Patch::Unchanged,
                    icon: Patch::Unchanged,
                    namespace_id: Patch::Set(Some(ghost)),
                    due_at: Patch::Unchanged,
                },
            )
            .unwrap_err()
            .code(),
            "not_found"
        );

        // A soft-deleted namespace is gone as far as project writes care.
        let namespace = make_namespace(&conn, "工作");
        conn.execute(
            "UPDATE namespaces SET deleted_at = '2026-09-15T00:00:00Z' WHERE id = ?1",
            params![namespace.id.to_string()],
        )
        .unwrap();
        assert_eq!(
            update_project(
                &conn,
                project.id,
                UpdateProject {
                    name: None,
                    description: Patch::Unchanged,
                    color: Patch::Unchanged,
                    icon: Patch::Unchanged,
                    namespace_id: Patch::Set(Some(namespace.id)),
                    due_at: Patch::Unchanged,
                },
            )
            .unwrap_err()
            .code(),
            "not_found"
        );

        // Clearing the field is always allowed, and filing into a live
        // namespace works.
        let live = make_namespace(&conn, "学习");
        let filed = update_project(
            &conn,
            project.id,
            UpdateProject {
                name: None,
                description: Patch::Unchanged,
                color: Patch::Unchanged,
                icon: Patch::Unchanged,
                namespace_id: Patch::Set(Some(live.id)),
                due_at: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(filed.namespace_id, Some(live.id));

        let cleared = update_project(
            &conn,
            project.id,
            UpdateProject {
                name: None,
                description: Patch::Unchanged,
                color: Patch::Unchanged,
                icon: Patch::Unchanged,
                namespace_id: Patch::Set(None),
                due_at: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(cleared.namespace_id, None);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test project_writes_reject`
Expected: FAIL —— 前两次断言拿到的是空 `Err`（无校验时 `create_project` 会直接命中外键约束报 `database`）或断言不等

注：这条用例**只**覆盖「不存在」与「已软删」两种失败。往**已归档**命名空间里放项目是允许的（§5.5：归档命名空间仍持有它的项目，恢复项目时也要能放回去），所以它不在这条用例的失败清单里。

- [ ] **Step 3: 加校验**

在 `src-tauri/src/services.rs` 的 `Namespaces` 一节里，`restore_namespace` 之后加：

```rust
/// Rejects a `namespaceId` that does not resolve to a live namespace. `None`
/// (the root list) is always fine; clearing is never blocked.
fn validate_namespace_ref(conn: &Connection, id: Option<Uuid>) -> Result<(), AppError> {
    match id {
        Some(id) if namespaces::get(conn, id)?.is_none() => Err(not_found("命名空间", id)),
        _ => Ok(()),
    }
}
```

`create_project` 里，`let name = validated_name(&input.name)?;` 之后加：

```rust
    validate_namespace_ref(conn, input.namespace_id)?;
```

`update_project` 里的 `namespace_id` 分支改成：

```rust
    if let Patch::Set(namespace_id) = patch.namespace_id {
        validate_namespace_ref(conn, namespace_id)?;
        project.namespace_id = namespace_id;
    }
```

（Task 1 写的「Existence is checked in Task 3」注释此时删掉。）

- [ ] **Step 4: 跑测试**

Run: `cd src-tauri && cargo test`
Expected: 全绿

- [ ] **Step 5: 文档同步 + 提交**

`docs/ARCHITECTURE.md` §4.2 的命名空间说明后补一句：

```markdown
> **归属校验（`project:create` / `project:update`）**：非空 `namespaceId` 必须解析到一个未软删的命名空间，否则返回 `not_found`；`null` 即不归属，永远允许。校验在服务层（`validate_namespace_ref`），可空外键只是兜底——它挡得住不存在的 id，但说不清「已软删」与「不存在」的差别。
```

```bash
git add src-tauri/src/services.rs docs/ARCHITECTURE.md
git commit -m "feat: validate the namespace a project is filed under"
```

---

### Task 4: 备份携带命名空间（`BACKUP_VERSION` 3）

**Files:**
- Modify: `src-tauri/src/models.rs`（`BackupData`、`BackupCounts`、`counts()`）
- Modify: `src-tauri/src/repositories.rs`（`backup::export_all`、`backup::replace_all`）
- Modify: `src-tauri/src/services.rs`（`BACKUP_VERSION`；备份测试 + `seed_everything`）
- Modify: `src/features/settings/types.ts`（`BackupCounts` 镜像加 `namespaces`）
- Modify: `src/features/settings/__tests__/settings-view.test.tsx`（该文件里的 `BackupCounts` 字面量要补 `namespaces: 1,`，否则 `pnpm typecheck` 直接 TS2741 失败——镜像字段是必填的）
- Modify: `docs/ARCHITECTURE.md`（§4.2 备份段落）

**Interfaces:**
- Consumes: `repositories::namespaces::{insert, list}`（Task 2）
- Produces: 备份文档 `data.namespaces`（`#[serde(default)]`，v1/v2 文件缺该键即空列表）；`BACKUP_VERSION = 3`

- [ ] **Step 1: 写失败的测试**

在 `src-tauri/src/services.rs` 的 `mod tests` 里追加：

```rust
    #[test]
    fn backup_carries_namespaces_and_refiles_projects() {
        let conn = conn();
        let namespace = make_namespace(&conn, "工作");
        let project = create_project(
            &conn,
            NewProject {
                name: "网站改版".into(),
                description: None,
                color: None,
                icon: None,
                namespace_id: Some(namespace.id),
                due_at: None,
            },
        )
        .unwrap();
        let path = backup_path();
        export_backup(&conn, &path).unwrap();

        let restored = db::test_conn();
        import_backup(&restored, &path).unwrap();

        assert_eq!(list_namespaces(&restored).unwrap(), vec![namespace.clone()]);
        assert_eq!(
            projects::get(&restored, project.id)
                .unwrap()
                .unwrap()
                .namespace_id,
            Some(namespace.id),
            "the filing survives a round trip"
        );

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn version_two_backups_import_with_every_project_ungrouped() {
        let conn = conn();
        // A v2 document predates `namespaces` and has no `namespaceId` on its
        // projects; `#[serde(default)]` has to carry both.
        let document = serde_json::json!({
            "format": BACKUP_FORMAT,
            "version": 2,
            "exportedAt": "2026-01-01T00:00:00Z",
            "data": {
                "projects": [{
                    "id": "11111111-1111-4111-8111-111111111111",
                    "name": "旧项目",
                    "description": null,
                    "color": null,
                    "icon": null,
                    "dueAt": null,
                    "status": "active",
                    "sortOrder": "a",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "deletedAt": null
                }],
                "boardColumns": [], "tags": [], "tasks": [], "subtasks": [],
                "taskTags": [], "comments": [], "timeEntries": [], "settings": []
            }
        });
        let path = backup_path();
        std::fs::write(&path, serde_json::to_string(&document).unwrap()).unwrap();
        import_backup(&conn, &path).unwrap();

        let imported = list_projects(&conn).unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].namespace_id, None);
        assert!(list_namespaces(&conn).unwrap().is_empty());

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn import_refuses_a_project_filed_under_a_missing_namespace() {
        let conn = conn();
        let existing = make_project(&conn, "已有项目");

        // Only a hand-edited document can get here: the write path validates
        // the reference, so a dangling one means the file was doctored.
        let document = serde_json::json!({
            "format": BACKUP_FORMAT,
            "version": BACKUP_VERSION,
            "exportedAt": "2026-01-01T00:00:00Z",
            "data": {
                "namespaces": [],
                "projects": [{
                    "id": "22222222-2222-4222-8222-222222222222",
                    "name": "悬空项目",
                    "description": null,
                    "color": null,
                    "icon": null,
                    "namespaceId": "33333333-3333-4333-8333-333333333333",
                    "dueAt": null,
                    "status": "active",
                    "sortOrder": "a",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "deletedAt": null
                }],
                "boardColumns": [], "tags": [], "tasks": [], "subtasks": [],
                "taskTags": [], "comments": [], "timeEntries": [], "settings": []
            }
        });
        let path = backup_path();
        std::fs::write(&path, serde_json::to_string(&document).unwrap()).unwrap();

        assert!(import_backup(&conn, &path).is_err());
        assert_eq!(
            list_projects(&conn).unwrap(),
            vec![existing],
            "a refused import changes nothing"
        );

        std::fs::remove_file(&path).unwrap();
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test -- backup_carries_namespaces version_two_backups import_refuses_a_project`（同 Task 2：多个过滤器要跟在 `--` 之后）
Expected: 只有 `backup_carries_namespaces_and_refiles_projects` 会 FAIL（导入时外键违约，报错行比预想的还早一步：命名空间根本没进文档）。另外两条在 Task 1 落地后**就已经通过**——`Project.namespace_id` 那时已带 `#[serde(default)]`、外键也已生效——它们是回归钉子而不是新功能的 RED；实施时用变异验证过它们的咬合力（删掉 `#[serde(default)]` 两条版本测试都会以 `missing field namespaces` 失败；把插入顺序换回来则 `backup_carries_namespaces_and_refiles_projects` 以 `FOREIGN KEY constraint failed` 失败）

- [ ] **Step 3: 模型与版本号**

`src-tauri/src/models.rs` 的 `BackupData` 里，`projects` **之前**加字段：

```rust
    /// Namespaces precede the projects: they are the parent table, so an
    /// importer inserts them first and the `projects.namespace_id` foreign key
    /// holds all the way through. Absent in v1/v2 documents.
    #[serde(default)]
    pub namespaces: Vec<Namespace>,
```

`BackupCounts` 加 `pub namespaces: usize,`（放最前，与 `BackupData` 同序）；`BackupData::counts()` 里加 `namespaces: self.namespaces.len(),`。

`src-tauri/src/services.rs`：

```rust
/// Generation of the backup format. Bumped to 3 when namespaces joined the
/// document: an older build reading a v3 file would file every project at the
/// root, so `import_backup` refuses anything newer than this value.
pub const BACKUP_VERSION: u32 = 3;
```

`src/features/settings/types.ts` 的 `BackupCounts` 镜像加 `namespaces: number;`（放在 `projects` 之前，与后端同序）。

- [ ] **Step 4: 导出/导入**

先把命名空间模块里被内联了三遍的列清单抽成常量（放在文件顶部 `*_COLUMNS` 那一组里，与 `PROJECT_COLUMNS` 并列）：

```rust
const NAMESPACE_COLUMNS: &str = "id, name, description, color, icon, status, sort_order,                                 created_at, updated_at, deleted_at";
```

再让 `pub mod namespaces` 的 `insert` / `get` / `list` 三处都引用它（`get`/`list` 的 SELECT 列清单、`insert` 的列清单），然后改 `backup::export_all`，把 `Ok(BackupData {` 的第一行改成：

```rust
        Ok(BackupData {
            namespaces: all_rows(conn, "namespaces", NAMESPACE_COLUMNS, namespace_from_row)?,
            projects: all_rows(conn, "projects", PROJECT_COLUMNS, project_from_row)?,
```

`backup::replace_all` 的删除列表里，`"projects"` 之后加 `"namespaces"`（先删子表再删父表）：

```rust
            "tasks",
            "board_columns",
            "projects",
            "namespaces",
            "tags",
            "settings",
```

插入列表里，`projects` **之前**加：

```rust
        // Parents first: `projects.namespace_id` references `namespaces`.
        for namespace in &data.namespaces {
            namespaces::insert(conn, namespace)?;
        }
        for project in &data.projects {
            projects::insert(conn, project)?;
        }
```

- [ ] **Step 5: 修既有备份测试的计数断言**

`src-tauri/src/services.rs` 的 `backup_round_trip_restores_every_table`：`seed_everything` 里给项目挂一个命名空间——把开头那一行 `let project = make_project(conn, "Alpha");` 换成下面三行（`project` 仍是后面用到的那个变量，靠遮蔽换成了带归属的行）：

```rust
        let project = make_project(conn, "Alpha");
        let namespace = make_namespace(conn, "工作");
        let project = update_project(
            conn,
            project.id,
            UpdateProject {
                name: None,
                description: Patch::Unchanged,
                color: Patch::Unchanged,
                icon: Patch::Unchanged,
                namespace_id: Patch::Set(Some(namespace.id)),
                due_at: Patch::Unchanged,
            },
        )
        .unwrap();
```

计数断言的元组最前面加 `exported.counts.namespaces,`，期望值改成 `(1, 1, 3, 2, 1, 1, 1, 1, 1)`（命名空间 1、项目 1、看板列 3、任务 2、标签 1、子任务 1、评论 1、时间记录 1、设置 1）：

```rust
        assert_eq!(
            (
                exported.counts.namespaces,
                exported.counts.projects,
                exported.counts.board_columns,
                exported.counts.tasks,
                exported.counts.tags,
                exported.counts.subtasks,
                exported.counts.comments,
                exported.counts.time_entries,
                exported.counts.settings,
            ),
            (1, 1, 3, 2, 1, 1, 1, 1, 1)
        );
```

同一测试尾部再加一条「导入后项目仍挂在原命名空间」的断言：

```rust
        assert_eq!(
            projects::get(&restored, before.projects[0].id)
                .unwrap()
                .unwrap()
                .namespace_id,
            before.projects[0].namespace_id
        );
```

- [ ] **Step 6: 跑测试**

Run: `cd src-tauri && cargo test`
Expected: 全绿（含既有的 `version_one_backups_still_import`、`backup_roundtrips_dependency_edges`）

- [ ] **Step 7: 文档同步 + 提交**

`docs/ARCHITECTURE.md` §4.2 的备份段落：文档形状改成 `version:3`，并把表清单改成 `{projects, namespaces, boardColumns, ...}`，补一句：

```markdown
> 备份版本 3 起携带 `namespaces`：文档里它是 `projects` 的父表（导入时先插），v1/v2 文件缺该键即空列表、其项目全部落在根级——这正是它们导出时的样子。
```

Run: `pnpm typecheck`
Expected: 零输出

```bash
git add src-tauri/src/models.rs src-tauri/src/repositories.rs src-tauri/src/services.rs src/features/settings/types.ts docs/ARCHITECTURE.md
git commit -m "feat: carry namespaces in backups, bumping the format to v3"
```

---

### Task 5: 前端契约层（类型 / IPC / store / 派生）

**Files:**
- Create: `src/features/namespaces/types.ts`、`src/features/namespaces/api.ts`、`src/features/namespaces/store.ts`、`src/features/namespaces/hooks.ts`
- Create: `src/features/namespaces/__tests__/store.test.ts`、`src/features/namespaces/__tests__/hooks.test.ts`
- Modify: `src/features/projects/types.ts`、`src/features/projects/hooks.ts`
- Modify: 所有 `Project` 字面量（`pnpm typecheck` 会点名）：`src/features/projects/__tests__/store.test.ts`、`hooks.test.ts`、`project-editor-dialog.test.tsx`、`project-list-view.test.tsx`、`src/app/__tests__/quick-add-window.test.tsx`
- Modify: `docs/superpowers/specs/2026-09-15-namespaces-design.md`（§6.2 补上两个派生）

**Interfaces:**
- Consumes: `COMMANDS.namespace.*`（Task 2）；`normalizeError` / `invokeCommand`（`common/ipc`）；`pushError`（`common/stores/notifications`）；`projectsState`（`features/projects/store`）
- Produces:
  - `features/namespaces/types.ts`：`NamespaceStatus`、`Namespace`、`NewNamespace`、`UpdateNamespace`
  - `features/namespaces/api.ts`：`listNamespaces` / `createNamespace` / `updateNamespace` / `archiveNamespace` / `restoreNamespace`
  - `features/namespaces/store.ts`：`namespacesState`、`getNamespace`、`activeNamespaces`、`archivedNamespaces`、`isNamespaceLive`、`projectsInNamespace`、`ungroupedProjects`、`archivedLooseProjects`、`archivedProjectsOf`、`setAll`、`upsertNamespace`、`patchNamespace`、`removeNamespace`、`resetNamespacesStore`
  - `features/namespaces/hooks.ts`：`loadAll`、`createNamespace`、`updateNamespace`、`archiveNamespace`、`restoreNamespace`
  - `Project.namespaceId: string | null`；`NewProject.namespaceId?: string | null`；`UpdateProject.namespaceId?: string | null`

- [ ] **Step 1: 写失败的类型 + store 测试**

创建 `src/features/namespaces/__tests__/store.test.ts`：

```ts
import { beforeEach, describe, expect, it } from "vitest";
import * as projectsStore from "../../projects/store";
import type { Project } from "../../projects/types";
import * as store from "../store";
import type { Namespace } from "../types";

function namespace(id: string, overrides: Partial<Namespace> = {}): Namespace {
  return {
    id,
    name: `命名空间 ${id}`,
    description: null,
    color: null,
    icon: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    dueAt: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  store.resetNamespacesStore();
  projectsStore.resetProjectsStore();
});

describe("namespaces store", () => {
  it("splits active and archived namespaces", () => {
    store.setAll([
      namespace("a"),
      namespace("b", { status: "archived" }),
      namespace("c"),
    ]);

    expect(store.namespacesState.loaded).toBe(true);
    expect(store.activeNamespaces().map((item) => item.id)).toEqual(["a", "c"]);
    expect(store.archivedNamespaces().map((item) => item.id)).toEqual(["b"]);
  });

  it("groups only live, active projects under a namespace", () => {
    store.setAll([namespace("ns1")]);
    projectsStore.setAll([
      project("p1", { namespaceId: "ns1" }),
      project("p2", { namespaceId: "ns1", status: "archived" }),
      project("p3"),
    ]);

    expect(store.projectsInNamespace("ns1").map((item) => item.id)).toEqual(["p1"]);
    expect(store.ungroupedProjects().map((item) => item.id)).toEqual(["p3"]);
  });

  it("falls back to the root list when the namespace is gone", () => {
    // No namespaces loaded at all: every filed project is an orphan.
    projectsStore.setAll([project("p1", { namespaceId: "ghost" })]);

    expect(store.isNamespaceLive("ghost")).toBe(false);
    expect(store.ungroupedProjects().map((item) => item.id)).toEqual(["p1"]);
  });

  it("keeps archived projects of a live namespace in the flat list", () => {
    store.setAll([namespace("live"), namespace("gone", { status: "archived" })]);
    projectsStore.setAll([
      project("p1", { namespaceId: "live", status: "archived" }),
      project("p2", { status: "archived" }),
      project("p3", { namespaceId: "gone", status: "archived" }),
      project("p4", { namespaceId: "gone" }),
    ]);

    expect(store.archivedLooseProjects().map((item) => item.id)).toEqual(["p1", "p2"]);
    expect(store.archivedProjectsOf("gone").map((item) => item.id)).toEqual(["p3", "p4"]);
  });

  it("upserts by id and patches fields", () => {
    store.setAll([namespace("a", { name: "旧名" })]);
    store.upsertNamespace(namespace("a", { name: "新名" }));
    expect(store.namespacesState.namespaces).toHaveLength(1);
    expect(store.getNamespace("a")?.name).toBe("新名");

    store.patchNamespace("a", { status: "archived" });
    expect(store.archivedNamespaces().map((item) => item.id)).toEqual(["a"]);

    store.removeNamespace("a");
    expect(store.namespacesState.namespaces).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/features/namespaces/__tests__/store.test.ts`
Expected: 失败 —— `../store` 与 `../types` 模块不存在

- [ ] **Step 3: 写类型、API 与 store**

创建 `src/features/namespaces/types.ts`：

```ts
/**
 * Domain types for the namespace feature, mirroring `Namespace` in
 * `src-tauri/src/models.rs` field-for-field (serde camelCase). Write payloads
 * follow the plan §3 patch semantics: a missing field leaves the stored value
 * unchanged, an explicit `null` clears it.
 */

/** Namespace lifecycle state (`namespaces.status`); archived namespaces are restorable. */
export type NamespaceStatus = "active" | "archived";

export interface Namespace {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  status: NamespaceStatus;
  sortOrder: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NewNamespace {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}

export interface UpdateNamespace {
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}
```

创建 `src/features/namespaces/api.ts`：

```ts
/**
 * Backend calls for the namespace domain — the only place in this feature that
 * touches the IPC layer. Components never call these directly; they go
 * through `hooks.ts`, which owns the optimistic-update flow.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type { Namespace, NewNamespace, UpdateNamespace } from "./types";

// --- namespace:* -------------------------------------------------------------

export function listNamespaces(): Promise<Namespace[]> {
  return invokeCommand(COMMANDS.namespace.list);
}

export function createNamespace(payload: NewNamespace): Promise<Namespace> {
  return invokeCommand(COMMANDS.namespace.create, { payload });
}

export function updateNamespace(
  namespaceId: string,
  payload: UpdateNamespace,
): Promise<Namespace> {
  return invokeCommand(COMMANDS.namespace.update, { namespaceId, payload });
}

export function archiveNamespace(namespaceId: string): Promise<Namespace> {
  return invokeCommand(COMMANDS.namespace.archive, { namespaceId });
}

export function restoreNamespace(namespaceId: string): Promise<Namespace> {
  return invokeCommand(COMMANDS.namespace.restore, { namespaceId });
}
```

创建 `src/features/namespaces/store.ts`：

```ts
/**
 * Full-data namespace store (module-level `createStore`, mirroring the project
 * domain conventions). Holds every live namespace — archived ones included, so
 * the sidebar can offer restore — and owns the grouping derivations, because
 * "which projects belong to which namespace" is the cross-domain quantity this
 * feature exists for.
 *
 * Mutators below are the data-layer's plumbing — components change state
 * through `hooks.ts`, never directly.
 */

import { createStore, produce } from "solid-js/store";
import { projectsState } from "../projects/store";
import type { Project } from "../projects/types";
import type { Namespace } from "./types";

export interface NamespacesState {
  /** All live namespaces (active + archived), ordered by `sortOrder`. */
  namespaces: Namespace[];
  /** Whether the initial `loadAll` completed successfully. */
  loaded: boolean;
}

const [state, setState] = createStore<NamespacesState>({
  namespaces: [],
  loaded: false,
});

/** Reactive store state; read from components, mutate through hooks. */
export const namespacesState = state;

export function getNamespace(id: string): Namespace | undefined {
  return state.namespaces.find((namespace) => namespace.id === id);
}

/** Namespaces shown in the navigation: live and not archived. */
export function activeNamespaces(): Namespace[] {
  return state.namespaces.filter((namespace) => namespace.status === "active");
}

/** Archived namespaces, for the sidebar's restore section. */
export function archivedNamespaces(): Namespace[] {
  return state.namespaces.filter((namespace) => namespace.status === "archived");
}

/**
 * Whether a `namespaceId` resolves to a namespace we know about.
 *
 * "Live" means *not soft-deleted* — `namespace:list` already filters those out.
 * An **archived** namespace still counts: its projects stay nested under it in
 * the archived section rather than falling back to the root list. A project
 * whose id resolves to nothing is an orphan and is shown as ungrouped, which is
 * what keeps a deleted namespace from making its projects vanish.
 */
export function isNamespaceLive(id: string): boolean {
  return getNamespace(id) !== undefined;
}

/** Active projects filed under a live namespace, by `sortOrder`. */
export function projectsInNamespace(namespaceId: string): Project[] {
  return projectsState.projects.filter(
    (project) => project.namespaceId === namespaceId && project.status === "active",
  );
}

/** Active projects on the root list: unfiled, or filed under a namespace we
 * cannot resolve any more. */
export function ungroupedProjects(): Project[] {
  return projectsState.projects.filter(
    (project) =>
      project.status === "active" &&
      (project.namespaceId === null || !isNamespaceLive(project.namespaceId)),
  );
}

/** Archived projects that stay in the flat archived list: unfiled ones, orphans,
 * and those whose namespace is still in the navigation. Archived projects of an
 * *archived* namespace are nested under that group instead. */
export function archivedLooseProjects(): Project[] {
  return projectsState.projects.filter((project) => {
    if (project.status !== "archived") return false;
    if (project.namespaceId === null) return true;
    return getNamespace(project.namespaceId)?.status !== "archived";
  });
}

/** Every live project filed under a namespace, whatever its own status — what
 * an archived namespace lists when the group is expanded. */
export function archivedProjectsOf(namespaceId: string): Project[] {
  return projectsState.projects.filter(
    (project) => project.namespaceId === namespaceId,
  );
}

// --- mutators (data-layer plumbing; see module docs) -------------------------

export function setAll(namespaces: Namespace[]): void {
  setState({ namespaces, loaded: true });
}

export function upsertNamespace(namespace: Namespace): void {
  setState(
    "namespaces",
    produce((list: Namespace[]) => {
      const index = list.findIndex((item) => item.id === namespace.id);
      if (index === -1) {
        list.push(namespace);
      } else {
        list[index] = namespace;
      }
    }),
  );
}

export function patchNamespace(id: string, patch: Partial<Namespace>): void {
  setState(
    "namespaces",
    produce((list: Namespace[]) => {
      const namespace = list.find((item) => item.id === id);
      if (namespace) Object.assign(namespace, patch);
    }),
  );
}

export function removeNamespace(id: string): void {
  setState("namespaces", (list) => list.filter((namespace) => namespace.id !== id));
}

/** Resets the store to its pristine state (test seam). */
export function resetNamespacesStore(): void {
  setState({ namespaces: [], loaded: false });
}
```

- [ ] **Step 4: 跑 store 测试**

Run: `pnpm test src/features/namespaces/__tests__/store.test.ts`
Expected: 5 条 PASS

- [ ] **Step 5: 写失败的 hooks 测试**

创建 `src/features/namespaces/__tests__/hooks.test.ts`（逐条对齐 `features/projects/__tests__/hooks.test.ts`）：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearNotifications, notifications } from "../../../common/stores/notifications";
import type { Namespace } from "../types";

vi.mock("../api", () => ({
  listNamespaces: vi.fn(),
  createNamespace: vi.fn(),
  updateNamespace: vi.fn(),
  archiveNamespace: vi.fn(),
  restoreNamespace: vi.fn(),
}));

import * as api from "../api";
import * as hooks from "../hooks";
import * as store from "../store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function appError(code = "validation", message = "操作失败") {
  return { code, message } as const;
}

function namespace(id: string, overrides: Partial<Namespace> = {}): Namespace {
  return {
    id,
    name: `命名空间 ${id}`,
    description: null,
    color: null,
    icon: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetNamespacesStore();
  clearNotifications();
});

afterEach(() => {
  clearNotifications();
});

describe("loadAll", () => {
  it("fills the store with namespaces", async () => {
    vi.mocked(api.listNamespaces).mockResolvedValue([namespace("a"), namespace("b")]);

    const ok = await hooks.loadAll();

    expect(ok).toBe(true);
    expect(store.namespacesState.namespaces).toHaveLength(2);
    expect(store.namespacesState.loaded).toBe(true);
  });

  it("notifies and reports failure when loading fails", async () => {
    vi.mocked(api.listNamespaces).mockRejectedValue(appError("database", "数据库错误"));

    const ok = await hooks.loadAll();

    expect(ok).toBe(false);
    expect(store.namespacesState.loaded).toBe(false);
    expect(notifications()).toEqual([
      { id: expect.any(Number), kind: "error", message: "数据库错误", code: "database" },
    ]);
  });
});

describe("createNamespace", () => {
  it("shows a trimmed optimistic entry, then reconciles with the real row", async () => {
    const pending = deferred<Namespace>();
    vi.mocked(api.createNamespace).mockReturnValue(pending.promise);

    const result = hooks.createNamespace({ name: "  工作  " });

    const optimistic = store.namespacesState.namespaces;
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].name).toBe("工作");
    expect(optimistic[0].id).toMatch(/^optimistic-/);

    pending.resolve(namespace("real-1", { name: "工作" }));
    const created = await result;

    expect(created?.id).toBe("real-1");
    expect(api.createNamespace).toHaveBeenCalledWith({ name: "工作" });
    expect(store.namespacesState.namespaces).toEqual([namespace("real-1", { name: "工作" })]);
  });

  it("removes the optimistic entry and notifies on failure", async () => {
    vi.mocked(api.createNamespace).mockRejectedValue(appError("validation", "名称已存在"));

    const created = await hooks.createNamespace({ name: "重名" });

    expect(created).toBeNull();
    expect(store.namespacesState.namespaces).toEqual([]);
    expect(notifications()).toHaveLength(1);
  });
});

describe("updateNamespace", () => {
  it("applies the patch optimistically and reconciles", async () => {
    store.setAll([namespace("n1")]);
    vi.mocked(api.updateNamespace).mockResolvedValue(namespace("n1", { name: "新名" }));

    const saved = await hooks.updateNamespace("n1", { name: "新名", color: null });

    expect(saved?.name).toBe("新名");
    expect(api.updateNamespace).toHaveBeenCalledWith("n1", { name: "新名", color: null });
    expect(store.getNamespace("n1")?.name).toBe("新名");
  });

  it("rolls back and notifies when the backend rejects the write", async () => {
    store.setAll([namespace("n1", { name: "原名", description: "原说明" })]);
    vi.mocked(api.updateNamespace).mockRejectedValue(appError("validation", "无效"));

    const saved = await hooks.updateNamespace("n1", { name: "新名" });

    expect(saved).toBeNull();
    expect(store.getNamespace("n1")?.name).toBe("原名");
    expect(store.getNamespace("n1")?.description).toBe("原说明");
    expect(notifications()).toHaveLength(1);
  });

  it("reports a missing namespace without calling the backend", async () => {
    const saved = await hooks.updateNamespace("ghost", { name: "x" });

    expect(saved).toBeNull();
    expect(api.updateNamespace).not.toHaveBeenCalled();
    expect(notifications()).toHaveLength(1);
  });
});

describe("archiveNamespace / restoreNamespace", () => {
  it("flips the status optimistically and reconciles", async () => {
    store.setAll([namespace("n1")]);
    vi.mocked(api.archiveNamespace).mockResolvedValue(namespace("n1", { status: "archived" }));

    const archived = await hooks.archiveNamespace("n1");

    expect(archived?.status).toBe("archived");
    expect(store.activeNamespaces()).toEqual([]);
    expect(store.archivedNamespaces()).toEqual([namespace("n1", { status: "archived" })]);

    vi.mocked(api.restoreNamespace).mockResolvedValue(namespace("n1"));
    const restored = await hooks.restoreNamespace("n1");

    expect(restored?.status).toBe("active");
    expect(store.activeNamespaces()).toHaveLength(1);
  });

  it("restores the previous status when archiving fails", async () => {
    store.setAll([namespace("n1")]);
    vi.mocked(api.archiveNamespace).mockRejectedValue(appError("database", "数据库错误"));

    const archived = await hooks.archiveNamespace("n1");

    expect(archived).toBeNull();
    expect(store.getNamespace("n1")?.status).toBe("active");
  });
});
```

- [ ] **Step 6: 写 hooks**

创建 `src/features/namespaces/hooks.ts`：

```ts
/**
 * Mutation entry points for the namespace domain — the surface components use.
 *
 * Every write follows the plan §3 optimistic data flow:
 * `用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果 reconcile
 *  → 失败回滚 + 通知`. Hooks return the authoritative entity on success and
 * `null` on failure (a notification is pushed already; callers need not
 * try/catch).
 */

import { normalizeError } from "../../common/ipc";
import { pushError } from "../../common/stores/notifications";
import * as api from "./api";
import * as store from "./store";
import type { Namespace, NewNamespace, UpdateNamespace } from "./types";

/** Prefix for optimistic ids; never collides with backend UUIDs. */
const TEMP_PREFIX = "optimistic-";
let tempSeq = 0;

function nextTempId(): string {
  tempSeq += 1;
  return `${TEMP_PREFIX}${Date.now().toString(36)}-${tempSeq}`;
}

/** Normalizes any thrown value, surfaces it as an error notification. */
function reportFailure(error: unknown): null {
  const normalized = normalizeError(error);
  pushError(normalized.message, normalized.code);
  return null;
}

/** Applies `apply`, runs `action`, reconciles; rolls back + notifies on failure. */
async function optimistic<T>(
  apply: () => void,
  rollback: () => void,
  action: () => Promise<T>,
): Promise<T | null> {
  apply();
  try {
    return await action();
  } catch (error) {
    rollback();
    return reportFailure(error);
  }
}

function missingEntity(what: string): null {
  pushError(`${what}不存在或数据已刷新，请重试`);
  return null;
}

// --- loading -----------------------------------------------------------------

/** Loads all namespaces; returns success. */
export async function loadAll(): Promise<boolean> {
  try {
    store.setAll(await api.listNamespaces());
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
}

// --- namespaces --------------------------------------------------------------

/** Creates a namespace; a temporary entry appears instantly and is replaced by
 * the authoritative row once the backend replies. */
export function createNamespace(input: NewNamespace): Promise<Namespace | null> {
  const tempId = nextTempId();
  const now = new Date().toISOString();
  const optimisticNamespace: Namespace = {
    id: tempId,
    name: input.name.trim(),
    description: input.description ?? null,
    color: input.color ?? null,
    icon: input.icon ?? null,
    status: "active",
    // Backend assigns the real key; "\uffff" keeps the temp entry last when
    // the sidebar re-sorts by sortOrder.
    sortOrder: "\uffff",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return optimistic(
    () => store.upsertNamespace(optimisticNamespace),
    () => store.removeNamespace(tempId),
    async () => {
      const created = await api.createNamespace({
        ...input,
        name: optimisticNamespace.name,
      });
      store.removeNamespace(tempId);
      store.upsertNamespace(created);
      return created;
    },
  );
}

/** Applies a partial patch optimistically (missing = unchanged, null = clear). */
export function updateNamespace(
  namespaceId: string,
  patch: UpdateNamespace,
): Promise<Namespace | null> {
  const current = store.getNamespace(namespaceId);
  if (!current) return Promise.resolve(missingEntity("命名空间"));
  const before: Namespace = { ...current };

  const optimisticPatch: Partial<Namespace> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) optimisticPatch.name = patch.name.trim();
  if ("description" in patch) optimisticPatch.description = patch.description ?? null;
  if ("color" in patch) optimisticPatch.color = patch.color ?? null;
  if ("icon" in patch) optimisticPatch.icon = patch.icon ?? null;

  return optimistic(
    () => store.patchNamespace(namespaceId, optimisticPatch),
    () => store.patchNamespace(namespaceId, before),
    async () => {
      const saved = await api.updateNamespace(namespaceId, patch);
      store.patchNamespace(namespaceId, saved);
      return saved;
    },
  );
}

/** Flips the namespace to archived optimistically; nav hides the group (and
 * its projects, which move into the archived section) immediately. */
export function archiveNamespace(namespaceId: string): Promise<Namespace | null> {
  const current = store.getNamespace(namespaceId);
  if (!current) return Promise.resolve(missingEntity("命名空间"));
  const before: Namespace = { ...current };
  const now = new Date().toISOString();

  return optimistic(
    () => store.patchNamespace(namespaceId, { status: "archived", updatedAt: now }),
    () => store.patchNamespace(namespaceId, before),
    async () => {
      const saved = await api.archiveNamespace(namespaceId);
      store.patchNamespace(namespaceId, saved);
      return saved;
    },
  );
}

/** Restores an archived namespace optimistically; nav shows the group again. */
export function restoreNamespace(namespaceId: string): Promise<Namespace | null> {
  const current = store.getNamespace(namespaceId);
  if (!current) return Promise.resolve(missingEntity("命名空间"));
  const before: Namespace = { ...current };
  const now = new Date().toISOString();

  return optimistic(
    () => store.patchNamespace(namespaceId, { status: "active", updatedAt: now }),
    () => store.patchNamespace(namespaceId, before),
    async () => {
      const saved = await api.restoreNamespace(namespaceId);
      store.patchNamespace(namespaceId, saved);
      return saved;
    },
  );
}
```

- [ ] **Step 7: 把 `namespaceId` 接进项目域**

`src/features/projects/types.ts`：`Project` 在 `icon` 之后加 `namespaceId: string | null;`；`NewProject` 与 `UpdateProject` 各加 `namespaceId?: string | null;`。

`src/features/projects/hooks.ts`：`createProject` 的乐观对象在 `icon` 之后加 `namespaceId: input.namespaceId ?? null,`；`updateProject` 的乐观 patch 在 `"icon" in patch` 之后加：

```ts
  if ("namespaceId" in patch) optimisticPatch.namespaceId = patch.namespaceId ?? null;
```

- [ ] **Step 8: 跑测试与类型检查，补齐字面量**

Run: `pnpm test src/features/namespaces src/features/projects`
Run: `pnpm typecheck`

`Project` 上的新字段是必需字段，编译器会逐个点名缺 `namespaceId` 的**项目**字面量（任务/子任务的字面量不受影响，它们没有这个字段）。截至本计划，已知站点是 `src/features/projects/__tests__/store.test.ts`、`src/features/projects/__tests__/hooks.test.ts`、`src/features/projects/__tests__/project-editor-dialog.test.tsx`、`src/features/projects/__tests__/project-list-view.test.tsx`、`src/app/__tests__/quick-add-window.test.tsx` 里的工厂函数：在 `icon: null,` 之后补一行 `namespaceId: null,`。

Expected: `pnpm test` 全绿；`pnpm typecheck` 零输出

- [ ] **Step 9: 文档同步 + 提交**

`docs/superpowers/specs/2026-09-15-namespaces-design.md` §6.2 的派生列表末尾补两条（实现落地后 spec 与代码保持一致）：

```markdown
- `archivedLooseProjects()`：仍留在「已归档」平铺列表里的项目——未归属的、孤儿、以及归属**存活**命名空间的；归属已归档命名空间的归档项目缩进在那一组下面。
- `archivedProjectsOf(id)`：已归档命名空间展开时要列出的项目（该组下全部存活项目，含自身已归档的）。
```

```bash
git add src/features/namespaces src/features/projects src/app/__tests__/quick-add-window.test.tsx docs/superpowers/specs/2026-09-15-namespaces-design.md
git commit -m "feat: add the namespace data layer and project grouping derivations"
```

---

### Task 6: 编辑器（项目对话框的命名空间选择 + 命名空间编辑器）

**Files:**
- Create: `src/common/icons.ts` 与 `src/common/colors.ts`（分别从 `src/features/projects/icons.ts`、`ProjectEditorDialog` 的 `PROJECT_COLORS` 迁移并通用化命名）
- Create: `src/common/components/palette-picker.tsx`（色板与图标选择器；两个编辑器共用，避免把同一段网格 markup 抄两遍）
- Delete: `src/features/projects/icons.ts`
- Modify: `src/common/components/index.ts`（导出选择器）、`src/app/AppShell.tsx`、`src/features/projects/components/ProjectEditorDialog.tsx`、`src/features/projects/components/ProjectListView.tsx`（换 import 路径与函数名）
- Create: `src/features/namespaces/components/NamespaceEditorDialog.tsx`
- Modify: `src/features/projects/components/ProjectEditorDialog.tsx`（改用共用选择器 + 命名空间 `Select` + `defaultNamespaceId` 入参）
- Modify: `src/features/projects/__tests__/project-editor-dialog.test.tsx`（初始化 namespaces store + 断言 payload）
- Create: `src/features/namespaces/__tests__/namespace-editor-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 5 的 `activeNamespaces`、`getNamespace`、`hooks`；`text-field`、`dialog`、`select`、`button`（`common/components`）
- Produces: `common/icons.ts` 导出 `ICONS` / `ICON_NAMES` / `getIcon(name)`；`common/colors.ts` 导出 `COLORS`；`common/components/palette-picker.tsx` 导出 `ColorSwatches` 与 `IconPicker`（props: `{ value: string | null; onChange: (value: string | null) => void; label: string }`）并经 `common/components/index.ts` 转发；`ProjectEditorDialog` 新增可选 prop `defaultNamespaceId?: string | null` 并在提交载荷里带 `namespaceId`；`NamespaceEditorDialog`（props: `open`、`onOpenChange`、`namespace?`）

- [ ] **Step 1: 把图标表与调色板下沉到 `common/`**

`features/namespaces` 需要与项目同一套图标与颜色，而「features 之间不互相 import 内部实现」是写进 ARCHITECTURE 的边界，所以把这两份表搬到共享层，而不是从 `features/projects/` 里 import：

```bash
git mv src/features/projects/icons.ts src/common/icons.ts
```

在 `src/common/icons.ts` 里把三处命名通用化（`PROJECT_ICONS` → `ICONS`、`PROJECT_ICON_NAMES` → `ICON_NAMES`、`getProjectIcon` → `getIcon`），并把文件头注释改成「项目与命名空间共用」。三处调用点同步改 import 与函数名：

- `src/app/AppShell.tsx`：`import { getIcon } from "../common/icons";`，`getProjectIcon(` → `getIcon(`
- `src/features/projects/components/ProjectEditorDialog.tsx`：`import { ICON_NAMES, getIcon } from "../../../common/icons";`，`PROJECT_ICON_NAMES` → `ICON_NAMES`、`getProjectIcon` → `getIcon`
- `src/features/projects/components/ProjectListView.tsx`：`import { getIcon } from "../../../common/icons";`，`getProjectIcon(` → `getIcon(`

再把 `ProjectEditorDialog.tsx` 里的 `PROJECT_COLORS` 原样搬到新文件 `src/common/colors.ts`（改名 `COLORS`，注释说明是「项目与命名空间共用的预设色板；`null` = 无颜色」），`ProjectEditorDialog.tsx` 与新的命名空间编辑器都从那里 import。（`PROJECT_COLORS` 全仓只有该文件在用，直接搬走即可，不必留别名。）

Run: `pnpm typecheck && pnpm test`
Expected: 零错误；测试全绿（这次搬迁不改行为）

- [ ] **Step 2: 把色板/图标选择器抽成共用组件**

两个编辑器都要「一排颜色方块 + 一排图标按钮」，原样抄一遍就是 60 多行 markup 的重复。创建 `src/common/components/palette-picker.tsx`：

```tsx
import { For, Show } from "solid-js";
import { Check } from "lucide-solid";
import { COLORS } from "../colors";
import { ICON_NAMES, getIcon } from "../icons";

/**
 * The palette controls shared by the project and namespace editors.
 *
 * A colour swatch is a click target, so it is `size-7` — at 24px a ten-colour
 * grid becomes a pixel hunt. Square, so it sits in the same geometric family
 * as the buttons under it. The border colour comes from the class rather than
 * an inline style, so `hover:border-border-strong` can actually win.
 */
const SWATCH_CLASS =
  "inline-flex size-7 items-center justify-center rounded-md border border-border transition focus-ring hover:border-border-strong active:scale-90";

export interface PalettePickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Accessible name of the swatch/icon group, e.g. 「项目颜色」. */
  label: string;
}

export function ColorSwatches(props: PalettePickerProps) {
  return (
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-muted-foreground">颜色</span>
      <div role="group" aria-label={props.label} class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-label="无颜色"
          aria-pressed={props.value === null}
          class={`${SWATCH_CLASS} bg-surface text-2xs text-muted-foreground`}
          classList={{ "ring-2 ring-ring": props.value === null }}
          onClick={() => props.onChange(null)}
        >
          无
        </button>
        <For each={COLORS}>
          {(swatch) => (
            <button
              type="button"
              aria-label={`颜色 ${swatch}`}
              aria-pressed={props.value === swatch}
              class={SWATCH_CLASS}
              classList={{ "ring-2 ring-ring": props.value === swatch }}
              style={{ "background-color": swatch }}
              onClick={() => props.onChange(swatch)}
            >
              <Show when={props.value === swatch}>
                <Check size={13} class="text-white mix-blend-difference" aria-hidden="true" />
              </Show>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export function IconPicker(props: PalettePickerProps) {
  return (
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-muted-foreground">图标</span>
      <div role="group" aria-label={props.label} class="flex flex-wrap items-center gap-1.5">
        <For each={ICON_NAMES}>
          {(iconName) => {
            const Icon = getIcon(iconName);
            return (
              <button
                type="button"
                aria-label={`图标 ${iconName}`}
                aria-pressed={props.value === iconName}
                class="inline-flex size-8 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition duration-150 ease-out hover:border-border-strong hover:bg-surface-hover active:scale-90 focus-ring"
                classList={{
                  "border-primary bg-primary/10 text-primary": props.value === iconName,
                }}
                onClick={() => props.onChange(iconName)}
              >
                <Icon size={15} />
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
```

在 `src/common/components/index.ts` 加：

```ts
export {
  ColorSwatches,
  IconPicker,
  type PalettePickerProps,
} from "./palette-picker";
```

`ProjectEditorDialog.tsx` 里删掉本地的 `SWATCH_CLASS`、颜色网格与图标网格三块 markup，改成（`color`/`icon` 信号保持不变，`Check` 与 `For` 若不再用到就从 import 里删掉，`noUnusedLocals` 会点名）：

```tsx
            <ColorSwatches value={color()} onChange={setColor} label="项目颜色" />
            <IconPicker value={icon()} onChange={setIcon} label="项目图标" />
```

Run: `pnpm test src/features/projects/__tests__/project-editor-dialog.test.tsx && pnpm typecheck`
Expected: 既有断言（`颜色 #3b82f6`、`图标 rocket` 的 `aria-pressed`）全部照旧通过；typecheck 零输出

- [ ] **Step 3: 写失败的编辑器测试**

在 `src/features/projects/__tests__/project-editor-dialog.test.tsx` 里，顶部补 namespaces store 的初始化（`import { resetNamespacesStore, setAll as setNamespaces } from "../../namespaces/store";` 与 `import type { Namespace } from "../../namespaces/types";`），`beforeEach` 加 `resetNamespacesStore();`，并新增两条测试：

```tsx
  it("files a new project into a picked namespace", async () => {
    setNamespaces([namespaceFixture("ns1", "工作"), namespaceFixture("ns2", "学习")]);
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "网站改版" } });
    // Select.Label names the trigger via aria-labelledby; Kobalte opens on
    // pointerdown (same helper shape as quick-add-window.test.tsx).
    fireEvent.pointerDown(screen.getByRole("button", { name: /命名空间/ }));
    fireEvent.click(await screen.findByRole("option", { name: "学习" }));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(hooks.createProject).mock.calls[0]?.[0]?.namespaceId).toBe("ns2");
  });

  it("submits the project's current namespace untouched", async () => {
    setNamespaces([namespaceFixture("ns1", "工作")]);
    const existing = projectFixture("p9", { namespaceId: "ns1" });
    vi.mocked(hooks.updateProject).mockResolvedValue(existing);
    renderDialog(existing);

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(hooks.updateProject).toHaveBeenCalled());
    expect(vi.mocked(hooks.updateProject).mock.calls[0]?.[1]?.namespaceId).toBe("ns1");
  });

  it("keeps an archived namespace selectable instead of silently unfiling", async () => {
    // The project lives in a namespace that is no longer in the navigation;
    // dropping it from the options would rewrite the field on save.
    setNamespaces([namespaceFixture("ns1", "工作", "archived")]);
    const existing = projectFixture("p9", { namespaceId: "ns1" });
    vi.mocked(hooks.updateProject).mockResolvedValue(existing);
    renderDialog(existing);

    fireEvent.pointerDown(screen.getByRole("button", { name: /命名空间/ }));
    expect(await screen.findByRole("option", { name: "工作（已归档）" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(hooks.updateProject).toHaveBeenCalled());
    expect(vi.mocked(hooks.updateProject).mock.calls[0]?.[1]?.namespaceId).toBe("ns1");
  });
```

同文件加工厂（`namespaceFixture` 的第三参是可选状态，见下），`Namespace` 类型从 `../../namespaces/types` 引入：

```tsx
function namespaceFixture(
  id: string,
  name: string,
  status: "active" | "archived" = "active",
): Namespace {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    status,
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
  };
}
```

既有的那几条 `expect(hooks.createProject).toHaveBeenCalledWith({...})` / `toHaveBeenCalledWith("p9", {...})` 的期望对象补 `namespaceId: null`（或 `existing.namespaceId`），因为提交载荷现在总是带这个字段。（`projectFixture` 里的 `namespaceId: null` 已在 Task 5 补过，这里不要重复添加。）

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm test src/features/projects/__tests__/project-editor-dialog.test.tsx`
Expected: FAIL —— 找不到可访问名「命名空间」的控件

- [ ] **Step 5: 给项目编辑器加命名空间选择**

`src/features/projects/components/ProjectEditorDialog.tsx`：

`import` 里加 `Select`：

```tsx
import { Button, Dialog, Select, TextField } from "../../../common/components";
import { activeNamespaces, getNamespace } from "../../namespaces/store";
import type { Namespace } from "../../namespaces/types";
```

props 加一项：

```tsx
export interface ProjectEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Project to edit; omit to create a new one. */
  project?: Project;
  /** Namespace preselected for a new project (ignored when editing). */
  defaultNamespaceId?: string | null;
}
```

组件内加信号与选项（`NOT_FILED` 是真哨兵：`optionValue` 返回 `""` 会被读成「未选择」，触发器会渲染成空白）：

```tsx
/** Sentinel for "no namespace": a real string, never `""`. */
const NOT_FILED = "none";

type NamespaceOption = { id: string | null; name: string };

  const [namespaceId, setNamespaceId] = createSignal<string | null>(null);

  // The project's own namespace stays in the list even after it is archived:
  // leaving it out would make the Select fall back to "不归属" and rewrite the
  // field on the next save, silently unfiling a project the user only renamed.
  const namespaceOptions = (): NamespaceOption[] => {
    const current = props.project?.namespaceId
      ? getNamespace(props.project.namespaceId)
      : undefined;
    const archived: NamespaceOption[] =
      current?.status === "archived"
        ? [{ id: current.id, name: `${current.name}（已归档）` }]
        : [];
    return [
      { id: null, name: "不归属" },
      ...archived,
      ...activeNamespaces().map((namespace: Namespace) => ({
        id: namespace.id,
        name: namespace.name,
      })),
    ];
  };

  const selectedNamespace = (): NamespaceOption =>
    namespaceOptions().find((option) => option.id === namespaceId()) ?? namespaceOptions()[0];
```

`createEffect` 的重播种里加一行（编辑时用项目当前值，新建时用 `defaultNamespaceId`）：

```tsx
        setNamespaceId(project ? project.namespaceId : (props.defaultNamespaceId ?? null));
```

提交载荷里加字段：

```tsx
        namespaceId: namespaceId(),
```

表单里、截止日期之前插入控件：

```tsx
            <Select.Root
              options={namespaceOptions()}
              optionValue={(option) => option.id ?? NOT_FILED}
              optionTextValue={(option) => option.name}
              itemToString={(option) => option.name}
              value={selectedNamespace()}
              onChange={(option) => {
                const id = option?.id ?? null;
                // Kobalte fires this once on mount with the initial value, so
                // only a real change counts as a pick — same guard as the
                // quick-add window's selects.
                if (id === namespaceId()) return;
                setNamespaceId(id);
              }}
            >
              <Select.Label>命名空间</Select.Label>
              <Select.Trigger>
                <Select.Value>{selectedNamespace().name}</Select.Value>
                <Select.Icon />
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
            </Select.Root>
```

- [ ] **Step 6: 跑编辑器测试**

Run: `pnpm test src/features/projects/__tests__/project-editor-dialog.test.tsx`
Expected: 全绿

- [ ] **Step 7: 写失败的命名空间编辑器测试**

创建 `src/features/namespaces/__tests__/namespace-editor-dialog.test.tsx`：

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import { NamespaceEditorDialog } from "../components/NamespaceEditorDialog";
import * as hooks from "../hooks";
import * as store from "../store";
import type { Namespace } from "../types";

vi.mock("../hooks", () => ({
  createNamespace: vi.fn(),
  updateNamespace: vi.fn(),
}));

function namespaceFixture(id: string, overrides: Partial<Namespace> = {}): Namespace {
  return {
    id,
    name: `命名空间 ${id}`,
    description: null,
    color: null,
    icon: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function renderDialog(namespace?: Namespace) {
  const onOpenChange = vi.fn();
  render(() => (
    <NamespaceEditorDialog open={true} onOpenChange={onOpenChange} namespace={namespace} />
  ));
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetNamespacesStore();
});

afterEach(cleanup);

describe("NamespaceEditorDialog", () => {
  it("creates a namespace with a trimmed name", async () => {
    vi.mocked(hooks.createNamespace).mockResolvedValue(namespaceFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "  工作  " } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(hooks.createNamespace).toHaveBeenCalledWith({
      name: "工作",
      description: null,
      color: null,
      icon: null,
    });
  });

  it("shows a clear error and skips the backend for a blank name", async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByText("命名空间名不能为空")).toBeTruthy();
    expect(hooks.createNamespace).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("prefills every field in edit mode and submits a patch payload", async () => {
    const existing = namespaceFixture("n9", {
      name: "旧名",
      description: "说明",
      color: "#6366f1",
      icon: "briefcase",
    });
    vi.mocked(hooks.updateNamespace).mockResolvedValue(existing);
    const { onOpenChange } = renderDialog(existing);

    expect(screen.getByText("编辑命名空间")).toBeTruthy();
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("旧名");
    expect((screen.getByLabelText("描述") as HTMLTextAreaElement).value).toBe("说明");

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "新名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(hooks.updateNamespace).toHaveBeenCalledWith("n9", {
      name: "新名",
      description: "说明",
      color: "#6366f1",
      icon: "briefcase",
    });
  });

  it("keeps the dialog open when the backend rejects the write", async () => {
    vi.mocked(hooks.createNamespace).mockResolvedValue(null);
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "会失败" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(hooks.createNamespace).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 8: 写命名空间编辑器**

创建 `src/features/namespaces/components/NamespaceEditorDialog.tsx`（与 `ProjectEditorDialog` 同构，去掉截止日期；颜色与图标走共用的 `ColorSwatches` / `IconPicker`）：

```tsx
import { createEffect, createSignal, on } from "solid-js";
import { z } from "zod";
import {
  Button,
  ColorSwatches,
  Dialog,
  IconPicker,
  TextField,
} from "../../../common/components";
import { createNamespace, updateNamespace } from "../hooks";
import type { Namespace } from "../types";

/**
 * Create/edit namespace dialog. One component covers both modes: pass
 * `namespace` to edit it, omit it to create a new one. Submits through the
 * optimistic hooks; the dialog closes only on success — failures keep the form
 * open and surface a notification (handled by the hooks).
 */

const formSchema = z.object({
  name: z.string().trim().min(1, "命名空间名不能为空"),
});

export interface NamespaceEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Namespace to edit; omit to create a new one. */
  namespace?: Namespace;
}

export function NamespaceEditorDialog(props: NamespaceEditorDialogProps) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [color, setColor] = createSignal<string | null>(null);
  const [icon, setIcon] = createSignal<string | null>(null);
  const [nameError, setNameError] = createSignal<string | undefined>(undefined);
  const [submitting, setSubmitting] = createSignal(false);

  // Re-seed the form whenever the dialog (re)opens or switches namespace.
  createEffect(
    on(
      () => [props.open, props.namespace] as const,
      ([open, namespace]) => {
        if (!open) return;
        setName(namespace?.name ?? "");
        setDescription(namespace?.description ?? "");
        setColor(namespace?.color ?? null);
        setIcon(namespace?.icon ?? null);
        setNameError(undefined);
        setSubmitting(false);
      },
    ),
  );

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = formSchema.safeParse({ name: name() });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message);
      return;
    }

    setNameError(undefined);
    setSubmitting(true);
    try {
      const payload = {
        name: parsed.data.name,
        description: description().trim() ? description().trim() : null,
        color: color(),
        icon: icon(),
      };
      const result = props.namespace
        ? await updateNamespace(props.namespace.id, payload)
        : await createNamespace(payload);
      if (result) props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-labelledby="namespace-editor-title">
          <Dialog.Title id="namespace-editor-title">
            {props.namespace ? "编辑命名空间" : "新建命名空间"}
          </Dialog.Title>
          <Dialog.Description>
            {props.namespace ? "修改命名空间内容后保存" : "命名空间把相关项目收在一起，名称必填"}
          </Dialog.Description>
          <Dialog.CloseButton aria-label="关闭" />

          <form class="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
            <TextField.Root
              value={name()}
              onChange={(value) => {
                setName(value);
                if (nameError()) setNameError(undefined);
              }}
              validationState={nameError() ? "invalid" : "valid"}
            >
              <TextField.Label>名称</TextField.Label>
              <TextField.Input placeholder="例如：工作" />
              <TextField.ErrorMessage>{nameError() ?? ""}</TextField.ErrorMessage>
            </TextField.Root>

            <TextField.Root value={description()} onChange={setDescription}>
              <TextField.Label>描述</TextField.Label>
              <TextField.TextArea placeholder="这组项目的共同点（可选）" />
            </TextField.Root>

            <ColorSwatches value={color()} onChange={setColor} label="命名空间颜色" />
            <IconPicker value={icon()} onChange={setIcon} label="命名空间图标" />

            <div class="mt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={submitting()}>
                {props.namespace ? "保存" : "创建"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 9: 跑测试**

Run: `pnpm test src/features/namespaces src/features/projects && pnpm typecheck`
Expected: 全绿；typecheck 零输出

- [ ] **Step 10: 文档同步 + 提交**

`docs/ARCHITECTURE.md` §2.1 的目录树里，`common/` 下补上这次下沉的三个文件：`icons.ts`（图标表，项目与命名空间共用）、`colors.ts`（预设色板）、`components/palette-picker.tsx`（色板与图标选择器）。

`docs/superpowers/specs/2026-09-15-namespaces-design.md` §6.4(c) 的第一条改成（把「各存活命名空间」这一句补全，说明被编辑项目自己的归档命名空间也在选项里）：

```markdown
- `ProjectEditorDialog` 增加「命名空间」`Select`：选项 = 「不归属」+ 各存活命名空间，**外加被编辑项目自己的命名空间（即使它已归档，带「（已归档）」后缀）**——把它从选项里去掉会让 Select 回落到「不归属」，一次改名保存就把项目悄悄移出了原命名空间。用真哨兵 `"none"` 而不是 `""`，并忽略与当前值相同的 `onChange`（Kobalte 挂载时会带初值触发一次）。
```

```bash
git add src/app/AppShell.tsx src/common/icons.ts src/common/colors.ts src/common/components src/features/projects src/features/namespaces docs/ARCHITECTURE.md docs/superpowers/specs/2026-09-15-namespaces-design.md
git commit -m "feat: pick a namespace when editing a project, and edit namespaces"
```

---

### Task 7: 侧边栏分组

> **顺序变更（实施中裁定）**：本任务在 Task 8 之后执行。任务书里的侧边栏分组行要 `Link` 到 `/namespaces/$namespaceId`，而那条路由由 Task 8 建立——不先有路由，`to` 直接过不了 `tsc`（TS2322），jsdom 里渲染该 `Link` 也会在 `useLinkProps` 抛错。两个任务的其余部分没有依赖，交换顺序即可，产物不受影响。

**Files:**
- Modify: `src/app/AppShell.tsx`（分组导航 + 归档区 + 新建命名空间入口 + 启动加载）
- Create: `src/app/__tests__/app-shell-sidebar.test.tsx`
- Modify: `src/router.tsx`（导出 `routeTree` 供测试构造内存路由）
- Modify: `docs/ARCHITECTURE.md`（§2.1 目录结构加 `features/namespaces/`）

**实施前先读这三条**（Task 7 的 brief 初稿有错，已经在下文修正）：测试文件在 `src/app/__tests__/` 下，所有相对导入与 `vi.mock` 路径都要比「文件在 `src/app/` 下」多一层 `../`；`waitFor` 在该测试里没用到，而 `noUnusedLocals` 会把未使用的导入判为 TS6133，所以不要导入它；`restoreNamespace` 是归档分组恢复按钮要用的，导入块里缺了它。

**Interfaces:**
- Consumes: Task 5 的 `activeNamespaces`、`archivedNamespaces`、`projectsInNamespace`、`ungroupedProjects`、`archivedLooseProjects`、`archivedProjectsOf`、`namespacesState`、`loadAll as loadNamespaces`；Task 6 的 `NamespaceEditorDialog`
- Produces: 侧边栏按命名空间分组；`routeTree` 从 `src/router.tsx` 导出

- [ ] **Step 1: 导出路由树（测试要用）**

`src/router.tsx`：`const routeTree = rootRoute.addChildren([...])` 改成 `export const routeTree = rootRoute.addChildren([...])`。运行时的 `createRouter({ routeTree })` 不变；测试用 `createMemoryHistory` 另建一个 router 实例（TanStack Router 官方的测试做法）。

- [ ] **Step 2: 写失败的侧边栏测试**

创建 `src/app/__tests__/app-shell-sidebar.test.tsx`：

```tsx
/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@solidjs/testing-library";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/solid-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../common/components/__tests__/setup";
import * as namespacesApi from "../../features/namespaces/api";
import { resetNamespacesStore } from "../../features/namespaces/store";
import type { Namespace } from "../../features/namespaces/types";
import * as projectsApi from "../../features/projects/api";
import { resetProjectsStore } from "../../features/projects/store";
import type { Project } from "../../features/projects/types";
import { resetTasksStore } from "../../features/tasks/store";
import { routeTree } from "../../router";

// The shell subscribes to backend events and loads both stores on mount.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../features/namespaces/api", () => ({
  listNamespaces: vi.fn(),
  createNamespace: vi.fn(),
  updateNamespace: vi.fn(),
  archiveNamespace: vi.fn(),
  restoreNamespace: vi.fn(),
}));

vi.mock("../../features/projects/api", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
}));

vi.mock("../../features/tasks/api", () => ({
  listTasks: vi.fn().mockResolvedValue([]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  listTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listSubtasks: vi.fn().mockResolvedValue([]),
  listSubtasksAll: vi.fn().mockResolvedValue([]),
  listDependencies: vi.fn().mockResolvedValue([]),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  completeSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  reorderSubtask: vi.fn(),
}));

function namespace(id: string, name: string, status: "active" | "archived" = "active"): Namespace {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    status,
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
  };
}

function project(
  id: string,
  name: string,
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    dueAt: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function renderShell() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/today"] }),
  });
  render(() => <RouterProvider router={router} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProjectsStore();
  resetNamespacesStore();
  resetTasksStore();
});

afterEach(cleanup);

describe("AppShell sidebar", () => {
  it("nests a namespace's projects and keeps ungrouped ones at the root", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([
      namespace("ns1", "工作"),
      namespace("ns2", "学习"),
    ]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
      project("p2", "移动端", { namespaceId: "ns1" }),
      project("p3", "读论文", { namespaceId: "ns2" }),
      project("p4", "杂事"),
    ]);
    renderShell();

    const group = await screen.findByRole("navigation", { name: "工作 的项目" });
    expect(group.textContent).toContain("网站改版");
    expect(group.textContent).toContain("移动端");
    expect(group.textContent).not.toContain("读论文");
    expect(group.textContent).not.toContain("杂事");

    // Unfiled projects stay in the flat root list, exactly as before.
    const root = screen.getByRole("navigation", { name: "项目列表" });
    expect(root.textContent).toContain("杂事");
    expect(root.textContent).not.toContain("网站改版");
  });

  it("lists an archived namespace's projects under it, not in the flat archive", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([
      namespace("ns1", "工作"),
      namespace("ns2", "旧线", "archived"),
    ]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "归档项目", { status: "archived" }),
      project("p2", "旧线项目", { namespaceId: "ns2" }),
      project("p3", "旧线归档项目", { namespaceId: "ns2", status: "archived" }),
    ]);
    renderShell();

    // Expand the archived section.
    const toggle = await screen.findByRole("button", { name: /已归档/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();

    const group = await screen.findByRole("navigation", { name: "旧线 的项目" });
    expect(group.textContent).toContain("旧线项目");
    expect(group.textContent).toContain("旧线归档项目");

    const flat = screen.getByRole("navigation", { name: "已归档项目" });
    expect(flat.textContent).toContain("归档项目");
    expect(flat.textContent).not.toContain("旧线项目");
  });

  it("shows no namespace rows when there are none", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    renderShell();

    await screen.findByText("杂事");
    expect(screen.queryByRole("navigation", { name: "命名空间列表" })).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test src/app/__tests__/app-shell-sidebar.test.tsx`
Expected: FAIL —— 找不到名为「工作 的项目」的导航区（侧边栏还没有分组）

- [ ] **Step 4: 改侧边栏**

`src/app/AppShell.tsx`：

imports 改为（`getIcon` 来自 `common/icons`；`activeProjects` 不再使用，`noUnusedLocals` 会挡住漏删）：

```tsx
import { getIcon } from "../common/icons";
import { NamespaceEditorDialog } from "../features/namespaces/components/NamespaceEditorDialog";
import { loadAll as loadNamespaces } from "../features/namespaces/hooks";
import {
  activeNamespaces,
  archivedLooseProjects,
  archivedNamespaces,
  archivedProjectsOf,
  namespacesState,
  projectsInNamespace,
  ungroupedProjects,
} from "../features/namespaces/store";
import type { Namespace } from "../features/namespaces/types";
import { restoreNamespace } from "../features/namespaces/hooks";
import { loadAll as loadProjects, restoreProject } from "../features/projects/hooks";
import { archivedProjects, projectsState } from "../features/projects/store";
import type { Project } from "../features/projects/types";
```

在 `Project` 行组件附近加两个模块级组件（把原来内联两次的项目行收敛成一处，分组与归档区共用）：

```tsx
/** One project row. `muted` is the archived variant: dimmer text, same layout. */
function ProjectLink(props: { project: Project; collapsed: boolean; muted?: boolean }) {
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: props.project.id }}
      class={`${navRowClass(props.collapsed)} min-w-0 flex-1 ${
        props.muted
          ? "text-subtle-foreground hover:text-muted-foreground"
          : "text-muted-foreground hover:text-foreground"
      } hover:bg-surface-hover`}
      activeProps={{
        class: `${navRowClass(props.collapsed)} min-w-0 flex-1 bg-primary/10 font-medium text-primary`,
        "aria-current": "page",
      }}
      title={props.project.name}
    >
      <span
        class="shrink-0"
        style={props.project.color ? { color: props.project.color } : undefined}
      >
        <Dynamic component={getIcon(props.project.icon)} size={16} />
      </span>
      <Show when={!props.collapsed}>
        <span class="min-w-0 truncate">{props.project.name}</span>
      </Show>
    </Link>
  );
}

/** Namespace group header: chevron toggles the group, the name navigates. */
function NamespaceRow(props: {
  namespace: Namespace;
  collapsed: boolean;
  open: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <div class="flex items-center gap-0.5">
      <button
        type="button"
        aria-expanded={props.open}
        aria-label={`${props.open ? "收起" : "展开"}命名空间 ${props.namespace.name}`}
        class={iconButtonClass}
        onClick={props.onToggle}
      >
        <ChevronDown
          size={12}
          aria-hidden="true"
          class="transition-transform duration-200 ease-out"
          classList={{ "-rotate-90": !props.open }}
        />
      </button>
      <Link
        to="/namespaces/$namespaceId"
        params={{ namespaceId: props.namespace.id }}
        class={`${navRowClass(props.collapsed)} min-w-0 flex-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground`}
        activeProps={{
          class: `${navRowClass(props.collapsed)} min-w-0 flex-1 bg-primary/10 font-medium text-primary`,
          "aria-current": "page",
        }}
        title={props.namespace.name}
      >
        <span
          class="shrink-0"
          style={props.namespace.color ? { color: props.namespace.color } : undefined}
        >
          <Dynamic component={getIcon(props.namespace.icon)} size={16} />
        </span>
        <Show when={!props.collapsed}>
          <span class="min-w-0 flex-1 truncate">{props.namespace.name}</span>
          <span class="shrink-0 text-xs tabular-nums text-subtle-foreground">{props.count}</span>
        </Show>
      </Link>
    </div>
  );
}
```

组件内的状态与加载改为：

```tsx
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingProject, setEditingProject] = createSignal<Project | null>(null);
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  const [namespaceEditorOpen, setNamespaceEditorOpen] = createSignal(false);
  // Collapsed namespaces, by id. Local on purpose: like `archivedOpen`, this is
  // view state, not data — nothing else needs it and it must not survive a
  // restart as a surprise.
  const [collapsedGroups, setCollapsedGroups] = createSignal<ReadonlySet<string>>(new Set());

  const groupOpen = (namespaceId: string) => !collapsedGroups().has(namespaceId);
  const toggleGroup = (namespaceId: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(namespaceId)) next.delete(namespaceId);
      else next.add(namespaceId);
      return next;
    });

  // The sidebar always shows namespaces and projects, so the root shell owns
  // the one-shot initial loads (retried by navigation remounts until they
  // succeed) and the app-lifetime reminder event subscription.
  onMount(() => {
    if (!namespacesState.loaded) void loadNamespaces();
    if (!projectsState.loaded) void loadProjects();
    void subscribeToReminders();
    listen(EVENTS.taskCreated, () => void reloadTasks()).catch(() => {});
  });
```

原来那个 `projectIcon` 局部函数删掉（`ProjectLink` 内联了同样的渲染）。

「项目」区（现 182-271 行的那个 `div.mt-4.min-h-0.flex-1` 块）整块替换为：

```tsx
        <div class="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <Show
            when={!collapsed()}
            fallback={<div class="mx-auto mt-2 w-6 border-t border-border" aria-hidden="true" />}
          >
            <div class="flex items-center justify-between pb-1 pl-2.5 pr-0.5">
              <p class="text-xs text-subtle-foreground">项目</p>
              <button
                type="button"
                aria-label="新建项目"
                title="新建项目"
                class={iconButtonClass}
                onClick={openCreateProject}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </Show>

          <Show when={activeNamespaces().length > 0}>
            <nav aria-label="命名空间列表" class="flex flex-col gap-0.5">
              <For each={activeNamespaces()}>
                {(namespace) => (
                  <div class="flex flex-col gap-0.5">
                    <NamespaceRow
                      namespace={namespace}
                      collapsed={collapsed()}
                      open={groupOpen(namespace.id)}
                      count={projectsInNamespace(namespace.id).length}
                      onToggle={() => toggleGroup(namespace.id)}
                    />
                    <Show when={!collapsed() && groupOpen(namespace.id)}>
                      <nav
                        aria-label={`${namespace.name} 的项目`}
                        class="ml-3.5 flex flex-col gap-0.5 border-l border-border pl-1.5"
                      >
                        <For each={projectsInNamespace(namespace.id)}>
                          {(project) => <ProjectLink project={project} collapsed={collapsed()} />}
                        </For>
                      </nav>
                    </Show>
                  </div>
                )}
              </For>
            </nav>
          </Show>

          <Show when={!collapsed()}>
            <button
              type="button"
              class="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-muted-foreground focus-ring"
              onClick={openCreateNamespace}
            >
              <Plus size={12} aria-hidden="true" />
              新建命名空间
            </button>
          </Show>

          <nav aria-label="项目列表" class="mt-0.5 flex flex-col gap-0.5">
            <For each={ungroupedProjects()}>
              {(project) => <ProjectLink project={project} collapsed={collapsed()} />}
            </For>
          </nav>

          <Show when={!collapsed() && ungroupedProjects().length === 0 && activeNamespaces().length === 0}>
            <p class="px-2.5 py-1 text-xs text-subtle-foreground">暂无项目</p>
          </Show>

          <Show when={!collapsed() && (archivedProjects().length > 0 || archivedNamespaces().length > 0)}>
            <button
              type="button"
              class="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-muted-foreground focus-ring"
              aria-expanded={archivedOpen()}
              onClick={() => setArchivedOpen(!archivedOpen())}
            >
              <ChevronDown
                size={12}
                aria-hidden="true"
                class="transition-transform duration-200 ease-out"
                classList={{ "-rotate-90": !archivedOpen() }}
              />
              已归档 ({archivedProjects().length + archivedNamespaces().length})
            </button>
            <Show when={archivedOpen()}>
              <nav aria-label="已归档命名空间" class="mt-0.5 flex flex-col gap-0.5">
                <For each={archivedNamespaces()}>
                  {(namespace) => (
                    <div class="flex flex-col gap-0.5">
                      <div class="flex items-center gap-0.5">
                        <NamespaceRow
                          namespace={namespace}
                          collapsed={collapsed()}
                          open={groupOpen(namespace.id)}
                          count={archivedProjectsOf(namespace.id).length}
                          onToggle={() => toggleGroup(namespace.id)}
                        />
                        <button
                          type="button"
                          aria-label={`恢复命名空间 ${namespace.name}`}
                          title="恢复命名空间"
                          class={iconButtonClass}
                          onClick={() => void restoreNamespace(namespace.id)}
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                        </button>
                      </div>
                      <Show when={groupOpen(namespace.id)}>
                        <nav
                          aria-label={`${namespace.name} 的项目`}
                          class="ml-3.5 flex flex-col gap-0.5 border-l border-border pl-1.5"
                        >
                          <For each={archivedProjectsOf(namespace.id)}>
                            {(project) => (
                              <ProjectLink project={project} collapsed={collapsed()} muted />
                            )}
                          </For>
                        </nav>
                      </Show>
                    </div>
                  )}
                </For>
              </nav>

              <nav aria-label="已归档项目" class="mt-0.5 flex flex-col gap-0.5">
                <For each={archivedLooseProjects()}>
                  {(project) => (
                    <div class="group flex items-center gap-0.5">
                      <ProjectLink project={project} collapsed={collapsed()} muted />
                      <button
                        type="button"
                        aria-label={`恢复项目 ${project.name}`}
                        title="恢复项目"
                        class={`${iconButtonClass} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
                        onClick={() => void restoreProject(project.id)}
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </For>
              </nav>
            </Show>
          </Show>
        </div>
```

新增处理函数（`openCreateProject` 旁边）：

```tsx
  // Create only: renaming and archiving a namespace live on its own page, so
  // the sidebar stays a navigation surface.
  const openCreateNamespace = () => setNamespaceEditorOpen(true);
```

并在组件末尾（`ProjectEditorDialog` 之后）挂载：

```tsx
      <NamespaceEditorDialog
        open={namespaceEditorOpen()}
        onOpenChange={setNamespaceEditorOpen}
      />
```

- [ ] **Step 5: 跑测试**

Run: `pnpm test src/app/__tests__/app-shell-sidebar.test.tsx && pnpm typecheck`
Expected: 三条 PASS；typecheck 零输出

- [ ] **Step 6: 文档同步 + 提交**

`docs/ARCHITECTURE.md` §2.1 的目录树里，`namespaces/` 与 `namespaces/components/` 两行**已经由 Task 8 加好了**（Task 8 的组件清单需要那个目录先存在）。所以这一步只做一件事：把这两行的说明补成覆盖本任务的组件，例如把 `components/` 那行写成 `NamespaceEditorDialog / NamespaceProjectsView / NamespaceDetailView`。**不要重复添加目录行**，否则树里会出现两条 `namespaces/`。

并在 §2.2 或 §2.5 之后补一句分组规则（放在 §2.4 路由之前）：

```markdown
**命名空间分组是派生量**：侧边栏与命名空间页都从 store 派生——`projectsInNamespace(id)`（存活命名空间下的 active 项目）、`ungroupedProjects()`（未归属 + 命名空间已消失的孤儿）、`archivedLooseProjects()` / `archivedProjectsOf(id)`（已归档区的平铺与嵌套口径）。判定归属用**存活命名空间集合**而不是 `namespaceId` 是否为空，所以命名空间被删掉时它的项目回落为「未归属」显示在根级，而不是从导航里消失。每个项目只出现在一处：分组行、根级平铺、已归档平铺、或已归档分组，四者互斥。
```

```bash
git add src/app/AppShell.tsx src/app/__tests__/app-shell-sidebar.test.tsx src/router.tsx docs/ARCHITECTURE.md
git commit -m "feat: group the sidebar by namespace"
```

---

### Task 8: 命名空间页与路由

> **顺序变更（实施中裁定）**：本任务先于 Task 7 执行，见 Task 7 开头的说明。完成后 Task 7 的侧边栏分组行才有可用的路由目标。

**Files:**
- Create: `src/features/namespaces/components/NamespaceProjectsView.tsx`（纯 props 驱动，可脱离路由测试）
- Create: `src/features/namespaces/components/NamespaceDetailView.tsx`（路由壳：读参数 + 加载兜底，照 `ProjectDetailView`）
- Create: `src/features/namespaces/__tests__/namespace-projects-view.test.tsx`
- Modify: `src/router.tsx`（`/namespaces/$namespaceId` 懒加载路由）
- Modify: `docs/PRD.md`（§2.2 命名空间小节）、`docs/ARCHITECTURE.md`（§2.4 路由）

**Interfaces:**
- Consumes: Task 5 的 store/hooks、Task 6 的 `NamespaceEditorDialog`、既有 `ProjectProgress`、`ProjectEditorDialog`、`EmptyState`、`DropdownMenu`、`Button`
- Produces: 路由 `/namespaces/$namespaceId`；`NamespaceProjectsView`（props: `{ namespace: Namespace }`）；`NamespaceDetailView`

- [ ] **Step 1: 写失败的页面测试**

创建 `src/features/namespaces/__tests__/namespace-projects-view.test.tsx`：

```tsx
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import * as projectsStore from "../../projects/store";
import type { Project } from "../../projects/types";
import { resetTasksStore, setAll as setTasks } from "../../tasks/store";
import type { Task } from "../../tasks/types";
import { NamespaceProjectsView } from "../components/NamespaceProjectsView";
import * as hooks from "../hooks";
import * as store from "../store";
import type { Namespace } from "../types";

// The rows link to the project page; a plain anchor keeps this test free of
// router plumbing (the AppShell test owns the real router).
vi.mock("@tanstack/solid-router", () => ({
  Link: (props: { children?: unknown }) => <a href="#">{props.children as never}</a>,
}));

vi.mock("../hooks", () => ({
  archiveNamespace: vi.fn(),
  restoreNamespace: vi.fn(),
}));

vi.mock("../../projects/hooks", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
}));

function namespaceFixture(overrides: Partial<Namespace> = {}): Namespace {
  return {
    id: "ns1",
    name: "工作",
    description: "主线项目",
    color: null,
    icon: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    description: null,
    color: null,
    icon: null,
    namespaceId: "ns1",
    dueAt: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function task(id: string, projectId: string | null, completed = false): Task {
  return {
    id,
    projectId,
    title: `任务 ${id}`,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt: completed ? "2026-09-15T10:00:00Z" : null,
    repeatRule: null,
    complexity: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetNamespacesStore();
  projectsStore.resetProjectsStore();
  resetTasksStore();
  store.setAll([namespaceFixture()]);
});

afterEach(cleanup);

describe("NamespaceProjectsView", () => {
  it("aggregates the group's task progress from the live stores", () => {
    projectsStore.setAll([project("p1"), project("p2")]);
    setTasks(
      [task("t1", "p1", true), task("t2", "p1"), task("t3", "p2"), task("t4", null)],
      [],
    );

    render(() => <NamespaceProjectsView namespace={namespaceFixture()} />);

    expect(screen.getByText("工作")).toBeTruthy();
    expect(screen.getByText("主线项目")).toBeTruthy();
    // 1 of 3 tasks in the group is done; the inbox task is not counted.
    expect(screen.getByText("1 / 3 已完成")).toBeTruthy();
  });

  it("shows the empty state and creates a project inside the namespace", async () => {
    render(() => <NamespaceProjectsView namespace={namespaceFixture()} />);

    expect(screen.getByText("这个命名空间还没有项目")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    // The editor opens prefilled with this namespace.
    // Select.Label names the trigger, so it is reachable by its accessible name.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /命名空间/ })).toBeTruthy(),
    );
  });

  it("archives the namespace from the header", async () => {
    projectsStore.setAll([project("p1")]);
    vi.mocked(hooks.archiveNamespace).mockResolvedValue(null);
    render(() => <NamespaceProjectsView namespace={namespaceFixture()} />);

    fireEvent.click(screen.getByRole("button", { name: "归档命名空间" }));

    await waitFor(() => expect(hooks.archiveNamespace).toHaveBeenCalledWith("ns1"));
  });

  it("offers restore instead of archive on an archived namespace", () => {
    render(() => (
      <NamespaceProjectsView namespace={namespaceFixture({ status: "archived" })} />
    ));

    expect(screen.getByRole("button", { name: "恢复命名空间" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "归档命名空间" })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/features/namespaces/__tests__/namespace-projects-view.test.tsx`
Expected: FAIL —— `../components/NamespaceProjectsView` 不存在

- [ ] **Step 3: 写页面**

创建 `src/features/namespaces/components/NamespaceProjectsView.tsx`：

```tsx
import { For, Show, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Link } from "@tanstack/solid-router";
import { Archive, FolderKanban, MoreHorizontal, Pencil, Plus, RotateCcw } from "lucide-solid";
import { Button, DropdownMenu, EmptyState, iconButtonClass } from "../../../common/components";
import { getIcon } from "../../../common/icons";
import { tasksState } from "../../tasks/store";
import { ProjectEditorDialog } from "../../projects/components/ProjectEditorDialog";
import { ProjectProgress } from "../../projects/components/ProjectProgress";
import { archiveProject, updateProject } from "../../projects/hooks";
import type { Project } from "../../projects/types";
import { archiveNamespace, restoreNamespace } from "../hooks";
import { getNamespace, projectsInNamespace } from "../store";
import type { Namespace } from "../types";
import { NamespaceEditorDialog } from "./NamespaceEditorDialog";

/**
 * Namespace work area: the group's identity header with an aggregate progress
 * summary, and the projects filed under it.
 *
 * Every number derives from the live stores (projects + tasks), so completing a
 * task moves the group's bar in the same tick — no backend aggregation command
 * and no refresh window. Archived projects are managed from the sidebar's
 * archived section, so this page lists active ones only: one place per project.
 */
export function NamespaceProjectsView(props: { namespace: Namespace }) {
  // Prefer the live store row so optimistic patches (renames, archive flips)
  // update the header immediately; fall back to the opening snapshot.
  const namespace = createMemo(() => getNamespace(props.namespace.id) ?? props.namespace);
  const projects = createMemo(() => projectsInNamespace(namespace().id));

  /** Tasks across every project in the group — the aggregate progress input. */
  const tasks = createMemo(() => {
    const ids = new Set(projects().map((project) => project.id));
    return tasksState.tasks.filter((task) => task.projectId !== null && ids.has(task.projectId));
  });

  const tasksOf = (projectId: string) =>
    tasksState.tasks.filter((task) => task.projectId === projectId);

  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingProject, setEditingProject] = createSignal<Project | null>(null);
  const [namespaceEditorOpen, setNamespaceEditorOpen] = createSignal(false);

  const openCreate = () => {
    setEditingProject(null);
    setEditorOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingProject(project);
    setEditorOpen(true);
  };

  return (
    <div class="flex h-full min-h-0 flex-col">
      <header class="shrink-0 px-5 pb-4 pt-5">
        <div class="flex items-start gap-3.5">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-lg"
            style={{
              "background-color": namespace().color
                ? `color-mix(in srgb, ${namespace().color} 18%, transparent)`
                : "var(--surface-hover)",
              color: namespace().color ?? "var(--muted-foreground)",
            }}
          >
            <Dynamic component={getIcon(namespace().icon)} size={20} />
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <h2 class="truncate text-lg font-semibold tracking-tight text-foreground">
                {namespace().name}
              </h2>
              <Show when={namespace().status === "archived"}>
                <span class="shrink-0 rounded-sm bg-surface-hover px-1.5 py-0.5 text-2xs text-muted-foreground">
                  已归档
                </span>
              </Show>
            </div>
            <Show when={namespace().description}>
              {(description) => (
                <p class="mt-1 text-sm text-muted-foreground">{description()}</p>
              )}
            </Show>

            <div class="mt-3.5 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setNamespaceEditorOpen(true)}
              >
                <Pencil size={13} aria-hidden="true" />
                编辑
              </Button>
              <Show
                when={namespace().status === "archived"}
                fallback={
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="归档命名空间"
                    onClick={() => void archiveNamespace(namespace().id)}
                  >
                    <Archive size={13} aria-hidden="true" />
                    归档
                  </Button>
                }
              >
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="恢复命名空间"
                  onClick={() => void restoreNamespace(namespace().id)}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  恢复
                </Button>
              </Show>
            </div>
          </div>
        </div>

        <div class="mt-4">
          <p class="pb-2 text-xs text-subtle-foreground">
            {projects().length} 个项目 · 汇总进度
          </p>
          <ProjectProgress tasks={tasks()} dueAt={null} />
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <Show
          when={projects().length > 0}
          fallback={
            <EmptyState
              icon={<FolderKanban size={22} aria-hidden="true" />}
              title="这个命名空间还没有项目"
              description="把相关的项目放进来，就能在一处看到整组的进度。"
              action={
                <Button size="sm" onClick={openCreate}>
                  <Plus size={14} aria-hidden="true" />
                  新建项目
                </Button>
              }
            />
          }
        >
          <ul class="flex flex-col gap-2">
            <For each={projects()}>
              {(project) => (
                <li class="flex items-start gap-3 rounded-lg border border-border bg-surface px-3.5 py-3">
                  <span
                    class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md"
                    style={{
                      "background-color": project.color
                        ? `color-mix(in srgb, ${project.color} 18%, transparent)`
                        : "var(--surface-hover)",
                      color: project.color ?? "var(--muted-foreground)",
                    }}
                  >
                    <Dynamic component={getIcon(project.icon)} size={16} />
                  </span>

                  <div class="min-w-0 flex-1">
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      class="rounded-sm text-sm font-medium text-foreground transition-colors hover:text-primary focus-ring"
                    >
                      {project.name}
                    </Link>
                    <div class="mt-1.5">
                      <ProjectProgress tasks={tasksOf(project.id)} dueAt={project.dueAt} />
                    </div>
                  </div>

                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      class={iconButtonClass}
                      aria-label={`项目操作 ${project.name}`}
                    >
                      <MoreHorizontal size={15} aria-hidden="true" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item onSelect={() => openEdit(project)}>
                          编辑项目
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onSelect={() => void updateProject(project.id, { namespaceId: null })}
                        >
                          移出命名空间
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => void archiveProject(project.id)}>
                          归档项目
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <ProjectEditorDialog
        open={editorOpen()}
        onOpenChange={setEditorOpen}
        project={editingProject() ?? undefined}
        defaultNamespaceId={namespace().id}
      />

      <NamespaceEditorDialog
        open={namespaceEditorOpen()}
        onOpenChange={setNamespaceEditorOpen}
        namespace={namespace()}
      />
    </div>
  );
}
```

创建 `src/features/namespaces/components/NamespaceDetailView.tsx`：

```tsx
import { Show, createSignal, onMount } from "solid-js";
import { useParams } from "@tanstack/solid-router";
import { Button } from "../../../common/components";
import PlaceholderView from "../../../app/PlaceholderView";
import { loadAll as loadProjects } from "../../projects/hooks";
import { projectsState } from "../../projects/store";
import { loadAll as loadNamespaces } from "../hooks";
import { getNamespace, namespacesState } from "../store";
import { NamespaceProjectsView } from "./NamespaceProjectsView";

/**
 * Route wrapper for `/namespaces/$namespaceId`: guards the one-shot loads
 * (a deep link can land here first), resolves the live namespace row and hands
 * off to the group work area.
 */
export function NamespaceDetailView() {
  const params = useParams({ from: "/namespaces/$namespaceId" });
  const [failed, setFailed] = createSignal(false);

  onMount(() => {
    if (!namespacesState.loaded) void retry();
  });

  async function retry(): Promise<void> {
    setFailed(false);
    // Projects carry the membership, so the group cannot render without them.
    if (!projectsState.loaded) void loadProjects();
    const ok = await loadNamespaces();
    setFailed(!ok);
  }

  const namespace = () => getNamespace(params().namespaceId);

  return (
    <Show
      when={!failed()}
      fallback={
        <div
          role="alert"
          class="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-8 text-center"
        >
          <h2 class="text-base font-semibold text-foreground">加载失败</h2>
          <p class="text-sm text-muted-foreground">命名空间数据加载失败，请重试。</p>
          <Button variant="secondary" size="sm" onClick={() => void retry()}>
            重试
          </Button>
        </div>
      }
    >
      <Show
        when={namespace()}
        fallback={
          <Show
            when={namespacesState.loaded}
            fallback={<p role="status" class="p-8 text-sm text-muted-foreground">加载中…</p>}
          >
            <PlaceholderView title="命名空间不存在" description="该命名空间不存在或已被删除。" />
          </Show>
        }
      >
        {(namespace) => <NamespaceProjectsView namespace={namespace()} />}
      </Show>
    </Show>
  );
}
```

- [ ] **Step 4: 加路由**

`src/router.tsx`：在 `projectDetailRoute` 之后加

```tsx
const namespaceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/namespaces/$namespaceId",
  component: lazyRouteComponent(
    () => import("./features/namespaces/components/NamespaceDetailView"),
    "NamespaceDetailView",
  ),
});
```

并把它加进 `rootRoute.addChildren([...])` 的数组（`projectDetailRoute,` 之后）。

- [ ] **Step 5: 跑测试**

Run: `pnpm test src/features/namespaces && pnpm typecheck`
Expected: 全绿；typecheck 零输出

- [ ] **Step 6: 文档同步 + 提交**

`docs/PRD.md` §2.2 末尾（「项目级能力」之后）新增小节：

```markdown
**命名空间（项目分组）：**

- 命名空间是把多个相关项目收在一起的容器（单层，一个项目至多归属一个；不归属的项目留在根级）。
- 侧边栏按命名空间分组显示项目，分组可折叠；命名空间可归档与恢复，归档只影响导航与分组，**不**改变其下项目的状态。
- 命名空间页展示该组项目列表与汇总进度（项目数、任务完成率）；
- 归档项目不进命名空间页（在侧边栏「已归档」区管理）；项目可从命名空间移出（回到根级）。
```

`docs/ARCHITECTURE.md` §2.4 路由清单加一行 `/namespaces/:namespaceId`，并在 §2.1 目录树里把 `namespace` 组件的说明补全（`NamespaceProjectsView` / `NamespaceDetailView` / `NamespaceEditorDialog`）。

```bash
git add src/features/namespaces src/router.tsx docs/PRD.md docs/ARCHITECTURE.md
git commit -m "feat: add the namespace page and its route"
```

---

### Task 9: 收口（全量验证 + 文档状态回写）

**Files:**
- Modify: `docs/IMPLEMENTATION_PLAN.md`（M9 里程碑、命令清单、§5 依赖关系、版本/日期）
- Modify: `docs/PRD.md`（状态行日期）、`docs/ARCHITECTURE.md`（版本/日期）
- Modify: `AGENTS.md`（一条 gotcha）

**Interfaces:**
- Consumes: 前八个任务的全部产出
- Produces: 全绿的五条出口命令；文档与代码一致

- [ ] **Step 1: 后端出口**

```bash
cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test
```

Expected: `cargo fmt` 无输出（或只格式化后无 diff）、`clippy` 零警告、`cargo test` 全绿

- [ ] **Step 2: 前端出口**

```bash
pnpm typecheck && pnpm test
```

Expected: `tsc` 零输出；Vitest 全绿

- [ ] **Step 3: 手工验证**

Run: `pnpm tauri dev`

1. 侧边栏「项目」区出现「+ 新建命名空间」→ 新建「工作」（选颜色）→ 出现分组行，计数 `(0)`；
2. 新建项目，在编辑器里选命名空间「工作」→ 该项目出现在「工作」分组下，且不再出现在根级平铺列表；
3. 点分组名字 → 进入命名空间页：项目行 + 每行进度条 + 头部汇总；勾选该项目下的任务 → 头部与行的进度条同 tick 前进；
4. 命名空间页行内菜单「移出命名空间」→ 项目回到侧边栏根级；
5. 「归档命名空间」→ 分组离开导航、进入「已归档」；展开它 → 其下项目缩进列出；其项目自身状态未变（`项目 → 已归档` 区里没有它们）；「恢复命名空间」→ 分组回到导航；
6. 归档一个项目（该项目属于存活命名空间）→ 它出现在「已归档」平铺列表，而不是分组里；恢复后回到分组；
7. 导出备份 → 新建命名空间并重新归档项目 → 导入备份 → 分组、归属与归档状态全部恢复（重开应用确认）；
8. 用旧备份文件（本次改动前导出的）导入 → 不报错，所有项目位于根级。

- [ ] **Step 4: 文档回写**

`docs/IMPLEMENTATION_PLAN.md`：

- §2 里程碑总览表加一行：

| M9 命名空间 | 命名空间容器（项目分组）+ 侧边栏分组 + 命名空间页汇总 | PRD 2.2 命名空间 | 分组可导航；归档不级联；汇总随任务实时更新 |

- §4 新增「M9 命名空间」小节：

```markdown
### M9 命名空间（v1 迭代）

命名空间是把多个相关项目收在一起的容器（单层，项目至多归属一个）。范围只到「组织 + 导航 + 一个汇总页」：任务视图、搜索、统计口径不变。

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| NS-01 | 迁移与模型 | `V5__namespaces.sql`（`namespaces` 表 + `projects.namespace_id` 可空外键 + 索引）；`Namespace`/`NewNamespace`/`UpdateNamespace`；项目读写带上该列 | 旧库升级后既有项目 `namespace_id` 为 NULL；项目带归属的往返正确 | F-05/06 | ✅ |
| NS-02 | 命名空间后端 | `repositories::namespaces`；`services::{list,create,update,archive,restore}_namespace`；`namespace:*` 五个命令；`project:*` 校验 `namespaceId` 存在且未软删；备份升到 v3 并携带命名空间 | 归档/恢复幂等且不级联其下项目；未知命名空间返回 not_found；v2 备份仍可导入且项目落在根级 | NS-01 | ✅ |
| NS-03 | 前端数据层与编辑器 | `features/namespaces/{types,api,store,hooks}`；分组派生（`projectsInNamespace` / `ungroupedProjects` / `archivedLooseProjects` / `archivedProjectsOf`）；项目编辑器的命名空间选择；`NamespaceEditorDialog`；图标表下沉 `common/icons.ts` | 派生按存活命名空间判定，孤儿项目回落根级；乐观更新与回滚符合规范 | NS-02 | ✅ |
| NS-04 | 侧边栏分组与命名空间页 | `AppShell` 分组导航 + 归档区 + 新建入口；`/namespaces/$namespaceId` 页面（组内项目列表 + 汇总进度 + 行内菜单） | 每个项目只出现在一处；汇总随任务完成同 tick 更新；归档命名空间可从归档区恢复 | NS-03 | ✅ |

M9 出口：分组可导航、归档不级联、汇总实时；`cargo test` / `cargo fmt` / `cargo clippy` / `pnpm test` / `pnpm typecheck` 全绿。
```

- §5 依赖关系图下加一条：`M9 只依赖 M2 的项目域（P-03），与 M3–M8 没有顺序依赖，可以在 M2 之后随时插入。`

`AGENTS.md` 的 gotcha 清单里加一条：

```markdown
- **侧边栏按命名空间分组，判定归属用的是「存活命名空间集合」而不是 `namespaceId` 是否为空**（`src/features/namespaces/store.ts`）。所以命名空间被软删/不存在时，其项目回落为「未归属」显示在根级，而不是从导航里消失；**归档**命名空间仍算存活——它的项目缩进显示在侧边栏「已归档」区。每个项目只出现在一处（分组行 / 根级平铺 / 已归档平铺 / 已归档分组），改动这几个派生时要一起想清楚。
```

三个文档的「更新日期」改成 `2026-09-15`。

- [ ] **Step 5: 提交**

```bash
git add docs/IMPLEMENTATION_PLAN.md docs/PRD.md docs/ARCHITECTURE.md AGENTS.md
git commit -m "docs: record the namespace milestone and the grouping rule"
```

---

## 附：任务之间的依赖关系

- Task 1 是其余全部任务的前置（表 + 模型 + 项目的归属列）。
- Task 2 依赖 Task 1；Task 3 依赖 Task 2（`namespaces::get`）；Task 4 依赖 Task 2（导出/导入要写命名空间行）。
- Task 5 依赖 Task 2（命令常量）与 Task 1（`Project.namespaceId` 的契约）；Task 6 依赖 Task 5；Task 7、8 都依赖 Task 5，并按 **Task 8 → Task 7** 的顺序执行（侧边栏分组行的 `Link` 需要 Task 8 建立的路由才编译得过）。
- Task 9 是唯一的收口任务：跑全量命令、手工验证并回写 IMPLEMENTATION_PLAN / AGENTS。
- 后端（Task 1–4）与前端（Task 5–8）之间唯一的接口是 IPC 契约与 JSON 字段名，全部在前面的任务里写死，不需要并行协作。

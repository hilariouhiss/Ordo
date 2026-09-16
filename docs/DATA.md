# Ordo 数据模型与演化

> 本文描述 Ordo 的**存储形态**：表与字段、序列化约定、迁移史、索引、备份格式与统计口径。SQL 只写在 `src-tauri/src/repositories.rs`（见 [ARCHITECTURE.md](./ARCHITECTURE.md)§3.1）；DDL 的唯一出处在 `src-tauri/migrations/`。

## 1. 全局约定

| 约定 | 内容 |
| --- | --- |
| 主键 | `TEXT`，UUID v4，由 Rust 后端生成（前端不生成主键） |
| 时间戳 | ISO-8601 UTC 字符串，由 Rust 后端生成；rusqlite 实际写入形如 `YYYY-MM-DD HH:MM:SS.SSS+00:00` |
| 软删除 | 可空 `deleted_at`，查询默认过滤 `deleted_at IS NULL`；不用硬 `DELETE` |
| 排序 | 字典序字符串键（fractional indexing），字母表 `'a'..'z'`，单键长度上限 32 字符 |
| 外键 | `PRAGMA foreign_keys = ON`（V1 打开，`db.rs` 在启动时断言确实生效） |
| 迁移 | refinery 内嵌 `src-tauri/migrations/V<N>__<name>.sql`，连接建立时执行；**永不修改已应用的迁移** |

**排序键的范围（scope）**——同一个 `sort_order` 字母表被多个互不相同的兄弟集合复用：

- 顶层任务：同一 `column_id` **且** `parent_task_id IS NULL`
- 子任务：同一 `parent_task_id`
- 看板列：同一 `project_id`（列用 `position` 列名）
- 项目：全局一条列表；命名空间：全局一条列表

`IS NULL` 谓词是承重的：子任务的 `column_id` 为空，少了它，无列的顶层任务会插进子任务的键区间。键耗尽（相邻无中间值）或长度超过 32 时，用 `spread` 对**该范围内的全部兄弟行**重排。

## 2. 表与字段

最终形态（V1–V9 全部应用后）共 11 张表 + 2 张 FTS5 虚表。

### 2.1 业务实体

| 表 | 字段 | 说明 |
| --- | --- | --- |
| **`namespaces`** (V5) | `id` `name` `description` `color` `icon` `status` `sort_order` `created_at` `updated_at` `deleted_at` | `status` 为 `active`/`archived`。命名空间没有"上级"，也没有截止日期 |
| **`projects`** (V2, V5, V6) | `id` `name` `description` `color` `icon` `namespace_id` `status` `sort_order` `created_at` `updated_at` `deleted_at` | `namespace_id` 可空 → 根级；`status` 为 `active`/`archived`；**无 `due_at`**（V6 删除） |
| **`board_columns`** (V2) | `id` `project_id` `name` `position` `is_done` `created_at` `updated_at` `deleted_at` | 每个项目固定三行；`position` 是字典序键（唯一用 `position` 而非 `sort_order` 的有序实体）；`is_done` 标记完成列 |
| **`tasks`** (V2, V4, V7) | `id` `project_id` `parent_task_id` `title` `note` `priority` `column_id` `due_at` `completed_at` `repeat_rule` `complexity` `sort_order` `created_at` `updated_at` `deleted_at` | 见下 |
| **`tags`** (V2) | `id` `name` `color` `created_at` `updated_at` `deleted_at` | `name` 是 `TEXT NOT NULL COLLATE NOCASE UNIQUE`；标签全局共享 |
| **`task_tags`** (V2) | `task_id` `tag_id` | 纯连接表：复合主键、无 UUID/审计列、`WITHOUT ROWID` |
| **`comments`** (V2) | `id` `task_id` `body` `created_at` `updated_at` `deleted_at` | |
| **`time_entries`** (V2) | `id` `task_id` `started_at` `ended_at` `duration` `created_at` `updated_at` `deleted_at` | `duration` 单位**秒**（`CHECK duration >= 0`）；`ended_at IS NULL` = 正在计时 |
| **`settings`** (V2) | `key` `value` `updated_at` | 键值表：TEXT 主键、无 UUID/`created_at`/`deleted_at`。**目前只被备份的导出/导入读写**（没有 `settings:*` 命令，见 [ARCHITECTURE.md](./ARCHITECTURE.md)§3.2） |

`tasks` 的外键语义：

- `project_id` → `projects(id)` `ON DELETE SET NULL`，可空（空 = 收件箱任务）。
- `parent_task_id` → `tasks(id)` `ON DELETE CASCADE`，可空（非空 = 子任务）。**层级只有一层**，由服务层把关而不是数据库。
- `column_id` → `board_columns(id)` `ON DELETE SET NULL`，可空；子任务的 `column_id` 恒为空（不上看板）。
- `priority` 为 `CHECK IN ('high','medium','low','none')`，默认 `none`。
- `complexity` 为 `CHECK (complexity IS NULL OR complexity BETWEEN 1 AND 5)`；`NULL` = 未评估。
- `repeat_rule` 是 JSON 文本（见 §2.4）。

> 任务只有软删除路径、没有硬删除命令，所以 `ON DELETE CASCADE` 在 `parent_task_id` 上是装饰性的；服务层用显式的级联软删/恢复来维护父子一致（见 §3）。

### 2.2 关系表

| 表 | 字段 | 说明 |
| --- | --- | --- |
| **`task_dependencies`** (V4, V7 合并) | `task_id` `depends_on` `created_at` | 复合主键 `(task_id, depends_on)`、`CHECK (task_id <> depends_on)`、`WITHOUT ROWID`；读作「`task_id` 等待 `depends_on`」 |
| **`task_reminders`** (V3, V7 合并) | `task_id` `kind` `sent_at` | 主键 `(task_id, kind)`、`WITHOUT ROWID`、`kind CHECK IN ('advance_1h','advance_10m','due')`；随任务硬删级联 |

**边的方向是「依赖方 → 前置」**。因此「谁在等我」查 `depends_on` 一侧——`idx_task_dependencies_depends_on` 是承重索引，反向查询与环检测都走它（正向前缀查询由主键覆盖）。

**软删除不删边**：端点被软删时边仍留在表里，只是从 `dependency:listAll` 的存活谓词下消失（两端都要求 `deleted_at IS NULL`）。于是「软删前置 ⇒ 被阻塞方自动解锁，恢复前置 ⇒ 依赖自动回来」，不需要任何补偿写入，也不存在恢复时重建关系的窗口。

### 2.3 全文搜索（FTS5）

两张 **external-content** 虚表（记录源表的 `rowid`）：

| 虚表 | 内容 | 源表 |
| --- | --- | --- |
| `task_search` | `title`, `note` | `tasks` |
| `comment_search` | `body` | `comments` |

- 分词器为 **`trigram`**：匹配 CJK/拉丁子串，词元下限 3 字符 → 查询词短于 3 字符时整体回退 LIKE 扫描。
- 每张表配三条触发器（`_ai` insert / `_ad` delete / `_au` update）同步索引；`_au` 只监听被索引的列。
- **软删除行仍留在索引里**，所以查询必须 join 回源表并按 `deleted_at IS NULL` 过滤。
- `search:query` 的语义：全部查询词 ≥3 字符时走 FTS5——每个词以引号包裹为短语（使 FTS5 操作符字符按字面匹配）并用 AND 组合，bm25 排序，`snippet()` 返回 `<mark>` 高亮片段；任一词不足 3 字符时整体回退 LIKE（`ESCAPE '\'` 转义通配符，按 `updated_at` 倒序）。任务命中在前、评论命中在后（两表 bm25 分值不可比）；评论命中携带父任务 id/标题供跳转定位。

**因为 external-content 按 rowid 记录，`tasks` / `comments` 表不能重建**（重建会打散索引并丢掉触发器）——schema 演进一律用 `ALTER TABLE ADD COLUMN` + 迁移 `INSERT`。这是 V7 没有重建 `tasks` 的原因。

### 2.4 序列化约定（serde ↔ 前端）

- 持久化实体一律 `rename_all = "camelCase"`（`namespaceId`、`parentTaskId`、`dueAt`、`sortOrder`、`deletedAt`…），前端类型与之一一对应。
- 枚举的线格式：`Priority` / `ProjectStatus` / `RepeatFreq` / `SearchHitKind` / `StatsGranularity` / `TimeGroupBy` 为小写字符串；`ReminderKind` 逐变体重命名为 `advance_1h` / `advance_10m` / `due`（与列上的 CHECK 一致）。
- **`RepeatRule`** 存为 JSON：`{"freq":"daily"|"weekly"|"monthly","interval":<u32>,"paused":<bool>}`；`paused` 有 `#[serde(default)]`，所以早于该标志的 JSON 仍可反序列化（缺省 `false`）。唯一的校验是 `interval >= 1`（创建与更新路径），数据库层面没有 CHECK。
- **`Patch<T>`**：更新载荷的三态语义。字段**缺席** → `Unchanged`（保持原值）；字段**出现**（哪怕是 `null`）→ `Set(Option<T>)`。它用**手写** `Deserialize` 实现，且**没有 `Serialize`**——所有 `Update*` 类型都是只进不出的。`UpdateTask.tagIds` 是唯一的例外：它是普通的 `Option<Vec<Uuid>>`，所以「缺席」与「显式 null」在那里不可区分（都表示不改），`[]` 表示清空。
- **没有任何字段用 `deny_unknown_fields`** → 未知键被静默忽略。这是旧备份文档（多出 `dueAt` 等键）仍可导入的前提。
- **没有任何字段用 `skip_serializing_if`** → 可空字段在线上始终出现（键集合稳定，值为 `null`）。
- 三处**承重的** `#[serde(default)]`（缺了会让整份旧文档解析失败）：`Project.namespace_id`（pre-V5 没有该键）、`Task.parent_task_id`（pre-V7 没有该键）、`LegacySubtask.priority`（pre-V4 没有该列，默认 `none`）。

## 3. 迁移史（V1–V9）

| 版本 | 文件 | 做了什么 | 为什么 |
| --- | --- | --- | --- |
| **V1** | `V1__init.sql` | `PRAGMA foreign_keys = ON` + 记录全局约定（UUID 主键 / ISO-8601 时间戳 / `deleted_at` 软删除） | 约定写在第一个迁移里，后续迁移都引用它 |
| **V2** | `V2__schema.sql` | 建立核心 schema：`projects` `board_columns` `tasks` `subtasks` `tags` `task_tags` `comments` `time_entries` `settings` + 索引 + FTS5 两张虚表与同步触发器 | 一处写全首版业务模型 |
| **V3** | `V3__task_reminders.sql` | 新增 `task_reminders(task_id, kind, sent_at)` | 提醒去重标记必须持久化，否则跨扫描与重启会重复提醒；软删/已完成的任务由扫描查询过滤，标记留着即可（恢复任务不会重发已发过的提醒） |
| **V4** | `V4__task_attributes_and_dependencies.sql` | `tasks` 加 `complexity`；`subtasks` 补 `note`/`priority`/`due_at`/`complexity`；新增 `task_dependencies`、`subtask_dependencies`、`subtask_reminders` | 补齐此前缺失的属性；依赖用两张纯连接表表示（沿用 `task_tags` 的写法，但多一个 `created_at`） |
| **V5** | `V5__namespaces.sql` | 新增 `namespaces` 表；`projects` 加可空外键 `namespace_id` + 索引 | 「一个项目至多归属一个命名空间」用可空外键表达，建连接表只会多一张表、一个索引和第二条写路径 |
| **V6** | `V6__drop_project_due_at.sql` | `ALTER TABLE projects DROP COLUMN due_at` | 截止是「要完成的那件事」（任务/子任务）的属性；项目的截止日期只喂了一条没人据此行动的倒计时。任务/子任务的 `due_at`、提醒链、统计的 `total`/`completed` 都不受影响 |
| **V7** | `V7__task_hierarchy.sql` | `tasks` 加自引用列 `parent_task_id` + `idx_tasks_parent`；把 `subtasks` 行搬进 `tasks`；`subtask_dependencies` 边改写进 `task_dependencies`；`subtask_reminders` 标记并进 `task_reminders`；删三张子任务表 | 子任务与任务的列几乎重合，却各自要一套命令、依赖边、提醒标记与前端缓存。**不重建 `tasks`**：`task_search` 是按 rowid 记录的外部内容表，重建会打散索引并丢掉触发器，所以只做 `ALTER TABLE ADD COLUMN` + 迁移 `INSERT` |
| **V8** | `V8__no_orphan_children.sql` | 把「存活子任务挂在已软删父任务下」的行补上父任务自己的删除戳（`COALESCE`；已有删除戳的不动） | V7 照搬 `subtasks` 时没有校验父任务死活，这类孤儿会出现在 `task:list` 里并触发提醒。父任务不在，子任务就跟着走，且父子在同一时刻消失 |
| **V9** | `V9__stats_top_level_index.sql` | 新增复合索引 `idx_tasks_parent_completed(parent_task_id, completed_at)` | 统计加上 `parent_task_id IS NULL` 等值谓词后，规划器改用 `idx_tasks_parent` 整索引扫描，丢掉了 `completed_at` 的范围 seek（查询计划断言当场失败）。等值列前置、范围列后置，把「顶层任务 + 时间范围」放回同一次 seek |

### 3.1 V7 的搬迁映射（细节）

- `project_id` **跟父任务走**（子任务不跨项目）；`column_id` 留空（子任务不上看板）；`repeat_rule` 留空（子任务默认不重复）。
- **`done` 是布尔而 `completed_at` 是时刻**：取 `updated_at` 作为完成时刻的**最近似值**——它必然 ≥ 真正完成的那一刻，且就是该行最后一次写入；`created_at` 兜底。
- 依赖边（`subtask_dependencies` → `task_dependencies`）与**提醒去重标记**（`subtask_reminders` → `task_reminders`，值就是搬迁后的任务 id）**原样搬迁**——不原样搬的话「提前 1 小时 / 10 分钟 / 到期」会全部重发一遍。
- 七个 `subtask:*` 命令（list / listAll / create / update / complete / delete / reorder）随之退役，改走任务命令；新增 `task:reorder`。

## 4. 索引与查询计划

V2–V9 之后的索引清单：

| 索引 | 表 | 用途 |
| --- | --- | --- |
| `idx_tasks_project` | `tasks(project_id)` | 项目内任务、`stats:projectProgress` 的 join |
| `idx_tasks_column` | `tasks(column_id)` | 看板列取值 |
| `idx_tasks_due_at` | `tasks(due_at)` | 提醒扫描的候选窗口 |
| `idx_tasks_completed_at` | `tasks(completed_at)` | 全表口径的完成时间范围（趋势的通用索引） |
| `idx_tasks_parent` | `tasks(parent_task_id)` | `list_by_parent` 一类的前缀查询 |
| `idx_tasks_parent_completed` | `tasks(parent_task_id, completed_at)` | **V9**：顶层任务 + 时间范围走同一次 seek |
| `idx_board_columns_project` | `board_columns(project_id, position)` | 按项目取列并排序 |
| `idx_task_tags_tag` | `task_tags(tag_id)` | 按标签反查任务、标签维度的时间分布 |
| `idx_comments_task` | `comments(task_id)` | 任务评论 |
| `idx_time_entries_task` | `time_entries(task_id)` | 任务时间记录 |
| `idx_time_entries_started_at` | `time_entries(started_at)` | 时间分布的范围扫描 + 分桶 |
| `idx_task_dependencies_depends_on` | `task_dependencies(depends_on)` | **承重**：反向查询「谁在等我」与环检测 |
| `idx_projects_namespace` | `projects(namespace_id)` | 按命名空间取项目 |
| `tags.name` 上的 `UNIQUE COLLATE NOCASE` | `tags(name)` | 标签重名判定（不区分大小写） |

**查询计划由单测断言**：`repositories::stats::tests::statistics_queries_are_index_backed` 用 `EXPLAIN QUERY PLAN` + 代表性绑定值，要求出现这些子串——趋势 `SEARCH tasks USING INDEX idx_tasks_parent_completed`；分桶与项目份额 `SEARCH e USING INDEX idx_time_entries_started_at`；项目进度 `SEARCH t USING INDEX idx_tasks_project`。全表 SCAN 即测试失败（不是运行时断言）。改动统计 SQL 或索引时必须同步跑这些测试。

同一条规矩也管着走**启动路径**的依赖读：`repositories::tests::dependencies_live_edges_seek_the_primary_key` 要求 `task_dependencies` 的两个端点各是一次 seek，且不出现 `SCAN tasks`。这条断言有来历：谓词写成 `IN (SELECT id FROM tasks WHERE deleted_at IS NULL)` 时，规划器会对每条边重扫一遍 `tasks`（2825 个任务时实测 637 ms，`EXISTS` 版本 0.9 ms），而 `dependency:listAll` 每次启动都要跑（[ARCHITECTURE](./ARCHITECTURE.md)§6.1）。

**已知的索引取舍**（V9 注释里记着）：`idx_tasks_completed_at` 保留为全表口径的通用索引；`idx_tasks_parent` 保留——它的前缀查询已被复合索引覆盖，但它本身更窄，仍是 `list_by_parent` 那类查询的自然选择。只按 `completed_at` 建的部分索引，规划器不选。

## 5. 备份文档格式

`backup:export` 把整库写成一个 JSON 文档，`backup:import` 读取同一文档并**整体替换**全部用户数据表。

```json
{
  "format": "ordo.backup",
  "version": 4,
  "exportedAt": "<ISO-8601 UTC>",
  "data": {
    "namespaces": [], "projects": [], "boardColumns": [], "tags": [],
    "tasks": [], "subtasks": [], "taskTags": [], "comments": [],
    "timeEntries": [], "dependencies": [], "settings": []
  }
}
```

- **`version` 是备份格式版本（当前 4），不是迁移版本（当前 V9）**。升到 4 是因为子任务变成了任务行——v3 时代的构建会忽略 `parentTaskId`。导入拒绝比当前更新的版本，接受更旧的版本。
- `data` 的 11 个键全部带 `#[serde(default)]`，所以 v1/v2 文档（没有 `namespaces`、没有 `dependencies`）仍能解析：缺该键即空列表，其项目全部落在根级。
- **`subtasks` 是 pre-V7 文档的遗留位**：导出永远写空数组（子任务已经在 `tasks` 里），导入时非空数组按 V7 的同一套映射落成子任务行（`project_id` 跟父任务、`column_id` 空、`done` 为真时 `completed_at` 取 `updated_at`、`priority` 默认 `none`）。
- **`task_reminders` 不入备份**：那些标记只用于提醒去重，会由调度器与迁移自然重建。
- **备份故意不过滤 `deleted_at`**（`backup::export_all` 整表读取，`dependencies::list_all` 含休眠边）——备份是数据库的副本而非视图，软删除行随备份往返。这是该层默认查询语义的唯一例外。
- `BackupSummary.counts` 报告 `namespaces / projects / boardColumns / tasks / subtasks / tags / comments / timeEntries / settings`；其中 `tasks` 数**每一行任务（含子任务）**，`subtasks` 数其中的子任务行（沿用 R7c 之前的两个数字），`taskTags` 与 `dependencies` 不计数。

**导入的写法与顺序**（`backup::replace_all`，全部在一个事务内，因此被拒绝的导入不改动任何数据）：

1. 先解析与校验：文件不存在 → `io`；JSON 解析失败 → `validation`（`备份文件无法解析：…`）；`format != "ordo.backup"` → `validation`；`version > 4` → `validation`。
2. 删除顺序：`task_dependencies` → `task_tags` → `comments` → `time_entries` → `tasks` → `board_columns` → `projects` → `namespaces` → `tags` → `settings`（先子表后父表）。
3. 插入顺序：`namespaces` → `projects` → `board_columns` → `tags` → **无父任务的任务** → 有父任务的任务 → 遗留 `subtasks` 映射 → `delete_orphan_children` → `dependencies` → `task_tags` → `comments` → `time_entries` → `settings`（先父表后子表；自引用外键要求父任务先落地，边最后写）。
4. `delete_orphan_children` 给「导入进来的存活子任务 + 已软删的父任务」补上父任务自己的 `deleted_at`——这是 `V8__no_orphan_children.sql` 在导入路径上的同一条规则（备份文档按原样写入，同样能造出这种孤儿）。
5. 手工改过的文档若违反外键/CHECK（例如项目指向一个不存在的命名空间），错误以 `database` 浮出并整体回滚。
6. FTS 索引由既有触发器跟随插入/删除同步，**无需 rebuild**（有测试断言恢复后可搜到）。

文件路径由前端用 `tauri-plugin-dialog` 的保存/打开对话框选择，Rust 只按给定路径读写。

## 6. 统计口径

三个只读聚合命令的公共约定：

- **范围是半开区间 `[from, to)`**，边界由前端按用户时区算成 UTC 瞬间。
- 时间戳一律以 `DateTime` 参数绑定（与写入路径同一编码），**不写字符串字面量**：字面量的时区后缀（`Z` vs `+00:00`）会让边界比较错位。
- **`offsetMinutes`**（前端取 `-new Date().getTimezoneOffset()`，缺省 0 即 UTC）作为 SQLite 日期修饰符（`"+480 minutes"`）参与分桶，使「日/周/月」是用户日历上的日/周/月。**一个偏移覆盖整个区间**——跨 DST 切换的区间会差那一小时。
- **桶键格式**：日 → `YYYY-MM-DD`；周 → 该周**周一**的 `YYYY-MM-DD`；月 → `YYYY-MM`。只有范围谓词用真实列，桶是算出来的——这正是扫描能走索引的原因。
- **无数据的桶不返回**（不补零），由前端补齐坐标轴。

| 命令 | 口径 |
| --- | --- |
| **`stats:trend`** | `deleted_at IS NULL AND parent_task_id IS NULL AND completed_at ∈ [from, to)`，按桶 `COUNT(*)`。`parent_task_id IS NULL` 就是「只数顶层任务」：子任务的完成不是第二次完成 |
| **`stats:projectProgress`** | `projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL AND t.parent_task_id IS NULL`，`WHERE p.deleted_at IS NULL AND p.status = 'active'`，按项目分组返回 `total = COUNT(t.id)` / `completed = COUNT(t.completed_at)`。层级条件写在 **JOIN 的 `ON` 里而不是 `WHERE` 里**，否则只有子任务的项目会整个从结果里消失，而不是显示 `0/0`。归档项目与收件箱任务不在此口径内 |
| **`stats:timeDistribution`** | 分桶：`SUM(duration)`，`time_entries.deleted_at IS NULL AND tasks.deleted_at IS NULL AND started_at ∈ [from, to)`，**不过滤 `parent_task_id`**（记在子任务上的时间同样是时间）。分组：`groupBy=project` 时未归属项目的收件箱时间形成 id 为空的份额（该 join 不过滤项目的 `deleted_at`/`status`，所以软删/归档项目上的时间仍以具名份额出现）；`groupBy=tag` 时排除软删标签，且**多标签任务的时间计入它的每个标签**（各分组之和可能大于总时长） |

## 7. 提醒的持久化与触发窗口

- **候选窗口是 `(now − 24h, now + 1h]`**：`deleted_at IS NULL AND completed_at IS NULL AND due_at IS NOT NULL AND due_at > now − 24h AND due_at <= now + 1h`，按 `due_at, id` 排序。
- 三种提醒的提前量：`advance_1h` = 60 分钟、`advance_10m` = 10 分钟、`due` = 0。触发条件为 `now >= due − lead AND (lead == 0 || now < due)`，因此：
  - **`due_at` 一过就只会再触发 `due`**（停机期间不会补发一条"还有 1 小时"）；
  - 首次进入窗口的任务（新建/编辑/导入时截止时间就在下一小时内）会在下一次扫描**同时**触发 `advance_1h` 与 `advance_10m`，文案仍写作"还有 1 小时"。
- **去重标记** `task_reminders` 用 `INSERT OR IGNORE` 写入并检查 `affected == 1`：只有首次插入算「已触发」。标记跨扫描与重启持久化（V7 把子任务的标记并进同一张表，所以搬迁后不会重发）。
- **宽限**：截止超过 24 小时的任务被跳过且**永远不会被标记**——它们从此保持静默，之后也不会补发。
- 一整轮扫描（候选 + 全部标记写入）是一个事务，结束时提交。
- 子任务按自己的 `due_at` 独立提醒；父任务被软删时子任务通过删除级联离开候选。

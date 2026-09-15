# 任务层级：子任务并入任务树（设计）

日期：2026-09-15
状态：待评审
关联：`docs/CHANGE_REQUESTS.md` §7（R7c 决策）、`docs/superpowers/specs/2026-09-14-hierarchical-task-list-design.md`（子任务的原设计）

## 1. 背景与目标

今天「任务」与「子任务」是两套并行模型：`tasks` 与 `subtasks` 两张表、两套命令（`task:*` / `subtask:*`）、两个前端缓存（`tasks` / `subtasksByTask`）以及两套依赖边与提醒标记表。子任务**不是**任务：它没有标签、没有评论、没有时间记录、没有独立详情弹窗，点击标题打开的是父任务；它也不会自己出现在「今天 / 即将到来」里。

R7c 要的交互是「把任务拖到另一个任务上，它就变成那个任务的子任务」。用「复制 + 软删」实现会丢掉标签、评论、计时、依赖与重复规则——这正是选**真层级**的理由。定案后进一步选择了**合并**：子任务并入任务层级，`subtasks` 表与其命令退役。

于是目标有三条：

1. **一个模型**：任务可以有至多一个父任务（`tasks.parent_task_id`），只允许**一层**。子任务就是「有父任务的任务」，此后它天然拥有标签、评论、时间记录、依赖与自己的详情弹窗。
2. **一次迁移**：把既有 `subtasks` 行搬进 `tasks` 并保留 id（依赖边、提醒标记一并改写），搬完删表。用户不该看到任何一条子任务消失或变成孤儿。
3. **一种交互**：拖任务到任务行 = 变成它的子任务（R7c）；拖任务到侧边栏项目行 = 移进该项目（R7b，已实现）；拖项目到命名空间行 = 归入命名空间（R7a，已实现）。

## 2. 已定决策（来自 `CHANGE_REQUESTS.md` §7 评审）

| 问题 | 决定 |
| --- | --- |
| 与 `subtasks` 的关系 | **合并**：子任务成为带 `parent_task_id` 的任务行，`subtasks` 表及其命令/缓存退役 |
| 深度 | **只允许一层**：`parent_task_id` 指向的任务自身必须没有父任务 |
| 视图可见性 | **子任务也独立进视图**：按自己的 `dueAt` / `completedAt` 出现在「收件箱 / 今天 / 即将到来 / 已完成」 |
| 拖拽长按 | 鼠标立即拖；触摸长按由平台自身的长按起步实现，不自己加计时器（P4/P5 已按此实现） |

## 3. 非目标

- **无限嵌套 / 任意深度**：层级只到一层。多层要付递归渲染、循环校验、跨层排序与看板列语义的成本，而「任务下的检查项」这个真实需求一层就够。
- **保留 `subtasks` 表作为兼容层**：两套模型并存意味着「一个任务的下级」有两种表达，读写路径、统计口径与 UI 都要各写一遍。合并的全部价值就在于消掉它。
- **子任务的独立看板卡片**：看板是「工作项」的列视图，子任务在卡片内以清单形式出现（见 §8.4）。
- **把评论/时间记录/标签迁移到子任务上**：迁移只搬行，不造数据。子任务此后**可以**有这些，但存量不会有。
- **跨层级的依赖语义**：依赖仍然只在「同一父任务下的兄弟」或「顶层任务」之间，不新增跨层约束求解。
- **撤销/历史**：本次不改撤销模型（今天也没有）。

## 4. 现状：影响设计的事实

| 事实 | 出处 | 影响 |
| --- | --- | --- |
| `subtasks` 表：`id, task_id(FK tasks), title, done(布尔), sort_order, created_at, updated_at, deleted_at`；V4 追加 `note, priority, due_at, complexity` | `V2__schema.sql:65-76`、`V4__…sql:19-24` | 列与 `tasks` 高度重合——这是合并可行的前提；`done` 与 `tasks.completed_at` 的形态不同，需要一个换算约定 |
| `tasks`：`id, project_id, title, note, priority, column_id, due_at, completed_at, repeat_rule, complexity, sort_order, created_at, updated_at, deleted_at` | `V2__schema.sql` + `V4` | 子任务搬进来后 `project_id` / `column_id` / `repeat_rule` 三个字段没有来源，需要给默认值 |
| `subtask_dependencies(subtask_id, depends_on, created_at)`；`task_dependencies(task_id, depends_on, created_at)`；两张表都是纯连接表 + `CHECK(x<>y)` + 反向索引 | `V4__…sql:26-44` | 合并后只剩一张；子任务边要按 id 原样改写过去 |
| `task_reminders(task_id, kind, sent_at)` / `subtask_reminders(subtask_id, kind, sent_at)` 是同构的两张去重表 | `V3__…sql`、`V4__…sql:46+` | 合并后只剩一张；`subtask_id` 的值就是搬迁后的任务 id |
| 提醒扫描对未完成、未软删、有 `due_at` 的任务/子任务各扫一轮；**父任务完成或软删即静默其子任务** | `services.rs::due_kinds` 调用点、`ARCHITECTURE.md:267` | 合并且「子任务独立进视图」后，这条静默规则要重新定（见 §9.3） |
| 提醒标记按 `(id, kind)` 主键去重，跨重启不重复 | `V3__…sql` | 搬迁标记时不能改 id，否则已发过的提醒会重发 |
| `task:list` 返回全部未软删任务（扁平，带 `tagIds`）；子任务由 `subtask:listAll` 单独批量拉 | `repositories.rs::tasks::list`、`services.rs::list_subtasks_all` | 合并后 `task:list` 一次就带回全部层级，`subtask:listAll` 与前端 `subtasksByTask` 缓存可以整体删除 |
| 前端子任务缓存是「按需 + 批量重建」两套路径（`setSubtasks` / `setSubtasksAll`），`hasSubtasks` 决定详情弹窗是否再拉 | `store.ts:195-245` | 删除这套机制是本次最大的**简化**收益：子任务随 `tasks` 一起到达，没有加载态 |
| 列表用固定 56px 行高的虚拟列表渲染任务行，展开的任务把子任务行内联追加在同一虚拟列表里 | `TaskListView.tsx:15-34,118-146` | 合并后「展开」不再是「另一份数据」，只是同一集合的过滤；行高契约仍要守住 |
| 依赖索引按 `kind` 分两套（`DependencyKind = "task" \| "subtask"`），子任务边的两端必须同属一个父任务 | `dependencies.ts`、`services.rs` 校验 | 合并后 `kind` 从 IPC 与前端类型里消失 |
| 备份是「数据库副本」：`BackupData` 逐表列出，`BACKUP_VERSION = 3`，导入拒绝更高版本，字段全部 `#[serde(default)]` | `models.rs:290-361`、`services.rs:1328-1377` | 格式升到 4；旧文档里的 `subtasks` 数组要在导入时**搬**成任务行，不能直接丢 |
| `db.rs` 有一份「所有表都在」的断言清单（含 `subtasks`、`subtask_dependencies`、`subtask_reminders`） | `db.rs:66-82` | 删表后清单必须同步，并补 `tasks.parent_task_id` 的索引断言 |
| `task_search` 是 `content='tasks'` 的外部内容表，靠 `tasks_ai/ad/au` 三个触发器同步，索引按 `rowid` 记录 | `V2__schema.sql:134-164` | 迁移**不重建** `tasks`（§5.1），所以触发器与索引原封不动；搬迁用 INSERT，`tasks_ai` 会自动把子任务写进搜索索引——副作用是子任务开始可被搜到（§6.6） |
| 用户可见文案至今是「子任务」 | 全前端 | 术语保留：UI 继续说「子任务」，代码里用 `parentTaskId` / child 表达层级 |
| 原生 Drag API 已用于看板与 R7a/R7b，共享拖拽态在 `common/stores/drag.ts` | `drag.ts` | R7c 复用同一套：落点区分靠「拖的是什么」+「落在哪一类行上」 |

## 5. 数据层

### 5.1 迁移 `V7__task_hierarchy.sql`

**不用重建 `tasks` 表。** 直觉上「加自引用外键」要重建表，但重建会带来三个真实的坑：`task_search` 是 `content='tasks'` 的外部内容表（触发器随 `DROP TABLE` 消失、新表拿到全新 rowid，旧索引全部失配）、`idx_tasks_*` 要重建、`DROP TABLE` 一张被五张表引用的父表需要 `PRAGMA foreign_keys=OFF` 而 refinery 在事务里跑迁移。SQLite 允许 `ADD COLUMN … REFERENCES` —— 只要默认值是 `NULL`（V5 加 `namespace_id` 时已经吃过这条规则），因此整个迁移是「加一列 + 搬数据 + 删三张表」：

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

要点：

- **软删的子任务也一起搬**（`deleted_at` 原样带过来），否则它们会在删表时静默消失，「恢复父任务」也就无从恢复。
- **id 全部保留**：依赖边与提醒标记靠 id 对齐，改 id 就得额外维护映射表。
- **`JOIN tasks t`**：子任务的父任务一定是行内存在的任务（FK 保证），孤儿行不会出现；万一将来出现，`JOIN` 会让它被跳过而不是插入一条 `parent_task_id` 指向不存在行的记录。
- **FTS 自动跟进**：INSERT INTO `tasks` 会触发 `tasks_ai`，搬迁的子任务直接进入搜索索引，无需手工 `'rebuild'`。这正是选择不重建表的附带收益。
- **`sort_order` 不重排**：沿用子任务原来的键，父任务下兄弟的相对顺序不变（键在整个 `tasks` 表里唯一即可，不需要按父分段）。
- **删表顺序**：三张子任务表之间没有相互引用，但 `subtask_dependencies` / `subtask_reminders` 必须在 `subtasks` 之前删（它们引用 `subtasks(id)`）。
- **`db.rs` 的表清单**：删掉 `subtasks` / `subtask_dependencies` / `subtask_reminders` 三项，并补一条 `idx_tasks_parent` 的断言；`db.rs:197` 的 `v4_adds_attributes_and_dependency_tables` 直接对 `subtasks` 跑裸 SQL，也要改写或删除。
- **`tasks::list` 是不过滤的全表查询**（`repositories.rs:288-300`，`WHERE deleted_at IS NULL ORDER BY sort_order, created_at, id`）。合并后子任务会**自动**流进 `task:list`、看板候选、收件箱/今天等视图与 FTS —— 这正是我们要的（§7.2 让前端拿到全量），但服务层里凡是「拿同级任务算排序键/取看板候选」的地方都必须补上 `parent_task_id IS NULL`（见 §6.3），否则子任务会混进顶层同级集合。

### 5.2 备份格式 `BACKUP_VERSION = 4`

- `BackupData.subtasks` 字段**保留**（`#[serde(default)]`），但只用于**读旧档**：导入时若 `subtasks` 非空，按 §5.1 的同一套映射搬成任务行，`parent_task_id` 指向原 `taskId`。
- 导出不再写 `subtasks`（写出来是空数组）。`BackupCounts.subtasks` **保留字段名**（设置页那句「子任务 n」的文案不动），值改成子任务计数（`parent_task_id IS NOT NULL` 的行数）——它描述的仍然是"这份备份里有多少子任务"。
- `BACKUP_VERSION` 从 3 升到 4；导入端继续拒绝更高版本。旧档（v1–v3）靠 `#[serde(default)]` 解析，`subtasks` 走搬迁路径。
- `subtask_dependencies` / `subtask_reminders` 从来不在备份里（备份里只有 `dependencies`，其 `kind` 字段标识边集）。合并后 `Dependency` 的 `kind` 字段退役，导入旧档时忽略 `kind` 并把两条边集并成一张表。
- **导入顺序变成一个真实的约束**：`tasks.parent_task_id` 是自引用外键，`replace_all` 现在按 `for task in &data.tasks` 平铺插入（`repositories.rs:1581-1583`），**必须改成父任务先、子任务后**（先插 `parentTaskId == null` 的，再插其余的），否则导入会撞外键。这条要有测试（导入一份含子任务的备份）。

## 6. 后端设计

### 6.1 模型（`models.rs`）

- `Task` 增 `parent_task_id: Option<Uuid>`，带 `#[serde(default)]`（旧备份没有这个键）。
- 删除 `Subtask`、`NewSubtask`、`UpdateSubtask`。
- `NewTask` 增 `parent_task_id: Option<Uuid>`；`UpdateTask` 增 `parent_task_id: Patch<Uuid>`（`Patch::Set(None)` = 变成顶层任务，即"移出父任务"）。
- `Dependency` 去掉 `kind`（`DependencyKind` 枚举删除）。
- `NewTask.subtask_titles: Vec<String>` 保留**名字**（UI 概念仍是子任务），语义变成"顺带创建这些子任务行"。
- `BackupData.subtasks`、`BackupCounts.subtasks` 按 §5.2 处理。

### 6.2 IPC（`commands.rs` / `lib.rs`）

- 退役：`subtask:list`、`subtask:listAll`、`subtask:create`、`subtask:update`、`subtask:complete`、`subtask:delete`、`subtask:reorder`（7 个）。
- 新增：`task:reorder`（`taskId, prev, next`）——`subtask:reorder` 的直系等价物，子任务清单的上/下移改用它。task 此前没有 reorder 命令（顺序只在创建与看板移动时确定），这是新增能力，但实现照抄 `subtask:reorder` 的键重排逻辑。
- 其余 `task:*` 通过 `parentTaskId`（创建/更新）表达层级；`task:complete`/`task:restore`/`task:softDelete` 语义见 §9。
- 看板与统计命令不改签名，但查询口径要加层级条件（§8.4 / §8.5）。

### 6.3 服务层（`services.rs`）

- 删除子任务函数族，把其中的业务规则搬进任务侧：
  - `create_task` 接受 `parent_task_id`，**校验**：父任务存在、未软删、且自身 `parent_task_id IS NULL`（单层）；父任务与子任务同属一个项目（子任务不跨项目，沿用原 `subtasks.task_id` 只在同一任务下的语义）。父任务的 `project_id` / `column_id` 决定子任务的默认归属：`project_id` 继承父任务，`column_id` 保持 `NULL`（子任务不上看板）。
  - 层级变更（`update_task` 的 `parent_task_id` patch）：目标父任务同上校验；**有子任务的任务不能再变成子任务**（单层的直接推论，返回 `validation`）；不能自引用。
  - 移动父任务的项目时，其子任务是否跟着走：**跟着走**（同一事务把子任务的 `project_id` 一起改），否则子任务会留在旧项目里、与父任务分居两处。
- `reorder_task`：照抄 `reorder_subtask`（`services.rs:647-686`：`resolve_slot` 取中 / 键耗尽 `sort::spread` 局部重排），作用域是"同一父任务下的兄弟"或"同一列的顶层任务"。
- **同级集合的判定要一起改（本次最容易漏的地方）**：今天 `tasks.sort_order` 的同级是「同一 `column_id`」（`services.rs:330-335` 建任务、`977-980` 看板移动），而 `subtasks.sort_order` 的同级是「同一 `task_id`」。合并后两者共用一个 `sort_order` 列：
  - 建**顶层**任务：同级 = `column_id` 相同**且 `parent_task_id IS NULL`**（子任务的 `column_id` 恒为 NULL，漏了这个条件，一次"无列"的新任务会把自己的键算进子任务堆里）；
  - 建**子任务**：同级 = `parent_task_id` 相同；
  - 看板候选与 `move_task` 的同级：同样要加 `parent_task_id IS NULL`（否则子任务会被当成卡片参与列内排序）；
  - 取同级列表的 SQL 是 `tasks::list` 全表 + 内存过滤，因此这三处过滤都在服务层，测试要分别覆盖。
- 软删/恢复：软删父任务时同一事务软删其子任务；恢复父任务时恢复其子任务（`deleted_at` 一并清空）。理由见 §9.2。
- 提醒扫描：两轮候选合成一轮；子任务静默规则见 §9.3。

### 6.4 仓库层（`repositories.rs`）

- `TASK_COLUMNS` 增 `parent_task_id`；`SUBTASK_COLUMNS` 与 `pub mod subtasks` 删除。
- `tasks::insert` / `update` / `from_row` / `list` 加列；新增 `list_by_parent`（若服务层需要按父查询；`list` 已返回全量，多数场景不需要）。
- `sort_order` 作用域：键仍是一个全表唯一的字典序序列，但"同级"的判定由服务层按 `parent_task_id` / `column_id` 决定（见 §6.3）。**不**引入每父独立的键空间——那会带来第二套键耗尽重排逻辑，收益为零；前端按"同一父任务下的兄弟"直接按 `sortOrder` 排即可。
- 依赖仓储合并成一张表；查询边的存活谓词不再需要"两端同父"的额外条件（层级已在业务层保证）。

### 6.5 提醒（`scheduler.rs` / `services.rs`）

- 候选只扫 `tasks`：未软删、`completed_at IS NULL`、`due_at` 在窗口内。
- 去重标记只写 `task_reminders`。
- 事件 payload 从「父任务 › 子任务」两段式简化为单条任务的标题 + id；`reminders.ts` 不需要再分支。

### 6.6 搜索

- FTS5 外部内容表建在 `tasks` 上，子任务搬进 `tasks` 后**自动进入搜索**（标题与备注）。这是本次的行为变化之一，视为正向：子任务此前搜不到。
- 命中导航：子任务命中打开**自己的**任务详情弹窗（此前只能打开父任务）。

## 7. 前端设计

### 7.1 类型与 IPC

- `Task` 增 `parentTaskId: string | null`；`Subtask`、`NewSubtask`、`UpdateSubtask` 删除。
- `UpdateTask` 增 `parentTaskId?: string | null`；`NewTask` 增 `parentTaskId?: string | null`。
- `Dependency` 去 `kind`；`DependencyKind` 删除。
- `common/ipc/commands.ts` 删 7 个子任务命令常量，加 `task:reorder`。

### 7.2 Store

- 删 `subtasksByTask`、`hasSubtasks`、`setSubtasks`、`setSubtasksAll`、`upsertSubtask`、`patchSubtask`、`removeSubtask`、`insertSubtaskAt`、`getSubtasks`。
- 新增派生（纯函数，放在 `store.ts` 或 `view-filters.ts`）：
  - `childrenOf(taskId): Task[]` —— 按 `parentTaskId` 过滤 + 按 `sortOrder` 排序；
  - `topLevelTasks(): Task[]` —— `parentTaskId === null`；
  - `hasChildren(taskId): boolean` —— 供行上的展开箭头与进度徽标。
- `tasksState.tasks` 一次就带全部层级，**没有加载态**。

### 7.3 Hooks

- 子任务函数族删除；`createTask` 支持 `parentTaskId`；`completeTask`/`uncompleteTask`/`softDeleteTask`/`restoreTask` 沿用（服务端保证子任务一并处理，前端乐观更新要跟着改：软删父任务时同 tick 把子任务也标删）。
- `createTask` 里那句「`subtaskTitles` 非空就 fire-and-forget 拉一次子任务」改成 `void reloadTasks()`（子任务现在是同一集合里的行，没有单独的接口可拉）；`loadAll` 少一条 `listSubtasksAll` 腿，`loadSubtasks` 整体删除。
- 新增 `reorderTask(taskId, prev, next)`，对应 `task:reorder`。
- `dependencies.ts`：索引只剩一套边，`buildIndex`/`liveSet`/`completionSet`/`wouldCycle` 去掉 `kind` 参数；`wouldCycle` 的语义不变（依赖成环检测）。
- `blocked-confirm.ts`：阻塞判定的输入从两套集合变一套。

### 7.4 组件

| 组件 | 现在 | 合并后 |
| --- | --- | --- |
| `SubtaskRow.tsx` | 渲染 `Subtask`，父任务由 prop 传入 | 渲染子任务 `Task`，行结构不变（56px、20px 引导槽位、R1 缩进规则） |
| `SubtaskList.tsx` | 详情弹窗内的一段子任务清单，自带 add/编辑/排序/删除 | 改为"子任务清单"组件，数据来自 `childrenOf(parentId)`，排序按钮改用 `reorderTask` |
| `SubtaskEditor.tsx` | 子任务属性面板（备注/优先级/截止/复杂度/依赖） | 直接复用**任务编辑器**（子任务就是任务）：属性面板删除，行上的滑杆按钮改为打开任务编辑器，落在同一个弹窗里 |
| `TaskDetailDialog.tsx` | 子任务区 + 依赖区 | 子任务区改用 `childrenOf`，子任务行点标题打开**该子任务自己的详情**（递归复用同一个组件，单层不会有递归深度问题） |
| `TaskListView.tsx` | `ListRow = task \| subtask` 两态，展开时把 `Subtask` 行追加 | 单一 `Task` 行；展开时把 `childrenOf(task.id)` 追加（同一集合的过滤，而不是另一份数据） |
| `TaskEditorDialog.tsx` | 没有任何 UI 传 `subtaskTitles`（只有 `hooks.test.ts` 在用），编辑器也不提供"一次建多条子任务"入口 | 字段与语义保留（顺带创建子任务行），**不**为此新增 UI；新增"父任务"选择器，用于把任务挂到另一个任务下 |
| `TaskDependencies.tsx` | 候选 = 兄弟子任务或同项目任务 | 候选 = 同一父任务下的兄弟（有父时）或顶层任务 |
| `BoardCard.tsx` | 卡片不显示子任务 | 卡片显示"n/m 个子任务"徽标（数据来自 `childrenOf`），列内拖拽只作用于顶层任务 |
| `QuickAddWindow.tsx` | 只创建顶层任务 | 不变（快捷窗只建顶层任务，父任务由拖放/编辑器决定） |
| `reminders.ts` | 事件里 `taskId` 是父任务，正文写「父任务 › 子任务」 | 事件就是该任务自己，去掉两段式分支 |
| `search/*` | 命中打开任务详情 | 不变（子任务命中现在合法，打开的是子任务自己） |
| `TaskDependencies.tsx` | 前置候选 = 同项目任务里搜标题 | 候选限定为**顶层**任务（`parentTaskId === null`），否则子任务会混进"前置"候选；子任务的前置候选仍在它自己的详情弹窗里给（兄弟） |
| `TagManagerDialog.tsx` | 「n 个任务」= 带该标签的任务数 | 不变（子任务的 `tagIds` 初始为空，除非用户显式打标签） |
| `TaskViewer.tsx` / 搜索命中 | 打开 `getTask(id)` 的详情 | 不变；子任务命中打开的是子任务自己（R7b 之后 `taskId` 就是它） |
| `stats/*` | 统计全部任务 | 口径见 §8.5 |

### 7.5 拖放（R7c）

- 拖源仍是任务行（`TaskItemRow`，R7b 已接好）；落点新增"任务行"这一类：
  - 落到**任务行** → `parentTaskId = 该任务`（R7c）；
  - 落到**侧边栏项目行** → `projectId = 该项目` 且 `parentTaskId = null`（R7b；若源任务是子任务，这同时把它提到顶层——需要显式说明，见 §9.4）；
  - 落到**侧边栏命名空间行 / 根级项目区** → 项目才有意义，任务拖过去不响应。
- 落点高亮的判定（可落性）在 `onDragOver` 里算：
  - 目标任务本身就是被拖的任务 → 不可落；
  - 目标任务**已有父任务** → 不可落（单层约束）；
  - 被拖的任务**自己有子任务** → 不可落（它不能再变成别人的子任务）；
  - 目标任务的 `projectId` 与被拖任务不同 → 落地时同时改 `projectId`（子任务跟随父任务的项目，见 §6.3），这一点要在视觉上可预期，不做二次确认。
- 复用 `common/stores/drag.ts`：`kind` 增 `"task"`（已有）与目标类别 `"task-parent"` 的区分靠"落点行的类型"，不需要新的 kind。

## 8. 视图规则（合并后最容易出错的部分）

### 8.1 顶层列表包含哪些行

**推荐规则 A（行内分组）**：视图先按现有谓词筛出全部匹配任务（含子任务，子任务按自己的 `dueAt`/`completedAt` 入选），然后：

- 若某子任务的**父任务也在本次结果里** → 该子任务渲染在父任务行之下（自动展开，无需点开），不重复出现在顶层；
- 若父任务**不在**结果里（父任务不满足筛选条件）→ 该子任务作为顶层行出现，并带一个「父任务 · ⋯」的前缀标识，点击该标识跳到父任务。

这样"子任务独立进视图"成立（它凭自己的到期时间入选，不会因为父任务不在而消失），同时同一视图里不会出现两行同一条任务。

**备选规则 B（全部顶层 + 可展开）**：顶层列出所有匹配行（含子任务），父任务展开时其子任务再出现一次。实现最简单，但同一视图会出现重复行，且用户无法判断哪一行是"入口"。

### 8.2 展开/收起

- `TaskListView` 的 `expanded` 状态保留（本地 signal，不落库）。
- 规则 A 下，"父任务在结果里且展开"与"子任务自己入选"两条路径都指向同一批子任务行；渲染时按 id 去重，父任务之行优先（分组位置）。

### 8.3 计数与徽标

- 任务行原有的「n/m 子任务」进度徽标改用 `childrenOf`。
- 项目进度、命名空间汇总、统计（§8.5）都只数顶层任务。

### 8.4 看板

- 列内卡片 = `parentTaskId === null` 的任务；子任务不出卡片（理由：子任务没有 `column_id`，也没有"独立工作项"语义）。
- 卡片显示子任务进度徽标。
- `board:moveTask` 只接受顶层任务；服务层对子任务返回 `validation`。

### 8.5 统计口径

| 统计 | 现在 | 合并后 |
| --- | --- | --- |
| `stats:trend`（完成趋势） | 数 `tasks.completed_at` | **只数顶层任务**（子任务是父任务内部的拆解，重复计数会虚高完成量） |
| `stats:projectProgress` | 数项目内任务 | **只数顶层任务** |
| `stats:timeDistribution` | 按项目/标签聚合 `time_entries` | 不变（时间记录属于具体工作项，子任务的时间也是时间） |

前端 `ProjectProgress` 的数字来自调用方传进来的任务切片，因此「只数顶层」这一步在**调用点**完成：`ProjectListView` / `NamespaceProjectsView` 传 `tasks.filter(t => t.parentTaskId === null)`。后端 `stats:*` 在 SQL 里加 `parent_task_id IS NULL`。

### 8.6 筛选（优先级 / 标签）与子任务

今天的钉死行为是「**展开的父任务，其子任务不受筛选影响**」（`task-views.test.tsx` 的「keeps every child of an expanded task while a filter is active」）：子任务没有优先级也没有标签，筛不动它们。合并后子任务有了优先级，标签筛则会因为 `tagIds` 为空而把它们全筛掉——所以必须显式定规则：

**推荐**：按子任务**出现在哪条路径**区分，与 §8.1 的规则 A 同源：

- **行内分组路径**（子任务是"父任务的上下文"，父任务通过了筛选）→ 子任务**不参与筛选**，照旧全部显示。保留今天的钉死行为。
- **顶层路径**（子任务凭自己的到期时间独立入选，父任务不在结果里）→ 它就是一个普通行，**参与**优先级/标签筛选。

这样「筛完还剩什么」始终可解释：能被筛掉的只有独立出现的行，跟在父任务下面的行永远看得见。

### 8.7 计数

- 工具条上的「n 个任务」只数**顶层**行（`parentTaskId === null`），行内分组的子任务不计入——否则展开一个父任务会让计数变化，而用户什么都没做。
- 空态判断同理：视图里只剩子任务时不算"空"。

## 9. 语义细节（需要在此确认）

### 9.1 完成父任务与子任务的关系

**推荐**：完成父任务**不**自动完成其子任务（与"子任务独立进视图"一致：它有自己的完成状态与自己的位置）。父任务行在还有未完成子任务时照常显示进度徽标，用户可以自行决定。

代价：`已完成` 视图里可能出现「父任务已完成、子任务仍在今天」的组合。这是模型选择的必然结果，不是 bug。

### 9.2 软删 / 恢复

**推荐**：软删父任务时同一事务软删其全部子任务；恢复父任务时一并恢复。

理由：子任务的存在依附于父任务（它没有独立入口，侧边栏/视图里也只以"父任务的孩子"或"带前缀的顶层行"出现）。留下未软删的子任务会产生一批没有父行的孤儿行，而"恢复父任务"必须能把它们带回来。

### 9.3 提醒

**推荐**：子任务按自己的 `due_at` 独立提醒，**不再**因父任务完成/软删而静默（软删已由 §9.2 覆盖：子任务跟着软删，扫描自然跳过）。

这是对 `ARCHITECTURE.md:267` 现有规则的修改，需要在同一提交里改文档。

### 9.4 把子任务拖到项目行

**推荐**：允许，语义是"移出父任务 + 移进该项目"（同时清 `parentTaskId` 与 `projectId`）。落地时在通知里说明一句，避免用户以为只是换了项目。

备选：拖到项目行只改 `projectId`（子任务跟着父任务走，父任务留在原项目 → 父子分居两个项目）。这与 §6.3"子任务跟随父任务的项目"冲突，不推荐。

### 9.5 重复任务

**推荐**：子任务可以有自己的重复规则，生成的下一实例继承 `parentTaskId`（照抄 `spawn_next_instance`，多传一个字段）。

## 10. 测试计划

- **迁移（Rust）**：新库跑 V1→V7 后，`subtasks` 不存在、`tasks.parent_task_id` 存在、索引与外键生效；把"有子任务的库"（V6 状态）跑 V7，断言：子任务行数守恒、id 不变、`done=1` 变成非空 `completed_at`、依赖边与新任务 id 对得上、提醒标记未丢（不重发）、**FTS 触发器重建后新任务可被搜到**。
- **服务层（Rust）**：单层校验（父任务有父 → `validation`）、自引用拒绝、有子任务的任务不能再被挂到别人下面、改父任务项目时子任务跟随、软删/恢复的级联、`reorder_task` 的键重排与耗尽路径、看板拒绝子任务、统计只数顶层。
- **必须保住的既有契约**（改了就是回归）：`task-views.test.tsx` 的 20px 引导槽位（`w-5` + `self-stretch`、不得带 `h-*`/`size-*`）与「4 行 = 224px、每行恰好一个 `h-14`、展开槽位 `size-5` vs 引导槽位 `w-5`」；`blocked-confirm.test.tsx` 的 `BlockedRequest` 形状（含 `parentId`）；`dependencies.test.ts` 的成环检测。
- **前端**：`childrenOf` / `topLevelTasks` 派生；`TaskListView` 的规则 A（父在同视图 → 子行内分组；父不在 → 子带前缀出现在顶层）；规则 A 下的筛选规则（§8.6：行内分组的子任务不被筛掉，顶层独立出现的子任务被筛掉）；工具条计数只数顶层（§8.7）；拖放到任务行/项目行的三种落点与不可落判定；`hasChildren` 徽标；提醒事件不再有父子两段式；依赖索引单集合。
- 沿用并更新：`task-views.test.tsx` 的行高/槽位契约、`task-detail-dialog.test.tsx`、`dependencies.test.ts`、`reminders.test.ts`、`board-view.test.tsx`、`settings-view.test.tsx`（备份计数文案）。
- **存量 Rust 测试的处置**（共 126 条，其中 33 条提到子任务、23 条是实质断言，10 条只带 `subtaskTitles: []` / `subtaskId: null` 之类的字段初始化）：
  - 需要**改写**（行为仍要成立，但对象换成子任务行）：`subtask_crud_appends_in_order_and_toggles_done`、`subtask_attributes_roundtrip_and_patch_semantics_hold`、`reorder_subtask_moves_within_the_list`、`reorder_subtask_rejects_bad_input`、`reorder_subtask_rebalances_when_exhausted`、`appending_past_the_length_threshold_rebalances_siblings`、`subtask_due_dates_fire_their_own_reminders`、`repeat_instance_copies_subtask_attributes_and_shifts_their_dates`、`subtasks_are_scoped_to_their_task_and_ordered`、`subtask_fields_serialize_as_camel_case`、`subtask_reminders_name_the_parent_and_the_subtask`、`create_task_with_tags_and_subtasks_is_atomic`、`backup_round_trip_restores_every_table`。
  - 需要**删除或改判**（规则本身被本次决策推翻）：`completing_the_parent_stops_its_subtask_reminders`（§9.3 改成独立提醒）；`dependency_edges_are_scoped_and_acyclic` 与 `repeat_instances_do_not_inherit_dependency_edges` 里 `DependencyKind::Subtask` 的部分；`list_all_subtasks_spans_tasks_and_skips_deleted_parents`（`subtask:listAll` 退役）。
  - **必须继续通过**（旧档兼容契约）：`version_one_backups_still_import`、`version_two_backups_import_with_every_project_ungrouped`、`import_accepts_backups_written_before_subtasks_had_attributes`（它专门剥掉 V4 那四个子任务字段，是 `data.subtasks` 兼容路径的看门测试）。
  - `db.rs::v4_adds_attributes_and_dependency_tables` 直接对 `subtasks` 跑裸 SQL，随表删除一起改写。

## 11. 风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 搬迁后的子任务进不了搜索索引 | 搜索静默漏行 | 走 INSERT（触发器 `tasks_ai` 自动同步），迁移测试断言「搬迁来的子任务能被搜到」 |
| `ADD COLUMN … REFERENCES` 在旧 SQLite 上被拒 | 迁移直接失败 | 与 V5 加 `namespace_id` 同一个写法（默认 NULL），已有先例；迁移测试会在真库上跑一遍 |
| 规则 A 的实现（去重 + 前缀行）是本次最绕的前端逻辑 | 同一任务出现两次或消失 | 派生写成纯函数 + 表驱动测试 |
| 同级集合判定漏改（子任务混进顶层/看板同级） | 新建任务的排序键与子任务互串，表现为"新任务排到奇怪的位置"或看板顺序错乱 | §6.3 列出三处过滤点，各自一条测试；`sort_order` 冲突不会报错，只能靠测试发现 |
| 一次性改动面大（36 个前端文件提到 subtask，678 处引用） | 中途半成品状态不可用 | 按里程碑分提交，每步前后端一起绿；先做"数据层 + 后端"，再做"前端只读渲染"，最后做"拖放/编辑" |
| 用户已有的库（真实数据） | 迁移不可回滚 | 迁移前不额外做事（refinery 已按版本管理），但要有一条"V6 库 → V7"的测试；提示用户先导出备份 |

## 12. 实施顺序（草案，由 writing-plans 细化成任务）

1. **数据层**：V7 迁移 + `db.rs` 表清单 + 迁移测试（含 V6→V7 迁档）、备份格式 v4（导出/导入 + 旧档搬迁）。
2. **后端**：模型/IPC/服务/仓库/提醒/看板/统计全部切换；退役 7 个子任务命令；`task:reorder`。
3. **前端数据层**：类型、api、store 派生、hooks、dependencies、reminders。
4. **前端渲染**：详情弹窗、任务编辑器（含父任务选择）、`SubtaskList`/`SubtaskRow` 改造、`TaskListView` 的规则 A。
5. **交互**：R7c 拖放落点（任务行 → 变子任务）与可落性判定。
6. **文档与收尾**：PRD / ARCHITECTURE / IMPLEMENTATION_PLAN 同步；删除死代码与死测试。

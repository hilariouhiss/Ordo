# 任务属性扩展与依赖顺序（设计）

日期：2026-09-14
状态：已确认，待实施

## 1. 背景与目标

任务目前只有「标题 / 备注 / 优先级 / 截止时间 / 标签 / 项目 / 重复规则」，子任务只有「标题 + 完成状态」。本次要补齐两件事：

1. **属性扩展**：任务新增**复杂度**；子任务新增**描述、优先级、截止日期、复杂度**。
2. **前后顺序（依赖）**：任务之间、子任务之间可以设置「A 完成后才能做 B」，并据此给出「完成顺序」——被前置卡住的项显示为「阻塞中」，完成时给出软确认。

目标是让「哪些事现在能做、哪些在等别人」在列表层面一眼可见，而不是靠用户自己记。PRD §2.1 目前的字段表没有复杂度，也把「子任务没有优先级与截止日期」写成了筛选口径的一部分，因此本次是**新增需求**，需要同步 PRD。

## 2. 非目标

- 依赖的拖拽编辑、甘特图/时间轴视图、跨实例（重复任务）的依赖传递
- 子任务的子任务（多级嵌套）。`subtasks` 表没有 `parent_subtask_id`，层级固定两层
- 子任务依赖任务、或跨父任务的子任务依赖（已明确排除，见 §5.2）
- 按复杂度排序/筛选（复杂度本次只存储、展示、编辑；视图排序口径不变）
- 硬阻塞（前置未完成时禁止完成）。选定的是软阻塞：可完成，但要经过一次确认
- 新增路由视图（「执行顺序」视图不在本次范围内）
- 子任务描述进全文搜索。FTS5 的 `task_search` / `comment_search` 与 `SearchHit` 的 `kind` 只有「任务 / 评论」两态，把子任务描述纳入检索需要第三张索引表与新的命中类型，属于独立功能

## 3. 现状：影响设计的事实

| 事实 | 出处 | 影响 |
| --- | --- | --- |
| `tasks` 已有 `note` / `priority` / `due_at` / `sort_order` | `V2__schema.sql:42-57` | 任务侧只需补 `complexity` 一列 |
| `subtasks` 只有 `title` / `done` / `sort_order` | `V2__schema.sql:65-74` | 子任务侧要补四列 |
| 现有「排序」是持久化的手动顺序（fractional indexing） | `sort.rs`、`ARCHITECTURE §4` | **与依赖是两回事**：`sort_order` 决定「怎么显示」，依赖决定「什么时候能做」。本次不动 `sort_order` |
| 子任务重排已有 `subtask:reorder` + `between(a,b)` | `services.rs:579` | 依赖不参与重排，两者互不干扰 |
| `task_reminders(task_id, kind)` 标记去重，`WITHOUT ROWID` | `V3__task_reminders.sql` | 无法把可空来源列塞进主键，子任务提醒需要自己的表 |
| 外键约束已开启（`V1` 的 `PRAGMA foreign_keys = ON`） | `db.rs:88` 测试 | 边表可以用真实的 `ON DELETE CASCADE` |
| 软删除不级联（`soft_delete_task` 只动 `tasks`） | `services.rs:415` | 「删掉前置」不会自动删边，语义要在查询里定 |
| 子任务已有全量加载 `subtask:listAll` + `setSubtasksAll` | `hooks.ts`、`store.ts` | 依赖边照抄这套模式，一次拉全、前端派生 |
| 完成入口共 5 处：`TaskListView:125,161`、`BoardView:58`、`TaskDetailDialog:78`、`SubtaskList:117` | `grep completeTask/completeSubtask` | 软阻塞必须收敛在 hooks 里，否则要改 5 处 |
| 备份是「数据库的副本，不是视图」 | `models.rs:BackupData` | 依赖边必须进备份，否则导出即丢数据 |
| `BACKUP_VERSION = 1` | `services.rs:1087` | 备份格式变了，要升版本 |
| 无 `ConfirmDialog` 原语，删除确认是就地两步式 | `TagManagerDialog.tsx:162` | 软阻塞确认需要一个新的宿主组件 |

## 4. 数据层

### 4.1 迁移 `V4__task_attributes_and_dependencies.sql`

```sql
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

三张表都是「纯连接/纯标记」表，沿用 `task_tags`、`task_reminders` 的惯例：复合主键、无 UUID、无审计列。`ADD COLUMN` 带 `CHECK` 是允许的（SQLite 的限制清单只排除 PRIMARY KEY / UNIQUE / 非常量默认值 / 带 REFERENCES 的 NOT NULL / STORED 生成列），已有行取 NULL 或默认值 `'none'`，都满足各自的 `CHECK`。

`depends_on` 上的索引是必需的：反查「谁在等我」与环检测都从这一侧走。

`db.rs` 的 `schema_contains_all_tables` 测试里那张硬编码表名清单要同步加上三张新表。

### 4.2 模型

| 类型 | 变更 |
| --- | --- |
| `Task` | `+ complexity: Option<i64>` |
| `Subtask` | `+ note: Option<String>`、`+ priority: Priority`、`+ due_at: Option<DateTime<Utc>>`、`+ complexity: Option<i64>` |
| `NewTask` | `+ complexity: Option<i64>` |
| `UpdateTask` | `+ complexity: Patch<i64>` |
| `NewSubtask` | `+ note/priority/due_at/complexity`（同 `Subtask` 的可选口径） |
| `UpdateSubtask` | `+ note: Patch<String>`、`+ priority: Option<Priority>`、`+ due_at: Patch<DateTime<Utc>>`、`+ complexity: Patch<i64>` |
| `Dependency`（新） | `{ kind: DependencyKind, dependent_id: Uuid, prerequisite_id: Uuid }` |
| `DependencyKind`（新） | `Task \| Subtask`，serde lowercase |

`Patch<T>` 的既有语义保持不变：字段缺失＝不动，显式 `null`＝清空。`complexity` 的取值校验（`1..=5` 或 `null`）在 `services` 里做，DB 的 `CHECK` 兜底。

加字段这件事在 `repositories.rs` 里要一次改全四处，漏一处就是运行时错误：`TASK_COLUMNS` / `SUBTASK_COLUMNS` 列常量、`task_from_row` / `subtask_from_row` 行映射、`insert` 的列与占位符、`update` 的 `SET` 子句。`repositories.rs` 的 `sample_task` / `sample_subtask` 测试工厂同样要补字段，否则整个测试模块编译不过。

### 4.3 命令

三个新命令，走 `commands.rs`（薄包装）→ `services.rs`（校验）→ `repositories.rs`（SQL），并在 `lib.rs` 的 `invoke_handler` 与前端 `COMMANDS` 中注册：

| 命令 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `dependency:listAll` | — | `Dependency[]` | 只返回**两端都存活**的边；子任务边还要求父任务存活（与 `subtask:listAll` 同一口径） |
| `dependency:add` | `{ kind, dependentId, prerequisiteId }` | `Dependency` | 幂等（`INSERT OR IGNORE`）；校验见 §5.2 |
| `dependency:remove` | 同上 | `void` | 幂等，删不存在的边不报错 |

`listAll` 的两条 SQL（子任务那条用子查询而非 JOIN，理由同 `subtasks::list_all`：列常量不带表前缀，JOIN 会撞歧义）：

```sql
-- 任务边
SELECT d.task_id, d.depends_on FROM task_dependencies d
  JOIN tasks a ON a.id = d.task_id    AND a.deleted_at IS NULL
  JOIN tasks b ON b.id = d.depends_on AND b.deleted_at IS NULL
 ORDER BY d.task_id, d.depends_on;

-- 子任务边
SELECT d.subtask_id, d.depends_on FROM subtask_dependencies d
 WHERE d.subtask_id IN (SELECT id FROM subtasks WHERE deleted_at IS NULL)
   AND d.depends_on IN (SELECT id FROM subtasks WHERE deleted_at IS NULL)
   AND d.subtask_id IN (SELECT id FROM subtasks s JOIN tasks t ON t.id = s.task_id
                         WHERE t.deleted_at IS NULL)
 ORDER BY d.subtask_id, d.depends_on;
```

子任务边已由写入侧的「同父」校验保证两端同属一个任务（`subtasks.task_id` 创建后不会再变，没有换父操作），所以只校验**依赖方**一侧的父任务存活就够了。

### 4.4 备份

依赖边是用户数据，必须进备份：

- `BackupData` 加 `#[serde(default)] dependencies: Vec<Dependency>`（一个数组带 `kind`，覆盖两张表）。**不加 `BackupCounts` 字段**：依赖边不是用户可见实体，设置页的「恢复了 N 个任务、M 个项目」不需要多一个数字
- `BACKUP_VERSION` 升到 `2`：新备份含有旧版本读不懂的数据，旧版本导入时应当明确拒绝，而不是静默丢掉依赖
- `backup::export_all` 读两张边表；`backup::replace_all` 的 `DELETE FROM` 清单与插入阶段都要带上它们
- `BackupData` 的文档注释里那句「`task_reminders` stays out」补上 `subtask_reminders`
- 旧的 version 1 备份仍可导入（新字段 `#[serde(default)]` 兜底）

## 5. 依赖语义

### 5.1 边的方向

`(A → B)`，落库为 `(task_id = A, depends_on = B)`，读作「**A 依赖 B**：B 完成前 A 被阻塞」。A 叫**依赖方**，B 叫**前置**。反向关系「谁在等我」由同一条边反查得出，不重复存储。

### 5.2 `dependency:add` 的四条校验

| 规则 | 违反时的错误 |
| --- | --- |
| 两端实体存在且未软删 | `NotFound`（复用 `not_found("任务"/"子任务", id)`） |
| 子任务边：两端必须同一个 `task_id` | `Validation("子任务依赖需在同一个任务内")` |
| 不能自依赖 | `Validation("不能依赖自身")`（DB 的 `CHECK` 兜底） |
| 不能成环 | `Validation("会形成循环依赖")` |

环检测用递归 CTE，从**前置**出发沿 `depends_on` 反向可达，若命中**依赖方**则成环：

```sql
WITH RECURSIVE chain(id) AS (
    SELECT ?1                                                    -- 前置
    UNION
    SELECT d.depends_on FROM task_dependencies d JOIN chain ON d.task_id = chain.id
)
SELECT EXISTS(SELECT 1 FROM chain WHERE id = ?2)                 -- 依赖方
```

`UNION`（而非 `UNION ALL`）负责去重，顺带保证即使库里已存在环也不会无限递归。两张边表共用这段逻辑，表名由调用方以常量传入（不是用户输入）。

**只做后端校验不做前端预过滤是不行的**：候选列表里那些必然成环的任务，前端要直接从候选里滤掉（边已全量在手，反向可达是 O(E) 的纯计算），否则用户会挑到一个必然报错的选项。

### 5.3 软删除语义：边留着，阻塞解除

任务被软删时**不删边**（软删不级联，也不该级联）。但 `listAll` 只返回两端都存活的边，因此：

- 删掉前置 ⇒ 被它阻塞的项**自动解锁**（不会永久卡死）
- `task:restore` 恢复该任务 ⇒ 边自动回来（因为它一直在库里）

这条语义必须写进 ARCHITECTURE，否则「为什么删了前置我的任务就解锁了」会被当成 bug。

### 5.4 与手动排序的关系

`sort_order` / `position` 是「显示顺序」，依赖是「可执行顺序」，两者独立：改依赖不改 `sort_order`，重排不改依赖。看板拖拽与子任务上下移的行为完全不变。

## 6. 子任务提醒

提醒链路现状：`task_reminders` 去重标记 → `reminders::list_candidates` 扫窗口内未完成任务 → `services::scan_reminders` 逐个 fire → `scheduler.rs` 发系统通知 + `reminder:triggered` 事件 → 前端 toast + 点击定位。子任务纳入的方式：

1. **新表 `subtask_reminders`**（§4.1 的镜像）。不复用 `task_reminders`：它是 `WITHOUT ROWID`，主键列不允许 NULL，塞一个可空来源列进主键不可行。
2. **候选扫描新增 `list_subtask_candidates`**：窗口内 `due_at`、`done = 0`、**父任务存活且未完成**的子任务。父任务一完成，其子任务提醒自动停；子任务勾完同理。

   ```sql
   SELECT s.id, s.task_id, s.title, s.due_at, t.title AS task_title
     FROM subtasks s JOIN tasks t ON t.id = s.task_id
    WHERE s.deleted_at IS NULL AND s.done = 0
      AND t.deleted_at IS NULL AND t.completed_at IS NULL
      AND s.due_at IS NOT NULL AND s.due_at > ?1 AND s.due_at <= ?2
    ORDER BY s.due_at, s.id
   ```

   JOIN 的第二个作用是给通知文案取父任务标题（`写周报 › 收集数据`），不必再查一次。
3. **`Reminder` 加两个可选字段** `subtask_id` / `subtask_title`（`#[serde(default)]`，旧的事件负载仍能反序列化）。`task_id` 语义不变＝**父任务**，所以前端 `locatePendingReminder` 的「点击通知定位任务」一行都不用改——子任务没有独立详情页，它就落在父任务的详情弹窗上。
4. **文案**：`scheduler.rs::notification_texts` 与前端 `reminders.ts::formatReminderMessage` 在 `subtaskTitle` 存在时渲染成 `「写周报 › 收集数据」将于 10 分钟后到期`。
5. 子任务软删/完成不清理已发出的标记（与 V3 对任务的既有做法一致：恢复后不会重复提醒）。

## 7. 前端

### 7.1 类型与 IPC

`src/features/tasks/types.ts` 与 `src/features/tasks/api.ts` 按 §4.2 同步；`src/common/ipc/commands.ts` 加 `dependency.{listAll,add,remove}`；`reminders.ts::ReminderPayload` 加两个可选字段。

### 7.2 store 与纯函数

`TasksState` 加 `dependencies: Dependency[]`，随 `loadAll` 与 `task:list` / `subtask:listAll` 并排拉取（`Promise.all` 第四路）。`reloadTasks`（中途刷新）**不**重拉依赖：与 `setSubtasksAll` 同样的理由，它会盲目覆盖；依赖是低频写入，中途没必要重取。

新增 `src/features/tasks/dependencies.ts`，全部是**纯函数**（表驱动单测，不需要组件测试）：

| 函数 | 作用 |
| --- | --- |
| `blockersOf(state, kind, id)` | 未完成的前置实体列表（任务看 `completedAt`，子任务看 `done`） |
| `successorsOf(state, kind, id)` | 谁在等我（反查） |
| `isBlocked(state, kind, id)` | 是否被阻塞 |
| `wouldCycle(state, kind, dependent, prerequisite)` | 加入这条边是否会成环（前端预过滤候选用） |

子任务的一切查询都限定在自己的父任务内；选择器只列同父兄弟。

### 7.3 hooks 与软阻塞的收敛点

`addDependency` / `removeDependency` 走既有 `optimistic()`（乐观更新 → 落库 → 回滚 + toast）。

**软阻塞收敛在 hooks 里**：`completeTask` 与 `completeSubtask(…, done)` 在 `done === true` 时先查 `isBlocked`；被阻塞则**不落库**，把请求放进一个新的 `pendingBlockedConfirm` 信号并返回 `null`。AppShell 挂一个 `<BlockedConfirmHost/>`（新增 `src/app/BlockedConfirmHost.tsx`，与 `<Toaster />` 同层）渲染 `Dialog`：列出未完成前置的标题（纯文本，不做点击跳转——避免两个弹窗叠加），按钮「取消 / 仍要完成」；确认后走 `forceCompleteTask` / `forceCompleteSubtask`（hooks 内部导出，仅供该宿主使用，不进公开 API）。

这样做的收益：**5 个完成入口（任务行、看板卡、详情弹窗、子任务行 ×2）零改动**——它们本来就 `void completeTask(...)`，且把 `null` 当失败处理，UI 不会错（复选框由 `completedAt`/`done` 驱动，未落库就不会勾上；确认后 store 更新，自然勾上）。

没有用 `window.confirm`：Tauri 三端 webview 对它的支持不一致（Q-03 正是三端验证项），且与设计系统不一致。这是本方案唯一新增的基础设施。

### 7.4 UI 落点

| 位置 | 改动 |
| --- | --- |
| `TaskEditorDialog` | 加「复杂度」`Select`（未评估 / 1–5），与优先级、截止时间同层 |
| `TaskDetailDialog` | 徽标区加复杂度与「阻塞中 · 还差 N 项」；子任务区之前插入「依赖」区（前置可删、后置只读、输入框按标题过滤候选并滤掉自身与成环候选） |
| `SubtaskList` | 每行加一个属性按钮，在该行**下方内联展开** `SubtaskEditor`（描述 / 优先级 / 截止时间 / 复杂度 / 前置子任务多选，候选＝同父兄弟的 chip，复用 `TaskEditorDialog` 的标签选择器写法）；行内标题编辑、上下移、删除保持原样；行上补优先级 / 截止（逾期 danger）/ 阻塞的紧凑标记 |
| `TaskItemRow` | 加 `blocked` / `blockerCount` 两个属性，渲染「阻塞中 · N」徽标（warning 变体 + `Lock` 图标） |
| `SubtaskRow` | 同上，`blocked` 属性渲染紧凑标记 |
| `AppShell` | 挂 `<BlockedConfirmHost />` |

各视图（`TaskListView` 及 `views/`）把派生出的 `blocked` / `blockerCount` 传给行组件。

## 8. 重复任务

`spawn_next_instance`（`services.rs:92`）目前把子任务标题抄进新实例并重置 `done`。新字段的处理：

- `note` / `priority` / `complexity` 照抄
- `due_at` 按与父任务相同的周期平移（复用 `next_due`），否则复制出来的子任务一出生就是逾期
- **依赖边不继承**：跨实例的边会指向上一轮的旧行；实例内重建依赖没有明确需求，YAGNI

## 9. 测试

**Rust**（`services.rs` / `repositories.rs` / `scheduler.rs` / `db.rs` 的既有测试模块）

- 依赖：成环拒绝（两节点、三节点、自环）、跨父子任务拒绝、自依赖拒绝、幂等重复添加、删除不存在的边不报错、`listAll` 隐藏软删端点（任务与子任务两侧）、恢复后边回来
- 属性：子任务四字段往返（含 `Patch` 的清空语义）、复杂度越界（0 / 6）拒绝、`null` 允许
- 提醒：子任务提前 1 小时 / 10 分钟 / 到期各 fire 一次、`done` 后不 fire、父任务完成后不 fire、标记不因重扫而重复 fire
- 重复实例：子任务字段照抄、`dueAt` 平移、新实例无依赖边
- 备份：依赖边导出→导入往返、旧 version 1 文档仍可导入、`BACKUP_VERSION` 拒绝更新的文件
- `db.rs` 表名清单加三张新表

**前端（vitest）**

- `dependencies.ts` 纯函数表驱动：blockers / successors / isBlocked / wouldCycle（含长链与菱形）
- `hooks.test.ts`：被阻塞时 `completeTask` **不发 IPC**、确认后才发；取消则状态不变
- `task-detail-dialog.test.tsx`：依赖区渲染、添加与删除走 `api.addDependency`
- `task-views.test.tsx`：阻塞徽标出现/消失
- `reminders.test.ts`：子任务提醒文案

**收口命令**：`cargo fmt`、`cargo clippy --all-targets -- -D warnings`（两者必须零输出）、`cargo test`、`pnpm typecheck`、`pnpm test`。

## 10. 文档同步

| 文档 | 改动 |
| --- | --- |
| `docs/PRD.md` | §2.1 任务模型字段表加复杂度；子任务段落改写（四属性 + 依赖 + 完成顺序软确认）；§2.1 的筛选口径那句「子任务没有优先级、标签与截止日期」按新事实修正；提醒范围含子任务 |
| `docs/ARCHITECTURE.md` | §4 数据模型（V4 摘要 + 三张新表）；§3.2 IPC 命令清单（3 个新命令 + 语义）；依赖语义（边方向、环检测、软删除解锁）；「手动排序 vs 依赖」的区别；提醒链路补子任务分支 |
| `docs/IMPLEMENTATION_PLAN.md` | 新增里程碑条目（任务属性与依赖，含验收标准），状态标 ✅ |

## 11. 已知取舍

1. **软阻塞而非硬阻塞**：规则不拦人，只提示。代价是「完成顺序」是建议性的；好处是建错依赖不会把用户锁死在自己的规则里。
2. **依赖边全量常驻前端**：单用户本地场景，边数量级远小于任务数，换来的是零额外查询的派生与即时的阻塞标记。
3. **子任务提醒用独立表**：两张结构同构的去重表，比把 `task_reminders` 改造成多态表更啰嗦，但保住了 `WITHOUT ROWID` 的主键完整性与外键约束。
4. **软删不删边**：解锁语义需要一个解释成本，但它避免了「删了前置导致后继永久卡死」这个更糟的失败模式。
5. **重复实例不继承依赖**：如果将来需要「每天的实例继承上一步」这种玩法，要在生成时重映射 id，那时再单独设计。
6. **子任务描述不进搜索**：子任务有了描述却搜不到，是个真实的缺口。要补就得给 FTS5 加第三张索引表、同步触发器与新的命中类型，成本明显高于本次其余部分，因此单列一项待办而不是顺手做掉。

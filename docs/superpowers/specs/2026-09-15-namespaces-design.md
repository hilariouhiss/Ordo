# 命名空间（设计）

日期：2026-09-15
状态：已确认，待实施

## 1. 背景与目标

今天「项目」是唯一一层的组织单位：侧边栏平铺所有项目，项目之间没有任何关系。当用户同时推进若干**同类或有联系**的项目（例如「工作」下的几个产品线、「学习」下的几门课）时，只能靠命名约定（`工作-网站`）凑合，既看不出分组，也没有任何按组汇总的进度。

本次引入**命名空间**：一个可以把多个项目收在一起的容器，对应 GitHub 组织 / GitLab 命名空间的心智模型。

1. **归属**：一个项目**至多**归属一个命名空间；不归属的项目留在根级（今天的观感）。
2. **导航**：侧边栏把项目按命名空间分组显示，可折叠；未归属的项目与今天完全一致。
3. **汇总**：新增命名空间页 `/namespaces/:id`——组内项目列表 + 该组的汇总进度（项目数、任务完成率、逾期项目数）。

目标是「相关的项目放在一起管」，**不是**把命名空间做成一个新的筛选维度：任务视图、搜索、统计的口径本次一律不变。

## 2. 非目标

- **嵌套命名空间**（GitLab 分组树）。单用户本地应用没有跨组共享/继承的需求，树要付递归渲染、面包屑、深度与环校验的成本，收益为零。
- **多对多归属**（一个项目挂多个命名空间）。那会把「归属」稀释成「标签」，让聚合进度重复计数、导航出现重复条目。
- **命名空间作为筛选维度**：今天/即将到来/已完成/搜索/统计不加「按命名空间过滤」。
- **跨项目聚合任务视图**：命名空间页只列项目，不把组内所有任务汇成一个列表/看板（收件箱任务没有看板列，与现有列模型冲突）。
- **命名空间级权限/成员**：单用户应用，无账号体系（PRD §9）。
- **命名空间重排**：与项目一致，`sort_order` 只在创建时追加，没有拖拽重排命令（项目今天也没有）。
- **命名空间硬删除**：与项目一致，只做归档；`deleted_at` 沿用「保留未用」的约定。
- **`@命名空间/项目` 快捷语法**：`quick-add-parse.ts` 的「不猜、只删看得懂的」原则下，把 `@` 变成两段式匹配会新增一片歧义面，收益只是少敲几个字。
- **命名空间级截止日期**：截止属于项目，容器不带 `due_at`。

## 3. 现状：影响设计的事实

| 事实 | 出处 | 影响 |
| --- | --- | --- |
| `projects` 表已有 `status(active\|archived)` + `sort_order` + `deleted_at` | `V2__schema.sql:12-25` | 命名空间表与其同构，归档语义可以直接照抄 |
| 项目归档是 `status` 翻转，不是软删；`deleted_at` 至今没有被任何命令使用 | `repositories.rs:611-615` | 命名空间同样只做 `archive`/`restore` |
| 仓储按领域分 `pub mod`，用纯函数收 `&Connection` | `repositories.rs:616`（`projects`） | 新增 `pub mod namespaces` 是照抄，不是新范式 |
| 服务层已有 `validated_name`、`append_key`（字典序追加 + 键耗尽重排） | `services.rs:56`、`services.rs:188` | 命名空间创建直接复用，不写新的排序逻辑 |
| `Patch<T>` 三态 JSON patch（缺省=不改 / `Set(null)`=清空） | `models.rs:385` | `namespaceId` 的「移出命名空间」就是 `Patch::Set(None)`，无需新命令 |
| 外键约束在迁移后的连接上**确实生效** | `db.rs:91` 测试（已验证通过） | 可空外键与 `ON DELETE SET NULL` 是真的约束，不是装饰 |
| `db.rs` 有一个「所有表都在」的断言清单 | `db.rs:66-82` | 新表必须加进这份清单，否则这条断言失去意义 |
| 备份是「数据库的副本」：`export_all` / `replace_all` 逐表列出，先删子表先插父表 | `repositories.rs:1371-1485` | 加一张父表要同时改导出、删除顺序与插入顺序 |
| `BACKUP_VERSION = 2`，导入拒绝「比当前新」的版本 | `services.rs:1225-1227`、`services.rs:1268` | 备份格式变了要升到 3；旧文件靠 `#[serde(default)]` 兼容 |
| `BackupData` 的每个字段都带 `#[serde(default)]` | `models.rs:262-283` | v1/v2 文件缺 `namespaces` 字段即可解析为空列表 |
| `Project` 的字段**没有** `#[serde(default)]` | `models.rs:95-107` | 新增 `namespace_id` 必须补上，否则旧备份解析失败（`subtasks.priority` 已有先例，见 `models.rs:160`） |
| `stats:projectProgress` 只统计 `status = 'active'` 的项目 | `ARCHITECTURE.md:262` | 命名空间页的汇总口径照此：只算 active 项目，归档项目不进完成率 |
| `ProjectProgress` 收 `{ tasks: Task[]; dueAt: string \| null }`，全部数字派生自传入切片 | `ProjectProgress.tsx:5-10` | 命名空间页直接复用：传组内所有 active 项目的任务切片 + `dueAt={null}`，不新增后端聚合命令 |
| 项目详情页从 store 取实时切片（`tasksState.tasks.filter(...)`） | `ProjectListView.tsx:30` | 汇总数字随勾选在同一 tick 变化，无 IPC 往返 |
| 侧边栏「项目」区是平铺 `activeProjects()` + 归档折叠区 | `AppShell.tsx:182-271` | 分组只改这一段；折叠状态照 `archivedOpen` 用本地 signal，不落库 |
| 项目下拉控件已经有两处 Kobalte `Select` 的坑：挂载时带初值触发一次 `onChange`、`optionValue` 返回 `""` 会被读成「未选择」 | `AGENTS.md`、`TaskEditorDialog.tsx:191-207` | 新加的「命名空间」Select 必须忽略同值调用，并用真哨兵（`"none"`）而不是 `""` |
| 快捷添加入口（D-02）自建 store，只加载项目 | `QuickAddWindow.tsx:111,122` | 快捷窗本次不改：它的项目控件仍平铺（分组只会让键盘多走几行） |
| 前端测试有现成范式：store/hooks/对话框各自单测，工厂函数手写实体字面量 | `features/projects/__tests__/` | 新域照抄；`Project` 工厂要补 `namespaceId`（TS 会指出所有位置） |

## 4. 数据层

### 4.1 迁移 `V5__namespaces.sql`

```sql
-- 命名空间：与 projects 同构的容器（可空外键归属，不是连接表）。
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

-- 一个项目至多归属一个命名空间；不归属即 NULL（今天的全部数据）。
-- 默认值为 NULL 是 SQLite 允许「带 REFERENCES 的 ADD COLUMN」的前提：
-- 外键开启时该列必须有 NULL 默认值。
ALTER TABLE projects ADD COLUMN namespace_id TEXT
    REFERENCES namespaces(id) ON DELETE SET NULL;

CREATE INDEX idx_projects_namespace ON projects(namespace_id);
```

不加 `UNIQUE (namespace_id, name)`：本地单用户、没有 URL/slug 语义，项目名本来也不唯一；重名只表现为两个同名行，不产生歧义。

### 4.2 模型

- `models.rs`：新增 `Namespace`（字段同名同序，去掉 `due_at`）、`NewNamespace { name, description?, color?, icon? }`、`UpdateNamespace { name?, description?, color?, icon? }`，全部 `#[serde(rename_all = "camelCase")]`，与 `Project` 那三个类型逐一对应。
- `Project` 增加 `#[serde(default)] pub namespace_id: Option<Uuid>`（`default` 是旧备份可解析的前提）。
- `NewProject` 增加 `#[serde(default)] pub namespace_id: Option<Uuid>`；`UpdateProject` 增加 `#[serde(default)] pub namespace_id: Patch<Uuid>`。

### 4.3 命令

命令面与项目**逐条对齐**，不多一条：

```
namespace:list | create | update | archive | restore
```

- `commands.rs` 照 `project:*`（`commands.rs:182-211`）写薄包装，`lib.rs` 的 `invoke_handler` 注册。
- `services.rs`：`list/create/update/archive/restore_namespace`；创建时 `validated_name` + `append_key`（与 `create_project` 同款：先重排、再插入，全在一个事务里），状态翻转复用同款 `set_status` 语义（重复归档/恢复是幂等 no-op，返回当前行）。
- `create_project` / `update_project` 增加 `namespaceId` 校验：**非空时必须存在且未软删**，否则 `AppError::NotFound`（照 `add_board_column` 校验项目存在性的写法）。空值即不归属，不做校验。
- 不新增 `namespace:reorder`、不新增 `namespace:delete`（见 §2）。

### 4.4 备份

- `BackupData` / `BackupCounts` 增加 `#[serde(default)] namespaces`，`BACKUP_VERSION` 由 2 升到 3。
- `backup::export_all`：`namespaces` 放在 `projects` 之前（与 `replace_all` 的插入顺序一致，读导出文件时父表在前）。
- `backup::replace_all`：删除顺序里 `namespaces` 排在 `projects` **之后**（先删子表），插入顺序里排在 `projects` **之前**（父表先落地，`projects.namespace_id` 的外键才成立）。
- v1/v2 文件缺该字段 → 空列表；其中项目的 `namespaceId` 反序列化为 `None` → 全部落在根级，与导出时一致。
- 手工改坏的悬空 `namespaceId`（指向文件里不存在的命名空间）会让整次导入在事务里失败、不改动任何数据——与 `tasks.project_id` 今天的表现同构，故意不加清洗代码。

## 5. 归属与生命周期语义

### 5.1 归属至多一个

`projects.namespace_id` 可空外键，`ON DELETE SET NULL`。选择可空外键而不是连接表：归属是「至多一个」的一对多关系，连接表在这里只是多一张要维护、要多写一遍索引的表（YAGNI）。

### 5.2 归档不级联

归档命名空间**只**把它移出导航（进入侧边栏的「已归档」区），**不**改动其下任何项目的 `status`。恢复即回组。

理由：一次点击不该静默改掉几十个项目的状态；而且在「归档 = 软状态、可恢复」的约定下，级联归档需要一个级联恢复，还要记住哪些项目是「被级联的」才能正确恢复——那份记录本身就是新的状态。

### 5.3 孤儿回落

前端一切分组派生都按**存活命名空间集合**判断归属，而不是只看 `namespaceId` 是否为空：

- `namespaceId === null` → 未归属。
- `namespaceId` 指向已软删 / 不存在的命名空间 → **按未归属处理**，项目仍显示在根级，不从导航里消失。

这与 `dependencies.ts` 用 `liveSet` 建索引是同一手法：软删除是乐观的，派生必须容忍指向已消失行的引用。`ON DELETE SET NULL` 只在**硬删**时兜底，而今天的命令面不做硬删，所以这条回落规则才是实际生效的那条。

### 5.4 移出命名空间

就是一次普通的项目更新：`project:update` 带 `namespaceId: null`（`Patch::Set(None)`）。不加专门命令；行内菜单提供入口。

### 5.5 分组显示规则（每个项目只出现在一处）

| 项目的状态 | 显示位置 |
| --- | --- |
| 归属存活命名空间 + `active` | 侧边栏该命名空间分组下（展开时） |
| 归属存活命名空间 + `archived` | 侧边栏「已归档」区的平铺列表（与今天一致） |
| 未归属（`null` 或孤儿）+ `active` | 侧边栏根级平铺列表（与今天逐像素一致） |
| 未归属（`null` 或孤儿）+ `archived` | 侧边栏「已归档」区的平铺列表 |
| 归属**已归档**命名空间（任意状态） | 该命名空间在「已归档」区展开时缩进列出（整组已经离开导航） |

没有任何命名空间时，侧边栏与今天完全相同——存量用户零变化。

## 6. 前端

### 6.1 类型与 IPC

- `src/features/namespaces/{types,api,store,hooks}.ts`，逐字对齐 `features/projects` 的同名四个文件：`optimistic()` 包装、`optimistic-` 临时 id、`fallbackSortOrder`（用 `"\uffff"` 让乐观行排在最后）、失败回滚 + 通知。
- `src/common/ipc/commands.ts` 增加 `namespace: { list, create, update, archive, restore }`。
- `features/projects/{types,api}.ts` 的 `Project` / `NewProject` / `UpdateProject` 增加 `namespaceId`（`UpdateProject` 里 `namespaceId?: string | null`，与后端 `Patch<Uuid>` 的「缺省=不改、null=清空」一致）。

### 6.2 store 与派生

`namespaces/store.ts` 持有全量命名空间（含已归档，供侧边栏恢复），并导出派生：

- `activeNamespaces()` / `archivedNamespaces()`：按 `sortOrder`。
- `isNamespaceLive(id)`：存活集合判定（§5.3 的唯一入口）。
- `projectsInNamespace(id)`：属于该**存活**命名空间的 `active` 项目。侧边栏分组、命名空间页的项目行、以及该页的汇总切片用的都是它——一个口径，不留第二个「全部存活项目」的变体，也就不会出现「行里显示归档项目、汇总却不算它」的分叉。
- `ungroupedProjects()`：`namespaceId === null || !isNamespaceLive(namespaceId)`，且 `status === "active"`。
- `archivedLooseProjects()`：仍留在「已归档」平铺列表里的项目——未归属的、孤儿、以及归属**存活**命名空间的；归属已归档命名空间的归档项目缩进在那一组下面。
- `archivedProjectsOf(id)`：已归档命名空间展开时要列出的项目（该组下全部存活项目，含自身已归档的）。

派生函数写在 `namespaces/store.ts` 里但读 `projectsState`——分组是两个域的交叉量，放在哪一边都要交叉 import；放在「容器」这一侧（namespaces）比让 `projects/store.ts` 认识命名空间更自然。`features` 之间不 import 内部实现的规则约束的是**组件**，store 之间的只读派生是既有做法（`ProjectListView` 已经直接读 `tasksState`）。

### 6.3 hooks 与加载

- `loadAll()` 拉 `namespace:list`；`createNamespace` / `updateNamespace` / `archiveNamespace` / `restoreNamespace` 走统一的乐观 + reconcile + 回滚。
- 启动加载：`AppShell.onMount` 在现有 `loadProjects()` 旁边加 `if (!namespacesState.loaded) void loadNamespaces()`。侧边栏要分组，就必须在首屏拿到命名空间，不能懒加载。
- 命名空间页自己兜底：未加载时 `loadNamespaces()` + `loadProjects()`（照 `ProjectDetailView` 的 `failed` / `loaded` 两态写法）。

### 6.4 UI 落点

**(a) 侧边栏（`AppShell.tsx` 的「项目」区）**

```
项目                          [+]
▾ 🗂 工作 (3)          ← chevron 折叠；点名字跳 /namespaces/:id
     ▪ 网站改版
     ▪ 移动端
▾ 🗂 学习 (2)
     ▪ 论文
+ 新建命名空间          ← 低对比度文字行，仅侧边栏展开时显示
▪ 无归属的项目          ← 未归属项目直接列在这（与今天完全一致）
已归档 (2) ▸           ← 已归档命名空间（展开缩进列项目）+ 已归档项目平铺
```

- 分组折叠状态放 `AppShell` 的本地 signal（与现有 `archivedOpen` 一样），不落库。
- 分组行：颜色/图标 + 名称 + 项目数；`chevron` 是独立按钮（`aria-expanded`），名字是 `Link`。行上不放「⋯」菜单——重命名与归档都在命名空间页里做，侧边栏只负责导航（与项目行今天的行为一致）。
- 分组行上的项目数是**该组的 active 项目数**（`projectsInNamespace(id).length`），与命名空间页的项目行数一致。
- 折叠态（侧边栏收起）下分组行退化为只有图标的行——与今天的项目行一致；「已归档」区在收起态不显示（今天的既有行为）。

**(b) 命名空间页 `/namespaces/$namespaceId`**（新路由，懒加载，照 `ProjectDetailView` 的加载/兜底）

- 头部：颜色/图标 + 名称 + 描述 + 「编辑」「归档」；已归档时显示徽章与「恢复」。
- 汇总：`ProjectProgress`，传该命名空间下**全部 active 项目**的任务切片 + `dueAt={null}`（无截止行，`Show when={due()}` 自然不渲染）。不新增后端聚合命令。
- 项目行列表：图标 + 名称 + 每行一条 `ProjectProgress`（复用现成组件，不新画一条进度条）+ 行内菜单（编辑 / 移出命名空间 / 归档）。
- 空态：`EmptyState` + 「新建项目」（`ProjectEditorDialog` 预置 `namespaceId`）。
- 归档项目不在本页出现（在侧边栏「已归档」区管理），保持与今天归档语义一致。

**(c) 编辑器**

- `ProjectEditorDialog` 增加「命名空间」`Select`：选项 = 「不归属」+ 各存活命名空间。用真哨兵 `"none"` 而不是 `""`，并忽略与当前值相同的 `onChange`（Kobalte 挂载时会带初值触发一次）。
- 新增 `NamespaceEditorDialog`：名称（必填，Zod）、描述、颜色（复用 `PROJECT_COLORS`）、图标（复用 `projects/icons.ts` 的 `PROJECT_ICON_NAMES`）。与项目编辑器同构，去掉截止日期。

### 6.5 明确不变的部分

任务视图、看板、搜索、统计、快捷输入语法、快捷窗（D-02）、托盘/提醒调度，一律不改。`@项目` 标记仍按项目名匹配。

## 7. 边界情况

| 情况 | 行为 |
| --- | --- |
| 命名空间下没有项目 | 分组行显示 `(0)`；命名空间页显示空态 |
| 命名空间下只有归档项目 | 分组只统计 `active` 项目，显示 `(0)`；归档项目在侧边栏「已归档」区 |
| 命名空间名与项目名相同 | 允许，两者不在同一列表里竞争 |
| 两个同名命名空间 | 允许（无唯一约束） |
| 归档命名空间后又归档其下项目 | 项目在该命名空间的归档分组里缩进显示，不重复出现在平铺列表 |
| 恢复一个「其项目已全部被移出」的命名空间 | 分组回来、空组显示；不报错 |
| 项目 `namespaceId` 指向不存在的命名空间（手改的备份） | 导入整体失败、不改数据（§4.4）；若经由别的途径进入库，前端按未归属显示（§5.3） |
| 快捷窗新建的项目 | `namespaceId` 为空 → 根级显示，与今天一致 |

## 8. 测试

**后端（in-memory SQLite + 真实迁移）**

- `db.rs`：表清单断言增加 `namespaces`；先插一行项目、再跑 `V5`，该行的 `namespace_id` 为 `NULL`（`ALTER TABLE ... ADD COLUMN ... REFERENCES` 的合法性与旧数据回落一起被这条覆盖）。
- `repositories`/`services`：命名空间 CRUD 往返；归档/恢复幂等；`append_key` 追加顺序；`projects` 带 `namespaceId` 的 insert/update/读取往返（含 `Patch::Set(None)` 清空）。
- `create_project` / `update_project` 传不存在的 `namespaceId` → `NotFound`；传软删的命名空间 → `NotFound`。
- 备份：`export_all` 携带命名空间；`replace_all` 后项目仍挂在原命名空间上；**v2 文档（无 `namespaces` 字段）仍能导入**，项目全部落在根级。

**前端（Vitest）**

- `namespaces/store.test.ts`：`activeNamespaces`/`archivedNamespaces` 排序与切分；`projectsInNamespace` 只收 active、且不收归档项目；`ungroupedProjects` 的**孤儿回落**（`namespaceId` 指向不存在的 id 时仍出现在根级）。
- `namespaces/hooks.test.ts`：创建/更新/归档/恢复的乐观更新、reconcile 与失败回滚（照 `projects/__tests__/hooks.test.ts`）。
- `ProjectEditorDialog`：命名空间 Select 的哨兵与「挂载时的同值 onChange 被忽略」（照 `quick-add-window.test.tsx` 已有的那类断言）。
- 命名空间页：汇总数字随任务完成变化；空态；归档态显示恢复按钮。

**出口**：`cargo test`、`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`pnpm test`、`pnpm typecheck` 全绿。

## 9. 文档同步

- `PRD.md`：§2.2 增加「命名空间」小节（模型字段、导航、汇总），§7 数据模型概述加入 `Namespace`。
- `ARCHITECTURE.md`：§2.1 目录结构加 `features/namespaces/`，§2.4 路由加 `/namespaces/:namespaceId`，§3.2 命令清单加 `namespace:*`，§4.2 实体表与关系图加 `Namespace 1 ──── * Project`，并记录 §5 的归属语义（归档不级联、孤儿回落、备份升版到 3）。
- `IMPLEMENTATION_PLAN.md`：新增里程碑 **M9 命名空间**（任务 NS-01…NS-04）与命令清单、§5 依赖关系（只依赖 M2 的项目域，可独立插入）。
- `AGENTS.md`：migrations 目录清单与「数据约定」无需改（命名空间沿用既有约定）；若 `capabilities`/窗口行为未变则不动。

## 10. 已知取舍

- **不做嵌套**：需要「组内的组」时，第一版的做法是再建一个命名空间并用命名约定区分；真要做树，改动集中在 `namespaces` 表加 `parent_id` + 侧边栏递归渲染 + 深度/环校验，与本次的其余部分正交。
- **不做筛选维度**：命名空间今天只影响导航与一个汇总页；把它接进任务视图筛选与统计参数是另一条独立改动，且不改变本次的数据层。
- **`ungroupedProjects()` 每次渲染都过一遍存活集合**：项目数量级是几十，`Set` 判定是 O(1)，不值得缓存（`ponytail:` 若项目数进入四位数，把它换成一次 `createMemo` 索引）。
- **命名空间页的汇总口径是 active 项目**：与 `stats:projectProgress` 保持一致；若用户希望「归档项目也算历史完成量」，那是统计口径变更，应同时改两处。

# Ordo 应用架构设计

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.0 |
| 更新日期 | 2026-09-08 |
| 状态 | 已生效（M0 部分落地，随实现迭代） |
| 关联文档 | [PRD.md](./PRD.md) |

> 本文档描述 Ordo 的应用架构，是需求（PRD）到代码之间的桥梁。目录结构、模块边界、数据流与关键决策以本文为准；实现时若偏离，需同步更新本文。

---

## 1. 架构总览

Ordo 是 **local-first、单用户** 的桌面应用，采用三层架构：

```
┌─────────────────────────────────────────────────┐
│  前端（SolidJS + TypeScript + Tailwind）          │
│  路由 / 视图 / 组件 / 内存 Store（乐观更新）        │
└──────────────────────┬──────────────────────────┘
                       │ Tauri IPC（类型化 invoke）
┌──────────────────────▼──────────────────────────┐
│  后端（Rust）                                     │
│  commands → services → repositories → models/db  │
└──────────────────────┬──────────────────────────┘
                       │ SQL（rusqlite）
┌──────────────────────▼──────────────────────────┐
│  存储（SQLite，refinery 迁移）                    │
└─────────────────────────────────────────────────┘
```

核心设计原则：

1. **前端持有全部数据，后端是持久化与权威计算源。** 前端启动时全量加载，交互走乐观更新，后端负责落库、迁移、全文搜索（FTS5）与统计聚合。
2. **单向数据流。** 前端操作 → 本地 Store 立即更新 → 异步同步后端 → 用后端返回结果 reconcile。
3. **后端分层内聚。** 只有 `repositories` 写 SQL；`services` 管业务规则；`commands` 是薄 IPC 壳。
4. **本地优先。** 一切不依赖网络，数据模型为未来同步预留（UUID + 时间戳 + 软删除）。

---

## 2. 前端架构

### 2.1 目录结构（Feature-based）

按领域划分，每个 feature 内部聚组件、状态、IPC 调用与类型：

```
src/
├── index.tsx                     # 渲染入口：RouterProvider
├── router.tsx                    # 路由定义（代码式，TanStack Router）
├── index.css                     # Tailwind 入口 + @theme 设计 Token
├── app/                          # 应用装配层
│   ├── AppShell.tsx              # 布局壳：侧边栏 + 顶栏 + 内容区
│   └── TaskViewer.tsx            # 全局任务详情/编辑弹窗（搜索命中等入口的跳转落点）
├── features/                     # 业务领域（按功能划分）
│   ├── tasks/                    # 任务
│   │   ├── components/           # TaskItem / TaskList / 编辑器 / 看板卡
│   │   ├── store.ts              # 任务内存 Store（Solid createStore）
│   │   ├── api.ts                # 类型化 IPC 调用
│   │   ├── hooks.ts              # 领域 hooks（创建/完成/拖拽）
│   │   └── types.ts              # 任务领域类型（与后端 serde 对齐）
│   ├── projects/                 # 项目
│   ├── board/                    # 看板（列 + 拖拽）
│   ├── stats/                    # 统计展示
│   ├── search/                   # 全文搜索
│   ├── tags/                     # 标签
│   └── settings/                 # 设置（主题/自启/快捷键）
├── common/                       # 跨领域共享
│   ├── components/               # 通用 UI（Button/Dialog/Dropdown…基于 Kobalte）
│   ├── ipc/                      # invoke 封装、命令常量、错误归一化
│   ├── stores/                   # 全局 Store（主题、UI 状态、通知）
│   ├── lib/                      # 工具（日期/格式化/排序）
│   └── types/                    # 共享类型
└── assets/
```

**边界规则：**

- `features/*/api.ts` 是**唯一**能直接调用 `invoke` 的地方；组件与 store 只调用本 feature 的 `api.ts` 或 `hooks.ts`。
- `features` 之间不互相 import 内部实现，共享逻辑下沉到 `common/`。跨视图的「跳转到任务」交互（如搜索命中）经由 `common/stores/taskViewer.ts` 记录聚焦 id，由 app 层的 `TaskViewer.tsx` 托管任务详情/编辑弹窗——app 装配层是唯一组合各 feature UI 的地方。
- 组件不直接操作 store 的原始数据，通过 `hooks.ts` 暴露的语义化动作（`completeTask`、`moveTaskToColumn`）来变更，便于在动作里统一做乐观更新与同步。

### 2.2 状态管理

- 使用 **Solid `createStore`**，每个领域一个 store 文件（`features/*/store.ts`）。
- **任务/项目/标签/时间记录**：领域 store 持有全量数据，是前端的事实来源。
- **UI 状态**（侧边栏折叠、当前路由激活态、主题、弹窗开合）放 `common/stores/`，与业务数据分离。
- 派生数据（今日任务、项目完成率、统计聚合）用 Solid 的派生计算（`createMemo`）从 store 计算，**不重复存储**，保证单一事实来源。

### 2.3 数据访问与乐观更新

统一数据流（每个写操作都遵循）：

```
用户动作
  → 1. 乐观更新本地 store（立即反映 UI）
  → 2. 异步调用 api.ts → invoke → 后端落库
  → 3. 后端返回权威结果 → reconcile 本地 store（覆盖/修正）
  → 4. 失败则回滚本地改动 + 通知用户
```

- **启动加载**：`app` 层在挂载时并发拉取任务/项目/标签等全量数据填充 store；加载态由 UI 状态管理，首屏可先用骨架屏。
- **reconcile 策略**：后端返回的实体（带 `updated_at`）作为权威值覆盖本地对应项，避免本地乐观值长期漂移。
- **冲突处理**：单用户 + 本地，冲突概率极低；以「后端最后写入为准」即可，无需复杂 CRDT。
- **错误归一化**：`common/ipc` 把后端 `AppError` 转成前端统一的 `{ code, message }`，组件层只消费这一形态。

### 2.4 路由

- 基于 **TanStack Router**（代码式路由，`src/router.tsx` 定义，入口 `src/index.tsx`）。
- 顶层布局：根路由的 `component` 为 `AppShell`（侧边栏导航 + 顶栏 + 内容区），子路由经懒加载挂载各视图：
  - `/today` 今天、`/upcoming` 即将到来、`/inbox` 收件箱、`/completed` 已完成
  - `/projects/:projectId` 项目详情（列表/看板/进度切换）
  - `/stats` 统计、`/settings` 设置、`/search` 搜索
- 视图切换仅切换路由，数据仍来自领域 store（无需按路由重取）。

### 2.5 组件与动效规范

- 无样式原语一律用 **Kobalte**（Dialog/Dropdown/Select/Tabs/Tooltip/Popover），视觉样式由 `common/components` 二次封装统一。
- 图标用 **Lucide**；日期用 **date-fns**；表单校验用 **Zod**。
- **动效只允许** CSS `transform` / `opacity`，时长 150–300ms，遵循 `prefers-reduced-motion`。看板拖拽用原生 Drag API，拖拽中仅移动 `transform`，不触发布局重排。
- 长列表用**虚拟滚动**，保证万级任务下 60fps。

---

## 3. 后端架构

### 3.1 分层与依赖方向

```
commands.rs     ← 薄 IPC 壳，参数校验 + 调用 service
   ↓
services.rs     ← 业务规则、编排、事务边界
   ↓
repositories.rs ← 唯一写 SQL 的层，映射 rows → models
   ↓
models.rs / db.rs / sort.rs ← 类型定义 / 连接与迁移 / 排序键工具

scheduler.rs    ← 后台提醒线程（R-01）：定时调用 services::scan_reminders，
                  把新触发的提醒以 `reminder:triggered` 事件广播给前端
```

**依赖规则：**

- 单向向下：`commands → services → repositories → (models, db)`；`scheduler → services`（不经 commands）。
- 禁止跨层反向依赖；`models` 是被依赖的叶子层，不含任何 SQL 或业务逻辑。
- `repositories` 用**纯函数**接受 `&Connection`（而非 trait），测试时用 in-memory SQLite + 真实迁移，比 mock 更可信。首版不引入 repository trait 抽象（YAGNI）。

### 3.2 命令设计

- Tauri 命令统一放在 `commands.rs`（按领域分 `mod` 或分组函数，随规模再拆文件）。
- 命名用 `<domain>:<action>` 前缀，前端 `invoke` 字符串与之一一对应，集中在 `src/common/ipc/commands.ts` 维护常量，避免散落魔法字符串。Rust 侧用 `#[tauri::command(rename = "task:list")]` 注册为该名称（Rust 函数名保持合法标识符如 `task_list`）；命令参数键为 camelCase（Tauri 2 默认）。

  ```
  task:list, task:create, task:update, task:complete, task:softDelete, task:restore
  subtask:list, subtask:create, subtask:update, subtask:complete, subtask:delete, subtask:reorder
  tag:list, tag:create, tag:update, tag:delete
  project:list, project:create, project:update, project:archive, project:restore
  board:listColumns, board:addColumn, board:updateColumn, board:deleteColumn, board:moveTask
  search:query
  comment:list, comment:create, comment:update, comment:delete
  time:list, time:create, time:update, time:delete, time:start, time:stop
  stats:trend, stats:projectProgress, stats:timeDistribution
  settings:get, settings:set
  backup:export, backup:import
  ```

- 每个命令返回 `Result<T, AppError>`；`AppError` 已实现 `Serialize`（F-07），跨 IPC 传递 `{ code, message }` 形态的可读错误。

### 3.3 状态与事务

- SQLite 连接由 `db::Db = Arc<Mutex<Connection>>` 作为 Tauri 托管状态共享（见 `db.rs`）；`Mutex` 串行化写，`Arc` 让后台提醒线程与命令处理器共享同一连接。
- 多步写操作（如创建任务 + 关联标签 + 写时间记录）在 `services` 层用事务包裹，保证原子性。
- 时间戳与 UUID 统一在**后端生成**（`chrono` / `uuid`），前端不生成主键，保证一致性与权威性。

### 3.4 错误处理

- 统一 `AppError`（`error.rs`），含 `Database`、`Migration`、`Db`、`Validation`、`NotFound` 变体（F-07），序列化为 `{ code, message }`，code 为 snake_case 并与前端 `common/ipc/errors.ts` 的白名单保持一致。
- 排序键相关错误（`sort::SortError`）经 `From` 转换并入 `Validation`。
- 错误向上传播，`commands` 层不做吞错；前端 `common/ipc` 负责把错误归一化为 UI 提示。

---

## 4. 数据架构

### 4.1 全局约定

- 主键：TEXT UUID v4。
- 时间戳：ISO-8601 UTC 字符串。
- 软删除：`deleted_at`（可空），查询默认过滤 `deleted_at IS NULL`。
- 排序：**字典序字符串键**（fractional indexing）。`sort_order` 是 TEXT 类型的排序键，按字典序（lexicographic）升序比较；在任意两个已有序键之间插入新项时，生成一个**介于两者之间的中间字符串**（如 `a` 与 `c` 之间取 `b`、`b` 与 `c` 之间取 `bm`），从而**无需重排已有行**即可完成插入。仅在中间字符串耗尽（两键相邻、无中间值可生成）时才对该范围内少量行重新分配键。拖拽重排即「把目标行的 `sort_order` 改写成目标间隙的中间键」。工具已落地于 `src-tauri/src/sort.rs`（F-08）：键为 `'a'..'z'` 字符串，提供 `first`/`before`/`after`/`between`/`spread`；耗尽或连续尾部追加导致键过长时，用 `spread` 对兄弟列表整体重排。

### 4.2 核心实体

```
Project 1 ──── * Task
Task    1 ──── * Subtask
Task    * ──── * Tag        （TaskTag 关联表）
Task    1 ──── * Comment
Task    1 ──── * TimeEntry
Project 1 ──── * BoardColumn
Task    * ──── 1 BoardColumn （任务所属看板列）
```

| 实体 | 关键字段 |
| --- | --- |
| **Project** | name, description, color, icon, due_at, status(active/archived), sort_order(字典序键) |
| **Task** | project_id(可空→收件箱), title, note, priority, column_id, due_at, completed_at, repeat_rule, tagIds(关联标签，随 task:list 返回), sort_order(字典序键，按所属列表/看板列内排序) |
| **Subtask** | task_id, title, done, sort_order(字典序键) |
| **Tag / TaskTag** | name, color / task_id, tag_id |
| **Comment** | task_id, body |
| **TimeEntry** | task_id, started_at, ended_at, duration(秒) |
| **BoardColumn** | project_id, name, position(字典序键), is_done(标识完成列) |
| **Settings** | key, value（JSON） |

**看板列建模**：项目默认三列「待办 / 进行中 / 已完成」由 `BoardColumn` 行表示；`Task.column_id` 指向具体列，`is_done` 标记「完成」列以驱动 `completed_at` 与进度统计。收件箱任务 `column_id` 为空。

**手动排序（字典序键）说明**：`sort_order` / `position` 采用字典序字符串键，语义是「用户手动拖拽后的位置」。它与视图级的「按优先级 / 按截止日期」即时排序正交——后者用 `createMemo` 派生计算、不落库；前者才是持久化的自定义顺序，仅在「手动排序」模式下作为默认展示顺序。中间键的生成用后端统一实现（`services`/`lib` 中的 `between(a, b)` 工具），前端只传「目标前驱/后继键」，保证算法一致。

> 完整 DDL 见 `src-tauri/migrations/V2__schema.sql`：上述实体 + 索引（`tasks` 按 project/column/due_at/completed_at、`board_columns` 按 project+position、`subtasks`/`comments`/`time_entries` 按 task_id、`time_entries` 另按 started_at、`task_tags` 按 tag_id）+ FTS5 外部内容表 `task_search(title,note)` 与 `comment_search(body)`（trigram 分词，insert/update/delete 触发器同步）。软删除行仍留在 FTS 索引，查询需按 `deleted_at IS NULL` 过滤。后续 schema 变更新增迁移、不改旧迁移。
>
> `search:query` 查询语义：全部查询词 ≥3 字符时走 FTS5——每个词以引号包裹为短语（使 FTS5 操作符字符按字面匹配）并用 AND 组合，bm25 排序，`snippet()` 返回 `<mark>` 高亮片段；任一词不足 3 字符（trigram 词元下限，常见于双字中文词）时整体回退 LIKE 扫描（`ESCAPE '\'` 转义通配符，按 updated_at 倒序）。任务命中在前、评论命中在后（两表 bm25 分值不可比）；评论命中携带父任务 id/标题供跳转定位。
>
> **提醒（R-01/R-02）**：V3 迁移增加去重标记表 `task_reminders(task_id, kind, sent_at)`（主键 `(task_id, kind)`，随任务硬删级联）。`scheduler.rs` 的后台线程每 30s 扫描一次：对未完成、未软删、有 `due_at` 的任务，在提前 1 小时 / 10 分钟 / 到期时刻各触发一次提醒；标记持久化，跨扫描与重启均不重复。停机补扫时逾期任务只补发到期提醒；截止超过 24 小时的陈年逾期不再提醒。每次触发同时做两件事：以 `reminder:triggered` 事件广播给前端（应用内 toast），并通过 `tauri-plugin-notification` 直接发送系统通知（Rust 侧直发，不经 webview，后台/托盘可达；capability 为 `notification:default`）。点击定位：插件桌面端不暴露点击回调，点击系统通知由 OS 聚焦应用窗口；前端把窗口隐藏期间触发的提醒挂起为 pending，在下一次 window `focus` 时打开任务查看器定位该任务（`features/tasks/reminders.ts`）。
>
> **重复任务（RP-01）**：`repeat_rule` 为 JSON（`{freq: daily|weekly|monthly, interval>=1, paused}`，旧数据缺 `paused` 反序列化为 false）。完成的两条路径——`task:complete` 与看板拖入 `is_done` 列——都会在同一事务内生成下一次实例：`due_at` 按规则推进一个周期（按月加法钳制到月末，如 1 月 31 日 → 2 月 28 日），继承标题/备注/优先级/项目/标签/子任务（子任务重置为未完成）与规则本身，追加回原列（看板路径回到来源列）。已逾期的提前提醒不补发；暂停规则（`paused`）与无 `due_at` 的重复任务完成时不生成；`task:update` 的 `repeatRule` patch 置 `null` 即取消规则。
>
> **时间记录（TE-01）**：记录归属任务（`task_id`），项目/标签维度的时间分布由 `time_entries → tasks → projects` / `task_tags` 关联得出（供 ST-01 使用），因此不为每条记录冗余项目/标签列。`started_at`/`ended_at` 存 UTC、`duration` 为秒：手动录入（`time:create`）由「开始时间 + 秒数」推导 `ended_at`（秒数 ≤ 0 返回 validation，任务不存在返回 not_found），`time:update` 同样以 start + duration 重新推导，故更新后必定是已停止的记录。`time:start` 幂等——任务已有运行中记录（`ended_at IS NULL`）时返回该记录而不新建；`time:stop` 以 `now − started_at` 冻结 `duration`，重复停止返回 validation。前端 `features/tasks/time.ts` 负责时长文案与 `datetime-local` 的本地时区换算，计时中的读秒只在本地信号上每秒推进、不写库。
>
> **统计（ST-01）**：`repositories::stats` 的三个只读聚合命令，全部以索引范围扫描打底——`tasks.completed_at`（趋势）与 `time_entries.started_at`（时间分布）——且查询计划由单测断言（必须是 `SEARCH … USING INDEX`，全表 SCAN 即失败）。范围是半开区间 `[from, to)`，边界由前端按用户时区算成 UTC 瞬间；`offsetMinutes`（`-new Date().getTimezoneOffset()`，缺省 0 即 UTC）作为 SQLite 日期修饰符参与分桶，使「日/周/月」是用户日历上的日/周/月（周桶键取该周周一，如 `2026-09-07`），无数据的桶不补零（由前端补齐坐标轴）。时间戳一律以 `DateTime` 参数绑定（与写入路径同一编码），不写字符串字面量：rusqlite 存的是 `YYYY-MM-DD HH:MM:SS.SSS+00:00`，字面量的时区后缀（`Z` vs `+00:00`）会让边界比较错位。`stats:projectProgress` 只统计 `deleted_at IS NULL AND status = 'active'` 的项目（归档项目不在当前视野，恢复后回归），返回 `total`/`completed`/`due_at`，完成率与剩余量由前端派生；`stats:timeDistribution` 的 `groupBy` 取 project/tag——按项目分组时，未归属项目的收件箱时间形成 id 为空的份额；按标签分组时，多标签任务的时间计入它的每个标签（因此各分组之和可能大于总时长），`buckets` 是同一批时间按 `granularity` 的序列。
>
> **统计视图（ST-02）**：`/stats` 的图表全部自绘 SVG（不引图表库，守体积红线）：`LineChart` 折线（y 轴取 1/2/5×10ⁿ 整数刻度）、`CalendarHeatmap` 周列网格（周一为首、按范围内峰值分 4 档着色；按固有尺寸渲染并横向滚动，避免「单列的一周」被拉伸成大色块）、`BarList` 横向对比条（填充用 `transform: scaleX`，不animate宽度）。交互只用 CSS：每个数据点/格子带 `<title>` 提示 + hover 透明度，无 JS 悬浮层，范围切换不引发布局抖动。`series.ts` 负责前后端契约的前端一半——把「近 7 天/30 天/本年」换算成本地日起止的 UTC 半开区间与 `offsetMinutes`（本年为周桶）、按 `bucketKeys` 生成坐标轴、用 `fillSeries` 把后端省略的空桶补零；`useStats` 以请求序号丢弃过期响应，快速切换范围时旧数据留在屏上、不会闪空白或画出过期窗口。时间分布可切「按项目/按标签」，复用同一个命令。
>
> **项目进度（ST-03）**：项目详情页头部内嵌 `ProjectProgress`（列表/看板两个 tab 共用）：总进度条、完成率、剩余任务数、距截止剩余时间。四个数值全部由传入的**实时任务切片**（`tasksState` 中属于该项目的任务）派生，而不是查 `stats:projectProgress`——勾选或拖拽完成在同一 tick 就推动进度条，无 IPC 往返与刷新窗口；`stats:projectProgress` 只服务跨项目对比（ST-02 的对比图）。截止倒计时按本地日历判断：同日读作「今天截止」（项目截止由 `localDateValueToIso` 存为本地日末 23:59:59），逾期显示「已逾期 N 天」并转 danger 色，未来显示「距截止还有 N 天」；倒计时在渲染时读取，不额外起定时器。
>
> **系统托盘（D-01）**：`tray.rs` 用 Tauri 核心 Tray API 建托盘（`tauri` crate 必须开启 `tray-icon` feature，否则 `tauri::tray` 不存在）：左键单击切换主窗口显示/隐藏，菜单为「显示主窗口 / 隐藏主窗口 / 退出 Ordo」（左键不弹菜单，`show_menu_on_left_click(false)`）。窗口关闭由 `lib.rs` 的 `on_window_event` 拦截 `CloseRequested`（`api.prevent_close()` + `hide()`），因此「关闭」= 驻留托盘，只有菜单「退出」调 `app.exit(0)` 才真正结束进程。托盘图标复用打包图标（`default_window_icon()`，缺失时不设置以免托盘不可见）。提醒不受影响：`scheduler.rs` 是独立线程、直接经 `tauri-plugin-notification` 发系统通知，不依赖可见的 webview；R-02 的「隐藏期间挂起、下次窗口 focus 时定位任务」在托盘唤起时依然成立（`show_main` 会 `set_focus()`）。`tray.rs` 的窗口 label 常量必须与 `tauri.conf.json` 的窗口一致（未声明 label 时 Tauri 默认 `main`，capabilities 也按该名字授权），label 不匹配会让托盘动作静默失效。Linux 下托盘依赖 appindicator 运行时（三端验证见 Q-03）。

---

## 5. 关键技术决策（ADR 摘要）

| # | 决策 | 理由 | 备选（否决原因） |
| --- | --- | --- | --- |
| 1 | 前端内存 store + 乐观更新 | 交互 <50ms、无 IPC 往返卡顿，契合「丝滑」目标 | 按需实时 IPC：简单但每次交互有延迟，统计/搜索体验差 |
| 2 | Feature-based 目录组织 | 领域边界清晰，随功能增长可维护 | Layer-based：跨领域同层随规模膨胀 |
| 3 | repositories 用纯函数而非 trait | 简单够用，in-memory SQLite 测试比 mock 可靠 | trait + mock：首版引入过早（YAGNI） |
| 4 | 看板列存 `BoardColumn` 表 | 支持自定义列，进度统计有明确「完成列」锚点 | 固定 status 字符串：无法支持自定义列（P0 需求） |
| 5 | 动效仅 CSS transform/opacity，不引动画库 | 体积小、GPU 友好、可控 | 动画库：增加体积，违背 NFR |
| 6 | 主键/时间戳后端生成 | 权威一致，便于未来同步 | 前端生成：多端/同步时易冲突 |
| 7 | 排序用字典序字符串键（fractional indexing） | 任意位置插入无需重排已有行，拖拽持久化成本 O(1) | 连续整数：中间插入需重排一批行，成本高 |

**排序算法选型（行业调研结论）**：业界主流方案收敛为两种——**fractional indexing**（Figma 采用：任意精度分数 + 字符串平均取中间值；Replicache 的 `fractional-indexing` 库用 base62 变长整数）与 **LexoRank**（Jira/Atlassian 采用：带 bucket 的分段 rank，为多用户并发写与 rank 过长时重平衡设计）。**取舍：采用 fractional indexing，否决 LexoRank**——LexoRank 的 bucket/重平衡机制服务于多用户并发编辑与长 rank 治理，对 Ordo 的单用户、本地、离线场景是过度设计；fractional indexing 更简单、单次插入只改一行、无 bucket 状态。实现以 Replicache 的 `fractional-indexing` 语义为参考（`keyBetween(a,b)` 生成中间键、`keyBetween(null,null)` 生成首键、键耗尽时局部重排），Rust 后端自研 ~50 行工具函数，不引入额外依赖。

---

## 6. 非功能需求达成方案

| 目标 | 手段 |
| --- | --- |
| **UI 现代** | Tailwind `@theme` 统一 Token；Kobalte 自建组件避免「模板感」；深浅主题 |
| **运行流畅（60fps）** | 内存 store 免 IPC 往返；长列表虚拟滚动；派生数据用 `createMemo` |
| **动效丝滑** | 仅 `transform`/`opacity`；150–300ms 自然缓动；`prefers-reduced-motion` 适配 |
| **体积小（<30MB）** | Tauri release 优化（LTO/strip/panic=abort）；路由懒加载按需打包；不引重型库 |
| **响应快** | 冷启动 <1.5s（全量加载在预算内）；命令往返 <50ms；统计走 FTS5/聚合索引秒级返回 |

---

## 7. 目录结构总览（实现后）

```
ordo/
├── docs/                    # PRD.md、ARCHITECTURE.md
├── src/                     # 前端（SolidJS）
├── src-tauri/               # 后端（Rust）
│   ├── migrations/          # refinery SQL 迁移
│   └── src/                 # commands/services/repositories/models/db/error
├── vite.config.ts / vitest.config.ts / package.json
└── AGENTS.md                # 工程约定与文档索引
```

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
├── index.css                     # Tailwind 入口 + @theme 设计 Token + 全局工具类（focus-ring / skeleton / 浮层入场动画）
├── app/                          # 应用装配层
│   ├── AppShell.tsx              # 布局壳：侧边栏 + 内容区（仅主窗口；页面标题由各视图自己渲染）
│   ├── QuickAddWindow.tsx        # quick-add 小窗的全部内容（仅该窗口渲染，见 D-02）
│   └── TaskViewer.tsx            # 全局任务详情/编辑弹窗（搜索命中等入口的跳转落点）
├── features/                     # 业务领域（按功能划分）
│   ├── tasks/                    # 任务
│   │   ├── components/           # TaskItemRow / SubtaskRow / TaskListView / 编辑器 / 看板卡 / BlockedConfirmHost
│   │   ├── store.ts              # 任务内存 Store（Solid createStore）
│   │   ├── api.ts                # 类型化 IPC 调用
│   │   ├── hooks.ts              # 领域 hooks（创建/完成/拖拽/依赖写入）
│   │   ├── dependencies.ts       # 依赖图派生（纯函数：索引、完成集、阻塞与环检测）
│   │   ├── blocked-confirm.ts    # 待确认的「前置未完成」请求（软阻塞的落点）
│   │   ├── complexity.ts         # 复杂度词表（1–5，可空 = 未评估）
│   │   ├── priority.ts           # 优先级标签的唯一出处（编辑器/快捷窗/标记共用）
│   │   ├── quick-add-parse.ts    # 快捷输入语法解析（@项目 / !优先级 / #日期）
│   │   └── types.ts              # 任务领域类型（与后端 serde 对齐）
│   ├── projects/                 # 项目
│   ├── board/                    # 看板（列 + 拖拽）
│   ├── stats/                    # 统计展示
│   ├── search/                   # 全文搜索
│   ├── tags/                     # 标签
│   └── settings/                 # 设置（主题/自启/快捷键）
├── common/                       # 跨领域共享
│   ├── colors.ts                 # 预设色板（项目与命名空间共用；null = 无颜色）
│   ├── icons.ts                  # 图标表（项目与命名空间共用，按名字解析成 lucide 组件）
│   ├── optimistic.ts             # 乐观写入的共用件（临时 id / 失败通知 / optimistic 包装，各 feature hooks 共用）
│   ├── components/               # 通用 UI（Button/Dialog/Dropdown/Skeleton/EmptyState…基于 Kobalte）
│   │   └── palette-picker.tsx    # 色板与图标选择器（项目/命名空间编辑器共用）
│   ├── ipc/                      # invoke 封装、命令常量、错误归一化
│   ├── stores/                   # 全局 Store（主题、UI 状态、通知）
│   └── utils/                    # 工具（日期/格式化）
└── assets/                       # 图标等静态资源（logo.svg 同时作为 favicon）
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
- **阻塞状态同样是派生量**：依赖边随任务列表一次载入（`dependency:listAll`），列表行的阻塞标记由 `TaskListView` 的 `rows` memo 每轮渲染一次算出——同一轮构建一次存活集合、索引与完成集合（`dependencies.ts` 的 `liveSet` / `buildIndex` / `completionSet`），把任务行的「还差几项」与展开后每个子任务行的阻塞与否一并传给 `TaskItemRow` / `SubtaskRow` 渲染，行组件自己不再查图（详情页的依赖区、子任务属性面板、详情弹窗的阻塞徽标各自持有一份自己的 memo）——单次查询的代价是该行的前置数量，而不是整张图的规模。**索引按存活集合建，不按原始边表建**：软删除是乐观的（行立刻离开 store，边要等下次 `dependency:listAll` 才消失），所以 `buildIndex(dependencies, live)` 丢掉任一端不在 store 里的边——删掉前置立即解锁，恢复前置依赖自动回来，都不需要补偿写入；行上的标记还要看自身是否已完成，已完成的任务/子任务不再挂「阻塞中」。阻塞是**软**的：`completeTask` / `completeSubtask` 只在「完成」时检查未完成前置，命中就**先不写库**，把请求停到 `blocked-confirm.ts`，由 `AppShell` 挂载的唯一 `BlockedConfirmHost` 弹一次确认（取消即丢弃）。**检查收敛在一个门（`hooks.ts` 的 `parkIfBlocked`）上，完成入口有四个**：任务行、详情弹窗、子任务行走 `completeTask` / `completeSubtask`；把卡片拖进 `is_done` 列同样是完成（后端在那里打 `completed_at` 并生成重复实例），所以 `board/hooks.ts` 的 `moveTaskToColumn` 在动手之前先过同一道门。请求自带「确认后要执行的动作」（`BlockedRequest.run`：任务/子任务完成，或整次拖拽移动），宿主只调 `run()`、不按 `kind` 分支，写入失败时保留对话框与前置清单；取消完成永不检查。

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
- **子任务随启动全量载入**：`loadAll` 一次取回全部存活子任务（`subtask:listAll`），`setSubtasksAll` 按 `task_id` 分组重建 `subtasksByTask`，并为每个存活任务建好条目（无子任务则为空数组）。列表要在折叠状态下就显示「谁有子任务、做完几项」，逐行懒加载会变成 N 次 IPC。
- **批量载入只发生在启动**：会话中途的刷新走 `reloadTasks`（只重拉任务与标签），刻意不带子任务快照。`setSubtasksAll` 是盲重建（每个覆盖到的任务整数组替换），带着快照重跑会覆盖用户刚在详情弹窗里写入的子任务；而中途刷新的唯一来源——快捷添加窗——只会创建没有子任务的任务，它的行本来就不该有进度徽章，详情弹窗按 `hasSubtasks` 兜底拉一次即可。
- `subtask:list`（按任务）保留，作为兜底：新建且带初始子任务的任务，其子任务是后端插入的、id 不在创建响应里，所以 `createTask` 成功后会补拉一次（见 Task 3）；缓存里确实没有条目的任务，详情弹窗也仍会按需拉一次。`hasSubtasks` 就是判断这个的。
- 查询排除父任务已软删除的子任务——`soft_delete_task` 不级联，不排除的话每次载入都会带回一截随时间增长的死数据。
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
- **动效只允许** CSS `transform` / `opacity` / 独立的 `scale`、`translate` 属性，时长 150–300ms，遵循 `prefers-reduced-motion`。看板拖拽用原生 Drag API，拖拽中仅移动 `transform`，不触发布局重排。
- **浮层只做入场动画，不做退场动画**。Kobalte 的 presence 会等动画结束才卸载元素，一个没触发的退场动画会留下一层看不见但吃掉所有点击的遮罩。入场动画必须写在 `scale` / `translate` 长属性上而非 `transform`：Kobalte 用 `transform: translate(...)` 定位浮层，动画里写 `transform` 会在结束时把浮层弹回原点。
- **`prefers-reduced-motion` 由 `index.css` 的全局 `@media` 规则统一兜底**，组件里不再逐处写 `motion-reduce:transition-none`（写了也是冗余）。
- 长列表用**虚拟滚动**，保证万级任务下 60fps。
- **焦点指示只用 `focus-ring` 这一个工具类**（`index.css` 里定义为 `:focus-visible` 上的 2px `outline`）。用 `outline` 而不是 `ring`：outline 跟随元素自身的圆角，且不需要 `ring-offset`——offset 会用页面背景色补一圈，一旦元素不在 `bg-background` 上（侧边栏、卡片、菜单里）就会显出一圈错色。
- **回车提交必须带 `!event.isComposing` 守卫**（`QuickAddWindow`、`SubtaskList`、`CommentList`、`TimeTracker`）。这是中文产品：输入法组词时按回车是「上屏」而不是「提交」，少了这个守卫会把半截标题写进库，或把正在编辑的内容提前提交。浏览器自带的表单隐式提交本身就不会在组词中触发，但各处都是显式 `onKeyDown` 处理回车，所以守卫得自己写。

### 2.6 视觉规范（Token 层）

- **一套灰**：所有中性色都在 hue 265、chroma ≤ 0.012 上取值。把暖色背景和冷色前景混在一起，是最快让界面看起来像两套设计系统拼起来的方式。
- **一个强调色**：`--primary` 是低饱和的深青（hue ~197）。它必须离所有语义色都足够远（success 155、warning ~65、danger 25），否则强调面会被读成状态。强调色会被涂在复选框、进度条、焦点环上，所以饱和度压得很低——静止时应该往后退。
- **平面分层**：`--sunken`（看板列这类「凹槽」）/ `--background`（页面）/ `--surface`（侧边栏、面板）/ `--elevated`（弹窗、菜单、看板卡片）四层。深色模式下 `--sunken` 比 `--background` 更深，浅色模式下更浅，两边都是「往里凹」的观感。
- **阴影带色**：用中性色 hue 染过的半透明色，而不是纯黑低透明度，这样阴影和它落下的面处在同一光照里；深色模式的抬升主要靠 `inset` 顶部高光，因为黑压黑没有可压的余量。
- **`--*-solid` / `--*-foreground` 成对**：成对的是填充按钮的前景/背景；单独的那个 token 是当作**文字**用的，按在页面背景上的对比度调过。不要拿 `--danger` 当按钮底色再配白字。
- **优先级没有自己的 token**：高/中直接复用 `danger`/`warning`（原来的 `--priority-*` 存的是完全相同的值），低用中性灰。优先级走 `Badge` 的 `variant`，不靠调用方传 `class` 覆盖颜色。
- **不要用 `class` 去覆盖原语里已有的同类工具类**。Tailwind 按 CSS 源码顺序（而非 class 属性顺序）解决同属性冲突，例如 `.text-muted-foreground` 排在 `.text-danger` 之后、`.bg-surface-hover` 排在 `.bg-danger/12` 之后、`.w-full` 排在 `.w-28` 之后——这些覆盖会静默失效并渲染出错误的颜色或宽度。需要不同外观时，给原语加一个 `variant`（或先把原语里冗余的基础类删掉，比如 `Select.Trigger` 上那个多余的 `w-full`）。
- **圆角规则**：`sm`(6) 徽章/复选框/行内标记；`md`(8) 按钮/输入框/列表行；`lg`(12) 面板/看板列/浮层；`xl`(16) 整块弹窗。
- **字号按桌面密度定**：正文 13px（`text-sm`）、次要信息 12px（`text-xs`）、徽章 11px（`text-2xs`）、页面标题 17px（`text-lg`）。数字全局 `font-variant-numeric: tabular-nums`——这个应用里的数字（日期、计数、时长、百分比）几乎都是按列读的，等比数字在这里从来不是对的默认值。
- 深色/浅色主题都可切换、可跟随系统；组件只引用 Token，不写死色值。

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
  subtask:list, subtask:listAll, subtask:create, subtask:update, subtask:complete, subtask:delete, subtask:reorder
  dependency:listAll, dependency:add, dependency:remove
  tag:list, tag:create, tag:update, tag:delete
  project:list, project:create, project:update, project:archive, project:restore
  namespace:list, namespace:create, namespace:update, namespace:archive, namespace:restore
  board:listColumns, board:addColumn, board:updateColumn, board:deleteColumn, board:moveTask
  search:query
  comment:list, comment:create, comment:update, comment:delete
  time:list, time:create, time:update, time:delete, time:start, time:stop
  stats:trend, stats:projectProgress, stats:timeDistribution
  settings:get, settings:set
  backup:export, backup:import
  ```

- 每个命令返回 `Result<T, AppError>`；`AppError` 已实现 `Serialize`（F-07），跨 IPC 传递 `{ code, message }` 形态的可读错误。
- 依赖命令的载荷就是整条边 `{kind, dependentId, prerequisiteId}`（`kind` 取 `task` / `subtask`，字段 camelCase）：`dependency:listAll` 返回全部存活边（含 `kind`，无参数）；`dependency:add` 校验后写入并返回该边——重复添加同一条边是幂等的，返回同一条；`dependency:remove` 删除并返回空——删除不存在的边不报错。被依赖/阻塞状态不在后端计算，前端从 `listAll` 的边集派生。

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
Namespace 1 ──── * Project
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
| **Namespace** | name, description, color, icon, status(active/archived), sort_order(字典序键)；项目经可空外键 `projects.namespace_id` 归属至多一个命名空间 |
| **Project** | name, description, color, icon, due_at, status(active/archived), sort_order(字典序键) |
| **Task** | project_id(可空→收件箱), title, note, priority, column_id, due_at, completed_at, repeat_rule, complexity(1–5，可空), tagIds(关联标签，随 task:list 返回), sort_order(字典序键，按所属列表/看板列内排序) |
| **Subtask** | task_id, title, done, note, priority, due_at, complexity(1–5，可空), sort_order(字典序键) |
| **TaskDependency / SubtaskDependency** | task_id, depends_on / subtask_id, depends_on（纯连接表，方向为「依赖方 → 前置」） |
| **SubtaskReminder** | subtask_id, kind(advance_1h/advance_10m/due), sent_at |
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
> **提醒（R-01/R-02）**：V3 迁移增加去重标记表 `task_reminders(task_id, kind, sent_at)`（主键 `(task_id, kind)`，随任务硬删级联）。`scheduler.rs` 的后台线程每 30s 扫描一次：对未完成、未软删、有 `due_at` 的任务，在提前 1 小时 / 10 分钟 / 到期时刻各触发一次提醒；标记持久化，跨扫描与重启均不重复。停机补扫时逾期任务只补发到期提醒；截止超过 24 小时的陈年逾期不再提醒。子任务按同一套节奏单独提醒：`task_reminders` 与 `subtask_reminders` 是两张同构的去重标记表（子任务不能复用前者：它按 `(task_id, kind)` 立键，`task_id NOT NULL REFERENCES tasks(id)`，子任务提醒的外键目标与键形状都不同），候选要求子任务未软删、未完成且 `due_at` 在扫描窗口内，并且其父任务存活且未完成——父任务一旦完成或软删，其子任务一并静默。提前量判定由纯函数 `due_kinds(now, due_at)` 给出，两轮候选（任务、子任务）共用同一份语义；系统通知的标题始终是「Ordo 任务提醒」，子任务提醒把主题「父任务 › 子任务」放在**正文**里（应用内 toast 同样如此），事件里 `taskId` 始终是父任务，因此前端点击定位逻辑无需特殊分支。每次触发同时做两件事：以 `reminder:triggered` 事件广播给前端（应用内 toast），并通过 `tauri-plugin-notification` 直接发送系统通知（Rust 侧直发，不经 webview，后台/托盘可达；capability 为 `notification:default`）。点击定位：插件桌面端不暴露点击回调，点击系统通知由 OS 聚焦应用窗口；前端把窗口隐藏期间触发的提醒挂起为 pending，在下一次 window `focus` 时打开任务查看器定位该任务（`features/tasks/reminders.ts`）。
>
> **重复任务（RP-01）**：`repeat_rule` 为 JSON（`{freq: daily|weekly|monthly, interval>=1, paused}`，旧数据缺 `paused` 反序列化为 false）。完成的两条路径——`task:complete` 与看板拖入 `is_done` 列——都会在同一事务内生成下一次实例：`due_at` 按规则推进一个周期（按月加法钳制到月末，如 1 月 31 日 → 2 月 28 日），继承标题/备注/优先级/项目/标签/子任务与规则本身，追加回原列（看板路径回到来源列）——子任务照抄描述/优先级/复杂度并重置为未完成，其 `due_at` 随父任务推进同一周期；依赖边不继承（它们指向上一实例的行）。已逾期的提前提醒不补发；暂停规则（`paused`）与无 `due_at` 的重复任务完成时不生成；`task:update` 的 `repeatRule` patch 置 `null` 即取消规则。
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
>
> **数据备份（D-03）**：`backup:export` 把整库写成一个 JSON 文档（`{format:"ordo.backup", version:3, exportedAt, data:{projects, namespaces, boardColumns, tags, tasks, subtasks, taskTags, comments, timeEntries, dependencies, settings}}`，字段复用既有模型与 camelCase 约定），`backup:import` 读取同一文档并**整体替换**全部用户数据表：先删子表再删父表、先插父表再插子表（外键全程成立），整个过程在一个事务内，因此外来/更高版本/解析失败的文件不会改动任何数据（分别返回 validation）。与其他查询不同，`repositories::backup` 故意不过滤 `deleted_at`——备份是数据库的副本而非视图，软删除行随备份往返；`task_reminders` 与 `subtask_reminders` 不入备份（只用于提醒去重，会由迁移与调度器自然重建）。FTS 索引由既有触发器跟随导入的插入/删除同步，无需 rebuild（有测试断言恢复后可搜到）。`io` 是 AppError 的新错误码（文件读写失败），前端 `common/ipc/errors.ts` 白名单同步。文件由前端用 `tauri-plugin-dialog` 的保存/打开对话框选路径（capability `dialog:default`），Rust 只按给定路径读写，前端不接触字节；恢复前必须经确认弹窗，成功后重载 tasks/projects 两个 store，无需重启即可看到恢复后的数据。
>
> 备份版本 3 起携带 `namespaces`：文档里它是 `projects` 的父表（导入时先插），v1/v2 文件缺该键即空列表、其项目全部落在根级——这正是它们导出时的样子。

> **属性与依赖（V4）**：`tasks.complexity` 与 `subtasks.{note, priority, due_at, complexity}` 补齐此前缺失的属性；`priority` 沿用任务那套 `high/medium/low/none`（DB 默认 `none`），两处 `complexity` 都是 1–5 的可空整数（`NULL` = 未评估，由 CHECK 约束守住上下界）。依赖用两张纯连接表表示——`task_dependencies(task_id, depends_on, created_at)` 与 `subtask_dependencies(subtask_id, depends_on, created_at)`：复合主键 `(依赖方, 前置)` 即天然去重，`CHECK` 拒绝自环，两个外键都随任一端硬删级联；沿用 `task_tags` 的纯连接表写法（无 UUID/审计列），但额外带 `created_at`。**边的方向是「依赖方 → 前置」**：`(dependent, depends_on)` 读作「dependent 等待 depends_on」，因此「谁在等我」查 `depends_on` 一侧，两张表都为此侧的列建了索引（反向查询与环检测都走这条路径；正向前缀查询由主键覆盖）。`subtask_reminders(subtask_id, kind, sent_at)` 是 V3 `task_reminders` 的子任务版：V3 那张表不能复用，因为它按 `(task_id, kind)` 立键且 `task_id NOT NULL REFERENCES tasks(id)`——子任务提醒的外键要指向 `subtasks(id)`，键形状也随之不同。
>
> **依赖的写入校验（`dependency:add`，四条）**：两端都必须存在且未被软删，否则 `not_found`；子任务边两端必须同属一个父任务，否则 `validation`（子任务不能在任务之间建立前置关系，任务级依赖则可跨项目）；不允许自环；不允许成环。环检测是一条递归 CTE：**从「前置」出发**沿 `depends_on` 逐跳向上找它自己的前置，若走到「依赖方」就说明新边会闭合环路。环检测读的是原始边表、不带存活谓词，端点已被软删的休眠边照样参与——经 `dependency:add` 写入的边因此不可能成环，恢复端点时关系回来也不会带进一个环（导入路径不重跑这四条校验，表里若已有环就靠下面那条 `UNION` 兜底）。递归项用 `UNION` 而非 `UNION ALL`——同一节点只展开一次，因此即便表里已经存在环也能收敛（写入路径的检查让环进不来，这是兜底）。校验在服务层（`validate_dependency`）而不是靠数据库约束：`CHECK (x <> depends_on)` 只挡得住自环，跨行约束 SQLite 无法表达。
>
> **软删除不删边**：端点被软删时边仍然留在表里，只是从 `dependency:listAll` 的存活谓词下消失（任务边要求两端 `deleted_at IS NULL`；子任务边额外要求父任务存活），于是「软删前置 ⇒ 被阻塞方自动解锁，恢复前置 ⇒ 依赖自动回来」，不需要任何补偿写入，也不存在恢复时重建关系的窗口。任务边与子任务边互不影响：两张表分别查询、按 `kind` 区分，子任务边不会泄漏进任务图。注意 `depends_on` 一侧的索引是这条语义的性能支撑（反向查询「谁在等我」与环检测都走它）。
>
> **依赖与 `sort_order` 正交**：`sort_order` 是**显示顺序**（用户拖拽出来的位置），依赖是**可执行顺序**（完成的前置约束），两者互不写入对方——拖拽重排不改依赖边，添加依赖也不动任何 `sort_order`。完成动作在后端不被依赖阻止（软阻塞）：被阻塞项照常可以完成，服务层不做拦截，「还差几项 / 确认一次」由前端从边集派生并提示。
>
> **全局快捷键快速添加（D-02）**：`shortcut.rs` 用 `tauri-plugin-global-shortcut` 注册**一个**应用级快捷键（macOS `⌘⇧Space`、其他平台 `Ctrl+Shift+Space`）：按下时不再唤起主窗口，而是显示 `quick-add`——一个 560×150、无边框、置顶、不进任务栏的独立窗口，内容是一行输入 + 一行控件（项目 / 优先级 / 截止日期）+ 一行预览（`WebviewUrl::App("index.html")`，与主窗口同一个页面；前端 `index.tsx` 按窗口 label 分流：`quick-add` 渲染 `app/QuickAddWindow.tsx`，其余走 RouterProvider，浏览器 dev server 读不到 label 时回落主应用）。窗口在 setup 阶段建好并长期隐藏，所以按下即出、没有 webview 冷启动；`shortcut.rs` 在 show + set_focus 之后向该窗口 `emit_to` 一个 `quick-add:open` 事件——`autofocus` 只在页面加载时生效，而这个页面是在窗口还隐藏时加载的，因此聚焦必须由事件驱动，该事件同时把输入行与三个控件复位（每次唤起都从干净状态开始）并重拉一次项目列表（快捷窗有自己的 store，主窗口里新建或归档的项目它看不到）。回车提交后调 `getCurrentWindow().hide()` 把窗口收回（录入即隐），Esc 同样只隐藏；点击别处则由 `lib.rs` 的 `on_window_event` 捕获 `Focused(false)` 隐藏（无边框窗口没有关闭按钮可点）。两个窗口各有自己的 store，所以快捷窗创建成功后 `emit("task:created")`，主窗口 `AppShell` 监听后用 `reloadTasks()` 重新拉取任务与标签（不带子任务快照——它是盲重建，会覆盖用户刚写入的子任务，见 2.3 数据访问与乐观更新），否则主窗口会一直显示旧列表。
>
> **快捷输入语法（D-02）**：`features/tasks/quick-add-parse.ts` 是纯函数，把一行文字解析成 `{title, projectId, priority, dueAt}`。三个标记**都是显式的**：`@项目`、`!高/!中/!低`、`#日期`（认全角 `＠`/`！`/`＃`），标记从标题里剥离后提交。`#` 后面接中文日期短语（今天/明天/后天、周X/下周X/星期X、N天后/N周后、月边界 月底/月初/月中 与 3月底、年边界 年底/今年底/明年底/2028年底、周末/下周末）或数字写法（`#9/30`、`#9-30`、`#2026-09-30`、`#2026/9/30`），都可带 上午/下午/晚上 + N点(半)。**日期必须带 `#`**：裸的「明天」「月底」现在只是标题里的普通文字，这样「月底前完成报表」不会再被静默改写成「前完成报表」——这是把日期也做成显式标记换来的，代价是每次都得多敲一个 `#`。多个 `#` 从左往右逐个尝试，第一个能解析成日期的生效（`issue #123` 这种读不出来的留在标题里，且不会挡住后面的 `#明天`）。两条贯穿始终的原则是**不猜**和**只删看得懂的**：歧义（`@W` 同时匹配 Work 与 Writing）、匹配不上（`@张三`）、不存在的日期（`2月31日`、`13/1`、`13月底`）一律原样留在标题里；项目名的匹配取「token 的最长项目名前缀」（`@Work#明天` 不需要空格也能断开），这样中文标题里拉丁项目名可以直接接汉字。只给日期不给时刻时按当天 23:59:59 处理，复用项目截止日期那套 `localDateValueToIso` 约定。控件与标记冲突时**控件优先**（用户最后一次显式点击意图最明确），预览行显示的始终是最终结果。优先级标签只有 `features/tasks/priority.ts` 一处定义，编辑器下拉、快捷窗控件、`!高` 标记共用，避免两处标签漂移。注意 Kobalte 的 Select 会在挂载时用一个初始值调一次 `onChange`，所以三个控件的 onChange 都加了「与当前生效值相同就忽略」的判断，否则光打开窗口就会记下「收件箱」并把输入行里的 `@项目` 压掉。
>
> **月/年/周边界的时间词**（月底、周末、年底这一族）共用一条**周期词**规则：`下下/下个/下` 表示往后 1~2 个周期，`本/这/这个` 与「光秃秃」的形式表示当前周期，但只有**带前缀**的才照字面——不带前缀且已经过去时自动顺延（9月25日说 `#月初` = 10月1日；说 `#本月初` = 9月1日，哪怕已经过去，预览行会显示成逾期）。`底/中/初` 的具体日子由周期决定：月是「该月最后一天 / 15 号 / 1 号」（最后一天用 `new Date(y, m+1, 0)` 取，所以闰年 2 月自然答 29），年是「12月31日 / 7月1日 / 1月1日」。`#周末` 取**周日**——「周末前搞定」读作整个周末结束。写死月份（`#3月底`）且该月已过时顺延到明年，与 `#9月1日` 的既有规则一致。正则上有三处顺序/写法是**故意的**：数字写法（`9/30`）排在最前且最具体；`md`（`9月30日`）必须排在月边界之前，否则同一个「9月」会先被当成 `月底` 而失败；`今年` 本身以「年」结尾，所以年边界写成 `今年|明年|本年` 与裸 `年` 三选一，而不是「可选前缀 + 年」。日期正则锚定在 `^`，因为日期只在紧跟 `#` 时才算数。
>
> 注册在 Rust 侧而非 webview：窗口藏在托盘、最小化或从未聚焦时都能触发，且不经过 IPC——因此**不需要** `global-shortcut:*` capability（但快捷窗要隐藏自己、要调 `task:create`，capabilities 的 `windows` 必须同时列出 `main` 与 `quick-add`，并保留 `core:window:allow-hide`；这些名字由 tauri-build 在编译期校验，写错会构建失败）。`Shortcut` 的相等比较包含自增 id，所以 handler 必须与注册时**同一个实例**比较：`quick_add_shortcut()` 用 `OnceLock` 记忆化。快捷键被其他应用占用时只记日志、不影响启动。
>
> **开机自启（D-04）**：`tauri-plugin-autostart` 在 `lib.rs` 注册（`Builder::new().build()`，默认用 LaunchAgent 写 macOS 登录项；Windows 写 HKCU Run 注册表、Linux 写 XDG autostart），API 由**前端**经 `@tauri-apps/plugin-autostart` 绑定调用，因此需要 capability `autostart:default`（含 `allow-enable`/`allow-disable`/`allow-is-enabled`）。设置页「启动」面板的 `开机自启` 开关是 OS 登录项列表的**视图**而不是我们存的值：挂载时读 `isEnabled()`，写入后再回读一次，只有回读成功才更新开关——失败的写（如无权限）走统一错误通知并让开关停在原处，界面不会声称一个 OS 并未接受的状态。**默认关闭**由「代码里没有任何地方主动 enable」保证：登录项列表为空即 off，无需在 `settings` 表里再存一份开关状态（避免与 OS 真实状态分叉）。已知取舍：自启拉起的是正常可见的主窗口（未注册 `--hidden` 启动参数）；若日后要静默入托盘，再在 setup 阶段解析 argv 并隐藏窗口。
>
> **归属校验（`project:create` / `project:update`）**：非空 `namespaceId` 必须解析到一个未软删的命名空间，否则返回 `not_found`；`null` 即不归属，永远允许。校验在服务层（`validate_namespace_ref`），可空外键只是兜底——它挡得住不存在的 id，但说不清「已软删」与「不存在」的差别。

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

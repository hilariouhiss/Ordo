# Ordo 应用架构设计

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.0 |
| 更新日期 | 2026-09-08 |
| 状态 | 草案（待评审） |
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
│   └── AppShell.tsx              # 布局壳：侧边栏 + 顶栏 + 内容区
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
- `features` 之间不互相 import 内部实现，共享逻辑下沉到 `common/`。
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
commands.rs   ← 薄 IPC 壳，参数校验 + 调用 service
   ↓
services.rs   ← 业务规则、编排、事务边界
   ↓
repositories.rs ← 唯一写 SQL 的层，映射 rows → models
   ↓
models.rs / db.rs ← 类型定义 / 连接与迁移
```

**依赖规则：**

- 单向向下：`commands → services → repositories → (models, db)`。
- 禁止跨层反向依赖；`models` 是被依赖的叶子层，不含任何 SQL 或业务逻辑。
- `repositories` 用**纯函数**接受 `&Connection`（而非 trait），测试时用 in-memory SQLite + 真实迁移，比 mock 更可信。首版不引入 repository trait 抽象（YAGNI）。

### 3.2 命令设计

- Tauri 命令统一放在 `commands.rs`（按领域分 `mod` 或分组函数，随规模再拆文件）。
- 命名用 `<domain>:<action>` 前缀，前端 `invoke` 字符串与之一一对应，集中在 `common/ipc` 维护常量，避免散落魔法字符串。

  ```
  task:list, task:create, task:update, task:complete, task:softDelete, task:restore
  project:list, project:create, project:update, project:archive
  tag:list, tag:create, tag:update, tag:delete
  board:listColumns, board:moveTask, board:addColumn
  stats:trend, stats:projectProgress, stats:timeDistribution
  settings:get, settings:set
  ```

- 每个命令返回 `Result<T, AppError>`，`AppError` 实现 `Serialize` 以跨 IPC 传递可读错误。

### 3.3 状态与事务

- SQLite 连接由 `db::Db = Mutex<Connection>` 作为 Tauri 托管状态共享（见 `db.rs`）。
- 多步写操作（如创建任务 + 关联标签 + 写时间记录）在 `services` 层用事务包裹，保证原子性。
- 时间戳与 UUID 统一在**后端生成**（`chrono` / `uuid`），前端不生成主键，保证一致性与权威性。

### 3.4 错误处理

- 统一 `AppError`（`error.rs`），当前含 `Database`、`Migration`、`Db` 变体，随功能扩展（如校验错误、NotFound）。
- 错误向上传播，`commands` 层不做吞错；前端 `common/ipc` 负责把错误归一化为 UI 提示。

---

## 4. 数据架构

### 4.1 全局约定

- 主键：TEXT UUID v4。
- 时间戳：ISO-8601 UTC 字符串。
- 软删除：`deleted_at`（可空），查询默认过滤 `deleted_at IS NULL`。
- 排序：**字典序字符串键**（fractional indexing）。`sort_order` 是 TEXT 类型的排序键，按字典序（lexicographic）升序比较；在任意两个已有序键之间插入新项时，生成一个**介于两者之间的中间字符串**（如 `a` 与 `c` 之间取 `b`、`b` 与 `c` 之间取 `bm`），从而**无需重排已有行**即可完成插入。仅在中间字符串耗尽（两键相邻、无中间值可生成）时才对该范围内少量行重新分配键。拖拽重排即「把目标行的 `sort_order` 改写成目标间隙的中间键」。

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
| **Task** | project_id(可空→收件箱), title, note, priority, column_id, due_at, completed_at, repeat_rule, sort_order(字典序键，按所属列表/看板列内排序) |
| **Subtask** | task_id, title, done, sort_order(字典序键) |
| **Tag / TaskTag** | name, color / task_id, tag_id |
| **Comment** | task_id, body |
| **TimeEntry** | task_id, started_at, ended_at, duration(秒) |
| **BoardColumn** | project_id, name, position(字典序键), is_done(标识完成列) |
| **Settings** | key, value（JSON） |

**看板列建模**：项目默认三列「待办 / 进行中 / 已完成」由 `BoardColumn` 行表示；`Task.column_id` 指向具体列，`is_done` 标记「完成」列以驱动 `completed_at` 与进度统计。收件箱任务 `column_id` 为空。

**手动排序（字典序键）说明**：`sort_order` / `position` 采用字典序字符串键，语义是「用户手动拖拽后的位置」。它与视图级的「按优先级 / 按截止日期」即时排序正交——后者用 `createMemo` 派生计算、不落库；前者才是持久化的自定义顺序，仅在「手动排序」模式下作为默认展示顺序。中间键的生成用后端统一实现（`services`/`lib` 中的 `between(a, b)` 工具），前端只传「目标前驱/后继键」，保证算法一致。

> 详细 DDL、索引（含 FTS5 虚拟表）在实现阶段的 `src-tauri/migrations/V<N>__*.sql` 中细化，遵循「每 schema 变更新增迁移、不改旧迁移」的规则。

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

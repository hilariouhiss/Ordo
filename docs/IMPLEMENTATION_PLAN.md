# Ordo 实现计划（Implementation Plan）

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.0 |
| 更新日期 | 2026-09-15 |
| 状态 | 生效（开发按本计划执行） |
| 关联文档 | [PRD.md](./PRD.md)、[ARCHITECTURE.md](./ARCHITECTURE.md) |
| 适用范围 | Ordo v1（MVP 6.1 + v1 完整版 6.2）；P2/未来功能仅预留，不实现 |

## 1. 计划目标与阅读前提

本计划把 PRD v1.0 的功能需求拆解为可执行、可验收的任务序列，并严格遵循 ARCHITECTURE v1.0 的分层、数据模型与技术决策。开发过程中：

1. 每个任务以「验收标准」为完成定义（DoD），不达标不进入下一里程碑。
2. 任何行为、数据模型、非功能目标变更，须同步更新 PRD / ARCHITECTURE / 本计划（见 §7）。
3. 任务按里程碑顺序推进，仅标注「可并行」的任务允许并行；跨里程碑依赖见 §5。

## 2. 里程碑总览

| 里程碑 | 内容 | 对应 PRD | 出口条件 |
| --- | --- | --- | --- |
| M0 基础设施 | 设计 Token、主题、路由壳、通用组件、IPC 层、完整 Schema 迁移、排序键工具 | NFR 5.1/5.2 | 前后端脚手架可跑，Schema 就绪 |
| M1 任务域 | 任务/标签/子任务全链路 + 四个任务视图 | 2.1（P0） | 任务 CRUD 验收要点通过 |
| M2 项目与看板 | 项目/看板列/拖拽排序/列表视图 | 2.2（P0） | 看板拖拽验收要点通过 |
| M3 搜索与提醒 | FTS5 全文搜索 + 截止提醒/系统通知 | 2.1 搜索（P1）/提醒（P0） | 搜索与后台提醒可用 |
| M4 增强实体 | 重复任务、评论、时间记录 | 2.1 重复/时间（v1）、2.3 | 三项能力验收要点通过 |
| M5 统计 | 聚合命令 + 图表 + 项目进度视图 | 3.1–3.3、2.2 进度视图（P1） | 统计秒级返回 |
| M6 桌面集成 | 托盘、全局快捷键、导出备份、自启（P2） | 4、5.1、5.6 | 桌面能力验收要点通过 |
| M7 打磨验收 | 性能、动效、三端、体积、文档、质量收口 | 5、8 | MVP/v1 达到发布条件 |
| M8 属性扩展与依赖 | 任务/子任务属性扩展（任务复杂度、子任务描述/优先级/截止/复杂度）+ 依赖边与完成顺序（软阻塞） | 2.1 依赖与完成顺序、子任务属性 | 属性可编辑并持久化；依赖可增删且拒绝成环；被阻塞项有标记且完成需确认 |
| M9 命名空间 | 命名空间容器（项目分组）+ 侧边栏分组 + 命名空间页汇总 | PRD 2.2 命名空间 | 分组可导航；归档不级联；汇总随任务实时更新 |

MVP（PRD 6.1）= M0–M3；v1 完整版（PRD 6.2）= M0–M7。M8（属性扩展与依赖）与 M9（命名空间）都是 v1 之上追加的迭代：两条范围线都不含它们——M8 只在 M1 的任务/子任务链路上加东西（详见 §4 的 M8 一节），M9 只在 M2 的项目域上分层（详见 §4 的 M9 一节）。

## 3. 全局实施约定

**分层与代码位置（强制）**

- 后端单向依赖：`commands → services → repositories → (models, db)`；SQL 只出现在 `repositories.rs`（规模增大时按领域拆模块，边界不变）。
- 前端：`features/*/api.ts` 是唯一调用 `invoke` 的位置；组件经 `hooks.ts` 变更 store；跨域共享逻辑下沉 `common/`。
- 主键/时间戳后端生成；软删除过滤（`deleted_at IS NULL`）为默认查询语义。

**命令命名（前缀 `<domain>:<action>`，常量集中在 `src/common/ipc/commands.ts`）**

```
task:list|create|update|complete|softDelete|restore
subtask:list|create|update|complete|delete|reorder
tag:list|create|update|delete
project:list|create|update|archive|restore
namespace:list|create|update|archive|restore
board:listColumns|addColumn|updateColumn|deleteColumn|moveTask
search:query
comment:list|create|update|delete
time:list|create|update|delete|start|stop
stats:trend|projectProgress|timeDistribution
settings:get|set
backup:export|import
```

**数据约定**

- UUID v4 主键、ISO-8601 UTC 时间戳、`deleted_at` 软删除、`sort_order`/`position` 字典序排序键。
- `task:list` 返回的任务对象内嵌 `tagIds`（任务-标签关联的唯一读取路径；关联写入随 `task:create`/`task:update` 的 `tagIds` 字段）。
- 排序键由后端 `sort.rs` 的 `between(a, b)` 统一生成（fractional indexing；键耗尽时局部重排），前端只传目标位置的前驱/后继键。
- 截止时间存 UTC；「今天/即将到来」的本地日期边界由前端用 date-fns 按用户时区计算，后端提醒按 UTC 扫描。

**乐观更新数据流（所有写操作）**

`用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果 reconcile → 失败回滚 + 通知`。

**测试策略**

- 后端：`repositories`/`services` 用 in-memory SQLite + 真实迁移做单测；`sort.rs` 做纯函数单测。
- 前端：store/hooks/工具函数用 Vitest；`pnpm typecheck` 必须零错误。
- 每个里程碑出口：`cargo test`、`pnpm test`、`pnpm typecheck` 全绿。

## 4. 任务拆分明细

状态标记：✅ 已完成 / ⬜ 未开始。

### M0 基础设施

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| F-01 | 设计 Token 与主题 | `src/index.css`（@theme 颜色/圆角/字号/阴影 Token；深/浅色 CSS 变量；全局 `focus-ring`、`skeleton`、浮层入场动画与 `prefers-reduced-motion` 兜底）；`src/common/stores/ui.ts`（主题状态） | 深浅主题可切换且跟随系统；组件只引用 Token 不写死色值；中性色同一色相、强调色与语义色不撞色；平面分层（sunken/background/surface/elevated）明度可辨 | — | ✅ |
| F-02 | 路由与 AppShell | `src/router.tsx`（`/today`、`/upcoming`、`/inbox`、`/completed`、`/projects/:projectId`、`/stats`、`/settings`、`/search`，`/` 重定向 `/today`，未知路径 404）；`src/app/AppShell.tsx`（侧边栏+内容区；页面标题由各视图自己渲染，壳层不再单独占一条标题栏）；路由懒加载 | 全部路由可达、未知路由有回退、每个路由只有一个页面标题、`pnpm typecheck` 通过 | F-01 | ✅ |
| F-03 | 通用组件库 | `src/common/components/`：Button/Input/Textarea/Select/Dialog/DropdownMenu/Tabs/Tooltip/Popover/Checkbox/Badge/VirtualList/Skeleton/EmptyState（自研轻量虚拟滚动）；`iconButtonClass` 是图标按钮的唯一出处 | 组件基于 Kobalte；动效仅 transform/opacity/独立 scale·translate 且由全局 `prefers-reduced-motion` 规则兜底；可点元素都有 hover 与按下反馈；焦点指示统一走 `focus-ring`；加载态用骨架屏 | F-01 | ✅ |
| F-04 | IPC 封装与错误归一化 | `src/common/ipc/`：`invoke.ts`（类型化封装）、`commands.ts`（命令常量）、`errors.ts`（AppError→`{code,message}`） | 所有 IPC 走统一封装；错误结构一致 | — | ✅ |
| F-05 | Schema 迁移 V2 | `src-tauri/migrations/V2__schema.sql`：projects、board_columns、tasks、subtasks、tags、task_tags、comments、time_entries、settings 建表 + 外键 + 索引；FTS5 表 `task_search`/`comment_search`（external-content）+ 同步触发器 | 迁移可在空库执行；`cargo test` 迁移用例通过；软删除/外键语义正确 | — | ✅ |
| F-06 | 后端模型与枚举 | `src-tauri/src/models.rs`：Project/Task/Subtask/Tag/Comment/TimeEntry/BoardColumn/Setting + Priority（high/medium/low/none）、RepeatRule、ProjectStatus 枚举，serde 全序列化 | 与 V2 Schema 一一对应；serde 字段名与前端类型对齐 | F-05 | ✅ |
| F-07 | 错误类型扩展 | `src-tauri/src/error.rs`：新增 `Validation(String)`、`NotFound(String)`；实现 `Serialize` | IPC 可传递可读错误；`From` 转换完备 | — | ✅ |
| F-08 | 排序键工具 | `src-tauri/src/sort.rs`：`first()`、`between(a,b)`、耗尽时局部重排函数；单元测试 | 任意两键间可生成中间键；相邻耗尽时正确重排；测试覆盖边界 | — | ✅ |

F-04、F-07、F-08 与其余任务无依赖，可并行。

### M1 任务域（P0）

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| T-01 | 任务/标签/子任务仓储 | `src-tauri/src/repositories.rs`：task/tag/subtask 的 CRUD + 软删除过滤 + sort_order 排序 + task_tag 关联 | 单测（in-memory）覆盖 CRUD 与软删除 | F-05/06 | ✅ |
| T-02 | 任务/标签服务与命令 | `services.rs`：业务规则（complete 写 completed_at、事务创建任务+标签+子任务）；`commands.rs`：`task:*`、`tag:*`、`subtask:*`；`lib.rs` 注册 invoke_handler | `cargo test` 通过；`task:complete` 后 completed_at 落库且 today 查询不含该任务 | T-01 | ✅ |
| T-03 | 任务前端数据层 | `src/features/tasks/`：`types.ts`、`api.ts`、`store.ts`（createStore 全量数据）、`hooks.ts`（createTask/completeTask/updateTask/softDelete/restore…） | 乐观更新+reconcile+失败回滚符合 §3 数据流；Vitest 覆盖 store/hooks | F-04、T-02 | ✅ |
| T-04 | 任务编辑器 | `TaskEditorDialog.tsx`：标题（必填）、备注、优先级、标签、截止时间；Zod 校验；新建/编辑复用 | 新建任务 <1s 落库并可见；校验错误有明确提示 | T-03、F-03 | ✅ |
| T-05 | 四个任务视图 | `features/tasks/components/views/`：Inbox/Today/Upcoming/Completed；优先级/标签/截止日期筛选排序；VirtualList 长列表 | 完成任务立即从「今天」消失并进入「已完成」；万级任务滚动不掉帧 | T-03/04 | ✅ |
| T-06 | 子任务 UI | 任务详情内子任务列表：增删改、勾选完成、手动排序（排序键） | 父任务显示子任务完成进度；排序持久化 | T-03/05 | ✅ |
| T-06b | 任务列表层级展示 | `src-tauri/src/repositories.rs`（`subtasks::list_all`）；`src-tauri/src/services.rs`（`list_all_subtasks`）；`src-tauri/src/commands.rs` + `lib.rs`（`subtask:listAll`）；前端 `TaskListView` 拍平成等高行、`TaskItemRow` 展开位与进度徽章、新增 `SubtaskRow` | 列表默认折叠且父行显示 `已完成/总数`；展开列出子任务；勾选子任务走现有乐观更新；看板与项目进度条口径不变 | T-06 | ✅ |
| T-07 | 标签与优先级 UI | 标签管理（名称/颜色/删除）、任务挂多个标签、四级优先级选择与展示 | 标签增删改即时反映到任务与筛选 | T-03/05 | ✅ |

M1 出口：任务 CRUD + 子任务 + 优先级 + 标签 + 截止日期 + 四个视图的验收要点（PRD 2.1）全部通过。

### M2 项目与看板（P0）

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| P-01 | 项目/看板列仓储 | `repositories.rs`：project/board_column CRUD、软删除（归档）、position 排序 | 单测覆盖归档恢复与列 CRUD | F-05/06 | ✅ |
| P-02 | 项目/看板服务与命令 | `services.rs`：新建项目事务内初始化默认三列（待办/进行中/已完成，`is_done` 标记完成列）；`moveTask` 事务：改 column_id + 按 `is_done` 联动 completed_at + 写排序键；`commands.rs`：`project:*`、`board:*` | `cargo test` 通过；任务移入/移出完成列时 completed_at 正确设置/清除 | P-01 | ✅ |
| P-03 | 项目前端数据层 | `src/features/projects/`：types/api/store/hooks；项目 CRUD UI（名称/描述/颜色/图标/截止日期/归档恢复） | 乐观更新与 reconcile 符合规范；归档项目从导航消失、可恢复 | P-02、F-04 | ✅ |
| P-04 | 项目列表视图 | 项目详情列表视图：手动/优先级/截止日期/标签排序切换、完成率、任务快速完成 | 列表完成率实时随任务完成更新 | P-03 | ✅ |
| P-05 | 看板视图与拖拽 | `src/features/board/`：列组件、任务卡、原生 Drag API（拖拽中仅 transform）；列内排序 + 跨列移动 + 自定义列（增删改名、is_done 切换） | 拖拽 60fps；松手后列与顺序即时持久化；移入/移出完成列联动完成状态 | P-03/04、F-08 | ✅ |

M2 出口：看板拖拽流畅、状态与顺序即时持久化、项目进度随完成实时更新（PRD 2.2 验收要点）。

### M3 搜索与提醒（搜索 P1，提醒 P0）

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| S-01 | 全文搜索后端 | `search:query` 命令：FTS5 查询 `task_search`（title/note）+ `comment_search`（body），返回排序命中 + snippet | 标题/备注/评论均可命中；数千条数据毫秒级返回 | F-05 | ✅ |
| S-02 | 搜索视图 | `src/features/search/`：`/search` 搜索框、结果列表、命中跳转 | 搜索交互流畅；点击结果可跳转任务 | S-01 | ✅ |
| R-01 | 提醒调度服务 | 后台调度器：按固定间隔扫描 due_at 到期与提前提醒（10 分钟/1 小时），避免重复触发 | 到期/提前提醒在应用后台或托盘状态下仍触发 | T-02 | ✅ |
| R-02 | 系统通知接入 | 添加 `tauri-plugin-notification`；`capabilities/default.json` 增 `notification:default`；通知点击唤起主窗口并定位任务 | 后台状态通知可达；点击唤起正确 | R-01 | ✅ |

M3 出口：搜索可用；提醒在非前台状态下可触发系统通知（PRD 2.1/4 验收要点）。

### M4 增强实体（v1：重复任务、评论、时间记录）

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| RP-01 | 重复任务 | `RepeatRule` 解析（每天/每周/每月/自定义间隔）；`task:complete` 对重复任务生成下一次实例；暂停/结束规则 | 完成后自动生成下一次任务；暂停后不再生成；可取消规则 | T-02/06 | ✅ |
| C-01 | 评论 | `comment:list/create/update/delete` 命令 + 仓储；FTS 触发器覆盖评论；任务详情评论 UI | 评论可增删改；进入全文搜索范围 | F-05、T-05 | ✅ |
| TE-01 | 时间记录 | `time:list/create/update/delete/start/stop` 命令 + 仓储（started_at/ended_at/duration 秒）；任务上「开始/停止」计时 + 手动录入 UI | 计时准确落库；手动录入校验合法；时间记录与任务/项目/标签关联 | F-05、T-05 | ✅ |

M4 出口：重复任务、评论、时间记录验收要点（PRD 2.1/2.3）通过。

### M5 统计（v1，只读洞察层）

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ST-01 | 统计聚合命令 | `stats:trend`（日/周完成曲线）、`stats:projectProgress`（完成率/剩余/截止对比）、`stats:timeDistribution`（按项目/标签、日/周/月粒度）；基于 completed_at/TimeEntry 聚合 + 索引 | 数千任务数据秒级返回；聚合 SQL 有索引支撑 | T-02、P-02、TE-01 | ✅ |
| ST-02 | 图表组件 | `src/features/stats/`：折线、日历热力图、项目对比、时间分布（自绘 SVG，不引图表库）；`/stats` 视图 | 图表交互流畅；范围切换（7/30 天/本年）正确 | ST-01 | ✅ |
| ST-03 | 项目进度视图 | `features/projects` 进度视图：总进度条、完成率、剩余任务、距截止剩余时间 | 进度随任务完成实时更新 | ST-01/02 | ✅ |

M5 出口：统计在数千任务下秒级生成、图表流畅（PRD 3 验收要点）。

### M6 桌面集成（v1 + P2）

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| D-01 | 系统托盘 | `lib.rs`：Tauri 核心 Tray API；关闭主窗口驻留托盘；菜单「显示/隐藏/退出」；托盘状态提醒正常 | 关闭窗口后驻留托盘；托盘唤起/退出正常；提醒仍触发 | R-02 | ✅ |
| D-02 | 全局快捷键快速添加 | 添加 `tauri-plugin-global-shortcut` + capabilities；全局快捷键只唤起独立的 `quick-add` 输入小窗（主界面不弹出），录入即隐；行内 `@项目` / `!高!中!低` / 中文日期标记 + 项目/优先级/截止日期控件（`quick-add-parse.ts`、`priority.ts`） | 应用无焦点时快捷键可用；快捷键不弹出主界面；录入后不影响当前工作；标记解析正确且歧义/未知标记不误删标题 | T-04 | ✅ |
| D-03 | 数据导出/备份 | `backup:export`（完整 JSON 导出）/`backup:import`；设置页手动导出入口 | 导出文件可完整恢复数据（含标签/看板列/设置） | M4 出口 | ✅ |
| D-04 | 开机自启（P2） | 添加 `tauri-plugin-autostart` + capabilities；设置页开关（默认关闭） | 可配置且默认关闭 | D-01 | ✅ |

M6 出口：PRD §4 验收要点 + 5.6 备份能力达成。

### M7 打磨与验收

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| Q-01 | 性能验收 | 全链路测量：冷启动 <1.5s、热启动 <0.5s、命令往返 <50ms、统计秒级；release 构建体积 <30MB | 达到 PRD §5/§8 目标值 | M6 | ⬜ |
| Q-02 | 动效与无障碍 | 复查全部动效仅 transform/opacity、150–300ms、`prefers-reduced-motion`；键盘可达性 | 无违规动效；减少动态效果偏好生效 | M6 | ⬜ |
| Q-03 | 三端兼容 | Windows/macOS/Linux 下快捷键、托盘、通知、路径行为验证 | 三端一致体验 | M6 | ⬜ |
| Q-04 | 文档同步 | 按实现结果回写 PRD/ARCHITECTURE（状态、字段、命令清单、目录结构） | 文档与代码一致 | M6 | ⬜ |
| Q-05 | 质量收口 | `cargo test`/`pnpm test`/`pnpm typecheck` 全绿；清理 demo `greet`；README 补充 | 无遗留脚手架代码；测试稳定通过 | M6 | ⬜ |

M7 出口：Ordo v1 达到发布条件。

### M8 属性扩展与依赖（v1 迭代）

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| T-08 | 任务/子任务属性扩展 | V4 迁移（`tasks.complexity`、`subtasks.{note,priority,due_at,complexity}`）；`complexity.ts` 词表；任务编辑器与子任务属性面板 `SubtaskEditor`（描述/优先级/截止时间/复杂度一次写回）；子任务行与详情徽标 | 属性可编辑并持久化 | T-04、T-06 | ✅ |
| T-09 | 依赖与完成顺序（含子任务提醒） | `task_dependencies` / `subtask_dependencies` 两张连接表与 `dependency:listAll/add/remove`；`dependencies.ts` 纯函数派生；`TaskDependencies` 依赖区与子任务前置选择器；列表行阻塞标记与完成前确认（`blocked-confirm.ts`）；`subtask_reminders` 与「父任务 › 子任务」提醒文案；备份携带依赖边 | 依赖可增删且拒绝成环；被阻塞项有标记且完成需确认；备份携带依赖边 | T-08 | ✅ |

M8 出口：属性可编辑并持久化；依赖可增删且拒绝成环；被阻塞项有标记且完成需确认；备份携带依赖边；`cargo test` / `pnpm test` / `pnpm typecheck` 全绿。

### M9 命名空间（v1 迭代）

命名空间是把多个相关项目收在一起的容器（单层，项目至多归属一个）。范围只到「组织 + 导航 + 一个汇总页」：任务视图、搜索、统计口径不变。

| ID | 任务 | 关键产出/文件 | 验收标准 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| NS-01 | 迁移与模型 | `V5__namespaces.sql`（`namespaces` 表 + `projects.namespace_id` 可空外键 + 索引）；`Namespace`/`NewNamespace`/`UpdateNamespace`；项目读写带上该列 | 旧库升级后既有项目 `namespace_id` 为 NULL；项目带归属的往返正确 | F-05/06 | ✅ |
| NS-02 | 命名空间后端 | `repositories::namespaces`；`services::{list,create,update,archive,restore}_namespace`；`namespace:*` 五个命令；`project:*` 校验 `namespaceId` 存在且未软删；备份升到 v3 并携带命名空间 | 归档/恢复幂等且不级联其下项目；未知命名空间返回 not_found；v2 备份仍可导入且项目落在根级 | NS-01 | ✅ |
| NS-03 | 前端数据层与编辑器 | `features/namespaces/{types,api,store,hooks}`；分组派生（`projectsInNamespace` / `ungroupedProjects` / `archivedLooseProjects` / `archivedProjectsOf`）；项目编辑器的命名空间选择；`NamespaceEditorDialog`；图标表下沉 `common/icons.ts` | 派生按存活命名空间判定，孤儿项目回落根级；乐观更新与回滚符合规范 | NS-02 | ✅ |
| NS-04 | 侧边栏分组与命名空间页 | `AppShell` 分组导航 + 归档区 + 新建入口；`/namespaces/$namespaceId` 页面（组内项目列表 + 汇总进度 + 行内菜单） | 每个项目只出现在一处；汇总随任务完成同 tick 更新；归档命名空间可从归档区恢复 | NS-03 | ✅ |

M9 出口：分组可导航、归档不级联、汇总实时；`cargo test` / `cargo fmt` / `cargo clippy` / `pnpm test` / `pnpm typecheck` 全绿。

## 5. 依赖与并行关系

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5 ──► M6 ──► M7
        │
        ├──► M8（属性扩展与依赖）
        │
        └──► M9（命名空间）
```

- M0 内部：F-04/F-07/F-08 可并行；F-05→F-06 顺序。
- M1 与 M2 的后端仓储可同批实现（T-01 与 P-01 均依赖 F-05/06），前端按 M1→M2 顺序。
- M3 的搜索（S-01）可在 M2 完成后提前；提醒（R-*）必须在 T-02 完成后。
- M5 的时间分布依赖 M4 的 TE-01，其余可在 M2 后提前。
- M6 依赖对应功能域完成；D-03 依赖 M4 全量实体。
- M8 只依赖 M1 的任务/子任务链路（T-04、T-06），与 M2–M7 没有顺序依赖，可以在 M1 之后随时插入。
- M9 只依赖 M2 的项目域（P-03），与 M3–M8 没有顺序依赖，可以在 M2 之后随时插入；实施时 M9 内部按 Task 8 → Task 7 的顺序落地（见 §4 的顺序变更说明）。
- M9 只依赖 M2 的项目域（P-03），与 M3–M8 没有顺序依赖，可以在 M2 之后随时插入。

## 6. 风险与注意事项

1. **依赖锁定**：`rusqlite 0.39` 与 `refinery 0.9.2` 互相锁定，禁止单独升级（AGENTS.md）。
2. **FTS5 可用性**：已核实 libsqlite3-sys bundled 构建默认启用 `SQLITE_ENABLE_FTS5`；若更换 SQLite 来源需重新核实。
3. **能力声明**：新增插件（notification/global-shortcut/autostart）必须同步写 `src-tauri/capabilities/default.json`，否则调用被拒。
4. **时区**：`due_at` 存 UTC；「今天」边界在前端本地时区计算，后端提醒按 UTC 扫描，需在 T-05/R-01 明确并测试跨时区场景。
5. **写并发**：`Db = Mutex<Connection>` 串行化写；提醒调度与统计查询不要长占锁（聚合走索引、必要时复制连接），避免阻塞交互命令。
6. **排序键耗尽**：fractional indexing 相邻键耗尽时需局部重排（F-08 必须实现并有测试），否则特定位置拖拽会失败。
7. **开发环境**：Vite 固定端口 1420；`cargo` 在 `src-tauri/`、`pnpm` 在仓库根目录执行。
8. **PRD 状态**：PRD 为「草案（待评审）」，评审结论若改变范围，先更新本计划再开发。
9. **体积红线**：图表自绘 SVG、虚拟滚动自研、不引动画/图表/DnD 库，保证 <30MB。

## 7. 文档同步与计划维护

- 本计划是开发的执行顺序与验收基线；新增任务、调整顺序、验收标准变更都须更新本文件。
- 每完成一个里程碑，按 AGENTS.md 规则回写 PRD/ARCHITECTURE（行为、模型、结构、非功能目标），并更新各文档「状态/版本/日期」。
- 数据模型（V2 Schema）已随 F-05 落地，实际 DDL 见 `src-tauri/migrations/V2__schema.sql`（ARCHITECTURE §4.2 已给出摘要）。

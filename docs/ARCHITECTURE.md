# Ordo 架构与实现

> 本文描述 Ordo **当前的**代码形态：分层、目录、数据流、命令面、设计系统与工程约定。用户可见行为见 [PRODUCT.md](./PRODUCT.md)，字段与迁移见 [DATA.md](./DATA.md)，决策理由见 [DECISIONS.md](./DECISIONS.md)。

## 1. 总览

Ordo 是 local-first、单用户的桌面应用，三层结构：

```
┌─────────────────────────────────────────────────┐
│  前端（SolidJS + TypeScript + Tailwind v4）       │
│  路由 / 视图 / 组件 / 内存 Store（乐观更新）        │
└──────────────────────┬──────────────────────────┘
                       │ Tauri IPC（类型化 invoke）
┌──────────────────────▼──────────────────────────┐
│  后端（Rust）                                     │
│  commands → services → repositories → models/db  │
└──────────────────────┬──────────────────────────┘
                       │ SQL（rusqlite）
┌──────────────────────▼──────────────────────────┐
│  存储（SQLite 单文件，refinery 迁移）              │
└─────────────────────────────────────────────────┘
```

四条核心原则：

1. **前端持有全部数据，后端是持久化与权威计算源。** 前端启动时全量加载，交互走乐观更新；后端负责落库、迁移、全文搜索（FTS5）与统计聚合。
2. **单向数据流。** 前端操作 → 本地 store 立即更新 → 异步同步后端 → 用后端返回结果 reconcile。
3. **后端分层内聚。** 只有 `repositories` 写 SQL；`services` 管业务规则与事务；`commands` 是薄 IPC 壳。
4. **本地优先。** 一切不依赖网络；数据模型为未来同步预留（UUID + 时间戳 + 软删除）。

## 2. 前端

### 2.1 目录结构（feature-based）

```
src/
├── index.tsx                  # 渲染入口：按窗口 label 分流（quick-add → QuickAddWindow，其余 → RouterProvider）
├── router.tsx                 # 路由定义（代码式，TanStack Solid Router）
├── index.css                  # Tailwind 入口 + 设计 Token + 全局工具类
├── vite-env.d.ts
├── assets/logo.svg            # 同时作为 favicon
├── app/                       # 应用装配层（唯一组合各 feature UI 的地方）
│   ├── AppShell.tsx           # 布局壳：侧边栏树 + 内容区（仅主窗口）
│   ├── QuickAddWindow.tsx     # quick-add 小窗的全部内容（仅该窗口渲染）
│   ├── TaskViewer.tsx         # 全局任务详情/编辑弹窗（搜索命中等跳转的落点）
│   ├── PlaceholderView.tsx    # 占位视图
│   └── __tests__/             # app-shell-sidebar / quick-add-window / task-viewer
├── common/                    # 跨领域共享
│   ├── colors.ts              # 预设色板（项目与命名空间共用；null = 无颜色）
│   ├── icons.ts               # 图标表（按名字解析成 lucide 组件）
│   ├── optimistic.ts          # 乐观写入共用件（临时 id / 失败通知 / optimistic 包装）
│   ├── perf.ts                # 性能验收计时（Q-01）：启动与命令往返样本、上报
│   ├── components/            # 通用 UI（基于 Kobalte 二次封装）+ index.ts 桶文件
│   │   └── badge / button / checkbox / date-field / dialog / dropdown-menu /
│   │       empty-state / palette-picker / popover / select / skeleton / tabs /
│   │       text-field / ThemeToggle / toaster / tooltip / virtual-list
│   ├── ipc/                   # index.ts / invoke.ts / commands.ts / errors.ts / events.ts
│   ├── stores/                # drag.ts（共享拖拽态）/ notifications.ts / taskViewer.ts / ui.ts（主题）
│   └── utils/datetime.ts      # 日期工具
└── features/                  # 业务领域
    ├── tasks/                 # 任务（最大的一块）
    │   ├── components/        # TaskItemRow / SubtaskRow / SubtaskList / TaskListView /
    │   │                      # TaskDetailDialog / TaskEditorDialog / TaskDependencies /
    │   │                      # CommentList / TimeTracker / TagManagerDialog / BlockedConfirmHost
    │   │   └── views/         # InboxView / TodayView / UpcomingView / CompletedView /
    │   │                      # useViewData / ViewState
    │   ├── store.ts           # 任务内存 Store（Solid createStore）
    │   ├── api.ts             # 类型化 IPC 调用（本 feature 唯一直接 invoke 处）
    │   ├── hooks.ts           # 语义化动作（创建/完成/拖拽/依赖写入）
    │   ├── types.ts           # 领域类型（与后端 serde 对齐）
    │   ├── dependencies.ts    # 依赖图派生（纯函数：存活集合、索引、完成集、阻塞）
    │   ├── hierarchy.ts       # 层级与拖放落点判定（纯函数）
    │   ├── view-filters.ts    # 视图筛选/排序/计数（纯函数）
    │   ├── blocked-confirm.ts # 待确认的「前置未完成」请求
    │   ├── reminders.ts       # 提醒事件订阅与待定位任务
    │   ├── repeat.ts          # 重复规则的前端表示
    │   ├── time.ts            # 时长文案与 datetime-local 的本地时区换算
    │   ├── complexity.ts      # 复杂度词表（1–5，可空 = 未评估）
    │   ├── priority.ts        # 优先级标签的唯一出处
    │   ├── quick-add-parse.ts # 快捷输入语法解析（@项目 / !优先级 / #日期）
    │   └── __tests__/
    ├── projects/              # 项目（components/ ProjectDetailView / ProjectListView /
    │                          #   ProjectEditorDialog / ProjectProgress）
    ├── namespaces/            # 命名空间（components/ NamespaceDetailView /
    │                          #   NamespaceProjectsView / NamespaceEditorDialog）
    ├── board/                 # 看板（lanes.ts 分列规则 + BoardView / BoardColumnView / BoardCard）
    ├── stats/                 # 统计（components/ StatsView / LineChart / CalendarHeatmap /
    │                          #   BarList / SegmentedControl；series.ts 前后端契约的前端一半）
    ├── search/                # 全文搜索（snippet.ts 高亮片段）
    └── settings/              # 设置（主题 / 自启 / 备份）
```

标签域没有独立目录：标签管理 UI 在 `features/tasks/components/TagManagerDialog.tsx`，色板等共享件在 `common/`。测试与源码同域存放于各自的 `__tests__/`（共 55 个测试文件，Vitest）；`src/common/components/__tests__/setup.ts` 是共享的 jsdom 测试环境。

### 2.2 边界规则

- **`features/*/api.ts` 是唯一能直接调用 `invoke` 的地方**；组件与 store 只调用本 feature 的 `api.ts` 或 `hooks.ts`。唯一例外是 `common/perf.ts`：它的 `perf:ready` 上报必须绕开 `invokeCommand`（否则这条量测命令会把自己计进样本），代价是它拿不到错误归一化——那条路径本来也不该让用户看见错误（§6.1）。
- **`features` 之间不互相 import 内部实现**，共享逻辑下沉到 `common/`。
- 跨视图的「跳转到任务」交互（如搜索命中）经由 `common/stores/taskViewer.ts` 记录聚焦 id，由 app 层的 `TaskViewer.tsx` 托管任务详情/编辑弹窗——**app 装配层是唯一组合各 feature UI 的地方**。
- 组件不直接操作 store 的原始数据，通过 `hooks.ts` 暴露的语义化动作（`completeTask`、`moveTaskToColumn`）变更，便于在动作里统一做乐观更新与同步。

### 2.3 状态管理

- 使用 **Solid `createStore`**，每个领域一个 store 文件（`features/*/store.ts`）。
- **任务 store 是「按 id 的表 + 具名范围」**（`features/tasks/store.ts`）：`byId` 一张表，范围（`all`、`project:<id>`）只存 id 数组，同一行被多个范围指向时也只有一份，编辑不会留下两份会互相漂移的副本。项目、标签、命名空间、时间记录仍是各自领域的全量 store。
- **UI 状态**（侧边栏折叠、当前路由激活态、主题、弹窗开合、拖拽中态）放 `common/stores/` 或组件内 signal，与业务数据分离。
- 派生数据用 Solid 的 `createMemo` 从 store 计算，**不重复存储**：今日任务、统计聚合、命名空间分组、阻塞状态都是派生量。
- **任务树随启动全量载入**：`loadAll` 一次取回全部存活任务（**含子任务**——子任务就是 `parent_task_id` 非空的行）、标签与依赖边。列表要在折叠状态下就显示「谁有子任务、做完几项」，逐行懒加载会变成 N 次 IPC；层级只有一层，一次全表查询就能带走整棵树。
- **`all` 快照的批量载入发生在启动**：会话中途的刷新走 `reloadTasks`（重拉任务与标签，整表替换）。它替换的就是权威快照本身，没有第二份需要防覆盖的副本；**已装载**的项目范围也在这一步用同一份快照重新推导 id 列表（成员关系就是行的 `projectId`，顺序就是快照的顺序），没装载过的范围仍然只由 `ensureScope` 按需装载。
- **范围按需装载，`ensureScope` 是唯一入口**（`hooks.ts`）：已装载就立即返回，同一范围的并发调用复用同一个请求（导航重挂载会同时发起两次），失败写进 `scopeMeta[scope].error` 并让范围保持未装载——下一次调用会重试；`force = true` 是错误面板「重试」按钮走的路径。**已不读 `all` 的界面**是项目详情与看板（读 `project:<id>` 范围，`scopeRows` / `scopeMetaOf`）、侧边栏的项目行（箭头读计数聚合，展开时才装载该项目范围——**首次展开才装载**，所以箭头不依赖任何任务行）与命名空间页（读 `stats:projectProgress`）；其余界面（四个视图等）过渡期仍读 `all`（`tasks()`）。
- **未完成计数是一张独立的小表**（`store.unfinishedByProject`，`projectId → 未完成顶层行数`）：`loadUnfinishedCounts()`（`hooks.ts`）一次取回全部存活项目的计数，侧边栏的项目行只问它「这个数是不是 0」。外壳挂载时取一次，此后只在**可能改变这个数的写之后**重取：新建、完成、取消完成（`completedAt` 变了）、删除、恢复、改归属项目、改 `parentTaskId`、看板移列，quick-add 在主窗派发的 `task:created`，以及备份导入（`features/settings/hooks.ts` 的 `runImport` 与任务/项目/命名空间一起重取）——恢复换掉的正是它数的那张表，同机器恢复保留 id、跨机器恢复换掉全部 id，两种都要重取，否则箭头停在恢复前的数上。纯标题/备注/标签/优先级编辑与排序不重取——`updateTask` 的守卫按字段**值**比较而不是按「键在不在」（编辑器每次保存都带上任务自己的 `projectId`，按键比会让每次改名都白跑一趟聚合）。
- **项目范围的成员关系由行的 `projectId` 直接判定**（`store.ts` 的 `indexProjectScope` / `unindexProjectScope`）：`upsertTask`（新建，或行的 `projectId` 变了）、`patchTask`（同上）、`insertTaskAt`（软删回滚把行放回原位）、`setAll`（刷新时按快照重新派生）负责把行搬进搬出**已装载**的项目范围，`removeTask` 则把该 id 从每个范围里摘掉。没装载过的项目范围不凭空造，等它自己装载时再从服务端取。
- **子任务没有独立命令，也没有按需拉取**：`task:create` 的 `subtaskTitles` 由后端在同一事务里插成子行，这些 id 不在创建响应里，所以创建成功后补拉一次 `reloadTasks`；除此之外整棵树一直在 store 里，详情弹窗直接按父 id 过滤，没有加载态。
- **不存在父任务已删的孤儿行**：软删除父任务会在同一事务里级联软删全部子任务（恢复同理），迁移与备份导入也已清掉历史孤儿，所以载入路径不需要额外的「父任务是否还活着」谓词。

### 2.4 乐观更新数据流

每个写操作都遵循同一条流：

```
用户动作
  → 1. 乐观更新本地 store（立即反映 UI）
  → 2. 异步调用 api.ts → invoke → 后端落库
  → 3. 后端返回权威结果 → reconcile 本地 store（覆盖/修正）
  → 4. 失败则回滚本地改动 + 通知用户
```

- **reconcile 策略**：后端返回的实体（带 `updated_at`）作为权威值覆盖本地对应项，避免本地乐观值长期漂移。
- **冲突处理**：单用户 + 本地，冲突概率极低；以「后端最后写入为准」，不引入 CRDT。
- **错误归一化**：`common/ipc` 把后端 `AppError` 转成前端统一的 `{ code, message }`，组件层只消费这一形态。
- **前端不生成主键与时间戳**：UUID 与时间戳统一由后端生成。

**阻塞状态的派生路径**：依赖边随任务列表一次载入（`dependency:listAll`），列表行的阻塞标记由 `TaskListView` 的 `rows` memo 每轮渲染算一次——同一轮构建一次存活集合、索引与完成集合（`dependencies.ts` 的 `liveSet` / `buildIndex` / `completionSet`），把任务行的「还差几项」与展开后每个子任务行的阻塞与否一并传给行组件，行组件自己不再查图（详情页的依赖区、子任务列表、详情弹窗的阻塞徽标各自持有自己的 memo）。单次查询的代价是该行的前置数量，而不是整张图的规模。

**索引按存活集合建，不按原始边表建**：软删除是乐观的（行立刻离开 store，边要等下次 `dependency:listAll` 才消失），所以 `buildIndex(dependencies, live)` 丢掉任一端不在 store 里的边——删掉前置立即解锁，恢复前置依赖自动回来，都不需要补偿写入。行上的标记还要看自身是否已完成：已完成的任务/子任务不再挂「阻塞中」。

**阻塞是软的**：`completeTask` 只在「完成」时检查未完成前置，命中就**先不写库**，把请求停到 `blocked-confirm.ts`，由 `AppShell` 挂载的唯一 `BlockedConfirmHost` 弹一次确认（取消即丢弃）。**检查收敛在一个门（`hooks.ts` 的 `parkIfBlocked`）上，完成入口有四个**：任务行、详情弹窗、子任务行走的都是 `completeTask`（子任务就是任务行，没有第二个完成函数）；把卡片拖进完成列同样是完成（后端在那里打 `completed_at` 并生成重复实例），所以 `board/hooks.ts` 的 `moveTaskToColumn` 在动手之前先过同一道门。请求自带「确认后要执行的动作」（`BlockedRequest.run`：完成，或整次拖拽移动），宿主只调 `run()`、不按来源分支，写入失败时保留对话框与前置清单；取消完成永不检查。

**命名空间分组同样是派生量**：分组与项目列表都从 store 派生——`projectsInNamespace(id)`、`ungroupedProjects()`（未归属 + 命名空间已消失的孤儿）、`archivedLooseProjects()` / `archivedProjectsOf(id)`（已归档区的平铺与嵌套口径）；但两处画在项目行上的**数字不来自这个 store**——侧边栏项目行的展开箭头读 `project:unfinishedCounts`，命名空间页的进度条读 `stats:projectProgress`（§2.3、§3.2）。判定归属用**存活命名空间集合**而不是 `namespaceId` 是否为空。每个项目只出现在一处：分组行、根级平铺、已归档平铺、或已归档分组，四者互斥。

### 2.5 路由

基于 **TanStack Solid Router**（代码式路由，`src/router.tsx`），入口 `src/index.tsx`。

| 路径 | 视图 | 说明 |
| --- | --- | --- |
| `/` | — | 重定向到 `/today` |
| `/today` | `TodayView` | 今天 |
| `/upcoming` | `UpcomingView` | 即将到来 |
| `/inbox` | `InboxView` | 收件箱 |
| `/completed` | `CompletedView` | 已完成 |
| `/projects/$projectId` | `ProjectDetailView` | 项目详情（列表/看板/进度切换） |
| `/namespaces/$namespaceId` | `NamespaceDetailView` | 命名空间页（组内项目 + 汇总进度） |
| `/stats` | `StatsView` | 统计 |
| `/search` | `SearchView` | 搜索 |
| `/settings` | `SettingsView` | 设置 |
| 其它 | `notFoundComponent` | 「页面不存在」+ 返回今天 |

- 根路由的 `component` 为 `AppShell`（侧边栏 + 内容区；页面标题由各视图自己渲染，壳层不单独占一条标题栏）。
- 各视图经 `lazyRouteComponent` 懒加载，按需打包。
- 视图切换仅切换路由，数据仍来自领域 store（不按路由重取）。

### 2.6 设计系统

全部 Token 与全局工具类集中在 `src/index.css`（Tailwind v4 CSS-first，**没有** `tailwind.config.js` 与 PostCSS 配置）。

**颜色与分层**

- **一套灰**：所有中性色都在 hue 265、chroma ≤ 0.012 上取值——把暖色背景和冷色前景混在一起，是最快让界面看起来像两套设计系统拼起来的方式。
- **一个强调色**：`--primary` 是低饱和深青（hue ~197），与所有语义色保持足够色相距离（success 155、warning ~65、danger 25），避免强调面被读成状态。它会被涂在复选框、进度条、焦点环上，所以饱和度压得很低——静止时应该往后退。
- **平面分层**：`--sunken`（看板列这类凹槽）/ `--background`（页面）/ `--surface`（侧边栏、面板）/ `--elevated`（弹窗、菜单、看板卡片）四层，靠明度差而不是描边表达层级。深色模式下 `--sunken` 比 `--background` 更深，浅色模式下更浅，两边都是「往里凹」的观感。
- **阴影带色**：用中性色相染过的半透明色而不是纯黑低透明度，让阴影和它落下的面处在同一光照里；深色模式的抬升主要靠 `inset` 顶部高光，因为黑压黑没有可压的余量。
- **`--*-solid` / `--*-foreground` 成对**：成对的是填充按钮的前景/背景；单独的那个 token 是当作**文字**用的，按在页面背景上的对比度调过。不要拿 `--danger` 当按钮底色再配白字。
- 组件只引用 Token，不写死色值；深浅主题可切换、可跟随系统。深色模式是**类驱动**的（`@custom-variant dark`），由 `common/stores/ui.ts` 在运行时切换 `html.dark`，因此手动切换与跟随系统共用同一条路径。

**排版与圆角**

- 字号按桌面密度定：正文 13px（`text-sm`）、次要 12px（`text-xs`）、徽章 11px（`text-2xs`）、页面标题 17px（`text-lg`）；数字全局 `font-variant-numeric: tabular-nums`——这个应用里的数字（日期、计数、时长、百分比）几乎都是按列读的。
- 圆角：`sm`(6) 徽章/复选框/行内标记；`md`(8) 按钮/输入框/列表行；`lg`(12) 面板/看板列/浮层；`xl`(16) 整块弹窗。
- **字体内置系统字体栈**（`system-ui` 优先，CJK 按平台降级）。不打包 Web 字体：界面文字约 95% 是中文，引入拉丁展示字体会为署名和数字付出体积与字节，与体积目标冲突。

**全局工具类**（`index.css` 定义，全应用复用）

- **`focus-ring` 是唯一的焦点指示**（`:focus-visible` 上的 2px `outline`）。用 `outline` 而不是 `ring`：outline 跟随元素自身的圆角，且不需要 `ring-offset`——offset 会用页面背景色补一圈，一旦元素不在 `bg-background` 上（侧边栏、卡片、菜单里）就会显出一圈错色。
- **`child-indent` 是内联子列表的唯一缩进规则**：子项内容相对父项右移 20px，缩进带中线画 1px `border-strong` 引导线。虚拟化的行式子列表（`SubtaskRow` 的 `w-5` 槽位）用行内槽位表达同一条规则——两者的步长与线色必须保持一致。整页/卡片式子列表不缩进。
- **`skeleton`** 骨架屏的微光扫过（固定渐变上的 `background-position` 位移，不额外占用 DOM）。
- **浮层入场动画** `animate-fade-in` / `animate-surface-in` / `animate-toast-in`。
- **`.date-field`** 的 `::-webkit-datetime-edit` 隐藏规则（配合 `DateField` 组件）。
- 滚动条样式：`::-webkit-scrollbar` 系列（Tauri 渲染在 WebView2/Chromium 上）+ 标准属性兜底；透明边框 + `background-clip` 把滑块缩进成浮动胶囊。

**组件与动效约定**

- 无样式原语一律用 **Kobalte**（Dialog/Dropdown/Select/Tabs/Tooltip/Popover/Checkbox），视觉样式由 `common/components` 二次封装统一，并集中从 `common/components/index.ts` 导出。
- 图标用 **Lucide**；日期用 **date-fns**；表单校验用 **Zod**。图标按钮样式只有 `iconButtonClass` 一处出处。
- 长列表用**虚拟滚动**（`common/components/virtual-list.tsx`，自研轻量实现）。
- 看板拖拽用原生 Drag API，拖拽中仅移动 `transform`，不触发布局重排。
- **动效只允许** CSS `transform` / `opacity` / 独立的 `scale`·`translate` 属性；时长 150–300ms；遵循 `prefers-reduced-motion`（由 `index.css` 的全局 `@media` 规则统一兜底，组件里不再逐处写 `motion-reduce:*`）。
- **浮层只做入场动画，不做退场动画**：Kobalte 的 presence 会等动画结束才卸载元素，一个没触发的退场动画会留下一层看不见但吃掉所有点击的遮罩。入场动画必须写在 `scale` / `translate` 长属性上而非 `transform`：Kobalte 用 `transform: translate(...)` 定位浮层，动画里写 `transform` 会在结束时把浮层弹回原点。
- 所有可点元素都有 hover 与按下反馈（按下用 `scale` 收缩）；加载态用骨架屏而不是纯文字，骨架形状对齐最终布局。
- **日期控件的空值文案统一**：原生 `<input type="date|datetime-local">` 空值时的分段文字由 WebView 语言渲染（会出现 `yyyy/mm/日 --:--` 这类混排），无法用属性或 `lang` 覆盖。统一包一层 `DateField`（`common/components/date-field.tsx`）：空且未聚焦时藏掉原生分段、显示自绘的「年/月/日」（日期时间控件为「年/月/日 时:分」），聚焦后交还原生分段编辑，原生日历/时间选择器保留。时间精度保持到分钟。

## 3. 后端

### 3.1 分层与依赖方向

```
commands.rs     ← 薄 IPC 壳，参数校验 + 调用 service
   ↓
services.rs     ← 业务规则、编排、事务边界
   ↓
repositories.rs ← 唯一写 SQL 的层，映射 rows → models
   ↓
models.rs / db.rs / sort.rs ← 类型定义 / 连接与迁移 / 排序键工具

scheduler.rs    ← 后台提醒线程：定时调用 services::scan_reminders，
                  把新触发的提醒以 `reminder:triggered` 事件广播给前端
tray.rs         ← 系统托盘
shortcut.rs     ← 全局快捷键 + quick-add 小窗生命周期
perf.rs         ← 性能验收（Q-01）：进程起点计时、前端上报的接收与打印、验收数据集
```

- 单向向下：`commands → services → repositories → (models, db)`；`scheduler → services`（不经 commands）。
- 禁止跨层反向依赖；`models` 是被依赖的叶子层，不含 SQL 或业务逻辑。
- `repositories` 用**纯函数**接受 `&Connection`（而非 trait），测试时用 in-memory SQLite + 真实迁移，比 mock 更可信。不引入 repository trait 抽象。
- 模块可见性：`models`、`repositories`、`services`、`sort` 是 `pub mod`（供集成测试与库消费），`commands`/`db`/`error`/`scheduler`/`shortcut`/`tray`/`perf` 私有。

### 3.2 命令面

命令统一放在 `commands.rs`，命名 `<domain>:<action>`，Rust 侧用 `#[tauri::command(rename = "task:list")]` 注册（函数名保持合法标识符如 `task_list`）；参数键为 camelCase（Tauri 2 默认，`task_id` → `taskId`）。前端字符串常量集中在 `src/common/ipc/commands.ts`，避免散落魔法字符串。

后端**实际注册 45 个命令**（`lib.rs` 的 `invoke_handler`）：

| 域 | 命令 |
| --- | --- |
| task | `list` `listByProject` `create` `update` `complete` `softDelete` `restore` `reorder` |
| dependency | `listAll` `add` `remove` |
| tag | `list` `create` `update` `delete` |
| project | `list` `unfinishedCounts` `create` `update` `archive` `restore` |
| namespace | `list` `create` `update` `archive` `restore` |
| board | `listColumns` `moveTask` |
| search | `query` |
| comment | `list` `create` `update` `delete` |
| time | `list` `create` `update` `delete` `start` `stop` |
| stats | `trend` `projectProgress` `timeDistribution` |
| backup | `export` `import` |
| perf | `ready` |

约定：每个命令返回 `Result<T, AppError>`；**任何返回任务行的命令都返回 `TaskWithTags`**（`Task` 字段打平在顶层 + 一个 `tagIds` 键），前端无条件读 `tagIds`，所以没有哪个写路径可以只回裸行。`board:listColumns` 对不存在的项目返回空数组（不报错），`comment:list` / `time:list` 也不校验任务存在。

**设置项不在命令面上**：`settings` 表只被 `backup:export/import` 读写，没有 `settings:*` 命令——主题这类设置由前端自己持有。前端 `COMMANDS` 常量与后端注册的命令一一对应（45 个）。

`project:unfinishedCounts` 一次给出**每个存活项目**（含归档）未完成顶层任务的个数，供侧边栏项目行的展开箭头判断「还有没有未完成项」；它刻意不复用 `stats:projectProgress`——后者是统计页的口径，跳过归档项目。

`task:listByProject` 返回 `TaskPage`：`rows` + 该带的 `children` + 范围外的父 `related` + 每行的未完成前置计数 `blocked`。项目范围**不分页**——项目详情的工具栏筛选与排序作用在整个项目上，与它此前自己过滤全量快照时的行为一致。

`task:reorder` 与 `board:moveTask` 返回 `{ moved, rebalanced }`：被移动的行 + 被重写的排序键。键耗尽触发的重排会重写整个范围，所以那些行必须回给调用方；普通路径下 `rebalanced` 是空数组，一次索引 seek 就够（旧实现回整个兄弟范围，载荷随范围大小增长）。

`perf:ready` 是唯一一个**不返回 `Result`、也不碰数据库**的命令：前端把启动与命令耗时交回来，后端在 `ORDO_PERF=1` 时打到 stdout（见 §6.1）。没有它，应用自己就不知道「首屏可交互」是哪一刻。

**事件面**（反向通道，常量在 `src/common/ipc/events.ts`）：

| 事件 | 方向 | 载荷 |
| --- | --- | --- |
| `reminder:triggered` | Rust → 全部窗口（广播） | `Reminder`（`taskId` / `taskTitle` / `kind` / `dueAt`） |
| `quick-add:open` | Rust → quick-add 窗（定向） | 无；唤起时复位输入行与控件 |
| `task:created` | quick-add 窗 → 主窗 | 无；主窗据此 `reloadTasks()` |

### 3.3 状态与事务

- SQLite 连接由 `db::Db = Arc<Mutex<Connection>>` 作为 Tauri 托管状态共享；`Mutex` 串行化写，`Arc` 让后台提醒线程与命令处理器共享同一连接——**所有 IPC 与调度线程都在这一个锁上排队**。
- 数据库文件位置：`app_data_dir()/ordo.db`（`lib.rs::db_path`，目录不存在则创建）；环境变量 `ORDO_DB` 可以覆盖这个路径（Q-01 验收用它指向预置的验收库，不碰用户自己的数据）。
- 迁移在 `db.rs` 用 `refinery::embed_migrations!` 内嵌 `src-tauri/migrations/*.sql`，连接建立时执行；`db.rs` 同时断言外键确实处于启用状态。
- 多步写操作（创建任务 + 关联标签 + 插入子任务行、看板移动、备份导入、级联软删/恢复等）在 `services` 层用 `unchecked_transaction` 包裹，保证原子性。
- 时间戳与 UUID 统一在**后端生成**（`chrono` / `uuid`），前端不生成主键；同一次操作里的多行写入共用同一个 `now`。
- 排序键由 `sort.rs` 统一生成（fractional indexing）：键为 `'a'..'z'` 字符串，提供 `first` / `before` / `after` / `between` / `spread`；单键长度上限 `MAX_SORT_KEY_LEN = 32`，超过即用 `spread` 对**同范围的兄弟行**整体重排。前端只传「目标前驱/后继键」，保证算法一致。

### 3.4 错误处理

- 统一 `AppError`（`error.rs`），变体为 `Database`（rusqlite）/ `Migration`（refinery，仅启动期）/ `Db(String)`（连接锁失效）/ `Io` / `Validation(String)` / `NotFound(String)`，序列化为 `{ code, message }`，code 为 snake_case。
- 前端 `common/ipc/errors.ts` 的白名单与之一致（`database` / `migration` / `db` / `io` / `validation` / `not_found`，另加本地兜底的 `unknown`）；未知 code 一律归一化为 `unknown` 并配兜底文案。
- 排序键相关错误（`sort::SortError`）经 `From` 转换并入 `Validation`。
- 错误向上传播，`commands` 层不做吞错；校验文案是面向用户的中文（如「标题不能为空」「子任务下不能再挂子任务：层级只有一层」）。

### 3.5 后台调度（提醒）

`scheduler.rs` 在 `setup` 阶段以独立线程 `"reminders"` 运行：**先睡 30 秒再扫**（启动时不立刻扫），每轮为一次事务，锁中毒则跳过本轮，扫描出错只 `eprintln` 不退出。它直接调用 `services`（不经过 commands）。

系统通知由 Rust 侧经 `tauri-plugin-notification` 直接发送（标题固定「Ordo 任务提醒」，正文按提醒类型给出到期文案，时间按本地时区格式化），不经 webview，因此托盘/隐藏状态下一样可达；发送失败只记日志，前端事件照发。去重标记持久化在 `task_reminders` 表，跨扫描与重启不重复。候选窗口、三种提醒的触发条件与宽限规则见 [DATA.md](./DATA.md)§3.3。

### 3.6 桌面集成

| 部件 | 实现 |
| --- | --- |
| **系统托盘**（`tray.rs`） | Tauri 核心 Tray API（`tauri` crate 必须开启 `tray-icon` feature）；左键单击切换主窗口显示/隐藏，右键弹菜单「显示主窗口 / 隐藏主窗口 / 退出 Ordo」（`show_menu_on_left_click(false)`）；托盘图标复用打包图标（`default_window_icon()`，缺失时不设置以免托盘不可见） |
| **关闭即驻留** | `lib.rs` 的 `on_window_event` 拦截**任意窗口**的 `CloseRequested`（`api.prevent_close()` + `hide()`），只有托盘菜单「退出」调 `app.exit(0)` 才真正结束进程 |
| **全局快捷键**（`shortcut.rs`） | `tauri-plugin-global-shortcut` 注册**一个**应用级快捷键（macOS `⌘⇧Space`、其他平台 `Ctrl+Shift+Space`），只在按键按下时触发；注册在 Rust 侧，所以不需要 `global-shortcut:*` capability；`Shortcut` 的相等比较包含自增 id，handler 用 `OnceLock` 记忆化以保证与注册时是同一个实例；被其他应用占用时只记日志、不影响启动 |
| **quick-add 小窗** | 560×164、无边框、不可缩放、置顶、不进任务栏的独立窗口，载入应用自己的 `index.html`（与主窗口同一页面），在 setup 阶段建好并长期隐藏，因此按下即出、没有 webview 冷启动；show + `set_focus` 之后向该窗口定向 `emit_to` 一个 `quick-add:open` 事件——`autofocus` 只在页面加载时生效，而这个页面是在窗口还隐藏时加载的，聚焦必须由事件驱动；该事件同时把输入行与控件复位并重拉一次项目列表（快捷窗有自己的 store，主窗里新建或归档的项目它看不到） |
| **点走即隐** | 非主窗口的 quick-add 在 `Focused(false)` 时隐藏（无边框窗口没有关闭按钮可点） |
| **两个窗口的协调** | 两个窗口各有自己的 store，快捷窗创建成功后 `emit("task:created")`，主窗口 `AppShell` 监听后 `reloadTasks()` 重新拉取（整树替换），否则主窗口会一直显示旧列表 |
| **开机自启**（D-04） | `tauri-plugin-autostart` 在 `lib.rs` 注册（默认用 LaunchAgent 写 macOS 登录项；Windows 写 HKCU Run 注册表、Linux 写 XDG autostart），API 由**前端**经 `@tauri-apps/plugin-autostart` 调用（因此需要 `autostart:default`）；OS 登录项列表是唯一事实来源，写入后回读 `isEnabled()` 再更新开关，失败的写让开关停在原处；默认关闭由「Rust 侧没有任何地方主动 enable」保证 |

**窗口 label 契约**：主窗口在 `tauri.conf.json` 里未声明 label，Tauri 因此命名为 `main`；quick-add 的 label 常量在 `shortcut.rs`（`QUICK_ADD_WINDOW`）。`capabilities/default.json` 的 `windows` 数组必须同时列出 `main` 与 `quick-add`，否则小窗会静默失去每一次 IPC 调用。两个窗口加载同一个 `index.html`，`src/index.tsx` 按 label 分流（浏览器里读不到 label 时回落主应用，便于纯 Vite 调试），所以这个字符串在 Rust 与 TypeScript 两处重复，改动必须同步。capability 名由 `tauri-build` 在编译期校验，写错会构建失败。

## 4. 构建与工程约定

### 4.1 脚本与命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` / `pnpm start` | Vite 开发服务器（纯前端，无 Rust 窗口） |
| `pnpm build` | 前端生产构建（`dist/`） |
| `pnpm serve` | 预览构建产物 |
| `pnpm typecheck` | `tsc --noEmit`（`src/` + `tsconfig.node.json` 里的 Vite/Vitest 配置） |
| `pnpm lint` | Biome 检查 `src/`（recommended 规则，不启用格式化；配置在 `biome.json`） |
| `pnpm test` / `pnpm test:watch` | Vitest（单元测试；环境与 setup 由 `vitest.config.ts` 统一提供） |
| `pnpm tauri dev` | 完整应用（跑 `pnpm dev` 后拉起 Rust 窗口） |
| `pnpm tauri build` | 完整发布构建/打包 |
| `pwsh -File scripts/perf-acceptance.ps1` | Q-01 性能验收：构建 + 体积 + 命令往返 + 冷/热启动（`-SkipBuild` 复用产物）；见 §6.1 |
| `cargo check` / `cargo test` / `cargo build` | 在 `src-tauri/` 内执行 |

前端检查用 **Biome**（`pnpm lint`，只跑 lint、不跑格式化）；Rust 侧要求 `cargo fmt`（rustfmt 默认配置）与 `cargo clippy --all-targets -- -D warnings` 都无输出。包管理器固定为 **pnpm**（`tauri.conf.json` 的 `beforeDevCommand`/`beforeBuildCommand` 调用 `pnpm dev`/`pnpm build`）。应用元信息：`productName` / identifier `com.hiss.ordo` / 版本 `0.1.0`；主窗口 1120×740、最小 720×520、居中。安全策略见 `app.security`：`csp` 只放行自身来源（`default-src 'self'`、`script-src 'self'`、`style-src 'self' 'unsafe-inline'`、`connect-src 'self' ipc: http://ipc.localhost`，另加 `object-src 'none'` 与 `base-uri 'self'`）——内联样式是必须的（虚拟列表与 Kobalte 都写 `style` 属性），内联脚本（`index.html` 里的防闪主题小段）由 Tauri 在编译期算好 sha256 自动加进 `script-src`；`devCsp` 额外放行 `'unsafe-inline'` 脚本与 `ws://localhost:1421` 的 HMR 通道。

### 4.2 依赖与版本约束

- **`rusqlite` 锁定在 `0.39`**：`refinery 0.9.2` 要求 `rusqlite <= 0.39`，单独升级会让 `cargo` 在 `libsqlite3-sys` 版本冲突上失败。要升级必须两者一起动。
- `rusqlite` 使用 **bundled** SQLite（含 FTS5），并开启 `chrono` feature 以绑定时间戳参数。
- `tauri` 需要 **`tray-icon`** feature，否则 `tauri::tray` 不存在。
- 前端在用的库：`@kobalte/core`、`lucide-solid`、`date-fns`、`zod`、`@tanstack/solid-router`，以及 `@tauri-apps/api` 与 `plugin-{autostart,dialog,notification,opener}`。
- **不引入**动画库、拖拽库、图表库、UI 组件库——三条都是体积红线的支撑（动效用 CSS/Web Animations，拖拽用原生 Drag API，图表自绘 SVG）。虚拟滚动也是自研。

### 4.3 构建配置

- `vite.config.ts`：插件为 `tailwindcss()` + `solid()`；`clearScreen: false` 以免掩盖 Rust 报错；**端口固定 1420 且 `strictPort: true`**（HMR 1421，远程调试时由 `TAURI_DEV_HOST` 决定）；`server.watch.ignored` 忽略 `**/src-tauri/**`。
- `vitest.config.ts`：`solid({ hot: false })`（避免 Solid refresh runtime 进入测试转换结果后 Node 无法解析），`environment: "node"`。
- `tsconfig.json`：`noEmit` + `allowImportingTsExtensions`，`jsx: "preserve"` + `jsxImportSource: "solid-js"`，`strict` 且 `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch` 全开。
- **Tailwind v4 是 CSS-first**：没有 `tailwind.config.js`、没有 PostCSS 配置，主题在 `src/index.css` 的 `@theme` / `@theme inline` 里定义，插件在 `vite.config.ts` 注册。
- `src-tauri/Cargo.toml` 的 `[lib] name = "ordo_lib"`：`_lib` 后缀在 Windows 上用于避免 lib/bin 同名冲突（cargo issue #8519）。release profile 已开 `lto`、`strip`、`opt-level = 3`、`panic = "abort"`、`codegen-units = 1`。
- `src-tauri/src/main.rs` 的 `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` 用于在 Windows release 构建里抑制控制台窗口，**不可移除**。

### 4.4 能力声明

`src-tauri/capabilities/default.json` 当前授权给 `["main", "quick-add"]`：`autostart:default`、`core:default`、`core:window:allow-hide`、`dialog:default`、`notification:default`、`opener:default`。

新增 Tauri 插件或窗口 API 时必须同步写进该文件，否则前端调用被拒。完全由 Rust 驱动的部件（托盘、全局快捷键注册）不需要条目。`core:window:allow-hide` 是 quick-add 小窗隐藏自己所必需的。

### 4.5 数据与代码约定

- 主键 TEXT UUID v4；时间戳 ISO-8601 UTC 字符串；软删除用可空 `deleted_at`，查询默认过滤 `deleted_at IS NULL`（备份是唯一例外，见 [DATA.md](./DATA.md)§5）。
- 迁移只增不改：新增 `src-tauri/migrations/V<N>__<name>.sql`（N 递增）即被编译期内嵌，**永不修改已应用的迁移**。
- `task:list` 返回的任务对象内嵌 `tagIds`（任务-标签关联的唯一读取路径）；关联写入随 `task:create` / `task:update` 的 `tagIds` 字段。
- 前端字段名与后端 serde 的 camelCase 对齐（`namespaceId`、`parentTaskId`、`dueAt`…）；后端**没有** `deny_unknown_fields`，未知键被静默忽略（这是旧备份可导入的前提）。
- 截止时间存 UTC；「今天/即将到来」的本地日期边界由前端按用户时区算，后端提醒按 UTC 扫描。
- 测试策略：后端 `repositories`/`services` 用 in-memory SQLite + 真实迁移做单测，`sort.rs` 做纯函数单测；前端 store/hooks/工具函数用 Vitest。出口条件是 `cargo test`、`pnpm test`、`pnpm typecheck` 全绿。

## 5. 已知约束与坑

继续开发时必须知道的约束（多数在代码注释里有更详细的说明）：

**Tauri / 进程**

1. `cargo build` 产出的是 **dev 模式**二进制，会加载 `build.devUrl`（`http://localhost:1420`），因此除非 `pnpm dev` 在跑，否则它显示连接错误。要按用户的方式运行请用 `pnpm tauri dev` 或 `pnpm tauri build`。
2. Vite 端口固定 1420 且 `strictPort`，端口被占用会直接失败；它不监听 `src-tauri/` 的变化。
3. 窗口 label 字符串在 Rust 与 TypeScript 两处重复；capability 的 `windows` 数组漏掉某个 label 会让该窗口的 IPC 静默失效。

**前端**

1. **这个项目不是 React。** 文件是 `.tsx` 但 `jsxImportSource` 是 `solid-js`：用 `createSignal`、`render` from `solid-js/web`、`class`（不是 `className`），没有 `useState`/`useEffect`。
2. **回车提交必须带 `!event.isComposing` 守卫**（`QuickAddWindow`、`SubtaskList`、`CommentList`、`TimeTracker`）。这是中文产品：输入法组词时按回车是「上屏」而不是「提交」，少了这个守卫会把半截标题写进库，或把正在编辑的内容提前提交。
3. **Kobalte 的 `Select` 会在挂载时用初始值调一次 `onChange`。** 任何把 `onChange` 当作「用户选了」的逻辑都必须忽略与当前值相同的那次调用，否则光是渲染控件就会记下一个选择。它的 `optionValue` 是选项的身份，返回 `""` 会被读成「未选中」（触发器渲染成空白），要表示「无」请用真实哨兵字符串。
4. **不要用 `class` 去覆盖原语里已有的同类工具类。** Tailwind 按 CSS 源码顺序（而非 class 属性顺序）解决同属性冲突，例如 `.text-muted-foreground` 排在 `.text-danger` 之后、`.bg-surface-hover` 排在 `.bg-danger/12` 之后、`.w-full` 排在 `.w-28` 之后——这些覆盖会静默失效并渲染出错误的颜色或宽度。需要不同外观时给原语加 `variant`（或先删掉原语里冗余的基础类）。
5. **弹窗只有正文滚动**：`Dialog.Content` 是 `overflow-hidden` 的 flex 容器（高度上限 `max-h-[85dvh]`），标题/描述/关闭按钮留在原处，每个弹窗把自己的正文标成 `min-h-0 flex-1 overflow-y-auto`。这条规则写在 `common/components/dialog.tsx` 里，因为 `overflow` 不能由调用方用 `class` 覆盖（Tailwind 按源码顺序解析，`overflow-y-auto` 排在 `overflow-hidden` 之后）。
6. **展开箭头不占父行的列**：可展开的行把箭头放进一个 20px 槽位，并用负外边距把整行向左拉回该槽位的宽度——所以「这一行有没有箭头、展不展开」都不改变它的内容列，只有子项往下缩进一层。槽位恒在（无子项的行留空），同一层的行才始终对齐。
7. **侧边栏每个项目只出现在一处**（分组行 / 根级平铺 / 已归档平铺 / 已归档分组）。改动这几个派生时要一起想清楚，否则项目会重复出现或从导航里消失。

**后端 / 数据**

 1. `rusqlite` 与 `refinery` 互相锁定，禁止单独升级（见 §4.2）。
 2. `Db = Arc<Mutex<Connection>>` 串行化一切数据库访问；提醒调度与统计查询不要长占锁（聚合走索引），避免阻塞交互命令。
 3. **FTS5 是 external-content 表**（按 rowid 记录），所以 `tasks` 表**不能重建**——重建会打散索引并丢掉同步触发器；schema 演进一律用 `ALTER TABLE ADD COLUMN` + 迁移 `INSERT`。软删除行仍留在 FTS 索引里，查询需按 `deleted_at IS NULL` 过滤。
 4. 时间戳一律以 `DateTime` 参数绑定（与写入路径同一编码），不要写字符串字面量：rusqlite 存的是 `YYYY-MM-DD HH:MM:SS.SSS+00:00`，字面量的时区后缀（`Z` vs `+00:00`）会让边界比较错位。
 5. **排序键是按范围的**：顶层任务的兄弟范围是「同一 `column_id` **且** `parent_task_id IS NULL`」，子任务是「同一父任务」。因此 `task:update` 只改 `column_id` **不会**重写排序键（行会带着旧范围的键落进新范围），跨列移动要走 `board:moveTask`。`IS NULL` 谓词是承重的：子任务的 `column_id` 为空，少了它，无列顶层任务会插进子任务的键区间。
 6. **父任务的项目优先**：`task:update` 里显式给了 `projectId` 但同时又重设了 `parentTaskId` 时，`projectId` 被静默忽略（`create` 同理）。改父任务会连带改项目并清空 `column_id`。
 7. `has_children` **把回收站里的子任务也算数**——所以「有子任务的任务不能变成别人的子任务」这条校验不会因为子任务被单独删掉而失效；反过来 `task:restore` 会恢复**全部**带删除戳的子任务，包括用户先前单独删掉的那些。
 8. 统计的查询计划由单测断言（`EXPLAIN QUERY PLAN` 必须是 `SEARCH … USING INDEX`，全表 SCAN 即失败）——改动统计 SQL 或索引时必须同步跑那些测试。索引细节见 [DATA.md](./DATA.md)§4。
 9. 备份的 `version` 是**备份格式版本（当前 4），不是迁移版本（当前 V10）**；两者不要混用。

## 6. 非功能目标的达成手段

| 目标 | 手段 |
| --- | --- |
| UI 现代 | Tailwind `@theme` 统一 Token；Kobalte 自建组件避免「模板感」；深浅主题 |
| 运行流畅（60fps） | 内存 store 免 IPC 往返；长列表虚拟滚动；派生数据用 `createMemo` |
| 动效丝滑 | 仅 `transform`/`opacity`/`scale`/`translate`；150–300ms 自然缓动；`prefers-reduced-motion` 全局兜底 |
| 体积小（<30 MB） | Tauri release 优化（LTO/strip/panic=abort/codegen-units=1）；路由懒加载按需打包；不引重型库（无动画/图表/DnD/UI 库）；图表自绘 SVG；虚拟滚动自研；不打包 Web 字体 |
| 响应快 | 冷启动（全量加载在预算内）；命令往返 <50ms；统计走聚合索引秒级返回；FTS5 全文检索 |
| 三端一致 | 同一份前端代码；全局快捷键与托盘按平台适配（macOS `⌘⇧Space`）；Linux 托盘依赖 appindicator 运行时 |

体积与命令往返已达标、启动耗时未全部达标，实测数字与口径见 §6.1。

### 6.1 性能验收（Q-01）

**跑法**：`pwsh -File scripts/perf-acceptance.ps1`（`-SkipBuild` 复用已有产物）。一条命令按「构建 → 体积 → 命令往返 → 启动」跑完四项，与 [PRODUCT](./PRODUCT.md)§8 的目标值逐项对账，全部量完再一起报结论，有超预算项就以非零码退出。它拒绝在锁屏的会话里跑：锁屏时 Windows 限制窗口创建与 WebView 渲染，启动时间会放大 2–4 倍（本机实测同一份二进制：解锁 730 ms、锁屏 2.2 s）。

**怎么量**：

| 项 | 怎么量 |
| --- | --- |
| 启动 | **应用自己计时**，不用外部秒表——「首屏可交互」只有它自己知道是哪一刻。`perf.rs::mark_start()` 在 `run()` 第一行记下进程起点；`setup` 里四个分界点标出「主 WebView 建好 → DB → 托盘 → 后端就绪」；前端 `common/perf.ts` 记页面时间线（导航起算的 `module` / `shell-mounted` / `interactive`）与每条命令的往返耗时，在首屏可交互时经 `perf:ready` 交回后端；后端在 `ORDO_PERF=1` 时把 `[perf]` 行打到 stdout，脚本重定向收走 |
| 命令往返 | `cargo test --release perf -- --ignored`：在验收库上逐条命令跑 20 轮，每轮把响应 `serde_json::to_string`（跨 IPC 的正是这个字符串），**平均**超预算即失败——单次毛刺在共享机器上不可控，最大值照样打印出来供人判断 |
| 体积 | 直接量 `target/release/bundle` 的产物 |

**验收数据集**：`ORDO_DB` 把库指到 `src-tauri/target/perf/ordo.db`——6 命名空间 / 40 项目 / 60 标签 / 2825 任务行 / 500 依赖边，由 `perf.rs` 的种子测试走真实服务层灌入。启动计时也跑在它上面：空库谁都能过。全程不读不写用户自己的库。

**口径**：

- 「首屏可交互」= 外壳那四笔一次性加载（命名空间 / 项目 / 未完成计数 / 任务树）都落地。更早的 `shell-mounted`（外壳已画出、数据还没到）一并记录，但不作为达标口径。
- 「冷启动」= 构建后第一次启动。它的磁盘缓存取决于此前有没有启动过 WebView2 应用，所以它是冷启动的**下界**，系统重启后的冷启动只会更慢。
- 「热启动」= 同一会话内后续各次的最大值（保守口径）。

**实测记录**（2026-09-16，Windows 11 x64，release 构建，屏幕解锁且机器空闲，两次会话）：

| 项 | 目标 | 实测 |
| --- | --- | --- |
| 冷启动（进程启动 → 首屏可交互） | < 1500 ms | 860 ms（WebView2 运行时缓存已热）/ 1619 ms（该二进制首次启动、运行时缓存冷） |
| 热启动 | < 500 ms | **730–840 ms，未达标**（两次会话：730 / 753 与 821 / 836） |
| 命令往返（最慢一条 `task:list`，2825 行） | < 50 ms | 11.6–16.5 ms；`board:moveTask` 8.0–8.6、`task:create` 8.1–11.8，其余 ≤1 ms |
| 统计查询（三个 `stats:*`） | 秒级 | 0.3–1.1 ms |
| 安装包 | < 30 MB | NSIS 2.8 MB、MSI 3.9 MB（裸二进制 8.1 MB） |

**热启动的 730 ms 花在哪**（一轮明细，进程起点起算）：

| 阶段 | 实测 |
| --- | --- |
| 事件循环 + 主窗口与它的 WebView | 320–440 ms（WebView2 运行时缓存冷时 1068 ms） |
| DB 迁移 + 托盘 | +12 ms |
| quick-add 小窗（第二个 WebView）+ 全局快捷键 | +123 ms |
| 页面：脚本加载 → 外壳挂载 | 再 +175 ms（导航起算 100 → 175 ms） |
| 首屏数据落地（任务 + 标签 + 依赖 + 项目 + 命名空间） | 再 +268 ms（导航起算 → 443 ms） |

**写入路径与规模**（`-Scale` 三档）：

| 命令 | 2825 行 | 11225 行 | 70025 行 | 预算 |
| --- | --- | --- | --- | --- |
| `task:create` | 0.08 ms | 0.09 ms | 0.10 ms | 50 ms |
| `task:reorder` | 0.12 ms | 0.04 ms | 0.04 ms | 50 ms |
| `board:moveTask` | 0.19 ms | 0.08 ms | 0.08 ms | 50 ms |
| `task:list`（整树读，平均） | 15.96 ms | 56.26 ms | 338.72 ms | 50 ms |
| `task:listByProject`（项目范围的读，平均） | 0.69 ms | 1.23 ms | 3.43 ms | 50 ms |
| `project:unfinishedCounts`（每项目未完成顶层行数，平均） | 0.38 ms | 4.51 ms | 12.38 ms | 50 ms |

写入路径三档都是常数级：V10 之前 `task:create` 是 8.11 ms 且随总行数线性涨（排序键要取「兄弟范围内最后一个键」，而那个范围只能靠整表 hydrate 得到），`idx_tasks_scope_sort` 之后是一次索引 seek。`task:list` 仍是整树读，8k 档起超预算——它就是「按范围懒加载」要拆掉的那条命令（[DECISIONS](./DECISIONS.md)§4）。

**规模对启动的影响**（同一份二进制，`ORDO_DB` 指向对应档的验收库）：2825 行首屏 997–1045 ms（Rust 侧 576 ms、页面 634 ms；与上面那次会话的差在机器状态——`webview-main` 这段与本分支代码无关，本次 423 ms、上次 320–338 ms）；70025 行首屏 **3.7 s**（Rust 侧到后端就绪 580 ms，其余全在页面：页面 3296 ms，其中最贵的一笔是整树过 IPC，`task:list` 自报 1491 ms；同一轮 `tag:list` / `dependency:listAll` 各 1623 ms 是排队等这次整树读的时间，不是它们自己的成本——日志里它们印在 `task:list` 上面）。侧边栏的项目行读的是计数聚合而不是任务行，不再为每个项目过滤一遍整表；整树本身仍是这条启动路径上最贵的一笔，所以它同样是按范围懒加载的替换对象。

**两处缺口与可选手段**：热启动超出目标约 1.5–1.7 倍。能省的两处都要付代价——把 quick-add 小窗改成按下快捷键时才建（省约 123 ms，代价是第一次唤出要等 WebView 起来，D-02 特意没这么做），或启动时不拉整棵树（省约 270 ms，与 [DECISIONS](./DECISIONS.md)§1.2「`task:list` 一次带走整棵树」冲突）。两项都没做，理由与缺口记在 [DECISIONS](./DECISIONS.md)§4。

**量的时候避开两个坑**：并行编译时量出的 2.4 s 与锁屏时的 2.2 s 都不是应用的成本（脚本拦得住锁屏，拦不住并行的编译任务）。另外，命令往返那一项量的是服务层 + 响应序列化，**不含 IPC 传输与页面主线程排队**：真机启动那一轮 6 条命令并发、页面同时在挂载外壳，实测每条 53.3–115.3 ms（2825 行档；70025 行档同一轮是 32.6–1623.0 ms）——所以「命令往返 <50 ms」目前的证据是服务层的，含 IPC 的稳态往返还没有单独量过。

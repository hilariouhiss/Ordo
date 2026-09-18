# Ordo 决策记录与编号索引

> 本文回答「**为什么是这样**」：关键决策及其理由、编号含义、系统怎么长成今天这样、还差什么。现状描述在 [PRODUCT.md](./PRODUCT.md) / [ARCHITECTURE.md](./ARCHITECTURE.md) / [DATA.md](./DATA.md)。

## 1. 架构决策（ADR 摘要）

| # | 决策 | 理由 | 否决的备选（原因） |
| --- | --- | --- | --- |
| 1 | 前端内存 store + 乐观更新 | 交互 <50ms、无 IPC 往返卡顿，契合「丝滑」目标 | 按需实时 IPC：实现简单，但每次交互都有延迟，统计/搜索体验差 |
| 2 | Feature-based 目录组织 | 领域边界清晰，随功能增长可维护 | Layer-based：跨领域同层随规模膨胀 |
| 3 | `repositories` 用纯函数而非 trait | 简单够用；in-memory SQLite 测试比 mock 可靠 | trait + mock：首版引入过早（YAGNI） |
| 4 | 看板列存 `board_columns` 表（项目固定三列、只读） | 统计有明确的「完成列」锚点，「进行中」有真实身份可拖拽；列不再增删改名，`is_done` 恒定 | 固定 status 字符串：`column_id` 无处可比对、迁移要重写任务行；可自定义列：与「看板只是任务的另一种展示」冲突，且删列/改完成列会让完成状态失去归宿 |
| 5 | 动效仅 CSS `transform`/`opacity`/`scale`/`translate`，不引动画库 | 体积小、GPU 友好、可控 | 动画库：增加体积，违背 NFR |
| 6 | 主键与时间戳后端生成 | 权威一致，便于未来同步 | 前端生成：多端/同步时易冲突 |
| 7 | 排序用字典序字符串键（fractional indexing） | 任意位置插入无需重排已有行，拖拽持久化成本 O(1) | 见 §1.1 |
| 8 | **子任务并入 `tasks`（单层自引用）** | 子任务与任务的列几乎重合，独立表却要各自一套命令、依赖边、提醒标记与前端缓存；合并后「子任务就是任务行」，标签/评论/计时/依赖全部自然可用 | 保留独立 `subtasks` 表：每加一个任务能力都要在两处实现；「复制 + 软删」模拟层级：会丢掉标签/评论/计时等关联 |
| 9 | **看板即视图**（看板不持有任务） | 同一个任务在列表与看板上必须只有一处归属；分列由完成状态 + `column_id` 派生，三条完成路径（列表勾选、详情完成、拖进完成列）结果一致 | 看板持有独立卡片集合：任务会「没被拖过就从看板上消失」，且完成状态有两个真相 |
| 10 | 依赖是**软阻塞** | 后端不阻止完成，前端从边集派生「还差几项」并只确认一次——用户始终能完成自己想完成的事 | 后端硬阻止：用户被工具挡住，且离线场景没有合理的绕过路径 |
| 11 | 依赖边**随端点软删而休眠**，不做补偿写入 | 「软删前置 ⇒ 自动解锁，恢复前置 ⇒ 依赖回来」由查询谓词天然成立，没有恢复时重建关系的窗口 | 删除时同步删边：恢复端点就要重建，多一条会失败的状态迁移 |
| 12 | 提醒去重标记**持久化**在 `task_reminders` | 跨扫描与重启都不重发；软删/已完成由扫描谓词过滤，标记留着即可 | 内存去重：重启后重发一遍 |
| 13 | 命名空间用**可空外键**而非连接表 | 「一个项目至多归属一个」用连接表只会多一张表、一个索引和第二条写路径 | 连接表：为「至多一个」的关系买了「多对多」的复杂度 |
| 14 | 侧边栏归属用**存活命名空间集合**判定 | 命名空间被删时其项目回落为「未归属」而不是从导航里消失——导航不该因为一个容器消失而丢内容 | 判 `namespaceId != null`：软删命名空间后其项目会变成不可达的孤儿 |
| 15 | 备份是数据库的**副本**，不过滤软删、导入整体替换 | 「恢复出来的东西和你导出时一模一样」是备份唯一说得清的语义 | 备份成视图（只导存活行）：软删除的历史就永久丢了；增量导入：需要一个没人会维护的合并算法 |
| 16 | 快捷输入的日期**必须带 `#`** | 显式标记换来确定性：「月底前完成报表」不会被静默改写成「前完成报表」 | 裸日期词识别：中文标题里「明天」「月底」太常见，误删标题的代价远大于多敲一个 `#` |
| 17 | 原生日期控件 + 自绘占位（`DateField`），不换控件 | 保留平台原生日历/时间选择器；只把 WebView 无法覆盖的空值分段文案藏起来 | 自研日期选择器：等于重写一个日历，还得自己处理键盘与无障碍 |
| 18 | 图表自绘 SVG | 体积红线（<30 MB）；三个图表的复杂度不值得一个图表库 | 图表库：单一用途却要付几十到几百 KB |
| 19 | `lib` 名带 `_lib` 后缀（`ordo_lib`） | Windows 上避免 lib/bin 同名冲突（cargo issue #8519） | 同名：Windows 构建失败 |
| 20 | 性能验收**由应用自测**（进程起点计时 + 逐条命令计时 + 前端上报） | 「首屏可交互」只有应用自己知道是哪一刻；顺带把每次命令往返都量到，不依赖外部秒表或 WebDriver | 外部秒表/截图比对：量不到「可交互」，只能量到窗口出现；tauri-driver 端到端：要引入一套驱动与用例，成本远超四条目标值 |

### 1.1 排序算法选型（行业调研结论）

业界主流方案收敛为两种：

- **fractional indexing**（Figma 采用：任意精度分数 + 字符串平均取中间值；Replicache 的 `fractional-indexing` 库用 base62 变长整数）
- **LexoRank**（Jira/Atlassian 采用：带 bucket 的分段 rank，为多用户并发写与 rank 过长时重平衡设计）

**取舍：采用 fractional indexing，否决 LexoRank。** LexoRank 的 bucket/重平衡机制服务于多用户并发编辑与长 rank 治理，对 Ordo 的单用户、本地、离线场景是过度设计；fractional indexing 更简单、单次插入只改一行、无 bucket 状态。实现以 Replicache 的语义为参考（`between(a,b)` 生成中间键、首键生成、键耗尽时局部重排），由 Rust 后端自研约 50 行工具函数（`sort.rs`），不引入额外依赖。

### 1.2 数据层与 UI 的边界

- **`task:list` 一次性带走整棵树**（含子任务）：列表要在折叠状态下显示「谁有子任务、做完几项」，逐行懒加载会变成 N 次 IPC；层级只有一层，一次全表查询就能带走整棵树。
- **`all` 快照在启动与中途刷新时整表替换，项目范围按需装载一次**：`task:list` 在启动与 `reloadTasks` 各整表替换一次 `byId`，`project:<id>` 范围则由项目页/看板挂载时的 `ensureScope` 装一次。范围里存的是 id、行只在 `byId` 里有一份，所以刷新替换的就是那张表——没有第二份派生缓存需要防覆盖；项目范围的成员关系由行的 `projectId` 逐字段维护（新建、改项目、删除把行搬进搬出已装载的范围，`setAll` 则在刷新时按快照重新派生已装载范围的 id 列表）。
- **`tagIds` 跟着每个返回任务行的命令一起回**：任务-标签关联没有独立读取命令，一个往返就能筛标签，也避免「新建后立刻编辑」时 store 里那一行缺 `tagIds`。
- **阻塞状态不进 store**：它是边集的派生量，随渲染轮次一次算清，行组件不查图。

## 2. 编号索引

代码注释与提交历史里用这些编号当简写。**它们指向的施工台账（里程碑任务表、变更需求单、实施计划）已随本次文档整合删除**，所以下表就是这些编号的定义与最终状态；遇到 `TODO(BV-02)` 之类的注释，查这里。

### 2.1 里程碑任务

| 编号 | 内容 | 状态 / 现在的落点 |
| --- | --- | --- |
| **F-01** | 设计 Token 与主题 | 已落地 → [ARCHITECTURE](./ARCHITECTURE.md)§2.6、`src/index.css` |
| **F-02** | 路由与 AppShell | 已落地 → [ARCHITECTURE](./ARCHITECTURE.md)§2.5、`src/router.tsx` |
| **F-03** | 通用组件库 | 已落地 → `src/common/components/` |
| **F-04** | IPC 封装与错误归一化 | 已落地 → [ARCHITECTURE](./ARCHITECTURE.md)§3.4、`src/common/ipc/` |
| **F-05** | Schema 迁移 V2 | 已落地 → [DATA](./DATA.md)§3 |
| **F-06** | 后端模型与枚举 | 已落地 → [DATA](./DATA.md)§2 |
| **F-07** | 错误类型扩展 | 已落地 → `src-tauri/src/error.rs` |
| **F-08** | 排序键工具 | 已落地 → `src-tauri/src/sort.rs` |
| **T-01** | 任务/标签/子任务仓储 | 已落地（子任务部分已被 TH-01 取代） |
| **T-02** | 任务/标签服务与命令 | 已落地 |
| **T-03** | 任务前端数据层 | 已落地（TH-03 之后以任务树为准） |
| **T-04** | 任务编辑器 | 已落地 |
| **T-05** | 四个任务视图 | 已落地 → `features/tasks/components/views/` |
| **T-06** | 子任务 UI | 已落地（T-06b / TH-04 扩充） |
| **T-06b** | 任务列表层级展示 | 已落地 → 现在的「规则 A」渲染 |
| **T-07** | 标签与优先级 UI | 已落地 |
| **T-08** | 任务/子任务属性扩展 | 已落地 → V4 迁移、`complexity.ts`、`SubtaskEditor`（后由 TH-04 改为走任务编辑器） |
| **T-09** | 依赖与完成顺序（含子任务提醒） | 已落地 → `dependencies.ts`、`blocked-confirm.ts` |
| **P-01** | 项目/看板列仓储 | 已落地（列的写路径已由 BV-01 退役） |
| **P-02** | 项目/看板服务与命令 | 已落地 |
| **P-03** | 项目前端数据层 | 已落地 |
| **P-04** | 项目列表视图 | 已落地 |
| **P-05** | 看板视图与拖拽 | 已落地；「看板即视图」的分列规则见 BV-01 与 [ARCHITECTURE](./ARCHITECTURE.md)§3.2 |
| **S-01** | 全文搜索后端 | 已落地 → [DATA](./DATA.md)§2.3 |
| **S-02** | 搜索视图 | 已落地 |
| **R-01** | 提醒调度服务 | 已落地 → [ARCHITECTURE](./ARCHITECTURE.md)§3.5、[DATA](./DATA.md)§7 |
| **R-02** | 系统通知接入 | 已落地 |
| **RP-01** | 重复任务 | 已落地 → [PRODUCT](./PRODUCT.md)§2.4 |
| **C-01** | 评论 | 已落地 |
| **TE-01** | 时间记录 | 已落地 → [PRODUCT](./PRODUCT.md)§2.8 |
| **ST-01** | 统计聚合命令 | 已落地 → [DATA](./DATA.md)§6 |
| **ST-02** | 图表组件 | 已落地 → `features/stats/components/` |
| **ST-03** | 项目进度视图 | 已落地 → `ProjectProgress`（不再有截止倒计时，见 R2） |
| **D-01** | 系统托盘 | 已落地 → [ARCHITECTURE](./ARCHITECTURE.md)§3.6 |
| **D-02** | 全局快捷键快速添加 | 已落地 → [PRODUCT](./PRODUCT.md)§6.1–6.2 |
| **D-03** | 数据导出/备份 | 已落地 → [DATA](./DATA.md)§5 |
| **D-04** | 开机自启 | 已落地 → [ARCHITECTURE](./ARCHITECTURE.md)§3.6 |
| **NS-01** | 命名空间迁移与模型 | 已落地 → V5、[DATA](./DATA.md)§2.1 |
| **NS-02** | 命名空间后端 | 已落地 |
| **NS-03** | 命名空间前端数据层与编辑器 | 已落地 |
| **NS-04** | 侧边栏分组与命名空间页 | 已落地 → [PRODUCT](./PRODUCT.md)§4 |
| **TH-01** | 任务层级数据层 | 已落地 → V7/V8/V9、[DATA](./DATA.md)§3 |
| **TH-02** | 任务层级后端 | 已落地（七个 `subtask:*` 退役，新增 `task:reorder`） |
| **TH-03** | 任务层级前端数据层 | 已落地（`childrenOf` / `topLevelTasks` / `hasChildren` 取代 `subtasksByTask` 缓存） |
| **TH-04** | 任务层级前端渲染 | 已落地（规则 A、20px 引导槽位契约不变） |
| **TH-05** | 任务层级交互 | 已落地 → R7c 落点、`hierarchy.ts` |
| **TH-06** | 任务层级文档 | 已落地（本次整合后由本文件集承接） |
| **BV-01** | 看板即视图 | 已落地 → `features/board/lanes.ts`、[ARCHITECTURE](./ARCHITECTURE.md)§3.2 |
| **BV-02** | 任务行响应统一带 `tagIds` | 已落地 → `TaskWithTags`、[ARCHITECTURE](./ARCHITECTURE.md)§3.2 |
| **BV-03** | 弹窗头部固定 | 已落地 → `common/components/dialog.tsx`、[ARCHITECTURE](./ARCHITECTURE.md)§5-8 |
| **Q-01** | 性能验收 | 已落地 → [ARCHITECTURE](./ARCHITECTURE.md)§6.1、`scripts/perf-acceptance.ps1`（启动耗时缺口见 §4） |
| **Q-02** | 动效与无障碍复查 | **未完成** —— 见 §4 |
| **Q-03** | 三端兼容验证 | **未完成** —— 见 §4 |
| **Q-04** | 文档同步 | **本次整合即此项** —— 见 §4 |
| **Q-05** | 质量收口 | 已落地 —— 测试全绿；已删除脚手架期的 demo 命令 `greet`、`settings:*` 死常量与占位用例 `src/__tests__/example.test.ts`；根 `README.md` 已补 |
| **Q-06** | 全仓代码审查 | **审查已完成，修复进行中** —— 状态清单见 §4.1 |

### 2.2 变更需求（v1 迭代）

| 编号 | 内容 | 现状 |
| --- | --- | --- |
| **R1** | 子元素统一缩进（由子任务扩展到所有内联子列表） | 已落地 → `child-indent` 工具类，[ARCHITECTURE](./ARCHITECTURE.md)§2.6 |
| **R2** | 项目不设截止日期（整条移除，含 V6 迁移） | 已落地 → [PRODUCT](./PRODUCT.md)§3.1、[DATA](./DATA.md)§3 |
| **R3** | 新建时未指定颜色 → 随机颜色（命名空间/项目/标签） | 已落地 → [PRODUCT](./PRODUCT.md)§2.6。任务没有颜色字段，不涉及 |
| **R4** | 新建命名空间入口改成与项目一致的「标题 ＋」 | 已落地 → [PRODUCT](./PRODUCT.md)§4 |
| **R5** | 新建项目时可顺手新建命名空间 | 已落地 → [PRODUCT](./PRODUCT.md)§4 |
| **R6** | 日期控件空值文案统一为「年/月/日 时:分」 | 已落地 → `common/components/date-field.tsx`，[ARCHITECTURE](./ARCHITECTURE.md)§2.6 |
| **R7** | 拖拽（长按）调整归属，见 R7a/R7b/R7c | 已落地 |
| **R7a** | 拖拽：项目 → 命名空间 | 已落地 → `project:update { namespaceId }` |
| **R7b** | 拖拽：任务 → 项目 | 已落地 → 拖到侧边栏项目行 = 移进该项目**并脱离父任务** |
| **R7c** | 拖拽：任务 → 任务（变成其子任务） | 已落地 → 真层级字段 `tasks.parent_task_id`（不是「复制 + 软删」）。本期最大的一次数据模型重构，见 §3 |
| **R8** | 展开箭头不再把父行推到子项那一列 | 已落地 → 20px 槽位 + 负外边距，[ARCHITECTURE](./ARCHITECTURE.md)§5-9 |
| **R9** | 侧边栏项目行可展开，列出未完成任务 | 已落地 → 项目行的展开箭头 + 顶层未完成任务列表 |

### 2.3 迁移

`V1`–`V10` 逐条的定义与理由见 [DATA.md](./DATA.md)§3（V 编号**只**指数据库迁移，与里程碑无关）。注意：**备份格式版本（当前 4）不是迁移版本（当前 V10）**。

### 2.4 其它约定编号

| 名称 | 含义 |
| --- | --- |
| **规则 A** | 子任务在任务视图里的呈现规则：父任务在同视图结果里则子任务渲染在父行之下（自动展开、不重复成行）；父任务不在结果里则子任务独立成行并带「父任务 · X」前缀。筛选与排序只作用于独立成行的任务。定义见 [PRODUCT](./PRODUCT.md)§2.3 |
| **层级只有一层** | 子任务不能有子任务；已经有子任务（含回收站里的）的任务不能再变成别人的子任务 |

### 2.5 遗留的 `§` 引用（已知悬空）

约 32 个源文件的注释里写着 `§8.5`、`§9.3`、`plan §3`、`ARCHITECTURE §3.2` 这类节号引用。它们指向的文档已随本次整合删除，对照关系如下：

| 注释里的写法 | 原本指向 | 现在读 |
| --- | --- | --- |
| `§6.3`、`§7.4`、`§7.5`、`§8.4`–`§8.7`、`§9.1`–`§9.5` | 任务层级设计稿（`docs/superpowers/specs/2026-09-15-task-hierarchy-design.md`） | [PRODUCT](./PRODUCT.md)§2.2–2.3 / §2.7、[ARCHITECTURE](./ARCHITECTURE.md)§2.4、§3.2、§5 | 
| `§5.3`、`§5.5` | 命名空间设计稿（`docs/superpowers/specs/2026-09-15-namespaces-design.md`） | [PRODUCT](./PRODUCT.md)§4.1 |
| `plan §3` | 实施计划的「全局实施约定」 | [ARCHITECTURE](./ARCHITECTURE.md)§2.4、§4.5 |
| `ARCHITECTURE §3.2`、`§2.2` | 本文档集的上一版 | [ARCHITECTURE](./ARCHITECTURE.md)§3.2、§2.3 |

清理这些注释属于代码改动，未在本次文档整合范围内，见 §4。

## 3. 系统是怎么长成现在这样的

按时间顺序，只记**改变了系统形状**的那几步：

1. **M0–M7：v1 主体。** 前后端脚手架、设计 Token、路由壳、组件库、IPC 层与完整 schema（V2）→ 任务域与四个视图 → 项目与看板 → 搜索与提醒 → 重复/评论/时间记录 → 统计 → 托盘/快捷键/备份/自启。此时子任务是独立表 `subtasks`。
2. **M8：属性与依赖（V4）。** 任务补 `complexity`，子任务补 `note`/`priority`/`due_at`/`complexity`；依赖用两张连接表表示（任务级与子任务级各一张）；子任务提醒有自己的标记表。软阻塞（完成前确认一次）在这一步定型。
3. **M9：命名空间（V5）。** 项目获得可空 `namespace_id`；侧边栏长出分组树；归属判定改用存活命名空间集合。
4. **R2：项目失去截止日期（V6）。** 截止被确认为「任务」的属性，项目只是容器。
5. **R1/R3/R4/R5/R6/R8/R9：交互与一致性打磨。** 统一子项缩进、随机默认色、命名空间入口对齐、弹窗内联建命名空间、日期控件空值文案、展开箭头不占父行列、项目行可展开。
6. **R7a/R7b：拖放调整归属。** 原生 Drag API + 一个共享拖拽状态；项目行既是拖源也是落点。
7. **M10 / R7c：任务层级（V7/V8/V9）。** 本期最大的一次重构：`subtasks` 并入 `tasks`，成为单层自引用；七个 `subtask:*` 命令退役、新增 `task:reorder`；依赖边与提醒标记各合并成一张表；V8 清掉搬迁产生的孤儿；V9 补上「顶层任务 + 时间范围」的复合索引。落地决策四条：**规则 A 行内分组**、**完成父任务不级联**、**子任务独立提醒**、**拖到项目行 = 移出父任务并移进项目**。
8. **M11：看板即视图与命令面收敛。** 看板不再持有任务，改成按完成状态与 `column_id` 分列（`lanes.ts` 纯函数）；删掉增删改名与 `is_done` 切换入口；所有返回任务行的命令统一带 `tagIds`；弹窗标题不再被滚走。

## 4. 未完成项与已知缺口

| 项 | 内容 | 影响 |
| --- | --- | --- |
| **Q-02 动效与无障碍** | 全量动效合规复查、键盘可达性复查未做 | 动效与可达性目前是设计约束而非已验证事实 |
| **启动耗时未全部达标**（Q-01 验收留下） | 热启动 730–840 ms（目标 0.5 s）；WebView2 运行时缓存冷时冷启动 1619 ms（目标 1.5 s）。构成见 [ARCHITECTURE](./ARCHITECTURE.md)§6.1：WebView2 与窗口 320–1068 ms、页面加载与挂载约 175 ms、首屏数据约 270 ms、quick-add 小窗约 123 ms | 体感是「点图标到看见自己的任务」约 0.7–0.8 s。省时间的两条路都与既有决策冲突——预热小窗是 D-02 有意为之、启动拉整棵树是 §1.2 的取舍——要动就得先推翻那两条 |
| **Q-03 三端兼容** | Windows/macOS/Linux 的快捷键、托盘、通知、路径行为未逐一验证（Linux 托盘依赖 appindicator 运行时） | 三端一致性未验证 |
| **Q-04 文档同步** | 本次整合完成了主体：文档集改为描述现状并与代码对齐 | 后续仍需按 [README](./README.md)§5 的规则维护 |
| **任务数据仍在启动时全量加载** | `task:list` 一次带走整棵树（§1.2 的取舍）：8k 档起超 50 ms 预算（56 ms），70k 行 339 ms；前端首屏 3.7 s（70k 行：Rust 侧到后端就绪 580 ms，其余全在页面，最贵的一笔是整树过 IPC）。写入路径已不随规模涨（三档 0.08–0.10 ms）。项目详情与看板已改为按项目范围取（`task:listByProject`）；侧边栏的展开箭头与命名空间页的数字已不读快照（分别用 `project:unfinishedCounts` 与 `stats:projectProgress`；外壳仍为四个视图载入快照，侧边栏的拖放也还按 `getTask` 在快照里查行）；启动路径与四个视图仍读 `task:list` | 「按范围懒加载」是已定的方向（命令面、store 形状、迁移顺序已定稿）；在那之前 5 万行的库首屏在秒级（11225 行与 70025 行两档实测之间的外推）、超出 1.5 s 的冷启动目标 |
| **注释里的 `§` 引用悬空** | 约 32 个源文件引用已删除文档的节号，对照表见 §2.5 | 阅读注释时需回本文档查表 |
| **备份遗留键 `subtasks`** | 导出永远写空数组，只为让 pre-V7 文档有落点；`LegacySubtask` 类型同样只服务导入 | 兼容性保留，不是缺陷；等不再需要支持 pre-V7 备份时可删 |
| **悬浮快速入口** | 产品范围里的 P2 能力，未实现（v1 快速入口只有全局快捷键小窗） | 范围外 |
| **Q-06 审查发现** | 全仓代码审查发现 23 项（无 Critical；1 高、9 中、13 低），逐项一句话描述、解决状态与修复方向见 §4.1 | 已修 21 项（QA-01–20、23）；QA-21/22 评估后不修（知悉项）。静态检查与测试全绿，无数据风险 |

### 4.1 Q-06 审查发现清单（2026-09-18）

审查覆盖后端全部模块（`services.rs`/`repositories.rs`/`db.rs`/`scheduler.rs`/`sort.rs` 等精读）、前端 `app`/`features/tasks`/`common` 精读与其余 feature、构建配置与迁移；当日 `cargo clippy --all-targets -- -D warnings`、`cargo fmt --check`、`cargo test`（169 项）、`tsc --noEmit`、`vitest`（542 项）全绿。未发现 Critical：无数据损坏路径、无注入面（FTS 引号转义、LIKE 通配符转义、搜索摘要按段落渲染而非 `innerHTML` 均已核）。`QA-xx` 编号只在本清单内使用，不进源码注释。

| 编号 | 级别 | 一句话描述 | 是否解决 | 位置 | 问题与修复方向 |
| --- | --- | --- | --- | --- | --- |
| QA-01 | 高 | 窗口拉高后虚拟列表新暴露区域空白，滚动后才恢复 | **已解决**（68b77a8） | `src/common/components/virtual-list.tsx` | `onMount` 挂 `ResizeObserver`，回调复用 `handleScroll` 重采样几何，`onCleanup` 断开；回归测试以记录型 stub 手动派发 resize |
| QA-02 | 中 | 「今天」冻结在挂载时刻，跨天后视图不刷新 | **已解决** | `src/common/clock.ts`、`TodayView.tsx` 等五个调用点 | 新增 `createNow()`：分钟 tick + `focus` 重算，`onCleanup` 随组件释放；五个冻结的 `now` 信号与 `SubtaskList` 的渲染期 `new Date()` 全部改读它，今天/未来视图的日界与逾期徽标随之刷新 |
| QA-03 | 中 | 看板切换项目后，前项目的失败响应给当前项目盖错误页 | **已解决** | `features/board/components/BoardView.tsx` | 请求序号守卫：切换项目即作废在途请求（新项目有缓存不发请求时也作废），只有仍是当前项目的那次响应能写 `failed` |
| QA-04 | 中 | 统计粒度切换时图表归零一拍 | **已解决** | `features/stats/hooks.ts`、`StatsView.tsx` | 一份 range 的答案整体存储（`keys`/`days` 与 points 同一次 `setAnswer` 落地），视图改读 `stats.keys()/days()` 而不是按当前 range 现算，切换期间旧图与旧轴同屏 |
| QA-05 | 中 | 乐观更新的整行回滚会覆盖同行的并发成功写 | **已解决** | `src/common/optimistic.ts` + 12 个字段补丁调用点 | 新增 `patchRollback`：只快照本次写入会碰的字段，且在**写入前**捕获（store 是就地修改，写在回滚闭包里会读回乐观值）；任务/标签/评论/时间记录/看板移动/项目/命名空间的字段补丁全部改用它 |
| QA-06 | 中 | 乐观脚手架三份逐字拷贝，projects/namespaces 约 90% 重复 | **已解决** | `src/common/crud-hooks.ts`、`tasks/board/settings/hooks.ts`、`projects/namespaces/hooks.ts` | tasks/board/settings 里三份逐字的 `optimistic`/`reportFailure`/`missingEntity`/`nextTempId` 删掉改从 `common/optimistic` 导入（临时 id 只有一个计数器，跨域唯一性重新成立）；projects 与 namespaces 的 CRUD 流程抽成 `createCrud` 工厂（load/create/update/archive/restore + 写入前捕获的字段级回滚），两边各剩一份「行形状 + 命令名」接线 |
| QA-07 | 中 | 任意 store 变更导致全部可见任务行销毁重建 | **已解决** | `features/tasks/components/TaskListView.tsx` + `common/components/virtual-list.tsx` | 两层都按引用键控：`rows()` 按 task id 记忆化包装对象（同任务 + 派生数字相同才复用），`VirtualList` 复用同一个槽位的 `{item,index}` 包装；行内下拉菜单与焦点不再被重建 |
| QA-08 | 中 | 恢复成功但重载失败被误报为导入失败 | **已解决** | `features/settings/hooks.ts` | 导入与重载拆成两段：恢复已落库就不再走导入的失败分支，重载失败另报（并提示重开应用），`runImport` 仍返回摘要，页面照样显示恢复结果 |
| QA-09 | 中 | 恢复任务后依赖边不刷新，阻塞状态陈旧 | **已解决** | `features/tasks/hooks.ts` | `dependency:listAll` 只返回两端都存活的边，所以任务在回收站期间该边不在任何快照里；`restoreTask` 的刷新由 `reloadTasks` 改为 `loadAll`，把被唤醒的边一起取回 |
| QA-10 | 中 | vitest 样板散落 34 个测试文件，全仓无 linter | **已解决** | `vitest.config.ts`、`biome.json`、`tsconfig.node.json`、`package.json` | 环境注记（35 处）与 setup 手动导入（32 处）删掉：`vitest.config.ts` 统一 `environment: "jsdom"` + `setupFiles`（纯逻辑测试在 jsdom 下照样跑，全量时间从 80 s 降到 50 s）；引入 Biome（`pnpm lint`，recommended 规则、不启用格式化），当前 0 error / 10 warning（测试里的 `!` 断言），6 处拖放容器按「整行/整卡就是拖源」写了带理由的忽略注释；`vitest.config.ts` 纳入 `tsconfig.node.json` 并由 `pnpm typecheck` 一并检查 |
| QA-11 | 低 | 未显式开启外键 PRAGMA，依赖 bundled 默认值 | **已解决** | `src-tauri/src/db.rs` | `configure()` 显式 `pragma_update(foreign_keys, ON)`，`init` 与 `test_conn` 都过一遍；新增用例先把外键关掉再断言 configure 打开（不靠 linked SQLite 的默认值）。WAL/busy_timeout 评估后不设：全进程一条连接一个锁，没有读写竞争要仲裁，WAL 还会在用户被告知「这就是数据库」的文件旁散出 `-wal`/`-shm` |
| QA-12 | 低 | 服务层不拒绝子任务写 `columnId` 等列一致性缺口 | **已解决** | `src-tauri/src/services.rs`（`update_task`/`create_task_in_tx`） | `update_task` 的列补丁移到父任务判定之后：子任务拿列（含同一补丁里既给父又给列）一律 validation，清列照常；新增 `validate_column` 供创建路径校验「列存在且属于该项目」。四个用例覆盖（子任务写列、同补丁给父给列、清列、跨项目/不存在的列） |
| QA-13 | 低 | 补完成逾期的重复任务会生成已逾期实例 | **已解决**（复议后改为滚动到未来） | `src-tauri/src/services.rs`（`next_due_after`） | 新增 `next_due_after`：先推进一个周期，若仍在过去就继续推进到第一个未来周期点，并返回推进了几个周期；副本子任务按同一周期数推进以保住与父任务的偏移。PRODUCT §2.4 同步改写。未逾期路径仍是「恰好一个周期」（`next_due` 不变，原有钳制用例保留） |
| QA-14 | 低 | 备份导入同步长持主线程与连接锁 | **已解决**（残留见下） | `src-tauri/src/commands.rs`（`backup:*`） | 两个命令改 async，把整库读写放进 `spawn_blocking`（`blocking()` 包装，含 join 失败归一化），大库导入不再占着命令派发线程。**残留**：连接互斥锁仍会让别的命令与提醒扫描排队——SQLite 单写者、单连接是既定形状，要并行得先改成连接池 |
| QA-15 | 低 | 隐藏窗口期间的挂起提醒只保留最后一条 | **已解决** | `features/tasks/reminders.ts` | `pending` 改成队列（`pendingReminders()` 给全量、`pendingReminder()` 给最旧一条），每次 focus 定位队首，其余留下等下一次 focus，不再互相覆盖 |
| QA-16 | 低 | `setUnfinishedCounts` 注释与实现相反 | **已解决**（复核后结论与审查相反） | `features/tasks/store.ts` | 实测：Solid 的 `setState` 对对象值是**逐键合并**，所以是「注释对、实现是合并写」，审查把两者说反了。按审查期望的行为（已删项目的残留计数要消失）改成显式 `reconcile` 整表替换，并加了钉住替换语义的用例；`UNFINISHED_COUNTS_SQL` 本就返回全部存活项目（含 0），替换不会丢掉在屏上的数字 |
| QA-17 | 低 | 启动时 `loadAll` 双发，无在途去重 | **已解决** | `features/tasks/hooks.ts` | 在 `loadAll` 里做在途复用（`inFlightLoadAll`，落地即清），外壳与首个视图共用一笔请求；已落地的那次不缓存，下一次调用仍是真的重载 |
| QA-18 | 低 | 标签用量统计每次全量过滤并排序任务快照 | **已解决** | `features/tasks/components/TagManagerDialog.tsx` | 一个 `createMemo` 建 `Map<tagId, count>`（每行本来要问两次计数），每次 store 变更是 O(n) 而不是 O(tags × n) |
| QA-19 | 低 | 应用级 `listen`/`focus` 监听从不清理 | **已解决** | `app/AppShell.tsx`、`features/tasks/reminders.ts` | `subscribeToReminders()` 改为同步返回 disposer（Tauri 订阅落地前后都处理：已 dispose 就把订阅直接交给 runtime 退订），外壳的两处订阅都用 `onCleanup` 收尾 |
| QA-20 | 低 | CSP 为 null（渲染路径已核安全） | **已解决**（release 产物实测） | `src-tauri/tauri.conf.json` | 加了 `csp` 与 `devCsp`（放行项与理由见 [ARCHITECTURE](./ARCHITECTURE.md)§4.1）。验证方式：`pnpm tauri build --no-bundle` 后带 `ORDO_PERF=1` 起 release 二进制，首屏 699 ms 可交互、六条命令正常往返；反向对照（`csp: "default-src 'none'"` + `dangerousDisableAssetCspModification: true` 重建）下前端一行都没跑起来，证明策略确实生效而不是被 Tauri 的 nonce 注入放过。注意 Windows/WebView2 的 IPC 走 `window.chrome.webview.postMessage` 原生通道，不受 `connect-src` 约束，所以反向对照要连同 `dangerousDisableAssetCspModification` 一起关才有意义 |
| QA-21 | 低 | 连接锁中毒后所有命令永久失败 | 不修（知悉项） | `src-tauri/src/commands.rs`（`with_conn`） | dev 构建下 panic 后需重启；release 的 `panic = "abort"` 使其实际不可达 |
| QA-22 | 低 | 日志仅 `eprintln!`，无分级与落盘 | 不修（知悉项） | 后端全局 | 评估后维持：五处 `eprintln!` 覆盖的是真正需要留痕的失败路径（快捷键注册、通知/事件发送、提醒扫描），`perf.rs` 的 `println!` 是验收输出。单机桌面没有排障需求时引入插件只增加一条能力面；真出现支持请求再上 `tauri-plugin-log` 落盘 |
| QA-23 | 低 | tailwind 依赖分类错误、vitest transform 慢 | **已解决** | `package.json`、`vitest.config.ts` | `@tailwindcss/vite`/`tailwindcss` 移入 `devDependencies`（只参与构建，`pnpm build` 复核）；vitest 开 `fsModuleCache: true`，transform 从占测试耗时约六成降到约五成、全量 80 s → 50 s |

修复顺序建议：QA-02 先行（用户可见且改动小）；其次守卫与错误分流（QA-03/04/08/09）；再去重与渲染热路径（QA-05–07）与工程配套（QA-10）；其余低级别随手修。

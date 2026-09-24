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
- **计时状态走一份全局快照，按行各拉一次 `time:list` 是错的**：任务行右侧的开始/暂停读外壳启动时那一次 `time:running`（全部运行中的记录），`time:start` / `time:stop` 成功后就地维护这份快照。逐行拉会变成一个可见行一次 IPC；而 `timeEntriesByTask` 是按需缓存（详情弹窗才填），拿它当行的依据时，没打开过详情的任务会显示「开始」——一个正在计时的行给出会再点一次的按钮，是按钮在说谎而不是缓存没命中。

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
| **Q-02** | 动效与无障碍复查 | 已落地 → [ARCHITECTURE](./ARCHITECTURE.md)§6.2、`src/common/__tests__/design-constraints.test.ts`（剩余缺口见 §4.2） |
| **Q-03** | 三端兼容验证 | **部分落地** —— Windows 实测 + 三端静态核对，记录见 [ARCHITECTURE](./ARCHITECTURE.md)§6.3；macOS / Linux 真机清单未跑，见 §4.3 |
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
| **R10** | 侧边栏宽度可拖拽调整 | 已落地 → 右缘把手（Pointer Events + 指针捕获，键盘可调、双击复位），192–448px 钳制并持久化到 `ordo.sidebarWidth`；拖拽期间抑制 `width` 过渡，[PRODUCT](./PRODUCT.md)§4、[ARCHITECTURE](./ARCHITECTURE.md)§2.6 |
| **R11** | 命名空间/项目行内 ＋ 快捷新建 | 已落地 → 命名空间行 ＝ 在其中新建项目（预填命名空间），项目行 ＝ 在其中新建任务（预填项目）；悬停/Tab 显现，已归档行不加（行尾留给「恢复」），[PRODUCT](./PRODUCT.md)§4 |
| **R12** | 创建/编辑弹窗打开即聚焦首字段 | 已落地 → 任务/项目/命名空间编辑器的标题或名称输入框；同时抑制 Kobalte 默认聚焦首个可 Tab 元素（关闭按钮），[PRODUCT](./PRODUCT.md)§4 |
| **R13** | 侧边栏行内 ⋯ 更多菜单（编辑、归档、删除） | 已落地 → 存活行行尾覆盖式动作簇 [⋯ 编辑/归档/删除][＋]（贴行右缘、不占行宽：名称独占整行，悬停/Tab/菜单展开时整簇带行底色浮现，悬停高亮跟随整行，隐藏时不接指针事件）；编辑复用详情页弹窗；删除是软删，项目连带其任务与看板列（同一事务），命名空间只删自身（项目按存活集合回落根级）；新增 `project:delete` / `namespace:delete`，[PRODUCT](./PRODUCT.md)§3.4/§4、[ARCHITECTURE](./ARCHITECTURE.md)§3.2 |
| **R14** | 任务行改两行、行内开始/暂停计时；新建任务表单分节两列 | 已落地 → 行高 56 → 72px（`ROW_HEIGHT` 与两个行组件一起改），属性徽标移到标题下的第二行、行尾留计时按钮与 ⋯（新增 `time:running`：一次拉全部运行中的记录，行内不显示读秒），[PRODUCT](./PRODUCT.md)§2.3/§2.8、[ARCHITECTURE](./ARCHITECTURE.md)§3.2；编辑器改为「归属 / 属性 / 时间 / 标签」四组两列 + 优先级分段控件（Kobalte `RadioGroup`，替换原下拉），弹窗 `max-w-xl`，[PRODUCT](./PRODUCT.md)§4 |

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
9. **M12（已被 M13/M14 取代）：黑红主题与「环眼」标志（2026-09）。** 这一步的配色与标志后来都被替换掉了，保留在此只为记录当时的两条结论；下面 M13/M14 说明改成了什么、为什么。原文： 标志从「三条递短的横杠」换成同心环：骨白圆盘被八个缺口切开（工作量单位），中心三个细环统辖它们（虹膜）。配色从冷灰+深青换成暖黑+品牌红，浅色主题一并改成骨白+牛血红。两条原有的设计系统规则在这套配色下不再成立，改法与理由写在 [ARCHITECTURE](./ARCHITECTURE.md)§2.6 与 `src/index.css` 顶部：中性色相改到 25–30，强调色与 `danger` 的距离改由亮度与「不共面」承担——红色就是品牌色，这件事没有色相上的解法。标志的几何与三个颜色在 `logo.svg` / `logo-square.svg` / `AppShell.tsx::BrandMark` 三处重复，由 `app-shell-sidebar.test.tsx` 逐项比对。
10. **M13：标志与应用图标统一成外部提供的原始文件（2026-09）。** 三份标志资源（`logo.svg` / `logo-square.svg` / `logo-icon.svg`）现在是**同一个文件的逐字节副本**——外部提供的描摹稿，由 visioncortex VTracer 从一张 500×500 位图自动描出，201 条路径、约 120 级灰。`logo-icon.svg` 是打包图标集的源（`tauri icon src/assets/logo-icon.svg`，Windows 任务栏与标题栏都读它；这个文件后来改名 `logo-system.svg`，又在 M17 里被删掉——打包图标集现在直接用 `logo.svg`），`logo.svg` 是 favicon，也是侧边栏 `<img>` 真正渲染的那份。三份一致性由 `app-shell-sidebar.test.tsx` 按字节比对。

    **这份文件一个字节都没改。** 走过来的两步弯路记在这里，免得下次再走：先是我把铺满画布的 `#FEFEFE` 底板删掉做透明化——实测环是 `#1A1A1A`，浅色标题栏上 15.5:1、深色标题栏上只有 1.14:1，**透明化等于让图标在 Windows 深色模式下消失**；然后是我按量出来的半径把应用内标志重画成了干净矢量，形状接近但不是同一张图。两处都退回了原始文件。

    两处副作用是有意接受的：`src/assets/*.svg` 从 Biome 的 `files.includes` 里排除——那份美术不许改，而 a11y 规则要求往 SVG 里塞 `<title>`，二者只能选一个；可访问名改由使用处提供（侧边栏那个 wrapper 上有 `role="img"` + `aria-label`，`index.html` 的 favicon 是装饰性的）。另外侧边栏不再用 `bg-primary` 底色（当时因为这份文件自带底板；这份文件后来在 M17 里换成去背景的导出，侧边栏仍然不带底色）。小尺寸实测：32/48/64px 清晰，16px 糊（原始位图同样糊）。
11. **M14：主题从黑红改成黑绿，跟标志一致（2026-09）。** 标志换成「断环 + 绿点」之后（M13），应用主题还是黑红，两者对不上，于是把主题也改成黑绿。深色主题的 `--primary` **直接就是 logo 的绿 `#24C88C`**（`oklch(0.740 0.155 162)`，从图上反解出来的），浅色主题把它压暗到 `#006242` 才读得成正文。

    这一步真正的技术难点是：**绿色占掉了可用的明度区间**。旧方案里强调色和状态色靠明度就能拉开，绿色进来之后做不到——把三个状态色都推离绿色，它们在明度上就会互相撞（实测浅色主题里 warning 和 success 只能做到 1.13）。所以改成**靠色相分开**：danger 32、warning 76、success 128、primary 162，彼此 40° 以上；`success` 特意落在黄绿一端，免得被读成品牌绿。代价是校验脚本里的明度间距门槛被**故意放宽**了，它现在只防"糊成一团"、不提供舒适余量——这一点写在 `index.css` 顶部和校验脚本的注释里，不要把它当成可以随手收紧的门槛。

    另一处取舍：填充面（`--primary` / `--danger-solid`）在两个主题里都配**深色墨**。绿在能读成正文的明度上太亮，配近白墨到不了 4.5；把它压暗到能配白墨，又会牺牲它当正文的对比度。两者方向相反，正文更重要。
13. **M16：图标按主题二选一，托盘跟随主题（2026-09）。** M15 那个透明的"双适配"系统图标**是错的**，而且错在测量上：我当时拿**纯黑**当深色任务栏底色，算出环 3.44:1；真实 Windows 11 深色任务栏是 `#202020`，环 `#004A30` 在那里只有 **1.61:1**、点 `#006242` 只有 2.06:1——**图标其实在，但看不见**，所以报"任务栏图标没有显示"。

    把底色换成真实的 `#f3f3f3` / `#202020` 重算之后结论反了：**没有任何单一颜色能在两种任务栏上都过 3:1**（最好也只到 2.9 左右，而且已经退化成灰色，绿色没了）。所以"一个图标适配两种 chrome"这条路根本不通，只能按主题二选一：

    - `src-tauri/icons/runtime/{light,dark}.rgba`——两版 128×128 原始 RGBA。浅色版深环深绿点（浅 chrome 3.72），深色版浅环中绿点（深 chrome 4.87）。同一个几何、同一个绿，只有环与点的明度不同。
    - `src-tauri/src/icons.rs`——启动时读窗口主题选一个，同时设到主窗、quick-add 小窗和托盘；前端切主题时走 `app:setTheme` 命令再设一次。托盘因此跟随主题（之前完全跟随不了）。
    - **用原始 RGBA 而不是 PNG**：`Image::from_bytes` 需要 tauri 的 `image-png` feature，那会把整个 `image` crate 拉进来，只为两张固定的图。`Image::new` 直接吃解码后的缓冲区，转换在生成图标时做一次。

    剩下的真实限制：**任务栏与标题栏的图标在窗口创建时就定了**，进程运行期间改不了——`set_icon` 会更新窗口图标（标题栏、Alt+Tab），但任务栏那格由 shell 缓存。所以启动那一刻的主题决定了任务栏外观；之后在应用内切换主题，标题栏和托盘会跟着变，任务栏不会，要等下次启动。
14. **M17：应用图标就是各主题的标志本身，深色版是同一批像素换墨色（2026-09；托盘与任务栏改成跟随系统主题见 M18）。** M15 那个透明的"系统图标"（`logo-system.svg`：摘掉底板、把环与点压到中间调）删掉了。窗口 / 任务栏 / 托盘图标现在就是侧边栏渲染的那份标志：`assets/logo.svg`（提供的**去背景**导出）与由它生成的 `assets/logo-dark.svg`。

    标志这一版本身就是去掉背景的：`logo.svg` 不再是 VTracer 从位图描出来的那串路径，而是那份 500×500 RGBA 位图套在导出工具给的 SVG 壳里（`<image xlink:href="data:image/png;base64,…">`，壳的 viewBox 与 transform 原样保留）。墨只有两种：环 `#000000`、点 `#24C68C`，角落 alpha 0。深色版**不是重画**——`scripts/gen-logo-assets.mjs` 把同一批像素里除强调色以外的墨换成 `#EDE6E5` 再编码回同一个壳，所以两版覆盖的像素逐个相同、只有墨色不同；`cargo test --lib icons` 与 `app-shell-sidebar.test.tsx` 都钉住这条，两版喂同一个文件或深色版被重画都会红。

    对比度因此全靠墨色，没有底板可退：黑墨在浅色任务栏（`#f3f3f3`）18.93:1、在深色任务栏（`#202020`）1.29:1——后者正是 M15 那次"图标其实在，但看不见"；骨白墨反过来，13.23:1 / 1.11:1。绿点只有 1.99:1 / 7.40:1，它本来就是点缀，撑住图形的是环。所以仍然按主题二选一，M16 那套机制（启动一次 + `app:setTheme` 一次，主窗、quick-add 小窗、托盘一起设）原样不动；M15 想用"一个图标适配两种 chrome"绕开的那道题，答案其实是"两版都留、按主题换墨"。

    打包图标集（`icons/*.ico|png`，`pnpm tauri icon src/assets/logo.svg`）只能有一份，取浅色版：它是 Explorer / 安装包那份，也是 `icons::apply_current` 跑起来之前的窗口那份；它没有底板，所以在深色 Explorer 里偏弱，这是"一个文件"的固有代价。M16 那条"切换主题后任务栏要等下次启动"的限制不变。
15. **M18：图标按「谁画的那块背景」分成两个主题源（2026-09）。** M16/M17 之后所有图标都由**应用主题**驱动，这在一个组合下是错的：应用选深色、Windows 还是浅色时，托盘和任务栏会拿到骨白墨——浅色托盘上 1.11:1，等于把图标擦掉。分界线的依据是**那块背景是谁画的**：

    - 标题栏那一枚与窗口边框跟页面画在同一块地方 → 跟**应用主题**（`apply_app`：`set_icon` + `set_theme`）。
    - 托盘与任务栏坐在 OS 画的那条栏上 → 跟**系统主题**（`apply_system`：托盘 + Windows 的 `ICON_BIG`）。

    第一版把"系统主题"交给前端读 `prefers-color-scheme`，再用 `app:setTheme` 的两个参数（`theme` + `system`）送回来。**这是错的，而且会自激**——链路完整地量过一遍：

        window.set_theme(应用主题) → tao 发 ThemeChanged（update_theme 对 set_theme 与系统变化一视同仁）
          → tauri 给该窗口每个 webview 调 wry 的 set_theme → WebView2 SetPreferredColorScheme(应用主题)
          → 页面的 prefers-color-scheme 变成"我们刚写进去的值" → 页面收到 change 事件
          → 前端把它当成"系统主题"再 invoke 一次 → 又一轮

    症状与之一一对应：系统深色 + 应用浅色时托盘/任务栏拿到浅色墨（前端把自己的输出当输入报回来）；切主题时标题栏与图标反复跳；切"跟随系统"时整个页面快速闪烁（`resolved` 每轮翻一次）；切回浅色后因 tao 对"值没变就不发事件"而阻尼停下，停在同一个错的状态。另外 quick-add 小窗加载的是同一个页面，两个 webview 的 change 事件互相触发，所以是"疯狂"而不是跳一下。

    修法是**换掉系统主题的来源**，不是给循环加消抖：

    - Rust 自己读 OS 主题，而且**只从 quick-add 窗口读**——那是本模块唯一不 pin 的窗口（无边框，本来就没有 chrome 可主题化）。tao 的 `update_theme` 对**已 pin** 的窗口在系统设置变化时直接 return，所以被 pin 的主窗口永远报不出系统值；未 pin 的 quick-add 一直跟着系统走，并继续抛 ThemeChanged。**别 pin 它**（`icons.rs` 顶部与 AGENTS.md 都写着）。
    - `refresh_system` 在启动时与每次 ThemeChanged 重读那个窗口，**不信事件负载**（`set_theme` 自己也会抛同样的负载），值真变了才重画托盘与任务栏；`APPLIED` 这个 atomic 把自激事件挡掉。
    - 前端不再监听 `prefers-color-scheme`：`app:setTheme` 只带应用主题，"跟随系统"要用的 OS 主题由 `app:systemTheme`（启动时问一次）与 `app:systemThemeChanged`（变化时推）给出。`systemPrefersDark()` 只剩"第一次 pin 之前"的种子值。

    顺带查清了 M16 那条"任务栏由 shell 缓存、运行中改不了"的真实原因：**Tauri 的 `set_icon` 只发 `ICON_SMALL`**（tao 的 `set_window_icon`），而任务栏与 Alt+Tab 读的是 `ICON_BIG`——那个槽位从窗口创建那一刻起再没人写过，任务栏一直显示打包的 `icon.ico`，跟主题无关、跟 `app:setTheme` 也无关。背景一去掉，深色任务栏上那枚黑墨图标自然就看不见了。补上缺的那一半：`#[cfg(windows)]` 下用 `windows` crate（版本与 tauri 依赖的同一个，不新增副本）照 tao 的做法搓 `HICON`（BGRA + 反相 alpha 掩码，`CreateIcon`），再 `SendMessageW(WM_SETICON, ICON_BIG)`。HICON 故意不销毁：任务栏可能还握着它，进程退出时系统回收，一次主题切换 64 KB。

    平台差异：Windows 拆得开两个槽位；macOS 窗口没有图标可设（Dock 用打包的 `.icns`）；Linux 只有一个窗口图标槽位、`set_icon` 同时就是任务切换器读的那枚，没有可拆的两半——跟随应用主题，见 [ARCHITECTURE](./ARCHITECTURE.md)§6.3。

    同时删掉 `capabilities/default.json` 里的 `core:window:allow-set-theme` 与 `core:window:allow-set-icon`：这两条是上一轮跟着 `app:setTheme` 一起加的，但那条命令是应用自己的（Rust 直接调窗口 API），webview 从头到尾只调用过 `getCurrentWindow().hide()` 与 `.label`，权限面白留了两条。
16. **M19：标志从位图改成矢量重绘（2026-09）。** M17 那份"提供的去背景导出"落到仓库里是**一张 500×500 的 RGBA 位图套在导出工具写的 SVG 壳里**，而且 alpha 只有 0 与 255 两档（去背景那一步是硬阈值）。后果在小尺寸与大尺寸两头都看得见：512px 的打包图标上每条边都是 1 像素阶梯，16–32px 上这些阶梯就是"毛边"。位图本身也修不了——边界信息在阈值那一步已经没了。

    改法是**量出几何、重画**，不是描摹（VTracer 那条路是 M13，201 条路径、约 120 级灰，正是"在纸上像"的那种）。对旧位图逐条做最小二乘圆拟合，再按整幅 500×500 的逐像素差做亚像素校准（拟合读的是边界像素中心，恒比真实边界低约 0.5px，两者相互印证）：

    | 元素 | 圆 | 拟合 rms |
    | --- | --- | --- |
    | 环外缘 | 圆心 (250.51, 259.69)，r 213.91 | 0.36 |
    | 环内缘 | 圆心 (252.76, 260)，r 130.18 | 0.39 |
    | 绿点 | 圆心 (375.67, 115.07)，r 61.92 | 0.34 |
    | 缺口 | 与绿点同心，r 88.38 | 0.32 |

    也就是说这个标志**本来就是圆**：rms 0.4px 的手绘抖动全在像素级噪声里，唯一"不圆"的地方是**环的内外缘不同心**（相差 2.3px，环一边厚一边薄）——这一条是画的一部分，重绘照抄，于是 `logo.svg` 是"一个圆盘 + 两个 mask 洞（内缘与缺口）"。缺口那道弧**不是手摆的坐标**：它与绿点同心，挪绿点，缺口跟着走；四个数字都写在文件头的注释里，测试钉的就是它们。

    验收：与旧位图逐像素比，500×500 上 IoU **0.9931**，残差 308/310（两侧对称，说明没有整体变粗或变细），形态是均匀一圈亚像素边——旧图自身 ±0.4px 的不圆，没有结构性差异；128px 的运行时图标同样只剩这一圈。绿点与环内缘仍然相切、缺口净宽仍然 26.7px、画布取景仍是导出自己那套（环心在画布中心下方 9.7px）、两版墨色（`#000000` / `#EDE6E5`）与强调色 `#24C68C` 一个没动——重绘只去掉像素，不动构图。

    派生链因此变短：`scripts/gen-logo-assets.mjs` 不再解析 base64 位图、不再逐像素换墨，而是**换一个字符串**（`fill="#000000"` → `fill="#EDE6E5"`）生成深色版，顺带把 `logo-square.svg` 拷过去；两个运行时 `.rgba` 仍由 `tauri icon` 栅格化后校验（覆盖逐个相同、墨不同、角落透明），打包图标集照旧 `pnpm tauri icon src/assets/logo.svg` 重出（它现在还会多写一个 `64x64.png` 与 android/ios 目录，一并删掉）。测试里钉的东西从"位图头"换成"这四个圆的坐标"，并新增一条"三个 svg 都不许再出现 base64 或 `<image>`"；两版同形不同墨的检查（vitest 与 `cargo test --lib icons`）原样保留。

    顺带记一条量出来的事实，避免下次误判：**渲染出来的 PNG / RGBA 里本来就没有白边**——128×128 图标里 211 个半透明像素全部落在绿点边缘（`r-g>20 且 g-b>20`），黑环边缘的部分透明度都是纯黑的 RGB，没有一个是浅色。所以"白边"只可能来自**源图的 JPEG 灰晕**（供给的那张是 500×500 JPEG，笔画边缘 32–63 的灰阶），它随 M17 的硬阈值一起去掉了；重绘这一版连亚像素阶梯也不再有。



## 4. 未完成项与已知缺口

| 项 | 内容 | 影响 |
| --- | --- | --- |
| **Q-02 复查留下的无障碍缺口** | 7 项：统计刷新没有加载提示、分段控件不是 APG 单选组、图表逐点数据没有文本替代、路由切换不移动焦点、搜索框不是 combobox、快速输入小窗没有可聚焦的提交按钮 | 这些都**可用**（键盘能走到、能激活），但离推荐模式有距离；逐项与理由见 §4.2 |
| **启动耗时未全部达标**（Q-01 验收留下） | 热启动 730–840 ms（目标 0.5 s）；WebView2 运行时缓存冷时冷启动 1619 ms（目标 1.5 s）。构成见 [ARCHITECTURE](./ARCHITECTURE.md)§6.1：WebView2 与窗口 320–1068 ms、页面加载与挂载约 175 ms、首屏数据约 270 ms、quick-add 小窗约 123 ms。**dev 模式另有一套数字**：整页 250 个请求、约 10 MB 未压缩源码，`server.warmup` 之后页面侧仍需 2.1 s（预热前 7.1 s） | 体感是「点图标到看见自己的任务」约 0.7–0.8 s。省时间的两条路都与既有决策冲突——预热小窗是 D-02 有意为之、启动拉整棵树是 §1.2 的取舍——要动就得先推翻那两条。dev 模式剩的那 2 s 是浏览器按 import 深度串行取模块的水位：要再压只能让三个 solid 库进 deps 缓存（Vite 只预打包 `.js`/`.ts` 入口，它们经 `solid` condition 解析到 `.jsx` 源码，`include` 与 `extensions` 两条路都试过并记为死路，见 ARCHITECTURE §4.3），或改用打包式 dev server |
| **Q-03 三端兼容** | Windows 已实测（单实例、托盘驻留、快捷键、通知、备份路径）；macOS / Linux 只做了静态核对与代码修正，真机清单（8 项）未跑 | 平台差异与运行前提已逐项写明并列进 [ARCHITECTURE](./ARCHITECTURE.md)§6.3；未跑的部分见 §4.3，风险是「写下来的结论没在真机上验过」而不是已知不一致 |
| **Q-04 文档同步** | 本次整合完成了主体：文档集改为描述现状并与代码对齐 | 后续仍需按 [README](./README.md)§5 的规则维护 |
| **任务数据仍在启动时全量加载** | `task:list` 一次带走整棵树（§1.2 的取舍）：8k 档起超 50 ms 预算（56 ms），70k 行 339 ms；前端首屏 3.7 s（70k 行：Rust 侧到后端就绪 580 ms，其余全在页面，最贵的一笔是整树过 IPC）。写入路径已不随规模涨（三档 0.08–0.10 ms）。项目详情与看板已改为按项目范围取（`task:listByProject`）；侧边栏的展开箭头与命名空间页的数字已不读快照（分别用 `project:unfinishedCounts` 与 `stats:projectProgress`；外壳仍为四个视图载入快照，侧边栏的拖放也还按 `getTask` 在快照里查行）；启动路径与四个视图仍读 `task:list` | 「按范围懒加载」是已定的方向（命令面、store 形状、迁移顺序已定稿）；在那之前 5 万行的库首屏在秒级（11225 行与 70025 行两档实测之间的外推）、超出 1.5 s 的冷启动目标 |
| **注释里的 `§` 引用悬空** | 约 32 个源文件引用已删除文档的节号，对照表见 §2.5 | 阅读注释时需回本文档查表 |
| **备份遗留键 `subtasks`** | 导出永远写空数组，只为让 pre-V7 文档有落点；`LegacySubtask` 类型同样只服务导入 | 兼容性保留，不是缺陷；等不再需要支持 pre-V7 备份时可删 |
| **悬浮快速入口** | 产品范围里的 P2 能力，未实现（v1 快速入口只有全局快捷键小窗） | 范围外 |
| **Q-06 审查发现** | 全仓代码审查发现 23 项（无 Critical；1 高、9 中、13 低），逐项一句话描述、解决状态与修复方向见 §4.1 | 已修 21 项（QA-01–20、23）；QA-21/22 评估后不修（知悉项）。静态检查与测试全绿，无数据风险 |
| **浅色主题的次要文字不到 WCAG AA**（M12 量出来，不是引入的） | 实测：`muted-foreground` 在页面背景上 2.42:1、`subtle-foreground` 2.03:1（AA 正文要 4.5、大字要 3）。深色主题同一对是 7.64 / 5.77，达标。三次换色都按「保持原对比度、只换色相」处理，所以这三对数字一直没变；`--primary` 现在是 2.89（旧的 2.71）。**另外黑绿配色下浅色主题的 `warning` 在骨白上只有 1.78:1**，这是该色相在这套明度里能达到的上限（要抬高它就会掉到 success 身上），属于同一类"浅色主题没达标"的既有问题 | 把次要文字压到 4.5 会同时改掉全应用每一处次要标签的字重与观感，属于独立的一次排版决策，不该夹在换色里悄悄做。要修的话是三个 token 的 L 值，一处改完，但要看一遍全应用 |
| **AI 助手与外接通道（AI-01–AI-08）** | 规格已定稿、**代码一行未写**。四件事：对话式入口（一句话建任务/项目、自然语言问进度）、写操作预览确认、快速输入小窗的 `Shift+Tab` AI 模式、以及**未定**的外部通道（周期总结与提醒）与多用户指派。现状、方案取舍、详细设计与分阶段验收判据见 [AI.md](./AI.md) | 未开始。它是本文档集里唯一一份**规格**（描述尚未实现的东西），其余五份仍只描述现状——实现落地时按 [README](./README.md)§5 的规则把结论回写进 PRODUCT / ARCHITECTURE / DATA / 本文档 |

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

### 4.2 Q-02 复查留下的无障碍缺口（2026-09-18）

复查做了什么、怎么复现，见 [ARCHITECTURE](./ARCHITECTURE.md)§6.2；动效四条硬约束由 `src/common/__tests__/design-constraints.test.ts` 持续断言。下表是**复查后仍然存在**、且经评估不阻塞使用的部分——它们都是「能用但不够好」，不是键盘走不到：

| 项 | 现状 | 为什么这次没改 |
| --- | --- | --- |
| 统计刷新没有加载提示 | 切换时间范围/分组维度时旧图留在屏上静默替换（`ready()` 只置一次真，没有 per-request 的 loading 状态），也没有 `aria-busy` | 要改的是 hooks 的状态形状（每次请求一份 loading），不是一处标注；留待统计页下次改动 |
| `SegmentedControl` 不是 APG 单选组 | 用 `role="group"` + `aria-pressed` 的按钮组：5 个 Tab 停靠点、方向键不换选项 | 键盘可用（Tab + 空格/回车），只是不如 roving tabindex + 方向键省事；换 Kobalte ToggleGroup 或自建单选组都可行 |
| 图表逐点数据没有文本替代 | 三个自绘 SVG 只有「N 个数据点 / 合计 X」的 `aria-label`，逐点/逐日的数值藏在悬停 `<title>` 里（`role="img"` 的子节点对读屏不可达） | 补齐要给每张图配一份 `sr-only` 列表/表格，属于图表组件自身的改动 |
| 路由切换不移动焦点、也不播报 | 侧边栏导航是 `<Link>`，激活后焦点留在链接上，视图换了但读屏不说 | 桌面端「焦点留在导航项」本身是可接受的行为；要做就得在壳层加路由播报区（并且每个视图要有可聚焦的标题） |
| 搜索框不是 combobox | 输入框没有 `aria-controls`/`aria-expanded`/方向键结果导航；结果数量与空结果由常驻 `role="status"` 播报 | 结果列表是普通按钮列表而不是 listbox，方向键导航要连带决定选中语义 |
| 快速输入小窗没有提交按钮 | 只有「回车添加 · Esc 关闭」；表单里只有标题输入框，两个下拉与日期控件在表单外 | D-02 有意做成极简小窗（560×164），加按钮会改窗口形态；回车路径对键盘用户是完整的 |
| 虚拟列表的滚动条本身不是 Tab 停靠点 | 滚动容器没有 `tabIndex`，方向键滚动依赖焦点在行内控件上（Chromium 会滚动最近的滚动祖先） | 加 `tabIndex` 会多一个 Tab 停靠点且只对这一种容器有意义；当前路径已能滚动 |

### 4.3 Q-03 未跑的真机项（2026-09-18）

Q-03 复查做了什么、改了什么、Windows 上实测到了什么，见 [ARCHITECTURE](./ARCHITECTURE.md)§6.3。下表是**只能在 macOS / Linux 真机上跑**的部分——本机（Windows）连 `cfg(target_os = "macos")` 分支都编译不到，`cargo check` 只覆盖当前目标，所以这些是「代码读了、清单写了、没跑过」。

| 项 | 判定标准 | 没跑的原因 |
| --- | --- | --- |
| macOS `Reopen`（Dock 图标叫回窗口） | 关窗到托盘后点 Dock 图标，主窗口回来；点通知激活应用时同样 | 需要 macOS；变体只在 macOS 编译 |
| macOS 托盘图标外观与菜单 | 菜单栏图标可辨、菜单三项可用 | 同上（`icon_as_template` 有意不开，模板图会把彩色图标渲染成剪影，真机要确认观感） |
| macOS 通知投递 | 打包 `.app` 后首次提醒弹出并请求授权，后续提醒按类型出现 | 同上（裸二进制运行的提醒可能不投递） |
| macOS webview 特性下限 | §6.3 的四项探针全 true，遮罩有模糊 | 同上（`@property` 需要 Safari 16.4 级 webview） |
| Linux 托盘（appindicator） | 左键弹菜单、显示/隐藏/退出三项可用 | 需要 Linux + `libayatana-appindicator3` |
| Linux 全局快捷键 | X11 会话下 `Ctrl+Shift+Space` 唤出小窗；Wayland 下确认是否注册失败（只记日志） | 需要 Linux；`global-hotkey` 只有 X11 后端 |
| Linux 单实例的会话总线依赖 | 有会话总线时第二次启动不新开进程；无总线环境（裸 TTY/容器）确认失败形态 | 需要 Linux |
| Linux 打包与自启 | deb/rpm/AppImage 都能起；AppImage 在无 FUSE 时可用 `--appimage-extract-and-run`；自启写 `~/.config/autostart` | 需要 Linux，且要真打包 |

# ordo 架构设计文档

日期：2026-10-20
状态：草案（待评审）
上游：[2026-10-19-ordo-design.md](./2026-10-19-ordo-design.md)
范围：Phase 1（单机桌面），但为 Phase 2 移动端、Phase 3 云端预留边界。

---

## 1. 这份文档回答什么

设计文档说"做什么"，这份说"怎么搭"：进程怎么分、数据长什么样、界面通过什么拿数据、提醒在没人看着的时候怎么跑、AI 怎么接、出错和数据丢了怎么办。

不回答：具体每个任务怎么排、每步写什么测试——那是实现计划（下一份文档）的事。

## 2. 一张图

```
┌────────────────────────────── WebView（Vue 3，MVVM）─────────────────────────┐
│ View        views/（页面、组件、浮层）——只做绑定，不写业务逻辑                   │
│ ViewModel   viewmodels/（组合式函数）——状态、派生值、动作                       │
│ Model       model/（DTO、ipc、映射）——唯一能碰 IPC 的一层                       │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ invoke(命令) / listen(事件)
┌───────────────▼────────────────────────────────────────────────────────────┐
│ Rust 核心                                                                    │
│  commands/  薄壳：参数校验、调服务、序列化                                      │
│  services/  业务规则：状态推导、本周集合、过一遍、延期、统计                      │
│  repo/      SQL 与事务，唯一碰数据库的地方                                      │
│  reminders/ 后台调度线程（30s tick）                                           │
│  ai/        DeepSeek 调用、结果校验                                             │
│  tray.rs    托盘、窗口显隐、全局快捷键                                           │
│                                                                              │
│  SQLite（WAL）  本地文件，无服务器                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

两条铁律：

1. **界面不直接读文件、不直接写库。** 想知道任何事，问 Rust。
2. **Rust 不依赖界面。** 提醒调度不能靠 WebView 的定时器——窗口最小化到托盘后，WebView2 会节流甚至暂停后台定时器，提醒就哑了。这是把数据库和调度放进 Rust 的首要理由。

## 3. 技术选型

| 层         | 选型                                                           | 理由                                                                              |
| ---------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 外壳       | Tauri 2                                                        | 仓库已有脚手架；包体小；Rust 核心可复用到移动端                                   |
| 前端       | Vue 3 + TypeScript                                             | 已有脚手架                                                                        |
| 构建       | Vite+（`vp`）                                                  | 仓库既定工具链，`vp check`、`vp test` 统一质量门                                  |
| 样式       | Tailwind 4 + daisyUI 5                                         | 设计已用 daisyUI 主题变量落地                                                     |
| 路由       | vue-router 4                                                   | 四个页面，标准做法                                                                |
| 前端架构   | **MVVM**：View / ViewModel / Model                             | 界面只绑定，逻辑集中在 ViewModel，便于脱离界面测试；详见 §4.1                     |
| 状态       | ViewModel 用 Vue `ref`/`reactive` 组合式函数，**不用 Pinia**   | 应用只有一个用户、状态量小；少一个依赖和一层样板。若 ViewModel 超过六个再考虑引入 |
| 数据库     | SQLite + `rusqlite`（bundled）                                 | 单文件、事务、查询统计方便；bundled 免去系统库依赖                                |
| 时间       | `chrono`                                                       | 本地时区、日期运算                                                                |
| AI         | `reqwest` 调 DeepSeek（OpenAI 兼容）                           | 纯 JSON 请求，不需要 SDK                                                          |
| 密钥       | `keyring` crate（Windows 凭据管理器）                          | key 不落明文配置、不进备份                                                        |
| Tauri 插件 | single-instance、notification、autostart、global-shortcut、log | 见 §9                                                                             |

不引入的东西：状态管理框架、ORM、HTTP 中间层、组件库（daisyUI 只提供类名与主题）、国际化框架、图表库（时间轴用手写定位，够用）。

## 4. 目录结构与 MVVM 分层

```
src/                                  # Vue
  main.ts  App.vue  router.ts
  views/
    WeekView.vue                      本周（捕获条 + 列表 + 挂起区 + 统计条）
    ProjectsView.vue                  项目列表
    ProjectView.vue                   单个项目（分组 / 时间轴）
    ArchiveView.vue                   归档（项目 / 任务 / 已取消）
    CaptureView.vue                   迷你窗口（单输入框）
    components/
      CaptureBar.vue  TaskRow.vue  StatusDot.vue
      CategoryProgress.vue  TimelineView.vue  SummaryLine.vue
      SuspendedStrip.vue  EmptyState.vue
    overlays/
      WeeklyPass.vue  TaskSheet.vue  ProjectSettings.vue
      SettingsModal.vue  DelayReasonPrompt.vue  ConfirmPopover.vue
  viewmodels/
    appVM.ts        bootstrap 数据、设置、人员、分类、标签
    weekVM.ts       本周集合、过一遍入口、统计条
    passVM.ts       过一遍队列与四个出口
    projectsVM.ts   项目列表
    projectVM.ts    单个项目：分组、时间轴数据、总结句
    archiveVM.ts    归档、恢复、删除
    taskSheetVM.ts  任务浮层：步骤、字段、延期
    uiVM.ts         浮层栈、快捷键、toast
    captureVM.ts    迷你窗口的输入、保存、自动隐藏
  model/
    ipc.ts        类型化的 invoke 包装（唯一出口，只有 ViewModel 能调）
    types.ts      与 Rust DTO 一一对应的 TS 类型
    mappers.ts    DTO → 视图状态（日期文案、进度文案、逾期判断）
  lib/
    dates.ts      本地日期工具（周一为周起点）
    keys.ts       键盘映射
  styles/theme.css  daisyUI 自定义主题 soft

src-tauri/src/
  main.rs  lib.rs  state.rs
  db/
    mod.rs          连接、PRAGMA、Mutex
    migrations.rs   user_version 迁移
  repo/
    tasks.rs  projects.rs  people.rs  categories.rs  tags.rs  notifications.rs  settings.rs
    delays.rs
  services/
    status.rs       状态推导
    week.rs         本周集合、过一遍的四个出口
    stats.rs        项目进度、分类进度、总结句
    deliverables.rs 延期记录
  reminders/
    mod.rs          调度线程
    rules.rs        候选计算与去重
  ai/
    mod.rs          调用与校验
    prompt.rs       提示词
  commands/
    mod.rs tasks.rs projects.rs people.rs meta.rs
  tray.rs
```

### 4.1 MVVM 分工

- **Model**：`model/` 里的 DTO、`ipc.ts` 网关、`mappers.ts`。真正的领域模型与业务规则在 Rust（§6），TS 的 Model 只负责“取到什么、长什么样”。只有 Model 能调 `invoke`。
- **ViewModel**：`viewmodels/` 下的组合式函数。持有界面状态（列表、选中项、队列指针）、派生值（逾期几天、进度百分比、可选负责人）、动作（capture / resolve / 打开浮层）。不 import 任何组件，不碰 DOM。
- **View**：`views/` 下的页面、组件、浮层。只做三件事：渲染 VM 暴露的状态、把用户操作转给 VM、样式与布局。不 import `ipc.ts`，不写业务分支。
- 共享数据（人员、分类、标签、设置、项目摘要）归 `appVM`；页面级数据归各自的 VM，离开页面即丢缓存。
- VM 之间只通过方法调用协作（例如 `weekVM` 调 `appVM.refreshProjects()`），不共享可变对象。

## 5. 数据模型

SQLite，`journal_mode=WAL`，`foreign_keys=ON`，`busy_timeout=5000`。
主键全部 TEXT（UUID v4）；日期 `YYYY-MM-DD`（本地日期）；时间戳 RFC3339 UTC；删除多为软删除（`deleted_at`），归档与取消是独立字段。

```sql
people(id, name, is_me, color, created_at, updated_at, deleted_at)
projects(id, name, due_date, archived_at, created_at, updated_at, deleted_at)
project_members(project_id, person_id, created_at)          -- 多对多
categories(id, name, sort_order, created_at, updated_at, deleted_at)
tags(id, name, created_at, deleted_at)
task_tags(task_id, tag_id)
tasks(id, title, project_id?, category_id?, owner_id?,
      start_date?, due_date?,
      status CHECK IN ('todo','doing','done'),               -- 无步骤时才由用户手改
      in_week, carry_count, suspended_until?,
      note?, archived_at?, canceled_at?, created_at, updated_at, deleted_at)
steps(id, task_id, title, sort_order, done, due_date?, created_at, updated_at, deleted_at)
delays(id, task_id, kind CHECK IN ('reschedule','overdue_note'),
       old_due?, new_due?, reason?, created_at)
notifications(id, task_id, kind CHECK IN ('due_tomorrow','overdue','suspend_start'),
       due_key, scheduled_for, fired_at?, seen_at?,
       UNIQUE(task_id, kind, due_key))
settings(key PRIMARY KEY, value)
```

索引：`tasks(in_week, archived_at, canceled_at)`、`tasks(project_id)`、`tasks(due_date)`、`steps(task_id, sort_order)`、`notifications(scheduled_for, fired_at)`。

设计取舍：

- **不建"周"表。** `in_week` 是任务上的布尔值，周只是它此刻的状态；这样既符合"显式工作集"，将来同步也不会因为周次重算而漂移。
- **不建"阶段"表。** 阶段就是任务下的有序步骤，第一步未完成的那条即"当前"。
- **取消不是删除。** `canceled_at` 让它在项目数字里消失，但归档里还找得到、能恢复。真删是另一个动作（归档页的删除），物理删除并级联清掉步骤与延期记录。
- **人名只有一份。** `people` 全局唯一；项目通过 `project_members` 各挂一份；"我"在每个项目里都自动存在，不可移除。

## 6. 业务规则落在哪

| 规则                 | 位置                       | 说明                                                               |
| -------------------- | -------------------------- | ------------------------------------------------------------------ |
| 状态推导             | `services/status.rs`       | 有步骤：全完成→done，任一完成→doing，否则 todo。没步骤：用手改的值 |
| 勾完最后一步自动完成 | `repo/steps.rs` + status   | 勾选后立即重算并写回                                               |
| 本周集合             | `services/week.rs`         | 捕获入集；截止日落在本周自动入集；四个出口移出                     |
| 过一遍队列           | `services/week.rs`         | `in_week=1` 且未完成/未归档/未取消的全部，不按周切分               |
| 继续                 | `services/week.rs`         | `carry_count+1`，留在集合                                          |
| 挂起                 | `services/week.rs`         | 要求 `suspended_until`；移出集合；到期由 reminders 提醒            |
| 取消                 | `services/week.rs`         | 写 `canceled_at`，移出集合，移出项目数字                           |
| 完成                 | `services/week.rs`         | 写状态；移出集合                                                   |
| 延期                 | `services/deliverables.rs` | 改晚截止 → 记 `reschedule`；逾期补原因 → 记 `overdue_note`         |
| 项目进度             | `services/stats.rs`        | 分母排除取消；挂起计入；按分类分组                                 |
| 总结句               | `services/stats.rs`        | 同一处生成，供项目页复制                                           |
| 提醒去重             | `reminders/rules.rs`       | `UNIQUE(task_id, kind, due_key)` 兜底                              |

## 7. 命令与事件（IPC 契约）

命名：动词在前，snake_case；返回 DTO 而非裸行。所有写命令返回更新后的实体，前端据此刷新 ViewModel。调用方一律是 ViewModel，View 不直接调命令。

**启动与读取**

- `bootstrap() -> { settings, people, categories, tags, projects, week }`
- `list_week() -> TaskDto[]`
- `list_projects() -> ProjectSummary[]`
- `get_project(id) -> ProjectDetail`（含任务、步骤、延期、成员）
- `list_archive(query?) -> { projects, tasks, canceled }`

**捕获与任务**

- `capture(raw) -> TaskDto`（立即落库，`in_week=1`，只存原句）
- `update_task(id, patch) -> TaskDto`
- `set_due(id, new_due, reason?) -> TaskDto`（后移则写一条延期记录）
- `add_delay_note(id, reason) -> TaskDto`
- `add_step(task_id, title, after_id?) -> StepDto`
- `toggle_step(step_id) -> { task, steps }`
- `delete_step(step_id) -> TaskDto`
- `archive_task(id)` / `restore_task(id)` / `delete_task(id)`（物理删除）
- `delete_project(id)`（物理删除，级联）

**过一遍**

- `pass_queue() -> PassCard[]`
- `pass_resolve(task_id, action, { suspend_until? }) -> TaskDto`
  - action ∈ `keep | done | suspend | cancel`

**项目与人**

- `create_project(name, due_date?) -> ProjectDto`
- `update_project(id, patch) -> ProjectDto`
- `archive_project(id)` / `restore_project(id)`
- `add_member(project_id, { person_id?, name? }) -> MemberDto`
- `remove_member(project_id, person_id)`
- `list_people() -> PersonDto[]`

**设置与数据**

- `get_settings() -> SettingsDto`
- `set_settings(patch) -> SettingsDto`
- `export_json(path)` / `backup_now()`

**AI**

- `ai_enrich(task_id) -> ()`（异步，完成后发事件；失败静默）
- `ai_test() -> { ok, latency_ms, sample }`（设置页测试连接）

**事件（Rust → 前端）**

- `task:updated` 任务被调度器或 AI 改动
- `reminder:fired` 有提醒触发（托盘角标刷新）
- `ai:enriched { task_id, enrichment }`
- `pass:needed { count }` 新的一周
- `capture:created { task_id }` 迷你窗口保存了一条（主窗口刷新本周）
- `shortcut:changed { ok, reason? }` 快捷键注册结果（设置页反馈）

DTO 与 `lib/types.ts` 一一对应。字段名在两侧保持 camelCase，Rust 用 `#[serde(rename_all = "camelCase")]`。

## 8. 提醒调度

- 进程内常驻一个 tokio 任务：启动即跑一次，之后每 30 秒。
- 每次 tick 计算三类候选：
  - `due_tomorrow`：`due_date = 明天`，触发时刻 `今天 17:30`；
  - `overdue`：`due_date < 今天` 且未完成，触发时刻 `due_date 17:30`，只发一次；
  - `suspend_start`：`suspended_until = 今天`，触发时刻 `09:00`。
- 写入 `notifications` 时靠唯一键去重，重启不会重复弹。
- 错过的：启动时把 `scheduled_for <= now` 且 `scheduled_for >= now - 14 天` 未触发的补上。超过 1 条时合并成一条"你错过了 N 条提醒"，点开进本周。
- 未读 = `fired_at IS NOT NULL AND seen_at IS NULL`；托盘 tooltip 显示条数，打开本周即标记已读。
- 已完成、已取消、已归档的任务不参与。

## 9. 窗口、托盘、自启动、快捷键

**两个窗口**

- `main`：主窗口，四个页面。关闭 = 隐藏到托盘（首次关闭时提示“仍在托盘运行”），退出走托盘菜单；托盘左键单击切换显隐。
- `capture`：迷你窗口。**启动时就创建好并隐藏**，避免呼出时现建 WebView 的延迟。无边框、置顶、不出现在任务栏，约 560×96，屏幕中上方居中。
  - 全局快捷键呼出：显示 → 聚焦输入框；`Esc` 或失焦自动隐藏。
  - 回车保存：立即落库（与主窗口同一个 `capture` 命令）；窗口内显示 0.8 秒“已记下”后自动隐藏，**不等 AI**。
  - 保存后向主窗口发 `capture:created`，主窗口 `weekVM` 刷新；AI 结果随后以 `ai:enriched` 到达主窗口。
  - 迷你窗口只放输入框、一行提示和一个“打开主窗口”的小按钮，不放列表、不放设置。
  - 单入口：`main.ts` 读当前窗口 label，`main` 挂 `App.vue`，`capture` 挂 `CaptureView.vue`。不新增构建入口。

**快捷键**

- 默认 `Ctrl+Alt+O`，设置里可改；录入方式是“按下组合键录制”，必须至少含一个修饰键。
- 改键流程：先注销旧键 → 注册新键 → 若被其他程序占用导致注册失败，恢复旧键并提示，不留在半失效状态。
- 快捷键永远只负责呼出/收起迷你窗口；主窗口由托盘或迷你窗口上的按钮打开。

**其他**

- 托盘菜单：打开 ordo / 本周 / 过一遍 / 设置 / 退出。
- 开机自启：`tauri-plugin-autostart`，首次运行默认开启，设置里可关。
- `tauri-plugin-single-instance`：第二个实例启动时唤起主窗口并退出，避免两个调度器同时跑。
- 通知点击：唤起主窗口并跳到对应任务（事件携带 `task_id`）。

## 10. AI 补字段

- 触发：`capture` 成功后前端异步调用 `ai_enrich`，不阻塞保存。
- 入参只含：原句 + 项目名/ID、分类名/ID、人名/ID（不含历史任务）。
- 请求：`POST {base_url}/chat/completions`，`response_format={type:'json_object'}`，`thinking={type:'disabled'}`，`temperature=0`，`max_tokens=600`，超时 8 秒。
- 提示词要求返回固定结构，并在 system 里给 JSON 样例（DeepSeek 的 JSON 模式要求 prompt 含 "json" 字样与样例）。
- 校验：ID 必须来自传入列表；日期必须 `YYYY-MM-DD`；未知字段丢弃。返回空串/非法 JSON → 重试一次 → 放弃。
- 写入：只填用户尚未设置的非空字段；标签可在 `tags` 里自动创建；人名、项目不自动创建。
- 多件事：返回 `extra_tasks`，前端显示"拆成 N 条？"，点接受才建。
- key 由 `keyring` 存 Windows 凭据管理器；设置页只显示掩码。

## 11. 存储、迁移、备份

- 数据目录：`{appDataDir}/ordo/ordo.db`（Tauri `path` 解析）。
- 迁移：`PRAGMA user_version` + 单向迁移数组；迁移前先备份。
- 备份：每天首次启动时 `VACUUM INTO` 一份 `backups/ordo-YYYY-MM-DD.db`，保留 30 天（可设）。
- 导出：JSON（全表，便于迁移/排障）；导入 Phase 1 不做。
- 启动时若库损坏：尝试最近一份备份，失败则提示并保留原文件，不静默重建。

## 12. 安全与隐私

- CSP：`default-src 'self'; connect-src 'self' https://api.deepseek.com; img-src 'self' data:`。
- 不加载任何远程脚本；daisyUI/Tailwind 都在构建期打包。
- 无遥测。AI 关闭时完全不联网，key 不写日志、不进导出。
- 能力（capabilities）只开：notification、autostart、global-shortcut、tray；不开 shell、fs 通配。

## 13. 测试策略

- **Rust**（主要）：内存 SQLite，覆盖状态推导、本周集合与四个出口、`carry_count`、延期记录、项目统计分母、提醒候选与去重、迁移。
- **TS（ViewModel）**：日期工具（周一为周起点、跨年）、各 VM 的状态与派生值；用 Vitest + 假的 Model（不启动 Tauri）。VM 测通了，界面只是绑定。
- **组件**：捕获条、过一遍卡片的交互（键盘、出口分支）。
- **手工冒烟清单**（进计划）：快捷键呼出迷你窗口→回车保存→主窗口出现→AI 补字段→过一遍→拆开→挂起→到期提醒→归档→恢复→删除；改键到一个被占用的组合，确认回滚且旧键仍可用。

## 14. 构建与运行

- 依赖安装：`vp install`
- 前端开发：`vp dev`（端口 1420，与 `tauri.conf.json` 的 `devUrl` 一致）
- 整机开发：`pnpm tauri dev`
- 检查：`vp check`（格式、lint、类型）
- 测试：`vp test`
- 打包：`pnpm tauri build`

## 15. 风险与对策

| 风险                                   | 对策                                                  |
| -------------------------------------- | ----------------------------------------------------- |
| WebView 后台节流导致提醒失效           | 调度在 Rust，不依赖前端定时器                         |
| 双实例各跑一个调度器                   | single-instance 插件                                  |
| 迷你窗口唤出慢（现建 WebView）         | 启动时预建并隐藏，呼出只是 show + focus               |
| 窗口关闭后用户以为退出了               | 首次关闭时提示"仍在托盘运行"，可在设置里改回直接退出  |
| 迷你窗口透明/置顶在 Windows 上行为不稳 | 先做无边框不透明面板；透明作为增强项，失败就退回      |
| 呼出迷你窗口抢走焦点、打断别的程序     | 失焦即隐藏；不轮询、不常显                            |
| 快捷键被别的软件占用                   | 注册失败即回滚到旧键并提示，设置里能看到当前生效的键  |
| SQLite 写坏 / 磁盘问题                 | WAL + 每日备份 + 启动自检 + 不静默重建                |
| AI 返回慢或错                          | 异步、可关、只填不覆盖、失败静默                      |
| Windows 专注助手吞通知                 | 托盘角标兜底；打开应用时补报                          |
| Tauri 2 / Vue 3.6 RC 版本漂移          | 锁版本；Vue 若已有 3.5 稳定版则回退到稳定版           |
| 时区/夏令时                            | 日期按本地日期存；所有"今天/明天"用 chrono Local 计算 |

## 16. 为后续阶段留的口子

- **移动端**：业务规则全在 Rust `services/`，与窗口/托盘无关；UI 只通过 `lib/ipc.ts` 取数。移动端只需换外壳与通知实现。
- **云端**：实体已是 UUID、带 `updated_at`、软删除、人员为一等实体；本周集合是显式字段而非运行时重算。没有提前引入同步协议、冲突解决或事件日志。
- **多用户**：`people` 已可升级为账号；`project_members` 已是成员关系。真要多人编辑时，需要新增权限与同步层，那是另一份设计。

## 17. 交给实现计划的

- 每个命令的精确签名与 DTO 字段。
- 迁移文件与建表顺序。
- 提示词的最终措辞与评测样例。
- 冒烟清单的具体步骤。
- 任务的先后与验收标准。

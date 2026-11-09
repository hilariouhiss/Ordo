<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

---

# Ordo — 开发指南

## 项目概览

Ordo 是单机个人任务账本桌面应用：一句话捕获、每周过一遍、项目进度与时间轴、延期记录、归档与提醒，数据只在本机。技术栈是 Tauri 2.12 + Rust（2024 edition，最低 1.90）、Vue 3.6 RC + TypeScript、Vite+ 1.2（`vp`）、Tailwind 4 + daisyUI 5、SQLite（rusqlite bundled）。Windows 优先，界面支持中英文；未手动选择时跟随系统 UI 语言，设置里可切换。

顶层：`src/` 是 WebView 前端；`src-tauri/` 是 Rust 核心；`docs/superpowers/specs/` 是设计与架构意图，`docs/superpowers/plans/` 是实现计划（历史记录，不是当前文件清单）。

## 安装与运行

- `vp`（Vite+ CLI）需在 PATH；pnpm 12.14.0 由 `package.json` 的 `devEngines` 固定；Rust 不低于 `src-tauri/Cargo.toml` 的 `rust-version = "1.90"`。
- `vp install` — 安装依赖；`prepare` 脚本执行 `vp config`，把 git hooks 接到 `.vite-hooks/`。
- `pnpm tauri dev` — 完整桌面应用（启动 Vite :15173 + Rust）。改数据、托盘、提醒、IPC 都用它。
- `vp dev` — 只跑前端，端口 15173；浏览器里没有 Tauri IPC，数据相关操作会失败。
- 运行时数据在 `%APPDATA%\com.ordo.taskbook`：`ordo.db`、`backups/`、`exports/`。旧版 `com.ordo.app` 目录首次启动会复制过来（旧目录保留）；测试不使用这个目录。

## 构建、测试与检查

| 目的               | 命令                                            |
| ------------------ | ----------------------------------------------- |
| 格式 + lint + 类型 | `vp check`                                      |
| TS/Vue 单元测试    | `vp test run`（或 `vp test`，默认跑一次）       |
| 单个 TS 测试文件   | `vp test run src/lib/__tests__/dates.test.ts`   |
| Rust 单元测试      | `cd src-tauri && cargo test`                    |
| 单个 Rust 测试     | `cd src-tauri && cargo test migrates_schema_v1` |
| 前端生产构建       | `pnpm build`（类型检查与 `vp build` 并行）      |
| Windows 安装包     | `pnpm tauri build`（会自动先跑 `pnpm build`）   |

提交前必须三项都过：`vp check`、`vp test run`、`cd src-tauri && cargo test`。仓库没有 CI workflow，这三条就是门禁。Rust 首次编译较慢；`vp check` 不检查 Rust。

`.vite-hooks/pre-commit` 执行 `vp staged`，`vite.config.ts` 把暂存文件交给 `vp check --fix`；钩子可能改写文件，失败后重新暂存再提交。

## 架构

Rust 拥有数据和调度，WebView 只是界面。

- `src-tauri/src/lib.rs`：组合根。插件、两个窗口（`main`/`capture`）、托盘、关窗隐藏、快捷键、启动自检/备份，以及 `invoke_handler!` 命令注册都在这里。桌面小窗是 `main` 窗口的一个形态，由前端 `windowModeVM` 驱动；Rust 只负责托盘事件、`window:open` / `widget:summon` 通知与 `set_window_rect`。
- `src-tauri/src/commands/`：Tauri 命令，做参数校验和串接；新增命令必须同时加进 `lib.rs` 的 `generate_handler!`。命令名保持 snake_case，前端传参用 camelCase（`taskId` 对应 `task_id`）。
- `src-tauri/src/services/`：业务规则（本周集合、过一遍、状态推导、统计、延误、归档、导出、时间推算）。函数同步接收 `&Connection`，需要时间的传入 `now`/`today` 字符串以便测试。
- `src-tauri/src/repo/`：可复用的 SQL 与事务；服务层也会写少量针对性查询。只有 Rust 侧碰数据库。
- `src-tauri/src/db/`：连接 PRAGMA、迁移、损坏恢复。`migrations.rs` 用 `PRAGMA user_version` 做单向迁移。
- `src-tauri/src/reminders/`：独立线程每 30 秒 tick，启动即跑一次；通知去重靠 `notifications` 表唯一键；补报最近 14 天。提醒不能交给前端定时器。提醒时刻由 `reminders/rules.rs` 现算：无时刻任务在「完成日前一天 17:30」，带时刻任务在当天 `expected_finish_time`，逾期在次日 17:30，挂起恢复与等别人的跟进日都在当天 09:00；挂起与等别人的任务都不收到期/逾期提醒，也不进每日汇总，只有恢复日/跟进日那条（等别人写 `notifications.kind = 'follow_up'`，snooze 后仍按跟进日重弹）；全局提前量 `reminders.lead_minutes`（设置里「提前提醒」，0 = 按上面这套内置时刻）会把两类任务都从「任务自己的时刻」往前推（无时刻任务的时刻按完成日 17:30 算）。任务提醒弹条带「1 小时后」「明天 09:00」两个按钮，点击后写 `reminder_snoozes`（一任务一行，覆盖），到点按任务当前完成日重算文案再弹一次后删行，推迟期间该任务其他提醒候选被跳过；这条 re-fire 不写 `notifications`（原来那条已经计过未读）。每天 09:00 有一条「每日汇总」（`reminders.digest` 默认开，用 `reminders.digest_date` 记发过的日期，当天没有到期/逾期就不发），点开进本周页。
- `src-tauri/src/ai/`：DeepSeek（OpenAI 兼容）请求、prompt、结果校验。只补项目/分类/负责人/标签，不产生日期。`keyring` 保存 key；AI 默认关闭，没 key 不发请求。
- `src-tauri/src/dto.rs` / `state.rs`：IPC DTO（serde `camelCase`）与 `AppState`/`with_db`（`spawn_blocking` 包住数据库锁）。
- 前端：`src/model/ipc.ts` 是唯一调用 `invoke` 的地方；状态用 VM 的 `reactive`，不引入 Pinia；`types.ts` 镜像 Rust DTO；`viewmodels/` 是 Vue `reactive` + 动作的工厂，页面级单例在文件底部导出；`views/` 只做绑定；`lib/` 放日期、IME、主题、时间轴等工具。
- `src/main.ts` 按窗口 label 只分 `capture` 与 main（挂 `App.vue`）；桌面小窗由 App 内嵌 `DeskView`，只有一个 `index.html`，不要新增构建入口。
- 应用内快捷键：`App.vue` 监听 `Ctrl+N` / `Ctrl+Shift+N` 打开根级 `QuickCreate` 浮层，`Ctrl+K` 打开全局搜索面板，`Ctrl+Z` 撤销最近一次可逆操作（输入框内不接管）；主窗口和小窗都可见，迷你捕获窗口没有；任务浮层、设置、过一遍、确认框、项目设置、搜索面板打开或形态动画中忽略，不注册全局快捷键。搜索面板与撤销条分别是 `SearchPalette.vue`、`UndoToast.vue`；筛选与保存视图只在任务页，存在 `settings` 的 `tasks.saved_views`。
- `tauri.conf.json` 管窗口、CSP、构建钩子；`capabilities/default.json` 只给 `main`/`capture` 开通知、自启、快捷键、窗口几何等权限。
- 桌面小窗是 `main` 的 widget 形态，没有独立的 `desk` 窗口：窗口从创建起透明、无边框、无系统阴影；`windowModeVM` 管形态切换、最小尺寸/任务栏/置顶、`set_window_rect` 滑行动画（主界面层见 `attachSurface`：进小窗按 WebView 实际视口逐帧缩放，`ResizeObserver` 预绘制同步；回主窗先把窗口一次性改到主窗尺寸、之后只平移，内容用 `scale` 跟随，卡片按 `centerOffset` 钉在屏幕原位，收尾不要再缩放窗口，否则会闪一帧；原生窗口用一次 `SetWindowPos`）、启动落位与隐藏时的直接落位；`DeskView` 画卡片、吸附几何和贴边收放：收起/展开时用 `set_window_rect` 逐帧把窗口和卡片一起缩放，内容先淡出、三点抓手后现，反向从当前矩形继续。开关、层级、位置仍存 `settings` 的 `desk.*` 键，`desk.enabled` 表示当前/启动时是否为小窗形态；默认落点是主显示器工作区右上角，小窗右上角按钮是「回到主窗口」。`desk.controls`（默认开）决定小窗内是否显示开始/挂起/完成按钮；小窗挂起不带日期和原因，主窗口仍保留完整对话框。桌面小窗另有全局快捷键（默认 Ctrl+Alt+W，设置 → 通用可改）：Rust 只在 `desk.enabled` 为真时发 `widget:summon`，前端把置底/隐藏的小窗抬到最前、展开收起的小条，失焦后按原状态收回或隐藏；主窗口快捷键（默认 Ctrl+Alt+M）直接复用 `show_main`。面板 360×500 在窗口中居中，圆角、边框和阴影由 `DeskView` 自绘，收起提示条贴边；原生拖动期间（左键按住）不要移动窗口，吸附等松手后再做。不要改回系统阴影或非透明窗口，否则会出现 1px 白边或无法做小窗。

分层规则：业务规则放 Rust services；前端 View 不碰 `invoke` 或数据库；新增数据流从 `dto.rs` → `ipc.ts` → `types.ts` → ViewModel 一路补齐。少数 overlay（`TaskSheet.vue`、`SettingsModal.vue`、`ProjectSettings.vue`）直接调 `model/ipc`；新逻辑不要照抄，放进 VM 或 service。

## 约定

- TS 严格按 `tsconfig.json`：`verbatimModuleSyntax`（类型用 `import type`）、`noUnusedLocals/Parameters`、`erasableSyntaxOnly`（不要 enum/namespace；用字符串联合）。测试从 `vite-plus/test` 导入，不要直接装 `vitest`。
- 不要新增 `vite` 依赖：`pnpm-workspace.yaml` 把 `vite` 指向 `@voidzero-dev/vite-plus-core`；Vue 锁在 `3.6.0-rc.12`，不要顺手升级。格式化与 lint 走 `vp check`（Oxfmt/Oxlint），仓库没有 Prettier/ESLint 配置。
- Rust：命令是 `async`，通过 `with_db` 访问库；repo 返回 `rusqlite::Result`，service 通常用 `Result<_, String>` 并 `map_err(|e| e.to_string())`。领域拒绝用短 snake_case 码（`empty_title`、`suspend_until_required`、`invalid_status`），测试会断言这些字符串。
- 时间：日期是本地 `YYYY-MM-DD`，时间戳是 RFC3339 UTC；用 `todayIso()` / `chrono::Local` 算今天，别用 UTC 截断。周一为一周起点。
- 输入：所有输入框的回车提交都要先过 `isImeEnter(event)`（`src/lib/keys.ts`），否则中文输入法选词会误提交。
- 任务时间：预计开始 `expected_start_date`、预计完成 `expected_finish_date`/`expected_finish_time` 只到日期（`expected_finish_time` 由周期规则写入），实际开始 `started_at`、实际完成 `actual_finish_at`、实际耗时 `actual_effort_minutes`。四个值都能在任务浮层手改：手改预计完成时，`services/timing.rs` 的 `effort_for_finish` 从「今天或预计开始（取晚者，滚到工作日）」到所选日期的完整工作日数反算预计耗时（1 个工作日 = 480 分钟，最多 60 个工作日），周末选的日期落到之前的周五；改预计耗时或预计开始仍会重算完成日；变晚时写 `delays` reschedule 记录。周期任务（`expected_finish_time` 非空）的完成日由规则写死，手改返回 `rule_owns_finish`；浮层里它的预计开始、预计耗时两格直接禁用（`DateField`/`EffortField` 的 `disabled`），预计完成只读显示日期+时刻，不再另写提示文案。规则里的「开始」是任务的开始时刻，生成任务时 `expected_finish_time = 开始 + 预计耗时`（跨过午夜封顶 23:59、日期不动），v18 迁移把旧规则任务的完成时间按各自 effort 一次性平移过，计时提醒因此也落在新的完成时刻。实际完成与实际耗时互为反算（改完成会把耗时按 开始→完成 重算，改耗时会把完成按 开始 + 耗时 重算，至少 1 分钟）；没有实际开始时填完成/耗时返回 `actual_start_required`（清空仍允许）；有活跃子任务时手改耗时/日期/实际三类字段或状态返回 `parent_derived`；填实际完成会完成任务并移出本周，清空会回到进行中。`TaskPatch` 有 expectedFinishDate 和三个 actual 字段；对可空字段，patch 的“字段缺失”=保持原值，“显式 null”=清空。父任务的状态由子任务推导；勾完最后一条子任务会自动完成父任务并移出本周。**任务浮层是草稿编辑器**：字段、预计/实际时间、状态按钮、逾期备注全都只改本地草稿，点「保存」才由 `taskSheetVM.saveSheet` 按「状态 → 字段/实际时间 → 逾期备注」顺序调用现有命令写库，取消/关闭即丢弃；子任务是例外，增/勾/删立即落库并刷新父任务的汇总值；延期记录点一下就地把原因改成输入框（回车/失焦保存、Esc 取消、空 = 清空），也不走草稿，直接走 `set_delay_reason`（`deliverables::set_reason`，未知记录返回 `delay_not_found`）。实际完成与耗时的互相反算只是 `syncActualPreview` 的表单预览，服务端规则不变，所以保存不是单个事务，中途失败会留下已经写入的前几步。

- 子任务是真任务：`tasks.parent_id` 指向父任务，子任务自己就是一条普通任务（项目/分类/负责人/优先级/预计与实际时间/状态/挂起/提醒/归档全都独立）。**只允许一层**，给子任务再加子任务返回 `nesting_too_deep`。「父任务」= 有活跃子任务（未删除/未归档/未取消）的任务：它的 `effort_minutes`、预计开始/完成、`started_at`、`status`、实际完成/耗时都由子任务汇总（耗时=合计、开始=最早、完成=最晚、状态：全完成=done／有完成或进行中=doing／否则 todo），由 `services/subtasks.rs::refresh` 在子任务变化后写回，不写 `delays`；周期规则生成的父任务（`rule_id` 非空）的 `expected_finish_date`/`expected_finish_time` 仍归规则，派生不会挪动它的日子（否则规则 tick 会为同一天再生成一条），只汇总耗时与状态；手改父任务这些字段返回 `parent_derived`。**排期只看叶子**：本周页/看板/过一遍队列/挂起列表/提醒/统计完成数/项目进度都排除父任务（`repo/tasks.rs::VISIBLE_TASK_FILTER` 里的 `NOT EXISTS` 子查询）；任务页与项目页只列顶层任务（子任务在父行里展开），归档页的「已归档/已完成」只列顶层，「已取消」也列被取消的子任务（在过一遍里取消的子任务从这里恢复；伞已归档时子任务先随伞藏着，恢复伞后再出现，直接恢复返回 `parent_archived`）；全局搜索两样都能搜到。子任务不能从浮层归档，归档的是整件事。子任务默认 480 分钟；模板建任务时按模板工时均分给子任务。挂起/恢复/归档/恢复/取消父任务会级联到子任务；删父任务由外键级联删子任务。老的 `steps` 表已退休：v20 把每行迁成一条子任务，v21 把表删掉，代码不再读写它。浮层里子任务行点标题在同一个抽屉打开它的完整浮层（可返回，父任务的草稿保留），增/勾/删立即落库并刷新汇总。
- 本周集合是显式的 `in_week` 布尔值，不要按日期重算；取消不进统计分母，挂起仍计入。统计页的「完成工时」按 `actual_effort_minutes` 合计，旧行没有记录时才退回预计耗时。
- **等别人**（`waiting`）是挂起的兄弟状态：记 `waiting_on_id`（人员，可空）、`follow_up_date`（本地日期，可空）、`waiting_since`（本地日期）；标记后移出本周、不占工时、不进过一遍队列、不收截止/逾期提醒与每日汇总，但仍计入项目范围与统计分母；本周页在「挂起」上方单列「等别人」区，按跟进日排序，行里写等谁/等了几天/跟进日，「有回复了」= `resume` 回本周队尾；跟进日当天 09:00 提醒（`follow_up`），「改跟进日」重写同一个命令。与挂起互斥（各自清空对方），完成即清等待；从归档页恢复会清等待回本周，撤销归档则保持等待；伞任务标等人级联到未完成子任务，池里按子任务逐条显示。前端入口：行/看板卡片的沙漏、过一遍的 W、任务浮层状态行里的「等别人」按钮（和待办/进行中/已完成同款，等待中高亮；父任务的状态行隐藏，那里用等待条下的小字入口）与实际等待条；`lib/waiting.ts` 管默认值（负责人不是我就选他，跟进日默认今天 +3 天），后端命令是 `wait_task` / `list_waiting`。
- 本周顺序是 `tasks.sort_order`（手动拖拽），`list_week` 与 `pass_queue` 都按它排；`effort_minutes`（分钟，480 = 一人天）既喂给 `src/lib/schedule.ts` 按小时排计划日期，也决定预计完成日——计划日期只显示、不落库，预计完成日落库。
- 本周页拖拽：拖到该任务已经显示的那天只改 `sort_order`；拖到别的天或从挂起区拖入走 `place_task`，写 `expected_start_date`、按「改预计开始」同一条规则重算预计完成（变晚时写一条 `delays` reschedule）、清挂起、加入本周并按落点定序（挂起任务拖入即自动恢复）。设置 `week.show_empty_days`（默认开）让本周页补齐周一到周五没有安排的工作日，空白天可整块投放。本周页列周一到周五，列表里已过去的日子照常显示（弱化 + 「已过去」标），计划可以落在过去：有显式预计开始就按那天排（最早到本周一），没有就从今天排，所以拖回周一真的会排到周一。跨天任务在它覆盖的每个工作日都显示同一张任务卡（`groupPlannedDays` 的 `repeatSpans`，桌面小窗传 `false` 只留开始那天），截到周五；队列把开工推到周五之后的任务，整张卡片夹到周五（行首补「跨周 · 日期 起」，排在当天自有任务之后）；**显式预计开始在本周之后**（下周及更晚）的任务不进本周页：不画卡片、不生成甘特条形，也不计入页头的「预计最晚」、每日负载和「排不进」，下周自然出现（`weekVM` 的 `weekTasks` 过滤；`in_week`、过一遍队列、底部完成/新增/延期统计不变）。这些任务在**页面底部**的「本周之后」卡片堆里：按开始日排序、横排压叠，卡片不带状态点；悬停某张时它上浮一层、后面的卡片让开一格（不上移、不淡出），边框提亮加一层阴影；增删和换位走 `AnimatePresence` + `listItemMotion`（拖拽中的那张由 animate 变到 40%；位移仍由 margin 过渡负责，所以关掉 layout）；卡片带按行宽自动计算压叠步长（`src/lib/deck.ts::stackStep`），任务再多也全部排在这一行内、不出现横向或竖向滚动条；可拖到列表的天区块或甘特图的某一天（`weekDrop.ts` 的 `listDropAt`/`ganttDropAt` 各算各的落点），落点即写预计开始日并重排完成（`place_task`），任务当场回到本周；没有这类任务时整条隐藏。拖动时有一张 **跟随指针的卡片影子**（原卡留在堆里变淡），影子第二行实时写「松开 → 日期 周X 起」，不在本周时写「松开回到「本周之后」」；看板用**整块描边 + 「拖到这里」徽标 + 插入线**标出目标天，拖拽期间页面禁用文字选择；松手不在本周不写库，卡片仍在原堆、按预计开始日期排。已完成的任务离开本周队列后由 `list_week_done` 补回：**实际开始与实际完成都有时，按这两个本地日期之间的工作日铺开**（列表卡片和看板卡片一致；实际开始早于本周就从本周一那列画起，真实工作日数写进「跨 N 天」），否则按落在本周的预计开始铺满计划天数、再不然落在完成那天；每天都是同一张卡（只读、不参与拖拽、标题删除线 + 完成时间）。
- 本周页有两种视图，`settings.week_view`（`list` 默认 / `gantt`，本周页「预计最晚」一行右端的分段切换器，点完即存）决定用哪种：切换时两种视图左右错开淡入淡出（`src/lib/motion.ts::weekViewMotion`：列表在左、甘特图在右，外面套 `AnimatePresence mode="wait"`，根 section 常驻 `flex grow flex-col`，退场的甘特图才不会塌高；`prefers-reduced-motion` 时直接换）；列表按天堆卡片；甘特图（`gantt`）由 `src/lib/plan.ts::groupLanes` 把同一任务散在各天的行折成一条泳道（`from`/`to` 是列号）：一周五列，列头写星期、日期、今天/已过去、当天工时与「太满」；一条任务一行，条横跨它占的列，条内按天有一条淡分隔线；条的颜色沿用卡片皮肤（独占/共享/冲突/已完成）；标题行是状态点 + 任务标题，子任务的条在标题前用 11px 弱化小字写「↳ 上级任务名」再加一条竖线（第二行不再出现上级胶囊，列表行仍用胶囊），悬停时条右上浮出开始/挂起/等别人（和列表行同一条规则：不压第二行）；第二行放排不进/项目/优先级/等别人/共享/工时与跨天说明；点条开浮层，左右拖改开始日（落进它已覆盖的列只改顺序）、上下拖改顺序，方向键上下改顺序；过去的日子只做淡色 + 列头「已过去」，不再压叠；底部「本周之后」拖进来按落点列高亮（落点计算见 `src/lib/weekDrop.ts::ganttDropAt`）。两种视图共用列表的 `listDropAt`/`anchorFor`，只是甘特图按列+泳道换算。桌面小窗（DeskView）始终是列表，不跟这个设置。
- 记一句：符号是 `#项目 @负责人 !高/中/低 ~预计耗时`；`^日期` 已移除。`#名字` 匹配不到已有项目时当作待建项目（名字取到空白/标点为止），保存时由 `capture_with_project` 在同一事务里新建（同名活跃项目则复用）并归入任务，任务插入失败则项目一起回滚。AI 补字段只填项目/分类/负责人/标签，**不猜日期**；任务在补字段期间被手动改过就放弃本次补齐。
- 新任务、新周期任务、新模板默认独占（`exclusive`）：独占任务只占其 effort 对应的小时位（480 分钟 = 8 个小时位），其他任务可补进剩下的小时；共享任务可并行；已有任务/规则/模板保持原标志，不做数据迁移。显式预计开始日期优先于手动队列。
- UI：文案走 `src/lib/i18n.ts` 的 `t()`，不要在组件里硬编码中文/英文；Rust 运行时文案（托盘、通知）走 `src-tauri/src/i18n.rs`。用 daisyUI 的 `soft`/`soft-dark` 主题 token 和 Tailwind 类，不要写死颜色；图标用 `@lucide/vue` 并加 `aria-hidden`。界面日期显示用 `shortDate`（`11/20`）。
- 界面先出图：新增、删除或改版界面的布局、层级、交互前，先画出静态稿（HTML/SVG 或截图）确认关键状态；纯文案、颜色、间距微调可直接改。凡是涉及 UI 的变更，先把图给我看、等我确认，确认之后才动代码。
- 迁移只追加：在 `migrations.rs` 末尾加 `if version < N` 并提高 `LATEST`，不要改旧迁移或重排版本。升级旧库前 `open_with_recovery` 会备份到 `backups/pre-migration-v{n}.db`。
- 提交用 Conventional Commits：`feat:`、`fix:`、`chore:`、`refactor:`、`polish:`，主题小写、单句。

## 测试

- TS 测试放在被测模块旁的 `__tests__/*.test.ts`。ViewModel 测试先用 `vi.mock("../../model/ipc", ...)`，再用 `createXVM()` 建实例；通用 `task()`/`defaultSettings` 在 `src/viewmodels/__tests__/fixtures.ts`，不要另造一套。
- Rust 测试直接写在源文件底部的 `#[cfg(test)] mod tests`，用 `db::open_in_memory()`，固定 `NOW` 字符串，文件操作放临时目录并在结尾清理。改动周界/日期/提醒/排期逻辑时，补周一凌晨、跨年、14 天补报、跨周末推算这类边界用例（现有测试在 `services/week.rs`、`services/timing.rs`、`reminders/rules.rs`）。
- 没有组件/E2E 测试；界面和托盘行为靠 README 的手工冒烟清单验收（发布前逐条走）。

## Git 与发布

- 默认分支 `main`；没有 PR 模板或 CI。提交保持小而单一。
- 版本号同时写在 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`，升版本时三处一起改。
- 发布用 `pnpm tauri build`，然后按 README 的“装好后逐条打勾”验收（托盘、提醒、快捷键、IME、重复提醒等）。
- 不要提交生成物/本地状态：`dist/`、`src-tauri/target/`、`src-tauri/gen/schemas`、`.agents/`、`.claude/`、`.superpowers/`、`.codegraph/`、`skills-lock.json`（后几项也已在 `.gitignore`）。

## 安全与坑

- API key 只进 Windows 凭据管理器（service `ordo`，account `deepseek`），不进设置表、导出 JSON、备份或日志；不要把它写进 `.env` 或测试夹具。
- 唯一联网行为是 AI 补字段；保持“捕获立即落库，AI 异步补，失败静默”。前端不要 await AI 再保存。
- CSP 在 `tauri.conf.json` 的 `connect-src` 只放行自身、Tauri IPC 和 `https://api.deepseek.com`；能力清单只开必要插件。新增插件要同时改 `lib.rs`、`capabilities/default.json` 和依赖清单，别开 shell/fs 通配。
- 数据库损坏时启动流程会保留坏文件（`ordo.db.corrupt-*`）和 `-wal`，从最新可用备份恢复；文件整个缺失但备份还在时同样恢复。不要让代码静默重建或删除。备份与迁移副本都先写临时名再改名，残缺的那份不算数。动这块先跑 `db/mod.rs` 的恢复测试。
- 真实数据库（`%APPDATA%\com.ordo.taskbook`）不要手工清理、重置或跑破坏性 SQL；要动先确认。测试用 `db::open_in_memory()` 或临时目录。
- 主窗口关闭只是隐藏到托盘，退出走托盘菜单；首次关闭会提示一次。别把关闭改回直接退出。
- 改全局快捷键失败时必须回滚旧键（`services/shortcut.rs`），不要留下半失效状态。
- 通知按钮（「1 小时后」/「明天 09:00」）只有在**注册了 action type 且存在 Rust `on_action` handler** 时才会出现（插件在 `has_listeners()` 为真时才走 tracked 路径，按钮来自 `register_action_types`）；改提醒的显示方式时别把这两件事拆开。点击通知正文与点按钮都走同一个 handler，汇总通知的目标是「本周页」而不是任务。
- 主窗口的 `html`/`body` 是 `overflow: hidden`（`src/style.css`）：从窗口边缘滑入的固定定位抽屉（任务浮层）在动画途中会越过视口，Chrome 把这段溢出算成文档滚动条，滚动条高度又从 `100vh` 里扣掉，整个界面就会「上移几像素」抖一下；别把这条当成多余的样式删掉。
- 主题：只有显式选了浅/深色才 `setTheme` 钉原生窗口；`setTheme` 会经 wry 把 WebView 的 `prefers-color-scheme` 一起钉住，所以“跟随系统”必须 `setTheme(null)` 后读 `theme()` 的系统值，不要用 `matchMedia`。
- Windows 通知收进通知中心后再点，系统不会告诉 Ordo 是哪一条；只有提示条还在屏幕上时点击才能定位任务。这是平台限制，不是待修 bug。
- `docs/superpowers/specs/2026-10-20-ordo-architecture.md` 是草案，和代码有出入（例如托盘在 `lib.rs`、主题在 `src/style.css`）；以源码为准。

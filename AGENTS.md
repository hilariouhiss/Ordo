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

# ordo — 开发指南

## 项目概览

ordo 是单机个人任务账本桌面应用：一句话捕获、每周过一遍、项目进度与时间轴、延期记录、归档与提醒，数据只在本机。技术栈是 Tauri 2.12 + Rust（2024 edition，最低 1.90）、Vue 3.6 RC + TypeScript、Vite+ 1.2（`vp`）、Tailwind 4 + daisyUI 5、SQLite（rusqlite bundled）。Windows 优先，界面支持中英文；未手动选择时跟随系统 UI 语言，设置里可切换。

顶层：`src/` 是 WebView 前端；`src-tauri/` 是 Rust 核心；`docs/superpowers/specs/` 是设计与架构意图，`docs/superpowers/plans/` 是实现计划（历史记录，不是当前文件清单）。

## 安装与运行

- `vp`（Vite+ CLI）需在 PATH；pnpm 12.14.0 由 `package.json` 的 `devEngines` 固定；Rust 不低于 `src-tauri/Cargo.toml` 的 `rust-version = "1.90"`。
- `vp install` — 安装依赖；`prepare` 脚本执行 `vp config`，把 git hooks 接到 `.vite-hooks/`。
- `pnpm tauri dev` — 完整桌面应用（启动 Vite :1420 + Rust）。改数据、托盘、提醒、IPC 都用它。
- `vp dev` — 只跑前端，端口 1420；浏览器里没有 Tauri IPC，数据相关操作会失败。
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
- `src-tauri/src/services/`：业务规则（本周集合、过一遍、状态推导、统计、延期、归档、导出）。函数同步接收 `&Connection`，需要时间的传入 `now`/`today` 字符串以便测试。
- `src-tauri/src/repo/`：可复用的 SQL 与事务；服务层也会写少量针对性查询。只有 Rust 侧碰数据库。
- `src-tauri/src/db/`：连接 PRAGMA、迁移、损坏恢复。`migrations.rs` 用 `PRAGMA user_version` 做单向迁移。
- `src-tauri/src/reminders/`：独立线程每 30 秒 tick，启动即跑一次；通知去重靠 `notifications` 表唯一键；补报最近 14 天。提醒不能交给前端定时器。
- `src-tauri/src/ai/`：DeepSeek（OpenAI 兼容）请求、prompt、结果校验。`keyring` 保存 key；AI 默认关闭，没 key 不发请求。
- `src-tauri/src/dto.rs` / `state.rs`：IPC DTO（serde `camelCase`）与 `AppState`/`with_db`（`spawn_blocking` 包住数据库锁）。
- 前端：`src/model/ipc.ts` 是唯一调用 `invoke` 的地方；状态用 VM 的 `reactive`，不引入 Pinia；`types.ts` 镜像 Rust DTO；`viewmodels/` 是 Vue `reactive` + 动作的工厂，页面级单例在文件底部导出；`views/` 只做绑定；`lib/` 放日期、IME、主题、时间轴等工具。
- `src/main.ts` 按窗口 label 只分 `capture` 与 main（挂 `App.vue`）；桌面小窗由 App 内嵌 `DeskView`，只有一个 `index.html`，不要新增构建入口。
- 应用内快捷键：`App.vue` 监听 `Ctrl+N` / `Ctrl+Shift+N`，打开根级 `QuickCreate` 浮层（主窗口和小窗都可见；迷你捕获窗口没有）；任务浮层、设置、过一遍、确认框、项目设置打开或形态动画中忽略，不注册全局快捷键。
- `tauri.conf.json` 管窗口、CSP、构建钩子；`capabilities/default.json` 只给 `main`/`capture` 开通知、自启、快捷键、窗口几何等权限。
- 桌面小窗是 `main` 的 widget 形态，没有独立的 `desk` 窗口：窗口从创建起透明、无边框、无系统阴影；`windowModeVM` 管形态切换、最小尺寸/任务栏/置顶、`set_window_rect` 滑行动画（主界面层见 `attachSurface`：进小窗按 WebView 实际视口逐帧缩放，`ResizeObserver` 预绘制同步；回主窗先把窗口一次性改到主窗尺寸、之后只平移，内容用 `scale` 跟随，卡片按 `centerOffset` 钉在屏幕原位，收尾不要再缩放窗口，否则会闪一帧；原生窗口用一次 `SetWindowPos`）、启动落位与隐藏时的直接落位；`DeskView` 画卡片、吸附几何和贴边收放：收起/展开时用 `set_window_rect` 逐帧把窗口和卡片一起缩放，内容先淡出、三点抓手后现，反向从当前矩形继续。开关、层级、位置仍存 `settings` 的 `desk.*` 键，`desk.enabled` 表示当前/启动时是否为小窗形态；默认落点是主显示器工作区右上角，小窗右上角按钮是「回到主窗口」。`desk.controls`（默认开）决定小窗内是否显示开始/挂起/完成按钮；小窗挂起不带日期和原因，主窗口仍保留完整对话框。桌面小窗另有全局快捷键（默认 Ctrl+Alt+W，设置 → 通用可改）：Rust 只在 `desk.enabled` 为真时发 `widget:summon`，前端把置底/隐藏的小窗抬到最前、展开收起的小条，失焦后按原状态收回或隐藏；主窗口快捷键（默认 Ctrl+Alt+M）直接复用 `show_main`。面板 360×500 在窗口中居中，圆角、边框和阴影由 `DeskView` 自绘，收起提示条贴边；原生拖动期间（左键按住）不要移动窗口，吸附等松手后再做。不要改回系统阴影或非透明窗口，否则会出现 1px 白边或无法做小窗。

分层规则：业务规则放 Rust services；前端 View 不碰 `invoke` 或数据库；新增数据流从 `dto.rs` → `ipc.ts` → `types.ts` → ViewModel 一路补齐。少数 overlay（`TaskSheet.vue`、`SettingsModal.vue`、`ProjectSettings.vue`）直接调 `model/ipc`；新逻辑不要照抄，放进 VM 或 service。

## 约定

- TS 严格按 `tsconfig.json`：`verbatimModuleSyntax`（类型用 `import type`）、`noUnusedLocals/Parameters`、`erasableSyntaxOnly`（不要 enum/namespace；用字符串联合）。测试从 `vite-plus/test` 导入，不要直接装 `vitest`。
- 不要新增 `vite` 依赖：`pnpm-workspace.yaml` 把 `vite` 指向 `@voidzero-dev/vite-plus-core`；Vue 锁在 `3.6.0-rc.12`，不要顺手升级。格式化与 lint 走 `vp check`（Oxfmt/Oxlint），仓库没有 Prettier/ESLint 配置。
- Rust：命令是 `async`，通过 `with_db` 访问库；repo 返回 `rusqlite::Result`，service 通常用 `Result<_, String>` 并 `map_err(|e| e.to_string())`。领域拒绝用短 snake_case 码（`empty_title`、`suspend_until_required`、`invalid_status`），测试会断言这些字符串。
- 时间：日期是本地 `YYYY-MM-DD`，时间戳是 RFC3339 UTC；用 `todayIso()` / `chrono::Local` 算今天，别用 UTC 截断。周一为一周起点。
- 输入：所有输入框的回车提交都要先过 `isImeEnter(event)`（`src/lib/keys.ts`），否则中文输入法选词会误提交。
- 任务编辑：`TaskPatch` 里没有 dueDate；改截止日必须走 `set_due`，否则不会写 `delays` 记录。对可空字段，patch 的“字段缺失”=保持原值，“显式 null”=清空。有步骤的任务状态由步骤推导；勾完最后一步会自动完成并移出本周。
- 本周集合是显式的 `in_week` 布尔值，不要按日期重算；取消不进统计分母，挂起仍计入。
- 本周顺序是 `tasks.sort_order`（手动拖拽），`list_week` 与 `pass_queue` 都按它排；`effort_minutes`（分钟，480 = 一人天）只喂给 `src/lib/schedule.ts` 按小时排计划日期——计划只显示、不落库、不写 `delays`、不触发提醒。
- 新任务、新周期任务、新模板默认独占（`exclusive`）：独占任务只占其 effort 对应的小时位（480 分钟 = 8 个小时位），其他任务可补进剩下的小时；共享任务可并行；已有任务/规则/模板保持原标志，不做数据迁移。显式开始日期优先于手动队列。
- UI：文案走 `src/lib/i18n.ts` 的 `t()`，不要在组件里硬编码中文/英文；Rust 运行时文案（托盘、通知）走 `src-tauri/src/i18n.rs`。用 daisyUI 的 `soft`/`soft-dark` 主题 token 和 Tailwind 类，不要写死颜色；图标用 `@lucide/vue` 并加 `aria-hidden`。界面日期显示用 `shortDate`（`11/20`）。
- 迁移只追加：在 `migrations.rs` 末尾加 `if version < N` 并提高 `LATEST`，不要改旧迁移或重排版本。升级旧库前 `open_with_recovery` 会备份到 `backups/pre-migration-v{n}.db`。
- 提交用 Conventional Commits：`feat:`、`fix:`、`chore:`、`refactor:`、`polish:`，主题小写、单句。

## 测试

- TS 测试放在被测模块旁的 `__tests__/*.test.ts`。ViewModel 测试先用 `vi.mock("../../model/ipc", ...)`，再用 `createXVM()` 建实例；通用 `task()`/`step()`/`defaultSettings` 在 `src/viewmodels/__tests__/fixtures.ts`，不要另造一套。
- Rust 测试直接写在源文件底部的 `#[cfg(test)] mod tests`，用 `db::open_in_memory()`，固定 `NOW` 字符串，文件操作放临时目录并在结尾清理。改动周界/日期/提醒逻辑时，补周一凌晨、跨年、14 天补报这类边界用例（现有测试在 `services/week.rs`、`reminders/rules.rs`）。
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
- 数据库损坏时启动流程会保留坏文件（`ordo.db.corrupt-*`）和 `-wal`，从最新可用备份恢复；不要让代码静默重建或删除。动这块先跑 `db/mod.rs` 的恢复测试。
- 真实数据库（`%APPDATA%\com.ordo.taskbook`）不要手工清理、重置或跑破坏性 SQL；要动先确认。测试用 `db::open_in_memory()` 或临时目录。
- 主窗口关闭只是隐藏到托盘，退出走托盘菜单；首次关闭会提示一次。别把关闭改回直接退出。
- 改全局快捷键失败时必须回滚旧键（`services/shortcut.rs`），不要留下半失效状态。
- 主题：只有显式选了浅/深色才 `setTheme` 钉原生窗口；`setTheme` 会经 wry 把 WebView 的 `prefers-color-scheme` 一起钉住，所以“跟随系统”必须 `setTheme(null)` 后读 `theme()` 的系统值，不要用 `matchMedia`。
- Windows 通知收进通知中心后再点，系统不会告诉 ordo 是哪一条；只有提示条还在屏幕上时点击才能定位任务。这是平台限制，不是待修 bug。
- `docs/superpowers/specs/2026-10-20-ordo-architecture.md` 是草案，和代码有出入（例如托盘在 `lib.rs`、主题在 `src/style.css`）；以源码为准。

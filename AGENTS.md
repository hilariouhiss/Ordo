# AGENTS.md

## What this is

`ordo` is a desktop task/project manager built with **Tauri 2** (Rust backend + SolidJS web frontend). The v1 feature set is implemented and works end to end: a single-level task tree with tags/priority/due dates/complexity, four task views, projects with a read-only three-lane board, namespaces, dependencies with soft blocking, repeating tasks, desktop reminders, comments, time tracking, FTS5 search, statistics, the system tray, the global quick-add window, JSON backup/restore, and the startup switch. The backend registers 43 commands (`src-tauri/src/commands.rs`); schema is at migration V9.

Outstanding verification work (animation/accessibility review, three-platform checks) is listed in `docs/DECISIONS.md`§4. The performance targets are measured — see `docs/ARCHITECTURE.md`§6.1.

## Stack / layout

- **Frontend:** SolidJS + TypeScript + Vite, in `src/`. Routing via **TanStack Router** (`src/router.tsx`); styling via **Tailwind CSS v4** (CSS-first, entry `src/index.css`).
- **Frontend libraries (installed, use as needed):** `@kobalte/core` (headless UI primitives — Dialog/Popover/Dropdown/Select/Tabs/Tooltip), `lucide-solid` (icons), `date-fns` (dates), `zod` (validation).
- **Backend:** Rust, in `src-tauri/`, layered as `commands.rs` → `services.rs` → `repositories.rs` → `models.rs` / `db.rs`. Crate is `ordo_lib` (`src-tauri/src/lib.rs`); the binary is `ordo` (`src-tauri/src/main.rs`).
- **Persistence:** SQLite via `rusqlite` (bundled), migrations via `refinery` (embedded `.sql` files in `src-tauri/migrations/`). IDs are UUIDs, timestamps ISO-8601 UTC, soft delete via `deleted_at`.
- **Config:** `src-tauri/tauri.conf.json` (Tauri), `src-tauri/capabilities/default.json` (permissions), `vite.config.ts` + `vitest.config.ts`.
- **Package manager:** pnpm (`pnpm-lock.yaml`; `tauri.conf.json` invokes `pnpm dev`/`pnpm build`). Use pnpm, not npm/yarn.

## Commands

- `pnpm dev` / `pnpm start` — Vite dev server only (frontend, no Rust window).
- `pnpm build` — Vite production build of the frontend only (`dist/`).
- `pnpm serve` — preview the built frontend.
- `pnpm typecheck` — `tsc --noEmit` (no ESLint/Prettier configured).
- `pnpm test` — Vitest (unit tests); `pnpm test:watch` for watch mode.
- `pnpm tauri dev` — full app in dev mode (runs `pnpm dev` then launches the Rust window).
- `pnpm tauri build` — full release build/bundle.
- Rust (inside `src-tauri/`): `cargo check`, `cargo test`, `cargo build`. No CI runs the linters, so run them by hand — `cargo fmt` (the tree is rustfmt-clean, default config) and `cargo clippy --all-targets -- -D warnings` must both come back silent.
- `pwsh -File scripts/perf-acceptance.ps1` — Q-01 performance acceptance: release build, bundle size, per-command round trips, cold/hot start. Add `-SkipBuild` to reuse existing artifacts. Details and the recorded numbers: `docs/ARCHITECTURE.md`§6.1.

## Documentation

`docs/` holds one descriptive document set in five parts — it describes what the code **is**, with no plans, milestone tables, or change logs. Read the part that matches the area:

- **`docs/README.md`** — orientation: what Ordo is, the glossary, and which part to read next.
- **`docs/PRODUCT.md`** — user-visible behavior: tasks and the single-level child-task rules, the four views, projects and the board, namespaces, reminders, dependencies and soft blocking, time tracking, search, statistics, desktop capabilities, and the non-functional targets. Read before implementing a feature or changing behavior.
- **`docs/ARCHITECTURE.md`** — structure: layering and module boundaries, the full directory layout, state management and the optimistic data flow, routes, the design system, the command and event surface, build/capability conventions, and the gotcha list. Read before changing structure, module boundaries, or the command surface.
- **`docs/DATA.md`** — tables and fields, the V1–V9 migration history, indexes and asserted query plans, the backup document format, and the stats definitions. Read before touching the data model, adding a migration, or changing an aggregate query.
- **`docs/DECISIONS.md`** — ADRs and the **ID index**: source comments refer to work by ID (`R7c`, `V7`, `D-02`, `ST-01`, `BV-03`…), so look the ID up here. §4 lists the outstanding gaps.

**Rule: keep docs in sync with code.** Behavior changes update `PRODUCT.md`; a structure, module-boundary, command-surface, or design-system change updates `ARCHITECTURE.md`; a data-model, migration, backup-format, or stats-definition change updates `DATA.md`; a new decision or ID updates `DECISIONS.md` — each in the same commit as the code. Doc claims must be checkable against the code: if the two disagree, the code wins and the doc gets fixed. Don't add planning or historical documents; outstanding work belongs in `DECISIONS.md`§4.

## Backend architecture & conventions

- **Layer rules:** Tauri commands (`commands.rs`) are thin wrappers over services (`services.rs`); services hold business logic and orchestrate repositories (`repositories.rs`); repositories are the *only* layer that writes SQL. Models (`models.rs`) define serde-serializable types. `db.rs` owns connection + migration setup.
- **Migrations:** add a new `src-tauri/migrations/V<N>__<name>.sql` file (increasing `N`) and it is embedded at compile time via `refinery::embed_migrations!` in `db.rs`. Never edit an already-applied migration — add a new one.
- **Data conventions:** primary keys are TEXT UUID v4 (`uuid` crate); timestamps ISO-8601 UTC (`chrono`); soft-delete with a nullable `deleted_at` column instead of hard `DELETE`.
- The SQLite connection is shared as Tauri managed state (`db::Db = Arc<Mutex<Connection>>`; the `Arc` is what lets the reminder thread share it with the command handlers). Commands access it via `State<'_, Db>`, and every database access in the process serializes on that one mutex.
- Errors: return `AppError` (`src-tauri/src/error.rs`) through the layers; it implements `From` for `rusqlite::Error` and `refinery::Error`.

## Important gotchas

- **This is NOT React.** Files use `.tsx` and `jsxImportSource` is `solid-js`. Use Solid idioms: `createSignal`, `render` from `solid-js/web`, `class` (not `className`), and no `useState`/`useEffect`.
- Tauri commands are defined in `src-tauri/src/commands.rs` with `#[tauri::command]`, registered in `lib.rs`'s `.invoke_handler(...)`, and called from the frontend via `invoke` from `@tauri-apps/api/core`. Register each under its canonical `<domain>:<action>` name with `#[tauri::command(rename = "task:list")]` (Rust fn stays a valid identifier like `task_list`); argument keys are camelCase on the JS side (Tauri 2 default).
- **Tailwind v4 is CSS-first** — there is no `tailwind.config.js` or PostCSS config. Configure the theme via the `@theme` block in `src/index.css`; the plugin is registered in `vite.config.ts` as `tailwindcss()`.
- **rusqlite is pinned to `0.39`** because `refinery 0.9.2` requires `rusqlite <= 0.39`. Do not bump `rusqlite` past 0.39 unless you also upgrade `refinery` to a version that supports it (otherwise `cargo` fails on a `libsqlite3-sys` version conflict).
- New Tauri plugins or capabilities must be added to `src-tauri/capabilities/default.json` (currently `autostart:default`, `core:default`, `core:window:allow-hide`, `dialog:default`, `notification:default`, `opener:default`); otherwise the frontend cannot call them. Plugins driven entirely from Rust (tray, global shortcut) need no entry.
- Do NOT remove `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` from `src-tauri/src/main.rs` — it suppresses a console window in Windows release builds.
- The crate's `_lib` suffix in `src-tauri/Cargo.toml` (`name = "ordo_lib"`) is required on Windows to avoid a lib/binary name clash (see Cargo issue #8519).
- Vite dev server is pinned to port **1420** with `strictPort: true` (HMR on 1421); it fails if that port is taken, and it ignores changes under `src-tauri/`.
- `tsconfig.json` sets `noEmit: true` and `allowImportingTsExtensions: true` — typecheck with `tsc`, imports are bundled by Vite.
- Animations should use CSS transitions/transforms or Web Animations; drag-and-drop should use the native Drag API. Do not add animation/dnd libraries in this first version.
- The system tray (D-01) needs the `tray-icon` feature on the `tauri` crate (set in `src-tauri/Cargo.toml`); without it `tauri::tray` does not exist. Tray actions look the window up by label `main` (`src-tauri/src/tray.rs::MAIN_WINDOW`) — keep that in sync with `tauri.conf.json` and `capabilities/default.json`. The tray is built in Rust, so it needs no capability entry.
- The quick-add shortcut (D-02) is registered from Rust (`src-tauri/src/shortcut.rs`), so it needs no `global-shortcut:*` capability; the `quick-add` window hides itself from the webview, which does need `core:window:allow-hide` in `capabilities/default.json` — and that file's `windows` array must list both `main` and `quick-add`, or the small window silently loses every IPC call it makes. Capability names are validated by `tauri-build` at compile time — a typo fails the build, not the user's click. Both windows load the same `index.html`; `src/index.tsx` picks the view from the window label, so the label string is duplicated in Rust and TypeScript — change them together. The window's input grammar lives in `src/features/tasks/quick-add-parse.ts` (pure, table-tested): when adding a phrase, keep the "never guess, only strip what resolved" rule, or titles start losing text.
- **Kobalte's `Select` fires `onChange` once on mount with the initial value.** Anything that treats `onChange` as "the user picked" must ignore a call whose value equals the current one (`src/app/QuickAddWindow.tsx`); otherwise merely rendering the control registers a choice. Its `optionValue` is the option's identity, and returning `""` reads as "nothing selected" — the trigger renders blank, so use a real sentinel string.
- The startup switch (D-04) calls `@tauri-apps/plugin-autostart` from the settings page, so it needs `autostart:default` in `capabilities/default.json`. The OS login-item list is the only source of truth — read it back (`isEnabled()`) after every write instead of caching the value in the `settings` table, or the switch starts lying about what the system will do. Nothing enables it on its own: off-by-default means an empty login-item list, not a stored flag. Enabling it in `pnpm tauri dev` registers the dev binary path.
- **侧边栏按命名空间分组，判定归属用的是「存活命名空间集合」而不是 `namespaceId` 是否为空**（`src/features/namespaces/store.ts`）。所以命名空间被软删/不存在时，其项目回落为「未归属」显示在根级，而不是从导航里消失；**归档**命名空间仍算存活——它的项目缩进显示在侧边栏「已归档」区。每个项目只出现在一处（分组行 / 根级平铺 / 已归档平铺 / 已归档分组），改动这几个派生时要一起想清楚。
- `cargo build` produces a **dev-mode** binary that loads `build.devUrl` (`http://localhost:1420`), so it shows a connection error unless `pnpm dev` is running. Use `pnpm tauri dev` or `pnpm tauri build` to run the app the way users do.

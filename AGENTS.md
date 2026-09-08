# AGENTS.md

## What this is

`ordo` is a desktop task/project manager built with **Tauri 2** (Rust backend + SolidJS web frontend). It is currently at the scaffold stage: the full stack is wired up and compiles, but business logic is not implemented yet. The only custom command is a demo `greet` that echoes a name back from Rust.

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
- Rust (inside `src-tauri/`): `cargo check`, `cargo test`, `cargo build`.

## Documentation

Product and design documents live in `docs/`. Read them before working on the relevant area:

- **`docs/PRD.md`** — product requirements: feature scope, priorities, milestones, and non-functional targets (performance, size, UX). Read before implementing any feature or changing behavior.

**Rule: keep docs in sync with code.** Every change to behavior, scope, data model, or a non-functional target must update the corresponding document in `docs/` (currently `docs/PRD.md`) in the same commit. If a change introduces a new area that lacks a doc, add one.

## Backend architecture & conventions

- **Layer rules:** Tauri commands (`commands.rs`) are thin wrappers over services (`services.rs`); services hold business logic and orchestrate repositories (`repositories.rs`); repositories are the *only* layer that writes SQL. Models (`models.rs`) define serde-serializable types. `db.rs` owns connection + migration setup.
- **Migrations:** add a new `src-tauri/migrations/V<N>__<name>.sql` file (increasing `N`) and it is embedded at compile time via `refinery::embed_migrations!` in `db.rs`. Never edit an already-applied migration — add a new one.
- **Data conventions:** primary keys are TEXT UUID v4 (`uuid` crate); timestamps ISO-8601 UTC (`chrono`); soft-delete with a nullable `deleted_at` column instead of hard `DELETE`.
- The SQLite connection is shared as Tauri managed state (`db::Db = Mutex<Connection>`). Commands access it via `State<'_, Db>`.
- Errors: return `AppError` (`src-tauri/src/error.rs`) through the layers; it implements `From` for `rusqlite::Error` and `refinery::Error`.

## Important gotchas

- **This is NOT React.** Files use `.tsx` and `jsxImportSource` is `solid-js`. Use Solid idioms: `createSignal`, `render` from `solid-js/web`, `class` (not `className`), and no `useState`/`useEffect`.
- Tauri commands are defined in `src-tauri/src/commands.rs` with `#[tauri::command]`, registered in `lib.rs`'s `.invoke_handler(...)`, and called from the frontend via `invoke` from `@tauri-apps/api/core`.
- **Tailwind v4 is CSS-first** — there is no `tailwind.config.js` or PostCSS config. Configure the theme via the `@theme` block in `src/index.css`; the plugin is registered in `vite.config.ts` as `tailwindcss()`.
- **rusqlite is pinned to `0.39`** because `refinery 0.9.2` requires `rusqlite <= 0.39`. Do not bump `rusqlite` past 0.39 unless you also upgrade `refinery` to a version that supports it (otherwise `cargo` fails on a `libsqlite3-sys` version conflict).
- New Tauri plugins or capabilities must be added to `src-tauri/capabilities/default.json` (currently `core:default` and `opener:default`); otherwise the frontend cannot call them.
- Do NOT remove `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` from `src-tauri/src/main.rs` — it suppresses a console window in Windows release builds.
- The crate's `_lib` suffix in `src-tauri/Cargo.toml` (`name = "ordo_lib"`) is required on Windows to avoid a lib/binary name clash (see Cargo issue #8519).
- Vite dev server is pinned to port **1420** with `strictPort: true` (HMR on 1421); it fails if that port is taken, and it ignores changes under `src-tauri/`.
- `tsconfig.json` sets `noEmit: true` and `allowImportingTsExtensions: true` — typecheck with `tsc`, imports are bundled by Vite.
- Animations should use CSS transitions/transforms or Web Animations; drag-and-drop should use the native Drag API. Do not add animation/dnd libraries in this first version.

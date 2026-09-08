# AGENTS.md

## What this is

`ordo` is a desktop app built with **Tauri 2** (Rust backend + web frontend). It is currently the stock "Tauri + Solid + TypeScript" template at the hello-world stage: the only custom behavior is a `greet` command that echoes a name back from Rust.

## Stack / layout

- **Frontend:** SolidJS + TypeScript + Vite. Lives in `src/` (`App.tsx`, `index.tsx`, `App.css`).
- **Backend:** Rust, in `src-tauri/`. Crate is named `ordo_lib` (`src-tauri/src/lib.rs`); the binary is `ordo` (`src-tauri/src/main.rs`).
- **Config:** `src-tauri/tauri.conf.json` (Tauri), `src-tauri/capabilities/default.json` (permissions), `vite.config.ts` (Vite).
- **Package manager:** pnpm (`pnpm-lock.yaml`; `tauri.conf.json` invokes `pnpm dev`/`pnpm build`). Use pnpm, not npm/yarn.

## Commands

- `pnpm dev` / `pnpm start` — Vite dev server only (frontend, no Rust window).
- `pnpm build` — Vite production build of the frontend only (`dist/`).
- `pnpm serve` — preview the built frontend.
- `pnpm tauri dev` — full app in dev mode (runs `pnpm dev` then launches the Rust window).
- `pnpm tauri build` — full release build/bundle.
- `pnpm exec tsc --noEmit` — typecheck the frontend (no script alias exists).
- Rust: run inside `src-tauri/` via `cargo build` / `cargo run`, but prefer the `pnpm tauri ...` wrappers.

No lint tool (ESLint/Prettier) and no test framework are configured.

## Important gotchas

- **This is NOT React.** Files use `.tsx` and `jsxImportSource` is `solid-js`. Use Solid idioms: `createSignal`, `render` from `solid-js/web`, `class` (not `className`), and no `useState`/`useEffect`.
- Tauri commands are defined in `src-tauri/src/lib.rs` with `#[tauri::command]`, registered in `.invoke_handler(...)`, and called from the frontend via `invoke` from `@tauri-apps/api/core`.
- New Tauri plugins or capabilities must be added to `src-tauri/capabilities/default.json` (currently `core:default` and `opener:default`); otherwise the frontend cannot call them.
- Do NOT remove `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` from `src-tauri/src/main.rs` — it suppresses a console window in Windows release builds.
- The crate's `_lib` suffix in `src-tauri/Cargo.toml` (`name = "ordo_lib"`) is required on Windows to avoid a lib/binary name clash (see Cargo issue #8519).
- Vite dev server is pinned to port **1420** with `strictPort: true` (HMR on 1421); it fails if that port is taken, and it ignores changes under `src-tauri/`.
- `tsconfig.json` sets `noEmit: true` and `allowImportingTsExtensions: true` — typecheck with `tsc`, imports are bundled by Vite.

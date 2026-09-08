//! Data access layer: SQL queries against `rusqlite::Connection`.
//!
//! Repositories are the only layer that touches SQL directly. They take a
//! `&Connection` (owned by Tauri state via `manage`), map rows to `models`, and
//! return `Result<_, AppError>`.

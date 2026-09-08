//! Tauri command handlers (the IPC boundary between SolidJS and Rust).
//!
//! Each `#[tauri::command]` is a thin wrapper that locks the managed
//! connection and delegates to the services layer. Commands register under
//! their canonical `<domain>:<action>` name via `rename = "..."`, so the
//! frontend `COMMANDS` constants in `src/common/ipc/commands.ts` match
//! verbatim. Argument keys are camelCase on the JS side (Tauri's default).

use rusqlite::Connection;
use tauri::State;
use uuid::Uuid;

use crate::db::Db;
use crate::error::AppError;
use crate::models::{
    NewSubtask, NewTag, NewTask, Subtask, Tag, Task, TaskWithTags, UpdateSubtask, UpdateTag,
    UpdateTask,
};
use crate::services;

/// Locks the managed connection and runs `f` against it.
fn with_conn<T>(
    db: &Db,
    f: impl FnOnce(&Connection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let conn = db
        .lock()
        .map_err(|_| AppError::Db("数据库连接锁失效".into()))?;
    f(&conn)
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

// --- task:* ----------------------------------------------------------------

#[tauri::command(rename = "task:list")]
pub fn task_list(db: State<'_, Db>) -> Result<Vec<TaskWithTags>, AppError> {
    with_conn(&db, services::list_tasks)
}

#[tauri::command(rename = "task:create")]
pub fn task_create(db: State<'_, Db>, payload: NewTask) -> Result<Task, AppError> {
    with_conn(&db, |conn| services::create_task(conn, payload))
}

#[tauri::command(rename = "task:update")]
pub fn task_update(
    db: State<'_, Db>,
    task_id: Uuid,
    payload: UpdateTask,
) -> Result<Task, AppError> {
    with_conn(&db, |conn| services::update_task(conn, task_id, payload))
}

#[tauri::command(rename = "task:complete")]
pub fn task_complete(db: State<'_, Db>, task_id: Uuid) -> Result<Task, AppError> {
    with_conn(&db, |conn| services::complete_task(conn, task_id))
}

#[tauri::command(rename = "task:softDelete")]
pub fn task_soft_delete(db: State<'_, Db>, task_id: Uuid) -> Result<(), AppError> {
    with_conn(&db, |conn| services::soft_delete_task(conn, task_id))
}

#[tauri::command(rename = "task:restore")]
pub fn task_restore(db: State<'_, Db>, task_id: Uuid) -> Result<Task, AppError> {
    with_conn(&db, |conn| services::restore_task(conn, task_id))
}

// --- tag:* -----------------------------------------------------------------

#[tauri::command(rename = "tag:list")]
pub fn tag_list(db: State<'_, Db>) -> Result<Vec<Tag>, AppError> {
    with_conn(&db, services::list_tags)
}

#[tauri::command(rename = "tag:create")]
pub fn tag_create(db: State<'_, Db>, payload: NewTag) -> Result<Tag, AppError> {
    with_conn(&db, |conn| services::create_tag(conn, payload))
}

#[tauri::command(rename = "tag:update")]
pub fn tag_update(db: State<'_, Db>, tag_id: Uuid, payload: UpdateTag) -> Result<Tag, AppError> {
    with_conn(&db, |conn| services::update_tag(conn, tag_id, payload))
}

#[tauri::command(rename = "tag:delete")]
pub fn tag_delete(db: State<'_, Db>, tag_id: Uuid) -> Result<(), AppError> {
    with_conn(&db, |conn| services::delete_tag(conn, tag_id))
}

// --- subtask:* -------------------------------------------------------------

#[tauri::command(rename = "subtask:list")]
pub fn subtask_list(db: State<'_, Db>, task_id: Uuid) -> Result<Vec<Subtask>, AppError> {
    with_conn(&db, |conn| services::list_subtasks(conn, task_id))
}

#[tauri::command(rename = "subtask:create")]
pub fn subtask_create(
    db: State<'_, Db>,
    task_id: Uuid,
    payload: NewSubtask,
) -> Result<Subtask, AppError> {
    with_conn(&db, |conn| services::create_subtask(conn, task_id, payload))
}

#[tauri::command(rename = "subtask:update")]
pub fn subtask_update(
    db: State<'_, Db>,
    subtask_id: Uuid,
    payload: UpdateSubtask,
) -> Result<Subtask, AppError> {
    with_conn(&db, |conn| {
        services::update_subtask(conn, subtask_id, payload)
    })
}

#[tauri::command(rename = "subtask:complete")]
pub fn subtask_complete(
    db: State<'_, Db>,
    subtask_id: Uuid,
    done: bool,
) -> Result<Subtask, AppError> {
    with_conn(&db, |conn| {
        services::complete_subtask(conn, subtask_id, done)
    })
}

#[tauri::command(rename = "subtask:delete")]
pub fn subtask_delete(db: State<'_, Db>, subtask_id: Uuid) -> Result<(), AppError> {
    with_conn(&db, |conn| services::delete_subtask(conn, subtask_id))
}

/// `prev`/`next` are the sort keys surrounding the target slot (either may be
/// omitted at the ends); returns the task's full subtask list in new order.
#[tauri::command(rename = "subtask:reorder")]
pub fn subtask_reorder(
    db: State<'_, Db>,
    subtask_id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Vec<Subtask>, AppError> {
    with_conn(&db, |conn| {
        services::reorder_subtask(conn, subtask_id, prev, next)
    })
}

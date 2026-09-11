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
    BoardColumn, Comment, NewBoardColumn, NewComment, NewProject, NewSubtask, NewTag, NewTask,
    NewTimeEntry, Project, ProjectProgress, SearchHit, Subtask, Tag, Task, TaskWithTags,
    TimeDistribution, TimeDistributionQuery, TimeEntry, TrendPoint, TrendQuery, UpdateBoardColumn,
    UpdateComment, UpdateProject, UpdateSubtask, UpdateTag, UpdateTask, UpdateTimeEntry,
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

// --- project:* -------------------------------------------------------------

#[tauri::command(rename = "project:list")]
pub fn project_list(db: State<'_, Db>) -> Result<Vec<Project>, AppError> {
    with_conn(&db, services::list_projects)
}

#[tauri::command(rename = "project:create")]
pub fn project_create(db: State<'_, Db>, payload: NewProject) -> Result<Project, AppError> {
    with_conn(&db, |conn| services::create_project(conn, payload))
}

#[tauri::command(rename = "project:update")]
pub fn project_update(
    db: State<'_, Db>,
    project_id: Uuid,
    payload: UpdateProject,
) -> Result<Project, AppError> {
    with_conn(&db, |conn| {
        services::update_project(conn, project_id, payload)
    })
}

#[tauri::command(rename = "project:archive")]
pub fn project_archive(db: State<'_, Db>, project_id: Uuid) -> Result<Project, AppError> {
    with_conn(&db, |conn| services::archive_project(conn, project_id))
}

#[tauri::command(rename = "project:restore")]
pub fn project_restore(db: State<'_, Db>, project_id: Uuid) -> Result<Project, AppError> {
    with_conn(&db, |conn| services::restore_project(conn, project_id))
}

// --- board:* ---------------------------------------------------------------

#[tauri::command(rename = "board:listColumns")]
pub fn board_list_columns(
    db: State<'_, Db>,
    project_id: Uuid,
) -> Result<Vec<BoardColumn>, AppError> {
    with_conn(&db, |conn| services::list_board_columns(conn, project_id))
}

#[tauri::command(rename = "board:addColumn")]
pub fn board_add_column(
    db: State<'_, Db>,
    payload: NewBoardColumn,
) -> Result<BoardColumn, AppError> {
    with_conn(&db, |conn| services::add_board_column(conn, payload))
}

#[tauri::command(rename = "board:updateColumn")]
pub fn board_update_column(
    db: State<'_, Db>,
    column_id: Uuid,
    payload: UpdateBoardColumn,
) -> Result<BoardColumn, AppError> {
    with_conn(&db, |conn| {
        services::update_board_column(conn, column_id, payload)
    })
}

#[tauri::command(rename = "board:deleteColumn")]
pub fn board_delete_column(db: State<'_, Db>, column_id: Uuid) -> Result<(), AppError> {
    with_conn(&db, |conn| services::delete_board_column(conn, column_id))
}

/// `prev`/`next` are the target column's sort keys around the slot (either
/// may be omitted at the ends).
#[tauri::command(rename = "board:moveTask")]
pub fn board_move_task(
    db: State<'_, Db>,
    task_id: Uuid,
    column_id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Task, AppError> {
    with_conn(&db, |conn| {
        services::move_task(conn, task_id, column_id, prev, next)
    })
}

// --- search:* --------------------------------------------------------------

#[tauri::command(rename = "search:query")]
pub fn search_query(db: State<'_, Db>, query: &str) -> Result<Vec<SearchHit>, AppError> {
    with_conn(&db, |conn| services::search(conn, query))
}

// --- comment:* -------------------------------------------------------------

#[tauri::command(rename = "comment:list")]
pub fn comment_list(db: State<'_, Db>, task_id: Uuid) -> Result<Vec<Comment>, AppError> {
    with_conn(&db, |conn| services::list_comments(conn, task_id))
}

#[tauri::command(rename = "comment:create")]
pub fn comment_create(
    db: State<'_, Db>,
    task_id: Uuid,
    payload: NewComment,
) -> Result<Comment, AppError> {
    with_conn(&db, |conn| services::create_comment(conn, task_id, payload))
}

#[tauri::command(rename = "comment:update")]
pub fn comment_update(
    db: State<'_, Db>,
    comment_id: Uuid,
    payload: UpdateComment,
) -> Result<Comment, AppError> {
    with_conn(&db, |conn| services::update_comment(conn, comment_id, payload))
}

#[tauri::command(rename = "comment:delete")]
pub fn comment_delete(db: State<'_, Db>, comment_id: Uuid) -> Result<(), AppError> {
    with_conn(&db, |conn| services::delete_comment(conn, comment_id))
}

// --- time:* ----------------------------------------------------------------

#[tauri::command(rename = "time:list")]
pub fn time_list(db: State<'_, Db>, task_id: Uuid) -> Result<Vec<TimeEntry>, AppError> {
    with_conn(&db, |conn| services::list_time_entries(conn, task_id))
}

#[tauri::command(rename = "time:create")]
pub fn time_create(
    db: State<'_, Db>,
    task_id: Uuid,
    payload: NewTimeEntry,
) -> Result<TimeEntry, AppError> {
    with_conn(&db, |conn| {
        services::create_time_entry(conn, task_id, payload)
    })
}

#[tauri::command(rename = "time:update")]
pub fn time_update(
    db: State<'_, Db>,
    entry_id: Uuid,
    payload: UpdateTimeEntry,
) -> Result<TimeEntry, AppError> {
    with_conn(&db, |conn| {
        services::update_time_entry(conn, entry_id, payload)
    })
}

#[tauri::command(rename = "time:delete")]
pub fn time_delete(db: State<'_, Db>, entry_id: Uuid) -> Result<(), AppError> {
    with_conn(&db, |conn| services::delete_time_entry(conn, entry_id))
}

#[tauri::command(rename = "time:start")]
pub fn time_start(db: State<'_, Db>, task_id: Uuid) -> Result<TimeEntry, AppError> {
    with_conn(&db, |conn| services::start_time_entry(conn, task_id))
}

#[tauri::command(rename = "time:stop")]
pub fn time_stop(db: State<'_, Db>, entry_id: Uuid) -> Result<TimeEntry, AppError> {
    with_conn(&db, |conn| services::stop_time_entry(conn, entry_id))
}

// --- stats:* ---------------------------------------------------------------

#[tauri::command(rename = "stats:trend")]
pub fn stats_trend(db: State<'_, Db>, query: TrendQuery) -> Result<Vec<TrendPoint>, AppError> {
    with_conn(&db, |conn| services::completion_trend(conn, query))
}

#[tauri::command(rename = "stats:projectProgress")]
pub fn stats_project_progress(db: State<'_, Db>) -> Result<Vec<ProjectProgress>, AppError> {
    with_conn(&db, services::project_progress)
}

#[tauri::command(rename = "stats:timeDistribution")]
pub fn stats_time_distribution(
    db: State<'_, Db>,
    query: TimeDistributionQuery,
) -> Result<TimeDistribution, AppError> {
    with_conn(&db, |conn| services::time_distribution(conn, query))
}

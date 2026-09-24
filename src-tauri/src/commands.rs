//! Tauri command handlers (the IPC boundary between SolidJS and Rust).
//!
//! Each `#[tauri::command]` is a thin wrapper that locks the managed
//! connection and delegates to the services layer. Commands register under
//! their canonical `<domain>:<action>` name via `rename = "..."`, so the
//! frontend `COMMANDS` constants in `src/common/ipc/commands.ts` match
//! verbatim. Argument keys are camelCase on the JS side (Tauri's default).

use std::path::Path;

use rusqlite::Connection;
use tauri::State;
use uuid::Uuid;

use crate::db::Db;
use crate::error::AppError;
use crate::models::{
    BackupSummary, BoardColumn, Comment, Dependency, Namespace, NewComment, NewNamespace,
    NewProject, NewTag, NewTask, NewTimeEntry, Project, ProjectProgress, ProjectUnfinished,
    Reorder, SearchHit, Tag, TaskPage, TaskWithTags, TimeDistribution, TimeDistributionQuery,
    TimeEntry, TrendPoint, TrendQuery, UpdateComment, UpdateNamespace, UpdateProject, UpdateTag,
    UpdateTask, UpdateTimeEntry,
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

/// Runs blocking database work off the async runtime. A panicked or cancelled
/// blocking task becomes an error instead of a command that never answers.
async fn blocking<T>(
    work: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| AppError::Db(format!("后台任务未能完成：{error}")))?
}

// --- task:* ----------------------------------------------------------------
//
// Every command below that answers with a task row answers with `TaskWithTags`
// — the row's own fields plus its `tagIds`, the shape `task:list` already has.
// The frontend keeps one `Task` per row and reads `tagIds` off it
// unconditionally, so a bare row would leave the field undefined in the store.

#[tauri::command(rename = "task:list")]
pub fn task_list(db: State<'_, Db>) -> Result<Vec<TaskWithTags>, AppError> {
    with_conn(&db, services::list_tasks)
}

#[tauri::command(rename = "task:listByProject")]
pub fn task_list_by_project(db: State<'_, Db>, project_id: Uuid) -> Result<TaskPage, AppError> {
    with_conn(&db, |conn| {
        services::list_tasks_by_project(conn, project_id)
    })
}

#[tauri::command(rename = "task:create")]
pub fn task_create(db: State<'_, Db>, payload: NewTask) -> Result<TaskWithTags, AppError> {
    with_conn(&db, |conn| {
        services::task_with_tags(conn, services::create_task(conn, payload)?)
    })
}

#[tauri::command(rename = "task:update")]
pub fn task_update(
    db: State<'_, Db>,
    task_id: Uuid,
    payload: UpdateTask,
) -> Result<TaskWithTags, AppError> {
    with_conn(&db, |conn| {
        services::task_with_tags(conn, services::update_task(conn, task_id, payload)?)
    })
}

#[tauri::command(rename = "task:complete")]
pub fn task_complete(db: State<'_, Db>, task_id: Uuid) -> Result<TaskWithTags, AppError> {
    with_conn(&db, |conn| {
        services::task_with_tags(conn, services::complete_task(conn, task_id)?)
    })
}

#[tauri::command(rename = "task:softDelete")]
pub fn task_soft_delete(db: State<'_, Db>, task_id: Uuid) -> Result<(), AppError> {
    with_conn(&db, |conn| services::soft_delete_task(conn, task_id))
}

#[tauri::command(rename = "task:restore")]
pub fn task_restore(db: State<'_, Db>, task_id: Uuid) -> Result<TaskWithTags, AppError> {
    with_conn(&db, |conn| {
        services::task_with_tags(conn, services::restore_task(conn, task_id)?)
    })
}

/// Moves a task between its siblings (`prev`/`next` are the neighbours' sort
/// keys, either omitted at the ends); returns the sibling set in new order.
#[tauri::command(rename = "task:reorder")]
pub fn task_reorder(
    db: State<'_, Db>,
    task_id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Reorder, AppError> {
    with_conn(&db, |conn| {
        services::reorder_task(conn, task_id, prev, next)
    })
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

// --- dependency:* ----------------------------------------------------------

#[tauri::command(rename = "dependency:listAll")]
pub fn dependency_list_all(db: State<'_, Db>) -> Result<Vec<Dependency>, AppError> {
    with_conn(&db, services::list_dependencies)
}

#[tauri::command(rename = "dependency:add")]
pub fn dependency_add(db: State<'_, Db>, payload: Dependency) -> Result<Dependency, AppError> {
    with_conn(&db, |conn| services::add_dependency(conn, payload))
}

#[tauri::command(rename = "dependency:remove")]
pub fn dependency_remove(db: State<'_, Db>, payload: Dependency) -> Result<(), AppError> {
    with_conn(&db, |conn| services::remove_dependency(conn, payload))
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

#[tauri::command(rename = "project:delete")]
pub fn project_delete(db: State<'_, Db>, project_id: Uuid) -> Result<(), AppError> {
    with_conn(&db, |conn| services::delete_project(conn, project_id))
}

#[tauri::command(rename = "project:unfinishedCounts")]
pub fn project_unfinished_counts(db: State<'_, Db>) -> Result<Vec<ProjectUnfinished>, AppError> {
    with_conn(&db, services::project_unfinished_counts)
}

// --- namespace:* -----------------------------------------------------------

#[tauri::command(rename = "namespace:list")]
pub fn namespace_list(db: State<'_, Db>) -> Result<Vec<Namespace>, AppError> {
    with_conn(&db, services::list_namespaces)
}

#[tauri::command(rename = "namespace:create")]
pub fn namespace_create(db: State<'_, Db>, payload: NewNamespace) -> Result<Namespace, AppError> {
    with_conn(&db, |conn| services::create_namespace(conn, payload))
}

#[tauri::command(rename = "namespace:update")]
pub fn namespace_update(
    db: State<'_, Db>,
    namespace_id: Uuid,
    payload: UpdateNamespace,
) -> Result<Namespace, AppError> {
    with_conn(&db, |conn| {
        services::update_namespace(conn, namespace_id, payload)
    })
}

#[tauri::command(rename = "namespace:archive")]
pub fn namespace_archive(db: State<'_, Db>, namespace_id: Uuid) -> Result<Namespace, AppError> {
    with_conn(&db, |conn| services::archive_namespace(conn, namespace_id))
}

#[tauri::command(rename = "namespace:restore")]
pub fn namespace_restore(db: State<'_, Db>, namespace_id: Uuid) -> Result<Namespace, AppError> {
    with_conn(&db, |conn| services::restore_namespace(conn, namespace_id))
}

#[tauri::command(rename = "namespace:delete")]
pub fn namespace_delete(db: State<'_, Db>, namespace_id: Uuid) -> Result<(), AppError> {
    with_conn(&db, |conn| services::delete_namespace(conn, namespace_id))
}

// --- board:* ---------------------------------------------------------------

#[tauri::command(rename = "board:listColumns")]
pub fn board_list_columns(
    db: State<'_, Db>,
    project_id: Uuid,
) -> Result<Vec<BoardColumn>, AppError> {
    with_conn(&db, |conn| services::list_board_columns(conn, project_id))
}

/// Moves a task into a column at the slot between `prev`/`next` (either side
/// optional at the ends); returns the task with its tag links.
#[tauri::command(rename = "board:moveTask")]
pub fn board_move_task(
    db: State<'_, Db>,
    task_id: Uuid,
    column_id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Reorder, AppError> {
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
    with_conn(&db, |conn| {
        services::update_comment(conn, comment_id, payload)
    })
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

// --- backup:* --------------------------------------------------------------

// Both commands read or write the whole database *and* the filesystem, so they
// run on the blocking pool rather than an async worker: a large import must not
// hold the command dispatcher while it parses and writes (QA-14). The
// connection mutex still queues them behind (and ahead of) every other command
// — SQLite has one writer, and one connection behind one lock is the shape the
// rest of the app is built on.

#[tauri::command(rename = "backup:export")]
pub async fn backup_export(db: State<'_, Db>, path: String) -> Result<BackupSummary, AppError> {
    let db = db.inner().clone();
    blocking(move || with_conn(&db, |conn| services::export_backup(conn, Path::new(&path)))).await
}

#[tauri::command(rename = "backup:import")]
pub async fn backup_import(db: State<'_, Db>, path: String) -> Result<BackupSummary, AppError> {
    let db = db.inner().clone();
    blocking(move || with_conn(&db, |conn| services::import_backup(conn, Path::new(&path)))).await
}

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

// --- perf:* ----------------------------------------------------------------

/// Q-01 性能验收的接收端：前端在首屏可交互时把启动与命令耗时交回来，后端在
/// `ORDO_PERF=1` 时打印（见 `perf.rs`）。没有返回值，也没有失败路径——量不到
/// 数据不该让用户看见错误。
#[tauri::command(rename = "perf:ready")]
pub fn perf_ready(report: crate::perf::StartupReport) {
    crate::perf::report_startup(report);
}

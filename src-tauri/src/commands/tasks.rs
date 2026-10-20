use crate::dto::TaskDto;
use crate::services::week;
use crate::state::{with_db, AppState};
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[tauri::command]
pub async fn capture(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    raw: String,
) -> Result<TaskDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_iso();
    let task = with_db(&state, move |conn| week::capture(conn, &raw, &now, &id)).await?;
    if window.label() == "capture" {
        let _ = window.app_handle().emit_to("main", "capture:created", &task.id);
    }
    Ok(task)
}

#[tauri::command]
pub async fn list_week(state: State<'_, AppState>) -> Result<Vec<TaskDto>, String> {
    with_db(&state, |conn| week::list(conn)).await
}
#[tauri::command]
pub async fn get_task(state: State<'_, AppState>, id: String) -> Result<TaskDto, String> {
    with_db(&state, move |conn| {
        crate::repo::tasks::dto(conn, &id).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn update_task(
    state: State<'_, AppState>,
    id: String,
    patch: crate::dto::TaskPatch,
) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::tasks::update_patch(conn, &id, &patch, &now)
    })
    .await
}

#[tauri::command]
pub async fn add_step(
    state: State<'_, AppState>,
    task_id: String,
    title: String,
) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::steps::add(conn, &task_id, &title, &now)
    })
    .await
}

#[tauri::command]
pub async fn toggle_step(state: State<'_, AppState>, step_id: String) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::steps::toggle(conn, &step_id, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_step(state: State<'_, AppState>, step_id: String) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::steps::remove(conn, &step_id, &now)
    })
    .await
}
#[tauri::command]
pub async fn pass_queue(state: State<'_, AppState>) -> Result<Vec<TaskDto>, String> {
    with_db(&state, |conn| crate::services::week::pass_queue(conn)).await
}

#[tauri::command]
pub async fn pass_resolve(
    state: State<'_, AppState>,
    task_id: String,
    action: crate::services::week::PassAction,
    suspend_until: Option<String>,
) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::week::resolve(conn, &task_id, action, suspend_until.as_deref(), &now)
    })
    .await
}

#[tauri::command]
pub async fn mark_pass_done(state: State<'_, AppState>, today: String) -> Result<(), String> {
    with_db(&state, move |conn| {
        crate::services::week::mark_pass_done(conn, &today)
    })
    .await
}

#[tauri::command]
pub async fn week_stats(
    state: State<'_, AppState>,
    today: String,
) -> Result<crate::dto::WeekStatsDto, String> {
    with_db(&state, move |conn| crate::services::week::stats(conn, &today)).await
}

#[tauri::command]
pub async fn list_suspended(state: State<'_, AppState>) -> Result<Vec<TaskDto>, String> {
    with_db(&state, |conn| crate::services::week::list_suspended(conn)).await
}

#[tauri::command]
pub async fn resume_task(state: State<'_, AppState>, id: String) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::week::resume(conn, &id, &now)
    })
    .await
}
#[tauri::command]
pub async fn set_due(
    state: State<'_, AppState>,
    id: String,
    new_due: Option<String>,
    reason: Option<String>,
) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::deliverables::set_due(conn, &id, new_due.as_deref(), reason.as_deref(), &now)
    })
    .await
}

#[tauri::command]
pub async fn add_delay_note(
    state: State<'_, AppState>,
    id: String,
    reason: String,
) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::deliverables::add_note(conn, &id, &reason, &now)
    })
    .await
}
#[tauri::command]
pub async fn list_project_tasks(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<TaskDto>, String> {
    with_db(&state, move |conn| {
        crate::repo::tasks::list_project(conn, &project_id).map_err(|e| e.to_string())
    })
    .await
}
#[tauri::command]
pub async fn mark_notifications_seen(state: State<'_, AppState>) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::notifications::mark_all_seen(conn, &now).map_err(|e| e.to_string())
    })
    .await
}
#[tauri::command]
pub async fn set_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::tasks::set_status(conn, &id, &status, &now)
    })
    .await
}

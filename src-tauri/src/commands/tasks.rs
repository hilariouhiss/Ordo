use crate::dto::TaskDto;
use crate::services::week;
use crate::state::{with_db, AppState};
use tauri::State;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[tauri::command]
pub async fn capture(state: State<'_, AppState>, raw: String) -> Result<TaskDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_iso();
    with_db(&state, move |conn| week::capture(conn, &raw, &now, &id)).await
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
    fields: crate::dto::TaskFields,
) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::tasks::update_fields(conn, &id, &fields, &now).map_err(|e| e.to_string())?;
        crate::repo::tasks::dto(conn, &id).map_err(|e| e.to_string())
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

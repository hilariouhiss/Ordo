use crate::dto::{ArchiveDto, TaskDto};
use crate::state::{with_db, AppState};
use tauri::State;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[tauri::command]
pub async fn list_archive(
    state: State<'_, AppState>,
    query: Option<String>,
) -> Result<ArchiveDto, String> {
    with_db(&state, move |conn| {
        crate::services::archive::list(conn, query.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn archive_task(state: State<'_, AppState>, id: String) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::tasks::archive(conn, &id, &now).map_err(|e| e.to_string())?;
        crate::repo::tasks::dto(conn, &id).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn restore_task(state: State<'_, AppState>, id: String) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::archive::restore_task(conn, &id, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_task(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_db(&state, move |conn| {
        crate::services::archive::delete_task(conn, &id)
    })
    .await
}

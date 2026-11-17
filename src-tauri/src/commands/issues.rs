use crate::dto::{IssueDto, IssuePatch, TaskDto};
use crate::now_iso;
use crate::state::{with_db, AppState};
use tauri::State;

#[tauri::command]
pub async fn list_issues(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<IssueDto>, String> {
    with_db(&state, move |conn| {
        crate::services::issues::list(conn, &project_id)
    })
    .await
}

#[tauri::command]
pub async fn create_issue(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
) -> Result<IssueDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::issues::create(conn, &project_id, &title, &now)
    })
    .await
}

#[tauri::command]
pub async fn update_issue(
    state: State<'_, AppState>,
    id: String,
    patch: IssuePatch,
) -> Result<IssueDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::issues::update(conn, &id, &patch, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_issue(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_db(&state, move |conn| {
        crate::services::issues::delete(conn, &id)
    })
    .await
}

#[tauri::command]
pub async fn create_issue_task(
    state: State<'_, AppState>,
    issue_id: String,
    title: String,
) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::issues::create_task(conn, &issue_id, &title, &now)
    })
    .await
}

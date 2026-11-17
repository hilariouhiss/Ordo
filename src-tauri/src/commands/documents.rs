use crate::dto::{DocumentDto, DocumentOutlineDto};
use crate::now_iso;
use crate::state::{with_db, AppState};
use tauri::State;

#[tauri::command]
pub async fn list_project_documents(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<DocumentOutlineDto>, String> {
    with_db(&state, move |conn| {
        crate::services::documents::list(conn, &project_id)
    })
    .await
}

#[tauri::command]
pub async fn get_document(
    state: State<'_, AppState>,
    id: String,
) -> Result<DocumentDto, String> {
    with_db(&state, move |conn| {
        crate::services::documents::get(conn, &id)
    })
    .await
}

#[tauri::command]
pub async fn import_document(
    state: State<'_, AppState>,
    project_id: String,
    file_name: String,
    file_base64: String,
) -> Result<DocumentOutlineDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::documents::import(conn, &project_id, &file_name, &file_base64, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_document(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_db(&state, move |conn| {
        crate::services::documents::delete(conn, &id)
    })
    .await
}

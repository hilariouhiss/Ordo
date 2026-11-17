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
    let english = with_db(&state, |conn| {
        Ok(crate::repo::settings::language(conn) == "en")
    })
    .await?;
    // Big uploads are parsed off the ledger: a 200-page PDF must not freeze every command.
    let parsed = tauri::async_runtime::spawn_blocking(move || {
        crate::services::documents::parse(english, &file_name, &file_base64)
    })
    .await
    .map_err(|e| e.to_string())??;
    with_db(&state, move |conn| {
        crate::services::documents::store(conn, &project_id, &parsed, &now)
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

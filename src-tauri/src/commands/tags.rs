use crate::dto::TagDto;
use crate::now_iso;
use crate::state::{with_db, AppState};
use tauri::State;

#[tauri::command]
pub async fn create_tag(state: State<'_, AppState>, name: String) -> Result<TagDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::tags::find_or_create(
            conn,
            &uuid::Uuid::new_v4().to_string(),
            name.trim(),
            &now,
        )
        .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::tags::soft_delete(conn, &id, &now).map_err(|e| e.to_string())
    })
    .await
}

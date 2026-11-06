use crate::dto::SearchHitDto;
use crate::state::{with_db, AppState};
use tauri::State;

#[tauri::command]
pub async fn search_all(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<SearchHitDto>, String> {
    with_db(&state, move |conn| {
        crate::repo::search::search(conn, &query).map_err(|e| e.to_string())
    })
    .await
}

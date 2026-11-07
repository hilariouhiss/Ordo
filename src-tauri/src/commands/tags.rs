use crate::dto::TagDto;
use crate::now_iso;
use crate::state::{with_db, AppState};
use tauri::State;

fn create_tag_in(conn: &rusqlite::Connection, name: &str, now: &str) -> Result<TagDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_tag_name".into());
    }
    crate::repo::tags::find_or_create(conn, &uuid::Uuid::new_v4().to_string(), name, now)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_tag(state: State<'_, AppState>, name: String) -> Result<TagDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| create_tag_in(conn, &name, &now)).await
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::tags::soft_delete(conn, &id, &now).map_err(|e| e.to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn an_empty_tag_name_is_rejected() {
        let c = crate::db::open_in_memory().unwrap();
        assert_eq!(
            super::create_tag_in(&c, "  ", NOW).unwrap_err(),
            "empty_tag_name"
        );
    }
}

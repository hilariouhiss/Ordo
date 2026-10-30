use crate::dto::CategoryDto;
use crate::now_iso;
use crate::state::{with_db, AppState};
use rusqlite::Connection;
use tauri::State;

fn create_category_in(
    conn: &Connection,
    name: &str,
    now: &str,
) -> Result<CategoryDto, String> {
    let name = name.trim();
    if crate::repo::categories::name_exists(conn, name, None).map_err(|e| e.to_string())? {
        return Err("category_exists".into());
    }
    let sort = crate::repo::categories::next_sort(conn).map_err(|e| e.to_string())?;
    crate::repo::categories::create(
        conn,
        &uuid::Uuid::new_v4().to_string(),
        name,
        sort,
        now,
    )
    .map_err(|e| e.to_string())
}

fn rename_category_in(
    conn: &Connection,
    id: &str,
    name: &str,
    now: &str,
) -> Result<(), String> {
    let name = name.trim();
    if crate::repo::categories::name_exists(conn, name, Some(id)).map_err(|e| e.to_string())? {
        return Err("category_exists".into());
    }
    crate::repo::categories::rename(conn, id, name, now).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_category(
    state: State<'_, AppState>,
    name: String,
) -> Result<CategoryDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| create_category_in(conn, &name, &now)).await
}

#[tauri::command]
pub async fn rename_category(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        rename_category_in(conn, &id, &name, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_category(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::categories::soft_delete_and_detach(conn, &id, &now).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn reorder_categories(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<CategoryDto>, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::categories::reorder(conn, &ids, &now).map_err(|e| e.to_string())?;
        crate::repo::categories::list(conn).map_err(|e| e.to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn category_names_are_unique() {
        let c = crate::db::open_in_memory().unwrap();
        let created = super::create_category_in(&c, "客户", NOW).unwrap();

        assert_eq!(
            super::create_category_in(&c, "客户", NOW).unwrap_err(),
            "category_exists"
        );

        let software = crate::repo::categories::list(&c)
            .unwrap()
            .into_iter()
            .find(|category| category.name == "软件")
            .unwrap();
        assert_eq!(
            super::rename_category_in(&c, &software.id, "客户", NOW).unwrap_err(),
            "category_exists"
        );

        // Renaming a category to its own name is still allowed (the id is excluded).
        super::rename_category_in(&c, &created.id, "客户", NOW).unwrap();
    }
}

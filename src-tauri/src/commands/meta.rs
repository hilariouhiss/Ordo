use crate::dto::BootstrapDto;
use crate::state::AppState;
use rusqlite::Connection;
use tauri::State;

pub fn build_bootstrap(conn: &Connection) -> Result<BootstrapDto, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let last = crate::repo::settings::get(conn, "last_pass_week")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let queue = crate::services::week::pass_queue(conn)?;
    let pass_needed = last != crate::services::week::week_start(&today) && !queue.is_empty();
    Ok(BootstrapDto {
        people: crate::repo::people::list(conn).map_err(|e| e.to_string())?,
        categories: crate::repo::categories::list(conn).map_err(|e| e.to_string())?,
        tags: crate::repo::tags::list(conn).map_err(|e| e.to_string())?,
        settings: crate::repo::settings::dto(conn).map_err(|e| e.to_string())?,
        projects: crate::repo::projects::list_summaries(conn).map_err(|e| e.to_string())?,
        week: queue,
        suspended: crate::services::week::list_suspended(conn)?,
        pass_needed,
        week_stats: crate::services::week::stats(conn, &today)?,
    })
}

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> Result<BootstrapDto, String> {
    crate::state::with_db(&state, |conn| build_bootstrap(conn)).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn bootstrap_returns_seed() {
        let c = crate::db::open_in_memory().unwrap();
        let b = crate::commands::meta::build_bootstrap(&c).unwrap();
        assert_eq!(b.people.len(), 1);
        assert!(b.people[0].is_me);
        assert_eq!(b.categories.len(), 8);
        assert_eq!(b.settings.shortcut, "Ctrl+Alt+O");
    }
}
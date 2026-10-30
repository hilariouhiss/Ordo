use crate::dto::StatsOverviewDto;
use crate::state::{with_db, AppState};
use tauri::State;

#[tauri::command]
pub async fn stats_overview(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<StatsOverviewDto, String> {
    with_db(&state, move |conn| {
        crate::services::stats::overview(conn, &from, &to)
    })
    .await
}

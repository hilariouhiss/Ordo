use crate::dto::{RuleDto, RuleInput, TaskDto, TemplateDto, TemplateInput};
use crate::now_iso;
use crate::state::{with_db, AppState};
use tauri::State;

#[tauri::command]
pub async fn list_rules(state: State<'_, AppState>) -> Result<Vec<RuleDto>, String> {
    with_db(&state, |conn| {
        crate::repo::rules::list(conn).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn save_rule(
    state: State<'_, AppState>,
    rule: RuleInput,
) -> Result<RuleDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        let saved = crate::services::rules::save(conn, &rule, &now)?;
        // Show today's occurrence right away instead of waiting for the next tick.
        let _ = crate::services::rules::materialize_rule(conn, &saved, chrono::Local::now());
        Ok(saved)
    })
    .await
}

#[tauri::command]
pub async fn set_rule_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<RuleDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::rules::set_enabled(conn, &id, enabled, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_rule(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::rules::remove(conn, &id, &now)
    })
    .await
}

#[tauri::command]
pub async fn list_templates(state: State<'_, AppState>) -> Result<Vec<TemplateDto>, String> {
    with_db(&state, |conn| {
        crate::repo::templates::list(conn).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn save_template(
    state: State<'_, AppState>,
    template: TemplateInput,
) -> Result<TemplateDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::templates::save(conn, &template, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_template(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::templates::remove(conn, &id, &now)
    })
    .await
}

#[tauri::command]
pub async fn create_task_from_template(
    state: State<'_, AppState>,
    template_id: String,
) -> Result<TaskDto, String> {
    let now = now_iso();
    let id = uuid::Uuid::new_v4().to_string();
    with_db(&state, move |conn| {
        crate::services::templates::create_task(conn, &template_id, &now, &id)
    })
    .await
}

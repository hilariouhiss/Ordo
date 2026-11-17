use crate::dto::{
    RequirementChangeDto, RequirementDto, RequirementPatch, RequirementStatusDto,
    RequirementStatusInput, TaskDto,
};
use crate::now_iso;
use crate::state::{with_db, AppState};
use tauri::State;

#[tauri::command]
pub async fn list_default_requirement_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    with_db(&state, |conn| {
        Ok(crate::services::requirements::default_status_names(conn))
    })
    .await
}

#[tauri::command]
pub async fn save_default_requirement_statuses(
    state: State<'_, AppState>,
    names: Vec<String>,
) -> Result<Vec<String>, String> {
    with_db(&state, move |conn| {
        crate::services::requirements::save_default_statuses(conn, &names)
    })
    .await
}

#[tauri::command]
pub async fn list_requirement_statuses(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<RequirementStatusDto>, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::statuses(conn, &project_id, &now)
    })
    .await
}

#[tauri::command]
pub async fn save_requirement_statuses(
    state: State<'_, AppState>,
    project_id: String,
    statuses: Vec<RequirementStatusInput>,
) -> Result<Vec<RequirementStatusDto>, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::save_statuses(conn, &project_id, &statuses, &now)
    })
    .await
}

#[tauri::command]
pub async fn list_requirements(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<RequirementDto>, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::list(conn, &project_id, &now)
    })
    .await
}

#[tauri::command]
pub async fn create_requirement(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
) -> Result<RequirementDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::create(conn, &project_id, &title, &now)
    })
    .await
}

#[tauri::command]
pub async fn update_requirement(
    state: State<'_, AppState>,
    id: String,
    patch: RequirementPatch,
) -> Result<RequirementDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::update(conn, &id, &patch, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_requirement(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_db(&state, move |conn| {
        crate::services::requirements::delete(conn, &id)
    })
    .await
}

#[tauri::command]
pub async fn advance_requirement(
    state: State<'_, AppState>,
    id: String,
) -> Result<RequirementDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::advance(conn, &id, &now)
    })
    .await
}

#[tauri::command]
pub async fn link_requirement_section(
    state: State<'_, AppState>,
    requirement_id: String,
    section_id: String,
) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::link_section(conn, &requirement_id, &section_id, &now)
    })
    .await
}

#[tauri::command]
pub async fn unlink_requirement_section(
    state: State<'_, AppState>,
    requirement_id: String,
    section_id: String,
) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::unlink_section(conn, &requirement_id, &section_id, &now)
    })
    .await
}

#[tauri::command]
pub async fn create_requirement_from_section(
    state: State<'_, AppState>,
    section_id: String,
    title: String,
    quote: Option<String>,
) -> Result<RequirementDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::create_from_section(
            conn,
            &section_id,
            &title,
            quote.as_deref().unwrap_or(""),
            &now,
        )
    })
    .await
}

#[tauri::command]
pub async fn create_requirement_task(
    state: State<'_, AppState>,
    requirement_id: String,
    title: String,
) -> Result<TaskDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::requirements::create_task(conn, &requirement_id, &title, &now)
    })
    .await
}

#[tauri::command]
pub async fn list_requirement_changes(
    state: State<'_, AppState>,
    requirement_id: String,
) -> Result<Vec<RequirementChangeDto>, String> {
    with_db(&state, move |conn| {
        crate::services::requirements::changes(conn, &requirement_id)
    })
    .await
}

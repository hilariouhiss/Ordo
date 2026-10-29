use crate::dto::{PersonDto, ProjectDto, ProjectGroupDto, ProjectSummaryDto};
use crate::now_iso;
use crate::state::{with_db, AppState};
use tauri::State;

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectSummaryDto>, String> {
    with_db(&state, |conn| crate::services::stats::list(conn)).await
}

#[tauri::command]
pub async fn get_project_summary(
    state: State<'_, AppState>,
    id: String,
) -> Result<ProjectSummaryDto, String> {
    with_db(&state, move |conn| {
        crate::services::stats::summary(conn, &id)
    })
    .await
}

#[tauri::command]
pub async fn get_project(state: State<'_, AppState>, id: String) -> Result<ProjectDto, String> {
    with_db(&state, move |conn| {
        crate::repo::projects::dto(conn, &id).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    name: String,
) -> Result<ProjectDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::projects::create(conn, &name, &now)
    })
    .await
}

#[tauri::command]
pub async fn update_project(
    state: State<'_, AppState>,
    id: String,
    name: String,
    group_id: Option<String>,
    priority: String,
) -> Result<ProjectDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::projects::update(
            conn,
            &id,
            &name,
            group_id.as_deref(),
            &priority,
            &now,
        )
    })
    .await
}

#[tauri::command]
pub async fn set_project_group(
    state: State<'_, AppState>,
    id: String,
    group_id: String,
) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::projects::set_group(conn, &id, &group_id, &now)
    })
    .await
}

#[tauri::command]
pub async fn list_project_groups(
    state: State<'_, AppState>,
) -> Result<Vec<ProjectGroupDto>, String> {
    with_db(&state, |conn| {
        crate::repo::project_groups::list(conn).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn create_project_group(
    state: State<'_, AppState>,
    name: String,
) -> Result<ProjectGroupDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::projects::create_group(conn, &name, &now)
    })
    .await
}

#[tauri::command]
pub async fn rename_project_group(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::projects::rename_group(conn, &id, &name, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_project_group(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_db(&state, move |conn| {
        crate::services::projects::delete_group(conn, &id)
    })
    .await
}

#[tauri::command]
pub async fn archive_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::projects::set_archived(conn, &id, true, &now).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn restore_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::repo::projects::set_archived(conn, &id, false, &now).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn delete_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_db(&state, move |conn| {
        crate::services::projects::delete(conn, &id)
    })
    .await
}

#[tauri::command]
pub async fn add_member(
    state: State<'_, AppState>,
    project_id: String,
    person_id: Option<String>,
    name: Option<String>,
) -> Result<PersonDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::projects::add_member(
            conn,
            &project_id,
            person_id.as_deref(),
            name.as_deref(),
            &now,
        )
    })
    .await
}

#[tauri::command]
pub async fn remove_member(
    state: State<'_, AppState>,
    project_id: String,
    person_id: String,
) -> Result<(), String> {
    with_db(&state, move |conn| {
        crate::repo::projects::remove_member(conn, &project_id, &person_id).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn set_member_category(
    state: State<'_, AppState>,
    project_id: String,
    person_id: String,
    category_id: Option<String>,
) -> Result<ProjectDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::projects::set_member_category(
            conn,
            &project_id,
            &person_id,
            category_id.as_deref(),
            &now,
        )
    })
    .await
}

#[tauri::command]
pub async fn owner_candidates(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<PersonDto>, String> {
    with_db(&state, move |conn| {
        crate::services::projects::owner_candidates(conn, project_id.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn list_people(state: State<'_, AppState>) -> Result<Vec<PersonDto>, String> {
    with_db(&state, |conn| {
        crate::repo::people::list(conn).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn create_person(state: State<'_, AppState>, name: String) -> Result<PersonDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::people::create(conn, &name, &now)
    })
    .await
}

#[tauri::command]
pub async fn rename_person(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<PersonDto, String> {
    let now = now_iso();
    with_db(&state, move |conn| {
        crate::services::people::rename(conn, &id, &name, &now)
    })
    .await
}

#[tauri::command]
pub async fn delete_person(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_db(&state, move |conn| crate::services::people::delete(conn, &id)).await
}
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonDto {
    pub id: String,
    pub name: String,
    pub is_me: bool,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryDto {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub ai_enabled: bool,
    pub ai_base_url: String,
    pub ai_model: String,
    pub ai_has_key: bool,
    pub shortcut: String,
    pub autostart: bool,
    pub week_start: i64,
    pub backup_keep_days: i64,
    pub last_pass_week: String,
    pub shortcut_warning: Option<String>,
    /// "light", "dark" or "system".
    pub theme: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepDto {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub sort_order: i64,
    pub done: bool,
    pub due_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelayDto {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub old_due: Option<String>,
    pub new_due: Option<String>,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub category_id: Option<String>,
    pub owner_id: Option<String>,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub in_week: bool,
    pub carry_count: i64,
    pub suspended_until: Option<String>,
    pub note: Option<String>,
    pub archived_at: Option<String>,
    pub canceled_at: Option<String>,
    pub steps: Vec<StepDto>,
    pub tags: Vec<TagDto>,
    pub delays: Vec<DelayDto>,
    pub created_at: String,
    pub updated_at: String,
    pub sort_order: i64,
    pub effort_days: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryProgressDto {
    pub category_id: String,
    pub name: String,
    pub total: i64,
    pub done: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummaryDto {
    pub id: String,
    pub name: String,
    pub due_date: Option<String>,
    pub total: i64,
    pub done: i64,
    pub by_category: Vec<CategoryProgressDto>,
    pub summary_line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub due_date: Option<String>,
    pub archived_at: Option<String>,
    pub member_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapDto {
    pub people: Vec<PersonDto>,
    pub categories: Vec<CategoryDto>,
    pub tags: Vec<TagDto>,
    pub settings: SettingsDto,
    pub projects: Vec<ProjectSummaryDto>,
    pub week: Vec<TaskDto>,
    pub suspended: Vec<TaskDto>,
    pub pass_needed: bool,
    pub week_stats: WeekStatsDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDto {
    pub projects: Vec<ProjectDto>,
    pub tasks: Vec<TaskDto>,
    pub canceled: Vec<TaskDto>,
    pub done: Vec<TaskDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekStatsDto {
    pub added: i64,
    pub done: i64,
    pub delayed: i64,
}
/// A task edit. An absent field keeps its value; an explicit `null` clears it.
/// `title` and `tags` are not nullable, so absent keeps and a value replaces.
/// No `due_date`: a deadline only moves through `set_due`, which writes the delay record.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "clearable")]
    pub project_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub category_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub owner_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub start_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "clearable")]
    pub note: Option<Option<String>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub effort_days: Option<f64>,
}

/// Without this, serde maps an explicit `null` to the same `None` as a missing field.
fn clearable<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::<T>::deserialize(de)?))
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub ai_enabled: Option<bool>,
    pub ai_base_url: Option<String>,
    pub ai_model: Option<String>,
    pub shortcut: Option<String>,
    pub autostart: Option<bool>,
    pub week_start: Option<i64>,
    pub backup_keep_days: Option<i64>,
    pub theme: Option<String>,
}
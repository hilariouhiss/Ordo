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
    /// "zh" or "en".
    pub language: String,
    pub ai_enabled: bool,
    pub ai_base_url: String,
    pub ai_model: String,
    pub shortcut: String,
    pub autostart: bool,
    pub backup_keep_days: i64,
    pub backup_error: Option<String>,
    pub last_pass_week: String,
    pub shortcut_warning: Option<String>,
    /// "light", "dark" or "system".
    pub theme: String,
    pub desk_enabled: bool,
    /// Whether the widget shows start / park / complete actions.
    pub desk_controls: bool,
    /// "top" or "bottom".
    pub desk_pin: String,
    /// Physical pixels of the expanded window's top-left corner.
    pub desk_x: Option<i64>,
    pub desk_y: Option<i64>,
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
    pub suspended: bool,
    pub suspended_at: Option<String>,
    pub suspend_reason: Option<String>,
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
    pub priority: String,
    pub exclusive: bool,
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
    pub group_id: Option<String>,
    pub total: i64,
    pub done: i64,
    pub by_category: Vec<CategoryProgressDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub group_id: Option<String>,
    pub archived_at: Option<String>,
    pub member_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGroupDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapDto {
    pub people: Vec<PersonDto>,
    pub categories: Vec<CategoryDto>,
    pub tags: Vec<TagDto>,
    pub settings: SettingsDto,
    pub projects: Vec<ProjectSummaryDto>,
}

/// The fields the archive page shows; the full task loads when a row is opened.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveTaskDto {
    pub id: String,
    pub title: String,
    pub archived_at: Option<String>,
    pub canceled_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDto {
    pub projects: Vec<ProjectDto>,
    pub tasks: Vec<ArchiveTaskDto>,
    pub canceled: Vec<ArchiveTaskDto>,
    pub done: Vec<ArchiveTaskDto>,
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
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub exclusive: Option<bool>,
}

/// The fields a quick capture can carry. All optional: a missing field keeps the
/// database default (owner "me", priority "normal", effort 1 day).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFields {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
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
    pub language: Option<String>,
    pub ai_enabled: Option<bool>,
    pub ai_base_url: Option<String>,
    pub ai_model: Option<String>,
    pub autostart: Option<bool>,
    pub backup_keep_days: Option<i64>,
    pub theme: Option<String>,
    pub desk_enabled: Option<bool>,
    pub desk_controls: Option<bool>,
    pub desk_pin: Option<String>,
    pub desk_x: Option<i64>,
    pub desk_y: Option<i64>,
}
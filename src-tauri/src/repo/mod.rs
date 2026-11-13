/// Escapes LIKE metacharacters so a search is a literal substring match.
/// The SQL condition that keeps a list inside one mode. The mode is always the
/// validated settings::mode value, so interpolating it cannot inject anything.
pub(crate) fn scope_eq(alias: &str, mode: &str) -> String {
    format!("{alias}.scope = '{mode}'")
}

pub(crate) fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_");
    format!("%{escaped}%")
}

pub mod categories;
pub mod delays;
pub mod milestones;
pub mod notifications;
pub mod people;
pub mod project_groups;
pub mod projects;
pub mod rules;
pub mod search;
pub mod settings;
pub mod snoozes;
pub mod tags;
pub mod templates;
pub mod tasks;
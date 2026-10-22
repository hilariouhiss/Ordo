/// Escapes LIKE metacharacters so a search is a literal substring match.
pub(crate) fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_");
    format!("%{escaped}%")
}

pub mod categories;
pub mod delays;
pub mod notifications;
pub mod people;
pub mod projects;
pub mod settings;
pub mod steps;
pub mod tags;
pub mod tasks;
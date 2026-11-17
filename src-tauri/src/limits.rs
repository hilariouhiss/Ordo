use serde::Deserialize;
use std::sync::LazyLock;

/// Limits the core and the interface both enforce; the WebView reads the same file.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub effort_minutes: i64,
    pub stats_range_days: i64,
    pub reminder_lead_minutes: i64,
    /// The largest upload accepted for a project document, before text extraction.
    pub document_bytes: usize,
    /// The largest extracted text a document may store.
    pub document_text_bytes: usize,
}

pub static LIMITS: LazyLock<Limits> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../src/lib/limits.json"))
        .expect("src/lib/limits.json must be valid")
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shared_limits_parse() {
        assert!(LIMITS.effort_minutes >= 1);
        assert!(LIMITS.stats_range_days >= 1);
        assert!(LIMITS.reminder_lead_minutes >= 0);
        assert!(LIMITS.document_bytes >= 1);
        assert!(LIMITS.document_text_bytes >= 1);
    }
}

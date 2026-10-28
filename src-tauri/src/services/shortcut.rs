use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutOutcome {
    pub active: String,
    pub warning: Option<String>,
}

pub fn apply<F, G>(current: &str, next: &str, mut register: F, mut restore: G) -> ShortcutOutcome
where
    F: FnMut(&str) -> Result<(), String>,
    G: FnMut(&str) -> Result<(), String>,
{
    match register(next) {
        Ok(()) => ShortcutOutcome {
            active: next.to_string(),
            warning: None,
        },
        // The old key went away before this call, so a failed restore leaves no key at
        // all: say that instead of reporting a rollback that did not happen.
        Err(e) => ShortcutOutcome {
            active: current.to_string(),
            warning: Some(match restore(current) {
                Ok(()) => e,
                Err(back) => format!("shortcut_rollback_failed: {back}"),
            }),
        },
    }
}

#[cfg(test)]
mod tests {
    use crate::services::shortcut::apply;

    #[test]
    fn shortcut_change_takes_effect() {
        let out = apply("Ctrl+Alt+O", "Ctrl+Alt+P", |_| Ok(()), |_| Ok(()));
        assert_eq!(out.active, "Ctrl+Alt+P");
        assert!(out.warning.is_none());
    }

    #[test]
    fn shortcut_change_rolls_back_on_failure() {
        let out = apply("Ctrl+Alt+O", "Ctrl+Alt+P", |_| Err("taken".into()), |_| Ok(()));
        assert_eq!(out.active, "Ctrl+Alt+O");
        assert_eq!(out.warning.as_deref(), Some("taken"));
    }

    #[test]
    fn a_failed_rollback_is_not_reported_as_a_clean_restore() {
        let out = apply(
            "Ctrl+Alt+O",
            "Ctrl+Alt+P",
            |_| Err("taken".into()),
            |_| Err("still taken".into()),
        );
        assert_eq!(out.active, "Ctrl+Alt+O");
        assert!(
            out.warning
                .as_deref()
                .unwrap_or_default()
                .starts_with("shortcut_rollback_failed"),
            "no key is active, so the warning must not look like a clean rollback"
        );
    }
}

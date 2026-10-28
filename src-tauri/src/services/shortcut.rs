use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutOutcome {
    pub active: String,
    pub warning: Option<String>,
}

/// Which window a global shortcut belongs to; each owns its setting and warning row.
#[derive(Debug, Clone, Copy)]
pub enum ShortcutTarget {
    Capture,
    Desk,
    Main,
}

impl ShortcutTarget {
    pub const ALL: [ShortcutTarget; 3] = [
        ShortcutTarget::Capture,
        ShortcutTarget::Desk,
        ShortcutTarget::Main,
    ];

    pub fn settings_key(self) -> &'static str {
        match self {
            ShortcutTarget::Capture => "shortcut",
            ShortcutTarget::Desk => "desk.shortcut",
            ShortcutTarget::Main => "main.shortcut",
        }
    }

    pub fn warning_key(self) -> &'static str {
        match self {
            ShortcutTarget::Capture => "shortcut_warning",
            ShortcutTarget::Desk => "desk.shortcut_warning",
            ShortcutTarget::Main => "main.shortcut_warning",
        }
    }

    pub fn default_value(self) -> &'static str {
        match self {
            ShortcutTarget::Capture => "Ctrl+Alt+O",
            ShortcutTarget::Desk => "Ctrl+Alt+W",
            ShortcutTarget::Main => "Ctrl+Alt+M",
        }
    }
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
    fn targets_keep_their_own_keys() {
        use crate::services::shortcut::ShortcutTarget;

        let keys: Vec<&str> = ShortcutTarget::ALL.iter().map(|t| t.settings_key()).collect();
        let warnings: Vec<&str> = ShortcutTarget::ALL
            .iter()
            .map(|t| t.warning_key())
            .collect();
        let defaults: Vec<&str> = ShortcutTarget::ALL
            .iter()
            .map(|t| t.default_value())
            .collect();

        assert_eq!(keys, ["shortcut", "desk.shortcut", "main.shortcut"]);
        assert_eq!(
            warnings,
            [
                "shortcut_warning",
                "desk.shortcut_warning",
                "main.shortcut_warning"
            ]
        );
        assert_eq!(defaults, ["Ctrl+Alt+O", "Ctrl+Alt+W", "Ctrl+Alt+M"]);
    }

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

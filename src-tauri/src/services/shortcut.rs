use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutOutcome {
    pub active: String,
    pub warning: Option<String>,
}

pub fn apply<F>(current: &str, next: &str, mut register: F) -> ShortcutOutcome
where
    F: FnMut(&str) -> Result<(), String>,
{
    match register(next) {
        Ok(()) => ShortcutOutcome {
            active: next.to_string(),
            warning: None,
        },
        Err(e) => ShortcutOutcome {
            active: current.to_string(),
            warning: Some(e),
        },
    }
}

#[cfg(test)]
mod tests {
    use crate::services::shortcut::apply;

    #[test]
    fn shortcut_change_takes_effect() {
        let out = apply("Ctrl+Alt+O", "Ctrl+Alt+P", |_| Ok(()));
        assert_eq!(out.active, "Ctrl+Alt+P");
        assert!(out.warning.is_none());
    }

    #[test]
    fn shortcut_change_rolls_back_on_failure() {
        let out = apply("Ctrl+Alt+O", "Ctrl+Alt+P", |_| Err("taken".into()));
        assert_eq!(out.active, "Ctrl+Alt+O");
        assert_eq!(out.warning.as_deref(), Some("taken"));
    }
}

use rusqlite::Connection;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    Zh,
    En,
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "GetUserDefaultUILanguage"]
    fn get_user_default_ui_language() -> u16;
}

/// The OS UI language, mapped to the two languages this app speaks.
pub fn system_language() -> &'static str {
    #[cfg(windows)]
    {
        // LANGID's low 10 bits are the primary language; 0x04 is Chinese.
        let langid = unsafe { get_user_default_ui_language() };
        if langid & 0x03ff == 0x0004 { "zh" } else { "en" }
    }
    #[cfg(not(windows))]
    {
        let locale = std::env::var("LC_ALL")
            .or_else(|_| std::env::var("LC_MESSAGES"))
            .or_else(|_| std::env::var("LANG"))
            .unwrap_or_default();
        if locale.to_ascii_lowercase().starts_with("zh") {
            "zh"
        } else {
            "en"
        }
    }
}

/// The language setting, read from the ledger; unknown or missing values fall
/// back to the system UI language.
pub fn from_conn(conn: &Connection) -> Lang {
    if crate::repo::settings::language(conn) == "en" {
        Lang::En
    } else {
        Lang::Zh
    }
}

pub fn tray_labels(lang: Lang) -> [&'static str; 6] {
    match lang {
        Lang::Zh => ["打开 ordo", "本周", "过一遍", "桌面小窗", "设置", "退出"],
        Lang::En => [
            "Open ordo",
            "This week",
            "Weekly pass",
            "Week widget",
            "Settings",
            "Quit",
        ],
    }
}

pub fn tray_hint(lang: Lang) -> (&'static str, &'static str) {
    match lang {
        Lang::Zh => (
            "ordo 还在托盘运行",
            "点托盘图标就能叫回来，右键菜单可以退出。",
        ),
        Lang::En => (
            "ordo is still running in the tray",
            "Click the tray icon to bring it back; Quit is in its menu.",
        ),
    }
}

pub fn reminder_headline(lang: Lang, kind: &str, due_today: bool, title: &str) -> String {
    match (lang, kind, due_today) {
        (Lang::Zh, "due_tomorrow", true) => format!("今天截止：{title}"),
        (Lang::Zh, "due_tomorrow", false) => format!("明天截止：{title}"),
        (Lang::Zh, "overdue", _) => format!("已逾期：{title}"),
        (Lang::Zh, _, _) => format!("该开始了：{title}"),
        (Lang::En, "due_tomorrow", true) => format!("Due today: {title}"),
        (Lang::En, "due_tomorrow", false) => format!("Due tomorrow: {title}"),
        (Lang::En, "overdue", _) => format!("Overdue: {title}"),
        (Lang::En, _, _) => format!("Time to start: {title}"),
    }
}

pub fn reminder_body(lang: Lang) -> &'static str {
    match lang {
        Lang::Zh => "打开 ordo 查看",
        Lang::En => "Open ordo to check",
    }
}

pub fn more_reminders(lang: Lang, count: usize) -> String {
    match lang {
        Lang::Zh => format!("还有 {count} 条提醒"),
        Lang::En => format!("{count} more reminders"),
    }
}

pub fn tray_tooltip(lang: Lang, unread: i64) -> String {
    match lang {
        Lang::Zh => format!("ordo · {unread} 条提醒"),
        Lang::En => format!("ordo · {unread} unread"),
    }
}

pub fn recovery_notice(lang: Lang, restored: &str, kept: &str) -> (String, String) {
    match lang {
        Lang::Zh => (
            "已从备份恢复数据库".into(),
            format!("用的是 {restored}。坏文件存为 {kept}，没有删任何东西。"),
        ),
        Lang::En => (
            "Database restored from backup".into(),
            format!(
                "Restored from {restored}. The broken file was kept as {kept}; nothing was deleted."
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_labels_switch_language() {
        assert_eq!(tray_labels(Lang::Zh)[0], "打开 ordo");
        assert_eq!(tray_labels(Lang::Zh)[3], "桌面小窗");
        assert_eq!(tray_labels(Lang::Zh)[5], "退出");
        assert_eq!(tray_labels(Lang::En)[1], "This week");
        assert_eq!(tray_labels(Lang::En)[3], "Week widget");
        assert_eq!(tray_labels(Lang::En)[5], "Quit");
    }

    #[test]
    fn reminder_titles_switch_language() {
        assert_eq!(
            reminder_headline(Lang::Zh, "due_tomorrow", true, "交底"),
            "今天截止：交底"
        );
        assert_eq!(
            reminder_headline(Lang::Zh, "due_tomorrow", false, "交底"),
            "明天截止：交底"
        );
        assert_eq!(
            reminder_headline(Lang::Zh, "overdue", false, "交底"),
            "已逾期：交底"
        );
        assert_eq!(
            reminder_headline(Lang::Zh, "suspend_start", false, "交底"),
            "该开始了：交底"
        );
        assert_eq!(
            reminder_headline(Lang::En, "due_tomorrow", true, "Kickoff"),
            "Due today: Kickoff"
        );
        assert_eq!(
            reminder_headline(Lang::En, "due_tomorrow", false, "Kickoff"),
            "Due tomorrow: Kickoff"
        );
        assert_eq!(
            reminder_headline(Lang::En, "overdue", false, "Kickoff"),
            "Overdue: Kickoff"
        );
        assert_eq!(
            reminder_headline(Lang::En, "suspend_start", false, "Kickoff"),
            "Time to start: Kickoff"
        );
        assert_eq!(more_reminders(Lang::Zh, 2), "还有 2 条提醒");
        assert_eq!(more_reminders(Lang::En, 2), "2 more reminders");
        assert_eq!(tray_tooltip(Lang::En, 2), "ordo · 2 unread");
    }

    #[test]
    fn recovery_notice_keeps_both_paths() {
        let (title, body) = recovery_notice(Lang::En, "backup.db", "broken.db");
        assert_eq!(title, "Database restored from backup");
        assert!(body.contains("backup.db"));
        assert!(body.contains("broken.db"));
        let (title, body) = recovery_notice(Lang::Zh, "备份.db", "坏文件.db");
        assert_eq!(title, "已从备份恢复数据库");
        assert!(body.contains("备份.db"));
        assert!(body.contains("坏文件.db"));
    }

    #[test]
    fn system_language_is_supported() {
        assert!(matches!(system_language(), "zh" | "en"));
    }

    #[test]
    fn language_comes_from_settings_with_the_system_as_default() {
        let c = crate::db::open_in_memory().unwrap();
        let system = if system_language() == "en" {
            Lang::En
        } else {
            Lang::Zh
        };
        assert_eq!(from_conn(&c), system);
        crate::repo::settings::set(&c, "language", "en").unwrap();
        assert_eq!(from_conn(&c), Lang::En);
        crate::repo::settings::set(&c, "language", "zh").unwrap();
        assert_eq!(from_conn(&c), Lang::Zh);
        crate::repo::settings::set(&c, "language", "fr").unwrap();
        assert_eq!(from_conn(&c), system);
    }
}

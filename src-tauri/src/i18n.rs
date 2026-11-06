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
        Lang::Zh => ["打开 Ordo", "本周", "过一遍", "桌面小窗", "设置", "退出"],
        Lang::En => [
            "Open Ordo",
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
            "Ordo 还在托盘运行",
            "点托盘图标就能叫回来，右键菜单可以退出。",
        ),
        Lang::En => (
            "Ordo is still running in the tray",
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
        Lang::Zh => "打开 Ordo 查看",
        Lang::En => "Open Ordo to check",
    }
}

/// The daily digest: how much is due in the morning, and what it is.
pub fn digest_title(lang: Lang) -> &'static str {
    match lang {
        Lang::Zh => "今日汇总",
        Lang::En => "Today at a glance",
    }
}

/// `titles` already holds the first couple of names; `folded` is how many more are left.
pub fn digest_body(
    lang: Lang,
    due: usize,
    overdue: usize,
    titles: &[String],
    folded: usize,
) -> String {
    let headline = match (lang, due, overdue) {
        (Lang::Zh, 0, _) => format!("{overdue} 项已逾期"),
        (Lang::Zh, _, 0) => format!("今天 {due} 项到期"),
        (Lang::Zh, _, _) => format!("今天 {due} 项到期 · {overdue} 项逾期"),
        (Lang::En, 0, _) => format!("{overdue} overdue"),
        (Lang::En, _, 0) => format!("{due} due today"),
        (Lang::En, _, _) => format!("{due} due today · {overdue} overdue"),
    };
    if titles.is_empty() {
        return headline;
    }
    let list = titles.join(match lang {
        Lang::Zh => "、",
        Lang::En => ", ",
    });
    let more = match (lang, folded) {
        (_, 0) => String::new(),
        (Lang::Zh, count) => format!(" 等 {count} 项"),
        (Lang::En, count) => format!(" and {count} more"),
    };
    match lang {
        Lang::Zh => format!("{headline}：{list}{more}"),
        Lang::En => format!("{headline}: {list}{more}"),
    }
}

/// The two buttons on a reminder toast.
pub fn snooze_hour(lang: Lang) -> &'static str {
    match lang {
        Lang::Zh => "1 小时后",
        Lang::En => "In 1 hour",
    }
}

pub fn snooze_tomorrow(lang: Lang) -> &'static str {
    match lang {
        Lang::Zh => "明天 09:00",
        Lang::En => "Tomorrow 9:00",
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
        Lang::Zh => format!("Ordo · {unread} 条提醒"),
        Lang::En => format!("Ordo · {unread} unread"),
    }
}

/// The language to use before the ledger is open (the startup failure paths).
pub fn system_lang() -> Lang {
    if system_language() == "en" {
        Lang::En
    } else {
        Lang::Zh
    }
}

pub fn legacy_migration_failed(lang: Lang, error: &str, old_dir: &str) -> (String, String) {
    match lang {
        Lang::Zh => (
            "Ordo 迁移不了旧数据".into(),
            format!("旧数据迁移失败（{error}）。旧数据还在 {old_dir}，没有删。"),
        ),
        Lang::En => (
            "Ordo could not move your old data".into(),
            format!(
                "Moving the old data failed ({error}). The old data is still at {old_dir}; nothing was deleted."
            ),
        ),
    }
}

pub fn database_open_failed(lang: Lang, error: &str, data_dir: &str) -> (String, String) {
    match lang {
        Lang::Zh => (
            "Ordo 打不开数据库".into(),
            format!("数据库打不开（{error}）。坏文件和备份都留在 {data_dir}，什么都没删。"),
        ),
        Lang::En => (
            "Ordo could not open its database".into(),
            format!(
                "The database did not open ({error}). The broken file and backups are still at {data_dir}; nothing was deleted."
            ),
        ),
    }
}

/// `kept` is the set-aside broken file, absent when the ledger itself was missing.
pub fn recovery_notice(lang: Lang, restored: &str, kept: Option<String>) -> (String, String) {
    match (lang, kept) {
        (Lang::Zh, Some(kept)) => (
            "已从备份恢复数据库".into(),
            format!("用的是 {restored}。坏文件存为 {kept}，没有删任何东西。"),
        ),
        (Lang::Zh, None) => (
            "已从备份恢复数据库".into(),
            format!("数据库文件不见了，用 {restored} 恢复。没有删任何东西。"),
        ),
        (Lang::En, Some(kept)) => (
            "Database restored from backup".into(),
            format!(
                "Restored from {restored}. The broken file was kept as {kept}; nothing was deleted."
            ),
        ),
        (Lang::En, None) => (
            "Database restored from backup".into(),
            format!(
                "The database file was missing, so it was restored from {restored}; nothing was deleted."
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_labels_switch_language() {
        assert_eq!(tray_labels(Lang::Zh)[0], "打开 Ordo");
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
        assert_eq!(
            digest_body(Lang::Zh, 3, 1, &["交底".into(), "周会".into()], 1),
            "今天 3 项到期 · 1 项逾期：交底、周会 等 1 项"
        );
        assert_eq!(
            digest_body(Lang::En, 3, 0, &["Kickoff".into()], 0),
            "3 due today: Kickoff"
        );
        assert_eq!(digest_body(Lang::Zh, 0, 2, &[], 0), "2 项已逾期");
        assert_eq!(digest_body(Lang::En, 0, 2, &[], 0), "2 overdue");
        assert_eq!(digest_title(Lang::Zh), "今日汇总");
        assert!(!snooze_hour(Lang::En).is_empty());
        assert!(!snooze_tomorrow(Lang::Zh).is_empty());
        assert_eq!(more_reminders(Lang::Zh, 2), "还有 2 条提醒");
        assert_eq!(more_reminders(Lang::En, 2), "2 more reminders");
        assert_eq!(tray_tooltip(Lang::En, 2), "Ordo · 2 unread");
    }

    #[test]
    fn recovery_notice_keeps_both_paths() {
        let (title, body) = recovery_notice(Lang::En, "backup.db", Some("broken.db".into()));
        assert_eq!(title, "Database restored from backup");
        assert!(body.contains("backup.db"));
        assert!(body.contains("broken.db"));
        let (title, body) = recovery_notice(Lang::Zh, "备份.db", Some("坏文件.db".into()));
        assert_eq!(title, "已从备份恢复数据库");
        assert!(body.contains("备份.db"));
        assert!(body.contains("坏文件.db"));
    }

    #[test]
    fn recovery_notice_names_a_missing_file() {
        let (title, body) = recovery_notice(Lang::En, "backup.db", None);
        assert_eq!(title, "Database restored from backup");
        assert!(body.contains("backup.db"));
        assert!(body.contains("missing"), "{body}");
        let (_, body) = recovery_notice(Lang::Zh, "备份.db", None);
        assert!(body.contains("备份.db"));
        assert!(body.contains("不见了"), "{body}");
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

    #[test]
    fn startup_failures_speak_both_languages() {
        let (title, body) = legacy_migration_failed(Lang::En, "boom", "C:\\old");
        assert_eq!(title, "Ordo could not move your old data");
        assert!(body.contains("boom") && body.contains("C:\\old"));
        assert!(body.contains("nothing was deleted"));

        let (title, body) = database_open_failed(Lang::Zh, "boom", "C:\\data");
        assert_eq!(title, "Ordo 打不开数据库");
        assert!(body.contains("boom") && body.contains("C:\\data"));
        assert!(body.contains("什么都没删"));
    }
}

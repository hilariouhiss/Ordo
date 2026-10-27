pub mod rules;

use crate::state::AppState;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;
use tauri::Manager;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Notification id → task id, so a tap can open the task it was about.
#[derive(Default)]
pub struct ReminderTargets {
    next: AtomicI32,
    tasks: Mutex<HashMap<i32, String>>,
}

impl ReminderTargets {
    pub fn next_id(&self, task_id: &str) -> i32 {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.insert(id, task_id.to_owned());
        }
        id
    }

    pub fn task_for(&self, id: i32) -> Option<String> {
        self.tasks.lock().ok()?.get(&id).cloned()
    }
}

/// Per-task toasts in one tick before the rest collapse into a single summary.
const MAX_TOASTS: usize = 3;

/// Splits the fired reminders into the named toasts to show and the count to
/// summarize, so a catch-up after a break cannot flood the screen.
pub fn split_toasts<T>(fired: Vec<T>) -> (Vec<T>, usize) {
    let total = fired.len();
    let mut shown = fired;
    shown.truncate(MAX_TOASTS);
    let folded = total - shown.len();
    (shown, folded)
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        let _ = tick(&app);
        std::thread::sleep(std::time::Duration::from_secs(30));
    });
}

fn tick(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    // Everything that touches the ledger happens under this one lock; notifications and
    // the tray are updated after it is released, so a slow OS call cannot stall the app.
    let (lang, toasts, unread) = {
        let conn = state.db.lock().map_err(|_| "db_lock_poisoned".to_string())?;
        let lang = crate::i18n::from_conn(&conn);
        // Before the fallible reminder work, so one bad row cannot stop the daily backup too.
        backup_ledger(app, &conn);
        let now = chrono::Local::now();
        let candidates = rules::candidates(&conn, now)?;
        let today = now.format("%Y-%m-%d").to_string();
        let now_utc = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

        let mut toasts: Vec<(String, String)> = Vec::new();
        for candidate in candidates {
            let title: String = conn
                .query_row("SELECT title FROM tasks WHERE id = ?1", [&candidate.task_id], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?;
            let fired = crate::repo::notifications::fire(
                &conn,
                &uuid::Uuid::new_v4().to_string(),
                &candidate.task_id,
                candidate.kind,
                &candidate.due_key,
                &candidate.scheduled_for.to_rfc3339(),
                &now_utc,
            )
            .map_err(|e| e.to_string())?;
            if !fired {
                continue;
            }
            let headline = crate::i18n::reminder_headline(
                lang,
                candidate.kind,
                candidate.due_key == today,
                &title,
            );
            toasts.push((headline, candidate.task_id));
        }
        let unread = crate::repo::notifications::unread_count(&conn).unwrap_or(0);
        (lang, toasts, unread)
    };

    let (shown, folded) = split_toasts(toasts);
    for (headline, task_id) in shown {
        let id = state.reminder_targets.next_id(&task_id);
        let _ = app
            .notification()
            .builder()
            .id(id)
            .title(headline)
            .body(crate::i18n::reminder_body(lang))
            .show();
    }
    if folded > 0 {
        let _ = app
            .notification()
            .builder()
            .title(crate::i18n::more_reminders(lang, folded))
            .body(crate::i18n::reminder_body(lang))
            .show();
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(crate::i18n::tray_tooltip(lang, unread)));
    }

    Ok(())
}

/// Backs up the ledger once a day; every other tick only checks a file exists.
fn backup_ledger(app: &AppHandle, conn: &rusqlite::Connection) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let result = crate::services::export::backup_daily(conn, &data_dir.join("backups"));
    crate::services::export::record_error(conn, result.err());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reminder_targets_assign_and_resolve() {
        let map = ReminderTargets::default();
        let a = map.next_id("t1");
        let b = map.next_id("t2");
        assert_ne!(a, b);
        assert_eq!(map.task_for(a).as_deref(), Some("t1"));
        assert_eq!(map.task_for(b).as_deref(), Some("t2"));
        assert_eq!(map.task_for(-1), None);
    }

    #[test]
    fn split_toasts_keeps_every_name_up_to_the_cap() {
        for count in 1..=MAX_TOASTS {
            let (shown, folded) = split_toasts(vec![1u8; count]);
            assert_eq!(shown.len(), count);
            assert_eq!(folded, 0);
        }
        assert_eq!(split_toasts(Vec::<u8>::new()), (vec![], 0));
    }

    #[test]
    fn split_toasts_folds_the_rest_into_one_summary() {
        let (shown, folded) = split_toasts(vec![1u8, 2, 3, 4, 5]);
        assert_eq!(shown, vec![1, 2, 3]);
        assert_eq!(folded, 2);
    }
}
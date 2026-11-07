pub mod rules;

use crate::state::AppState;
use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Utc};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;
use tauri::Manager;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// What a tray toast points at: the task it is about, or the week page (the digest).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReminderTarget {
    Task(String),
    Week,
}

/// Notification id → what a tap should open.
#[derive(Default)]
pub struct ReminderTargets {
    next: AtomicI32,
    targets: Mutex<HashMap<i32, ReminderTarget>>,
}

impl ReminderTargets {
    pub fn next_id(&self, target: ReminderTarget) -> i32 {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut targets) = self.targets.lock() {
            if targets.len() >= MAX_TARGETS {
                targets.clear();
            }
            targets.insert(id, target);
        }
        id
    }

    pub fn target_for(&self, id: i32) -> Option<ReminderTarget> {
        self.targets.lock().ok()?.get(&id).cloned()
    }
}

/// The buttons every task reminder toast carries; registered before showing.
pub const ACTION_TYPE_ID: &str = "ordo-reminder";
const SNOOZE_HOUR: &str = "snooze_hour";
const SNOOZE_TOMORROW: &str = "snooze_tomorrow";

fn reminder_actions(lang: crate::i18n::Lang) -> tauri_plugin_notification::ActionType {
    use tauri_plugin_notification::{Action, ActionType};
    ActionType::builder(ACTION_TYPE_ID)
        .actions(vec![
            Action::builder(SNOOZE_HOUR, crate::i18n::snooze_hour(lang)).build(),
            Action::builder(SNOOZE_TOMORROW, crate::i18n::snooze_tomorrow(lang)).build(),
        ])
        .build()
}

/// When a snooze button asks for the reminder back, as UTC; none for other actions.
pub fn snoozed_until(action_id: &str, now: DateTime<Local>) -> Option<DateTime<Utc>> {
    match action_id {
        SNOOZE_HOUR => Some((now + Duration::hours(1)).with_timezone(&Utc)),
        SNOOZE_TOMORROW => {
            let day = now.date_naive() + Duration::days(1);
            let at = Local
                .with_ymd_and_hms(day.year(), day.month(), day.day(), 9, 0, 0)
                .single()?;
            Some(at.with_timezone(&Utc))
        }
        _ => None,
    }
}

/// Per-task toasts in one tick before the rest collapse into a single summary.
const MAX_TOASTS: usize = 3;

/// Only a toast still on screen can be tapped, so the id map keeps the newest few.
const MAX_TARGETS: usize = 200;

/// Fired reminders older than this are dropped after a successful daily backup.
const NOTIFICATION_KEEP_DAYS: i64 = 90;

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
    // Copy the ledger before taking the lock: VACUUM INTO reads the whole database and
    // must not leave the UI waiting behind the app's only connection.
    let (backed_up, backup_error) = backup_ledger(app);
    let state = app.state::<AppState>();
    // Everything that touches the ledger happens under this one lock; notifications and
    // the tray are updated after it is released, so a slow OS call cannot stall the app.
    let (lang, toasts, digest, unread) = {
        let conn = state.db.lock().map_err(|_| "db_lock_poisoned".to_string())?;
        crate::services::export::record_error(&conn, backup_error);
        let lang = crate::i18n::from_conn(&conn);
        let now = chrono::Local::now();
        if backed_up {
            let cutoff = (now - chrono::Duration::days(NOTIFICATION_KEEP_DAYS))
                .with_timezone(&chrono::Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
            let _ = crate::repo::notifications::prune_before(&conn, &cutoff);
        }
        // Rules turn into real task rows first, so today's timed task can remind below.
        let _ = crate::services::rules::materialize(&conn, now);
        let candidates = rules::candidates(&conn, now)?;
        let today = now.format("%Y-%m-%d").to_string();
        let now_utc = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

        let mut toasts: Vec<(String, ReminderTarget)> = Vec::new();
        for candidate in candidates {
            let title: String = conn
                .query_row("SELECT title FROM tasks WHERE id = ?1", [&candidate.task_id], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?;
            if candidate.record {
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
            }
            let headline = crate::i18n::reminder_headline(
                lang,
                candidate.kind,
                candidate.due_key == today,
                &title,
            );
            toasts.push((headline, ReminderTarget::Task(candidate.task_id)));
        }
        // The digest is dated here, so a failure to show cannot fire it twice.
        let digest = rules::digest(&conn, now).unwrap_or(None);
        if digest.is_some() {
            let _ = crate::repo::settings::set(&conn, "reminders.digest_date", &today);
        }
        let unread = crate::repo::notifications::unread_count(&conn).unwrap_or(0);
        (lang, toasts, digest, unread)
    };

    let (shown, folded) = split_toasts(toasts);
    if !shown.is_empty() || digest.is_some() {
        // The buttons only reach the toast once this app's action type is registered.
        let _ = app
            .notification()
            .register_action_types(vec![reminder_actions(lang)]);
    }
    for (headline, target) in shown {
        let id = state.reminder_targets.next_id(target);
        let _ = app
            .notification()
            .builder()
            .id(id)
            .title(headline)
            .body(crate::i18n::reminder_body(lang))
            .action_type_id(ACTION_TYPE_ID)
            .show();
    }
    if let Some(digest) = digest {
        let body = crate::i18n::digest_body(
            lang,
            digest.due,
            digest.overdue,
            &digest.titles,
            digest.folded,
        );
        let id = state.reminder_targets.next_id(ReminderTarget::Week);
        let _ = app
            .notification()
            .builder()
            .id(id)
            .title(crate::i18n::digest_title(lang))
            .body(body)
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

/// Backs up the ledger once a day on its own connection; every other tick only checks a
/// file exists. The two values say whether this tick wrote a copy (which is also when
/// cleanup runs) and why it failed, if it did.
fn backup_ledger(app: &AppHandle) -> (bool, Option<String>) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return (false, Some("no_app_data_dir".into()));
    };
    let path = data_dir.join("ordo.db");
    if !path.is_file() {
        return (false, Some("missing_db".into()));
    }
    let conn = match rusqlite::Connection::open(&path) {
        Ok(conn) => conn,
        Err(e) => return (false, Some(e.to_string())),
    };
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
    let result = crate::services::export::backup_daily(&conn, &data_dir.join("backups"));
    let made = result.as_ref().map(|path| path.is_some()).unwrap_or(false);
    (made, result.err())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Timelike;

    #[test]
    fn reminder_targets_assign_and_resolve() {
        let map = ReminderTargets::default();
        let a = map.next_id(ReminderTarget::Task("t1".into()));
        let b = map.next_id(ReminderTarget::Week);
        assert_ne!(a, b);
        assert_eq!(map.target_for(a), Some(ReminderTarget::Task("t1".into())));
        assert_eq!(map.target_for(b), Some(ReminderTarget::Week));
        assert_eq!(map.target_for(-1), None);
    }

    #[test]
    fn reminder_targets_keep_only_the_newest() {
        let map = ReminderTargets::default();
        let oldest = map.next_id(ReminderTarget::Task("t1".into()));
        for _ in 0..MAX_TARGETS {
            map.next_id(ReminderTarget::Task("t2".into()));
        }
        assert!(map.target_for(oldest).is_none(), "the oldest target is dropped");
        let newest = map.next_id(ReminderTarget::Week);
        assert_eq!(map.target_for(newest), Some(ReminderTarget::Week));
    }

    #[test]
    fn snooze_buttons_land_an_hour_or_next_morning() {
        let now = Local.with_ymd_and_hms(2026, 10, 20, 17, 30, 0).unwrap();
        assert_eq!(
            snoozed_until(SNOOZE_HOUR, now).unwrap().to_rfc3339(),
            (now + Duration::hours(1)).with_timezone(&Utc).to_rfc3339()
        );
        let tomorrow = snoozed_until(SNOOZE_TOMORROW, now).unwrap();
        let local = tomorrow.with_timezone(&Local);
        assert_eq!(local.date_naive(), now.date_naive() + Duration::days(1));
        assert_eq!((local.hour(), local.minute()), (9, 0));
        assert_eq!(snoozed_until("tap", now), None);
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
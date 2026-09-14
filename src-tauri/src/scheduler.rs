//! Background reminder scheduler (R-01) and its system-notification delivery
//! (R-02).
//!
//! A plain OS thread wakes on a fixed interval, locks the shared connection
//! just long enough for one [`services::scan_reminders`] pass, and for every
//! newly fired reminder broadcasts a `reminder:triggered` event to the
//! frontend *and* shows a system notification via
//! `tauri-plugin-notification`. Both run outside the webview, so reminders
//! keep working while the window is hidden, minimized, or closed to the tray.

use std::time::Duration;

use chrono::{Local, Utc};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::db::Db;
use crate::models::{Reminder, ReminderKind};
use crate::services;

/// Event name the frontend subscribes to; payload is a `Reminder`.
pub const REMINDER_EVENT: &str = "reminder:triggered";

/// How often the scheduler scans for triggerable reminders. Reminders have
/// 10-minute granularity, so half a minute keeps latency well below that.
const SCAN_INTERVAL: Duration = Duration::from_secs(30);

/// Title/body of the system notification for one reminder. The body mirrors
/// the in-app toast text (`features/tasks/reminders.ts`); the due time
/// renders in the user's local timezone.
fn notification_texts(reminder: &Reminder) -> (String, String) {
    let time = reminder.due_at.with_timezone(&Local).format("%H:%M");
    // A subtask reminder names both levels: the task alone would be ambiguous
    // when a task carries several dated subtasks.
    let subject = match &reminder.subtask_title {
        Some(subtask) => format!("{} › {}", reminder.task_title, subtask),
        None => reminder.task_title.clone(),
    };
    let body = match reminder.kind {
        ReminderKind::Advance1h => format!("「{subject}」将于 1 小时后（{time}）到期"),
        ReminderKind::Advance10m => format!("「{subject}」将于 10 分钟后（{time}）到期"),
        ReminderKind::Due => format!("「{subject}」已到截止时间（{time}）"),
    };
    ("Ordo 任务提醒".to_string(), body)
}

/// Shows the OS-level notification; failures (e.g. no registered app id on
/// an uninstalled dev build) are logged, never fatal — the frontend still
/// receives the event.
fn show_notification(app: &AppHandle, reminder: &Reminder) {
    let (title, body) = notification_texts(reminder);
    if let Err(error) = app.notification().builder().title(title).body(body).show() {
        eprintln!("system notification failed: {error}");
    }
}

/// Spawns the scheduler thread; call once from app setup.
pub fn spawn(app: AppHandle, db: Db) {
    std::thread::Builder::new()
        .name("reminders".into())
        .spawn(move || loop {
            std::thread::sleep(SCAN_INTERVAL);
            let triggered = match db.lock() {
                Ok(conn) => services::scan_reminders(&conn, Utc::now()),
                Err(_) => continue, // poisoned lock: skip this tick
            };
            match triggered {
                Ok(list) => {
                    for reminder in &list {
                        if let Err(error) = app.emit(REMINDER_EVENT, reminder) {
                            eprintln!("emit {REMINDER_EVENT} failed: {error}");
                        }
                        show_notification(&app, reminder);
                    }
                }
                Err(error) => eprintln!("reminder scan failed: {error}"),
            }
        })
        .expect("spawn reminder scheduler thread");
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use uuid::Uuid;

    #[test]
    fn notification_texts_phrase_every_kind_in_local_time() {
        let due = Utc.with_ymd_and_hms(2026, 9, 11, 4, 30, 0).unwrap();
        // Render the expectation through the same Local conversion so the
        // assertion holds in any timezone.
        let time = due.with_timezone(&Local).format("%H:%M").to_string();
        let reminder = |kind| Reminder {
            task_id: Uuid::new_v4(),
            task_title: "提交周报".into(),
            kind,
            due_at: due,
            subtask_id: None,
            subtask_title: None,
        };

        let (title, _) = notification_texts(&reminder(ReminderKind::Due));
        assert_eq!(title, "Ordo 任务提醒");

        let cases = [
            (
                ReminderKind::Advance1h,
                format!("「提交周报」将于 1 小时后（{time}）到期"),
            ),
            (
                ReminderKind::Advance10m,
                format!("「提交周报」将于 10 分钟后（{time}）到期"),
            ),
            (
                ReminderKind::Due,
                format!("「提交周报」已到截止时间（{time}）"),
            ),
        ];
        for (kind, expected) in cases {
            let (_, body) = notification_texts(&reminder(kind));
            assert_eq!(body, expected);
        }
    }

    #[test]
    fn subtask_reminders_name_the_parent_and_the_subtask() {
        let (_, body) = notification_texts(&Reminder {
            task_id: Uuid::nil(),
            task_title: "写周报".into(),
            kind: ReminderKind::Due,
            due_at: Utc.with_ymd_and_hms(2026, 9, 11, 12, 0, 0).unwrap(),
            subtask_id: Some(Uuid::nil()),
            subtask_title: Some("收集数据".into()),
        });
        assert!(
            body.contains("写周报 › 收集数据"),
            "unexpected body: {body}"
        );
    }
}

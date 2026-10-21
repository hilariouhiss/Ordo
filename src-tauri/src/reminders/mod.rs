pub mod rules;

use crate::state::AppState;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;
use tauri::Manager;
use tauri::{AppHandle, Emitter};
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

pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        let _ = tick(&app);
        std::thread::sleep(std::time::Duration::from_secs(30));
    });
}

fn tick(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|_| "db_lock_poisoned".to_string())?;
    let now = chrono::Local::now();
    let candidates = rules::candidates(&conn, now)?;
    let today = now.format("%Y-%m-%d").to_string();
    let now_utc = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let mut toasts: Vec<(String, String)> = Vec::new();
    let mut fired_any = false;
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
        let headline = match candidate.kind {
            "due_tomorrow" if candidate.due_key == today => format!("今天截止：{}", title),
            "due_tomorrow" => format!("明天截止：{}", title),
            "overdue" => format!("已逾期：{}", title),
            _ => format!("该开始了：{}", title),
        };
        toasts.push((headline, candidate.task_id));
        fired_any = true;
    }
    if let [(headline, task_id)] = toasts.as_slice() {
        let id = state.reminder_targets.next_id(task_id);
        let _ = app
            .notification()
            .builder()
            .id(id)
            .title(headline)
            .body("打开 ordo 查看")
            .show();
    } else if toasts.len() > 1 {
        let _ = app
            .notification()
            .builder()
            .title(format!("你错过了 {} 条提醒", toasts.len()))
            .body("打开 ordo 查看")
            .show();
    }
    if fired_any {
        let _ = app.emit("reminder:fired", ());
    }

    if let Some(tray) = app.tray_by_id("main-tray") {
        let unread = crate::repo::notifications::unread_count(&conn).unwrap_or(0);
        let _ = tray.set_tooltip(Some(format!("ordo · {} 条提醒", unread)));
    }

    backup_ledger(app, &conn);
    Ok(())
}

/// Backs up the ledger once a day; every other tick only checks a file exists.
fn backup_ledger(app: &AppHandle, conn: &rusqlite::Connection) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = crate::services::export::backup_daily(conn, &data_dir.join("backups"));
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
}
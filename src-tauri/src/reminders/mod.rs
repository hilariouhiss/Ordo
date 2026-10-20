pub mod rules;

use crate::state::AppState;
use tauri::Manager;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

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
        let (headline, body) = match candidate.kind {
            "due_tomorrow" => (
                if candidate.due_key == today {
                    format!("今天截止：{}", title)
                } else {
                    format!("明天截止：{}", title)
                },
                format!("截止 {}", candidate.due_key),
            ),
            "overdue" => (format!("已逾期：{}", title), format!("原定 {}", candidate.due_key)),
            _ => (format!("该开始了：{}", title), "挂起到期".to_string()),
        };
        let _ = app.notification().builder().title(headline).body(body).show();
        let _ = app.emit("reminder:fired", ());
    }

    if let Some(tray) = app.tray_by_id("main-tray") {
        let unread = crate::repo::notifications::unread_count(&conn).unwrap_or(0);
        let _ = tray.set_tooltip(Some(format!("ordo · {} 条提醒", unread)));
    }
    Ok(())
}

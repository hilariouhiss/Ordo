//! Background reminder scheduler (R-01).
//!
//! A plain OS thread wakes on a fixed interval, locks the shared connection
//! just long enough for one [`services::scan_reminders`] pass, and broadcasts
//! every newly fired reminder to the frontend as a `reminder:triggered`
//! event. Running outside the webview keeps reminders working while the
//! window is hidden, minimized, or later closed to the tray (R-02 adds the
//! system-notification delivery on top of these events).

use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Emitter};

use crate::db::Db;
use crate::services;

/// Event name the frontend subscribes to; payload is a `Reminder`.
pub const REMINDER_EVENT: &str = "reminder:triggered";

/// How often the scheduler scans for triggerable reminders. Reminders have
/// 10-minute granularity, so half a minute keeps latency well below that.
const SCAN_INTERVAL: Duration = Duration::from_secs(30);

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
                    }
                }
                Err(error) => eprintln!("reminder scan failed: {error}"),
            }
        })
        .expect("spawn reminder scheduler thread");
}

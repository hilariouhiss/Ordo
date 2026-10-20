use rusqlite::Connection;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        Self {
            db: Arc::new(Mutex::new(conn)),
        }
    }
}

pub async fn with_db<T, F>(state: &AppState, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
{
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db_lock_poisoned".to_string())?;
        f(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

use crate::error::AppError;

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("migrations");
}

/// Shared handle to the SQLite connection, stored as Tauri managed state.
///
/// `Connection` is `Send` but not `Sync`, so it is wrapped in a `Mutex` to make
/// it safe to share across command handler threads.
pub type Db = Mutex<Connection>;

/// Opens the SQLite database at `path`, applies pending migrations, and returns
/// a shared `Db` handle suitable for `app.manage(...)`.
pub fn init(path: &Path) -> Result<Db, AppError> {
    let mut conn = Connection::open(path)?;
    embedded::migrations::runner().run(&mut conn)?;
    Ok(Mutex::new(conn))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_run_on_in_memory_db() {
        let mut conn = Connection::open_in_memory().unwrap();
        embedded::migrations::runner().run(&mut conn).unwrap();
    }
}

use thiserror::Error;

/// Application-wide error type returned by the backend layers.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("migration error: {0}")]
    Migration(#[from] refinery::Error),

    #[error("database setup error: {0}")]
    Db(String),
}

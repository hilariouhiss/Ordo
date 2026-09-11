use serde::ser::{Serialize, SerializeMap, Serializer};
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

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("validation error: {0}")]
    Validation(String),

    #[error("not found: {0}")]
    NotFound(String),
}

impl AppError {
    /// Stable snake_case error code crossing IPC as `{"code", "message"}`.
    ///
    /// The values must stay in sync with the frontend whitelist in
    /// `src/common/ipc/errors.ts`; unknown codes degrade to "unknown" there.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Database(_) => "database",
            AppError::Migration(_) => "migration",
            AppError::Db(_) => "db",
            AppError::Io(_) => "io",
            AppError::Validation(_) => "validation",
            AppError::NotFound(_) => "not_found",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("code", self.code())?;
        map.serialize_entry("message", &self.to_string())?;
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_as_code_message_pair() {
        let cases = [
            (AppError::Db("no such directory".into()), "db"),
            (AppError::Validation("标题不能为空".into()), "validation"),
            (AppError::NotFound("task 42 not found".into()), "not_found"),
        ];
        for (error, code) in cases {
            let value = serde_json::to_value(&error).unwrap();
            assert_eq!(value["code"], json!(code));
            assert_eq!(value["message"], json!(error.to_string()));
        }
    }

    #[test]
    fn database_errors_convert_and_serialize() {
        let error: AppError = rusqlite::Error::QueryReturnedNoRows.into();
        assert_eq!(error.code(), "database");

        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value["code"], json!("database"));
        assert_eq!(value["message"], json!(error.to_string()));
        assert!(value["message"]
            .as_str()
            .unwrap()
            .contains("Query returned no rows"));
    }

    #[test]
    fn every_constructible_variant_has_non_empty_message() {
        let errors = [
            AppError::Database(rusqlite::Error::QueryReturnedNoRows),
            AppError::Db("boom".into()),
            AppError::Validation("bad input".into()),
            AppError::NotFound("missing".into()),
        ];
        for error in errors {
            assert!(!error.to_string().is_empty());
            let value = serde_json::to_value(&error).unwrap();
            assert!(!value["message"].as_str().unwrap().is_empty());
        }
    }
}

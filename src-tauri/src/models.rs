//! Domain models (structs/enums) and their serde serialization.
//!
//! Convention: every persisted row carries a UUID primary key, `created_at`
//! and `updated_at` timestamps, and uses soft delete via a `deleted_at` column.

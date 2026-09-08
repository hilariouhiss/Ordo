-- Migration V1: initial database setup.
--
-- Conventions used across the schema (apply to all future migrations):
--   * Primary keys: TEXT UUIDs (v4), generated in Rust via `uuid`.
--   * Timestamps: ISO-8601 UTC strings, generated in Rust via `chrono`.
--   * Soft delete: a nullable `deleted_at` timestamp instead of hard DELETE.
--
-- Business tables (projects, tasks, tags, comments) are added in later migrations.

PRAGMA foreign_keys = ON;

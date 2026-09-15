-- Migration V5: namespaces — an optional container grouping related projects.
--
-- A project belongs to at most one namespace, so the relation is a nullable
-- foreign key on `projects` rather than a join table (a join table would only
-- add a table, an index and a second write path for a "at most one" relation).
--
-- `ON DELETE SET NULL` only matters for hard deletes; the command surface
-- never hard-deletes a namespace (`deleted_at` stays reserved, exactly as for
-- projects), so the live rule is the frontend's: a project whose namespace no
-- longer resolves is shown as ungrouped instead of disappearing.
--
-- The column is added with a NULL default, which is what SQLite requires for
-- `ADD COLUMN ... REFERENCES` while foreign keys are enabled (V1 turns them on,
-- and `db.rs` asserts they are enforced).

CREATE TABLE namespaces (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT,
    icon        TEXT,
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
    sort_order  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

ALTER TABLE projects ADD COLUMN namespace_id TEXT
    REFERENCES namespaces(id) ON DELETE SET NULL;

CREATE INDEX idx_projects_namespace ON projects(namespace_id);

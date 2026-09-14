-- Migration V4: task/subtask attributes and dependency edges.
--
-- Attributes: tasks gain a 1-5 complexity; subtasks gain the description,
-- priority, due date and complexity they were missing.
--
-- Dependencies: `(dependent, depends_on)` reads "dependent waits for
-- depends_on". Both edge tables follow the `task_tags` convention (pure join
-- table: composite key, no UUID/audit columns); `subtask_reminders` mirrors
-- V3's `task_reminders`, which cannot be reused because it is WITHOUT ROWID
-- and a nullable source column cannot join that primary key.
--
-- The index on `depends_on` is load-bearing: both the reverse lookup ("who is
-- waiting for me") and the cycle check walk that side.

ALTER TABLE tasks ADD COLUMN complexity INTEGER
    CHECK (complexity IS NULL OR complexity BETWEEN 1 AND 5);

ALTER TABLE subtasks ADD COLUMN note       TEXT;
ALTER TABLE subtasks ADD COLUMN priority   TEXT NOT NULL DEFAULT 'none'
    CHECK (priority IN ('high', 'medium', 'low', 'none'));
ALTER TABLE subtasks ADD COLUMN due_at     TEXT;
ALTER TABLE subtasks ADD COLUMN complexity INTEGER
    CHECK (complexity IS NULL OR complexity BETWEEN 1 AND 5);

CREATE TABLE task_dependencies (
    task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on),
    CHECK (task_id <> depends_on)
) WITHOUT ROWID;

CREATE INDEX idx_task_dependencies_depends_on ON task_dependencies(depends_on);

CREATE TABLE subtask_dependencies (
    subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (subtask_id, depends_on),
    CHECK (subtask_id <> depends_on)
) WITHOUT ROWID;

CREATE INDEX idx_subtask_dependencies_depends_on ON subtask_dependencies(depends_on);

CREATE TABLE subtask_reminders (
    subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('advance_1h', 'advance_10m', 'due')),
    sent_at    TEXT NOT NULL,
    PRIMARY KEY (subtask_id, kind)
) WITHOUT ROWID;

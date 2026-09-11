-- Migration V3: reminder dedup markers (R-01).
--
-- One row per fired (task, kind) reminder so the background scheduler never
-- re-fires, including across app restarts. Markers cascade away with hard
-- task deletes; soft-deleted and completed tasks are filtered by the scan
-- query instead, so their markers simply stay behind — restoring a task
-- never re-fires reminders that already fired.

CREATE TABLE task_reminders (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL CHECK (kind IN ('advance_1h', 'advance_10m', 'due')),
    sent_at TEXT NOT NULL,
    PRIMARY KEY (task_id, kind)
) WITHOUT ROWID;

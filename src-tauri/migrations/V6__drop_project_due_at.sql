-- Migration V6: projects lose their deadline (R2).
--
-- A deadline belongs to a *task* (or a subtask): it is the thing you work on
-- and complete. A project is a container, and its "due date" only ever fed a
-- countdown line that nobody acted on. Task/subtask `due_at` and the whole
-- reminder chain are untouched — only the project column goes.
--
-- `projects` has no index on `due_at`, so DROP COLUMN rebuilds no index. Old
-- backup documents still parse: serde ignores the extra `dueAt` key on import.

ALTER TABLE projects DROP COLUMN due_at;

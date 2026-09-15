-- 任务层级：子任务并入任务树（单层，自引用）。
--
-- 子任务原本是一张独立表（V2 建立、V4 补属性）。它与 tasks 的列几乎重合，
-- 却要各自一套命令、依赖边、提醒标记与前端缓存。这里把 subtasks 行搬进
-- tasks，再删掉三张子任务表 —— 不重建 tasks：task_search 是按 rowid 记录的
-- 外部内容表，重建会打散索引并丢掉同步触发器。
--
-- ADD COLUMN 带 REFERENCES 只在默认值为 NULL 时合法（外键已启用），
-- 因此这里是可空的 TEXT 列；自引用与单层约束由服务层把关（§6.3）。

-- 自引用外键。任务只有软删（没有硬删路径），CASCADE 在这里是装饰性的；
-- 若某版 SQLite 拒绝在 ADD COLUMN 里带 ON DELETE 动作，退化成纯 REFERENCES 即可。
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE;

CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);

-- 子任务 → 带父任务的任务。project_id 跟父任务走（子任务不跨项目），
-- column_id 留空（子任务不上看板），repeat_rule 留空（子任务默认不重复）。
--
-- done 是布尔而 completed_at 是时刻：取 updated_at 作为完成时刻的最近似值
-- （它必然 >= 真正完成的时间点，且就是该行最后一次写入），created_at 兜底。
INSERT INTO tasks (id, project_id, parent_task_id, title, note, priority,
                   column_id, due_at, completed_at, repeat_rule, complexity,
                   sort_order, created_at, updated_at, deleted_at)
SELECT s.id, t.project_id, s.task_id, s.title, s.note, s.priority,
       NULL, s.due_at,
       CASE WHEN s.done = 1 THEN COALESCE(s.updated_at, s.created_at) END,
       NULL, s.complexity,
       s.sort_order, s.created_at, s.updated_at, s.deleted_at
FROM subtasks s
JOIN tasks t ON t.id = s.task_id;

-- 依赖边：子任务边改指任务。两端本来就是同一父任务下的兄弟，语义不变。
INSERT OR IGNORE INTO task_dependencies (task_id, depends_on, created_at)
SELECT subtask_id, depends_on, created_at FROM subtask_dependencies;

-- 提醒去重标记：subtask_id 的值就是搬迁后的任务 id。必须原样搬，
-- 否则「提前 1 小时 / 10 分钟 / 到期」会全部重发一遍。
INSERT OR IGNORE INTO task_reminders (task_id, kind, sent_at)
SELECT subtask_id, kind, sent_at FROM subtask_reminders;

DROP TABLE subtask_dependencies;
DROP TABLE subtask_reminders;
DROP TABLE subtasks;

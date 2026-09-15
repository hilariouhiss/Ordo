-- 孤儿子任务：V7 把 subtasks 原样搬进 tasks 时没有看父任务的死活，
-- 「存活子任务挂在已软删父任务下」的行因此照搬了进来。父任务看不见，它们却会
-- 出现在 task:list 里、还会触发提醒 —— 子任务只能靠父任务活着（§9.2）。
-- 父任务不在，子任务就跟着走；删除戳取父任务自己那个（它既然被删就必有值），
-- 让父子在同一时刻消失。删除戳已经有的子任务不动。
UPDATE tasks
   SET deleted_at = COALESCE(
           (SELECT p.deleted_at FROM tasks p WHERE p.id = tasks.parent_task_id),
           deleted_at)
 WHERE parent_task_id IS NOT NULL
   AND deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM tasks p
                WHERE p.id = tasks.parent_task_id AND p.deleted_at IS NOT NULL);

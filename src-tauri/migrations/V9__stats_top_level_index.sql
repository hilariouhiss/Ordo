-- 统计口径：两个统计只数顶层任务（parent_task_id IS NULL）。
--
-- 加上这个等值谓词后，趋势查询的计划从 idx_tasks_completed_at 的范围 seek
-- 退化成 idx_tasks_parent 的整索引扫描 —— 等值谓词比范围谓词更省，规划器
-- 就先按它取行，completed_at 的范围只剩过滤。这条复合索引把两者放回同一次
-- seek：等值列前置、范围列后置（试过只按 completed_at 的部分索引，规划器
-- 依然选 idx_tasks_parent）。idx_tasks_completed_at 保留：它仍是全表口径的
-- 通用索引；idx_tasks_parent 也保留，它的前缀查询由这条复合索引覆盖，但本身
-- 更窄，仍然是 list_by_parent 那类查询的自然选择。
CREATE INDEX idx_tasks_parent_completed ON tasks(parent_task_id, completed_at);

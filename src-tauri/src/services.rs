//! Business logic layer.
//!
//! Services orchestrate repositories, enforce invariants, and are what Tauri
//! commands call. They never emit SQL themselves.
//!
//! Responsibilities here: input validation, id/timestamp generation (backend
//! is authoritative), sort-key derivation for list positions, and wrapping
//! multi-step writes in transactions. All functions are pure over a
//! `&Connection` so commands can hand them the managed connection directly.
//!
//! Sort keys follow `sort`: normally only one row is written, but when the
//! key space is exhausted (or a key would exceed [`MAX_SORT_KEY_LEN`]) the
//! whole sibling list is rekeyed with evenly spaced keys — a local rebalance
//! that keeps keys short forever.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::{
    BackupDocument, BackupSummary, BoardColumn, Comment, Dependency, Namespace, NewComment,
    NewNamespace, NewProject, NewTag, NewTask, NewTimeEntry, Patch, Priority, Project,
    ProjectProgress, ProjectStatus, ProjectUnfinished, Reminder, ReminderKind, Reorder, RepeatFreq,
    RepeatRule, SearchHit, SearchHitKind, Tag, Task, TaskBlocked, TaskKey, TaskPage, TaskWithTags,
    TimeDistribution, TimeDistributionQuery, TimeEntry, TrendPoint, TrendQuery, UpdateComment,
    UpdateNamespace, UpdateProject, UpdateTag, UpdateTask, UpdateTimeEntry,
};
use crate::repositories::{
    backup, board_columns, comments, dependencies, namespaces, projects, reminders, search, stats,
    tags, task_tags, tasks, time_entries,
};
use crate::sort;

/// Sort keys longer than this trigger a sibling-list rebalance; keys normally
/// stay within a few characters (see the `sort` module docs).
const MAX_SORT_KEY_LEN: usize = 32;

fn not_found(what: &str, id: Uuid) -> AppError {
    AppError::NotFound(format!("{what} {id} 不存在"))
}

/// Trims and rejects blank user-provided text, e.g. `{label}不能为空`.
fn validated_text(label: &str, raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label}不能为空")));
    }
    Ok(trimmed.to_string())
}

/// Trims and rejects blank titles/names shared by tasks, tags and subtasks.
fn validated_name(raw: &str) -> Result<String, AppError> {
    validated_text("标题", raw)
}

fn dedup(ids: Vec<Uuid>) -> Vec<Uuid> {
    let mut seen = HashSet::new();
    ids.into_iter().filter(|id| seen.insert(*id)).collect()
}

/// Ensures every tag id refers to a live (non-deleted) tag.
fn validate_tag_ids(conn: &Connection, tag_ids: &[Uuid]) -> Result<(), AppError> {
    for id in tag_ids {
        if tags::get(conn, *id)?.is_none() {
            return Err(not_found("标签", *id));
        }
    }
    Ok(())
}

/// Repeat rules must recur: an interval of 0 would never advance.
fn validate_repeat_rule(rule: &RepeatRule) -> Result<(), AppError> {
    if rule.interval < 1 {
        return Err(AppError::Validation("重复间隔需不小于 1".into()));
    }
    Ok(())
}

/// Complexity is a 1-5 estimate or `None`; anything else is a client bug.
fn validated_complexity(value: Option<i64>) -> Result<Option<i64>, AppError> {
    match value {
        Some(level) if !(1..=5).contains(&level) => {
            Err(AppError::Validation("复杂度需在 1-5 之间".into()))
        }
        other => Ok(other),
    }
}

/// Advances a due time by one recurrence period. Monthly addition clamps to
/// the month's last day (Jan 31 + 1 month = Feb 28); the overflow fallback is
/// unreachable for realistic dates and keeps completion non-fatal.
fn next_due(due: DateTime<Utc>, rule: &RepeatRule) -> DateTime<Utc> {
    match rule.freq {
        RepeatFreq::Daily => due + chrono::Duration::days(rule.interval as i64),
        RepeatFreq::Weekly => due + chrono::Duration::weeks(rule.interval as i64),
        RepeatFreq::Monthly => due
            .checked_add_months(chrono::Months::new(rule.interval))
            .unwrap_or(due),
    }
}

/// `due` advanced by `periods` recurrence periods, one [`next_due`] at a time.
/// A period that cannot move the date (a month addition overflowing at the end
/// of `DateTime`'s range) stops the walk instead of spinning.
fn advance_periods(due: DateTime<Utc>, rule: &RepeatRule, periods: u32) -> DateTime<Utc> {
    let mut date = due;
    for _ in 0..periods {
        let next = next_due(date, rule);
        if next <= date {
            return date;
        }
        date = next;
    }
    date
}

/// The next instance's due time, and how many periods the anchor moved.
///
/// One period past `due`, and then — when the task was completed after that
/// instance had already come due — as many further periods as it takes for the
/// next instance to land in the future (QA-13). Completing a daily task a week
/// late schedules tomorrow, not a week ago; the alternative (catching up one
/// period per completion, with the instance born overdue every time) turned a
/// missed week into seven completions.
///
/// The count comes back with the date because the copied subtasks advance by
/// the *same* number of periods, which is what keeps their offset to the parent.
///
/// `ponytail:` the catch-up walks period by period. A row left alone for a
/// century is a few thousand cheap additions in one transaction; the arithmetic
/// shortcut is worth writing only if such rows turn up in practice.
fn next_due_after(
    due: DateTime<Utc>,
    rule: &RepeatRule,
    now: DateTime<Utc>,
) -> (DateTime<Utc>, u32) {
    let mut next = next_due(due, rule);
    let mut periods = 1;
    while next <= now {
        let advanced = next_due(next, rule);
        if advanced <= next {
            break;
        }
        next = advanced;
        periods += 1;
    }
    (next, periods)
}

/// Spawns the next instance of a completed repeating task inside the
/// caller's transaction: one period past the task's due time — or the first
/// occurrence after `now`, if the task was completed late — carrying over
/// title/note/priority/project/complexity/tags and the rule itself, appended
/// to `column_id`'s scope. Subtasks are copied as child task rows with their
/// attributes but reset to uncompleted, their due dates advanced by the same
/// number of periods. Repeats anchored to nothing (`due_at = None`) or paused
/// rules complete without spawning.
fn spawn_next_instance(
    conn: &Connection,
    task: &Task,
    column_id: Option<Uuid>,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    let Some(rule) = task.repeat_rule else {
        return Ok(());
    };
    if rule.paused {
        return Ok(());
    }
    let Some(due) = task.due_at else {
        return Ok(());
    };

    let tag_ids: Vec<Uuid> = task_tags::list_tags_for_task(conn, task.id)?
        .into_iter()
        .map(|tag| tag.id)
        .collect();

    // Copies keep the subtask's attributes; `due_at` advances by the same number
    // of periods as the parent (a copy whose date stayed put would be born
    // overdue, and one that advanced by a different count would drift away from
    // the parent). Dependency edges are deliberately NOT inherited: they would
    // point at the previous instance's rows.
    let (parent_due, periods) = next_due_after(due, &rule, now);
    let originals = tasks::list_by_parent(conn, task.id)?;

    let spawned = create_task_in_tx(
        conn,
        NewTask {
            title: task.title.clone(),
            note: task.note.clone(),
            priority: Some(task.priority),
            project_id: task.project_id,
            column_id,
            due_at: Some(parent_due),
            complexity: task.complexity,
            tag_ids,
            subtask_titles: Vec::new(),
            repeat_rule: Some(rule),
            // §9.5: a repeating subtask's next instance is still a child of the
            // same parent.
            parent_task_id: task.parent_task_id,
        },
    )?;

    let mut last_key: Option<String> = None;
    for original in originals {
        let key = match &last_key {
            None => sort::first(),
            Some(last) => sort::after(last)?,
        };
        tasks::insert(
            conn,
            &Task {
                id: Uuid::new_v4(),
                project_id: spawned.project_id,
                title: original.title,
                note: original.note,
                priority: original.priority,
                column_id: None,
                due_at: original
                    .due_at
                    .map(|date| advance_periods(date, &rule, periods)),
                completed_at: None,
                repeat_rule: original.repeat_rule,
                complexity: original.complexity,
                parent_task_id: Some(spawned.id),
                sort_order: key.clone(),
                created_at: spawned.created_at,
                updated_at: spawned.created_at,
                deleted_at: None,
            },
        )?;
        last_key = Some(key);
    }
    Ok(())
}

/// Sort key for appending after the last sibling (input ascending by key).
///
/// When the append would exceed [`MAX_SORT_KEY_LEN`], also returns fresh keys
/// for every existing sibling (a local rebalance via [`sort::spread`]); the
/// caller persists them in the same transaction as the insert.
///
/// The caller hands in the sibling list, which suits the small global
/// sequences (`projects`, `namespaces`). Tasks go through [`append_task_key`]:
/// their scopes can hold tens of thousands of rows, so asking for the whole
/// list up front is what this function must not be used for.
fn append_key(siblings: &[(Uuid, String)]) -> Result<(String, Vec<(Uuid, String)>), AppError> {
    if siblings.is_empty() {
        return Ok((sort::first(), Vec::new()));
    }
    let key = sort::after(&siblings[siblings.len() - 1].1)?;
    if key.len() <= MAX_SORT_KEY_LEN {
        return Ok((key, Vec::new()));
    }
    let mut fresh = sort::spread(siblings.len() + 1);
    let new_key = fresh.pop().expect("spread(n) yields n keys");
    let rebalanced = siblings
        .iter()
        .zip(fresh)
        .map(|((id, _), key)| (*id, key))
        .collect();
    Ok((new_key, rebalanced))
}

/// Appending key for a task scope: ask for the scope's **last key** (one index
/// seek) and only load the whole scope when the key would overflow and the
/// siblings have to be re-spread. The old form hydrated every task row, every
/// column, before either branch.
///
/// No "exclude self": a re-parented row only joins its new scope when
/// `tasks::update` writes it, so it cannot show up in the target scope's keys
/// yet.
fn append_task_key(
    conn: &Connection,
    scope: tasks::SortScope,
) -> Result<(String, Vec<(Uuid, String)>), AppError> {
    let Some(last) = tasks::last_sort_key(conn, scope)? else {
        return Ok((sort::first(), Vec::new()));
    };
    let key = sort::after(&last)?;
    if key.len() <= MAX_SORT_KEY_LEN {
        return Ok((key, Vec::new()));
    }
    append_key(&tasks::scope_sort_keys(conn, scope, None)?)
}

/// The neighbour keys of a slot, resolved from the client's `prev`/`next`.
///
/// A one-sided spec is completed with a range query against the target scope
/// (the old form loaded the whole sibling list to answer the same question);
/// both keys must belong to that scope, or the caller gets the same validation
/// error it always did.
fn resolve_neighbours(
    conn: &Connection,
    scope: tasks::SortScope,
    exclude: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<(Option<String>, Option<String>), AppError> {
    if prev.is_none() && next.is_none() {
        return Err(AppError::Validation("需要提供前驱或后继排序键".into()));
    }
    let require = |key: &str| -> Result<(), AppError> {
        if tasks::sort_key_in_scope(conn, scope, key)? {
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "排序键 {key:?} 不属于目标列表"
            )))
        }
    };

    match (&prev, &next) {
        (Some(p), Some(n)) => {
            require(p)?;
            require(n)?;
            Ok((Some(p.clone()), Some(n.clone())))
        }
        (Some(p), None) => {
            require(p)?;
            let n = tasks::next_sort_key(conn, scope, Some(exclude), p)?;
            Ok((Some(p.clone()), n))
        }
        (None, Some(n)) => {
            require(n)?;
            let p = tasks::prev_sort_key(conn, scope, Some(exclude), n)?;
            Ok((p, Some(n.clone())))
        }
        (None, None) => unreachable!("the both-empty case returned above"),
    }
}

/// A key that fits between the resolved neighbours; `None` means the key space
/// is exhausted and the caller has to re-spread the scope. The branches are the
/// ones the old `resolve_slot` used to pick its key.
fn key_between(prev: Option<&str>, next: Option<&str>) -> Result<Option<String>, AppError> {
    let attempt = match (prev, next) {
        (Some(p), Some(n)) => sort::between(p, n),
        (Some(p), None) => sort::after(p),
        (None, Some(n)) => sort::before(n),
        // Both sides empty: the scope has no rows at all (a drop into an empty
        // lane), so there is no neighbour to fit between and the row takes the
        // scope's first key. `resolve_neighbours` only lets this through for
        // that caller.
        (None, None) => Ok(sort::first()),
    };
    match attempt {
        Ok(key) => Ok(Some(key)),
        Err(sort::SortError::Exhausted) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// The exhaustion fallback: re-spread the whole scope and report every key that
/// was rewritten. Only reached when no key fits between the neighbours — the
/// one case that genuinely has to touch every sibling.
fn rebalance_scope(
    tx: &Connection,
    scope: tasks::SortScope,
    id: Uuid,
    moved_sort_order: &str,
    prev: Option<&str>,
    next: Option<&str>,
    now: DateTime<Utc>,
) -> Result<Vec<TaskKey>, AppError> {
    // Where the moved row lands: after its predecessor, or before its
    // successor, or at the end when it has neither.
    let target = match prev {
        Some(p) => tasks::index_of_sort_key(tx, scope, Some(id), p)? + 1,
        None => match next {
            Some(n) => tasks::index_of_sort_key(tx, scope, Some(id), n)?,
            None => tasks::scope_sort_keys(tx, scope, Some(id))?.len(),
        },
    };

    let mut ordered = tasks::scope_sort_keys(tx, scope, Some(id))?;
    ordered.insert(
        target.min(ordered.len()),
        (id, moved_sort_order.to_string()),
    );
    let fresh = sort::spread(ordered.len());
    let mut rebalanced = Vec::with_capacity(ordered.len());
    for ((sibling_id, _), key) in ordered.iter().zip(fresh) {
        if !tasks::set_sort_order(tx, *sibling_id, &key, now)? {
            return Err(not_found("任务", *sibling_id));
        }
        rebalanced.push(TaskKey {
            id: *sibling_id,
            sort_order: key,
        });
    }
    Ok(rebalanced)
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/// Lists tasks with their tag associations embedded; view derivation (inbox/
/// today/upcoming/completed, local-timezone boundaries) happens on the
/// frontend.
pub fn list_tasks(conn: &Connection) -> Result<Vec<TaskWithTags>, AppError> {
    let tasks = tasks::list(conn)?;
    let mut links: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (task_id, tag_id) in task_tags::list_all(conn)? {
        links.entry(task_id).or_default().push(tag_id);
    }
    Ok(tasks
        .into_iter()
        .map(|task| {
            let tag_ids = links.remove(&task.id).unwrap_or_default();
            TaskWithTags { task, tag_ids }
        })
        .collect())
}

/// Wraps one task row in the shape every task-returning command answers with:
/// the row plus its tag links (`task:list`'s own shape, see [`TaskWithTags`]).
///
/// The frontend store keeps one `Task` per row and reads `tagIds` off it
/// unconditionally — editor chips, board badges, the tag filter — so a command
/// that answered with a bare row would leave the field undefined there and the
/// next read of it (`[...task.tagIds]`) would throw.
pub fn task_with_tags(conn: &Connection, task: Task) -> Result<TaskWithTags, AppError> {
    let tag_ids = task_tags::list_tags_for_task(conn, task.id)?
        .into_iter()
        .map(|tag| tag.id)
        .collect();
    Ok(TaskWithTags { task, tag_ids })
}

/// [`task_with_tags`] for a whole run of rows (`task:reorder`).
pub fn tasks_with_tags(conn: &Connection, tasks: Vec<Task>) -> Result<Vec<TaskWithTags>, AppError> {
    tasks
        .into_iter()
        .map(|task| task_with_tags(conn, task))
        .collect()
}

/// A batch of rows as `TaskWithTags`, with the tag links read once for the whole
/// batch — `tasks_with_tags` asks per row, which is fine for one row and not for
/// a page.
fn rows_with_tags(tasks: Vec<Task>, links: &HashMap<Uuid, Vec<Uuid>>) -> Vec<TaskWithTags> {
    tasks
        .into_iter()
        .map(|task| TaskWithTags {
            tag_ids: links.get(&task.id).cloned().unwrap_or_default(),
            task,
        })
        .collect()
}

/// Turns one scope's rows into a `TaskPage`: the children the rows did not
/// bring, the parent titles for children whose parent is off-scope, and the
/// open-prerequisite count of every unfinished row (§4 invariant 3: a completed
/// row reports none). One definition, shared by every scope (today the project
/// scope, later the four views).
fn task_page(conn: &Connection, rows: Vec<Task>) -> Result<TaskPage, AppError> {
    let row_ids: Vec<Uuid> = rows.iter().map(|task| task.id).collect();
    let parent_ids: Vec<Uuid> = rows
        .iter()
        .filter(|task| task.parent_task_id.is_none())
        .map(|task| task.id)
        .collect();
    let children = tasks::list_children_of(conn, &parent_ids, &row_ids)?;

    let mut all_ids = row_ids.clone();
    all_ids.extend(children.iter().map(|task| task.id));

    // One query per concern, all keyed on the page's ids.
    let mut links: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (task_id, tag_id) in task_tags::list_for_tasks(conn, &all_ids)? {
        links.entry(task_id).or_default().push(tag_id);
    }

    // Parents a child row references but this page does not carry.
    let mut seen: HashSet<Uuid> = all_ids.iter().copied().collect();
    let missing: Vec<Uuid> = children
        .iter()
        .filter_map(|task| task.parent_task_id)
        .chain(rows.iter().filter_map(|task| task.parent_task_id))
        .filter(|id| seen.insert(*id))
        .collect();
    let related = tasks::titles_of(conn, &missing)?;

    // 规范 §4 不变量 3：完成的行不报未完成前置（视图本地也是这么置零的），所以
    // 页面自己的载荷要先按「已完成」过滤一遍 `blocked_counts` 的结果。
    let completed: HashSet<Uuid> = rows
        .iter()
        .chain(children.iter())
        .filter(|task| task.completed_at.is_some())
        .map(|task| task.id)
        .collect();

    let blocked = tasks::blocked_counts(conn, &all_ids)?
        .into_iter()
        .filter(|(task_id, _)| !completed.contains(task_id))
        .map(|(task_id, count)| TaskBlocked { task_id, count })
        .collect();

    Ok(TaskPage {
        rows: rows_with_tags(rows, &links),
        children: rows_with_tags(children, &links),
        related,
        blocked,
        has_more: false,
        cursor: None,
    })
}

/// `task:listByProject` — one project's tasks as a scope page. Not paged: the
/// project's toolbar filters and sort apply to the whole project, exactly as
/// they did when the page filtered the global snapshot itself.
pub fn list_tasks_by_project(conn: &Connection, project_id: Uuid) -> Result<TaskPage, AppError> {
    task_page(conn, tasks::list_by_project(conn, project_id)?)
}

/// Creates a task (plus tag links and initial subtasks) in one transaction;
/// the task is appended after the last task sharing its board-column scope
/// (inbox tasks share the `column_id = NULL` scope).
pub fn create_task(conn: &Connection, input: NewTask) -> Result<Task, AppError> {
    if let Some(rule) = &input.repeat_rule {
        validate_repeat_rule(rule)?;
    }
    let tx = conn.unchecked_transaction()?;
    let task = create_task_in_tx(&tx, input)?;
    tx.commit()?;
    Ok(task)
}

/// [`create_task`]'s body against an open transaction, so completion paths
/// can spawn repeat instances atomically with their own write.
fn create_task_in_tx(conn: &Connection, input: NewTask) -> Result<Task, AppError> {
    let title = validated_name(&input.title)?;
    let tag_ids = dedup(input.tag_ids);
    let now = Utc::now();
    let complexity = validated_complexity(input.complexity)?;

    let parent = match input.parent_task_id {
        Some(parent_id) => Some(validate_parent(conn, parent_id)?),
        None => None,
    };
    // A child lives inside its parent: same project, never on a board.
    let project_id = parent
        .as_ref()
        .map(|task| task.project_id)
        .unwrap_or(input.project_id);
    let column_id = if parent.is_some() {
        None
    } else {
        validate_column(conn, input.column_id, project_id)?
    };

    // `sort_order` keys are per sibling scope, not one global sequence: a child
    // and a column-less top-level task both start at `first()`. The scope is
    // `(column_id, parent_task_id)` together, and the top-level half needs
    // `parent_task_id IS NULL` because a child's `column_id` is NULL — without
    // it, a new column-less task would append into the children's key range.
    let scope = tasks::SortScope {
        column_id,
        parent_id: input.parent_task_id,
    };
    let (sort_order, rebalanced) = append_task_key(conn, scope)?;

    validate_tag_ids(conn, &tag_ids)?;
    for (id, key) in &rebalanced {
        if !tasks::set_sort_order(conn, *id, key, now)? {
            return Err(not_found("任务", *id));
        }
    }

    let task = Task {
        id: Uuid::new_v4(),
        project_id,
        title,
        note: input.note,
        priority: input.priority.unwrap_or(Priority::None),
        column_id,
        due_at: input.due_at,
        completed_at: None,
        repeat_rule: input.repeat_rule,
        complexity,
        parent_task_id: input.parent_task_id,
        sort_order,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    tasks::insert(conn, &task)?;
    task_tags::set_task_tags(conn, task.id, &tag_ids)?;

    // `subtaskTitles` still means "also create these subtasks": each becomes a
    // child task under the one being created. They get a plain first()/after()
    // chain — an editor never creates enough of them to hit the length
    // threshold, and later appends through the task path rebalance anyway.
    let mut last_key: Option<String> = None;
    for raw_title in &input.subtask_titles {
        let key = match &last_key {
            None => sort::first(),
            Some(last) => sort::after(last)?,
        };
        tasks::insert(
            conn,
            &Task {
                id: Uuid::new_v4(),
                project_id,
                title: validated_name(raw_title)?,
                note: None,
                priority: Priority::None,
                column_id: None,
                due_at: None,
                completed_at: None,
                repeat_rule: None,
                complexity: None,
                parent_task_id: Some(task.id),
                sort_order: key.clone(),
                created_at: now,
                updated_at: now,
                deleted_at: None,
            },
        )?;
        last_key = Some(key);
    }

    Ok(task)
}

/// Applies a partial patch: a missing field stays unchanged, `Patch::Set(v)`
/// replaces the column (with `Patch::Set(None)` clearing it). Replaces the
/// tag set when `tag_ids` is present.
pub fn update_task(conn: &Connection, id: Uuid, patch: UpdateTask) -> Result<Task, AppError> {
    let mut task = tasks::get(conn, id)?.ok_or_else(|| not_found("任务", id))?;
    if let Some(title) = &patch.title {
        task.title = validated_name(title)?;
    }
    if let Patch::Set(note) = patch.note {
        task.note = note;
    }
    if let Some(priority) = patch.priority {
        task.priority = priority;
    }
    if let Patch::Set(due_at) = patch.due_at {
        task.due_at = due_at;
    }
    if let Patch::Set(complexity) = patch.complexity {
        task.complexity = validated_complexity(complexity)?;
    }
    if let Patch::Set(completed_at) = patch.completed_at {
        task.completed_at = completed_at;
    }
    if let Patch::Set(repeat_rule) = patch.repeat_rule {
        if let Some(rule) = &repeat_rule {
            validate_repeat_rule(rule)?;
        }
        task.repeat_rule = repeat_rule;
    }
    let previous_parent = task.parent_task_id;
    if let Patch::Set(parent_task_id) = patch.parent_task_id {
        match parent_task_id {
            Some(parent_id) => {
                if parent_id == id {
                    return Err(AppError::Validation("任务不能以自己为父任务".into()));
                }
                let parent = validate_parent(conn, parent_id)?;
                // Deleted children count: restoring this task brings every child
                // of it back (`set_children_deleted` flips them all), so a
                // parent taken under another task would return three levels
                // deep the moment the first child is restored.
                if tasks::has_children(conn, id)? {
                    return Err(AppError::Validation(
                        "该任务还有子任务（含回收站中的），不能变成别人的子任务".into(),
                    ));
                }
                task.parent_task_id = Some(parent_id);
                task.project_id = parent.project_id;
                task.column_id = None;
            }
            None => task.parent_task_id = None,
        }
    }
    // The parent's project is the authority: a task that ends up with a parent
    // lives in that parent's project, so an explicit `projectId` in the same
    // patch is ignored rather than written and immediately contradicted — the
    // same rule `create_task` applies, where the parent wins over
    // `input.project_id` too.
    let moves_children = task.parent_task_id.is_none() && matches!(patch.project_id, Patch::Set(_));
    if let Patch::Set(project_id) = patch.project_id {
        if task.parent_task_id.is_none() {
            task.project_id = project_id;
        }
    }
    // Columns are handled after the parent, because the parent decides whether
    // this row may have one at all. `move_task` refuses a child on a board from
    // the drag gesture; this is the other door into the same field (QA-12) — a
    // child that acquires a column leaves its own sort scope, and a column from
    // another project puts the row on a board that never lists it.
    if let Patch::Set(column_id) = patch.column_id {
        if column_id.is_some() && task.parent_task_id.is_some() {
            return Err(AppError::Validation(
                "子任务不能移到看板列：它随父任务归档，不上看板".into(),
            ));
        }
        if let Some(column_id) = column_id {
            let column = board_columns::get(conn, column_id)?
                .ok_or_else(|| not_found("看板列", column_id))?;
            if Some(column.project_id) != task.project_id {
                return Err(AppError::Validation("看板列不属于该任务的项目".into()));
            }
        }
        task.column_id = column_id;
    }
    // A task that moved into another sibling scope leaves its old key behind,
    // where it means nothing: sort keys are per-scope (see `create_task_in_tx`),
    // so the old key would slot the row arbitrarily among its new siblings — or
    // tie with one of them. Re-key it by appending after the last sibling of the
    // list it joined, exactly like a fresh create.
    let reparented = task.parent_task_id != previous_parent;

    task.updated_at = Utc::now();
    let now = task.updated_at;

    let tx = conn.unchecked_transaction()?;
    // A parent's project change takes its children with it, or they would be
    // filed in the old project while pointing at a parent in the new one. It
    // runs inside the parent's own transaction: a patch rejected further down
    // (a stale tag id, say) must not leave the children moved and the parent
    // behind.
    if moves_children {
        tasks::set_children_project(&tx, id, task.project_id, now)?;
    }
    if reparented {
        // The row joins its new scope in this same transaction, so it is not in
        // that scope's key sequence yet — appending after the last key of the
        // scope is enough, and the scope itself is only read on a rebalance.
        let scope = tasks::SortScope {
            column_id: task.column_id,
            parent_id: task.parent_task_id,
        };
        let (sort_order, rebalanced) = append_task_key(&tx, scope)?;
        for (sibling_id, key) in &rebalanced {
            if !tasks::set_sort_order(&tx, *sibling_id, key, now)? {
                return Err(not_found("任务", *sibling_id));
            }
        }
        task.sort_order = sort_order;
    }
    if !tasks::update(&tx, &task)? {
        return Err(not_found("任务", id));
    }
    if let Some(tag_ids) = patch.tag_ids {
        let tag_ids = dedup(tag_ids);
        validate_tag_ids(&tx, &tag_ids)?;
        task_tags::set_task_tags(&tx, id, &tag_ids)?;
    }
    tx.commit()?;
    Ok(task)
}

/// Marks a task completed by stamping `completed_at`; completing twice keeps
/// the original timestamp. A repeating task spawns its next instance in the
/// same transaction (unless its rule is paused or has no due date).
pub fn complete_task(conn: &Connection, id: Uuid) -> Result<Task, AppError> {
    let mut task = tasks::get(conn, id)?.ok_or_else(|| not_found("任务", id))?;
    if task.completed_at.is_some() {
        return Ok(task);
    }

    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    task.completed_at = Some(now);
    task.updated_at = now;
    if !tasks::update(&tx, &task)? {
        return Err(not_found("任务", id));
    }
    spawn_next_instance(&tx, &task, task.column_id, now)?;
    tx.commit()?;
    Ok(task)
}

pub fn soft_delete_task(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    if !tasks::soft_delete(&tx, id, now)? {
        return Err(not_found("任务", id));
    }
    // Children exist only through their parent (§9.2): leaving them live would
    // produce orphan rows, and restoring the parent could not bring them back.
    tasks::set_children_deleted(&tx, id, now, true)?;
    tx.commit()?;
    Ok(())
}

pub fn restore_task(conn: &Connection, id: Uuid) -> Result<Task, AppError> {
    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    if !tasks::restore(&tx, id, now)? {
        return Err(not_found("任务", id));
    }
    let task = tasks::get(&tx, id)?.ok_or_else(|| not_found("任务", id))?;
    // A live child under a soft-deleted parent is an orphan: it shows up in
    // `task:list` and fires reminders while its parent stays hidden. The parent
    // comes back first; returning here rolls the restore back.
    if let Some(parent_id) = task.parent_task_id {
        if tasks::get(&tx, parent_id)?.is_none() {
            return Err(AppError::Validation(
                "父任务还在回收站，先恢复父任务再恢复子任务".into(),
            ));
        }
    }
    tasks::set_children_deleted(&tx, id, now, false)?;
    tx.commit()?;
    Ok(task)
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>, AppError> {
    tags::list(conn)
}

pub fn create_tag(conn: &Connection, input: NewTag) -> Result<Tag, AppError> {
    let name = validated_name(&input.name)?;
    if tags::find_by_name(conn, &name)?.is_some() {
        return Err(AppError::Validation(format!("标签「{name}」已存在")));
    }
    let now = Utc::now();
    let tag = Tag {
        id: Uuid::new_v4(),
        name,
        color: input.color,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    tags::insert(conn, &tag)?;
    Ok(tag)
}

pub fn update_tag(conn: &Connection, id: Uuid, patch: UpdateTag) -> Result<Tag, AppError> {
    let mut tag = tags::get(conn, id)?.ok_or_else(|| not_found("标签", id))?;
    if let Some(name) = &patch.name {
        tag.name = validated_name(name)?;
        if let Some(other) = tags::find_by_name(conn, &tag.name)? {
            if other.id != tag.id {
                return Err(AppError::Validation(format!("标签「{}」已存在", tag.name)));
            }
        }
    }
    if let Patch::Set(color) = patch.color {
        tag.color = color;
    }
    tag.updated_at = Utc::now();
    if !tags::update(conn, &tag)? {
        return Err(not_found("标签", id));
    }
    Ok(tag)
}

pub fn delete_tag(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    if !tags::soft_delete(conn, id, Utc::now())? {
        return Err(not_found("标签", id));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Task hierarchy
// ---------------------------------------------------------------------------

/// The one-level rule: `parent_id` must be a live task that is itself a
/// top-level task. Returns the parent row so callers can inherit its project.
fn validate_parent(conn: &Connection, parent_id: Uuid) -> Result<Task, AppError> {
    let parent = tasks::get(conn, parent_id)?.ok_or_else(|| not_found("父任务", parent_id))?;
    if parent.parent_task_id.is_some() {
        return Err(AppError::Validation(
            "子任务下不能再挂子任务：层级只有一层".into(),
        ));
    }
    Ok(parent)
}

/// A board column a task may be filed into: it has to exist, and it has to
/// belong to the task's own project — a column from another project would put
/// the row on a board that never lists it (QA-12).
fn validate_column(
    conn: &Connection,
    column_id: Option<Uuid>,
    project_id: Option<Uuid>,
) -> Result<Option<Uuid>, AppError> {
    let Some(column_id) = column_id else {
        return Ok(None);
    };
    let column =
        board_columns::get(conn, column_id)?.ok_or_else(|| not_found("看板列", column_id))?;
    if Some(column.project_id) != project_id {
        return Err(AppError::Validation("看板列不属于该任务的项目".into()));
    }
    Ok(Some(column_id))
}

/// Moves a task between its siblings: `prev`/`next` are the sort keys of the
/// rows surrounding the target slot (either may be omitted at the list ends).
/// Returns the moved row plus every key the move rewrote — a key-exhaustion
/// rebalance rewrites the whole scope, and the caller has to see those keys.
///
/// The sibling scope follows the hierarchy: a child moves among its parent's
/// other children, a top-level task among the tasks of its own column.
pub fn reorder_task(
    conn: &Connection,
    id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Reorder, AppError> {
    let moved = tasks::get(conn, id)?.ok_or_else(|| not_found("任务", id))?;
    let scope = match moved.parent_task_id {
        Some(parent_id) => tasks::SortScope {
            column_id: None,
            parent_id: Some(parent_id),
        },
        None => tasks::SortScope {
            column_id: moved.column_id,
            parent_id: None,
        },
    };

    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    let (prev_key, next_key) = resolve_neighbours(&tx, scope, id, prev, next)?;
    let rebalanced = match key_between(prev_key.as_deref(), next_key.as_deref())? {
        Some(key) => {
            if !tasks::set_sort_order(&tx, id, &key, now)? {
                return Err(not_found("任务", id));
            }
            Vec::new()
        }
        None => rebalance_scope(
            &tx,
            scope,
            id,
            &moved.sort_order,
            prev_key.as_deref(),
            next_key.as_deref(),
            now,
        )?,
    };
    tx.commit()?;

    let moved = tasks::get(conn, id)?.ok_or_else(|| not_found("任务", id))?;
    Ok(Reorder {
        moved: task_with_tags(conn, moved)?,
        rebalanced,
    })
}

// ---------------------------------------------------------------------------
// Dependency edges
// ---------------------------------------------------------------------------

/// Every live dependency edge; the frontend derives blocked state from these.
pub fn list_dependencies(conn: &Connection) -> Result<Vec<Dependency>, AppError> {
    dependencies::list_live(conn)
}

/// Adds `dependent → prerequisite` after validating it. Idempotent: adding an
/// edge that already exists returns it unchanged.
pub fn add_dependency(conn: &Connection, input: Dependency) -> Result<Dependency, AppError> {
    validate_dependency(conn, input.dependent_id, input.prerequisite_id)?;
    dependencies::insert(conn, input.dependent_id, input.prerequisite_id, Utc::now())?;
    Ok(input)
}

pub fn remove_dependency(conn: &Connection, input: Dependency) -> Result<(), AppError> {
    dependencies::remove(conn, input.dependent_id, input.prerequisite_id)
}

/// The rules an edge must satisfy: both endpoints live tasks, no
/// self-reference, and no cycles. Both endpoints must also share a parent
/// task — `NULL` counts as a value, so two top-level tasks share it. The
/// frontend also filters cyclic candidates out of its picker, but that is a
/// convenience — this check is the authority.
fn validate_dependency(
    conn: &Connection,
    dependent_id: Uuid,
    prerequisite_id: Uuid,
) -> Result<(), AppError> {
    if dependent_id == prerequisite_id {
        return Err(AppError::Validation("不能依赖自身".into()));
    }
    let dependent =
        tasks::get(conn, dependent_id)?.ok_or_else(|| not_found("任务", dependent_id))?;
    let prerequisite =
        tasks::get(conn, prerequisite_id)?.ok_or_else(|| not_found("任务", prerequisite_id))?;
    if dependent.parent_task_id != prerequisite.parent_task_id {
        return Err(AppError::Validation(
            "依赖需在同一个父任务下（顶层任务之间也算同一层）".into(),
        ));
    }
    if dependencies::creates_cycle(conn, dependent_id, prerequisite_id)? {
        return Err(AppError::Validation("会形成循环依赖".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Projects & board
// ---------------------------------------------------------------------------

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, AppError> {
    projects::list(conn)
}

/// `project:unfinishedCounts` — every live project's unfinished top-level task
/// count, for the sidebar's disclosure arrow.
pub fn project_unfinished_counts(conn: &Connection) -> Result<Vec<ProjectUnfinished>, AppError> {
    projects::unfinished_counts(conn)
}

/// Creates a project plus its default kanban columns (待办/进行中/已完成,
/// the last one flagged `is_done`) in one transaction, appending after the
/// last existing project.
pub fn create_project(conn: &Connection, input: NewProject) -> Result<Project, AppError> {
    let name = validated_name(&input.name)?;
    validate_namespace_ref(conn, input.namespace_id)?;
    let now = Utc::now();
    let siblings: Vec<(Uuid, String)> = projects::list(conn)?
        .into_iter()
        .map(|p| (p.id, p.sort_order))
        .collect();
    let (sort_order, rebalanced) = append_key(&siblings)?;

    let tx = conn.unchecked_transaction()?;
    for (id, key) in &rebalanced {
        if !projects::set_sort_order(&tx, *id, key, now)? {
            return Err(not_found("项目", *id));
        }
    }

    let project = Project {
        id: Uuid::new_v4(),
        name,
        description: input.description,
        color: input.color,
        icon: input.icon,
        namespace_id: input.namespace_id,
        status: ProjectStatus::Active,
        sort_order,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    projects::insert(&tx, &project)?;

    // Three columns is never enough to exhaust the key space; build the
    // position chain with plain first()/after() calls.
    let mut position = sort::first();
    for (column_name, is_done) in [("待办", false), ("进行中", false), ("已完成", true)] {
        board_columns::insert(
            &tx,
            &BoardColumn {
                id: Uuid::new_v4(),
                project_id: project.id,
                name: column_name.into(),
                position: position.clone(),
                is_done,
                created_at: now,
                updated_at: now,
                deleted_at: None,
            },
        )?;
        position = sort::after(&position)?;
    }

    tx.commit()?;
    Ok(project)
}

/// Applies a partial patch (missing = unchanged, `Patch::Set` = replace).
pub fn update_project(
    conn: &Connection,
    id: Uuid,
    patch: UpdateProject,
) -> Result<Project, AppError> {
    let mut project = projects::get(conn, id)?.ok_or_else(|| not_found("项目", id))?;
    if let Some(name) = &patch.name {
        project.name = validated_name(name)?;
    }
    if let Patch::Set(description) = patch.description {
        project.description = description;
    }
    if let Patch::Set(color) = patch.color {
        project.color = color;
    }
    if let Patch::Set(icon) = patch.icon {
        project.icon = icon;
    }
    if let Patch::Set(namespace_id) = patch.namespace_id {
        validate_namespace_ref(conn, namespace_id)?;
        project.namespace_id = namespace_id;
    }
    project.updated_at = Utc::now();
    if !projects::update(conn, &project)? {
        return Err(not_found("项目", id));
    }
    Ok(project)
}

/// Archives (or restores) a project; repeating the current state is a no-op
/// returning the unchanged row.
pub fn set_project_status(
    conn: &Connection,
    id: Uuid,
    status: ProjectStatus,
) -> Result<Project, AppError> {
    let project = projects::get(conn, id)?.ok_or_else(|| not_found("项目", id))?;
    if project.status != status && !projects::set_status(conn, id, status, Utc::now())? {
        return Err(not_found("项目", id));
    }
    projects::get(conn, id)?.ok_or_else(|| not_found("项目", id))
}

pub fn archive_project(conn: &Connection, id: Uuid) -> Result<Project, AppError> {
    set_project_status(conn, id, ProjectStatus::Archived)
}

pub fn restore_project(conn: &Connection, id: Uuid) -> Result<Project, AppError> {
    set_project_status(conn, id, ProjectStatus::Active)
}

/// `project:delete` — soft-deletes the project together with every live task
/// filed under it and its board columns, in one transaction. Tasks follow for
/// the same reason a parent's children do on a task delete: rows pointing at
/// a deleted container would surface in views and fire reminders with no
/// project left to hold them. All soft (`deleted_at`), so a backup still
/// carries everything.
pub fn delete_project(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    if !projects::soft_delete(&tx, id, now)? {
        return Err(not_found("项目", id));
    }
    tasks::soft_delete_by_project(&tx, id, now)?;
    board_columns::soft_delete_by_project(&tx, id, now)?;
    tx.commit()?;
    Ok(())
}

pub fn list_board_columns(
    conn: &Connection,
    project_id: Uuid,
) -> Result<Vec<BoardColumn>, AppError> {
    board_columns::list_by_project(conn, project_id)
}

/// `board:moveTask` — moves a task into a column at a slot within one
/// transaction: `column_id` (and `project_id`, taken from the column, so a
/// task dropped on another project's board moves with it) is rewritten, the
/// sort key is derived from the target neighbours, and `completed_at` syncs
/// with the column's `is_done` flag — entering a done column stamps it,
/// leaving one clears it, moving within keeps it as-is.
pub fn move_task(
    conn: &Connection,
    task_id: Uuid,
    column_id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Reorder, AppError> {
    let mut moved = tasks::get(conn, task_id)?.ok_or_else(|| not_found("任务", task_id))?;
    // A child follows its parent's project and is archived with it; it never
    // lands on a board of its own (§9.4).
    if moved.parent_task_id.is_some() {
        return Err(AppError::Validation(
            "子任务不能移到看板列：它随父任务归档，不上看板".into(),
        ));
    }
    let column =
        board_columns::get(conn, column_id)?.ok_or_else(|| not_found("看板列", column_id))?;

    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    // The target column's key sequence. `exclude` drops the moved row: a drag
    // inside one board would otherwise find itself among its own neighbours.
    let scope = tasks::SortScope {
        column_id: Some(column_id),
        parent_id: None,
    };

    let previous_column = moved.column_id;
    // A card dropped on another project's board takes its children with it, so
    // none of them is left pointing at a parent in another project. Same
    // transaction as the parent's own write; a drag inside one board leaves the
    // children untouched.
    if moved.project_id != Some(column.project_id) {
        tasks::set_children_project(&tx, task_id, Some(column.project_id), now)?;
    }
    moved.project_id = Some(column.project_id);
    moved.column_id = Some(column_id);
    let mut entered_done = false;
    match (column.is_done, moved.completed_at.is_some()) {
        (true, false) => {
            moved.completed_at = Some(now);
            entered_done = true;
        }
        (false, true) => moved.completed_at = None,
        _ => {}
    }
    moved.updated_at = now;

    // A drop into an *empty* lane names no neighbour at all — the normal state of
    // a fresh project's 已完成 lane — so it appends after the lane's last key
    // instead of being rejected. `resolve_neighbours` keeps refusing the same
    // input on the reorder path, where a move without a target is a bug.
    let (prev_key, next_key) = if prev.is_none() && next.is_none() {
        (tasks::last_sort_key(&tx, scope)?, None)
    } else {
        resolve_neighbours(&tx, scope, task_id, prev, next)?
    };
    let rebalanced = match key_between(prev_key.as_deref(), next_key.as_deref())? {
        Some(key) => {
            moved.sort_order = key;
            if !tasks::update(&tx, &moved)? {
                return Err(not_found("任务", task_id));
            }
            Vec::new()
        }
        None => {
            // The row itself is written first (its column, project and
            // completion state are this call's business), then the whole scope
            // is re-spread — the moved row included, through `set_sort_order`,
            // since its other fields are already persisted.
            if !tasks::update(&tx, &moved)? {
                return Err(not_found("任务", task_id));
            }
            rebalance_scope(
                &tx,
                scope,
                task_id,
                &moved.sort_order,
                prev_key.as_deref(),
                next_key.as_deref(),
                now,
            )?
        }
    };
    if let Some(row) = rebalanced.iter().find(|row| row.id == task_id) {
        moved.sort_order = row.sort_order.clone();
    }

    // Entering the done column completes the task: a repeating task spawns
    // its next instance back into the column it came from.
    if entered_done {
        spawn_next_instance(&tx, &moved, previous_column, now)?;
    }

    tx.commit()?;
    Ok(Reorder {
        moved: task_with_tags(conn, moved)?,
        rebalanced,
    })
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

pub fn list_namespaces(conn: &Connection) -> Result<Vec<Namespace>, AppError> {
    namespaces::list(conn)
}

/// Creates a namespace, appending it after the last existing one. Mirrors
/// `create_project` minus the default board columns: a namespace holds
/// projects, not tasks.
pub fn create_namespace(conn: &Connection, input: NewNamespace) -> Result<Namespace, AppError> {
    let name = validated_name(&input.name)?;
    let now = Utc::now();
    let siblings: Vec<(Uuid, String)> = namespaces::list(conn)?
        .into_iter()
        .map(|namespace| (namespace.id, namespace.sort_order))
        .collect();
    let (sort_order, rebalanced) = append_key(&siblings)?;

    let tx = conn.unchecked_transaction()?;
    for (id, key) in &rebalanced {
        if !namespaces::set_sort_order(&tx, *id, key, now)? {
            return Err(not_found("命名空间", *id));
        }
    }

    let namespace = Namespace {
        id: Uuid::new_v4(),
        name,
        description: input.description,
        color: input.color,
        icon: input.icon,
        status: ProjectStatus::Active,
        sort_order,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    namespaces::insert(&tx, &namespace)?;
    tx.commit()?;
    Ok(namespace)
}

/// Applies a partial patch (missing = unchanged, `Patch::Set` = replace).
pub fn update_namespace(
    conn: &Connection,
    id: Uuid,
    patch: UpdateNamespace,
) -> Result<Namespace, AppError> {
    let mut namespace = namespaces::get(conn, id)?.ok_or_else(|| not_found("命名空间", id))?;
    if let Some(name) = &patch.name {
        namespace.name = validated_name(name)?;
    }
    if let Patch::Set(description) = patch.description {
        namespace.description = description;
    }
    if let Patch::Set(color) = patch.color {
        namespace.color = color;
    }
    if let Patch::Set(icon) = patch.icon {
        namespace.icon = icon;
    }
    namespace.updated_at = Utc::now();
    if !namespaces::update(conn, &namespace)? {
        return Err(not_found("命名空间", id));
    }
    Ok(namespace)
}

/// Archives (or restores) a namespace; repeating the current state is a no-op
/// returning the unchanged row.
///
/// Projects inside are deliberately untouched: archiving a group must not
/// silently flip the state of everything filed under it.
pub fn set_namespace_status(
    conn: &Connection,
    id: Uuid,
    status: ProjectStatus,
) -> Result<Namespace, AppError> {
    let namespace = namespaces::get(conn, id)?.ok_or_else(|| not_found("命名空间", id))?;
    if namespace.status != status && !namespaces::set_status(conn, id, status, Utc::now())? {
        return Err(not_found("命名空间", id));
    }
    namespaces::get(conn, id)?.ok_or_else(|| not_found("命名空间", id))
}

pub fn archive_namespace(conn: &Connection, id: Uuid) -> Result<Namespace, AppError> {
    set_namespace_status(conn, id, ProjectStatus::Archived)
}

pub fn restore_namespace(conn: &Connection, id: Uuid) -> Result<Namespace, AppError> {
    set_namespace_status(conn, id, ProjectStatus::Active)
}

/// `namespace:delete` — soft-deletes the namespace row only. Its projects keep
/// their `namespace_id` and fall back to the root list (the navigation files by
/// the live-namespace set); deleting a group must not delete what it groups.
pub fn delete_namespace(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    if !namespaces::soft_delete(conn, id, Utc::now())? {
        return Err(not_found("命名空间", id));
    }
    Ok(())
}

/// Rejects a `namespaceId` that does not resolve to a live namespace. `None`
/// (the root list) is always fine; clearing is never blocked.
fn validate_namespace_ref(conn: &Connection, id: Option<Uuid>) -> Result<(), AppError> {
    match id {
        Some(id) if namespaces::get(conn, id)?.is_none() => Err(not_found("命名空间", id)),
        _ => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

pub fn list_comments(conn: &Connection, task_id: Uuid) -> Result<Vec<Comment>, AppError> {
    comments::list_by_task(conn, task_id)
}

pub fn create_comment(
    conn: &Connection,
    task_id: Uuid,
    input: NewComment,
) -> Result<Comment, AppError> {
    if tasks::get(conn, task_id)?.is_none() {
        return Err(not_found("任务", task_id));
    }
    let now = Utc::now();
    let comment = Comment {
        id: Uuid::new_v4(),
        task_id,
        body: validated_text("评论内容", &input.body)?,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    comments::insert(conn, &comment)?;
    Ok(comment)
}

pub fn update_comment(
    conn: &Connection,
    id: Uuid,
    patch: UpdateComment,
) -> Result<Comment, AppError> {
    let mut comment = comments::get(conn, id)?.ok_or_else(|| not_found("评论", id))?;
    comment.body = validated_text("评论内容", &patch.body)?;
    comment.updated_at = Utc::now();
    if !comments::update(conn, &comment)? {
        return Err(not_found("评论", id));
    }
    Ok(comment)
}

pub fn delete_comment(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    if !comments::soft_delete(conn, id, Utc::now())? {
        return Err(not_found("评论", id));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// time:*
// ---------------------------------------------------------------------------

/// Records a manual time entry. The end instant is derived from start plus
/// duration, so the two can never disagree.
pub fn create_time_entry(
    conn: &Connection,
    task_id: Uuid,
    input: NewTimeEntry,
) -> Result<TimeEntry, AppError> {
    if tasks::get(conn, task_id)?.is_none() {
        return Err(not_found("任务", task_id));
    }
    let ended_at = entry_end(input.started_at, input.duration)?;
    let now = Utc::now();
    let entry = TimeEntry {
        id: Uuid::new_v4(),
        task_id,
        started_at: Some(input.started_at),
        ended_at: Some(ended_at),
        duration: input.duration,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    time_entries::insert(conn, &entry)?;
    Ok(entry)
}

/// Edits a manual entry; `ended_at` is re-derived, so an update always lands
/// on a stopped entry (a running timer is stopped via `stop_time_entry`).
pub fn update_time_entry(
    conn: &Connection,
    id: Uuid,
    patch: UpdateTimeEntry,
) -> Result<TimeEntry, AppError> {
    let mut entry = time_entries::get(conn, id)?.ok_or_else(|| not_found("时间记录", id))?;
    let started_at = patch
        .started_at
        .or(entry.started_at)
        .ok_or_else(|| AppError::Validation("时间记录缺少开始时间".into()))?;
    let duration = patch.duration.unwrap_or(entry.duration);
    entry.started_at = Some(started_at);
    entry.ended_at = Some(entry_end(started_at, duration)?);
    entry.duration = duration;
    entry.updated_at = Utc::now();
    if !time_entries::update(conn, &entry)? {
        return Err(not_found("时间记录", id));
    }
    Ok(entry)
}

pub fn delete_time_entry(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    if !time_entries::soft_delete(conn, id, Utc::now())? {
        return Err(not_found("时间记录", id));
    }
    Ok(())
}

/// Starts the task's timer. Idempotent: a task already being timed returns
/// its running entry instead of stacking a second one.
pub fn start_time_entry(conn: &Connection, task_id: Uuid) -> Result<TimeEntry, AppError> {
    if tasks::get(conn, task_id)?.is_none() {
        return Err(not_found("任务", task_id));
    }
    if let Some(running) = time_entries::get_running(conn, task_id)? {
        return Ok(running);
    }
    let now = Utc::now();
    let entry = TimeEntry {
        id: Uuid::new_v4(),
        task_id,
        started_at: Some(now),
        ended_at: None,
        duration: 0,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    time_entries::insert(conn, &entry)?;
    Ok(entry)
}

/// Stops a running timer, freezing the seconds elapsed since it started.
pub fn stop_time_entry(conn: &Connection, id: Uuid) -> Result<TimeEntry, AppError> {
    let mut entry = time_entries::get(conn, id)?.ok_or_else(|| not_found("时间记录", id))?;
    let started_at = entry
        .started_at
        .ok_or_else(|| AppError::Validation("时间记录缺少开始时间".into()))?;
    if entry.ended_at.is_some() {
        return Err(AppError::Validation("该计时已停止".into()));
    }
    let now = Utc::now();
    entry.ended_at = Some(now);
    entry.duration = (now - started_at).num_seconds().max(0);
    entry.updated_at = now;
    if !time_entries::update(conn, &entry)? {
        return Err(not_found("时间记录", id));
    }
    Ok(entry)
}

/// Validates a tracked length and returns the instant it ends at.
fn entry_end(started_at: DateTime<Utc>, duration: i64) -> Result<DateTime<Utc>, AppError> {
    if duration < 1 {
        return Err(AppError::Validation("时长需大于 0 秒".into()));
    }
    started_at
        .checked_add_signed(chrono::Duration::seconds(duration))
        .ok_or_else(|| AppError::Validation("时长超出可表示范围".into()))
}

pub fn list_time_entries(conn: &Connection, task_id: Uuid) -> Result<Vec<TimeEntry>, AppError> {
    time_entries::list_by_task(conn, task_id)
}

/// Every entry whose timer is still running. The task list asks this once at
/// start-up so a row can paint 开始/暂停 without one `time:list` per row.
pub fn list_running_time_entries(conn: &Connection) -> Result<Vec<TimeEntry>, AppError> {
    time_entries::list_running(conn)
}

// ---------------------------------------------------------------------------
// stats:*
// ---------------------------------------------------------------------------

/// Completion curve over `[from, to)`, one point per local day/week/month.
pub fn completion_trend(conn: &Connection, query: TrendQuery) -> Result<Vec<TrendPoint>, AppError> {
    stats::completion_trend(conn, &query)
}

/// Task and completion tally per live project (archived ones excluded).
pub fn project_progress(conn: &Connection) -> Result<Vec<ProjectProgress>, AppError> {
    stats::project_progress(conn)
}

/// Tracked time over `[from, to)` split by project or tag, plus the same time
/// in period buckets.
pub fn time_distribution(
    conn: &Connection,
    query: TimeDistributionQuery,
) -> Result<TimeDistribution, AppError> {
    Ok(TimeDistribution {
        groups: stats::time_shares(conn, &query)?,
        buckets: stats::time_buckets(conn, &query)?,
    })
}

// ---------------------------------------------------------------------------
// backup:*
// ---------------------------------------------------------------------------

/// Format marker written into every backup document.
pub const BACKUP_FORMAT: &str = "ordo.backup";
/// Generation of the backup format. Bumped to 4 when subtasks became child
/// tasks (R7c): an older build reading a v4 file would not know what
/// `parentTaskId` means and would show every child at the top level, so
/// `import_backup` refuses anything newer than this value.
pub const BACKUP_VERSION: u32 = 4;

/// Writes every table to `path` as one JSON backup document.
pub fn export_backup(conn: &Connection, path: &Path) -> Result<BackupSummary, AppError> {
    let data = backup::export_all(conn)?;
    let document = BackupDocument {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        exported_at: Utc::now(),
        data,
    };
    let json = serde_json::to_string_pretty(&document)
        .map_err(|error| AppError::Db(format!("序列化备份失败：{error}")))?;

    // A save dialog may point into a folder that does not exist yet.
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, json)?;

    Ok(BackupSummary {
        path: path.to_string_lossy().into_owned(),
        exported_at: document.exported_at,
        counts: document.data.counts(),
    })
}

/// Replaces the whole database with the backup at `path`, in one transaction:
/// a foreign, newer or malformed document changes nothing.
pub fn import_backup(conn: &Connection, path: &Path) -> Result<BackupSummary, AppError> {
    let text = std::fs::read_to_string(path)?;
    let document: BackupDocument = serde_json::from_str(&text)
        .map_err(|error| AppError::Validation(format!("备份文件无法解析：{error}")))?;

    if document.format != BACKUP_FORMAT {
        return Err(AppError::Validation(format!(
            "不是 Ordo 备份文件（format = {:?}）",
            document.format
        )));
    }
    if document.version > BACKUP_VERSION {
        return Err(AppError::Validation(format!(
            "备份文件版本 {} 高于当前支持的 {BACKUP_VERSION}",
            document.version
        )));
    }

    let tx = conn.unchecked_transaction()?;
    backup::replace_all(&tx, &document.data)?;
    tx.commit()?;

    Ok(BackupSummary {
        path: path.to_string_lossy().into_owned(),
        exported_at: document.exported_at,
        counts: document.data.counts(),
    })
}

// ---------------------------------------------------------------------------
// search:*
// ---------------------------------------------------------------------------

/// Hits returned per kind; the search view only needs the best matches, and
/// unbounded result sets would slow the IPC hop.
const SEARCH_MAX_HITS: i64 = 50;

/// Trigram tokens need three characters, so shorter terms cannot hit the FTS
/// index and the query falls back to a LIKE scan.
const MIN_FTS_TERM_CHARS: usize = 3;

/// Context characters kept on each side of a LIKE-path snippet highlight.
const SNIPPET_RADIUS_CHARS: usize = 24;

/// `search:query` — full-text search across task titles/notes and comment
/// bodies. Blank queries return no hits so the view can fire on every
/// keystroke. Queries whose terms all have at least [`MIN_FTS_TERM_CHARS`]
/// characters go through FTS5 ranked by bm25; anything shorter falls back to
/// a LIKE scan ordered by recency. Task hits precede comment hits (the two
/// tables' bm25 scores are not comparable).
pub fn search(conn: &Connection, query: &str) -> Result<Vec<SearchHit>, AppError> {
    let terms: Vec<String> = query.split_whitespace().map(str::to_string).collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    if terms
        .iter()
        .all(|t| t.chars().count() >= MIN_FTS_TERM_CHARS)
    {
        let match_expr = fts_match_expression(&terms);
        let task_hits = search::fts_tasks(conn, &match_expr, SEARCH_MAX_HITS)?
            .into_iter()
            .map(|row| SearchHit {
                kind: SearchHitKind::Task,
                id: row.id,
                task_id: row.id,
                task_title: row.title,
                snippet: row.snippet,
            });
        let comment_hits = search::fts_comments(conn, &match_expr, SEARCH_MAX_HITS)?
            .into_iter()
            .map(|row| SearchHit {
                kind: SearchHitKind::Comment,
                id: row.id,
                task_id: row.task_id,
                task_title: row.task_title,
                snippet: row.snippet,
            });
        return Ok(task_hits.chain(comment_hits).collect());
    }

    let task_hits = search::like_tasks(conn, &terms, SEARCH_MAX_HITS)?
        .into_iter()
        .map(|row| {
            let note = row.note.as_deref().unwrap_or("");
            let snippet = like_snippet(&[&row.title, note], &terms);
            SearchHit {
                kind: SearchHitKind::Task,
                id: row.id,
                task_id: row.id,
                task_title: row.title,
                snippet,
            }
        });
    let comment_hits = search::like_comments(conn, &terms, SEARCH_MAX_HITS)?
        .into_iter()
        .map(|row| {
            let snippet = like_snippet(&[&row.body], &terms);
            SearchHit {
                kind: SearchHitKind::Comment,
                id: row.id,
                task_id: row.task_id,
                task_title: row.task_title,
                snippet,
            }
        });
    Ok(task_hits.chain(comment_hits).collect())
}

/// Quotes each term as an FTS5 phrase (doubling embedded quotes) and joins
/// them with AND. Quoting keeps every FTS5 operator character in the user's
/// input literal, and phrases substring-match under the trigram tokenizer.
fn fts_match_expression(terms: &[String]) -> String {
    terms
        .iter()
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

/// ASCII case-insensitive substring search returning the match's byte range.
/// `to_ascii_lowercase` preserves byte lengths, so the range stays valid in
/// the original text.
fn find_ascii_ci(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    if needle.is_empty() {
        return None;
    }
    let fold = |s: &str| {
        s.chars()
            .map(|c| c.to_ascii_lowercase())
            .collect::<String>()
    };
    let start = fold(haystack).find(&fold(needle))?;
    Some((start, start + needle.len()))
}

/// Builds a highlighted snippet around the first term occurrence found across
/// `texts` (tried in order, e.g. title before note). SQLite's `snippet()`
/// does the equivalent for the FTS path; this serves the LIKE path.
fn like_snippet(texts: &[&str], terms: &[String]) -> String {
    for text in texts {
        if let Some((start, end)) = terms.iter().find_map(|t| find_ascii_ci(text, t)) {
            return window_snippet(text, start, end);
        }
    }
    // No occurrence found (only possible when SQLite's LIKE case folding
    // diverges from ours): a plain head of the first text.
    texts
        .first()
        .map(|text| {
            let count = text.chars().count();
            let mut head: String = text.chars().take(SNIPPET_RADIUS_CHARS * 2).collect();
            if count > SNIPPET_RADIUS_CHARS * 2 {
                head.push('…');
            }
            head
        })
        .unwrap_or_default()
}

/// Extracts `text[start..end]` wrapped in `<mark>` markers with
/// [`SNIPPET_RADIUS_CHARS`] characters of context, ellipsised on truncation.
fn window_snippet(text: &str, start: usize, end: usize) -> String {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let index_of = |byte: usize| chars.partition_point(|&(b, _)| b < byte);
    let lo = index_of(start).saturating_sub(SNIPPET_RADIUS_CHARS);
    let hi = (index_of(end) + SNIPPET_RADIUS_CHARS).min(chars.len());

    let mut snippet = String::new();
    if lo > 0 {
        snippet.push('…');
    }
    snippet.extend(chars[lo..index_of(start)].iter().map(|&(_, c)| c));
    snippet.push_str("<mark>");
    snippet.extend(
        chars[index_of(start)..index_of(end)]
            .iter()
            .map(|&(_, c)| c),
    );
    snippet.push_str("</mark>");
    snippet.extend(chars[index_of(end)..hi].iter().map(|&(_, c)| c));
    if hi < chars.len() {
        snippet.push('…');
    }
    snippet
}

// ---------------------------------------------------------------------------
// reminders (R-01, scanned by the background scheduler in `scheduler.rs`)
// ---------------------------------------------------------------------------

/// Reminders only consider tasks due within the last 24 hours; older overdue
/// tasks are silent backlog and never fire.
const REMINDER_CATCHUP_HOURS: i64 = 24;

/// Every reminder kind with its lead time in minutes before `due_at`, in the
/// order they fire.
const REMINDER_KIND_LEADS: [(ReminderKind, i64); 3] = [
    (ReminderKind::Advance1h, 60),
    (ReminderKind::Advance10m, 10),
    (ReminderKind::Due, 0),
];

/// The reminder kinds whose lead time has arrived for `due_at`. Once a due
/// time has passed only the due reminder applies: catching up a stale "in 1
/// hour" after downtime would be noise.
fn due_kinds(now: DateTime<Utc>, due_at: DateTime<Utc>) -> Vec<ReminderKind> {
    REMINDER_KIND_LEADS
        .iter()
        .filter(|(_, lead)| now >= due_at - chrono::Duration::minutes(*lead))
        .filter(|(_, lead)| *lead == 0 || now < due_at)
        .map(|(kind, _)| *kind)
        .collect()
}

/// One scheduler scan (runs on the fixed interval in `scheduler.rs`, inside
/// one transaction): fires each (task, kind) reminder whose lead time has
/// arrived and marks it so it never fires again — markers persist across
/// scans and app restarts. Once a task is overdue only the due reminder
/// fires; catching up a stale "in 1 hour" after downtime would be noise.
/// Tasks due more than [`REMINDER_CATCHUP_HOURS`] ago are skipped entirely.
///
/// One round over `tasks` covers the whole tree: a subtask is a task row, so
/// it reminds on its own due time — even when its parent is completed. A
/// soft-deleted parent takes its children out of the scan by cascading the
/// delete, not by a second query.
pub fn scan_reminders(conn: &Connection, now: DateTime<Utc>) -> Result<Vec<Reminder>, AppError> {
    let cutoff = now - chrono::Duration::hours(REMINDER_CATCHUP_HOURS);
    let horizon = now + chrono::Duration::hours(1);

    let tx = conn.unchecked_transaction()?;
    let mut fired = Vec::new();

    for candidate in reminders::list_candidates(conn, cutoff, horizon)? {
        for kind in due_kinds(now, candidate.due_at) {
            if reminders::mark_fired(&tx, candidate.id, kind, now)? {
                fired.push(Reminder {
                    task_id: candidate.id,
                    task_title: candidate.title.clone(),
                    kind,
                    due_at: candidate.due_at,
                });
            }
        }
    }

    tx.commit()?;
    Ok(fired)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::{
        NewTag, NewTask, StatsGranularity, TimeGroupBy, TimePoint, TimeShare, UpdateTask,
    };
    use chrono::TimeZone;
    use rusqlite::params;

    fn conn() -> Connection {
        db::test_conn()
    }

    /// Task factory hitting the real create path (trim + defaults).
    fn make_task(conn: &Connection, title: &str) -> Task {
        create_task(
            conn,
            NewTask {
                title: title.into(),
                note: None,
                priority: None,
                project_id: None,
                column_id: None,
                due_at: None,
                tag_ids: Vec::new(),
                subtask_titles: Vec::new(),
                repeat_rule: None,
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap()
    }

    /// `NewTask` with everything unset but the title, for tests that only care
    /// about one field: `NewTask { complexity: Some(4), ..make_new_task("x") }`.
    fn make_new_task(title: &str) -> NewTask {
        NewTask {
            title: title.into(),
            note: None,
            priority: None,
            project_id: None,
            column_id: None,
            due_at: None,
            tag_ids: Vec::new(),
            subtask_titles: Vec::new(),
            repeat_rule: None,
            complexity: None,
            parent_task_id: None,
        }
    }

    /// Creates a child of `parent` through the public path.
    fn make_child(conn: &Connection, parent: &Task, title: &str) -> Task {
        create_task(
            conn,
            NewTask {
                parent_task_id: Some(parent.id),
                ..make_new_task(title)
            },
        )
        .unwrap()
    }

    /// One dependency edge, `dependent → prerequisite` (the prerequisite must
    /// be finished first).
    fn dependency(dependent_id: Uuid, prerequisite_id: Uuid) -> Dependency {
        Dependency {
            dependent_id,
            prerequisite_id,
        }
    }

    /// 键是按范围链下去的：子行有自己的序列（从 `first()` 重新开始），追加只看
    /// **本范围**的最后一个键——不再为了这个把整张表 hydrate 一遍。
    #[test]
    fn append_key_chains_within_its_own_scope() {
        let conn = conn();
        let parent = make_task(&conn, "父");
        let sibling = make_task(&conn, "同层");
        assert_eq!(parent.sort_order, "n");
        assert_eq!(sibling.sort_order, "o");

        let first_child = make_child(&conn, &parent, "子一");
        let second_child = make_child(&conn, &parent, "子二");
        assert_eq!(first_child.sort_order, "n", "子行的序列从 first() 重新开始");
        assert_eq!(second_child.sort_order, "o");
        assert_eq!(
            tasks::last_sort_key(
                &conn,
                tasks::SortScope {
                    column_id: None,
                    parent_id: None
                }
            )
            .unwrap(),
            Some("o".into()),
            "顶层范围的最后一个键没有被两个子行影响"
        );
    }

    #[test]
    fn create_task_trims_title_applies_defaults_and_appends() {
        let conn = conn();
        let first = make_task(&conn, "  周报  ");
        assert_eq!(first.title, "周报");
        assert_eq!(first.priority, Priority::None);
        assert_eq!(first.completed_at, None);
        assert_eq!(first.sort_order, "n");

        let second = make_task(&conn, "第二个");
        assert_eq!(second.sort_order, "o");
        assert_eq!(
            tasks::list(&conn)
                .unwrap()
                .into_iter()
                .map(|t| t.sort_order)
                .collect::<Vec<_>>(),
            vec!["n", "o"]
        );
    }

    #[test]
    fn create_task_with_tags_and_subtasks_is_atomic() {
        let conn = conn();
        let tag = create_tag(
            &conn,
            NewTag {
                name: "工作".into(),
                color: None,
            },
        )
        .unwrap();

        let task = create_task(
            &conn,
            NewTask {
                title: "上线检查".into(),
                note: Some("周五前".into()),
                priority: Some(Priority::High),
                project_id: None,
                column_id: None,
                due_at: None,
                tag_ids: vec![tag.id, tag.id],
                subtask_titles: vec!["回归测试".into(), "发布公告".into()],
                repeat_rule: None,
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap();

        assert_eq!(task.priority, Priority::High);
        let linked = task_tags::list_tags_for_task(&conn, task.id).unwrap();
        assert_eq!(linked.len(), 1, "duplicate tag ids are deduped");

        let subtasks = tasks::list_by_parent(&conn, task.id).unwrap();
        let titles: Vec<&str> = subtasks.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["回归测试", "发布公告"]);
        assert!(subtasks[0].sort_order < subtasks[1].sort_order);

        // `task:list` carries each task's tag associations, children included:
        // the tree is derived from `parentTaskId` on the frontend.
        let listed = list_tasks(&conn).unwrap();
        assert_eq!(listed.len(), 3, "the task plus its two children");
        let parent = listed
            .iter()
            .find(|entry| entry.task.id == task.id)
            .expect("the parent is listed");
        assert_eq!(parent.task.title, "上线检查");
        assert_eq!(parent.tag_ids, vec![tag.id]);
    }

    #[test]
    fn create_task_rejects_blank_title() {
        let conn = conn();
        let err = create_task(
            &conn,
            NewTask {
                title: "   ".into(),
                note: None,
                priority: None,
                project_id: None,
                column_id: None,
                due_at: None,
                tag_ids: Vec::new(),
                subtask_titles: Vec::new(),
                repeat_rule: None,
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "validation");
    }

    #[test]
    fn create_task_with_unknown_tag_rolls_everything_back() {
        let conn = conn();
        make_task(&conn, "留存任务");
        let err = create_task(
            &conn,
            NewTask {
                title: "坏任务".into(),
                note: None,
                priority: None,
                project_id: None,
                column_id: None,
                due_at: None,
                tag_ids: vec![Uuid::new_v4()],
                subtask_titles: vec!["不应存在".into()],
                repeat_rule: None,
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_found");

        // Neither the task nor its child survived.
        assert_eq!(tasks::list(&conn).unwrap().len(), 1);
        for task in tasks::list(&conn).unwrap() {
            assert!(tasks::list_by_parent(&conn, task.id).unwrap().is_empty());
        }
    }

    #[test]
    fn complete_task_stamps_completed_at_once() {
        let conn = conn();
        let task = make_task(&conn, "完成我");
        assert_eq!(task.completed_at, None);

        let completed = complete_task(&conn, task.id).unwrap();
        let stamped = completed.completed_at.expect("completed_at set");
        assert_eq!(completed.updated_at, stamped);

        // Completing again keeps the original timestamp.
        let again = complete_task(&conn, task.id).unwrap();
        assert_eq!(again.completed_at, Some(stamped));

        let err = complete_task(&conn, Uuid::new_v4()).unwrap_err();
        assert_eq!(err.code(), "not_found");
    }

    #[test]
    fn update_task_patches_clears_and_replaces_tags() {
        let conn = conn();
        let tag_a = create_tag(
            &conn,
            NewTag {
                name: "a".into(),
                color: None,
            },
        )
        .unwrap();
        let tag_b = create_tag(
            &conn,
            NewTag {
                name: "b".into(),
                color: None,
            },
        )
        .unwrap();
        let task = create_task(
            &conn,
            NewTask {
                title: "原始".into(),
                note: Some("备注".into()),
                priority: None,
                project_id: None,
                column_id: None,
                due_at: None,
                tag_ids: vec![tag_a.id],
                subtask_titles: Vec::new(),
                repeat_rule: None,
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap();

        // Missing fields stay untouched; explicit null clears.
        let updated = update_task(
            &conn,
            task.id,
            UpdateTask {
                title: Some("改名".into()),
                note: Patch::Set(None),
                priority: Some(Priority::Low),
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Unchanged,
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(updated.title, "改名");
        assert_eq!(updated.note, None);
        assert_eq!(updated.priority, Priority::Low);
        assert_eq!(
            task_tags::list_tags_for_task(&conn, task.id).unwrap().len(),
            1,
            "tag_ids missing keeps the set"
        );

        let replaced = update_task(
            &conn,
            task.id,
            UpdateTask {
                title: None,
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: Some(vec![tag_b.id]),
                repeat_rule: Patch::Unchanged,
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap();
        let linked: Vec<Uuid> = task_tags::list_tags_for_task(&conn, replaced.id)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(linked, vec![tag_b.id]);

        let err = update_task(
            &conn,
            Uuid::new_v4(),
            UpdateTask {
                title: None,
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Unchanged,
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_found");
    }

    #[test]
    fn complexity_roundtrips_and_rejects_out_of_range() {
        let conn = conn();
        let task = create_task(
            &conn,
            NewTask {
                complexity: Some(4),
                ..make_new_task("有复杂度")
            },
        )
        .unwrap();
        assert_eq!(task.complexity, Some(4));
        assert_eq!(
            tasks::get(&conn, task.id).unwrap().unwrap().complexity,
            Some(4)
        );

        // Patch semantics: missing leaves the value, explicit null clears it.
        let renamed = update_task(
            &conn,
            task.id,
            UpdateTask {
                title: Some("改名".into()),
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Unchanged,
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(
            renamed.complexity,
            Some(4),
            "missing complexity must not clear it"
        );

        let cleared = update_task(
            &conn,
            task.id,
            UpdateTask {
                title: None,
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Unchanged,
                complexity: Patch::Set(None),
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(cleared.complexity, None);

        assert_eq!(
            update_task(
                &conn,
                task.id,
                UpdateTask {
                    title: None,
                    note: Patch::Unchanged,
                    priority: None,
                    project_id: Patch::Unchanged,
                    column_id: Patch::Unchanged,
                    due_at: Patch::Unchanged,
                    completed_at: Patch::Unchanged,
                    tag_ids: None,
                    repeat_rule: Patch::Unchanged,
                    complexity: Patch::Set(Some(6)),
                    parent_task_id: Patch::Unchanged,
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );
        assert_eq!(
            create_task(
                &conn,
                NewTask {
                    complexity: Some(0),
                    ..make_new_task("越界")
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );
    }

    #[test]
    fn soft_delete_then_restore_task_round_trips() {
        let conn = conn();
        let task = make_task(&conn, "待删");
        soft_delete_task(&conn, task.id).unwrap();
        assert!(tasks::list(&conn).unwrap().is_empty());

        let again = soft_delete_task(&conn, task.id).unwrap_err();
        assert_eq!(again.code(), "not_found");

        let restored = restore_task(&conn, task.id).unwrap();
        assert_eq!(restored.id, task.id);
        assert_eq!(restored.deleted_at, None);
    }

    #[test]
    fn tag_crud_validates_unique_names_case_insensitively() {
        let conn = conn();
        let tag = create_tag(
            &conn,
            NewTag {
                name: "work".into(),
                color: None,
            },
        )
        .unwrap();

        let dup = create_tag(
            &conn,
            NewTag {
                name: "work".into(),
                color: None,
            },
        )
        .unwrap_err();
        assert_eq!(dup.code(), "validation");
        let dup_case = create_tag(
            &conn,
            NewTag {
                name: "WORK".into(),
                color: None,
            },
        )
        .unwrap_err();
        assert_eq!(dup_case.code(), "validation");

        let renamed = update_tag(
            &conn,
            tag.id,
            UpdateTag {
                name: Some("生活".into()),
                color: Patch::Set(Some("#00ff00".into())),
            },
        )
        .unwrap();
        assert_eq!(renamed.name, "生活");
        assert_eq!(renamed.color.as_deref(), Some("#00ff00"));

        let cleared = update_tag(
            &conn,
            tag.id,
            UpdateTag {
                name: None,
                color: Patch::Set(None),
            },
        )
        .unwrap();
        assert_eq!(cleared.color, None);

        delete_tag(&conn, tag.id).unwrap();
        assert!(tags::list(&conn).unwrap().is_empty());
        assert_eq!(delete_tag(&conn, tag.id).unwrap_err().code(), "not_found");
    }

    #[test]
    fn creating_a_child_records_its_parent_and_inherits_the_project() {
        let conn = conn();
        let project = make_project(&conn, "网站改版");
        let mut parent = make_new_task("写周报");
        parent.project_id = Some(project.id);
        parent.column_id = Some(first_column(&conn, project.id).id);
        let parent = create_task(&conn, parent).unwrap();

        let child = make_child(&conn, &parent, "收集数据");

        assert_eq!(child.parent_task_id, Some(parent.id));
        assert_eq!(
            child.project_id, parent.project_id,
            "a child follows its parent"
        );
        assert_eq!(
            child.project_id,
            Some(project.id),
            "the parent's own project"
        );
        assert_eq!(child.column_id, None, "a child never lands on a board");
        assert_eq!(child.repeat_rule, None);
    }

    /// A scope's rows in list order. `task:reorder` used to answer with this
    /// list; it now answers with `{ moved, rebalanced }`, so the tests read the
    /// authoritative copy from the database instead.
    fn scope_rows(conn: &Connection, scope: tasks::SortScope) -> Vec<Task> {
        tasks::scope_sort_keys(conn, scope, None)
            .unwrap()
            .into_iter()
            .map(|(id, _)| tasks::get(conn, id).unwrap().expect("scope row is live"))
            .collect()
    }

    #[test]
    fn reorder_task_moves_within_the_siblings() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let first = make_child(&conn, &parent, "一");
        let second = make_child(&conn, &parent, "二");
        let third = make_child(&conn, &parent, "三");

        // Move the third before the first: prev = None, next = first's key.
        let result = reorder_task(&conn, third.id, None, Some(first.sort_order.clone())).unwrap();
        assert_eq!(result.moved.task.id, third.id);
        assert!(
            result.rebalanced.is_empty(),
            "no rebalance, so no rewritten keys"
        );

        let ordered = scope_rows(
            &conn,
            tasks::SortScope {
                column_id: None,
                parent_id: Some(parent.id),
            },
        );
        let titles: Vec<&str> = ordered.iter().map(|task| task.title.as_str()).collect();
        assert_eq!(titles, ["三", "一", "二"]);
        assert_eq!(
            ordered
                .iter()
                .find(|task| task.id == second.id)
                .unwrap()
                .sort_order,
            second.sort_order,
            "an untouched sibling keeps its key"
        );
    }

    // --- sibling scope and the board ------------------------------------------

    #[test]
    fn reorder_task_moves_within_a_top_level_column() {
        let conn = conn();
        let project = make_project(&conn, "排序项目");
        let todo = first_column(&conn, project.id);
        let a = make_column_task(&conn, &todo, "A");
        let b = make_column_task(&conn, &todo, "B");
        let c = make_column_task(&conn, &todo, "C");
        // A column-less task is a sibling of the inbox, not of these cards.
        let loose = make_task(&conn, "随手记");

        // Move C to the front of the column: prev = None, next = A's key.
        let result = reorder_task(&conn, c.id, None, Some(a.sort_order.clone())).unwrap();
        assert_eq!(result.moved.task.id, c.id);

        let ordered = scope_rows(
            &conn,
            tasks::SortScope {
                column_id: Some(todo.id),
                parent_id: None,
            },
        );
        let titles: Vec<&str> = ordered.iter().map(|task| task.title.as_str()).collect();
        assert_eq!(titles, ["C", "A", "B"]);
        assert_eq!(
            ordered
                .iter()
                .find(|task| task.id == b.id)
                .unwrap()
                .sort_order,
            b.sort_order,
            "an untouched sibling keeps its key"
        );
        assert!(
            !ordered.iter().any(|task| task.id == loose.id),
            "the top-level scope is one column, not every root task"
        );
    }

    #[test]
    fn a_new_top_level_task_does_not_join_the_children_s_key_range() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        // Column-less top-level task: without `parent_task_id IS NULL` its
        // append would land inside the children's key range.
        let loose = make_task(&conn, "随手记");

        assert!(
            loose.sort_order > child.sort_order,
            "a top-level task appends after the top-level scale, not the children's"
        );
        let siblings = tasks::list_by_parent(&conn, parent.id).unwrap();
        assert_eq!(siblings.len(), 1, "the new task is not one of the children");
    }

    #[test]
    fn creating_a_child_appends_after_its_siblings_only() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let other = make_task(&conn, "别的任务");
        let first = make_child(&conn, &parent, "一");
        let second = make_child(&conn, &parent, "二");

        assert!(second.sort_order > first.sort_order);
        let siblings = tasks::list_by_parent(&conn, parent.id).unwrap();
        let ids: Vec<Uuid> = siblings.iter().map(|task| task.id).collect();
        assert_eq!(ids, [first.id, second.id], "only this parent's children");
        assert!(!ids.contains(&other.id));
    }

    #[test]
    fn move_task_rejects_a_child() {
        let conn = conn();
        let project = make_project(&conn, "网站改版");
        let column = first_column(&conn, project.id);
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        let error = move_task(&conn, child.id, column.id, None, None).unwrap_err();

        assert_eq!(error.code(), "validation");
    }

    /// An empty lane offers no neighbour to point between — that is the normal
    /// state of a fresh project's 已完成 lane — so a drop into one arrives with
    /// both keys empty and has to mean "append to this lane". It used to be a
    /// validation error, which made the gesture fail on a lane the user could
    /// see was empty.
    #[test]
    fn move_task_into_an_empty_column_appends() {
        let conn = conn();
        let project = make_project(&conn, "网站改版");
        let done = done_column(&conn, project.id);
        let task = make_task(&conn, "写周报");

        let moved = move_task(&conn, task.id, done.id, None, None).unwrap();

        assert_eq!(moved.moved.task.column_id, Some(done.id));
        assert_eq!(moved.moved.task.project_id, Some(project.id));
        assert!(
            moved.moved.task.completed_at.is_some(),
            "entering the done lane completes the task"
        );
    }

    /// The board gesture is not the only way to write a column: `task:update`
    /// can carry one too, and a child that acquires a column leaves its own
    /// sort scope and shows up on a lane (QA-12).
    #[test]
    fn update_task_refuses_a_column_on_a_child() {
        let conn = conn();
        let project = make_project(&conn, "网站改版");
        let column = first_column(&conn, project.id);
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        let error = update_task(
            &conn,
            child.id,
            UpdateTask {
                column_id: Patch::Set(Some(column.id)),
                ..no_patch()
            },
        )
        .unwrap_err();

        assert_eq!(error.code(), "validation");
        assert_eq!(
            tasks::get(&conn, child.id).unwrap().unwrap().column_id,
            None
        );
    }

    /// A child that is handed a parent and a column in the same patch is
    /// contradictory, not "parent wins": the column would be written back the
    /// moment the row arrived on a board.
    #[test]
    fn update_task_refuses_a_column_together_with_a_parent() {
        let conn = conn();
        let project = make_project(&conn, "网站改版");
        let column = first_column(&conn, project.id);
        let parent = make_task(&conn, "写周报");
        let loose = make_task(&conn, "收集数据");

        let error = update_task(
            &conn,
            loose.id,
            UpdateTask {
                parent_task_id: Patch::Set(Some(parent.id)),
                column_id: Patch::Set(Some(column.id)),
                ..no_patch()
            },
        )
        .unwrap_err();

        assert_eq!(error.code(), "validation");
        assert_eq!(
            tasks::get(&conn, loose.id).unwrap().unwrap().parent_task_id,
            None
        );
    }

    /// Clearing is always fine — that is how a task is taken off a board.
    #[test]
    fn update_task_clears_a_childs_column_without_complaint() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        let updated = update_task(
            &conn,
            child.id,
            UpdateTask {
                column_id: Patch::Set(None),
                ..no_patch()
            },
        )
        .unwrap();

        assert_eq!(updated.column_id, None);
    }

    /// A column from another project would file the row into a lane its own
    /// project's board never lists.
    #[test]
    fn create_task_rejects_a_column_from_another_project() {
        let conn = conn();
        let mine = make_project(&conn, "网站改版");
        let theirs = make_project(&conn, "读书计划");
        let foreign = first_column(&conn, theirs.id);

        let error = create_task(
            &conn,
            NewTask {
                project_id: Some(mine.id),
                column_id: Some(foreign.id),
                ..make_new_task("写周报")
            },
        )
        .unwrap_err();

        assert_eq!(error.code(), "validation");
    }

    #[test]
    fn create_task_rejects_an_unknown_column() {
        let conn = conn();
        let project = make_project(&conn, "网站改版");

        let error = create_task(
            &conn,
            NewTask {
                project_id: Some(project.id),
                column_id: Some(Uuid::new_v4()),
                ..make_new_task("写周报")
            },
        )
        .unwrap_err();

        assert_eq!(error.code(), "not_found");
    }

    // --- hierarchy rules ------------------------------------------------------

    /// `UpdateTask` with every field "unchanged", so a test can patch one:
    /// `UpdateTask { parent_task_id: Patch::Set(Some(id)), ..no_patch() }`.
    /// `UpdateTask` has no `Default` derive (the `Patch` variants carry the
    /// intent), so the literal has to be spelled out once, here.
    fn no_patch() -> UpdateTask {
        UpdateTask {
            title: None,
            note: Patch::Unchanged,
            priority: None,
            project_id: Patch::Unchanged,
            column_id: Patch::Unchanged,
            due_at: Patch::Unchanged,
            complexity: Patch::Unchanged,
            completed_at: Patch::Unchanged,
            tag_ids: None,
            repeat_rule: Patch::Unchanged,
            parent_task_id: Patch::Unchanged,
        }
    }

    #[test]
    fn a_parent_must_be_a_live_top_level_task() {
        let conn = conn();
        let grandparent = make_task(&conn, "顶层");
        let parent = make_child(&conn, &grandparent, "中间的");
        let loose = make_task(&conn, "孤儿");

        let nested = create_task(
            &conn,
            NewTask {
                parent_task_id: Some(parent.id),
                ..make_new_task("第三层")
            },
        )
        .unwrap_err();
        assert_eq!(
            nested.code(),
            "validation",
            "the hierarchy is one level deep"
        );

        soft_delete_task(&conn, loose.id).unwrap();
        let gone = create_task(
            &conn,
            NewTask {
                parent_task_id: Some(loose.id),
                ..make_new_task("挂在已删任务下")
            },
        )
        .unwrap_err();
        assert_eq!(gone.code(), "not_found");
    }

    #[test]
    fn a_task_cannot_become_its_own_parent() {
        let conn = conn();
        let task = make_task(&conn, "写周报");

        let error = update_task(
            &conn,
            task.id,
            UpdateTask {
                parent_task_id: Patch::Set(Some(task.id)),
                ..no_patch()
            },
        )
        .unwrap_err();

        assert_eq!(error.code(), "validation");
    }

    #[test]
    fn a_task_with_children_cannot_become_a_child() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        make_child(&conn, &parent, "收集数据");
        let target = make_task(&conn, "别的任务");

        let error = update_task(
            &conn,
            parent.id,
            UpdateTask {
                parent_task_id: Patch::Set(Some(target.id)),
                ..no_patch()
            },
        )
        .unwrap_err();

        assert_eq!(
            error.code(),
            "validation",
            "one level means a parent has no parent"
        );
    }

    #[test]
    fn a_deleted_child_still_blocks_its_parent_from_becoming_a_child() {
        // The three-level hole: delete the only child, re-parent its parent,
        // then restore the child. The child's immediate parent is live again
        // after step two, so the restore guard on its own would wave it
        // through — into a tree that is now three levels deep.
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");
        let target = make_task(&conn, "别的任务");
        soft_delete_task(&conn, child.id).unwrap();

        let error = update_task(
            &conn,
            parent.id,
            UpdateTask {
                parent_task_id: Patch::Set(Some(target.id)),
                ..no_patch()
            },
        )
        .unwrap_err();

        assert_eq!(
            error.code(),
            "validation",
            "a child in the recycle bin still comes back through its parent's restore"
        );
        assert_eq!(
            tasks::get(&conn, parent.id)
                .unwrap()
                .unwrap()
                .parent_task_id,
            None,
            "the rejected re-parent left the task top-level"
        );

        // The rest of the sequence leaves the tree one level deep: the child
        // returns under a parent that has no parent of its own.
        let restored = restore_task(&conn, child.id).unwrap();
        assert_eq!(restored.parent_task_id, Some(parent.id));
        assert_eq!(
            tasks::get(&conn, parent.id)
                .unwrap()
                .unwrap()
                .parent_task_id,
            None
        );
    }

    #[test]
    fn re_parenting_a_task_moves_it_into_the_new_parent_s_project() {
        let conn = conn();
        let (first_project, second_project) = (make_project(&conn, "A"), make_project(&conn, "B"));
        let target = make_task_in(&conn, Some(second_project.id), Vec::new(), "目标任务");
        let mut loose = make_new_task("被拖的");
        loose.project_id = Some(first_project.id);
        let loose = create_task(&conn, loose).unwrap();

        let moved = update_task(
            &conn,
            loose.id,
            UpdateTask {
                parent_task_id: Patch::Set(Some(target.id)),
                ..no_patch()
            },
        )
        .unwrap();

        assert_eq!(moved.parent_task_id, Some(target.id));
        assert_eq!(
            moved.project_id,
            Some(second_project.id),
            "a child follows its parent"
        );
        assert_eq!(moved.column_id, None);
    }

    #[test]
    fn re_parenting_re_keys_the_task_at_the_end_of_its_new_siblings() {
        // Keys are per sibling scope (`create_task_in_tx`), so the key a task
        // carries out of its old list means nothing in the new one: kept as-is
        // it would slot the row in arbitrarily, or tie with a sibling.
        let conn = conn();
        let (old_parent, new_parent) = (make_task(&conn, "甲"), make_task(&conn, "乙"));
        let moved = make_child(&conn, &old_parent, "搬走的");
        let first_anchor = make_child(&conn, &new_parent, "锚点一");
        make_child(&conn, &new_parent, "锚点二");
        make_child(&conn, &new_parent, "锚点三");

        // Each is the first row of its own list, so the two keys are equal.
        assert_eq!(moved.sort_order, first_anchor.sort_order);

        let moved = update_task(
            &conn,
            moved.id,
            UpdateTask {
                parent_task_id: Patch::Set(Some(new_parent.id)),
                ..no_patch()
            },
        )
        .unwrap();

        let siblings = tasks::list_by_parent(&conn, new_parent.id).unwrap();
        let titles: Vec<&str> = siblings.iter().map(|task| task.title.as_str()).collect();
        assert_eq!(titles, ["锚点一", "锚点二", "锚点三", "搬走的"]);
        assert!(
            siblings
                .iter()
                .all(|task| task.id == moved.id || task.sort_order < moved.sort_order),
            "the re-keyed task sorts after every sibling it joined"
        );
    }

    #[test]
    fn promoting_a_child_back_to_the_top_level_appends_it_last_there() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let other = make_task(&conn, "第一条");
        let child = make_child(&conn, &parent, "被提出的");

        let promoted = update_task(
            &conn,
            child.id,
            UpdateTask {
                parent_task_id: Patch::Set(None),
                ..no_patch()
            },
        )
        .unwrap();

        assert_eq!(promoted.parent_task_id, None);
        let top_level: Vec<Task> = tasks::list(&conn)
            .unwrap()
            .into_iter()
            .filter(|task| task.parent_task_id.is_none())
            .collect();
        assert_eq!(top_level.last().map(|task| task.id), Some(promoted.id));
        assert!(
            other.sort_order < promoted.sort_order,
            "the promoted task is re-keyed after the top-level list, not left on the key it had as a child"
        );
    }

    #[test]
    fn completing_a_parent_leaves_its_children_open() {
        // §9.1: completion does not cascade — a child has its own state and its
        // own place in the views.
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        complete_task(&conn, parent.id).unwrap();

        let reloaded = tasks::get(&conn, child.id).unwrap().unwrap();
        assert_eq!(reloaded.completed_at, None);
        assert_eq!(reloaded.parent_task_id, Some(parent.id));
    }

    #[test]
    fn soft_deleting_and_restoring_a_parent_takes_its_children_along() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let first = make_child(&conn, &parent, "一");
        let second = make_child(&conn, &parent, "二");

        soft_delete_task(&conn, parent.id).unwrap();
        assert!(tasks::get(&conn, first.id).unwrap().is_none());
        assert!(tasks::get(&conn, second.id).unwrap().is_none());

        restore_task(&conn, parent.id).unwrap();
        assert!(tasks::get(&conn, first.id).unwrap().is_some());
        assert!(tasks::get(&conn, second.id).unwrap().is_some());
    }

    #[test]
    fn moving_a_parent_to_another_project_moves_its_children() {
        let conn = conn();
        let (first, second) = (make_project(&conn, "A"), make_project(&conn, "B"));
        let parent = make_task_in(&conn, Some(first.id), Vec::new(), "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        update_task(
            &conn,
            parent.id,
            UpdateTask {
                project_id: Patch::Set(Some(second.id)),
                ..no_patch()
            },
        )
        .unwrap();

        assert_eq!(
            tasks::get(&conn, child.id).unwrap().unwrap().project_id,
            Some(second.id),
            "a child must not be left behind in the old project"
        );
    }

    #[test]
    fn a_rejected_patch_leaves_the_children_with_their_parent() {
        let conn = conn();
        let (first, second) = (make_project(&conn, "A"), make_project(&conn, "B"));
        let parent = make_task_in(&conn, Some(first.id), Vec::new(), "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        // The stale tag id fails validation *after* the project write: the
        // children follow inside the parent's own transaction, so the whole
        // patch rolls back instead of leaving them in the new project alone.
        let error = update_task(
            &conn,
            parent.id,
            UpdateTask {
                project_id: Patch::Set(Some(second.id)),
                tag_ids: Some(vec![Uuid::new_v4()]),
                ..no_patch()
            },
        )
        .unwrap_err();
        assert_eq!(error.code(), "not_found");

        assert_eq!(
            tasks::get(&conn, parent.id).unwrap().unwrap().project_id,
            Some(first.id),
            "the parent stays where the rejected patch found it"
        );
        assert_eq!(
            tasks::get(&conn, child.id).unwrap().unwrap().project_id,
            Some(first.id),
            "and no child may be moved on its own"
        );
    }

    #[test]
    fn a_child_deleted_on_its_own_still_follows_the_parent_s_project_move() {
        let conn = conn();
        let (first, second) = (make_project(&conn, "A"), make_project(&conn, "B"));
        let parent = make_task_in(&conn, Some(first.id), Vec::new(), "写周报");
        let child = make_child(&conn, &parent, "收集数据");
        soft_delete_task(&conn, child.id).unwrap();

        update_task(
            &conn,
            parent.id,
            UpdateTask {
                project_id: Patch::Set(Some(second.id)),
                ..no_patch()
            },
        )
        .unwrap();

        // The parent's project is the only one a child can come back into.
        let back = restore_task(&conn, child.id).unwrap();
        assert_eq!(back.project_id, Some(second.id));
    }

    #[test]
    fn an_explicit_project_next_to_a_new_parent_is_ignored() {
        let conn = conn();
        let (first, second) = (make_project(&conn, "A"), make_project(&conn, "B"));
        let parent = make_task_in(&conn, Some(second.id), Vec::new(), "父任务");
        let child = make_task_in(&conn, Some(first.id), Vec::new(), "被拖的");

        let moved = update_task(
            &conn,
            child.id,
            UpdateTask {
                parent_task_id: Patch::Set(Some(parent.id)),
                project_id: Patch::Set(Some(first.id)),
                ..no_patch()
            },
        )
        .unwrap();

        assert_eq!(moved.parent_task_id, Some(parent.id));
        assert_eq!(
            moved.project_id,
            Some(second.id),
            "the parent's project wins: a child is never filed outside its parent"
        );
        assert_eq!(moved.column_id, None);
    }

    #[test]
    fn restoring_a_child_of_a_deleted_parent_is_rejected() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let child = make_child(&conn, &parent, "收集数据");
        soft_delete_task(&conn, parent.id).unwrap();

        let error = restore_task(&conn, child.id).unwrap_err();

        assert_eq!(error.code(), "validation");
        assert!(
            tasks::get(&conn, child.id).unwrap().is_none(),
            "the rejected restore is rolled back, so no orphan is left live"
        );

        restore_task(&conn, parent.id).unwrap();
        assert!(tasks::get(&conn, child.id).unwrap().is_some());
    }

    // --- subtasks as child tasks ----------------------------------------------

    #[test]
    fn move_task_takes_the_children_to_the_new_project() {
        let conn = conn();
        let (first, second) = (make_project(&conn, "A"), make_project(&conn, "B"));
        let home = first_column(&conn, first.id);
        let target = first_column(&conn, second.id);
        let anchor = make_column_task(&conn, &target, "锚点");
        let parent = make_column_task(&conn, &home, "写周报");
        let child = make_child(&conn, &parent, "收集数据");

        let moved = move_task(
            &conn,
            parent.id,
            target.id,
            Some(anchor.sort_order.clone()),
            None,
        )
        .unwrap();

        assert_eq!(moved.moved.task.project_id, Some(second.id));
        assert_eq!(
            tasks::get(&conn, child.id).unwrap().unwrap().project_id,
            Some(second.id),
            "a child must not be stranded in the project the parent left"
        );
    }

    #[test]
    fn subtask_crud_appends_in_order_and_toggles_done() {
        let conn = conn();
        let task = make_task(&conn, "父任务");
        let first = make_child(&conn, &task, "一");
        let second = make_child(&conn, &task, "二");
        let third = make_child(&conn, &task, "三");
        let list = tasks::list_by_parent(&conn, task.id).unwrap();
        let keys: Vec<&str> = list.iter().map(|s| s.sort_order.as_str()).collect();
        assert_eq!(keys, vec!["n", "o", "p"]);

        // "done" for a child is `completed_at`, exactly like any other task.
        let done = complete_task(&conn, second.id).unwrap();
        assert!(done.completed_at.is_some());
        let undone = update_task(
            &conn,
            second.id,
            UpdateTask {
                completed_at: Patch::Set(None),
                ..no_patch()
            },
        )
        .unwrap();
        assert!(undone.completed_at.is_none());

        soft_delete_task(&conn, third.id).unwrap();
        assert_eq!(tasks::list_by_parent(&conn, task.id).unwrap().len(), 2);
        assert_eq!(
            soft_delete_task(&conn, third.id).unwrap_err().code(),
            "not_found"
        );

        let err = create_task(
            &conn,
            NewTask {
                parent_task_id: Some(Uuid::new_v4()),
                ..make_new_task("孤儿")
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_found");
        assert!(first.sort_order < second.sort_order);
    }

    #[test]
    fn subtask_attributes_roundtrip_and_patch_semantics_hold() {
        let conn = conn();
        let task = make_task(&conn, "父任务");
        let due = Utc.with_ymd_and_hms(2026, 9, 20, 9, 0, 0).unwrap();

        let subtask = create_task(
            &conn,
            NewTask {
                note: Some("先拉近三个月".into()),
                priority: Some(Priority::High),
                due_at: Some(due),
                complexity: Some(2),
                parent_task_id: Some(task.id),
                ..make_new_task("收集数据")
            },
        )
        .unwrap();
        assert_eq!(subtask.note.as_deref(), Some("先拉近三个月"));
        assert_eq!(subtask.priority, Priority::High);
        assert_eq!(subtask.due_at, Some(due));
        assert_eq!(subtask.complexity, Some(2));

        // Missing fields stay, explicit null clears (same Patch rules as tasks).
        let renamed = update_task(
            &conn,
            subtask.id,
            UpdateTask {
                title: Some("收集数据 v2".into()),
                ..no_patch()
            },
        )
        .unwrap();
        assert_eq!(renamed.title, "收集数据 v2");
        assert_eq!(renamed.note.as_deref(), Some("先拉近三个月"));
        assert_eq!(renamed.complexity, Some(2));

        let cleared = update_task(
            &conn,
            subtask.id,
            UpdateTask {
                note: Patch::Set(None),
                due_at: Patch::Set(None),
                complexity: Patch::Set(None),
                ..no_patch()
            },
        )
        .unwrap();
        assert_eq!(cleared.note, None);
        assert_eq!(cleared.due_at, None);
        assert_eq!(cleared.complexity, None);
        assert_eq!(cleared.priority, Priority::High, "priority is not nullable");

        assert_eq!(
            update_task(
                &conn,
                subtask.id,
                UpdateTask {
                    complexity: Patch::Set(Some(9)),
                    ..no_patch()
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );

        // A child created through the bare-title path takes the defaults.
        let plain = make_child(&conn, &task, "默认值");
        assert_eq!(plain.priority, Priority::None);
        assert_eq!(plain.complexity, None);
    }

    #[test]
    fn reorder_subtask_moves_within_the_list() {
        let conn = conn();
        let task = make_task(&conn, "排序");
        let a = make_child(&conn, &task, "A");
        let b = make_child(&conn, &task, "B");
        let c = make_child(&conn, &task, "C");
        fn titles(list: &[Task]) -> Vec<&str> {
            list.iter().map(|s| s.title.as_str()).collect()
        }

        let scope = tasks::SortScope {
            column_id: None,
            parent_id: Some(task.id),
        };

        // Move C to the front (before A).
        reorder_task(&conn, c.id, None, Some(a.sort_order.clone())).unwrap();
        assert_eq!(titles(&scope_rows(&conn, scope)), vec!["C", "A", "B"]);

        // Move A to the end (after B) — a one-sided move whose derived
        // next-neighbour is gone, so the key extends past B.
        reorder_task(&conn, a.id, Some(b.sort_order.clone()), None).unwrap();
        assert_eq!(titles(&scope_rows(&conn, scope)), vec!["C", "B", "A"]);

        // Move C into the middle (after B, before A): the derived pair is
        // tight, so a plain `after(B)` could have collided with A's key.
        reorder_task(&conn, c.id, Some(b.sort_order.clone()), None).unwrap();
        let ordered = scope_rows(&conn, scope);
        assert_eq!(titles(&ordered), vec!["B", "C", "A"]);
        assert!(
            ordered
                .windows(2)
                .all(|w| w[0].sort_order < w[1].sort_order),
            "keys stay strictly ordered"
        );
    }

    #[test]
    fn reorder_subtask_rejects_bad_input() {
        let conn = conn();
        let task = make_task(&conn, "校验");
        let a = make_child(&conn, &task, "A");

        assert_eq!(
            reorder_task(&conn, a.id, None, None).unwrap_err().code(),
            "validation"
        );
        assert_eq!(
            reorder_task(&conn, a.id, Some("1x".into()), None)
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            reorder_task(&conn, a.id, Some("z".into()), Some("a".into()))
                .unwrap_err()
                .code(),
            "validation"
        );
    }

    #[test]
    fn reorder_subtask_rebalances_when_exhausted() {
        let conn = conn();
        let task = make_task(&conn, "耗尽");
        // Neighbours so close that no key fits between them.
        let child = |title: &str, key: &str| Task {
            id: Uuid::new_v4(),
            title: title.into(),
            parent_task_id: Some(task.id),
            sort_order: key.into(),
            ..task.clone()
        };
        let a = child("A", "a");
        let b = child("B", "aa");
        let c = make_child(&conn, &task, "C"); // appended normally
        tasks::insert(&conn, &a).unwrap();
        tasks::insert(&conn, &b).unwrap();

        // between("a", "aa") is exhausted -> the list is rekeyed.
        let result = reorder_task(&conn, c.id, Some("a".into()), Some("aa".into())).unwrap();
        let scope = tasks::SortScope {
            column_id: None,
            parent_id: Some(task.id),
        };
        let ordered = scope_rows(&conn, scope);
        let titles: Vec<&str> = ordered.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["A", "C", "B"]);
        assert!(
            ordered.iter().map(|s| s.sort_order.len()).max().unwrap() <= 2,
            "rebalance shrinks keys: {:?}",
            ordered
                .iter()
                .map(|s| s.sort_order.clone())
                .collect::<Vec<_>>()
        );
        assert!(ordered
            .windows(2)
            .all(|w| w[0].sort_order < w[1].sort_order));
        // Every key the rebalance rewrote is reported back — the moved row
        // included, since its key changed with the rest.
        assert_eq!(result.rebalanced.len(), ordered.len());
        assert!(result.rebalanced.iter().any(|row| row.id == c.id));
        assert_eq!(result.moved.task.sort_order, ordered[1].sort_order);
    }

    #[test]
    fn appending_past_the_length_threshold_rebalances_siblings() {
        let conn = conn();
        let task = make_task(&conn, "超长");
        let bloated = Task {
            id: Uuid::new_v4(),
            parent_task_id: Some(task.id),
            sort_order: "z".repeat(MAX_SORT_KEY_LEN + 4),
            ..task.clone()
        };
        tasks::insert(&conn, &bloated).unwrap();

        let appended = make_child(&conn, &task, "新键");
        let all = tasks::list_by_parent(&conn, task.id).unwrap();
        assert_eq!(all.len(), 2);
        assert!(
            all.iter().map(|s| s.sort_order.len()).max().unwrap() <= 2,
            "both keys rebalanced: {:?}",
            all.iter().map(|s| s.sort_order.clone()).collect::<Vec<_>>()
        );
        assert!(all[0].sort_order < appended.sort_order);
    }

    // --- projects & board ----------------------------------------------------

    fn make_namespace(conn: &Connection, name: &str) -> Namespace {
        create_namespace(
            conn,
            NewNamespace {
                name: name.into(),
                description: None,
                color: None,
                icon: None,
            },
        )
        .unwrap()
    }

    fn make_project(conn: &Connection, name: &str) -> Project {
        create_project(
            conn,
            NewProject {
                name: name.into(),
                description: None,
                color: None,
                icon: None,
                namespace_id: None,
            },
        )
        .unwrap()
    }

    /// 项目范围页：行 + 该带的子行 + 未完成前置计数；没有筛选，所以不分页。
    #[test]
    fn list_tasks_by_project_pages_one_project() {
        let conn = conn();
        let project = make_project(&conn, "范围项目");
        let other = make_project(&conn, "别的项目");
        let project_task = |title: &str| {
            create_task(
                &conn,
                NewTask {
                    project_id: Some(project.id),
                    ..make_new_task(title)
                },
            )
            .unwrap()
        };
        let parent = project_task("父");
        let child = make_child(&conn, &parent, "子");
        let stray = create_task(
            &conn,
            NewTask {
                project_id: Some(other.id),
                ..make_new_task("别人的")
            },
        )
        .unwrap();
        let prerequisite = project_task("前置");
        add_dependency(&conn, dependency(parent.id, prerequisite.id)).unwrap();

        let page = list_tasks_by_project(&conn, project.id).unwrap();

        let ids: Vec<Uuid> = page.rows.iter().map(|row| row.task.id).collect();
        assert_eq!(ids.len(), 3, "父、子、前置；别的项目不在内");
        assert!(ids.contains(&parent.id) && ids.contains(&child.id));
        assert!(!ids.contains(&stray.id));
        assert!(page.children.is_empty(), "项目范围没有筛掉任何子行");
        assert!(page.related.is_empty(), "父就在同一页里");
        assert_eq!(page.blocked.len(), 1);
        assert_eq!(page.blocked[0].task_id, parent.id);
        assert_eq!(page.blocked[0].count, 1);
        assert!(!page.has_more);
        assert!(page.cursor.is_none());

        // 标签跟着行一起回（`TagManagerDialog` 的计数与工具栏筛选都读它）。
        assert!(page
            .rows
            .iter()
            .find(|row| row.task.id == parent.id)
            .unwrap()
            .tag_ids
            .is_empty());

        // 未知项目给空页，不报错：深层链接/已删除项目由项目行本身兜住。
        let empty = list_tasks_by_project(&conn, Uuid::new_v4()).unwrap();
        assert!(empty.rows.is_empty());
    }

    /// 侧边栏箭头的口径：只数顶层、只数未完成、含归档项目、空项目回 0。
    #[test]
    fn unfinished_counts_count_top_level_rows_of_every_live_project() {
        let conn = conn();
        let active = make_project(&conn, "进行中");
        let archived = make_project(&conn, "已归档");
        archive_project(&conn, archived.id).unwrap();
        let empty = make_project(&conn, "空项目");

        let open = create_task(
            &conn,
            NewTask {
                project_id: Some(active.id),
                ..make_new_task("待办")
            },
        )
        .unwrap();
        let done = create_task(
            &conn,
            NewTask {
                project_id: Some(active.id),
                ..make_new_task("做完的")
            },
        )
        .unwrap();
        complete_task(&conn, done.id).unwrap();
        // 子行不计，即使它自己未完成。
        make_child(&conn, &open, "子行");
        create_task(
            &conn,
            NewTask {
                project_id: Some(archived.id),
                ..make_new_task("归档里的待办")
            },
        )
        .unwrap();

        let counts: HashMap<Uuid, i64> = project_unfinished_counts(&conn)
            .unwrap()
            .into_iter()
            .map(|row| (row.project_id, row.unfinished))
            .collect();

        assert_eq!(counts.get(&active.id), Some(&1), "只数未完成顶层行");
        assert_eq!(counts.get(&archived.id), Some(&1), "归档项目同样有箭头");
        assert_eq!(counts.get(&empty.id), Some(&0), "空项目回 0，不回缺失");
    }

    /// 规范 §4 不变量 3：完成的行不再报未完成前置——视图本地就是这么置零的，
    /// 页面的载荷不能跟它唱反调。同一个前置的未完成行照旧报 1。
    #[test]
    fn task_page_drops_completed_rows_from_blocked() {
        let conn = conn();
        let project = make_project(&conn, "阻塞项目");
        let project_task = |title: &str| {
            create_task(
                &conn,
                NewTask {
                    project_id: Some(project.id),
                    ..make_new_task(title)
                },
            )
            .unwrap()
        };
        let prerequisite = project_task("前置");
        let open = project_task("未完成");
        let done = project_task("已完成");
        add_dependency(&conn, dependency(open.id, prerequisite.id)).unwrap();
        add_dependency(&conn, dependency(done.id, prerequisite.id)).unwrap();
        complete_task(&conn, done.id).unwrap();

        let page = list_tasks_by_project(&conn, project.id).unwrap();

        let counts: Vec<(Uuid, i64)> = page
            .blocked
            .iter()
            .map(|entry| (entry.task_id, entry.count))
            .collect();
        assert_eq!(counts, vec![(open.id, 1)], "完成的行不再带未完成前置计数");
    }

    fn first_column(conn: &Connection, project_id: Uuid) -> BoardColumn {
        list_board_columns(conn, project_id).unwrap().remove(0)
    }

    fn done_column(conn: &Connection, project_id: Uuid) -> BoardColumn {
        list_board_columns(conn, project_id)
            .unwrap()
            .into_iter()
            .find(|c| c.is_done)
            .expect("default columns include a done column")
    }

    fn make_column_task(conn: &Connection, column: &BoardColumn, title: &str) -> Task {
        create_task(
            conn,
            NewTask {
                title: title.into(),
                note: None,
                priority: None,
                project_id: Some(column.project_id),
                column_id: Some(column.id),
                due_at: None,
                tag_ids: Vec::new(),
                subtask_titles: Vec::new(),
                repeat_rule: None,
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap()
    }

    /// Directly inserted task with a hand-picked sort key (for Exhausted
    /// scenarios), bypassing the create path.
    fn raw_column_task(conn: &Connection, column: &BoardColumn, title: &str, key: &str) -> Task {
        let now = Utc::now();
        let task = Task {
            id: Uuid::new_v4(),
            project_id: Some(column.project_id),
            title: title.into(),
            note: None,
            priority: Priority::None,
            column_id: Some(column.id),
            due_at: None,
            completed_at: None,
            repeat_rule: None,
            complexity: None,
            parent_task_id: None,
            sort_order: key.into(),
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };
        tasks::insert(conn, &task).unwrap();
        task
    }

    fn column_task_keys(conn: &Connection, column_id: Uuid) -> Vec<String> {
        tasks::list(conn)
            .unwrap()
            .into_iter()
            .filter(|t| t.column_id == Some(column_id))
            .map(|t| t.sort_order)
            .collect()
    }

    #[test]
    fn create_project_seeds_default_columns_and_appends() {
        let conn = conn();
        let first = make_project(&conn, "网站改版");
        assert_eq!(first.status, ProjectStatus::Active);

        let columns = list_board_columns(&conn, first.id).unwrap();
        let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["待办", "进行中", "已完成"]);
        assert_eq!(
            columns.iter().map(|c| c.is_done).collect::<Vec<_>>(),
            vec![false, false, true],
            "the last default column is the done column"
        );
        assert!(columns.windows(2).all(|w| w[0].position < w[1].position));

        let second = make_project(&conn, "增长实验");
        assert!(first.sort_order < second.sort_order);
        let listed = list_projects(&conn).unwrap();
        assert_eq!(
            listed.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![first.id, second.id]
        );

        let err = create_project(
            &conn,
            NewProject {
                name: "   ".into(),
                description: None,
                color: None,
                icon: None,
                namespace_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "validation");
    }

    #[test]
    fn project_update_patches_and_archive_restores() {
        let conn = conn();
        let project = make_project(&conn, "旧名");

        let renamed = update_project(
            &conn,
            project.id,
            UpdateProject {
                name: Some("新名".into()),
                description: Patch::Set(Some("说明".into())),
                color: Patch::Set(None),
                icon: Patch::Set(None),
                namespace_id: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(renamed.name, "新名");
        assert_eq!(renamed.description.as_deref(), Some("说明"));
        assert_eq!(
            update_project(
                &conn,
                project.id,
                UpdateProject {
                    name: Some("  ".into()),
                    description: Patch::Unchanged,
                    color: Patch::Unchanged,
                    icon: Patch::Unchanged,
                    namespace_id: Patch::Unchanged,
                }
            )
            .unwrap_err()
            .code(),
            "validation"
        );

        let archived = archive_project(&conn, project.id).unwrap();
        assert_eq!(archived.status, ProjectStatus::Archived);
        // Archiving twice is a no-op returning the unchanged row; archived
        // projects still list (navigation filters by status).
        assert_eq!(
            archive_project(&conn, project.id).unwrap().status,
            ProjectStatus::Archived
        );
        assert_eq!(list_projects(&conn).unwrap().len(), 1);

        assert_eq!(
            restore_project(&conn, project.id).unwrap().status,
            ProjectStatus::Active
        );
        assert_eq!(
            archive_project(&conn, Uuid::new_v4()).unwrap_err().code(),
            "not_found"
        );
    }

    #[test]
    fn namespace_create_appends_and_validates() {
        let conn = conn();
        let first = make_namespace(&conn, "工作");
        let second = make_namespace(&conn, "学习");
        assert!(first.sort_order < second.sort_order);
        assert_eq!(
            list_namespaces(&conn)
                .unwrap()
                .iter()
                .map(|n| n.name.as_str())
                .collect::<Vec<_>>(),
            vec!["工作", "学习"]
        );

        let err = create_namespace(
            &conn,
            NewNamespace {
                name: "   ".into(),
                description: None,
                color: None,
                icon: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "validation");
    }

    #[test]
    fn namespace_update_patches_and_archive_restores() {
        let conn = conn();
        // A non-null icon, so the `Patch::Set(None)` below really clears a
        // stored value instead of restating the fixture's `None`.
        let namespace = create_namespace(
            &conn,
            NewNamespace {
                name: "旧名".into(),
                description: None,
                color: None,
                icon: Some("briefcase".into()),
            },
        )
        .unwrap();

        let renamed = update_namespace(
            &conn,
            namespace.id,
            UpdateNamespace {
                name: Some("新名".into()),
                description: Patch::Set(Some("主线项目".into())),
                color: Patch::Set(Some("#6366f1".into())),
                icon: Patch::Set(None),
            },
        )
        .unwrap();
        assert_eq!(renamed.name, "新名");
        assert_eq!(renamed.description.as_deref(), Some("主线项目"));
        assert_eq!(renamed.color.as_deref(), Some("#6366f1"));
        assert!(renamed.icon.is_none());

        assert_eq!(
            update_namespace(
                &conn,
                namespace.id,
                UpdateNamespace {
                    name: Some("  ".into()),
                    description: Patch::Unchanged,
                    color: Patch::Unchanged,
                    icon: Patch::Unchanged,
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );

        let archived = archive_namespace(&conn, namespace.id).unwrap();
        assert_eq!(archived.status, ProjectStatus::Archived);
        // Archiving twice is a no-op returning the unchanged row; archived
        // namespaces still list (navigation filters by status).
        assert_eq!(
            archive_namespace(&conn, namespace.id).unwrap().status,
            ProjectStatus::Archived
        );
        assert_eq!(list_namespaces(&conn).unwrap().len(), 1);

        let restored = restore_namespace(&conn, namespace.id).unwrap();
        assert_eq!(restored.status, ProjectStatus::Active);
        assert_eq!(
            archive_namespace(&conn, Uuid::new_v4()).unwrap_err().code(),
            "not_found"
        );
    }

    #[test]
    fn archiving_a_namespace_leaves_its_projects_alone() {
        let conn = conn();
        let namespace = make_namespace(&conn, "工作");
        let project = create_project(
            &conn,
            NewProject {
                name: "网站改版".into(),
                description: None,
                color: None,
                icon: None,
                namespace_id: Some(namespace.id),
            },
        )
        .unwrap();

        archive_namespace(&conn, namespace.id).unwrap();

        let after = projects::get(&conn, project.id).unwrap().unwrap();
        assert_eq!(
            after.status,
            ProjectStatus::Active,
            "group archive is not a cascade"
        );
        assert_eq!(
            after.namespace_id,
            Some(namespace.id),
            "the filing survives"
        );
    }

    #[test]
    fn deleting_a_project_takes_its_tasks_and_columns_with_it() {
        let conn = conn();
        let project = make_project(&conn, "下线项目");
        let survivor_project = make_project(&conn, "留下项目");
        let task = make_task_in(&conn, Some(project.id), Vec::new(), "顶层");
        let child = make_child(&conn, &task, "子任务");
        let survivor = make_task_in(&conn, Some(survivor_project.id), Vec::new(), "别家的");

        delete_project(&conn, project.id).unwrap();

        assert!(projects::get(&conn, project.id).unwrap().is_none());
        assert!(
            tasks::get(&conn, task.id).unwrap().is_none(),
            "a live task of a deleted project would be an orphan"
        );
        // Children carry the project of their parent, so the one bulk statement
        // covers the whole tree — no per-row cascade needed.
        assert!(tasks::get(&conn, child.id).unwrap().is_none());
        assert!(tasks::get(&conn, survivor.id).unwrap().is_some());
        assert!(board_columns::list_by_project(&conn, project.id)
            .unwrap()
            .is_empty());
        // Same not_found contract as a task's second delete.
        assert_eq!(
            delete_project(&conn, project.id).unwrap_err().code(),
            "not_found"
        );
    }

    #[test]
    fn deleting_a_namespace_keeps_its_projects() {
        let conn = conn();
        let namespace = make_namespace(&conn, "工作");
        let project = create_project(
            &conn,
            NewProject {
                name: "网站改版".into(),
                description: None,
                color: None,
                icon: None,
                namespace_id: Some(namespace.id),
            },
        )
        .unwrap();

        delete_namespace(&conn, namespace.id).unwrap();

        // The projects keep their filing: the navigation's live-set rule reads
        // them as ungrouped, and a restore from backup brings the group back
        // exactly as it was.
        assert!(namespaces::get(&conn, namespace.id).unwrap().is_none());
        let after = projects::get(&conn, project.id).unwrap().unwrap();
        assert_eq!(after.namespace_id, Some(namespace.id));
        assert_eq!(projects::list(&conn).unwrap().len(), 1);
        assert_eq!(
            delete_namespace(&conn, namespace.id).unwrap_err().code(),
            "not_found"
        );
    }

    #[test]
    fn project_writes_reject_an_unknown_or_deleted_namespace() {
        let conn = conn();
        let ghost = Uuid::new_v4();

        let created = create_project(
            &conn,
            NewProject {
                name: "孤儿项目".into(),
                description: None,
                color: None,
                icon: None,
                namespace_id: Some(ghost),
            },
        )
        .unwrap_err();
        assert_eq!(created.code(), "not_found");

        let project = make_project(&conn, "网站改版");
        assert_eq!(
            update_project(
                &conn,
                project.id,
                UpdateProject {
                    name: None,
                    description: Patch::Unchanged,
                    color: Patch::Unchanged,
                    icon: Patch::Unchanged,
                    namespace_id: Patch::Set(Some(ghost)),
                },
            )
            .unwrap_err()
            .code(),
            "not_found"
        );

        // A soft-deleted namespace is gone as far as project writes care.
        let namespace = make_namespace(&conn, "工作");
        conn.execute(
            "UPDATE namespaces SET deleted_at = '2026-09-15T00:00:00Z' WHERE id = ?1",
            params![namespace.id.to_string()],
        )
        .unwrap();
        assert_eq!(
            update_project(
                &conn,
                project.id,
                UpdateProject {
                    name: None,
                    description: Patch::Unchanged,
                    color: Patch::Unchanged,
                    icon: Patch::Unchanged,
                    namespace_id: Patch::Set(Some(namespace.id)),
                },
            )
            .unwrap_err()
            .code(),
            "not_found"
        );

        // Clearing the field is always allowed, and filing into a live
        // namespace works.
        let live = make_namespace(&conn, "学习");
        let filed = update_project(
            &conn,
            project.id,
            UpdateProject {
                name: None,
                description: Patch::Unchanged,
                color: Patch::Unchanged,
                icon: Patch::Unchanged,
                namespace_id: Patch::Set(Some(live.id)),
            },
        )
        .unwrap();
        assert_eq!(filed.namespace_id, Some(live.id));

        // Archiving is a state, not a deletion: filing into an archived
        // namespace stays legal (its page offers 「新建项目」 with that
        // namespace preselected), so `validate_namespace_ref` must not grow an
        // `status = 'active'` predicate.
        let archived = archive_namespace(&conn, live.id).unwrap();
        assert_eq!(archived.status, ProjectStatus::Archived);
        let refiled = update_project(
            &conn,
            project.id,
            UpdateProject {
                name: None,
                description: Patch::Unchanged,
                color: Patch::Unchanged,
                icon: Patch::Unchanged,
                namespace_id: Patch::Set(Some(live.id)),
            },
        )
        .unwrap();
        assert_eq!(refiled.namespace_id, Some(live.id));

        let cleared = update_project(
            &conn,
            project.id,
            UpdateProject {
                name: None,
                description: Patch::Unchanged,
                color: Patch::Unchanged,
                icon: Patch::Unchanged,
                namespace_id: Patch::Set(None),
            },
        )
        .unwrap();
        assert_eq!(cleared.namespace_id, None);
    }

    #[test]
    fn a_project_board_comes_with_three_ordered_columns() {
        let conn = conn();
        let project = make_project(&conn, "看板项目");
        let columns = list_board_columns(&conn, project.id).unwrap();
        assert_eq!(
            columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["待办", "进行中", "已完成"]
        );
        assert!(columns.windows(2).all(|w| w[0].position < w[1].position));
        assert_eq!(columns.iter().filter(|c| c.is_done).count(), 1);
        assert!(columns.last().unwrap().is_done);
    }

    #[test]
    fn move_task_syncs_completed_at_with_the_done_column() {
        let conn = conn();
        let project = make_project(&conn, "联动项目");
        let todo = first_column(&conn, project.id);
        let done = done_column(&conn, project.id);
        let task = make_column_task(&conn, &todo, "跨列任务");
        assert_eq!(task.completed_at, None);

        // Entering the done column stamps completed_at (the column's only
        // resident provides the `prev` key; the task lands after it).
        let done_neighbour = make_column_task(&conn, &done, "已完成邻居");
        let moved = move_task(
            &conn,
            task.id,
            done.id,
            Some(done_neighbour.sort_order.clone()),
            None,
        )
        .unwrap();
        assert_eq!(moved.moved.task.column_id, Some(done.id));
        assert_eq!(moved.moved.task.project_id, Some(project.id));
        let stamped = moved
            .moved
            .task
            .completed_at
            .expect("stamped on entering done column");

        // Moving within the done column keeps the original timestamp.
        let again = move_task(
            &conn,
            task.id,
            done.id,
            Some(done_neighbour.sort_order.clone()),
            None,
        )
        .unwrap();
        assert_eq!(again.moved.task.completed_at, Some(stamped));

        // Leaving the done column clears completed_at.
        let anchor = make_column_task(&conn, &todo, "待办锚点");
        let back = move_task(
            &conn,
            task.id,
            todo.id,
            None,
            Some(anchor.sort_order.clone()),
        )
        .unwrap();
        assert_eq!(back.moved.task.completed_at, None);
        assert_eq!(back.moved.task.column_id, Some(todo.id));
    }

    #[test]
    fn move_task_orders_within_the_target_column() {
        let conn = conn();
        let project = make_project(&conn, "排序项目");
        let todo = first_column(&conn, project.id);
        let a = make_column_task(&conn, &todo, "A");
        let b = make_column_task(&conn, &todo, "B");
        let c = make_column_task(&conn, &todo, "C");

        // Move C between A and B (after A, before B).
        let moved = move_task(
            &conn,
            c.id,
            todo.id,
            Some(a.sort_order.clone()),
            Some(b.sort_order.clone()),
        )
        .unwrap();
        assert!(
            moved.moved.task.sort_order > a.sort_order
                && moved.moved.task.sort_order < b.sort_order
        );

        // Move C to the front of the column.
        let moved = move_task(&conn, c.id, todo.id, None, Some(a.sort_order.clone())).unwrap();
        assert!(moved.moved.task.sort_order < a.sort_order);

        let keys = column_task_keys(&conn, todo.id);
        assert!(keys.windows(2).all(|w| w[0] < w[1]), "keys stay ordered");
        assert_eq!(keys.len(), 3);

        // A child carrying a leftover `column_id` (only raw SQL can produce
        // one) must stay out of the column's key sequence: `move_task`'s
        // sibling filter needs `parent_task_id IS NULL` for exactly this row.
        let parent = make_column_task(&conn, &todo, "父");
        let child = make_child(&conn, &parent, "子");
        conn.execute(
            "UPDATE tasks SET column_id = ?1 WHERE id = ?2",
            params![todo.id.to_string(), child.id.to_string()],
        )
        .unwrap();

        let moved = move_task(&conn, c.id, todo.id, Some(b.sort_order.clone()), None).unwrap();
        assert!(
            moved.moved.task.sort_order > b.sort_order,
            "the moved card ignores the stray child's key"
        );
        assert_eq!(
            tasks::get(&conn, child.id).unwrap().unwrap().sort_order,
            child.sort_order,
            "the child's key is never rebalanced by a column move"
        );
    }

    #[test]
    fn move_task_rebalances_when_exhausted() {
        let conn = conn();
        let project = make_project(&conn, "重排项目");
        let todo = first_column(&conn, project.id);
        let a = raw_column_task(&conn, &todo, "A", "a");
        let b = raw_column_task(&conn, &todo, "B", "aa");
        let mover = make_column_task(&conn, &todo, "M");

        // between("a", "aa") is exhausted -> the column is rekeyed with the
        // mover at index 1: [A, M, B].
        let moved = move_task(
            &conn,
            mover.id,
            todo.id,
            Some(a.sort_order.clone()),
            Some(b.sort_order.clone()),
        )
        .unwrap();

        let board = tasks::list(&conn).unwrap();
        let titles: Vec<&str> = board.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, vec!["A", "M", "B"]);
        let keys: Vec<&str> = board.iter().map(|t| t.sort_order.as_str()).collect();
        assert!(keys.windows(2).all(|w| w[0] < w[1]));
        assert!(
            keys.iter().all(|k| k.len() <= 2),
            "rebalance shrinks keys: {keys:?}"
        );
        assert_eq!(
            board.iter().find(|t| t.id == mover.id).unwrap().sort_order,
            moved.moved.task.sort_order
        );
    }

    #[test]
    fn move_task_rejects_unknown_task_column_and_bad_keys() {
        let conn = conn();
        let project = make_project(&conn, "校验项目");
        let todo = first_column(&conn, project.id);
        let task = make_column_task(&conn, &todo, "普通任务");

        assert_eq!(
            move_task(&conn, Uuid::new_v4(), todo.id, None, Some("n".into()))
                .unwrap_err()
                .code(),
            "not_found"
        );
        assert_eq!(
            move_task(&conn, task.id, Uuid::new_v4(), None, Some("n".into()))
                .unwrap_err()
                .code(),
            "not_found"
        );
        // Both keys missing is not an error any more: it is a drop into an
        // empty lane, which appends (see `move_task_into_an_empty_column_appends`).
        assert_eq!(
            move_task(&conn, task.id, todo.id, Some("zz".into()), None)
                .unwrap_err()
                .code(),
            "validation"
        );
    }

    /// Inserts a comment directly; the comments repository/service arrive
    /// with C-01, and the FTS triggers index this row for search.
    fn insert_comment(conn: &Connection, task_id: Uuid, body: &str) -> Uuid {
        let id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO comments (id, task_id, body, created_at, updated_at) \
             VALUES (?1, ?2, ?3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![id.to_string(), task_id.to_string(), body],
        )
        .unwrap();
        id
    }

    #[test]
    fn search_blank_query_has_no_hits() {
        let conn = conn();
        make_task(&conn, "周报");
        assert!(search(&conn, "").unwrap().is_empty());
        assert!(search(&conn, "  \t\n ").unwrap().is_empty());
    }

    #[test]
    fn search_hits_titles_notes_and_comments_with_highlighted_snippets() {
        let conn = conn();
        let doc = make_task(&conn, "撰写产品需求文档");
        update_task(
            &conn,
            doc.id,
            UpdateTask {
                title: None,
                note: Patch::Set(Some("包含竞品分析章节".into())),
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Unchanged,
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap();
        let comment_id = insert_comment(&conn, doc.id, "产品需求评审结论：通过");

        // The term hits the task title and a comment body: tasks come first,
        // comment hits carry the parent task's id/title for navigation.
        let hits = search(&conn, "产品需求").unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].kind, SearchHitKind::Task);
        assert_eq!(hits[0].task_id, doc.id);
        assert!(hits[0].snippet.contains("<mark>产品需求</mark>"));
        assert_eq!(hits[1].kind, SearchHitKind::Comment);
        assert_eq!(hits[1].id, comment_id);
        assert_eq!(hits[1].task_id, doc.id);
        assert_eq!(hits[1].task_title, "撰写产品需求文档");
        assert!(hits[1].snippet.contains("<mark>产品需求</mark>"));

        // Note-only hits resolve to the owning task with a marked snippet.
        let hits = search(&conn, "竞品分析").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, SearchHitKind::Task);
        assert_eq!(hits[0].task_id, doc.id);
        assert!(hits[0].snippet.contains("<mark>竞品分析</mark>"));

        // Comment-only queries return a single comment hit.
        let hits = search(&conn, "评审结论").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, SearchHitKind::Comment);
        assert_eq!(hits[0].id, comment_id);
    }

    #[test]
    fn search_excludes_soft_deleted_tasks_and_their_comments() {
        let conn = conn();
        let task = make_task(&conn, "采购显示器支架");
        insert_comment(&conn, task.id, "显示器支架购买链接");

        assert_eq!(search(&conn, "显示器支架").unwrap().len(), 2);
        soft_delete_task(&conn, task.id).unwrap();
        assert!(search(&conn, "显示器支架").unwrap().is_empty());
    }

    #[test]
    fn search_short_terms_fall_back_to_like_case_insensitively() {
        let conn = conn();
        make_task(&conn, "Go live checklist");
        make_task(&conn, "周报整理");

        // "go" (2 ASCII chars) and "周报" (2 CJK chars) both take the LIKE path.
        let hits = search(&conn, "go").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].task_title, "Go live checklist");
        assert!(
            hits[0].snippet.contains("<mark>Go</mark>"),
            "unexpected snippet: {}",
            hits[0].snippet
        );

        let hits = search(&conn, "周报").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].task_title, "周报整理");
        assert!(hits[0].snippet.contains("<mark>周报</mark>"));
    }

    #[test]
    fn search_requires_every_term_to_match() {
        let conn = conn();
        make_task(&conn, "alpha beta");
        make_task(&conn, "alpha gamma");
        make_task(&conn, "ab cd");
        make_task(&conn, "ab ef");

        // FTS path: quoted phrases AND-ed together.
        let hits = search(&conn, "alpha beta").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].task_title, "alpha beta");

        // LIKE path: every term must occur too.
        let hits = search(&conn, "ab cd").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].task_title, "ab cd");
    }

    #[test]
    fn search_on_thousands_of_tasks_stays_millisecond_level() {
        let conn = conn();
        let tx = conn.unchecked_transaction().unwrap();
        for i in 0..5000 {
            tx.execute(
                "INSERT INTO tasks (id, title, priority, sort_order, created_at, updated_at) \
                 VALUES (?1, ?2, 'none', ?3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                params![
                    Uuid::new_v4().to_string(),
                    format!("例行任务{i}号"),
                    format!("{i:08}"),
                ],
            )
            .unwrap();
        }
        tx.execute(
            "INSERT INTO tasks (id, title, priority, sort_order, created_at, updated_at) \
             VALUES (?1, '季度目标复盘会议', 'none', 'zzzz', '2026-01-01T00:00:00Z', \
                     '2026-01-01T00:00:00Z')",
            params![Uuid::new_v4().to_string()],
        )
        .unwrap();
        tx.commit().unwrap();

        // FTS path (>= 3 chars, indexed trigrams).
        let started = std::time::Instant::now();
        let hits = search(&conn, "目标复盘").unwrap();
        let fts_elapsed = started.elapsed();
        assert_eq!(hits.len(), 1);
        assert!(fts_elapsed.as_millis() < 100, "fts took {fts_elapsed:?}");

        // LIKE fallback (2 chars, full scan over 5001 rows).
        let started = std::time::Instant::now();
        let hits = search(&conn, "复盘").unwrap();
        let like_elapsed = started.elapsed();
        assert_eq!(hits.len(), 1);
        assert!(like_elapsed.as_millis() < 100, "like took {like_elapsed:?}");
    }

    /// A task due at an explicit clock time (reminder scans pass `now` in).
    fn make_due_task(conn: &Connection, title: &str, due: DateTime<Utc>) -> Task {
        create_task(
            conn,
            NewTask {
                title: title.into(),
                note: None,
                priority: None,
                project_id: None,
                column_id: None,
                due_at: Some(due),
                tag_ids: Vec::new(),
                subtask_titles: Vec::new(),
                repeat_rule: None,
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap()
    }

    #[test]
    fn scan_reminders_fires_each_kind_once_at_its_lead_time() {
        let conn = conn();
        let base = Utc.with_ymd_and_hms(2026, 9, 11, 12, 0, 0).unwrap();
        let due = base + chrono::Duration::hours(2);
        make_due_task(&conn, "按时任务", due);

        // Two hours out: nothing is triggerable yet.
        assert!(scan_reminders(&conn, base).unwrap().is_empty());

        // T-1h: only the 1-hour advance reminder.
        let fired = scan_reminders(&conn, due - chrono::Duration::hours(1)).unwrap();
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].kind, ReminderKind::Advance1h);
        assert_eq!(fired[0].task_title, "按时任务");
        assert_eq!(fired[0].due_at, due);

        // T-5m: the 10-minute advance reminder (1h is already marked).
        let fired = scan_reminders(&conn, due - chrono::Duration::minutes(5)).unwrap();
        assert_eq!(
            fired.iter().map(|r| r.kind).collect::<Vec<_>>(),
            vec![ReminderKind::Advance10m]
        );

        // T-0: the due reminder; advances never fire once overdue.
        let fired = scan_reminders(&conn, due).unwrap();
        assert_eq!(
            fired.iter().map(|r| r.kind).collect::<Vec<_>>(),
            vec![ReminderKind::Due]
        );

        // Everything has fired: rescans are no-ops, even past the due time.
        assert!(scan_reminders(&conn, due + chrono::Duration::hours(1))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn scan_reminders_skips_completed_deleted_and_stale_backlog() {
        let conn = conn();
        let base = Utc.with_ymd_and_hms(2026, 9, 11, 12, 0, 0).unwrap();
        let due = base + chrono::Duration::minutes(30);

        let done = make_due_task(&conn, "已完成任务", due);
        complete_task(&conn, done.id).unwrap();
        let gone = make_due_task(&conn, "已删除任务", due);
        soft_delete_task(&conn, gone.id).unwrap();
        make_due_task(&conn, "窗口内逾期", base - chrono::Duration::hours(2));
        make_due_task(&conn, "陈年逾期", base - chrono::Duration::days(3));

        let fired = scan_reminders(&conn, base).unwrap();
        let titles: Vec<&str> = fired.iter().map(|r| r.task_title.as_str()).collect();
        assert_eq!(titles, vec!["窗口内逾期"]);
        assert!(fired.iter().all(|r| r.kind == ReminderKind::Due));

        // The stale backlog stays unmarked but never fires later either.
        assert!(scan_reminders(&conn, base + chrono::Duration::hours(1))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn scan_reminders_catches_up_only_the_due_reminder_after_downtime() {
        // The app was closed through the whole advance window: reopening
        // fires just the due reminder, never a stale "in 1 hour" one.
        let conn = conn();
        let base = Utc.with_ymd_and_hms(2026, 9, 11, 12, 0, 0).unwrap();
        make_due_task(&conn, "停机任务", base - chrono::Duration::minutes(5));

        let fired = scan_reminders(&conn, base).unwrap();
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].kind, ReminderKind::Due);
    }

    #[test]
    fn child_due_dates_fire_their_own_reminders() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let due = Utc.with_ymd_and_hms(2026, 9, 9, 12, 0, 0).unwrap();
        let child = create_task(
            &conn,
            NewTask {
                parent_task_id: Some(parent.id),
                due_at: Some(due),
                ..make_new_task("收集数据")
            },
        )
        .unwrap();

        let fired = scan_reminders(&conn, due - chrono::Duration::minutes(60)).unwrap();

        let mine = fired
            .iter()
            .find(|reminder| reminder.task_id == child.id)
            .unwrap();
        assert_eq!(
            mine.task_title, "收集数据",
            "the reminder names the child itself"
        );
        assert!(fired.iter().all(|reminder| reminder.task_id != parent.id));
    }

    #[test]
    fn completing_the_parent_no_longer_silences_its_children() {
        // Replaces `completing_the_parent_stops_its_subtask_reminders` (§9.3).
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let due = Utc.with_ymd_and_hms(2026, 9, 9, 12, 0, 0).unwrap();
        let child = create_task(
            &conn,
            NewTask {
                parent_task_id: Some(parent.id),
                due_at: Some(due),
                ..make_new_task("收集数据")
            },
        )
        .unwrap();

        complete_task(&conn, parent.id).unwrap();
        let fired = scan_reminders(&conn, due - chrono::Duration::minutes(60)).unwrap();

        assert!(
            fired.iter().any(|reminder| reminder.task_id == child.id),
            "a child keeps its own schedule (§9.3)"
        );
    }

    #[test]
    fn a_soft_deleted_parent_takes_its_children_out_of_the_scan() {
        let conn = conn();
        let parent = make_task(&conn, "写周报");
        let due = Utc.with_ymd_and_hms(2026, 9, 9, 12, 0, 0).unwrap();
        let child = create_task(
            &conn,
            NewTask {
                parent_task_id: Some(parent.id),
                due_at: Some(due),
                ..make_new_task("收集数据")
            },
        )
        .unwrap();

        soft_delete_task(&conn, parent.id).unwrap();
        let fired = scan_reminders(&conn, due - chrono::Duration::minutes(60)).unwrap();

        assert!(fired.iter().all(|reminder| reminder.task_id != child.id));
    }

    #[test]
    fn comment_crud_validates_and_soft_deletes() {
        let conn = conn();
        let task = make_task(&conn, "被评论的任务");

        // Unknown task and blank body are rejected.
        let err = create_comment(
            &conn,
            Uuid::new_v4(),
            NewComment {
                body: "你好".into(),
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_found");
        let err = create_comment(&conn, task.id, NewComment { body: "   ".into() }).unwrap_err();
        assert_eq!(err.code(), "validation");

        let comment = create_comment(
            &conn,
            task.id,
            NewComment {
                body: "  第一条评论  ".into(),
            },
        )
        .unwrap();
        assert_eq!(comment.body, "第一条评论");
        assert_eq!(list_comments(&conn, task.id).unwrap()[0].body, "第一条评论");

        let edited = update_comment(
            &conn,
            comment.id,
            UpdateComment {
                body: "修订后的评论".into(),
            },
        )
        .unwrap();
        assert_eq!(edited.body, "修订后的评论");

        delete_comment(&conn, comment.id).unwrap();
        assert_eq!(list_comments(&conn, task.id).unwrap().len(), 0);
        assert_eq!(
            delete_comment(&conn, comment.id).unwrap_err().code(),
            "not_found"
        );
        assert_eq!(
            update_comment(&conn, comment.id, UpdateComment { body: "x".into() })
                .unwrap_err()
                .code(),
            "not_found"
        );
    }

    #[test]
    fn comments_created_through_the_service_are_searchable() {
        let conn = conn();
        let task = make_task(&conn, "整理季度回顾");
        create_comment(
            &conn,
            task.id,
            NewComment {
                body: "记得附上留存率曲线图".into(),
            },
        )
        .unwrap();

        let hits = search(&conn, "留存率曲线").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, SearchHitKind::Comment);
        assert_eq!(hits[0].task_id, task.id);

        // Deleting the comment removes it from the search scope.
        delete_comment(&conn, hits[0].id).unwrap();
        assert!(search(&conn, "留存率曲线").unwrap().is_empty());
    }

    #[test]
    fn next_due_advances_one_period_with_month_end_clamping() {
        let rule = |freq: RepeatFreq, interval: u32| RepeatRule {
            freq,
            interval,
            paused: false,
        };
        let due = Utc.with_ymd_and_hms(2026, 1, 31, 9, 0, 0).unwrap();

        assert_eq!(
            next_due(due, &rule(RepeatFreq::Daily, 3)),
            due + chrono::Duration::days(3)
        );
        assert_eq!(
            next_due(due, &rule(RepeatFreq::Weekly, 2)),
            due + chrono::Duration::weeks(2)
        );
        // Jan 31 + 1 month clamps to Feb 28.
        assert_eq!(
            next_due(due, &rule(RepeatFreq::Monthly, 1)),
            Utc.with_ymd_and_hms(2026, 2, 28, 9, 0, 0).unwrap()
        );
    }

    /// Completing an overdue repeat must not hand the user an instance that is
    /// already late: it lands on the first occurrence after the completion.
    #[test]
    fn a_late_completion_schedules_the_next_instance_in_the_future() {
        let rule = RepeatRule {
            freq: RepeatFreq::Daily,
            interval: 1,
            paused: false,
        };
        let due = Utc.with_ymd_and_hms(2026, 1, 1, 9, 0, 0).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 1, 8, 10, 0, 0).unwrap();

        let (next, periods) = next_due_after(due, &rule, now);

        assert_eq!(next, Utc.with_ymd_and_hms(2026, 1, 9, 9, 0, 0).unwrap());
        assert_eq!(
            periods, 8,
            "seven days late, so eight periods from the anchor"
        );
        assert!(next > now);
    }

    #[test]
    fn an_on_time_completion_still_moves_exactly_one_period() {
        let rule = RepeatRule {
            freq: RepeatFreq::Weekly,
            interval: 2,
            paused: false,
        };
        let due = Utc.with_ymd_and_hms(2026, 1, 1, 9, 0, 0).unwrap();

        // Completed before the instance came due: nothing to catch up on.
        let (next, periods) = next_due_after(due, &rule, due - chrono::Duration::hours(3));

        assert_eq!(next, due + chrono::Duration::weeks(2));
        assert_eq!(periods, 1);
    }

    /// The anchor still advances a period at a time, so the month-end clamp
    /// compounds (Jan 31 → Feb 28 → Mar 28) instead of jumping back to the 31st.
    #[test]
    fn monthly_catch_up_walks_period_by_period() {
        let rule = RepeatRule {
            freq: RepeatFreq::Monthly,
            interval: 1,
            paused: false,
        };
        let due = Utc.with_ymd_and_hms(2026, 1, 31, 9, 0, 0).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 3, 15, 9, 0, 0).unwrap();

        let (next, periods) = next_due_after(due, &rule, now);

        assert_eq!(next, Utc.with_ymd_and_hms(2026, 3, 28, 9, 0, 0).unwrap());
        assert_eq!(periods, 2);
    }

    #[test]
    fn repeat_rules_validate_on_create_and_update() {
        let conn = conn();
        let zero_interval = RepeatRule {
            freq: RepeatFreq::Daily,
            interval: 0,
            paused: false,
        };
        let err = create_task(
            &conn,
            NewTask {
                title: "规则任务".into(),
                note: None,
                priority: None,
                project_id: None,
                column_id: None,
                due_at: None,
                tag_ids: Vec::new(),
                subtask_titles: Vec::new(),
                repeat_rule: Some(zero_interval),
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "validation");

        let rule = RepeatRule {
            freq: RepeatFreq::Weekly,
            interval: 2,
            paused: false,
        };
        let task = make_task(&conn, "每周任务");
        let updated = update_task(
            &conn,
            task.id,
            UpdateTask {
                title: None,
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Set(Some(rule)),
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(updated.repeat_rule, Some(rule));

        // A zero interval cannot sneak in through an update either.
        let err = update_task(
            &conn,
            task.id,
            UpdateTask {
                title: None,
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Set(Some(RepeatRule {
                    freq: RepeatFreq::Daily,
                    interval: 0,
                    paused: false,
                })),
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "validation");

        // Cancelling the rule clears it without touching the task.
        let cleared = update_task(
            &conn,
            task.id,
            UpdateTask {
                title: None,
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Set(None),
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(cleared.repeat_rule, None);
    }

    #[test]
    fn completing_a_repeating_task_spawns_the_next_instance() {
        let conn = conn();
        let tag = create_tag(
            &conn,
            NewTag {
                name: "家务".into(),
                color: None,
            },
        )
        .unwrap();
        // Far enough ahead that this instance is not overdue: the catch-up path
        // (QA-13) has its own test below.
        let due = Utc::now() + chrono::Duration::days(1);
        let rule = RepeatRule {
            freq: RepeatFreq::Daily,
            interval: 1,
            paused: false,
        };

        let first = create_task(
            &conn,
            NewTask {
                title: "倒垃圾".into(),
                note: Some("可回收分开".into()),
                priority: Some(Priority::Low),
                project_id: None,
                column_id: None,
                due_at: Some(due),
                tag_ids: vec![tag.id],
                subtask_titles: vec!["套新垃圾袋".into()],
                repeat_rule: Some(rule),
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap();

        let completed = complete_task(&conn, first.id).unwrap();
        assert!(completed.completed_at.is_some());

        // The next instance carries everything over, uncompleted and due one
        // period later, placed after the completed original. Only top-level
        // rows count here: the copied child is a task row of its own.
        let top_level = |conn: &Connection| -> Vec<Task> {
            tasks::list(conn)
                .unwrap()
                .into_iter()
                .filter(|task| task.parent_task_id.is_none())
                .collect()
        };
        let listed = top_level(&conn);
        assert_eq!(listed.len(), 2);
        let next = &listed[1];
        assert_eq!(next.title, "倒垃圾");
        assert_eq!(next.note.as_deref(), Some("可回收分开"));
        assert_eq!(next.priority, Priority::Low);
        assert_eq!(next.completed_at, None);
        assert_eq!(next.due_at, Some(due + chrono::Duration::days(1)));
        assert_eq!(next.repeat_rule, Some(rule));
        let next_tag_ids: Vec<Uuid> = task_tags::list_tags_for_task(&conn, next.id)
            .unwrap()
            .iter()
            .map(|tag| tag.id)
            .collect();
        assert_eq!(next_tag_ids, vec![tag.id]);
        let next_subtasks = tasks::list_by_parent(&conn, next.id).unwrap();
        assert_eq!(next_subtasks.len(), 1);
        assert_eq!(next_subtasks[0].completed_at, None);
        assert_eq!(next_subtasks[0].title, "套新垃圾袋");

        // Completing the instance spawns the following one; every completed
        // generation stays completed (original + first instance).
        complete_task(&conn, next.id).unwrap();
        let listed = top_level(&conn);
        assert_eq!(listed.len(), 3);
        assert_eq!(listed[2].due_at, Some(due + chrono::Duration::days(2)));
        assert_eq!(completed_task_count(&conn), 2);
    }

    #[test]
    fn completing_an_overdue_repeat_lands_the_next_instance_in_the_future() {
        let conn = conn();
        let now = Utc::now();
        let due = now - chrono::Duration::days(5);
        let rule = RepeatRule {
            freq: RepeatFreq::Daily,
            interval: 1,
            paused: false,
        };
        let task = create_task(
            &conn,
            NewTask {
                due_at: Some(due),
                repeat_rule: Some(rule),
                ..make_new_task("每日复盘")
            },
        )
        .unwrap();
        // A child due two hours before its parent keeps that offset.
        create_task(
            &conn,
            NewTask {
                due_at: Some(due - chrono::Duration::hours(2)),
                parent_task_id: Some(task.id),
                ..make_new_task("看数据")
            },
        )
        .unwrap();

        complete_task(&conn, task.id).unwrap();

        let spawned = list_tasks(&conn)
            .unwrap()
            .into_iter()
            .find(|candidate| {
                candidate.task.parent_task_id.is_none() && candidate.task.id != task.id
            })
            .expect("the repeat instance must exist")
            .task;
        let spawned_due = spawned.due_at.expect("the instance keeps a due date");
        assert!(
            spawned_due > now,
            "a late completion must not hand back an overdue instance: {spawned_due}"
        );

        let copied = tasks::list_by_parent(&conn, spawned.id).unwrap();
        assert_eq!(
            copied[0].due_at,
            Some(spawned_due - chrono::Duration::hours(2)),
            "a copied subtask advances the same number of periods as its parent"
        );
    }

    #[test]
    fn repeat_instance_copies_subtask_attributes_and_shifts_their_dates() {
        let conn = conn();
        let due = Utc.with_ymd_and_hms(2026, 9, 20, 9, 0, 0).unwrap();
        let task = create_task(
            &conn,
            NewTask {
                due_at: Some(due),
                repeat_rule: Some(RepeatRule {
                    freq: RepeatFreq::Weekly,
                    interval: 1,
                    paused: false,
                }),
                complexity: Some(4),
                ..make_new_task("每周复盘")
            },
        )
        .unwrap();
        let subtask = create_task(
            &conn,
            NewTask {
                note: Some("看漏斗".into()),
                priority: Some(Priority::Low),
                due_at: Some(due),
                complexity: Some(3),
                parent_task_id: Some(task.id),
                ..make_new_task("整理指标")
            },
        )
        .unwrap();
        complete_task(&conn, subtask.id).unwrap();

        let next = complete_task(&conn, task.id).unwrap();
        assert!(next.completed_at.is_some());

        let spawned = list_tasks(&conn)
            .unwrap()
            .into_iter()
            .find(|candidate| {
                candidate.task.parent_task_id.is_none() && candidate.task.id != task.id
            })
            .expect("the repeat instance must exist")
            .task;
        assert_eq!(
            spawned.complexity,
            Some(4),
            "a repeat instance keeps the task's complexity"
        );
        assert_eq!(
            spawned.parent_task_id, task.parent_task_id,
            "§9.5: a repeat instance inherits its parent link"
        );
        let copied = tasks::list_by_parent(&conn, spawned.id).unwrap();
        assert_eq!(copied.len(), 1);
        assert_eq!(copied[0].note.as_deref(), Some("看漏斗"));
        assert_eq!(copied[0].priority, Priority::Low);
        assert_eq!(copied[0].complexity, Some(3));
        assert_eq!(
            copied[0].completed_at, None,
            "a fresh instance starts uncompleted"
        );
        assert_eq!(
            copied[0].due_at,
            Some(due + chrono::Duration::weeks(1)),
            "a copied subtask's due date advances with the parent"
        );
    }

    fn completed_task_count(conn: &Connection) -> usize {
        tasks::list(conn)
            .unwrap()
            .into_iter()
            .filter(|t| t.completed_at.is_some())
            .count()
    }

    #[test]
    fn paused_rules_and_missing_due_dates_spawn_nothing() {
        let conn = conn();
        let base = Utc.with_ymd_and_hms(2026, 9, 11, 9, 0, 0).unwrap();
        let paused_rule = RepeatRule {
            freq: RepeatFreq::Daily,
            interval: 1,
            paused: true,
        };
        let active_rule = RepeatRule {
            freq: RepeatFreq::Daily,
            interval: 1,
            paused: false,
        };

        let paused = make_due_task_with_rule(&conn, "已暂停", base, paused_rule);
        complete_task(&conn, paused.id).unwrap();
        assert_eq!(tasks::list(&conn).unwrap().len(), 1);

        let undated = make_task(&conn, "无截止的重复");
        update_task(
            &conn,
            undated.id,
            UpdateTask {
                title: None,
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Set(Some(active_rule)),
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap();
        complete_task(&conn, undated.id).unwrap();
        assert_eq!(tasks::list(&conn).unwrap().len(), 2);

        // Un-pausing the rule resumes generation on the next completion.
        let resumed = make_due_task_with_rule(&conn, "恢复后生成", base, paused_rule);
        update_task(
            &conn,
            resumed.id,
            UpdateTask {
                title: None,
                note: Patch::Unchanged,
                priority: None,
                project_id: Patch::Unchanged,
                column_id: Patch::Unchanged,
                due_at: Patch::Unchanged,
                completed_at: Patch::Unchanged,
                tag_ids: None,
                repeat_rule: Patch::Set(Some(active_rule)),
                complexity: Patch::Unchanged,
                parent_task_id: Patch::Unchanged,
            },
        )
        .unwrap();
        complete_task(&conn, resumed.id).unwrap();
        let listed = tasks::list(&conn).unwrap();
        assert_eq!(listed.len(), 4);
        assert_eq!(listed[3].title, "恢复后生成");
    }

    fn make_due_task_with_rule(
        conn: &Connection,
        title: &str,
        due: DateTime<Utc>,
        rule: RepeatRule,
    ) -> Task {
        create_task(
            conn,
            NewTask {
                title: title.into(),
                note: None,
                priority: None,
                project_id: None,
                column_id: None,
                due_at: Some(due),
                tag_ids: Vec::new(),
                subtask_titles: Vec::new(),
                repeat_rule: Some(rule),
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap()
    }

    #[test]
    fn board_completion_spawns_the_instance_into_the_previous_column() {
        let conn = conn();
        let project = make_project(&conn, "重复项目");
        let todo = first_column(&conn, project.id);
        let done = done_column(&conn, project.id);
        let due = Utc.with_ymd_and_hms(2026, 9, 14, 9, 0, 0).unwrap();
        let rule = RepeatRule {
            freq: RepeatFreq::Weekly,
            interval: 1,
            paused: false,
        };
        let recurring = create_task(
            &conn,
            NewTask {
                title: "周例会准备".into(),
                note: None,
                priority: None,
                project_id: Some(project.id),
                column_id: Some(todo.id),
                due_at: Some(due),
                tag_ids: Vec::new(),
                subtask_titles: Vec::new(),
                repeat_rule: Some(rule),
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap();

        // Dragging the task into the done column completes it and drops the
        // next week's instance back into the todo column. (A move needs a
        // slot key; anchor at the end of the done column.)
        let anchor = make_column_task(&conn, &done, "完成锚点");
        let moved = move_task(
            &conn,
            recurring.id,
            done.id,
            Some(anchor.sort_order.clone()),
            None,
        )
        .unwrap();
        assert!(moved.moved.task.completed_at.is_some());
        assert_eq!(moved.moved.task.column_id, Some(done.id));

        let listed = tasks::list(&conn).unwrap();
        assert_eq!(listed.len(), 3);
        let next = listed
            .iter()
            .find(|t| t.column_id == Some(todo.id))
            .expect("instance spawned into the todo column");
        assert_eq!(next.title, "周例会准备");
        assert_eq!(next.column_id, Some(todo.id));
        assert_eq!(next.project_id, Some(project.id));
        assert_eq!(next.completed_at, None);
        assert_eq!(next.due_at, Some(due + chrono::Duration::weeks(1)));

        // Moving within the done column is not a completion: no extra spawn.
        let already_done = make_column_task(&conn, &done, "已在完成列");
        let moved_within = move_task(
            &conn,
            already_done.id,
            done.id,
            Some(moved.moved.task.sort_order.clone()),
            None,
        )
        .unwrap();
        assert!(moved_within.moved.task.completed_at.is_some());
        // The within-done move completed the fresh task but spawned nothing
        // (no rule): the board still holds exactly four tasks.
        assert_eq!(tasks::list(&conn).unwrap().len(), 4);
    }

    #[test]
    fn manual_time_entries_validate_and_derive_their_end() {
        let conn = conn();
        let task = make_task(&conn, "写方案");
        let started = Utc.with_ymd_and_hms(2026, 9, 9, 9, 0, 0).unwrap();

        // Unknown task and a non-positive duration are both rejected.
        let err = create_time_entry(
            &conn,
            Uuid::new_v4(),
            NewTimeEntry {
                started_at: started,
                duration: 600,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_found");
        let err = create_time_entry(
            &conn,
            task.id,
            NewTimeEntry {
                started_at: started,
                duration: 0,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "validation");

        // A manual entry's end is derived from start + duration.
        let entry = create_time_entry(
            &conn,
            task.id,
            NewTimeEntry {
                started_at: started,
                duration: 600,
            },
        )
        .unwrap();
        assert_eq!(
            entry.ended_at,
            Some(started + chrono::Duration::seconds(600))
        );

        // Editing the length rewrites the derived end.
        let edited = update_time_entry(
            &conn,
            entry.id,
            UpdateTimeEntry {
                started_at: None,
                duration: Some(1800),
            },
        )
        .unwrap();
        assert_eq!(edited.duration, 1800);
        assert_eq!(
            edited.ended_at,
            Some(started + chrono::Duration::seconds(1800))
        );
        assert_eq!(list_time_entries(&conn, task.id).unwrap(), vec![edited]);

        delete_time_entry(&conn, entry.id).unwrap();
        assert!(list_time_entries(&conn, task.id).unwrap().is_empty());
        assert_eq!(
            delete_time_entry(&conn, entry.id).unwrap_err().code(),
            "not_found"
        );
    }

    #[test]
    fn timer_start_and_stop_records_elapsed_seconds() {
        let conn = conn();
        let task = make_task(&conn, "计时任务");

        let running = start_time_entry(&conn, task.id).unwrap();
        assert!(running.started_at.is_some());
        assert_eq!(running.ended_at, None);
        assert_eq!(running.duration, 0);
        // Starting twice is idempotent: the same running timer comes back.
        assert_eq!(start_time_entry(&conn, task.id).unwrap().id, running.id);

        // Backdate the stored start by two minutes — what a real two-minute
        // run leaves behind — so `stop` can be asserted exactly.
        conn.execute(
            "UPDATE time_entries SET started_at = ?1 WHERE id = ?2",
            params![
                Utc::now() - chrono::Duration::seconds(120),
                running.id.to_string()
            ],
        )
        .unwrap();

        let stopped = stop_time_entry(&conn, running.id).unwrap();
        assert_eq!(stopped.duration, 120);
        assert!(stopped.ended_at.is_some());
        assert_eq!(list_time_entries(&conn, task.id).unwrap()[0].duration, 120);

        // A stopped timer cannot be stopped again, and an unknown task cannot
        // be timed at all.
        assert_eq!(
            stop_time_entry(&conn, running.id).unwrap_err().code(),
            "validation"
        );
        assert_eq!(
            start_time_entry(&conn, Uuid::new_v4()).unwrap_err().code(),
            "not_found"
        );
    }

    #[test]
    fn list_running_time_entries_returns_only_open_timers() {
        let conn = conn();
        let first = make_task(&conn, "计时一");
        let second = make_task(&conn, "计时二");

        // No timer on anywhere: the list's 开始 buttons all start idle.
        assert!(list_running_time_entries(&conn).unwrap().is_empty());

        let a = start_time_entry(&conn, first.id).unwrap();
        let b = start_time_entry(&conn, second.id).unwrap();
        assert_eq!(
            list_running_time_entries(&conn)
                .unwrap()
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec![a.id, b.id]
        );

        // A stopped timer drops out; a soft-deleted running one does too, or
        // the row would keep painting 暂停 for a timer nobody can stop.
        stop_time_entry(&conn, a.id).unwrap();
        assert_eq!(
            list_running_time_entries(&conn)
                .unwrap()
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec![b.id]
        );
        delete_time_entry(&conn, b.id).unwrap();
        assert!(list_running_time_entries(&conn).unwrap().is_empty());
    }

    /// Task factory with a project/tag set, hitting the real create path.
    fn make_task_in(
        conn: &Connection,
        project_id: Option<Uuid>,
        tag_ids: Vec<Uuid>,
        title: &str,
    ) -> Task {
        create_task(
            conn,
            NewTask {
                title: title.into(),
                note: None,
                priority: None,
                project_id,
                column_id: None,
                due_at: None,
                tag_ids,
                subtask_titles: Vec::new(),
                repeat_rule: None,
                complexity: None,
                parent_task_id: None,
            },
        )
        .unwrap()
    }

    /// Backdates a completion stamp: the create/complete paths always write
    /// "now", so bucket assertions need an explicit instant.
    fn complete_at(conn: &Connection, task: &Task, instant: DateTime<Utc>) -> Task {
        conn.execute(
            "UPDATE tasks SET completed_at = ?1 WHERE id = ?2",
            params![instant, task.id.to_string()],
        )
        .unwrap();
        tasks::get(conn, task.id).unwrap().unwrap()
    }

    fn make_entry(
        conn: &Connection,
        task_id: Uuid,
        started_at: DateTime<Utc>,
        duration: i64,
    ) -> TimeEntry {
        create_time_entry(
            conn,
            task_id,
            NewTimeEntry {
                started_at,
                duration,
            },
        )
        .unwrap()
    }

    /// A September 2026 instant; 09-07 is a Monday, so 09-09/09-10/09-13 all
    /// fall in its week and 09-14 opens the next one.
    fn at(day: u32, hour: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, day, hour, 0, 0).unwrap()
    }

    fn trend_query(
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        granularity: StatsGranularity,
        offset_minutes: i32,
    ) -> TrendQuery {
        TrendQuery {
            from,
            to,
            granularity,
            offset_minutes,
        }
    }

    fn distribution_query(
        group_by: TimeGroupBy,
        granularity: StatsGranularity,
        offset_minutes: i32,
    ) -> TimeDistributionQuery {
        TimeDistributionQuery {
            group_by,
            from: at(8, 0),
            to: at(11, 0),
            granularity,
            offset_minutes,
        }
    }

    #[test]
    fn trend_buckets_completions_in_the_callers_calendar() {
        let conn = conn();
        complete_at(&conn, &make_task(&conn, "A"), at(9, 0)); // +08: 09-09 08:00
        complete_at(&conn, &make_task(&conn, "B"), at(8, 20)); // +08: 09-09 04:00
        complete_at(&conn, &make_task(&conn, "C"), at(10, 12)); // +08: 09-10 20:00
                                                                // Outside the range, and reopened tasks never count.
        complete_at(&conn, &make_task(&conn, "D"), at(20, 12));
        let reopened = make_task(&conn, "E");
        complete_at(&conn, &reopened, at(9, 12));
        conn.execute(
            "UPDATE tasks SET completed_at = NULL WHERE id = ?1",
            params![reopened.id.to_string()],
        )
        .unwrap();

        let (from, to) = (at(8, 0), at(11, 0));
        let day =
            completion_trend(&conn, trend_query(from, to, StatsGranularity::Day, 480)).unwrap();
        assert_eq!(
            day,
            vec![
                TrendPoint {
                    bucket: "2026-09-09".into(),
                    completed: 2
                },
                TrendPoint {
                    bucket: "2026-09-10".into(),
                    completed: 1
                },
            ]
        );

        // The same rows bucket differently in UTC — which is what the offset
        // is for.
        let utc = completion_trend(&conn, trend_query(from, to, StatsGranularity::Day, 0)).unwrap();
        assert_eq!(
            utc.iter()
                .map(|point| (point.bucket.as_str(), point.completed))
                .collect::<Vec<_>>(),
            vec![("2026-09-08", 1), ("2026-09-09", 1), ("2026-09-10", 1)]
        );

        let week =
            completion_trend(&conn, trend_query(from, to, StatsGranularity::Week, 480)).unwrap();
        assert_eq!(
            week,
            vec![TrendPoint {
                bucket: "2026-09-07".into(),
                completed: 3
            }]
        );

        let month =
            completion_trend(&conn, trend_query(from, to, StatsGranularity::Month, 480)).unwrap();
        assert_eq!(
            month,
            vec![TrendPoint {
                bucket: "2026-09".into(),
                completed: 3
            }]
        );

        // An empty range is an empty curve, not an error.
        let empty = completion_trend(
            &conn,
            trend_query(at(1, 0), at(2, 0), StatsGranularity::Day, 0),
        )
        .unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn trend_counts_top_level_tasks_only() {
        let conn = conn();
        let parent = make_task(&conn, "父任务");
        let child = make_child(&conn, &parent, "子任务");
        complete_at(&conn, &child, at(9, 10));
        let done_parent = make_task(&conn, "完成的顶层任务");
        complete_at(&conn, &done_parent, at(9, 20));

        let points = completion_trend(
            &conn,
            trend_query(at(9, 0), at(10, 0), StatsGranularity::Day, 0),
        )
        .unwrap();

        let total: i64 = points.iter().map(|point| point.completed).sum();
        assert_eq!(
            total, 1,
            "a child is a breakdown inside its parent, not a second completion"
        );
    }

    #[test]
    fn project_progress_counts_live_tasks_and_skips_archived_projects() {
        let conn = conn();
        let alpha = make_project(&conn, "Alpha");
        let beta = make_project(&conn, "Beta");
        let old = make_project(&conn, "旧项目");
        archive_project(&conn, old.id).unwrap();

        make_task_in(&conn, Some(alpha.id), Vec::new(), "待办一");
        let done = make_task_in(&conn, Some(alpha.id), Vec::new(), "已完成");
        complete_at(&conn, &done, at(9, 12));
        let removed = make_task_in(&conn, Some(alpha.id), Vec::new(), "已删除");
        soft_delete_task(&conn, removed.id).unwrap();
        // Inbox tasks belong to no project and stay out of the comparison.
        make_task_in(&conn, None, Vec::new(), "收件箱");

        let progress = project_progress(&conn).unwrap();
        assert_eq!(
            progress.len(),
            2,
            "archived projects are out of the picture"
        );
        assert_eq!(
            progress[0],
            ProjectProgress {
                project_id: alpha.id,
                name: "Alpha".into(),
                total: 2,
                completed: 1,
            }
        );
        assert_eq!(progress[1].project_id, beta.id);
        assert_eq!((progress[1].total, progress[1].completed), (0, 0));
    }

    #[test]
    fn project_progress_counts_top_level_tasks_only() {
        let conn = conn();
        let project = make_project(&conn, "网站改版");
        let parent = make_task_in(&conn, Some(project.id), Vec::new(), "顶层任务");
        let child = make_child(&conn, &parent, "子任务");
        complete_at(&conn, &child, at(9, 12));

        let progress = project_progress(&conn).unwrap();

        assert_eq!(
            (progress[0].total, progress[0].completed),
            (1, 0),
            "a child rides inside its parent's count, and its completion is not the parent's"
        );
    }

    #[test]
    fn time_distribution_splits_by_project_tag_and_period() {
        let conn = conn();
        let alpha = make_project(&conn, "Alpha");
        let work = create_tag(
            &conn,
            NewTag {
                name: "工作".into(),
                color: None,
            },
        )
        .unwrap();
        let private = create_tag(
            &conn,
            NewTag {
                name: "私人".into(),
                color: None,
            },
        )
        .unwrap();

        let both = make_task_in(&conn, Some(alpha.id), vec![work.id, private.id], "双标签");
        let work_only = make_task_in(&conn, Some(alpha.id), vec![work.id], "单标签");
        let inbox = make_task_in(&conn, None, vec![work.id], "收件箱");

        make_entry(&conn, both.id, at(9, 1), 3600); // +08: 09-09 09:00
        make_entry(&conn, work_only.id, at(8, 20), 1800); // +08: 09-09 04:00
        make_entry(&conn, inbox.id, at(10, 12), 600); // +08: 09-10 20:00
        let dropped = make_entry(&conn, both.id, at(9, 5), 999);
        delete_time_entry(&conn, dropped.id).unwrap();

        let by_project = time_distribution(
            &conn,
            distribution_query(TimeGroupBy::Project, StatsGranularity::Day, 480),
        )
        .unwrap();
        assert_eq!(
            by_project.groups,
            vec![
                TimeShare {
                    id: Some(alpha.id),
                    name: Some("Alpha".into()),
                    seconds: 5400
                },
                TimeShare {
                    id: None,
                    name: None,
                    seconds: 600
                },
            ]
        );
        assert_eq!(
            by_project.buckets,
            vec![
                TimePoint {
                    bucket: "2026-09-09".into(),
                    seconds: 5400
                },
                TimePoint {
                    bucket: "2026-09-10".into(),
                    seconds: 600
                },
            ]
        );

        // A two-tag task counts its time under both tags.
        let by_tag = time_distribution(
            &conn,
            distribution_query(TimeGroupBy::Tag, StatsGranularity::Month, 480),
        )
        .unwrap();
        assert_eq!(
            by_tag.groups,
            vec![
                TimeShare {
                    id: Some(work.id),
                    name: Some("工作".into()),
                    seconds: 6000
                },
                TimeShare {
                    id: Some(private.id),
                    name: Some("私人".into()),
                    seconds: 3600
                },
            ]
        );
        assert_eq!(
            by_tag.buckets,
            vec![TimePoint {
                bucket: "2026-09".into(),
                seconds: 6000
            }]
        );

        // 09-09 and 09-10 fall in the same Monday-anchored week.
        let weekly = time_distribution(
            &conn,
            distribution_query(TimeGroupBy::Project, StatsGranularity::Week, 480),
        )
        .unwrap();
        assert_eq!(
            weekly.buckets,
            vec![TimePoint {
                bucket: "2026-09-07".into(),
                seconds: 6000
            }]
        );
    }

    #[test]
    fn stats_over_thousands_of_rows_stay_millisecond_level() {
        let conn = conn();
        let project = make_project(&conn, "规模项目");
        let base = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();

        // Raw inserts keep seeding fast; instants go in as `DateTime` params so
        // they are stored in the same form the app writes and compares them in.
        let tx = conn.unchecked_transaction().unwrap();
        for i in 0..3000 {
            let task_id = Uuid::new_v4();
            let completed = (i % 2 == 0).then(|| base + chrono::Duration::hours(i % 1440));
            tx.execute(
                "INSERT INTO tasks (id, project_id, title, priority, completed_at, sort_order, \
                 created_at, updated_at) VALUES (?1, ?2, ?3, 'none', ?4, ?5, ?6, ?6)",
                params![
                    task_id.to_string(),
                    project.id.to_string(),
                    format!("例行任务{i}号"),
                    completed,
                    format!("{i:08}"),
                    base,
                ],
            )
            .unwrap();
            let started = base + chrono::Duration::hours(i % 1440);
            tx.execute(
                "INSERT INTO time_entries (id, task_id, started_at, ended_at, duration, \
                 created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    Uuid::new_v4().to_string(),
                    task_id.to_string(),
                    started,
                    started + chrono::Duration::hours(1),
                    600,
                    base,
                ],
            )
            .unwrap();
        }
        tx.commit().unwrap();

        let to = base + chrono::Duration::days(60);
        let started = std::time::Instant::now();
        let trend =
            completion_trend(&conn, trend_query(base, to, StatsGranularity::Day, 480)).unwrap();
        let trend_elapsed = started.elapsed();
        assert_eq!(trend.iter().map(|point| point.completed).sum::<i64>(), 1500);
        assert!(
            trend_elapsed.as_millis() < 100,
            "trend took {trend_elapsed:?}"
        );

        let started = std::time::Instant::now();
        let progress = project_progress(&conn).unwrap();
        let progress_elapsed = started.elapsed();
        assert_eq!(progress[0].total, 3000);
        assert_eq!(progress[0].completed, 1500);
        assert!(
            progress_elapsed.as_millis() < 100,
            "progress took {progress_elapsed:?}"
        );

        let mut query = distribution_query(TimeGroupBy::Project, StatsGranularity::Day, 480);
        query.from = base;
        query.to = to;
        let started = std::time::Instant::now();
        let distribution = time_distribution(&conn, query).unwrap();
        let distribution_elapsed = started.elapsed();
        assert_eq!(
            distribution
                .buckets
                .iter()
                .map(|point| point.seconds)
                .sum::<i64>(),
            3000 * 600
        );
        assert!(
            distribution_elapsed.as_millis() < 100,
            "distribution took {distribution_elapsed:?}"
        );
    }

    /// A temp file path for the backup round trip; callers remove it.
    fn backup_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("ordo-backup-test-{}.json", Uuid::new_v4()))
    }

    /// One project with a board column, a tagged/commented/timed task, a
    /// subtask, a setting and a soft-deleted task — enough to prove a restore
    /// covers every table.
    fn seed_everything(conn: &Connection) -> Task {
        let project = make_project(conn, "Alpha");
        let namespace = make_namespace(conn, "工作");
        let project = update_project(
            conn,
            project.id,
            UpdateProject {
                name: None,
                description: Patch::Unchanged,
                color: Patch::Unchanged,
                icon: Patch::Unchanged,
                namespace_id: Patch::Set(Some(namespace.id)),
            },
        )
        .unwrap();
        let column = first_column(conn, project.id);
        let tag = create_tag(
            conn,
            NewTag {
                name: "工作".into(),
                color: Some("#3b82f6".into()),
            },
        )
        .unwrap();

        let task = make_task_in(conn, Some(project.id), vec![tag.id], "备份任务");
        conn.execute(
            "UPDATE tasks SET column_id = ?1, note = '备注', priority = 'high', \
             due_at = ?2 WHERE id = ?3",
            params![column.id.to_string(), at(30, 9), task.id.to_string()],
        )
        .unwrap();
        let child = create_task(
            conn,
            NewTask {
                parent_task_id: Some(task.id),
                ..make_new_task("第一步")
            },
        )
        .unwrap();
        // The child follows the parent's project; the task above gets its
        // `column_id` by raw SQL, so mirror that on the child's parent link
        // only — a child never lands on a board.
        assert_eq!(child.column_id, None);
        create_comment(
            conn,
            task.id,
            NewComment {
                body: "写下来免得忘".into(),
            },
        )
        .unwrap();
        make_entry(conn, task.id, at(9, 1), 1800);

        let removed = make_task_in(conn, Some(project.id), Vec::new(), "已删除的任务");
        soft_delete_task(conn, removed.id).unwrap();

        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ('theme', 'dark', ?1)",
            params![at(9, 0)],
        )
        .unwrap();

        tasks::get(conn, task.id).unwrap().unwrap()
    }

    #[test]
    fn backup_round_trip_restores_every_table() {
        let conn = conn();
        let task = seed_everything(&conn);
        let before = backup::export_all(&conn).unwrap();
        let path = backup_path();

        let exported = export_backup(&conn, &path).unwrap();
        assert_eq!(exported.path, path.to_string_lossy());
        assert_eq!(
            (
                exported.counts.namespaces,
                exported.counts.projects,
                exported.counts.board_columns,
                exported.counts.tasks,
                exported.counts.tags,
                exported.counts.subtasks,
                exported.counts.comments,
                exported.counts.time_entries,
                exported.counts.settings,
            ),
            // `tasks` counts every task row (children included), `subtasks`
            // only the child rows among them.
            (1, 1, 3, 3, 1, 1, 1, 1, 1)
        );

        // Restoring into a database that never saw the data reproduces it all,
        // soft-deleted rows included.
        let restored = db::test_conn();
        let summary = import_backup(&restored, &path).unwrap();
        assert_eq!(summary.counts.tasks, 3);
        assert_eq!(summary.counts.subtasks, 1);
        assert_eq!(summary.exported_at, exported.exported_at);
        let mut after = backup::export_all(&restored).unwrap();
        let mut expected = before.clone();
        // The importer writes parents before children, so `tasks` comes back in
        // a different array order; compare by content, not by rowid order.
        after.tasks.sort_by_key(|task| task.id);
        expected.tasks.sort_by_key(|task| task.id);
        assert_eq!(after, expected, "every table survives a backup round trip");
        assert_eq!(
            tasks::get(&restored, task.id).unwrap().unwrap().priority,
            Priority::High
        );
        assert_eq!(tasks::list_by_parent(&restored, task.id).unwrap().len(), 1);
        assert_eq!(list_comments(&restored, task.id).unwrap().len(), 1);
        assert_eq!(list_time_entries(&restored, task.id).unwrap().len(), 1);
        assert_eq!(
            task_tags::list_tags_for_task(&restored, task.id)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            board_columns::list_by_project(&restored, before.projects[0].id)
                .unwrap()
                .len(),
            3
        );

        // The FTS index follows the restored rows without a rebuild.
        let hits = search(&restored, "备份任务").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].task_id, task.id);

        // A second import replaces rather than merges: the task created after
        // the first restore is gone, while the soft-deleted row stayed deleted
        // and therefore stays out of the live list.
        make_task(&restored, "导入之后新增的");
        import_backup(&restored, &path).unwrap();
        // Live rows: the task and its child. The soft-deleted row stayed
        // deleted, so the restore brought back nothing extra.
        assert_eq!(tasks::list(&restored).unwrap().len(), 2);
        assert_eq!(backup::export_all(&restored).unwrap().tasks.len(), 3);
        assert_eq!(
            projects::get(&restored, before.projects[0].id)
                .unwrap()
                .unwrap()
                .namespace_id,
            before.projects[0].namespace_id
        );

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn backup_roundtrips_dependency_edges() {
        let conn = conn();
        let a = make_task(&conn, "A");
        let b = make_task(&conn, "B");
        let first = make_child(&conn, &a, "1");
        let second = make_child(&conn, &a, "2");
        add_dependency(&conn, dependency(a.id, b.id)).unwrap();
        add_dependency(&conn, dependency(first.id, second.id)).unwrap();

        let path = backup_path();
        export_backup(&conn, &path).unwrap();

        // Wiping the edges (rather than the whole database) keeps this test
        // focused: the import has to restore them from the document.
        remove_dependency(&conn, dependency(a.id, b.id)).unwrap();
        remove_dependency(&conn, dependency(first.id, second.id)).unwrap();
        assert!(list_dependencies(&conn).unwrap().is_empty());

        import_backup(&conn, &path).unwrap();
        let restored = list_dependencies(&conn).unwrap();
        assert_eq!(restored.len(), 2);
        // Both edge sets of V4 are one set now: top-level tasks and children
        // travel through the same table.
        assert!(restored
            .iter()
            .any(|edge| edge.dependent_id == a.id && edge.prerequisite_id == b.id));
        assert!(restored
            .iter()
            .any(|edge| edge.dependent_id == first.id && edge.prerequisite_id == second.id));

        // A second import replaces rather than merges — the edge tables
        // included, so an edge added after the restore does not survive it.
        let extra = make_task(&conn, "C");
        add_dependency(&conn, dependency(a.id, extra.id)).unwrap();
        import_backup(&conn, &path).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 2);

        // Dormant edges travel too. With B soft-deleted the A → B edge is out
        // of `dependency:listAll`'s live view but still in the database, and a
        // backup is a copy of the database, not a view of it.
        soft_delete_task(&conn, b.id).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 1);
        export_backup(&conn, &path).unwrap();
        remove_dependency(&conn, dependency(a.id, b.id)).unwrap();
        import_backup(&conn, &path).unwrap();

        // Restoring the endpoint brings the relation back, which only works
        // because the dormant edge came along in the document.
        restore_task(&conn, b.id).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 2);

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn version_one_backups_still_import() {
        let conn = conn();
        // A v1 document predates `dependencies`; `#[serde(default)]` must let it
        // through instead of failing the whole import.
        let document = serde_json::json!({
            "format": BACKUP_FORMAT,
            "version": 1,
            "exportedAt": "2026-01-01T00:00:00Z",
            "data": {
                "projects": [], "boardColumns": [], "tags": [], "tasks": [],
                "subtasks": [], "taskTags": [], "comments": [], "timeEntries": [],
                "settings": []
            }
        });
        let path = backup_path();
        std::fs::write(&path, serde_json::to_string(&document).unwrap()).unwrap();
        import_backup(&conn, &path).unwrap();

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn backup_carries_namespaces_and_refiles_projects() {
        let conn = conn();
        let namespace = make_namespace(&conn, "工作");
        let project = create_project(
            &conn,
            NewProject {
                name: "网站改版".into(),
                description: None,
                color: None,
                icon: None,
                namespace_id: Some(namespace.id),
            },
        )
        .unwrap();
        let path = backup_path();
        export_backup(&conn, &path).unwrap();

        let restored = db::test_conn();
        import_backup(&restored, &path).unwrap();

        assert_eq!(list_namespaces(&restored).unwrap(), vec![namespace.clone()]);
        assert_eq!(
            projects::get(&restored, project.id)
                .unwrap()
                .unwrap()
                .namespace_id,
            Some(namespace.id),
            "the filing survives a round trip"
        );

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn version_two_backups_import_with_every_project_ungrouped() {
        let conn = conn();
        // A v2 document predates `namespaces` and has no `namespaceId` on its
        // projects; `#[serde(default)]` has to carry both.
        let document = serde_json::json!({
            "format": BACKUP_FORMAT,
            "version": 2,
            "exportedAt": "2026-01-01T00:00:00Z",
            "data": {
                "projects": [{
                    "id": "11111111-1111-4111-8111-111111111111",
                    "name": "旧项目",
                    "description": null,
                    "color": null,
                    "icon": null,
                    "dueAt": null,
                    "status": "active",
                    "sortOrder": "a",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "deletedAt": null
                }],
                "boardColumns": [], "tags": [], "tasks": [], "subtasks": [],
                "taskTags": [], "comments": [], "timeEntries": [], "settings": []
            }
        });
        let path = backup_path();
        std::fs::write(&path, serde_json::to_string(&document).unwrap()).unwrap();
        import_backup(&conn, &path).unwrap();

        let imported = list_projects(&conn).unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].namespace_id, None);
        assert!(list_namespaces(&conn).unwrap().is_empty());

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn import_refuses_a_project_filed_under_a_missing_namespace() {
        let conn = conn();
        let existing = make_project(&conn, "已有项目");

        // Only a hand-edited document can get here: the write path validates
        // the reference, so a dangling one means the file was doctored.
        let document = serde_json::json!({
            "format": BACKUP_FORMAT,
            "version": BACKUP_VERSION,
            "exportedAt": "2026-01-01T00:00:00Z",
            "data": {
                "namespaces": [],
                "projects": [{
                    "id": "22222222-2222-4222-8222-222222222222",
                    "name": "悬空项目",
                    "description": null,
                    "color": null,
                    "icon": null,
                    "namespaceId": "33333333-3333-4333-8333-333333333333",
                    "dueAt": null,
                    "status": "active",
                    "sortOrder": "a",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "deletedAt": null
                }],
                "boardColumns": [], "tags": [], "tasks": [], "subtasks": [],
                "taskTags": [], "comments": [], "timeEntries": [], "settings": []
            }
        });
        let path = backup_path();
        std::fs::write(&path, serde_json::to_string(&document).unwrap()).unwrap();

        assert!(import_backup(&conn, &path).is_err());
        assert_eq!(
            list_projects(&conn).unwrap(),
            vec![existing],
            "a refused import changes nothing"
        );

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn import_accepts_backups_written_before_subtasks_had_attributes() {
        let conn = conn();
        let task = seed_everything(&conn);
        let path = backup_path();
        export_backup(&conn, &path).unwrap();

        // Rebuild a pre-V7 document from the export: the child row moves back
        // out of `tasks` into `subtasks`, with the four attribute columns V4
        // introduced simply absent — exactly what an old file looks like.
        let mut document: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let tasks = document["data"]["tasks"].as_array_mut().unwrap();
        let child_index = tasks
            .iter()
            .position(|task| !task["parentTaskId"].is_null())
            .expect("the export carries the child as a task row");
        let mut legacy = tasks.remove(child_index);
        let object = legacy.as_object_mut().unwrap();
        let parent_id = object
            .remove("parentTaskId")
            .expect("the child's parent link");
        object.insert("taskId".into(), parent_id);
        for key in ["note", "priority", "dueAt", "complexity"] {
            assert!(object.remove(key).is_some(), "{key} was in the export");
        }
        document["data"]["subtasks"] = serde_json::json!([legacy]);
        std::fs::write(&path, serde_json::to_string(&document).unwrap()).unwrap();

        let restored = db::test_conn();
        import_backup(&restored, &path).unwrap();
        let imported = tasks::list_by_parent(&restored, task.id).unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(
            imported[0].priority,
            Priority::None,
            "an old row comes back at the column's default"
        );
        assert_eq!(imported[0].note, None);
        assert_eq!(imported[0].complexity, None);
        assert_eq!(
            imported[0].completed_at, None,
            "an absent `done` means not done"
        );

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn import_rejects_foreign_documents_and_missing_files() {
        let conn = conn();
        let path = backup_path();
        std::fs::write(&path, r#"{"format":"something-else","version":1}"#).unwrap();
        assert_eq!(
            import_backup(&conn, &path).unwrap_err().code(),
            "validation"
        );

        std::fs::write(
            &path,
            serde_json::to_string(&serde_json::json!({
                "format": BACKUP_FORMAT,
                "version": BACKUP_VERSION + 1,
                "exportedAt": "2026-09-11T00:00:00Z",
                "data": {}
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            import_backup(&conn, &path).unwrap_err().code(),
            "validation"
        );

        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(
            import_backup(&conn, &path).unwrap_err().code(),
            "validation"
        );

        // A rejected import leaves the data alone.
        let task = seed_everything(&conn);
        assert!(import_backup(&conn, &path).is_err());
        assert!(tasks::get(&conn, task.id).unwrap().is_some());

        std::fs::remove_file(&path).unwrap();
        let missing = backup_path();
        assert_eq!(import_backup(&conn, &missing).unwrap_err().code(), "io");
    }

    #[test]
    fn dependencies_are_added_idempotently_and_listed_live_only() {
        let conn = conn();
        let a = make_task(&conn, "A");
        let b = make_task(&conn, "B");

        let edge = add_dependency(&conn, dependency(a.id, b.id)).unwrap();
        assert_eq!(edge.prerequisite_id, b.id);
        // Adding the same edge twice is a no-op, not an error.
        add_dependency(&conn, dependency(a.id, b.id)).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 1);

        // Soft-deleting the prerequisite hides the edge (A is no longer blocked)
        // but keeps it in the table: restoring brings the relation back.
        soft_delete_task(&conn, b.id).unwrap();
        assert!(list_dependencies(&conn).unwrap().is_empty());
        restore_task(&conn, b.id).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 1);

        // Removing is idempotent too.
        remove_dependency(&conn, dependency(a.id, b.id)).unwrap();
        remove_dependency(&conn, dependency(a.id, b.id)).unwrap();
        assert!(list_dependencies(&conn).unwrap().is_empty());
    }

    #[test]
    fn dependency_edges_are_scoped_and_acyclic() {
        let conn = conn();
        let a = make_task(&conn, "A");
        let b = make_task(&conn, "B");
        let c = make_task(&conn, "C");

        // A → B → C, then C → A would close a three-node cycle.
        add_dependency(&conn, dependency(a.id, b.id)).unwrap();
        add_dependency(&conn, dependency(b.id, c.id)).unwrap();
        assert_eq!(
            add_dependency(&conn, dependency(c.id, a.id))
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            add_dependency(&conn, dependency(a.id, a.id))
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            add_dependency(&conn, dependency(a.id, Uuid::new_v4()))
                .unwrap_err()
                .code(),
            "not_found"
        );

        // Both endpoints must share a parent task; `NULL` counts as a value,
        // so the three top-level tasks above are already one sibling set.
        let other = make_task(&conn, "D");
        let first = make_child(&conn, &a, "1");
        let second = make_child(&conn, &a, "2");
        let foreign = make_child(&conn, &other, "x");
        add_dependency(&conn, dependency(first.id, second.id)).unwrap();
        assert_eq!(
            add_dependency(&conn, dependency(first.id, foreign.id))
                .unwrap_err()
                .code(),
            "validation",
            "children of different parents are not siblings"
        );
        // A child edge and a top-level edge are the same kind of row now:
        // A → B, B → C and first → second.
        assert_eq!(list_dependencies(&conn).unwrap().len(), 3);
        assert!(list_dependencies(&conn)
            .unwrap()
            .iter()
            .any(|edge| edge.dependent_id == first.id && edge.prerequisite_id == second.id));
    }

    #[test]
    fn repeat_instances_do_not_inherit_dependency_edges() {
        let conn = conn();
        let due = Utc.with_ymd_and_hms(2026, 9, 14, 9, 0, 0).unwrap();
        let repeating = create_task(
            &conn,
            NewTask {
                due_at: Some(due),
                repeat_rule: Some(RepeatRule {
                    freq: RepeatFreq::Weekly,
                    interval: 1,
                    paused: false,
                }),
                ..make_new_task("每周复盘")
            },
        )
        .unwrap();
        let prerequisite = make_task(&conn, "准备数据");

        add_dependency(&conn, dependency(repeating.id, prerequisite.id)).unwrap();
        // A child edge too: a copied child would otherwise drag an edge along
        // that points at the previous instance's rows.
        let first = make_child(&conn, &repeating, "1");
        let second = make_child(&conn, &repeating, "2");
        add_dependency(&conn, dependency(first.id, second.id)).unwrap();

        complete_task(&conn, repeating.id).unwrap();

        // The instance is the second task sharing the original's title.
        let spawned = list_tasks(&conn)
            .unwrap()
            .into_iter()
            .find(|candidate| {
                candidate.task.title == "每周复盘" && candidate.task.id != repeating.id
            })
            .expect("the repeat instance must exist")
            .task;
        let mut instance = vec![spawned.id];
        instance.extend(
            tasks::list_by_parent(&conn, spawned.id)
                .unwrap()
                .iter()
                .map(|child| child.id),
        );
        assert_eq!(instance.len(), 3, "the instance carries both children");

        let edges = list_dependencies(&conn).unwrap();
        assert!(
            edges.iter().any(|edge| {
                edge.dependent_id == repeating.id && edge.prerequisite_id == prerequisite.id
            }),
            "the original edge must survive completing the task: {edges:?}"
        );
        assert!(
            edges.iter().all(|edge| {
                !instance.contains(&edge.dependent_id) && !instance.contains(&edge.prerequisite_id)
            }),
            "a repeat instance must inherit no dependency edge: {edges:?}"
        );
    }
}

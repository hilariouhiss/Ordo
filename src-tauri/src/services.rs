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
    BackupDocument, BackupSummary, BoardColumn, Comment, Dependency, DependencyKind,
    NewBoardColumn, NewComment, NewProject, NewSubtask, NewTag, NewTask, NewTimeEntry, Patch,
    Priority, Project, ProjectProgress, ProjectStatus, Reminder, ReminderKind, RepeatFreq,
    RepeatRule, SearchHit, SearchHitKind, Subtask, Tag, Task, TaskWithTags, TimeDistribution,
    TimeDistributionQuery, TimeEntry, TrendPoint, TrendQuery, UpdateBoardColumn, UpdateComment,
    UpdateProject, UpdateSubtask, UpdateTag, UpdateTask, UpdateTimeEntry,
};
use crate::repositories::{
    backup, board_columns, comments, dependencies, projects, reminders, search, stats, subtasks,
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

/// Spawns the next instance of a completed repeating task inside the
/// caller's transaction: one period past the task's due time, carrying over
/// title/note/priority/project/complexity/tags and the rule itself, appended
/// to `column_id`'s scope. Subtasks are copied with their attributes but
/// reset to uncompleted, their due dates advanced by the same period. Repeats
/// anchored to nothing (`due_at = None`) or paused rules complete without
/// spawning.
fn spawn_next_instance(
    conn: &Connection,
    task: &Task,
    column_id: Option<Uuid>,
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

    // Copies keep the subtask's attributes; `due_at` advances by the same
    // period as the parent (a copy whose date stayed put would be born
    // overdue). Dependency edges are deliberately NOT inherited: they would
    // point at the previous instance's rows.
    let originals = subtasks::list_by_task(conn, task.id)?;

    let spawned = create_task_in_tx(
        conn,
        NewTask {
            title: task.title.clone(),
            note: task.note.clone(),
            priority: Some(task.priority),
            project_id: task.project_id,
            column_id,
            due_at: Some(next_due(due, &rule)),
            complexity: task.complexity,
            tag_ids,
            subtask_titles: Vec::new(),
            repeat_rule: Some(rule),
        },
    )?;

    let mut last_key: Option<String> = None;
    for original in originals {
        let key = match &last_key {
            None => sort::first(),
            Some(last) => sort::after(last)?,
        };
        subtasks::insert(
            conn,
            &Subtask {
                id: Uuid::new_v4(),
                task_id: spawned.id,
                title: original.title,
                note: original.note,
                priority: original.priority,
                due_at: original.due_at.map(|date| next_due(date, &rule)),
                complexity: original.complexity,
                done: false,
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

/// An insertion slot resolved from `prev`/`next` against a sibling list.
enum Slot {
    /// A fresh key that fits between the resolved neighbours.
    Key(String),
    /// No key fits (`SortError::Exhausted`): rekey every sibling with evenly
    /// spaced keys, placing the moved item at this index.
    Rebalance(usize),
}

/// Resolves the insertion slot between the neighbour sort keys `prev`/`next`
/// (either side optional at the list ends) within the ordered `siblings`,
/// which must already exclude the moved item.
///
/// One-sided specs are resolved against the current list so the derived
/// neighbour pair is always tight — a bare `after(prev)` mid-list could
/// collide with the actual next item's key.
fn resolve_slot(
    siblings: &[(Uuid, String)],
    prev: Option<String>,
    next: Option<String>,
) -> Result<Slot, AppError> {
    if prev.is_none() && next.is_none() {
        return Err(AppError::Validation("需要提供前驱或后继排序键".into()));
    }
    let position_of = |key: &str| siblings.iter().position(|(_, k)| k == key);
    let require_sibling = |key: &str| -> Result<usize, AppError> {
        position_of(key)
            .ok_or_else(|| AppError::Validation(format!("排序键 {key:?} 不属于目标列表")))
    };

    // Resolve into a tight (prev_key, next_key) pair around the target slot.
    let prev_key = match &prev {
        Some(p) => {
            require_sibling(p)?;
            Some(p.clone())
        }
        None => match &next {
            Some(n) => require_sibling(n)?
                .checked_sub(1)
                .map(|i| siblings[i].1.clone()),
            None => None,
        },
    };
    let next_key = match &next {
        Some(n) => {
            require_sibling(n)?;
            Some(n.clone())
        }
        None => match &prev {
            Some(p) => require_sibling(p)?
                .checked_add(1)
                .and_then(|i| siblings.get(i))
                .map(|(_, k)| k.clone()),
            None => None,
        },
    };

    let attempt = match (&prev_key, &next_key) {
        (Some(p), Some(n)) => sort::between(p, n),
        (Some(p), None) => sort::after(p),
        (None, Some(n)) => sort::before(n),
        (None, None) => unreachable!("at least one of prev/next is given"),
    };

    match attempt {
        Ok(key) => Ok(Slot::Key(key)),
        Err(sort::SortError::Exhausted) => {
            let target = match &prev_key {
                Some(p) => require_sibling(p).expect("validated above") + 1,
                None => match &next_key {
                    Some(n) => require_sibling(n).expect("validated above"),
                    None => siblings.len(),
                },
            };
            Ok(Slot::Rebalance(target))
        }
        Err(e) => Err(e.into()),
    }
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

    let siblings: Vec<(Uuid, String)> = tasks::list(conn)?
        .into_iter()
        .filter(|t| t.column_id == input.column_id)
        .map(|t| (t.id, t.sort_order))
        .collect();
    let (sort_order, rebalanced) = append_key(&siblings)?;

    validate_tag_ids(conn, &tag_ids)?;
    for (id, key) in &rebalanced {
        if !tasks::set_sort_order(conn, *id, key, now)? {
            return Err(not_found("任务", *id));
        }
    }

    let task = Task {
        id: Uuid::new_v4(),
        project_id: input.project_id,
        title,
        note: input.note,
        priority: input.priority.unwrap_or(Priority::None),
        column_id: input.column_id,
        due_at: input.due_at,
        completed_at: None,
        repeat_rule: input.repeat_rule,
        complexity,
        sort_order,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    tasks::insert(conn, &task)?;
    task_tags::set_task_tags(conn, task.id, &tag_ids)?;

    // Initial subtasks get a plain first()/after() chain: an editor never
    // creates enough of them to hit the length threshold, and later appends
    // through `create_subtask` rebalance anyway.
    let mut last_key: Option<String> = None;
    for raw_title in &input.subtask_titles {
        let key = match &last_key {
            None => sort::first(),
            Some(last) => sort::after(last)?,
        };
        subtasks::insert(
            conn,
            &Subtask {
                id: Uuid::new_v4(),
                task_id: task.id,
                title: validated_name(raw_title)?,
                note: None,
                priority: Priority::None,
                due_at: None,
                complexity: None,
                done: false,
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
    if let Patch::Set(project_id) = patch.project_id {
        task.project_id = project_id;
    }
    if let Patch::Set(column_id) = patch.column_id {
        task.column_id = column_id;
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
    task.updated_at = Utc::now();

    let tx = conn.unchecked_transaction()?;
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
    spawn_next_instance(&tx, &task, task.column_id)?;
    tx.commit()?;
    Ok(task)
}

pub fn soft_delete_task(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    if !tasks::soft_delete(conn, id, Utc::now())? {
        return Err(not_found("任务", id));
    }
    Ok(())
}

pub fn restore_task(conn: &Connection, id: Uuid) -> Result<Task, AppError> {
    if !tasks::restore(conn, id, Utc::now())? {
        return Err(not_found("任务", id));
    }
    tasks::get(conn, id)?.ok_or_else(|| not_found("任务", id))
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
// Subtasks
// ---------------------------------------------------------------------------

pub fn list_subtasks(conn: &Connection, task_id: Uuid) -> Result<Vec<Subtask>, AppError> {
    subtasks::list_by_task(conn, task_id)
}

/// Every live subtask, across every live task.
///
/// The hierarchical task list has to know which rows have children, and how
/// many are done, before any of them is expanded. `task:list` carries no
/// subtask data and `subtask:list` is per task, so without this the list would
/// need one round trip per row.
pub fn list_all_subtasks(conn: &Connection) -> Result<Vec<Subtask>, AppError> {
    subtasks::list_all(conn)
}

pub fn create_subtask(
    conn: &Connection,
    task_id: Uuid,
    input: NewSubtask,
) -> Result<Subtask, AppError> {
    if tasks::get(conn, task_id)?.is_none() {
        return Err(not_found("任务", task_id));
    }
    let title = validated_name(&input.title)?;
    let complexity = validated_complexity(input.complexity)?;
    let now = Utc::now();
    let siblings: Vec<(Uuid, String)> = subtasks::list_by_task(conn, task_id)?
        .into_iter()
        .map(|s| (s.id, s.sort_order))
        .collect();
    let (sort_order, rebalanced) = append_key(&siblings)?;

    let tx = conn.unchecked_transaction()?;
    for (id, key) in &rebalanced {
        if !subtasks::set_sort_order(&tx, *id, key, now)? {
            return Err(not_found("子任务", *id));
        }
    }
    let subtask = Subtask {
        id: Uuid::new_v4(),
        task_id,
        title,
        note: input.note,
        priority: input.priority.unwrap_or(Priority::None),
        due_at: input.due_at,
        complexity,
        done: false,
        sort_order,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    subtasks::insert(&tx, &subtask)?;
    tx.commit()?;
    Ok(subtask)
}

pub fn update_subtask(
    conn: &Connection,
    id: Uuid,
    patch: UpdateSubtask,
) -> Result<Subtask, AppError> {
    let mut subtask = subtasks::get(conn, id)?.ok_or_else(|| not_found("子任务", id))?;
    if let Some(title) = &patch.title {
        subtask.title = validated_name(title)?;
    }
    if let Some(done) = patch.done {
        subtask.done = done;
    }
    if let Patch::Set(note) = patch.note {
        subtask.note = note;
    }
    if let Some(priority) = patch.priority {
        subtask.priority = priority;
    }
    if let Patch::Set(due_at) = patch.due_at {
        subtask.due_at = due_at;
    }
    if let Patch::Set(complexity) = patch.complexity {
        subtask.complexity = validated_complexity(complexity)?;
    }
    subtask.updated_at = Utc::now();
    if !subtasks::update(conn, &subtask)? {
        return Err(not_found("子任务", id));
    }
    Ok(subtask)
}

/// Checks or unchecks a subtask (`done: false` un-completes it).
pub fn complete_subtask(conn: &Connection, id: Uuid, done: bool) -> Result<Subtask, AppError> {
    update_subtask(
        conn,
        id,
        UpdateSubtask {
            title: None,
            done: Some(done),
            note: Patch::Unchanged,
            priority: None,
            due_at: Patch::Unchanged,
            complexity: Patch::Unchanged,
        },
    )
}

pub fn delete_subtask(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    if !subtasks::soft_delete(conn, id, Utc::now())? {
        return Err(not_found("子任务", id));
    }
    Ok(())
}

/// Moves a subtask between its neighbours: `prev`/`next` are the sort keys of
/// the items surrounding the target slot (either may be omitted at the list
/// ends). Returns the task's full subtask list in its new authoritative
/// order, because other rows' keys change whenever a rebalance kicks in.
pub fn reorder_subtask(
    conn: &Connection,
    id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Vec<Subtask>, AppError> {
    let moved = subtasks::get(conn, id)?.ok_or_else(|| not_found("子任务", id))?;

    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    let siblings: Vec<(Uuid, String)> = subtasks::list_by_task(&tx, moved.task_id)?
        .into_iter()
        .filter(|s| s.id != id)
        .map(|s| (s.id, s.sort_order))
        .collect();

    match resolve_slot(&siblings, prev, next)? {
        Slot::Key(key) => {
            if !subtasks::set_sort_order(&tx, id, &key, now)? {
                return Err(not_found("子任务", id));
            }
        }
        Slot::Rebalance(target) => {
            let mut ordered = siblings;
            ordered.insert(target.min(ordered.len()), (id, moved.sort_order.clone()));
            let fresh = sort::spread(ordered.len());
            for ((sibling_id, _), key) in ordered.iter().zip(fresh) {
                if !subtasks::set_sort_order(&tx, *sibling_id, &key, now)? {
                    return Err(not_found("子任务", *sibling_id));
                }
            }
        }
    }
    tx.commit()?;
    subtasks::list_by_task(conn, moved.task_id)
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
    validate_dependency(conn, input.kind, input.dependent_id, input.prerequisite_id)?;
    dependencies::insert(
        conn,
        input.kind,
        input.dependent_id,
        input.prerequisite_id,
        Utc::now(),
    )?;
    Ok(input)
}

pub fn remove_dependency(conn: &Connection, input: Dependency) -> Result<(), AppError> {
    dependencies::remove(conn, input.kind, input.dependent_id, input.prerequisite_id)
}

/// The four rules an edge must satisfy: both endpoints live, subtask edges
/// inside one parent task, no self-reference, and no cycles. The frontend also
/// filters cyclic candidates out of its picker, but that is a convenience —
/// this check is the authority.
fn validate_dependency(
    conn: &Connection,
    kind: DependencyKind,
    dependent_id: Uuid,
    prerequisite_id: Uuid,
) -> Result<(), AppError> {
    if dependent_id == prerequisite_id {
        return Err(AppError::Validation("不能依赖自身".into()));
    }
    match kind {
        DependencyKind::Task => {
            if tasks::get(conn, dependent_id)?.is_none() {
                return Err(not_found("任务", dependent_id));
            }
            if tasks::get(conn, prerequisite_id)?.is_none() {
                return Err(not_found("任务", prerequisite_id));
            }
        }
        DependencyKind::Subtask => {
            let dependent = subtasks::get(conn, dependent_id)?
                .ok_or_else(|| not_found("子任务", dependent_id))?;
            let prerequisite = subtasks::get(conn, prerequisite_id)?
                .ok_or_else(|| not_found("子任务", prerequisite_id))?;
            if dependent.task_id != prerequisite.task_id {
                return Err(AppError::Validation("子任务依赖需在同一个任务内".into()));
            }
        }
    }
    if dependencies::creates_cycle(conn, kind, dependent_id, prerequisite_id)? {
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

/// Creates a project plus its default kanban columns (待办/进行中/已完成,
/// the last one flagged `is_done`) in one transaction, appending after the
/// last existing project.
pub fn create_project(conn: &Connection, input: NewProject) -> Result<Project, AppError> {
    let name = validated_name(&input.name)?;
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
        due_at: input.due_at,
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
    if let Patch::Set(due_at) = patch.due_at {
        project.due_at = due_at;
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

pub fn list_board_columns(
    conn: &Connection,
    project_id: Uuid,
) -> Result<Vec<BoardColumn>, AppError> {
    board_columns::list_by_project(conn, project_id)
}

/// Appends a new active column at the end of the project's board.
pub fn add_board_column(conn: &Connection, input: NewBoardColumn) -> Result<BoardColumn, AppError> {
    if projects::get(conn, input.project_id)?.is_none() {
        return Err(not_found("项目", input.project_id));
    }
    let name = validated_name(&input.name)?;
    let now = Utc::now();
    let siblings: Vec<(Uuid, String)> = board_columns::list_by_project(conn, input.project_id)?
        .into_iter()
        .map(|c| (c.id, c.position))
        .collect();
    let (position, rebalanced) = append_key(&siblings)?;

    let tx = conn.unchecked_transaction()?;
    for (id, key) in &rebalanced {
        if !board_columns::set_position(&tx, *id, key, now)? {
            return Err(not_found("看板列", *id));
        }
    }
    let column = BoardColumn {
        id: Uuid::new_v4(),
        project_id: input.project_id,
        name,
        position,
        is_done: false,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    board_columns::insert(&tx, &column)?;
    tx.commit()?;
    Ok(column)
}

/// Renames a column and/or toggles its done flag (`board:updateColumn`).
pub fn update_board_column(
    conn: &Connection,
    id: Uuid,
    patch: UpdateBoardColumn,
) -> Result<BoardColumn, AppError> {
    let mut column = board_columns::get(conn, id)?.ok_or_else(|| not_found("看板列", id))?;
    if let Some(name) = &patch.name {
        column.name = validated_name(name)?;
    }
    if let Some(is_done) = patch.is_done {
        column.is_done = is_done;
    }
    column.updated_at = Utc::now();
    if !board_columns::update(conn, &column)? {
        return Err(not_found("看板列", id));
    }
    Ok(column)
}

/// Soft-deletes a column and detaches its tasks (their `column_id` clears,
/// so they stay in the project's list view instead of vanishing with the
/// board).
pub fn delete_board_column(conn: &Connection, id: Uuid) -> Result<(), AppError> {
    if board_columns::get(conn, id)?.is_none() {
        return Err(not_found("看板列", id));
    }
    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    tasks::clear_column(&tx, id, now)?;
    if !board_columns::soft_delete(&tx, id, now)? {
        return Err(not_found("看板列", id));
    }
    tx.commit()?;
    Ok(())
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
) -> Result<Task, AppError> {
    let mut moved = tasks::get(conn, task_id)?.ok_or_else(|| not_found("任务", task_id))?;
    let column =
        board_columns::get(conn, column_id)?.ok_or_else(|| not_found("看板列", column_id))?;

    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    let siblings: Vec<(Uuid, String)> = tasks::list(&tx)?
        .into_iter()
        .filter(|t| t.column_id == Some(column_id) && t.id != task_id)
        .map(|t| (t.id, t.sort_order))
        .collect();

    let previous_column = moved.column_id;
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

    match resolve_slot(&siblings, prev, next)? {
        Slot::Key(key) => {
            moved.sort_order = key;
            if !tasks::update(&tx, &moved)? {
                return Err(not_found("任务", task_id));
            }
        }
        Slot::Rebalance(target) => {
            let mut ordered = siblings;
            ordered.insert(
                target.min(ordered.len()),
                (task_id, moved.sort_order.clone()),
            );
            let fresh = sort::spread(ordered.len());
            for ((sibling_id, _), key) in ordered.iter().zip(fresh) {
                if *sibling_id == task_id {
                    moved.sort_order = key;
                    if !tasks::update(&tx, &moved)? {
                        return Err(not_found("任务", task_id));
                    }
                } else if !tasks::set_sort_order(&tx, *sibling_id, &key, now)? {
                    return Err(not_found("任务", *sibling_id));
                }
            }
        }
    }

    // Entering the done column completes the task: a repeating task spawns
    // its next instance back into the column it came from.
    if entered_done {
        spawn_next_instance(&tx, &moved, previous_column)?;
    }

    tx.commit()?;
    Ok(moved)
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
/// Generation of the backup format. Bumped to 2 when dependency edges joined
/// the document: an older build reading a v2 file would silently drop them,
/// so `import_backup` refuses anything newer than this value.
pub const BACKUP_VERSION: u32 = 2;

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
                    subtask_id: None,
                    subtask_title: None,
                });
            }
        }
    }

    for candidate in reminders::list_subtask_candidates(conn, cutoff, horizon)? {
        for kind in due_kinds(now, candidate.due_at) {
            if reminders::mark_subtask_fired(&tx, candidate.id, kind, now)? {
                fired.push(Reminder {
                    task_id: candidate.task_id,
                    task_title: candidate.task_title.clone(),
                    kind,
                    due_at: candidate.due_at,
                    subtask_id: Some(candidate.id),
                    subtask_title: Some(candidate.title.clone()),
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
        NewSubtask, NewTag, NewTask, StatsGranularity, TimeGroupBy, TimePoint, TimeShare,
        UpdateTask,
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
        }
    }

    fn make_subtask(conn: &Connection, task_id: Uuid, title: &str) -> Subtask {
        create_subtask(
            conn,
            task_id,
            NewSubtask {
                title: title.into(),
                note: None,
                priority: None,
                due_at: None,
                complexity: None,
            },
        )
        .unwrap()
    }

    /// One dependency edge, `dependent → prerequisite` (the prerequisite must
    /// be finished first).
    fn dependency(kind: DependencyKind, dependent_id: Uuid, prerequisite_id: Uuid) -> Dependency {
        Dependency {
            kind,
            dependent_id,
            prerequisite_id,
        }
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
            },
        )
        .unwrap();

        assert_eq!(task.priority, Priority::High);
        let linked = task_tags::list_tags_for_task(&conn, task.id).unwrap();
        assert_eq!(linked.len(), 1, "duplicate tag ids are deduped");

        let subtasks = subtasks::list_by_task(&conn, task.id).unwrap();
        let titles: Vec<&str> = subtasks.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["回归测试", "发布公告"]);
        assert!(subtasks[0].sort_order < subtasks[1].sort_order);

        // `task:list` carries each task's tag associations.
        let listed = list_tasks(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].task.title, "上线检查");
        assert_eq!(listed[0].tag_ids, vec![tag.id]);
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
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_found");

        // Neither the task nor its subtask survived.
        assert_eq!(tasks::list(&conn).unwrap().len(), 1);
        for task in tasks::list(&conn).unwrap() {
            assert!(subtasks::list_by_task(&conn, task.id).unwrap().is_empty());
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
    fn subtask_crud_appends_in_order_and_toggles_done() {
        let conn = conn();
        let task = make_task(&conn, "父任务");
        let first = make_subtask(&conn, task.id, "一");
        let second = make_subtask(&conn, task.id, "二");
        let third = make_subtask(&conn, task.id, "三");
        let list = subtasks::list_by_task(&conn, task.id).unwrap();
        let keys: Vec<&str> = list.iter().map(|s| s.sort_order.as_str()).collect();
        assert_eq!(keys, vec!["n", "o", "p"]);

        let done = complete_subtask(&conn, second.id, true).unwrap();
        assert!(done.done);
        let undone = complete_subtask(&conn, second.id, false).unwrap();
        assert!(!undone.done);

        delete_subtask(&conn, third.id).unwrap();
        assert_eq!(subtasks::list_by_task(&conn, task.id).unwrap().len(), 2);
        assert_eq!(
            delete_subtask(&conn, third.id).unwrap_err().code(),
            "not_found"
        );

        let err = create_subtask(
            &conn,
            Uuid::new_v4(),
            NewSubtask {
                title: "孤儿".into(),
                note: None,
                priority: None,
                due_at: None,
                complexity: None,
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

        let subtask = create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "收集数据".into(),
                note: Some("先拉近三个月".into()),
                priority: Some(Priority::High),
                due_at: Some(due),
                complexity: Some(2),
            },
        )
        .unwrap();
        assert_eq!(subtask.note.as_deref(), Some("先拉近三个月"));
        assert_eq!(subtask.priority, Priority::High);
        assert_eq!(subtask.due_at, Some(due));
        assert_eq!(subtask.complexity, Some(2));

        // Missing fields stay, explicit null clears (same Patch rules as tasks).
        let renamed = update_subtask(
            &conn,
            subtask.id,
            UpdateSubtask {
                title: Some("收集数据 v2".into()),
                done: None,
                note: Patch::Unchanged,
                priority: None,
                due_at: Patch::Unchanged,
                complexity: Patch::Unchanged,
            },
        )
        .unwrap();
        assert_eq!(renamed.title, "收集数据 v2");
        assert_eq!(renamed.note.as_deref(), Some("先拉近三个月"));
        assert_eq!(renamed.complexity, Some(2));

        let cleared = update_subtask(
            &conn,
            subtask.id,
            UpdateSubtask {
                title: None,
                done: None,
                note: Patch::Set(None),
                priority: None,
                due_at: Patch::Set(None),
                complexity: Patch::Set(None),
            },
        )
        .unwrap();
        assert_eq!(cleared.note, None);
        assert_eq!(cleared.due_at, None);
        assert_eq!(cleared.complexity, None);
        assert_eq!(cleared.priority, Priority::High, "priority is not nullable");

        assert_eq!(
            update_subtask(
                &conn,
                subtask.id,
                UpdateSubtask {
                    title: None,
                    done: None,
                    note: Patch::Unchanged,
                    priority: None,
                    due_at: Patch::Unchanged,
                    complexity: Patch::Set(Some(9)),
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );

        // A subtask created through the bare-title path takes the defaults.
        let plain = create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "默认值".into(),
                note: None,
                priority: None,
                due_at: None,
                complexity: None,
            },
        )
        .unwrap();
        assert_eq!(plain.priority, Priority::None);
        assert_eq!(plain.complexity, None);
    }

    #[test]
    fn list_all_subtasks_spans_tasks_and_skips_deleted_parents() {
        let conn = conn();
        let first = make_task(&conn, "第一个");
        let second = make_task(&conn, "第二个");

        let a = create_subtask(
            &conn,
            first.id,
            NewSubtask {
                title: "a".into(),
                note: None,
                priority: None,
                due_at: None,
                complexity: None,
            },
        )
        .unwrap();
        let b = create_subtask(
            &conn,
            first.id,
            NewSubtask {
                title: "b".into(),
                note: None,
                priority: None,
                due_at: None,
                complexity: None,
            },
        )
        .unwrap();
        let c = create_subtask(
            &conn,
            second.id,
            NewSubtask {
                title: "c".into(),
                note: None,
                priority: None,
                due_at: None,
                complexity: None,
            },
        )
        .unwrap();

        // Soft-deleting a task does not cascade to its subtasks, so the query
        // has to exclude them by looking at the parent.
        let doomed = make_task(&conn, "要删的任务");
        create_subtask(
            &conn,
            doomed.id,
            NewSubtask {
                title: "陪葬".into(),
                note: None,
                priority: None,
                due_at: None,
                complexity: None,
            },
        )
        .unwrap();
        soft_delete_task(&conn, doomed.id).unwrap();

        let all = list_all_subtasks(&conn).unwrap();

        // Assert per parent, not on one global sequence: the query orders by
        // `task_id`, which is a UUID, so the two tasks' blocks can arrive in
        // either order.
        let titles_of = |task_id: Uuid| -> Vec<String> {
            all.iter()
                .filter(|s| s.task_id == task_id)
                .map(|s| s.title.clone())
                .collect()
        };
        assert_eq!(titles_of(first.id), vec!["a", "b"]);
        assert_eq!(titles_of(second.id), vec!["c"]);
        assert_eq!(
            all.len(),
            3,
            "the deleted task's subtask must not be returned"
        );

        // A soft-deleted subtask disappears too.
        delete_subtask(&conn, b.id).unwrap();
        let after = list_all_subtasks(&conn).unwrap();
        assert_eq!(after.len(), 2);
        assert!(!after.iter().any(|s| s.id == b.id));
        assert!(after.iter().any(|s| s.id == c.id));
        assert!(after.iter().any(|s| s.id == a.id));
    }

    #[test]
    fn reorder_subtask_moves_within_the_list() {
        let conn = conn();
        let task = make_task(&conn, "排序");
        let a = make_subtask(&conn, task.id, "A");
        let b = make_subtask(&conn, task.id, "B");
        let c = make_subtask(&conn, task.id, "C");
        fn titles(list: &[Subtask]) -> Vec<&str> {
            list.iter().map(|s| s.title.as_str()).collect()
        }

        // Move C to the front (before A).
        let moved = reorder_subtask(&conn, c.id, None, Some(a.sort_order.clone())).unwrap();
        assert_eq!(titles(&moved), vec!["C", "A", "B"]);

        // Move A to the end (after B) — a one-sided move whose derived
        // next-neighbour is gone, so the key extends past B.
        let moved = reorder_subtask(&conn, a.id, Some(b.sort_order.clone()), None).unwrap();
        assert_eq!(titles(&moved), vec!["C", "B", "A"]);

        // Move C into the middle (after B, before A): the derived pair is
        // tight, so a plain `after(B)` could have collided with A's key.
        let moved = reorder_subtask(&conn, c.id, Some(b.sort_order.clone()), None).unwrap();
        assert_eq!(titles(&moved), vec!["B", "C", "A"]);
        assert!(
            moved.windows(2).all(|w| w[0].sort_order < w[1].sort_order),
            "keys stay strictly ordered"
        );
    }

    #[test]
    fn reorder_subtask_rejects_bad_input() {
        let conn = conn();
        let task = make_task(&conn, "校验");
        let a = make_subtask(&conn, task.id, "A");

        assert_eq!(
            reorder_subtask(&conn, a.id, None, None).unwrap_err().code(),
            "validation"
        );
        assert_eq!(
            reorder_subtask(&conn, a.id, Some("1x".into()), None)
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            reorder_subtask(&conn, a.id, Some("z".into()), Some("a".into()))
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
        let a = Subtask {
            id: Uuid::new_v4(),
            task_id: task.id,
            title: "A".into(),
            note: None,
            priority: Priority::None,
            due_at: None,
            complexity: None,
            done: false,
            sort_order: "a".into(),
            created_at: task.created_at,
            updated_at: task.created_at,
            deleted_at: None,
        };
        let b = Subtask {
            id: Uuid::new_v4(),
            task_id: task.id,
            title: "B".into(),
            note: None,
            priority: Priority::None,
            due_at: None,
            complexity: None,
            done: false,
            sort_order: "aa".into(),
            created_at: task.created_at,
            updated_at: task.created_at,
            deleted_at: None,
        };
        let c = make_subtask(&conn, task.id, "C"); // appended normally
        subtasks::insert(&conn, &a).unwrap();
        subtasks::insert(&conn, &b).unwrap();

        // between("a", "aa") is exhausted -> the list is rekeyed.
        let moved = reorder_subtask(&conn, c.id, Some("a".into()), Some("aa".into())).unwrap();
        let titles: Vec<&str> = moved.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["A", "C", "B"]);
        assert!(
            moved.iter().map(|s| s.sort_order.len()).max().unwrap() <= 2,
            "rebalance shrinks keys: {:?}",
            moved
                .iter()
                .map(|s| s.sort_order.clone())
                .collect::<Vec<_>>()
        );
        assert!(moved.windows(2).all(|w| w[0].sort_order < w[1].sort_order));
    }

    #[test]
    fn appending_past_the_length_threshold_rebalances_siblings() {
        let conn = conn();
        let task = make_task(&conn, "超长");
        let bloated = Subtask {
            id: Uuid::new_v4(),
            task_id: task.id,
            title: "旧键".into(),
            note: None,
            priority: Priority::None,
            due_at: None,
            complexity: None,
            done: false,
            sort_order: "z".repeat(MAX_SORT_KEY_LEN + 4),
            created_at: task.created_at,
            updated_at: task.created_at,
            deleted_at: None,
        };
        subtasks::insert(&conn, &bloated).unwrap();

        let appended = make_subtask(&conn, task.id, "新键");
        let all = subtasks::list_by_task(&conn, task.id).unwrap();
        assert_eq!(all.len(), 2);
        assert!(
            all.iter().map(|s| s.sort_order.len()).max().unwrap() <= 2,
            "both keys rebalanced: {:?}",
            all.iter().map(|s| s.sort_order.clone()).collect::<Vec<_>>()
        );
        assert!(all[0].sort_order < appended.sort_order);
    }

    // --- projects & board ----------------------------------------------------

    fn make_project(conn: &Connection, name: &str) -> Project {
        create_project(
            conn,
            NewProject {
                name: name.into(),
                description: None,
                color: None,
                icon: None,
                due_at: None,
            },
        )
        .unwrap()
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
                due_at: None,
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
                due_at: Patch::Set(None),
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
                    due_at: Patch::Unchanged,
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
    fn board_columns_add_update_and_delete_detaches_tasks() {
        let conn = conn();
        let project = make_project(&conn, "看板项目");
        assert_eq!(list_board_columns(&conn, project.id).unwrap().len(), 3);

        let extra = add_board_column(
            &conn,
            NewBoardColumn {
                project_id: project.id,
                name: "评审".into(),
            },
        )
        .unwrap();
        assert!(!extra.is_done);
        let columns = list_board_columns(&conn, project.id).unwrap();
        assert_eq!(columns.len(), 4);
        assert_eq!(columns.last().unwrap().id, extra.id, "new column appends");
        assert!(columns.windows(2).all(|w| w[0].position < w[1].position));

        let err = add_board_column(
            &conn,
            NewBoardColumn {
                project_id: Uuid::new_v4(),
                name: "孤儿列".into(),
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_found");

        let renamed = update_board_column(
            &conn,
            extra.id,
            UpdateBoardColumn {
                name: Some("验收".into()),
                is_done: Some(true),
            },
        )
        .unwrap();
        assert_eq!(renamed.name, "验收");
        assert!(renamed.is_done);
        assert_eq!(
            update_board_column(
                &conn,
                extra.id,
                UpdateBoardColumn {
                    name: Some("  ".into()),
                    is_done: None,
                },
            )
            .unwrap_err()
            .code(),
            "validation"
        );

        // Deleting the column detaches its tasks instead of stranding them.
        let task = make_column_task(&conn, &extra, "在列任务");
        delete_board_column(&conn, extra.id).unwrap();
        assert_eq!(
            delete_board_column(&conn, extra.id).unwrap_err().code(),
            "not_found"
        );
        assert_eq!(list_board_columns(&conn, project.id).unwrap().len(), 3);
        let detached = tasks::get(&conn, task.id).unwrap().unwrap();
        assert_eq!(detached.column_id, None);
        assert_eq!(detached.project_id, Some(project.id));
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
        assert_eq!(moved.column_id, Some(done.id));
        assert_eq!(moved.project_id, Some(project.id));
        let stamped = moved.completed_at.expect("stamped on entering done column");

        // Moving within the done column keeps the original timestamp.
        let again = move_task(
            &conn,
            task.id,
            done.id,
            Some(done_neighbour.sort_order.clone()),
            None,
        )
        .unwrap();
        assert_eq!(again.completed_at, Some(stamped));

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
        assert_eq!(back.completed_at, None);
        assert_eq!(back.column_id, Some(todo.id));
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
        assert!(moved.sort_order > a.sort_order && moved.sort_order < b.sort_order);

        // Move C to the front of the column.
        let moved = move_task(&conn, c.id, todo.id, None, Some(a.sort_order.clone())).unwrap();
        assert!(moved.sort_order < a.sort_order);

        let keys = column_task_keys(&conn, todo.id);
        assert!(keys.windows(2).all(|w| w[0] < w[1]), "keys stay ordered");
        assert_eq!(keys.len(), 3);
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
            moved.sort_order
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
        assert_eq!(
            move_task(&conn, task.id, todo.id, None, None)
                .unwrap_err()
                .code(),
            "validation"
        );
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
    fn subtask_due_dates_fire_their_own_reminders() {
        let conn = conn();
        let base = Utc.with_ymd_and_hms(2026, 9, 11, 12, 0, 0).unwrap();
        let due = base + chrono::Duration::hours(2);
        let task = make_due_task(&conn, "父任务", due);
        let subtask = create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "收集数据".into(),
                note: None,
                priority: None,
                due_at: Some(due),
                complexity: None,
            },
        )
        .unwrap();

        let fired = scan_reminders(&conn, due - chrono::Duration::hours(1)).unwrap();
        // The task's own 1-hour reminder plus the subtask's.
        assert_eq!(fired.len(), 2);
        let subtask_hit = fired
            .iter()
            .find(|reminder| reminder.subtask_id == Some(subtask.id))
            .expect("the subtask reminder must fire");
        assert_eq!(subtask_hit.task_id, task.id, "taskId stays the parent");
        assert_eq!(subtask_hit.task_title, "父任务");
        assert_eq!(subtask_hit.subtask_title.as_deref(), Some("收集数据"));

        // The next scan fires the *next* kind, not the 1-hour one again: the
        // marker table dedups per (subtask, kind).
        let later_scan = scan_reminders(&conn, due - chrono::Duration::minutes(5)).unwrap();
        let repeats: Vec<&Reminder> = later_scan
            .iter()
            .filter(|reminder| reminder.subtask_id == Some(subtask.id))
            .collect();
        assert_eq!(repeats.len(), 1);
        assert_eq!(repeats[0].kind, ReminderKind::Advance10m);
        let later = base + chrono::Duration::hours(5);
        let second = make_due_task(&conn, "第二个父任务", later);
        let pending = create_subtask(
            &conn,
            second.id,
            NewSubtask {
                title: "写结论".into(),
                note: None,
                priority: None,
                due_at: Some(later),
                complexity: None,
            },
        )
        .unwrap();
        complete_subtask(&conn, pending.id, true).unwrap();
        assert!(
            scan_reminders(&conn, later - chrono::Duration::minutes(5))
                .unwrap()
                .iter()
                .all(|reminder| reminder.subtask_id != Some(pending.id)),
            "a done subtask must not remind"
        );
    }

    #[test]
    fn completing_the_parent_stops_its_subtask_reminders() {
        let conn = conn();
        let base = Utc.with_ymd_and_hms(2026, 9, 11, 12, 0, 0).unwrap();
        let due = base + chrono::Duration::hours(2);
        let task = make_due_task(&conn, "父任务", due);
        create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "子任务".into(),
                note: None,
                priority: None,
                due_at: Some(due),
                complexity: None,
            },
        )
        .unwrap();
        complete_task(&conn, task.id).unwrap();

        let fired = scan_reminders(&conn, due - chrono::Duration::hours(1)).unwrap();
        assert!(
            fired.iter().all(|reminder| reminder.subtask_id.is_none()),
            "a completed parent task silences its subtasks"
        );
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
        let due = Utc.with_ymd_and_hms(2026, 9, 11, 18, 0, 0).unwrap();
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
            },
        )
        .unwrap();

        let completed = complete_task(&conn, first.id).unwrap();
        assert!(completed.completed_at.is_some());

        // The next instance carries everything over, uncompleted and due one
        // period later, placed after the completed original.
        let listed = tasks::list(&conn).unwrap();
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
        let next_subtasks = subtasks::list_by_task(&conn, next.id).unwrap();
        assert_eq!(next_subtasks.len(), 1);
        assert!(!next_subtasks[0].done);
        assert_eq!(next_subtasks[0].title, "套新垃圾袋");

        // Completing the instance spawns the following one; every completed
        // generation stays completed (original + first instance).
        complete_task(&conn, next.id).unwrap();
        let listed = tasks::list(&conn).unwrap();
        assert_eq!(listed.len(), 3);
        assert_eq!(listed[2].due_at, Some(due + chrono::Duration::days(2)));
        assert_eq!(completed_task_count(&conn), 2);
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
        let subtask = create_subtask(
            &conn,
            task.id,
            NewSubtask {
                title: "整理指标".into(),
                note: Some("看漏斗".into()),
                priority: Some(Priority::Low),
                due_at: Some(due),
                complexity: Some(3),
            },
        )
        .unwrap();
        complete_subtask(&conn, subtask.id, true).unwrap();

        let next = complete_task(&conn, task.id).unwrap();
        assert!(next.completed_at.is_some());

        let spawned = list_tasks(&conn)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.task.id != task.id)
            .expect("the repeat instance must exist")
            .task;
        assert_eq!(
            spawned.complexity,
            Some(4),
            "a repeat instance keeps the task's complexity"
        );
        let copied = list_subtasks(&conn, spawned.id).unwrap();
        assert_eq!(copied.len(), 1);
        assert_eq!(copied[0].note.as_deref(), Some("看漏斗"));
        assert_eq!(copied[0].priority, Priority::Low);
        assert_eq!(copied[0].complexity, Some(3));
        assert!(!copied[0].done, "a fresh instance starts uncompleted");
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
        assert!(moved.completed_at.is_some());
        assert_eq!(moved.column_id, Some(done.id));

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
            Some(moved.sort_order.clone()),
            None,
        )
        .unwrap();
        assert!(moved_within.completed_at.is_some());
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
                due_at: None,
            }
        );
        assert_eq!(progress[1].project_id, beta.id);
        assert_eq!((progress[1].total, progress[1].completed), (0, 0));
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
        create_subtask(
            conn,
            task.id,
            NewSubtask {
                title: "第一步".into(),
                note: None,
                priority: None,
                due_at: None,
                complexity: None,
            },
        )
        .unwrap();
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
                exported.counts.projects,
                exported.counts.board_columns,
                exported.counts.tasks,
                exported.counts.tags,
                exported.counts.subtasks,
                exported.counts.comments,
                exported.counts.time_entries,
                exported.counts.settings,
            ),
            (1, 3, 2, 1, 1, 1, 1, 1)
        );

        // Restoring into a database that never saw the data reproduces it all,
        // soft-deleted rows included.
        let restored = db::test_conn();
        let summary = import_backup(&restored, &path).unwrap();
        assert_eq!(summary.counts.tasks, 2);
        assert_eq!(summary.exported_at, exported.exported_at);
        let after = backup::export_all(&restored).unwrap();
        assert_eq!(after, before, "every table survives a backup round trip");
        assert_eq!(
            tasks::get(&restored, task.id).unwrap().unwrap().priority,
            Priority::High
        );
        assert_eq!(subtasks::list_by_task(&restored, task.id).unwrap().len(), 1);
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
        assert_eq!(tasks::list(&restored).unwrap().len(), 1);
        assert_eq!(backup::export_all(&restored).unwrap().tasks.len(), 2);

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn backup_roundtrips_dependency_edges() {
        let conn = conn();
        let a = make_task(&conn, "A");
        let b = make_task(&conn, "B");
        let first = make_subtask(&conn, a.id, "1");
        let second = make_subtask(&conn, a.id, "2");
        add_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        add_dependency(
            &conn,
            dependency(DependencyKind::Subtask, first.id, second.id),
        )
        .unwrap();

        let path = backup_path();
        export_backup(&conn, &path).unwrap();

        // Wiping the edges (rather than the whole database) keeps this test
        // focused: the import has to restore them from the document.
        remove_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        remove_dependency(
            &conn,
            dependency(DependencyKind::Subtask, first.id, second.id),
        )
        .unwrap();
        assert!(list_dependencies(&conn).unwrap().is_empty());

        import_backup(&conn, &path).unwrap();
        let restored = list_dependencies(&conn).unwrap();
        assert_eq!(restored.len(), 2);
        assert!(restored
            .iter()
            .any(|edge| edge.kind == DependencyKind::Task));
        assert!(restored
            .iter()
            .any(|edge| edge.kind == DependencyKind::Subtask));

        // A second import replaces rather than merges — the edge tables
        // included, so an edge added after the restore does not survive it.
        let extra = make_task(&conn, "C");
        add_dependency(&conn, dependency(DependencyKind::Task, a.id, extra.id)).unwrap();
        import_backup(&conn, &path).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 2);

        // Dormant edges travel too. With B soft-deleted the A → B edge is out
        // of `dependency:listAll`'s live view but still in the database, and a
        // backup is a copy of the database, not a view of it.
        soft_delete_task(&conn, b.id).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 1);
        export_backup(&conn, &path).unwrap();
        remove_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
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
    fn import_accepts_backups_written_before_subtasks_had_attributes() {
        let conn = conn();
        let task = seed_everything(&conn);
        let path = backup_path();
        export_backup(&conn, &path).unwrap();

        // A backup written before subtasks carried attributes: the four keys
        // are simply absent from the document.
        let mut document: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let subtasks = document["data"]["subtasks"].as_array_mut().unwrap();
        assert_eq!(subtasks.len(), 1);
        for subtask in subtasks {
            let object = subtask.as_object_mut().unwrap();
            for key in ["note", "priority", "dueAt", "complexity"] {
                assert!(object.remove(key).is_some(), "{key} was in the export");
            }
        }
        std::fs::write(&path, serde_json::to_string(&document).unwrap()).unwrap();

        let restored = db::test_conn();
        import_backup(&restored, &path).unwrap();
        let imported = subtasks::list_by_task(&restored, task.id).unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(
            imported[0].priority,
            Priority::None,
            "an old row comes back at the column's default"
        );
        assert_eq!(imported[0].note, None);
        assert_eq!(imported[0].complexity, None);

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

        let edge = add_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        assert_eq!(edge.prerequisite_id, b.id);
        // Adding the same edge twice is a no-op, not an error.
        add_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 1);

        // Soft-deleting the prerequisite hides the edge (A is no longer blocked)
        // but keeps it in the table: restoring brings the relation back.
        soft_delete_task(&conn, b.id).unwrap();
        assert!(list_dependencies(&conn).unwrap().is_empty());
        restore_task(&conn, b.id).unwrap();
        assert_eq!(list_dependencies(&conn).unwrap().len(), 1);

        // Removing is idempotent too.
        remove_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        remove_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        assert!(list_dependencies(&conn).unwrap().is_empty());
    }

    #[test]
    fn dependency_edges_are_scoped_and_acyclic() {
        let conn = conn();
        let a = make_task(&conn, "A");
        let b = make_task(&conn, "B");
        let c = make_task(&conn, "C");

        // A → B → C, then C → A would close a three-node cycle.
        add_dependency(&conn, dependency(DependencyKind::Task, a.id, b.id)).unwrap();
        add_dependency(&conn, dependency(DependencyKind::Task, b.id, c.id)).unwrap();
        assert_eq!(
            add_dependency(&conn, dependency(DependencyKind::Task, c.id, a.id))
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            add_dependency(&conn, dependency(DependencyKind::Task, a.id, a.id))
                .unwrap_err()
                .code(),
            "validation"
        );
        assert_eq!(
            add_dependency(
                &conn,
                dependency(DependencyKind::Task, a.id, Uuid::new_v4())
            )
            .unwrap_err()
            .code(),
            "not_found"
        );

        // Subtask edges must stay inside one parent task.
        let other = make_task(&conn, "D");
        let first = make_subtask(&conn, a.id, "1");
        let second = make_subtask(&conn, a.id, "2");
        let foreign = make_subtask(&conn, other.id, "x");
        add_dependency(
            &conn,
            dependency(DependencyKind::Subtask, first.id, second.id),
        )
        .unwrap();
        assert_eq!(
            add_dependency(
                &conn,
                dependency(DependencyKind::Subtask, first.id, foreign.id)
            )
            .unwrap_err()
            .code(),
            "validation"
        );
        // A subtask edge does not leak into the task graph.
        assert_eq!(list_dependencies(&conn).unwrap().len(), 3);
        assert_eq!(
            list_dependencies(&conn)
                .unwrap()
                .iter()
                .filter(|edge| edge.kind == DependencyKind::Subtask)
                .count(),
            1
        );
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

        add_dependency(
            &conn,
            dependency(DependencyKind::Task, repeating.id, prerequisite.id),
        )
        .unwrap();
        // A subtask edge too: a copied subtask would otherwise drag an edge
        // along that points at the previous instance's rows.
        let first = make_subtask(&conn, repeating.id, "1");
        let second = make_subtask(&conn, repeating.id, "2");
        add_dependency(
            &conn,
            dependency(DependencyKind::Subtask, first.id, second.id),
        )
        .unwrap();

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
            list_subtasks(&conn, spawned.id)
                .unwrap()
                .iter()
                .map(|subtask| subtask.id),
        );
        assert_eq!(instance.len(), 3, "the instance carries both subtasks");

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

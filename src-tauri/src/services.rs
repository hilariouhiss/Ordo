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

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::{
    BoardColumn, Comment, NewBoardColumn, NewComment, NewProject, NewSubtask, NewTag, NewTask,
    NewTimeEntry, Patch, Priority, Project, ProjectStatus, Reminder, ReminderKind, RepeatFreq,
    RepeatRule, SearchHit, SearchHitKind, Subtask, Tag, Task, TaskWithTags, TimeEntry,
    UpdateBoardColumn, UpdateComment, UpdateProject, UpdateSubtask, UpdateTag, UpdateTask,
    UpdateTimeEntry,
};
use crate::repositories::{
    board_columns, comments, projects, reminders, search, subtasks, tags, task_tags, tasks,
    time_entries,
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
/// title/note/priority/project/tags/subtasks (subtasks reset to uncompleted)
/// and the rule itself, appended to `column_id`'s scope. Repeats anchored to
/// nothing (`due_at = None`) or paused rules complete without spawning.
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
    let subtask_titles: Vec<String> = subtasks::list_by_task(conn, task.id)?
        .into_iter()
        .map(|subtask| subtask.title)
        .collect();

    create_task_in_tx(
        conn,
        NewTask {
            title: task.title.clone(),
            note: task.note.clone(),
            priority: Some(task.priority),
            project_id: task.project_id,
            column_id,
            due_at: Some(next_due(due, &rule)),
            tag_ids,
            subtask_titles,
            repeat_rule: Some(rule),
        },
    )?;
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

pub fn create_subtask(
    conn: &Connection,
    task_id: Uuid,
    input: NewSubtask,
) -> Result<Subtask, AppError> {
    if tasks::get(conn, task_id)?.is_none() {
        return Err(not_found("任务", task_id));
    }
    let title = validated_name(&input.title)?;
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

    if terms.iter().all(|t| t.chars().count() >= MIN_FTS_TERM_CHARS) {
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
    let fold = |s: &str| s.chars().map(|c| c.to_ascii_lowercase()).collect::<String>();
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
    snippet.extend(chars[index_of(start)..index_of(end)].iter().map(|&(_, c)| c));
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

/// One scheduler scan (runs on the fixed interval in `scheduler.rs`, inside
/// one transaction): fires each (task, kind) reminder whose lead time has
/// arrived and marks it so it never fires again — markers persist across
/// scans and app restarts. Once a task is overdue only the due reminder
/// fires; catching up a stale "in 1 hour" after downtime would be noise.
/// Tasks due more than [`REMINDER_CATCHUP_HOURS`] ago are skipped entirely.
pub fn scan_reminders(conn: &Connection, now: DateTime<Utc>) -> Result<Vec<Reminder>, AppError> {
    let cutoff = now - chrono::Duration::hours(REMINDER_CATCHUP_HOURS);
    let horizon = now + chrono::Duration::hours(1);
    let candidates = reminders::list_candidates(conn, cutoff, horizon)?;

    let tx = conn.unchecked_transaction()?;
    let mut fired = Vec::new();
    for candidate in candidates {
        for (kind, lead_minutes) in REMINDER_KIND_LEADS {
            if now < candidate.due_at - chrono::Duration::minutes(lead_minutes) {
                continue; // lead time not reached yet
            }
            if lead_minutes > 0 && now >= candidate.due_at {
                continue; // already overdue: only the due reminder applies
            }
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
    use crate::models::{NewSubtask, NewTag, NewTask, UpdateTask};
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
            },
        )
        .unwrap()
    }

    fn make_subtask(conn: &Connection, task_id: Uuid, title: &str) -> Subtask {
        create_subtask(
            conn,
            task_id,
            NewSubtask {
                title: title.into(),
            },
        )
        .unwrap()
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
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_found");
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
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_found");
        assert!(first.sort_order < second.sort_order);
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
            "unexpected snippet: {}", hits[0].snippet
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
        assert!(
            scan_reminders(&conn, due + chrono::Duration::hours(1))
                .unwrap()
                .is_empty()
        );
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
        assert!(
            scan_reminders(&conn, base + chrono::Duration::hours(1))
                .unwrap()
                .is_empty()
        );
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
    fn comment_crud_validates_and_soft_deletes() {
        let conn = conn();
        let task = make_task(&conn, "被评论的任务");

        // Unknown task and blank body are rejected.
        let err = create_comment(&conn, Uuid::new_v4(), NewComment { body: "你好".into() })
            .unwrap_err();
        assert_eq!(err.code(), "not_found");
        let err = create_comment(&conn, task.id, NewComment { body: "   ".into() }).unwrap_err();
        assert_eq!(err.code(), "validation");

        let comment = create_comment(&conn, task.id, NewComment { body: "  第一条评论  ".into() })
            .unwrap();
        assert_eq!(comment.body, "第一条评论");
        assert_eq!(
            list_comments(&conn, task.id).unwrap()[0].body,
            "第一条评论"
        );

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
        assert_eq!(delete_comment(&conn, comment.id).unwrap_err().code(), "not_found");
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
        create_comment(&conn, task.id, NewComment { body: "记得附上留存率曲线图".into() }).unwrap();

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
            },
        )
        .unwrap();
        assert_eq!(cleared.repeat_rule, None);
    }

    #[test]
    fn completing_a_repeating_task_spawns_the_next_instance() {
        let conn = conn();
        let tag = create_tag(&conn, NewTag { name: "家务".into(), color: None }).unwrap();
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
}

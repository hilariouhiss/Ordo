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

use std::collections::HashSet;

use chrono::Utc;
use rusqlite::Connection;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::{
    NewSubtask, NewTag, NewTask, Patch, Priority, Subtask, Tag, Task, UpdateSubtask, UpdateTag,
    UpdateTask,
};
use crate::repositories::{subtasks, tags, task_tags, tasks};
use crate::sort;

/// Sort keys longer than this trigger a sibling-list rebalance; keys normally
/// stay within a few characters (see the `sort` module docs).
const MAX_SORT_KEY_LEN: usize = 32;

fn not_found(what: &str, id: Uuid) -> AppError {
    AppError::NotFound(format!("{what} {id} 不存在"))
}

/// Trims and rejects blank titles/names shared by tasks, tags and subtasks.
fn validated_name(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("标题不能为空".into()));
    }
    Ok(trimmed.to_string())
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

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

pub fn list_tasks(conn: &Connection) -> Result<Vec<Task>, AppError> {
    tasks::list(conn)
}

/// Creates a task (plus tag links and initial subtasks) in one transaction;
/// the task is appended after the last task sharing its board-column scope
/// (inbox tasks share the `column_id = NULL` scope).
pub fn create_task(conn: &Connection, input: NewTask) -> Result<Task, AppError> {
    let title = validated_name(&input.title)?;
    let tag_ids = dedup(input.tag_ids);
    let now = Utc::now();

    let siblings: Vec<(Uuid, String)> = tasks::list(conn)?
        .into_iter()
        .filter(|t| t.column_id == input.column_id)
        .map(|t| (t.id, t.sort_order))
        .collect();
    let (sort_order, rebalanced) = append_key(&siblings)?;

    let tx = conn.unchecked_transaction()?;
    validate_tag_ids(&tx, &tag_ids)?;
    for (id, key) in &rebalanced {
        if !tasks::set_sort_order(&tx, *id, key, now)? {
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
        repeat_rule: None,
        sort_order,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    };
    tasks::insert(&tx, &task)?;
    task_tags::set_task_tags(&tx, task.id, &tag_ids)?;

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
            &tx,
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

    tx.commit()?;
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
/// the original timestamp. (Repeat-task instance generation arrives with
/// RP-01.)
pub fn complete_task(conn: &Connection, id: Uuid) -> Result<Task, AppError> {
    let mut task = tasks::get(conn, id)?.ok_or_else(|| not_found("任务", id))?;
    if task.completed_at.is_none() {
        task.completed_at = Some(Utc::now());
        task.updated_at = task.completed_at.expect("just set");
        tasks::update(conn, &task)?;
    }
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
/// ends). One-sided specs are resolved against the current list so the
/// derived neighbour pair is always tight — a bare `after(prev)` mid-list
/// could collide with the actual next item's key. Returns the task's full
/// subtask list in its new authoritative order, because other rows' keys
/// change whenever a rebalance kicks in.
pub fn reorder_subtask(
    conn: &Connection,
    id: Uuid,
    prev: Option<String>,
    next: Option<String>,
) -> Result<Vec<Subtask>, AppError> {
    let moved = subtasks::get(conn, id)?.ok_or_else(|| not_found("子任务", id))?;
    if prev.is_none() && next.is_none() {
        return Err(AppError::Validation("需要提供前驱或后继排序键".into()));
    }

    let now = Utc::now();
    let tx = conn.unchecked_transaction()?;
    let siblings: Vec<Subtask> = subtasks::list_by_task(&tx, moved.task_id)?
        .into_iter()
        .filter(|s| s.id != id)
        .collect();
    let position_of = |key: &str| siblings.iter().position(|s| s.sort_order == key);

    let require_sibling = |key: &str| -> Result<usize, AppError> {
        position_of(key)
            .ok_or_else(|| AppError::Validation(format!("排序键 {key:?} 不属于该任务的子任务")))
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
                .map(|i| siblings[i].sort_order.clone()),
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
                .map(|s| s.sort_order.clone()),
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
        Ok(key) => {
            if !subtasks::set_sort_order(&tx, id, &key, now)? {
                return Err(not_found("子任务", id));
            }
        }
        Err(sort::SortError::Exhausted) => {
            // No key fits between the neighbours: rekey the task's whole
            // subtask list with evenly spaced keys, keeping the moved item at
            // its target position.
            let target = match &prev_key {
                Some(p) => require_sibling(p).expect("validated above") + 1,
                None => match &next_key {
                    Some(n) => require_sibling(n).expect("validated above"),
                    None => siblings.len(),
                },
            };
            let mut ordered = siblings;
            ordered.insert(target.min(ordered.len()), moved.clone());
            let fresh = sort::spread(ordered.len());
            for (subtask, key) in ordered.iter().zip(fresh) {
                if !subtasks::set_sort_order(&tx, subtask.id, &key, now)? {
                    return Err(not_found("子任务", subtask.id));
                }
            }
        }
        Err(e) => return Err(e.into()),
    }
    tx.commit()?;
    subtasks::list_by_task(conn, moved.task_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::{NewSubtask, NewTag, NewTask, UpdateTask};

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
}

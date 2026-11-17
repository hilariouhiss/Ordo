use crate::dto::{
    RequirementChangeDto, RequirementDto, RequirementPatch, RequirementStatusDto,
    RequirementStatusInput, TaskDto,
};
use crate::repo::{categories, numbering, people, projects, requirements, settings};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use uuid::Uuid;

/// The built-in pipeline used before anyone saved a global default.
fn builtin_status_names(conn: &Connection) -> Vec<String> {
    if settings::language(conn) == "en" {
        vec!["To do".into(), "In progress".into(), "Done".into()]
    } else {
        vec!["待办".into(), "进行中".into(), "已完成".into()]
    }
}

/// The names new projects copy. The global default is a template: editing it never
/// touches a project that already has its own pipeline.
pub fn default_status_names(conn: &Connection) -> Vec<String> {
    if let Some(stored) = settings::get(conn, settings::keys::REQUIREMENT_DEFAULT_STATUSES)
        .ok()
        .flatten()
    {
        if let Ok(names) = serde_json::from_str::<Vec<String>>(&stored) {
            let names: Vec<String> = names
                .into_iter()
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .collect();
            if !names.is_empty() {
                return names;
            }
        }
    }
    builtin_status_names(conn)
}

fn clean_names(names: &[String]) -> Result<Vec<String>, String> {
    let mut cleaned: Vec<String> = Vec::new();
    for name in names {
        let name = name.trim();
        if name.is_empty() {
            return Err("empty_status_name".into());
        }
        if cleaned.iter().any(|seen| seen.eq_ignore_ascii_case(name)) {
            return Err("duplicate_status_name".into());
        }
        cleaned.push(name.to_string());
    }
    if cleaned.is_empty() {
        return Err("last_status_required".into());
    }
    Ok(cleaned)
}

pub fn save_default_statuses(conn: &Connection, names: &[String]) -> Result<Vec<String>, String> {
    let names = clean_names(names)?;
    let text = serde_json::to_string(&names).map_err(|e| e.to_string())?;
    settings::set(conn, settings::keys::REQUIREMENT_DEFAULT_STATUSES, &text)
        .map_err(|e| e.to_string())?;
    Ok(names)
}

/// Adds the global default pipeline to a project that has none yet. The caller owns the
/// transaction; a brand-new project seeds in the same transaction that creates it.
pub fn seed_statuses_in(conn: &Connection, project_id: &str, now: &str) -> Result<(), String> {
    if requirements::status_count(conn, project_id).map_err(|e| e.to_string())? > 0 {
        return Ok(());
    }
    for (index, name) in default_status_names(conn).into_iter().enumerate() {
        requirements::insert_status(
            conn,
            &Uuid::new_v4().to_string(),
            project_id,
            &name,
            index as i64,
            now,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The project's live pipeline, seeding the defaults for a ledger written before this
/// feature existed. Reading it may write once; a seeded project never writes again.
pub fn statuses(
    conn: &Connection,
    project_id: &str,
    now: &str,
) -> Result<Vec<RequirementStatusDto>, String> {
    if requirements::status_count(conn, project_id).map_err(|e| e.to_string())? == 0 {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        seed_statuses_in(&tx, project_id, now)?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    requirements::list_statuses(conn, project_id).map_err(|e| e.to_string())
}

/// A whole pipeline edit in one transaction. Removed statuses hand their requirements to
/// the nearest surviving status before the row is deleted, so nothing is orphaned.
pub fn save_statuses(
    conn: &Connection,
    project_id: &str,
    entries: &[RequirementStatusInput],
    now: &str,
) -> Result<Vec<RequirementStatusDto>, String> {
    if !projects::exists(conn, project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    statuses(conn, project_id, now)?;
    let existing = requirements::list_statuses(conn, project_id).map_err(|e| e.to_string())?;

    let names = clean_names(
        &entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect::<Vec<_>>(),
    )?;

    let existing_ids: HashSet<&str> = existing.iter().map(|row| row.id.as_str()).collect();
    let mut seen: HashSet<&str> = HashSet::new();
    for entry in entries {
        if let Some(id) = entry.id.as_deref() {
            if !existing_ids.contains(id) || !seen.insert(id) {
                return Err("invalid_status".into());
            }
        }
    }

    let final_ids: Vec<String> = entries
        .iter()
        .map(|entry| entry.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string()))
        .collect();
    let final_set: HashSet<&str> = final_ids.iter().map(String::as_str).collect();

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut removed: Vec<(String, String)> = Vec::new();
    for (position, status) in existing.iter().enumerate() {
        if final_set.contains(status.id.as_str()) {
            continue;
        }
        let target = existing[..position]
            .iter()
            .rev()
            .find(|candidate| final_set.contains(candidate.id.as_str()))
            .or_else(|| {
                existing[position + 1..]
                    .iter()
                    .find(|candidate| final_set.contains(candidate.id.as_str()))
            })
            .map(|candidate| candidate.id.clone())
            .ok_or_else(|| "last_status_required".to_string())?;
        let moved = requirements::in_status(&tx, project_id, &status.id)
            .map_err(|e| e.to_string())?;
        requirements::reassign_status(&tx, project_id, &status.id, &target, now)
            .map_err(|e| e.to_string())?;
        let target_name = existing
            .iter()
            .find(|candidate| candidate.id == target)
            .map(|candidate| candidate.name.clone())
            .unwrap_or_default();
        for requirement_id in moved {
            requirements::insert_change(
                &tx,
                &requirement_id,
                "status",
                Some(&status.name),
                Some(&target_name),
                now,
            )
            .map_err(|e| e.to_string())?;
        }
        removed.push((status.id.clone(), status.name.clone()));
    }

    for (index, entry) in entries.iter().enumerate() {
        match entry.id.as_deref() {
            Some(id) => {
                requirements::update_status(&tx, id, &names[index], index as i64)
                    .map_err(|e| e.to_string())?;
            }
            None => {
                requirements::insert_status(
                    &tx,
                    &final_ids[index],
                    project_id,
                    &names[index],
                    index as i64,
                    now,
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    for (id, _) in removed {
        requirements::delete_status(&tx, &id).map_err(|e| e.to_string())?;
    }
    requirements::clear_null_statuses(&tx, project_id, &final_ids[0], now)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    requirements::list_statuses(conn, project_id).map_err(|e| e.to_string())
}

fn insert_row_in(
    conn: &Connection,
    project_id: &str,
    title: &str,
    status_id: &str,
    now: &str,
) -> Result<(String, String), String> {
    let format = projects::numbering(conn, project_id).map_err(|e| e.to_string())?;
    let prefix = format!("{}{}", format.project_prefix, format.requirement_prefix);
    let (seq, number) = numbering::next_number(
        conn,
        project_id,
        "requirements",
        &prefix,
        format.requirement_width,
    )
    .map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    requirements::insert(conn, &id, project_id, &number, seq, status_id, title, now)
        .map_err(|e| e.to_string())?;
    Ok((id, number))
}

pub fn create(
    conn: &Connection,
    project_id: &str,
    title: &str,
    now: &str,
) -> Result<RequirementDto, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("empty_requirement_title".into());
    }
    if !projects::exists(conn, project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    let pipeline = statuses(conn, project_id, now)?;
    let first = pipeline.first().ok_or("last_status_required")?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let (id, number) = insert_row_in(&tx, project_id, title, &first.id, now)?;
    requirements::insert_change(&tx, &id, "created", None, Some(&number), now)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    requirements::dto(conn, &id).map_err(|e| e.to_string())
}

/// The reader's selection: the chapter link and the quote are written together with the
/// requirement, so a failure never leaves a requirement with a dangling selection.
pub fn create_from_section(
    conn: &Connection,
    section_id: &str,
    title: &str,
    quote: &str,
    now: &str,
) -> Result<RequirementDto, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("empty_requirement_title".into());
    }
    let Some((project_id, _, document_title, section_title)) =
        requirements::section_info(conn, section_id).map_err(|e| e.to_string())?
    else {
        return Err("invalid_section".into());
    };
    if !projects::exists(conn, &project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    let pipeline = statuses(conn, &project_id, now)?;
    let first = pipeline.first().ok_or("last_status_required")?;
    let quote = quote.trim();
    let quote = if quote.is_empty() {
        None
    } else {
        Some(quote.chars().take(2000).collect::<String>())
    };
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let (id, number) = insert_row_in(&tx, &project_id, title, &first.id, now)?;
    requirements::insert_change(&tx, &id, "created", None, Some(&number), now)
        .map_err(|e| e.to_string())?;
    requirements::link_section(&tx, &id, section_id, quote.as_deref(), now)
        .map_err(|e| e.to_string())?;
    requirements::insert_change(
        &tx,
        &id,
        "section_linked",
        None,
        Some(&format!("{document_title} · {section_title}")),
        now,
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    requirements::dto(conn, &id).map_err(|e| e.to_string())
}

fn name_of(conn: &Connection, table: &str, id: &str) -> Option<String> {
    conn.query_row(&format!("SELECT name FROM {table} WHERE id = ?1"), [id], |r| {
        r.get(0)
    })
    .optional()
    .ok()
    .flatten()
}

pub fn update(
    conn: &Connection,
    id: &str,
    patch: &RequirementPatch,
    now: &str,
) -> Result<RequirementDto, String> {
    let Some(_project_id) = requirements::project_of(conn, id).map_err(|e| e.to_string())? else {
        return Err("requirement_not_found".into());
    };
    let old_title = requirements::title_of(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("requirement_not_found")?;
    let (old_category, old_owner): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT category_id, owner_id FROM requirements WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    if let Some(title) = patch.title.as_deref() {
        if title.trim().is_empty() {
            return Err("empty_requirement_title".into());
        }
    }
    if let Some(Some(category_id)) = patch.category_id.as_ref() {
        if !categories::exists(conn, category_id).map_err(|e| e.to_string())? {
            return Err("invalid_category".into());
        }
    }
    if let Some(Some(owner_id)) = patch.owner_id.as_ref() {
        if !people::exists(conn, owner_id).map_err(|e| e.to_string())? {
            return Err("invalid_owner".into());
        }
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if let Some(title) = patch.title.as_deref() {
        let title = title.trim();
        if title != old_title {
            requirements::set_title(&tx, id, title, now).map_err(|e| e.to_string())?;
            requirements::insert_change(&tx, id, "title", Some(&old_title), Some(title), now)
                .map_err(|e| e.to_string())?;
        }
    }
    if let Some(value) = patch.category_id.as_ref() {
        let next = value.as_deref();
        if next != old_category.as_deref() {
            let old_name = old_category.and_then(|old| name_of(conn, "categories", &old));
            let new_name = next.and_then(|new| name_of(conn, "categories", new));
            requirements::set_category(&tx, id, next, now).map_err(|e| e.to_string())?;
            requirements::insert_change(
                &tx,
                id,
                "category",
                old_name.as_deref(),
                new_name.as_deref(),
                now,
            )
            .map_err(|e| e.to_string())?;
        }
    }
    if let Some(value) = patch.owner_id.as_ref() {
        let next = value.as_deref();
        if next != old_owner.as_deref() {
            let old_name = old_owner.and_then(|old| name_of(conn, "people", &old));
            let new_name = next.and_then(|new| name_of(conn, "people", new));
            requirements::set_owner(&tx, id, next, now).map_err(|e| e.to_string())?;
            requirements::insert_change(
                &tx,
                id,
                "owner",
                old_name.as_deref(),
                new_name.as_deref(),
                now,
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    requirements::dto(conn, id).map_err(|e| e.to_string())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    requirements::delete(conn, id).map_err(|e| e.to_string())
}

fn advance_in(
    conn: &Connection,
    id: &str,
    auto: bool,
    now: &str,
) -> Result<bool, String> {
    let Some(project_id) = requirements::project_of(conn, id).map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    let pipeline = requirements::list_statuses(conn, &project_id).map_err(|e| e.to_string())?;
    let Some(current) = requirements::status_of(conn, id)
        .map_err(|e| e.to_string())?
        .flatten()
    else {
        return Ok(false);
    };
    let Some(index) = pipeline.iter().position(|status| status.id == current) else {
        return Ok(false);
    };
    let Some(next) = pipeline.get(index + 1) else {
        return Ok(false);
    };
    // A parent and its child finishing in one operation share this stamp; the first
    // advance owns the move and the second is the same event.
    if requirements::status_changed_at(conn, id, now).map_err(|e| e.to_string())? {
        return Ok(false);
    }
    // A savepoint works both inside the caller's transaction and on its own; the
    // rusqlite handle needs &mut, so the SQL is issued directly.
    conn.execute_batch("SAVEPOINT requirement_advance")
        .map_err(|e| e.to_string())?;
    let write = (|| -> Result<(), String> {
        requirements::set_status(conn, id, &next.id, now).map_err(|e| e.to_string())?;
        requirements::insert_change(
            conn,
            id,
            if auto { "status_auto" } else { "status" },
            Some(&pipeline[index].name),
            Some(&next.name),
            now,
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })();
    match write {
        Ok(()) => {
            conn.execute_batch("RELEASE SAVEPOINT requirement_advance")
                .map_err(|e| e.to_string())?;
            Ok(true)
        }
        Err(error) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO SAVEPOINT requirement_advance;
                 RELEASE SAVEPOINT requirement_advance",
            );
            Err(error)
        }
    }
}

pub fn advance(conn: &Connection, id: &str, now: &str) -> Result<RequirementDto, String> {
    if !requirements::exists(conn, id).map_err(|e| e.to_string())? {
        return Err("requirement_not_found".into());
    }
    advance_in(conn, id, false, now)?;
    requirements::dto(conn, id).map_err(|e| e.to_string())
}

/// After a task became done: when every task the requirement owns is done, the pipeline
/// moves one step. Called inside the caller's transaction where one exists.
pub fn advance_for_task_in(conn: &Connection, task_id: &str, now: &str) -> Result<(), String> {
    let requirement_id: Option<String> = conn
        .query_row(
            "SELECT requirement_id FROM tasks WHERE id = ?1",
            [task_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let Some(requirement_id) = requirement_id else {
        return Ok(());
    };
    let mut stmt = conn
        .prepare(
            "SELECT status FROM tasks
             WHERE requirement_id = ?1 AND deleted_at IS NULL AND canceled_at IS NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&requirement_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let statuses: Vec<String> = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    if statuses.is_empty() || statuses.iter().any(|status| status != "done") {
        return Ok(());
    }
    advance_in(conn, &requirement_id, true, now)?;
    Ok(())
}

/// After a task was reopened: takes back the advance its own completion caused, so one
/// piece of work cannot move the pipeline twice when it is finished again. Only an
/// automatic step is undone, and only while this was the requirement's last open task.
pub fn reopen_for_task_in(conn: &Connection, task_id: &str, now: &str) -> Result<(), String> {
    let requirement_id: Option<String> = conn
        .query_row(
            "SELECT requirement_id FROM tasks WHERE id = ?1",
            [task_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let Some(requirement_id) = requirement_id else {
        return Ok(());
    };
    let others_open: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE requirement_id = ?1 AND id <> ?2 AND deleted_at IS NULL
               AND canceled_at IS NULL AND status <> 'done'",
            params![&requirement_id, task_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if others_open > 0 {
        return Ok(());
    }
    // A stage a person picked stays: only an automatic advance is undone.
    let automatic = conn
        .query_row(
            "SELECT kind FROM requirement_changes
             WHERE requirement_id = ?1 AND kind IN ('status','status_auto')
             ORDER BY created_at DESC LIMIT 1",
            [&requirement_id],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("status_auto");
    if !automatic {
        return Ok(());
    }
    let Some(project_id) =
        requirements::project_of(conn, &requirement_id).map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    let pipeline =
        requirements::list_statuses(conn, &project_id).map_err(|e| e.to_string())?;
    let Some(current) = requirements::status_of(conn, &requirement_id)
        .map_err(|e| e.to_string())?
        .flatten()
    else {
        return Ok(());
    };
    let Some(index) = pipeline.iter().position(|status| status.id == current) else {
        return Ok(());
    };
    let Some(previous) = index.checked_sub(1).and_then(|at| pipeline.get(at)) else {
        return Ok(());
    };
    requirements::set_status(conn, &requirement_id, &previous.id, now)
        .map_err(|e| e.to_string())?;
    requirements::insert_change(
        conn,
        &requirement_id,
        "status_reopen",
        Some(&pipeline[index].name),
        Some(&previous.name),
        now,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// A task's requirement link moved: log the unlink on the old requirement and the link on
/// the new one. The caller owns the transaction and has already validated the project.
pub fn task_link_changed_in(
    conn: &Connection,
    task_id: &str,
    before: Option<&str>,
    now: &str,
) -> Result<(), String> {
    let after: Option<String> = conn
        .query_row(
            "SELECT requirement_id FROM tasks WHERE id = ?1",
            [task_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(|e| e.to_string())?;
    if before == after.as_deref() {
        return Ok(());
    }
    let title = conn
        .query_row("SELECT title FROM tasks WHERE id = ?1", [task_id], |r| {
            r.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    if let Some(before) = before {
        requirements::insert_change(&*conn, before, "task_unlinked", Some(&title), None, now)
            .map_err(|e| e.to_string())?;
    }
    if let Some(after) = after {
        requirements::insert_change(&*conn, &after, "task_linked", None, Some(&title), now)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn link_section(
    conn: &Connection,
    requirement_id: &str,
    section_id: &str,
    now: &str,
) -> Result<(), String> {
    let Some(project_id) = requirements::project_of(conn, requirement_id).map_err(|e| e.to_string())?
    else {
        return Err("requirement_not_found".into());
    };
    let Some((section_project, _, document_title, section_title)) =
        requirements::section_info(conn, section_id).map_err(|e| e.to_string())?
    else {
        return Err("invalid_section".into());
    };
    if section_project != project_id {
        return Err("invalid_section".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let existed: bool = tx
        .query_row(
            "SELECT 1 FROM requirement_sections WHERE requirement_id = ?1 AND section_id = ?2",
            params![requirement_id, section_id],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !existed {
        requirements::link_section(&tx, requirement_id, section_id, None, now)
            .map_err(|e| e.to_string())?;
        requirements::insert_change(
            &tx,
            requirement_id,
            "section_linked",
            None,
            Some(&format!("{document_title} · {section_title}")),
            now,
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn unlink_section(
    conn: &Connection,
    requirement_id: &str,
    section_id: &str,
    now: &str,
) -> Result<(), String> {
    let Some((_, _, document_title, section_title)) =
        requirements::section_info(conn, section_id).map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "DELETE FROM requirement_sections WHERE requirement_id = ?1 AND section_id = ?2",
            params![requirement_id, section_id],
        )
        .map_err(|e| e.to_string())?;
    if changed > 0 {
        requirements::insert_change(
            &tx,
            requirement_id,
            "section_unlinked",
            Some(&format!("{document_title} · {section_title}")),
            None,
            now,
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn create_task(
    conn: &Connection,
    requirement_id: &str,
    title: &str,
    now: &str,
) -> Result<TaskDto, String> {
    let project_id = requirements::project_of(conn, requirement_id)
        .map_err(|e| e.to_string())?
        .ok_or("requirement_not_found")?;
    crate::services::tasks::create_linked_task(
        conn,
        &project_id,
        title,
        crate::services::tasks::TaskLink::Requirement(requirement_id),
        now,
    )
}

pub fn list(
    conn: &Connection,
    project_id: &str,
    now: &str,
) -> Result<Vec<RequirementDto>, String> {
    if !projects::exists(conn, project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    statuses(conn, project_id, now)?;
    requirements::list(conn, project_id).map_err(|e| e.to_string())
}

pub fn changes(
    conn: &Connection,
    requirement_id: &str,
) -> Result<Vec<RequirementChangeDto>, String> {
    requirements::changes(conn, requirement_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::dto::{ProjectNumberingDto, TaskPatch};
    use crate::repo::requirements as requirement_repo;
    use crate::services::{projects, tasks};

    const NOW: &str = "2026-11-17T01:00:00Z";
    const LATER: &str = "2026-11-17T02:00:00Z";

    fn setup() -> Connection {
        let c = db::open_in_memory().unwrap();
        settings::set(&c, settings::keys::LANGUAGE, "zh").unwrap();
        c.execute(
            "INSERT INTO people (id, name, is_me, created_at, updated_at)
             VALUES ('me', '我', 1, ?1, ?1)",
            [NOW],
        )
        .unwrap();
        c
    }

    fn project(c: &Connection) -> String {
        projects::create(c, "华东客户交付", NOW).unwrap().id
    }

    fn names(conn: &Connection, project_id: &str) -> Vec<String> {
        statuses(conn, project_id, NOW)
            .unwrap()
            .into_iter()
            .map(|status| status.name)
            .collect()
    }

    #[test]
    fn a_new_project_copies_the_global_pipeline() {
        let c = setup();
        let p = project(&c);
        assert_eq!(names(&c, &p), ["待办", "进行中", "已完成"]);
    }

    #[test]
    fn new_projects_copy_the_saved_global_default_and_keep_their_copy() {
        let c = setup();
        save_default_statuses(&c, &["待评估".into(), "实现".into(), "验收".into()]).unwrap();
        let p = project(&c);
        assert_eq!(names(&c, &p), ["待评估", "实现", "验收"]);
        save_default_statuses(&c, &["新的".into()]).unwrap();
        assert_eq!(names(&c, &p), ["待评估", "实现", "验收"]);
    }

    #[test]
    fn requirements_and_issues_number_from_the_project_format() {
        let c = setup();
        let p = project(&c);
        assert_eq!(create(&c, &p, "需求一", NOW).unwrap().number, "REQ-001");
        assert_eq!(create(&c, &p, "需求二", NOW).unwrap().number, "REQ-002");
        assert_eq!(
            crate::services::issues::create(&c, &p, "问题一", NOW)
                .unwrap()
                .number,
            "ISS-001"
        );
    }

    #[test]
    fn a_project_prefix_goes_before_the_type_prefix() {
        let c = setup();
        let p = project(&c);
        let mut format = crate::repo::projects::numbering(&c, &p).unwrap();
        format.project_prefix = "ORDO-".into();
        projects::update(&c, &p, "华东客户交付", None, "normal", &format, LATER).unwrap();

        assert_eq!(
            create(&c, &p, "需求一", NOW).unwrap().number,
            "ORDO-REQ-001"
        );
        assert_eq!(
            crate::services::issues::create(&c, &p, "问题一", NOW)
                .unwrap()
                .number,
            "ORDO-ISS-001"
        );
    }

    #[test]
    fn a_changed_format_only_numbers_new_entries() {
        let c = setup();
        let p = project(&c);
        create(&c, &p, "需求一", NOW).unwrap();
        let mut format: ProjectNumberingDto = crate::repo::projects::numbering(&c, &p).unwrap();
        format.requirement_prefix = "BUG-".into();
        format.requirement_width = 4;
        projects::update(&c, &p, "华东客户交付", None, "normal", &format, LATER).unwrap();
        assert_eq!(create(&c, &p, "需求二", NOW).unwrap().number, "BUG-0002");
        assert!(list(&c, &p, NOW).unwrap().iter().any(|r| r.number == "REQ-001"));
    }

    #[test]
    fn manual_advance_moves_one_step_and_stops_at_the_end() {
        let c = setup();
        let p = project(&c);
        let pipeline = statuses(&c, &p, NOW).unwrap();
        let req = create(&c, &p, "导出报表", NOW).unwrap();
        let req = advance(&c, &req.id, LATER).unwrap();
        assert_eq!(req.status_id.as_deref(), Some(pipeline[1].id.as_str()));
        let req = advance(&c, &req.id, "2026-11-17T02:30:00Z").unwrap();
        assert_eq!(req.status_id.as_deref(), Some(pipeline[2].id.as_str()));
        let req = advance(&c, &req.id, "2026-11-17T03:00:00Z").unwrap();
        assert_eq!(req.status_id.as_deref(), Some(pipeline[2].id.as_str()));
        assert_eq!(
            changes(&c, &req.id)
                .unwrap()
                .iter()
                .filter(|change| change.kind == "status")
                .count(),
            2
        );
    }

    #[test]
    fn deleting_a_used_status_moves_requirements_and_logs_it() {
        let c = setup();
        let p = project(&c);
        let pipeline = statuses(&c, &p, NOW).unwrap();
        let req = advance(&c, &create(&c, &p, "导出报表", NOW).unwrap().id, LATER).unwrap();
        let entries = vec![
            RequirementStatusInput {
                id: Some(pipeline[0].id.clone()),
                name: pipeline[0].name.clone(),
            },
            RequirementStatusInput {
                id: Some(pipeline[2].id.clone()),
                name: pipeline[2].name.clone(),
            },
        ];
        let after = save_statuses(&c, &p, &entries, LATER).unwrap();
        assert_eq!(after.len(), 2);
        let moved = requirement_repo::dto(&c, &req.id).unwrap();
        // The previous surviving status takes the orphaned requirements.
        assert_eq!(moved.status_id.as_deref(), Some(pipeline[0].id.as_str()));
        assert!(changes(&c, &req.id).unwrap().iter().any(|change| {
            change.kind == "status"
                && change.from_value.as_deref() == Some("进行中")
                && change.to_value.as_deref() == Some("待办")
        }));
    }

    #[test]
    fn an_empty_or_duplicate_pipeline_is_refused() {
        let c = setup();
        let p = project(&c);
        assert_eq!(
            save_statuses(&c, &p, &[], LATER).unwrap_err(),
            "last_status_required"
        );
        let duplicate = vec![
            RequirementStatusInput {
                id: None,
                name: "A".into(),
            },
            RequirementStatusInput {
                id: None,
                name: "A".into(),
            },
        ];
        assert_eq!(
            save_statuses(&c, &p, &duplicate, LATER).unwrap_err(),
            "duplicate_status_name"
        );
    }

    #[test]
    fn subject_fields_are_validated_and_logged() {
        let c = setup();
        c.execute(
            "INSERT INTO categories (id, name, sort_order, created_at, updated_at)
             VALUES ('cat', '软件', 0, ?1, ?1)",
            [NOW],
        )
        .unwrap();
        c.execute(
            "INSERT INTO people (id, name, is_me, created_at, updated_at)
             VALUES ('li', '张三', 0, ?1, ?1)",
            [NOW],
        )
        .unwrap();
        let p = project(&c);
        let req = create(&c, &p, "旧标题", NOW).unwrap();
        let patch = RequirementPatch {
            title: Some("新标题".into()),
            category_id: Some(Some("cat".into())),
            owner_id: Some(Some("li".into())),
        };
        let updated = update(&c, &req.id, &patch, LATER).unwrap();
        assert_eq!(updated.title, "新标题");
        assert_eq!(updated.category_id.as_deref(), Some("cat"));
        assert_eq!(updated.owner_id.as_deref(), Some("li"));
        let log = changes(&c, &req.id).unwrap();
        assert!(log.iter().any(|change| change.kind == "title"));
        assert!(log
            .iter()
            .any(|change| change.kind == "category" && change.to_value.as_deref() == Some("软件")));
        assert!(log
            .iter()
            .any(|change| change.kind == "owner" && change.to_value.as_deref() == Some("张三")));
        // Removing a person who owns a requirement is refused, as for task owners.
        assert_eq!(
            crate::services::people::delete(&c, "li").unwrap_err(),
            "person_in_use"
        );
        assert_eq!(
            update(
                &c,
                &req.id,
                &RequirementPatch {
                    title: Some(" ".into()),
                    ..Default::default()
                },
                LATER,
            )
            .unwrap_err(),
            "empty_requirement_title"
        );
    }

    #[test]
    fn sections_link_only_inside_the_project() {
        let c = setup();
        let p = project(&c);
        let other = projects::create(&c, "另一个项目", NOW).unwrap().id;
        crate::repo::documents::insert_document(&c, "doc1", &p, "附件", "附件.md", NOW).unwrap();
        crate::repo::documents::insert_section(&c, "s1", "doc1", "3.2 报表", 2, "正文", 0).unwrap();
        crate::repo::documents::insert_document(&c, "doc2", &other, "别的", "别的.md", NOW)
            .unwrap();
        crate::repo::documents::insert_section(&c, "s2", "doc2", "范围", 1, "正文", 0).unwrap();
        let req = create(&c, &p, "导出报表", NOW).unwrap();
        assert_eq!(
            link_section(&c, &req.id, "s2", LATER).unwrap_err(),
            "invalid_section"
        );
        link_section(&c, &req.id, "s1", LATER).unwrap();
        let dto = requirement_repo::dto(&c, &req.id).unwrap();
        assert_eq!(dto.sections.len(), 1);
        assert_eq!(dto.sections[0].document_title, "附件");
        unlink_section(&c, &req.id, "s1", LATER).unwrap();
        assert!(requirement_repo::dto(&c, &req.id)
            .unwrap()
            .sections
            .is_empty());
        let log = changes(&c, &req.id).unwrap();
        assert!(log.iter().any(|change| change.kind == "section_linked"));
        assert!(log
            .iter()
            .any(|change| change.kind == "section_unlinked"));
    }

    #[test]
    fn a_task_created_from_a_requirement_is_linked_and_logged() {
        let c = setup();
        let p = project(&c);
        let req = create(&c, &p, "导出报表", NOW).unwrap();
        let task = create_task(&c, &req.id, "写导出接口", NOW).unwrap();
        assert_eq!(task.requirement_id.as_deref(), Some(req.id.as_str()));
        assert_eq!(task.project_id.as_deref(), Some(p.as_str()));
        assert_eq!(
            requirement_repo::dto(&c, &req.id).unwrap().tasks.len(),
            1
        );
        assert!(changes(&c, &req.id)
            .unwrap()
            .iter()
            .any(|change| change.kind == "task_created"));
    }

    #[test]
    fn a_task_links_and_unlinks_through_the_patch_and_follows_its_project() {
        let c = setup();
        let p = project(&c);
        let req = create(&c, &p, "导出报表", NOW).unwrap();
        let task = crate::services::week::capture_with_fields(
            &c,
            "写导出接口",
            &crate::dto::CaptureFields {
                project_id: Some(p.clone()),
                ..Default::default()
            },
            NOW,
            "t1",
        )
        .unwrap();

        let linked = tasks::update_patch(
            &c,
            &task.id,
            &TaskPatch {
                requirement_id: Some(Some(req.id.clone())),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();
        assert_eq!(linked.requirement_id.as_deref(), Some(req.id.as_str()));

        let other = projects::create(&c, "另一个项目", NOW).unwrap();
        let foreign = create(&c, &other.id, "别的需求", NOW).unwrap();
        assert_eq!(
            tasks::update_patch(
                &c,
                &task.id,
                &TaskPatch {
                    requirement_id: Some(Some(foreign.id)),
                    ..Default::default()
                },
                LATER,
            )
            .unwrap_err(),
            "invalid_requirement"
        );

        let moved = tasks::update_patch(
            &c,
            &task.id,
            &TaskPatch {
                project_id: Some(Some(other.id)),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();
        assert!(moved.requirement_id.is_none());
        let log = changes(&c, &req.id).unwrap();
        assert!(log.iter().any(|change| change.kind == "task_linked"));
        assert!(log.iter().any(|change| change.kind == "task_unlinked"));
    }

    #[test]
    fn finishing_every_linked_task_advances_the_requirement_once() {
        let c = setup();
        let p = project(&c);
        let pipeline = statuses(&c, &p, NOW).unwrap();
        let req = create(&c, &p, "导出报表", NOW).unwrap();
        let one = create_task(&c, &req.id, "任务一", NOW).unwrap();
        let two = create_task(&c, &req.id, "任务二", NOW).unwrap();
        tasks::set_status(&c, &one.id, "done", NOW).unwrap();
        assert_eq!(
            requirement_repo::dto(&c, &req.id)
                .unwrap()
                .status_id
                .as_deref(),
            Some(pipeline[0].id.as_str())
        );
        tasks::set_status(&c, &two.id, "done", LATER).unwrap();
        assert_eq!(
            requirement_repo::dto(&c, &req.id)
                .unwrap()
                .status_id
                .as_deref(),
            Some(pipeline[1].id.as_str())
        );
        // Editing the finished task is not another completion.
        tasks::update_patch(
            &c,
            &two.id,
            &TaskPatch {
                note: Some(Some("验收完成".into())),
                ..Default::default()
            },
            "2026-11-17T03:00:00Z",
        )
        .unwrap();
        assert_eq!(
            requirement_repo::dto(&c, &req.id)
                .unwrap()
                .status_id
                .as_deref(),
            Some(pipeline[1].id.as_str())
        );
        assert_eq!(
            changes(&c, &req.id)
                .unwrap()
                .iter()
                .filter(|change| change.kind == "status_auto")
                .count(),
            1
        );
    }

    fn status_id(c: &Connection, requirement_id: &str) -> Option<String> {
        requirement_repo::dto(c, requirement_id)
            .unwrap()
            .status_id
    }

    #[test]
    fn reopening_the_task_takes_back_the_automatic_step() {
        let c = setup();
        let p = project(&c);
        let pipeline = statuses(&c, &p, NOW).unwrap();
        let req = create(&c, &p, "导出报表", NOW).unwrap();
        let task = create_task(&c, &req.id, "任务一", NOW).unwrap();

        tasks::set_status(&c, &task.id, "done", NOW).unwrap();
        assert_eq!(status_id(&c, &req.id).as_deref(), Some(pipeline[1].id.as_str()));

        // Clearing the finish reopens the task, so the step its completion caused goes back.
        tasks::update_patch(
            &c,
            &task.id,
            &TaskPatch {
                actual_finish_at: Some(None),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();
        assert_eq!(status_id(&c, &req.id).as_deref(), Some(pipeline[0].id.as_str()));

        // Finishing it again advances once, never twice.
        tasks::set_status(&c, &task.id, "done", "2026-11-17T04:00:00Z").unwrap();
        assert_eq!(status_id(&c, &req.id).as_deref(), Some(pipeline[1].id.as_str()));
        assert_eq!(
            changes(&c, &req.id)
                .unwrap()
                .iter()
                .filter(|change| change.kind == "status_auto")
                .count(),
            2
        );
    }

    #[test]
    fn a_stage_a_person_picked_survives_a_reopen() {
        let c = setup();
        let p = project(&c);
        let pipeline = statuses(&c, &p, NOW).unwrap();
        let req = create(&c, &p, "导出报表", NOW).unwrap();
        let task = create_task(&c, &req.id, "任务一", NOW).unwrap();
        tasks::set_status(&c, &task.id, "done", NOW).unwrap();
        // A hand move is the newest one, so the automatic step is no longer the last word.
        advance(&c, &req.id, LATER).unwrap();

        tasks::update_patch(
            &c,
            &task.id,
            &TaskPatch {
                actual_finish_at: Some(None),
                ..Default::default()
            },
            "2026-11-17T05:00:00Z",
        )
        .unwrap();

        assert_eq!(status_id(&c, &req.id).as_deref(), Some(pipeline[2].id.as_str()));
    }
}


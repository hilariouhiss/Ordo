use crate::dto::{IssueDto, IssuePatch, TaskDto};
use crate::repo::{issues, numbering, projects, requirements};
use rusqlite::Connection;
use uuid::Uuid;

fn valid_status(status: &str) -> bool {
    matches!(status, "open" | "doing" | "resolved")
}

pub fn create(
    conn: &Connection,
    project_id: &str,
    title: &str,
    now: &str,
) -> Result<IssueDto, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("empty_issue_title".into());
    }
    if !projects::exists(conn, project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    let format = projects::numbering(conn, project_id).map_err(|e| e.to_string())?;
    let (seq, number) = numbering::next_number(
        conn,
        project_id,
        "issues",
        &format.issue_prefix,
        format.issue_width,
    )
    .map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    issues::insert(conn, &id, project_id, &number, seq, title, now)
        .map_err(|e| e.to_string())?;
    issues::dto(conn, &id).map_err(|e| e.to_string())
}

pub fn list(conn: &Connection, project_id: &str) -> Result<Vec<IssueDto>, String> {
    if !projects::exists(conn, project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    issues::list(conn, project_id).map_err(|e| e.to_string())
}

pub fn update(
    conn: &Connection,
    id: &str,
    patch: &IssuePatch,
    now: &str,
) -> Result<IssueDto, String> {
    let project_id = issues::project_of(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("issue_not_found")?;
    if let Some(title) = patch.title.as_deref() {
        if title.trim().is_empty() {
            return Err("empty_issue_title".into());
        }
    }
    if let Some(status) = patch.status.as_deref() {
        if !valid_status(status) {
            return Err("invalid_issue_status".into());
        }
    }
    if let Some(Some(requirement_id)) = patch.requirement_id.as_ref() {
        let target = requirements::project_of(conn, requirement_id).map_err(|e| e.to_string())?;
        if target.as_deref() != Some(project_id.as_str()) {
            return Err("invalid_requirement".into());
        }
    }

    let old_title = issues::title_of(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("issue_not_found")?;
    let before = issues::requirement_of(conn, id)
        .map_err(|e| e.to_string())?
        .flatten();

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut title = old_title;
    if let Some(next) = patch.title.as_deref() {
        title = next.trim().to_string();
        issues::set_title(&tx, id, &title, now).map_err(|e| e.to_string())?;
    }
    if let Some(note) = patch.note.as_ref() {
        let note = note.as_deref().map(str::trim).filter(|value| !value.is_empty());
        issues::set_note(&tx, id, note, now).map_err(|e| e.to_string())?;
    }
    if let Some(status) = patch.status.as_deref() {
        let resolved_at = (status == "resolved").then_some(now);
        issues::set_status(&tx, id, status, resolved_at, now).map_err(|e| e.to_string())?;
    }
    if let Some(value) = patch.requirement_id.as_ref() {
        let after = value.as_deref();
        if after != before.as_deref() {
            issues::set_requirement(&tx, id, after, now).map_err(|e| e.to_string())?;
            if let Some(before) = before.as_deref() {
                requirements::insert_change(
                    &tx,
                    before,
                    "issue_unlinked",
                    Some(&title),
                    None,
                    now,
                )
                .map_err(|e| e.to_string())?;
            }
            if let Some(after) = after {
                requirements::insert_change(
                    &tx,
                    after,
                    "issue_linked",
                    None,
                    Some(&title),
                    now,
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    issues::dto(conn, id).map_err(|e| e.to_string())
}

/// Deleting an issue leaves the requirement it was filed under with one history line.
pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    let Some(requirement_id) = issues::requirement_of(conn, id)
        .map_err(|e| e.to_string())?
        .flatten()
    else {
        return issues::delete(conn, id).map_err(|e| e.to_string());
    };
    let title = issues::title_of(conn, id)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    requirements::insert_change(
        &tx,
        &requirement_id,
        "issue_unlinked",
        Some(&title),
        None,
        &crate::now_iso(),
    )
    .map_err(|e| e.to_string())?;
    issues::delete(&tx, id).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn create_task(
    conn: &Connection,
    issue_id: &str,
    title: &str,
    now: &str,
) -> Result<TaskDto, String> {
    let project_id = issues::project_of(conn, issue_id)
        .map_err(|e| e.to_string())?
        .ok_or("issue_not_found")?;
    crate::services::tasks::create_linked_task(
        conn,
        &project_id,
        title,
        crate::services::tasks::TaskLink::Issue(issue_id),
        now,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::dto::IssuePatch;
    use crate::repo::requirements as requirement_repo;
    use crate::repo::settings;
    use crate::services::{projects, requirements};

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

    #[test]
    fn an_issue_keeps_its_status_note_and_resolution_stamp() {
        let c = setup();
        let p = project(&c);
        let issue = create(&c, &p, "接口文档不一致", NOW).unwrap();
        assert_eq!(issue.status, "open");
        let issue = update(
            &c,
            &issue.id,
            &IssuePatch {
                note: Some(Some("  v3 与联调版本不一致  ".into())),
                status: Some("doing".into()),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();
        assert_eq!(issue.note.as_deref(), Some("v3 与联调版本不一致"));
        assert_eq!(issue.status, "doing");
        let issue = update(
            &c,
            &issue.id,
            &IssuePatch {
                status: Some("resolved".into()),
                ..Default::default()
            },
            "2026-11-17T03:00:00Z",
        )
        .unwrap();
        assert_eq!(issue.resolved_at.as_deref(), Some("2026-11-17T03:00:00Z"));
        let issue = update(
            &c,
            &issue.id,
            &IssuePatch {
                status: Some("open".into()),
                ..Default::default()
            },
            "2026-11-17T04:00:00Z",
        )
        .unwrap();
        assert!(issue.resolved_at.is_none());
    }

    #[test]
    fn an_issue_links_to_a_requirement_in_its_own_project() {
        let c = setup();
        let p = project(&c);
        let req = requirements::create(&c, &p, "导出报表", NOW).unwrap();
        let issue = create(&c, &p, "接口文档不一致", NOW).unwrap();
        let linked = update(
            &c,
            &issue.id,
            &IssuePatch {
                requirement_id: Some(Some(req.id.clone())),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();
        assert_eq!(linked.requirement_id.as_deref(), Some(req.id.as_str()));
        assert!(requirement_repo::changes(&c, &req.id)
            .unwrap()
            .iter()
            .any(|change| change.kind == "issue_linked"));
        let unlinked = update(
            &c,
            &issue.id,
            &IssuePatch {
                requirement_id: Some(None),
                ..Default::default()
            },
            "2026-11-17T03:00:00Z",
        )
        .unwrap();
        assert!(unlinked.requirement_id.is_none());
        assert!(requirement_repo::changes(&c, &req.id)
            .unwrap()
            .iter()
            .any(|change| change.kind == "issue_unlinked"));

        let other = projects::create(&c, "另一个项目", NOW).unwrap().id;
        let foreign = requirements::create(&c, &other, "别的需求", NOW).unwrap();
        assert_eq!(
            update(
                &c,
                &issue.id,
                &IssuePatch {
                    requirement_id: Some(Some(foreign.id)),
                    ..Default::default()
                },
                LATER,
            )
            .unwrap_err(),
            "invalid_requirement"
        );
    }

    #[test]
    fn deleting_a_linked_issue_leaves_a_history_line_on_the_requirement() {
        let c = setup();
        let p = project(&c);
        let req = requirements::create(&c, &p, "导出报表", NOW).unwrap();
        let issue = create(&c, &p, "接口文档不一致", NOW).unwrap();
        update(
            &c,
            &issue.id,
            &IssuePatch {
                requirement_id: Some(Some(req.id.clone())),
                ..Default::default()
            },
            LATER,
        )
        .unwrap();
        delete(&c, &issue.id).unwrap();
        assert!(requirement_repo::changes(&c, &req.id)
            .unwrap()
            .iter()
            .any(|change| change.kind == "issue_unlinked"));
        let left: i64 = c
            .query_row("SELECT COUNT(*) FROM issues WHERE id = ?1", [&issue.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn an_issue_creates_a_task_linked_back_to_it() {
        let c = setup();
        let p = project(&c);
        let issue = create(&c, &p, "接口文档不一致", NOW).unwrap();
        let task = create_task(&c, &issue.id, "对齐接口文档", NOW).unwrap();
        assert_eq!(task.issue_id.as_deref(), Some(issue.id.as_str()));
        assert_eq!(issues::dto(&c, &issue.id).unwrap().tasks.len(), 1);
    }
}


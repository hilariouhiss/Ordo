use crate::dto::{PersonDto, ProjectDto, ProjectGroupDto};
use crate::repo::{people, project_groups, projects};
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

pub fn create(conn: &Connection, name: &str, now: &str) -> Result<ProjectDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_project_name".into());
    }
    let id = Uuid::new_v4().to_string();
    let me = people::list(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.is_me)
        .ok_or("no_me")?;
    // One transaction, so a failed member insert cannot leave a project with nobody in it.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    projects::insert(&tx, &id, name, now).map_err(|e| e.to_string())?;
    projects::add_member(&tx, &id, &me.id, now).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    projects::dto(conn, &id).map_err(|e| e.to_string())
}

pub fn update(
    conn: &Connection,
    id: &str,
    name: &str,
    group_id: Option<&str>,
    priority: &str,
    now: &str,
) -> Result<ProjectDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_project_name".into());
    }
    if !crate::services::tasks::valid_priority(priority) {
        return Err("invalid_priority".into());
    }
    if let Some(group_id) = group_id {
        if !project_groups::exists(conn, group_id).map_err(|e| e.to_string())? {
            return Err("invalid_group".into());
        }
    }
    projects::update(conn, id, name, group_id, priority, now).map_err(|e| e.to_string())?;
    projects::dto(conn, id).map_err(|e| e.to_string())
}

pub fn set_group(
    conn: &Connection,
    id: &str,
    group_id: &str,
    now: &str,
) -> Result<(), String> {
    if !project_groups::exists(conn, group_id).map_err(|e| e.to_string())? {
        return Err("invalid_group".into());
    }
    projects::set_group(conn, id, group_id, now).map_err(|e| e.to_string())
}

pub fn create_group(
    conn: &Connection,
    name: &str,
    now: &str,
) -> Result<ProjectGroupDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_group_name".into());
    }
    if project_groups::find_by_name(conn, name)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("group_exists".into());
    }
    project_groups::insert(conn, &Uuid::new_v4().to_string(), name, now)
        .map_err(|e| e.to_string())
}

pub fn rename_group(conn: &Connection, id: &str, name: &str, now: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_group_name".into());
    }
    if !project_groups::exists(conn, id).map_err(|e| e.to_string())? {
        return Err("invalid_group".into());
    }
    if let Some(existing) = project_groups::find_by_name(conn, name).map_err(|e| e.to_string())? {
        if existing.id != id {
            return Err("group_exists".into());
        }
    }
    project_groups::rename(conn, id, name, now).map_err(|e| e.to_string())
}

pub fn delete_group(conn: &Connection, id: &str) -> Result<(), String> {
    project_groups::delete(conn, id).map_err(|e| e.to_string())
}

/// Only an archived project may be deleted, the same rule a task follows.
pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    let archived: Option<Option<String>> = conn
        .query_row(
            "SELECT archived_at FROM projects WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match archived {
        None => Ok(()),
        Some(None) => Err("project_not_archived".into()),
        Some(Some(_)) => projects::delete(conn, id).map_err(|e| e.to_string()),
    }
}

pub fn add_member(
    conn: &Connection,
    project_id: &str,
    person_id: Option<&str>,
    name: Option<&str>,
    now: &str,
) -> Result<PersonDto, String> {
    let person = match person_id {
        Some(id) => people::get(conn, id).map_err(|e| e.to_string())?,
        None => {
            let name = name
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .ok_or("member_name_required")?;
            match people::find_by_name(conn, name).map_err(|e| e.to_string())? {
                Some(p) => p,
                None => people::create(conn, &Uuid::new_v4().to_string(), name, now)
                    .map_err(|e| e.to_string())?,
            }
        }
    };
    projects::add_member(conn, project_id, &person.id, now).map_err(|e| e.to_string())?;
    Ok(person)
}

/// The member the project put in charge of this specialty.
pub fn assigned_owner(
    conn: &Connection,
    project_id: Option<&str>,
    category_id: Option<&str>,
) -> Result<Option<String>, String> {
    match (project_id, category_id) {
        (Some(project_id), Some(category_id)) => {
            projects::category_owner(conn, project_id, category_id).map_err(|e| e.to_string())
        }
        _ => Ok(None),
    }
}

pub fn set_member_category(
    conn: &Connection,
    project_id: &str,
    person_id: &str,
    category_id: Option<&str>,
    now: &str,
) -> Result<ProjectDto, String> {
    if !projects::exists(conn, project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    if !projects::is_member(conn, project_id, person_id).map_err(|e| e.to_string())? {
        return Err("not_a_member".into());
    }
    if let Some(category_id) = category_id {
        if !crate::repo::categories::exists(conn, category_id).map_err(|e| e.to_string())? {
            return Err("invalid_category".into());
        }
    }
    projects::set_member_category(conn, project_id, person_id, category_id, now)
        .map_err(|e| e.to_string())?;
    projects::dto(conn, project_id).map_err(|e| e.to_string())
}

pub fn owner_candidates(
    conn: &Connection,
    project_id: Option<&str>,
) -> Result<Vec<PersonDto>, String> {
    match project_id {
        Some(id) => projects::member_people(conn, id).map_err(|e| e.to_string()),
        None => people::list(conn).map_err(|e| e.to_string()),
    }
}

/// A task owned inside a project implies the owner is one of its members. Capture
/// and AI fill can name anyone, so add them here instead of rejecting the input.
pub fn ensure_member(
    conn: &Connection,
    project_id: Option<&str>,
    owner_id: Option<&str>,
    now: &str,
) -> Result<(), String> {
    let (Some(project_id), Some(owner_id)) = (project_id, owner_id) else {
        return Ok(());
    };
    if !projects::is_member(conn, project_id, owner_id).map_err(|e| e.to_string())? {
        projects::add_member(conn, project_id, owner_id, now).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::repo::{people, project_groups};
    use crate::services::projects;
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn category(c: &Connection, name: &str) -> String {
        crate::repo::categories::list(c)
            .unwrap()
            .into_iter()
            .find(|x| x.name == name)
            .unwrap()
            .id
    }

    #[test]
    fn new_project_has_me_as_member() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "华东客户交付", NOW).unwrap();
        assert_eq!(p.members.len(), 1);
        assert!(p.group_id.is_none());
        assert_eq!(p.priority, "normal");
        let cands = projects::owner_candidates(&c, Some(&p.id)).unwrap();
        assert_eq!(cands.len(), 1);
        assert!(cands[0].is_me);
    }

    #[test]
    fn creating_a_project_rolls_back_when_the_member_insert_fails() {
        let c = db::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TRIGGER fail_member BEFORE INSERT ON project_members
             BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .unwrap();

        assert!(projects::create(&c, "项目", NOW).is_err());

        let left: i64 = c
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "a half-created project must roll back");
    }

    #[test]
    fn adding_member_by_existing_name_does_not_duplicate() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "华东客户交付", NOW).unwrap();
        projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        assert_eq!(people::list(&c).unwrap().len(), 2);
        assert_eq!(
            projects::owner_candidates(&c, Some(&p.id)).unwrap().len(),
            2
        );
    }

    #[test]
    fn a_member_category_maps_the_specialty_owner() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let li = projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        let hardware = category(&c, "硬件");

        let updated =
            projects::set_member_category(&c, &p.id, &li.id, Some(&hardware), NOW).unwrap();

        let member = updated.members.iter().find(|m| m.person_id == li.id).unwrap();
        assert_eq!(member.category_id.as_deref(), Some(hardware.as_str()));
        assert_eq!(
            projects::assigned_owner(&c, Some(&p.id), Some(&hardware))
                .unwrap()
                .as_deref(),
            Some(li.id.as_str())
        );
        assert_eq!(
            projects::assigned_owner(&c, Some(&p.id), None).unwrap(),
            None
        );
    }

    #[test]
    fn one_category_has_one_owner() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let li = projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        let wang = projects::add_member(&c, &p.id, None, Some("小王"), NOW).unwrap();
        let hardware = category(&c, "硬件");
        projects::set_member_category(&c, &p.id, &li.id, Some(&hardware), NOW).unwrap();

        let updated =
            projects::set_member_category(&c, &p.id, &wang.id, Some(&hardware), NOW).unwrap();

        let owners: Vec<&str> = updated
            .members
            .iter()
            .filter(|m| m.category_id.as_deref() == Some(hardware.as_str()))
            .map(|m| m.person_id.as_str())
            .collect();
        assert_eq!(owners, vec![wang.id.as_str()]);
    }

    #[test]
    fn mapping_a_category_backfills_the_open_tasks() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let li = projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        let wang = projects::add_member(&c, &p.id, None, Some("小王"), NOW).unwrap();
        let hardware = category(&c, "硬件");
        let me = people::list(&c)
            .unwrap()
            .into_iter()
            .find(|x| x.is_me)
            .unwrap();

        for id in ["t1", "t2", "t3"] {
            crate::services::week::capture(&c, "交底", NOW, id).unwrap();
            c.execute(
                "UPDATE tasks SET project_id = ?1, category_id = ?2 WHERE id = ?3",
                rusqlite::params![p.id, hardware, id],
            )
            .unwrap();
        }
        c.execute("UPDATE tasks SET owner_id = ?1 WHERE id = 't2'", [&wang.id])
            .unwrap();
        c.execute("UPDATE tasks SET status = 'done' WHERE id = 't3'", [])
            .unwrap();
        let owner = |id: &str| -> Option<String> {
            c.query_row("SELECT owner_id FROM tasks WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap()
        };

        projects::set_member_category(&c, &p.id, &li.id, Some(&hardware), NOW).unwrap();

        assert_eq!(owner("t1").as_deref(), Some(li.id.as_str()));
        assert_eq!(owner("t2").as_deref(), Some(wang.id.as_str()));
        assert_eq!(owner("t3").as_deref(), Some(me.id.as_str()));

        // Reassigning the specialty also picks up the previous owner's tasks.
        projects::set_member_category(&c, &p.id, &wang.id, Some(&hardware), NOW).unwrap();
        assert_eq!(owner("t1").as_deref(), Some(wang.id.as_str()));
        assert_eq!(owner("t2").as_deref(), Some(wang.id.as_str()));
    }

    #[test]
    fn clearing_a_mapping_keeps_existing_owners() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let li = projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        let hardware = category(&c, "硬件");
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET project_id = ?1, category_id = ?2 WHERE id = 't1'",
            rusqlite::params![p.id, hardware],
        )
        .unwrap();
        projects::set_member_category(&c, &p.id, &li.id, Some(&hardware), NOW).unwrap();

        projects::set_member_category(&c, &p.id, &li.id, None, NOW).unwrap();

        let owner: Option<String> = c
            .query_row("SELECT owner_id FROM tasks WHERE id = 't1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(owner.as_deref(), Some(li.id.as_str()));
        assert_eq!(
            projects::assigned_owner(&c, Some(&p.id), Some(&hardware)).unwrap(),
            None
        );
    }

    #[test]
    fn member_category_validation() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let li = projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        let outsider = people::create(&c, "u-outsider", "外人", NOW).unwrap();
        let hardware = category(&c, "硬件");

        assert_eq!(
            projects::set_member_category(&c, &p.id, &outsider.id, Some(&hardware), NOW).unwrap_err(),
            "not_a_member"
        );
        assert_eq!(
            projects::set_member_category(&c, &p.id, &li.id, Some("nope"), NOW).unwrap_err(),
            "invalid_category"
        );
        assert_eq!(
            projects::set_member_category(&c, "nope", &li.id, Some(&hardware), NOW).unwrap_err(),
            "invalid_project"
        );
    }

    #[test]
    fn deleting_project_deletes_its_tasks() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET project_id = ?1 WHERE id='t1'", [&p.id])
            .unwrap();

        crate::repo::projects::delete(&c, &p.id).unwrap();
        let left: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn an_active_project_cannot_be_deleted() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET project_id = ?1 WHERE id='t1'", [&p.id])
            .unwrap();

        assert_eq!(
            projects::delete(&c, &p.id).unwrap_err(),
            "project_not_archived"
        );
        let tasks: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tasks, 1);
        assert!(crate::repo::projects::dto(&c, &p.id).is_ok());
    }

    #[test]
    fn an_archived_project_can_be_deleted() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET project_id = ?1 WHERE id='t1'", [&p.id])
            .unwrap();
        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();

        projects::delete(&c, &p.id).unwrap();

        let tasks: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tasks, 0);
    }

    #[test]
    fn deleting_a_missing_project_is_a_noop() {
        let c = db::open_in_memory().unwrap();
        projects::delete(&c, "nope").unwrap();
    }

    #[test]
    fn ensure_member_adds_an_outsider_once() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let outsider = people::create(&c, "u-outsider", "外人", NOW).unwrap();

        projects::ensure_member(&c, Some(&p.id), Some(&outsider.id), NOW).unwrap();
        projects::ensure_member(&c, Some(&p.id), Some(&outsider.id), NOW).unwrap();

        assert!(
            crate::repo::projects::is_member(&c, &p.id, &outsider.id).unwrap(),
            "the owner should be a project member"
        );
        assert_eq!(
            crate::repo::projects::members(&c, &p.id).unwrap().len(),
            2,
            "calling it twice must not duplicate the member"
        );
    }

    #[test]
    fn owner_candidates_respect_project_membership() {
        let c = db::open_in_memory().unwrap();
        let a = projects::create(&c, "项目 A", NOW).unwrap();
        let b = projects::create(&c, "项目 B", NOW).unwrap();
        projects::add_member(&c, &a.id, None, Some("老李"), NOW).unwrap();

        assert_eq!(projects::owner_candidates(&c, Some(&a.id)).unwrap().len(), 2);
        assert_eq!(projects::owner_candidates(&c, Some(&b.id)).unwrap().len(), 1);
        assert_eq!(projects::owner_candidates(&c, None).unwrap().len(), 2);
    }

    #[test]
    fn groups_can_be_managed_and_deleted_without_losing_projects() {
        let c = db::open_in_memory().unwrap();
        let project = projects::create(&c, "华东客户交付", NOW).unwrap();
        let group = projects::create_group(&c, "  甲方 A  ", NOW).unwrap();
        assert_eq!(group.name, "甲方 A");

        let assigned = projects::update(
            &c,
            &project.id,
            "华东客户交付",
            Some(&group.id),
            "normal",
            NOW,
        )
        .unwrap();
        assert_eq!(assigned.group_id.as_deref(), Some(group.id.as_str()));

        assert_eq!(
            projects::create_group(&c, "甲方 A", NOW).unwrap_err(),
            "group_exists"
        );
        assert_eq!(
            projects::create_group(&c, "  ", NOW).unwrap_err(),
            "empty_group_name"
        );
        assert_eq!(
            projects::update(&c, &project.id, "项目", Some("missing"), "normal", NOW)
                .unwrap_err(),
            "invalid_group"
        );

        let active = projects::create(&c, "另一个项目", NOW).unwrap();
        projects::update(&c, &active.id, "另一个项目", Some(&group.id), "normal", NOW).unwrap();

        let other = projects::create_group(&c, "甲方 B", NOW).unwrap();
        projects::rename_group(&c, &group.id, "甲方 C", NOW).unwrap();
        assert_eq!(
            project_groups::get(&c, &group.id).unwrap().name,
            "甲方 C"
        );
        assert_eq!(
            projects::rename_group(&c, &other.id, "甲方 C", NOW).unwrap_err(),
            "group_exists"
        );

        crate::repo::projects::set_archived(&c, &project.id, true, NOW).unwrap();
        projects::delete_group(&c, &group.id).unwrap();
        let archived = crate::repo::projects::dto(&c, &project.id).unwrap();
        assert!(archived.archived_at.is_some());
        assert!(archived.group_id.is_none());
        let active = crate::repo::projects::dto(&c, &active.id).unwrap();
        assert!(active.archived_at.is_none());
        assert!(active.group_id.is_none());
        assert!(project_groups::get(&c, &group.id).is_err());
    }

    #[test]
    fn importance_is_validated_and_saved() {
        let c = db::open_in_memory().unwrap();
        let project = projects::create(&c, "项目", NOW).unwrap();
        assert_eq!(project.priority, "normal");

        let updated = projects::update(&c, &project.id, "项目", None, "high", NOW).unwrap();
        assert_eq!(updated.priority, "high");
        assert_eq!(
            projects::update(&c, &project.id, "项目", None, "urgent", NOW).unwrap_err(),
            "invalid_priority"
        );
    }

    #[test]
    fn set_group_moves_a_project_and_rejects_a_deleted_group() {
        let c = db::open_in_memory().unwrap();
        let project = projects::create(&c, "项目", NOW).unwrap();
        let group = projects::create_group(&c, "甲方 A", NOW).unwrap();
        projects::update(&c, &project.id, "项目", None, "high", NOW).unwrap();

        projects::set_group(&c, &project.id, &group.id, NOW).unwrap();
        let moved = crate::repo::projects::dto(&c, &project.id).unwrap();
        assert_eq!(moved.group_id.as_deref(), Some(group.id.as_str()));
        assert_eq!(moved.priority, "high");
        assert_eq!(
            projects::set_group(&c, &project.id, "missing", NOW).unwrap_err(),
            "invalid_group"
        );
    }
}
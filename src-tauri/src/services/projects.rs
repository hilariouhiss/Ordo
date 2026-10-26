use crate::dto::{PersonDto, ProjectDto, ProjectGroupDto};
use crate::repo::{people, project_groups, projects};
use rusqlite::Connection;
use uuid::Uuid;

pub fn create(conn: &Connection, name: &str, now: &str) -> Result<ProjectDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_project_name".into());
    }
    let id = Uuid::new_v4().to_string();
    projects::insert(conn, &id, name, now).map_err(|e| e.to_string())?;
    let me = people::list(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.is_me)
        .ok_or("no_me")?;
    projects::add_member(conn, &id, &me.id, now).map_err(|e| e.to_string())?;
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

pub fn owner_candidates(
    conn: &Connection,
    project_id: Option<&str>,
) -> Result<Vec<PersonDto>, String> {
    match project_id {
        Some(id) => projects::member_people(conn, id).map_err(|e| e.to_string()),
        None => people::list(conn).map_err(|e| e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::repo::{people, project_groups};
    use crate::services::projects;

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn new_project_has_me_as_member() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "华东客户交付", NOW).unwrap();
        assert_eq!(p.member_ids.len(), 1);
        assert!(p.group_id.is_none());
        assert_eq!(p.priority, "normal");
        let cands = projects::owner_candidates(&c, Some(&p.id)).unwrap();
        assert_eq!(cands.len(), 1);
        assert!(cands[0].is_me);
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
use crate::dto::{PersonDto, ProjectDto, ProjectGroupDto, ProjectNumberingDto};
use crate::repo::{people, project_groups, projects};
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

pub fn create(conn: &Connection, name: &str, now: &str) -> Result<ProjectDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_project_name".into());
    }
    let id = Uuid::new_v4().to_string();
    let scope = crate::repo::settings::mode(conn).map_err(|e| e.to_string())?;
    // One transaction, so a failed member insert cannot leave a project with nobody in it.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // A #name capture reuses the live project with that name, so a second live one
    // would make every future capture pick one of two identical names.
    if projects::find_active_by_name(&tx, name, &scope)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("project_exists".into());
    }
    insert_with_me(&tx, &id, name, &scope, now)?;
    tx.commit().map_err(|e| e.to_string())?;
    projects::dto(conn, &id).map_err(|e| e.to_string())
}

/// A capture's `#name` token when that project does not exist yet: an existing live
/// project with the same name is reused, otherwise one is inserted with "me" as member.
/// The caller already owns a transaction, so this adds the project to it.
pub fn find_or_create(conn: &Connection, name: &str, now: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_project_name".into());
    }
    let scope = crate::repo::settings::mode(conn).map_err(|e| e.to_string())?;
    if let Some(id) =
        projects::find_active_by_name(conn, name, &scope).map_err(|e| e.to_string())?
    {
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    insert_with_me(conn, &id, name, &scope, now)?;
    Ok(id)
}

fn insert_with_me(
    conn: &Connection,
    id: &str,
    name: &str,
    scope: &str,
    now: &str,
) -> Result<(), String> {
    let me = people::list(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.is_me)
        .ok_or("no_me")?;
    projects::insert(conn, id, name, scope, now).map_err(|e| e.to_string())?;
    projects::add_member(conn, id, &me.id, now).map_err(|e| e.to_string())?;
    // New projects start with a copy of the global default requirement pipeline.
    crate::services::requirements::seed_statuses_in(conn, id, now)?;
    Ok(())
}

/// A number format a project edit must be able to save: a short prefix and a 1..6 digit
/// width. The prefix carries whatever separator the user wants (REQ-, BUG_, 需求-).
pub fn validate_numbering(numbering: &ProjectNumberingDto) -> Result<ProjectNumberingDto, String> {
    let project_prefix = numbering.project_prefix.trim();
    if project_prefix.chars().count() > 12 || project_prefix.chars().any(char::is_whitespace) {
        return Err("invalid_number_prefix".into());
    }
    let requirement_prefix = numbering.requirement_prefix.trim();
    let issue_prefix = numbering.issue_prefix.trim();
    for prefix in [requirement_prefix, issue_prefix] {
        if prefix.is_empty() || prefix.chars().count() > 12 || prefix.chars().any(char::is_whitespace)
        {
            return Err("invalid_number_prefix".into());
        }
    }
    for width in [numbering.requirement_width, numbering.issue_width] {
        if !(1..=6).contains(&width) {
            return Err("invalid_number_width".into());
        }
    }
    Ok(ProjectNumberingDto {
        project_prefix: project_prefix.to_string(),
        requirement_prefix: requirement_prefix.to_string(),
        issue_prefix: issue_prefix.to_string(),
        ..numbering.clone()
    })
}

pub fn update(
    conn: &Connection,
    id: &str,
    name: &str,
    group_id: Option<&str>,
    priority: &str,
    numbering: &ProjectNumberingDto,
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
        same_scope(conn, id, group_id)?;
    }
    let numbering = validate_numbering(numbering)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    projects::update(&tx, id, name, group_id, priority, &numbering, now)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
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
    same_scope(conn, id, group_id)?;
    projects::set_group(conn, id, group_id, now).map_err(|e| e.to_string())
}

/// A client and a project only meet inside one world; the pickers filter already, this
/// guards a hand-written call or a stale form.
fn same_scope(conn: &Connection, project_id: &str, group_id: &str) -> Result<(), String> {
    let project = projects::scope_of(conn, project_id).map_err(|e| e.to_string())?;
    let group = project_groups::scope_of(conn, group_id).map_err(|e| e.to_string())?;
    if let (Some(project), Some(group)) = (project, group) {
        if project != group {
            return Err("invalid_group".into());
        }
    }
    Ok(())
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
    let scope = crate::repo::settings::mode(conn).map_err(|e| e.to_string())?;
    if project_groups::find_by_name(conn, name, &scope)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("group_exists".into());
    }
    project_groups::insert(conn, &Uuid::new_v4().to_string(), name, &scope, now)
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
    let scope = crate::repo::settings::mode(conn).map_err(|e| e.to_string())?;
    if let Some(existing) =
        project_groups::find_by_name(conn, name, &scope).map_err(|e| e.to_string())?
    {
        if existing.id != id {
            return Err("group_exists".into());
        }
    }
    project_groups::rename(conn, id, name, now).map_err(|e| e.to_string())
}

/// A detail field is stored trimmed, and a blank one as NULL so the export reads null.
fn blank_to_none(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|text| !text.is_empty())
}

/// Rewrites a 甲方 whole record; a blank detail field is stored as NULL.
pub fn update_group(
    conn: &Connection,
    id: &str,
    name: &str,
    contact: Option<&str>,
    phone: Option<&str>,
    note: Option<&str>,
    now: &str,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_group_name".into());
    }
    if !project_groups::exists(conn, id).map_err(|e| e.to_string())? {
        return Err("invalid_group".into());
    }
    let scope = crate::repo::settings::mode(conn).map_err(|e| e.to_string())?;
    if let Some(existing) =
        project_groups::find_by_name(conn, name, &scope).map_err(|e| e.to_string())?
    {
        if existing.id != id {
            return Err("group_exists".into());
        }
    }
    project_groups::update(
        conn,
        id,
        name,
        blank_to_none(contact),
        blank_to_none(phone),
        blank_to_none(note),
        now,
    )
    .map_err(|e| e.to_string())
}

pub fn delete_group(conn: &Connection, id: &str) -> Result<(), String> {
    project_groups::delete(conn, id).map_err(|e| e.to_string())
}

/// Only an archived project may be deleted, the same rule a task follows.
pub fn delete(conn: &Connection, id: &str, now: &str) -> Result<(), String> {
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
        Some(Some(_)) => projects::delete(conn, id, now).map_err(|e| e.to_string()),
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
        Some(id) => {
            if !people::exists(conn, id).map_err(|e| e.to_string())? {
                return Err("invalid_owner".into());
            }
            people::get(conn, id).map_err(|e| e.to_string())?
        }
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
    let responsibilities = people::categories(conn, &person.id).map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // Who holds each category before this member's 职责 starts counting.
    let mut previous = Vec::new();
    for category_id in &responsibilities {
        previous.push(
            projects::category_owner(&tx, project_id, category_id).map_err(|e| e.to_string())?,
        );
    }
    projects::add_member(&tx, project_id, &person.id, now).map_err(|e| e.to_string())?;
    for (category_id, owner) in responsibilities.iter().zip(previous) {
        projects::hand_over_tasks(
            &tx,
            project_id,
            category_id,
            &person.id,
            owner.as_deref(),
            now,
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
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

    fn numbering() -> crate::dto::ProjectNumberingDto {
        crate::dto::ProjectNumberingDto {
            project_prefix: "".into(),
            requirement_prefix: "REQ-".into(),
            requirement_width: 3,
            issue_prefix: "ISS-".into(),
            issue_width: 3,
        }
    }

    #[test]
    fn a_project_prefix_is_optional_but_short_and_tight() {
        let mut format = numbering();
        let validated = projects::validate_numbering(&format).unwrap();
        assert_eq!(validated.project_prefix, "");
        format.project_prefix = " ORDO- ".into();
        let validated = projects::validate_numbering(&format).unwrap();
        assert_eq!(validated.project_prefix, "ORDO-");
        format.project_prefix = "两个 词".into();
        assert_eq!(
            projects::validate_numbering(&format).unwrap_err(),
            "invalid_number_prefix"
        );
        format.project_prefix = "X".repeat(13);
        assert_eq!(
            projects::validate_numbering(&format).unwrap_err(),
            "invalid_number_prefix"
        );
    }

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
    fn a_second_live_project_cannot_take_the_same_name() {
        let c = db::open_in_memory().unwrap();
        projects::create(&c, "滨江花园", NOW).unwrap();

        assert_eq!(
            projects::create(&c, " 滨江花园 ", NOW).unwrap_err(),
            "project_exists"
        );
        // A filed project does not reserve the name.
        let archived = projects::create(&c, "已归档项目", NOW).unwrap();
        crate::repo::projects::set_archived(&c, &archived.id, true, NOW).unwrap();
        projects::create(&c, "已归档项目", NOW).unwrap();
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
    fn adding_an_unknown_person_is_refused_by_name() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();

        assert_eq!(
            projects::add_member(&c, &p.id, Some("nobody"), None, NOW).unwrap_err(),
            "invalid_owner"
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

        crate::repo::projects::delete(&c, &p.id, NOW).unwrap();
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
            projects::delete(&c, &p.id, NOW).unwrap_err(),
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

        projects::delete(&c, &p.id, NOW).unwrap();

        let tasks: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tasks, 0);
    }

    #[test]
    fn deleting_a_project_removes_its_rules() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let rule = crate::services::rules::save(
            &c,
            &crate::dto::RuleInput {
                title: "报销".into(),
                weekdays: vec![1],
                at: "09:00".into(),
                project_id: Some(p.id.clone()),
                ..Default::default()
            },
            NOW,
        )
        .unwrap();
        crate::repo::projects::set_archived(&c, &p.id, true, NOW).unwrap();

        projects::delete(&c, &p.id, NOW).unwrap();

        assert!(
            crate::repo::rules::get(&c, &rule.id).unwrap().is_none(),
            "a deleted project's rules must stop firing"
        );
    }

    #[test]
    fn deleting_a_missing_project_is_a_noop() {
        let c = db::open_in_memory().unwrap();
        projects::delete(&c, "nope", NOW).unwrap();
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
    fn responsibilities_make_a_member_the_specialty_owner() {
        let c = db::open_in_memory().unwrap();
        let project = projects::create(&c, "项目", NOW).unwrap();
        let hardware = category(&c, "硬件");
        let li = crate::services::people::create(&c, "老李", NOW).unwrap();
        crate::repo::people::replace_categories(&c, &li.id, &[hardware.clone()]).unwrap();
        // Only members count, so nothing resolves before the join.
        assert_eq!(
            projects::assigned_owner(&c, Some(&project.id), Some(&hardware)).unwrap(),
            None
        );

        projects::add_member(&c, &project.id, Some(&li.id), None, NOW).unwrap();
        assert_eq!(
            projects::assigned_owner(&c, Some(&project.id), Some(&hardware)).unwrap(),
            Some(li.id.clone())
        );

        // An explicit per-project specialty still wins over 职责.
        let wang = crate::services::people::create(&c, "老王", NOW).unwrap();
        projects::add_member(&c, &project.id, Some(&wang.id), None, NOW).unwrap();
        projects::set_member_category(&c, &project.id, &wang.id, Some(&hardware), NOW).unwrap();
        assert_eq!(
            projects::assigned_owner(&c, Some(&project.id), Some(&hardware)).unwrap(),
            Some(wang.id.clone())
        );
    }

    #[test]
    fn joining_a_project_hands_over_the_categories_they_cover() {
        let c = db::open_in_memory().unwrap();
        let project = projects::create(&c, "项目", NOW).unwrap();
        let hardware = category(&c, "硬件");
        let me = people::list(&c)
            .unwrap()
            .into_iter()
            .find(|person| person.is_me)
            .unwrap();
        let other = crate::services::people::create(&c, "老陈", NOW).unwrap();
        for (id, owner) in [("t1", None), ("t2", Some(me.id.as_str())), ("t3", Some(other.id.as_str()))]
        {
            crate::services::week::capture(&c, id, NOW, id).unwrap();
            c.execute(
                "UPDATE tasks SET project_id = ?1, category_id = ?2, owner_id = ?3 WHERE id = ?4",
                rusqlite::params![project.id, hardware, owner, id],
            )
            .unwrap();
        }

        let li = crate::services::people::create(&c, "老李", NOW).unwrap();
        crate::repo::people::replace_categories(&c, &li.id, &[hardware.clone()]).unwrap();
        projects::add_member(&c, &project.id, Some(&li.id), None, NOW).unwrap();

        let owner_of = |id: &str| -> Option<String> {
            c.query_row("SELECT owner_id FROM tasks WHERE id = ?1", [id], |r| r.get(0))
                .unwrap()
        };
        // No owner and the "me" owner come along; someone else's manual pick stays put.
        assert_eq!(owner_of("t1").as_deref(), Some(li.id.as_str()));
        assert_eq!(owner_of("t2").as_deref(), Some(li.id.as_str()));
        assert_eq!(owner_of("t3").as_deref(), Some(other.id.as_str()));
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
            &numbering(),
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
            projects::update(&c, &project.id, "项目", Some("missing"), "normal", &numbering(), NOW)
                .unwrap_err(),
            "invalid_group"
        );

        let active = projects::create(&c, "另一个项目", NOW).unwrap();
        projects::update(
            &c,
            &active.id,
            "另一个项目",
            Some(&group.id),
            "normal",
            &numbering(),
            NOW,
        )
        .unwrap();

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
    fn a_client_keeps_its_details_across_renames() {
        let c = db::open_in_memory().unwrap();
        let group = projects::create_group(&c, "甲方 A", NOW).unwrap();
        assert!(group.contact.is_none() && group.phone.is_none() && group.note.is_none());

        projects::update_group(
            &c,
            &group.id,
            "甲方 A",
            Some("  陈工 "),
            Some("13800000000"),
            Some(" 每月对账 "),
            NOW,
        )
        .unwrap();
        let saved = project_groups::get(&c, &group.id).unwrap();
        assert_eq!(saved.contact.as_deref(), Some("陈工"));
        assert_eq!(saved.phone.as_deref(), Some("13800000000"));
        assert_eq!(saved.note.as_deref(), Some("每月对账"));

        // The project page's quick rename only touches the name.
        projects::rename_group(&c, &group.id, "甲方 A2", NOW).unwrap();
        let renamed = project_groups::get(&c, &group.id).unwrap();
        assert_eq!(renamed.name, "甲方 A2");
        assert_eq!(renamed.contact.as_deref(), Some("陈工"));

        // A blank detail is stored as NULL, not as an empty string.
        projects::update_group(&c, &group.id, "甲方 A2", Some("   "), None, Some(""), NOW).unwrap();
        let cleared = project_groups::get(&c, &group.id).unwrap();
        assert!(cleared.contact.is_none() && cleared.phone.is_none() && cleared.note.is_none());
    }

    #[test]
    fn updating_a_client_validates_the_id_and_the_name() {
        let c = db::open_in_memory().unwrap();
        let a = projects::create_group(&c, "甲方 A", NOW).unwrap();
        let b = projects::create_group(&c, "甲方 B", NOW).unwrap();
        assert_eq!(
            projects::update_group(&c, &a.id, "  ", None, None, None, NOW).unwrap_err(),
            "empty_group_name"
        );
        assert_eq!(
            projects::update_group(&c, "missing", "甲方 C", None, None, None, NOW).unwrap_err(),
            "invalid_group"
        );
        assert_eq!(
            projects::update_group(&c, &a.id, "甲方 B", None, None, None, NOW).unwrap_err(),
            "group_exists"
        );
        // Keeping its own name is not a clash.
        projects::update_group(&c, &a.id, "甲方 A", Some("陈工"), None, None, NOW).unwrap();
        assert_eq!(
            project_groups::get(&c, &a.id).unwrap().contact.as_deref(),
            Some("陈工")
        );
        assert_eq!(project_groups::get(&c, &b.id).unwrap().name, "甲方 B");
    }

    #[test]
    fn importance_is_validated_and_saved() {
        let c = db::open_in_memory().unwrap();
        let project = projects::create(&c, "项目", NOW).unwrap();
        assert_eq!(project.priority, "normal");

        let updated = projects::update(&c, &project.id, "项目", None, "high", &numbering(), NOW)
            .unwrap();
        assert_eq!(updated.priority, "high");
        assert_eq!(
            projects::update(&c, &project.id, "项目", None, "urgent", &numbering(), NOW)
                .unwrap_err(),
            "invalid_priority"
        );
    }

    #[test]
    fn set_group_moves_a_project_and_rejects_a_deleted_group() {
        let c = db::open_in_memory().unwrap();
        let project = projects::create(&c, "项目", NOW).unwrap();
        let group = projects::create_group(&c, "甲方 A", NOW).unwrap();
        projects::update(&c, &project.id, "项目", None, "high", &numbering(), NOW).unwrap();

        projects::set_group(&c, &project.id, &group.id, NOW).unwrap();
        let moved = crate::repo::projects::dto(&c, &project.id).unwrap();
        assert_eq!(moved.group_id.as_deref(), Some(group.id.as_str()));
        assert_eq!(moved.priority, "high");
        assert_eq!(
            projects::set_group(&c, &project.id, "missing", NOW).unwrap_err(),
            "invalid_group"
        );
    }

    #[test]
    fn new_projects_and_clients_belong_to_the_active_mode() {
        let c = db::open_in_memory().unwrap();
        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_PERSONAL,
        )
        .unwrap();

        let project = projects::create(&c, "生活", NOW).unwrap();
        let group = projects::create_group(&c, "家庭", NOW).unwrap();

        assert_eq!(
            crate::repo::projects::scope_of(&c, &project.id).unwrap().as_deref(),
            Some(crate::repo::settings::MODE_PERSONAL)
        );
        assert_eq!(
            crate::repo::project_groups::scope_of(&c, &group.id)
                .unwrap()
                .as_deref(),
            Some(crate::repo::settings::MODE_PERSONAL)
        );
    }

    #[test]
    fn a_project_cannot_take_a_client_from_the_other_mode() {
        let c = db::open_in_memory().unwrap();
        let company = projects::create(&c, "项目", NOW).unwrap();
        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_PERSONAL,
        )
        .unwrap();
        let personal_group = projects::create_group(&c, "家庭", NOW).unwrap();
        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_WORK,
        )
        .unwrap();

        assert_eq!(
            projects::set_group(&c, &company.id, &personal_group.id, NOW).unwrap_err(),
            "invalid_group"
        );
    }

    #[test]
    fn a_personal_capture_never_reuses_a_company_project() {
        let c = db::open_in_memory().unwrap();
        let company = projects::create(&c, "生活", NOW).unwrap();
        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_PERSONAL,
        )
        .unwrap();

        let task = crate::services::week::capture_with_project(
            &c,
            "买菜",
            &crate::dto::CaptureFields::default(),
            Some("生活"),
            false,
            NOW,
            "t1",
        )
        .unwrap();

        let project_id = task.project_id.expect("the capture created its project");
        assert_ne!(project_id, company.id);
        assert_eq!(
            crate::repo::projects::scope_of(&c, &project_id).unwrap().as_deref(),
            Some(crate::repo::settings::MODE_PERSONAL)
        );
        assert_eq!(
            crate::repo::projects::find_active_by_name(
                &c,
                "生活",
                crate::repo::settings::MODE_WORK,
            )
            .unwrap()
            .as_deref(),
            Some(company.id.as_str())
        );
    }
}
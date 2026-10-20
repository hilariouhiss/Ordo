use crate::dto::{PersonDto, ProjectDto};
use crate::repo::{people, projects};
use rusqlite::Connection;
use uuid::Uuid;

pub fn create(
    conn: &Connection,
    name: &str,
    due_date: Option<&str>,
    now: &str,
) -> Result<ProjectDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_project_name".into());
    }
    let id = Uuid::new_v4().to_string();
    projects::insert(conn, &id, name, due_date, now).map_err(|e| e.to_string())?;
    let me = people::list(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.is_me)
        .ok_or("no_me")?;
    projects::add_member(conn, &id, &me.id, now).map_err(|e| e.to_string())?;
    projects::dto(conn, &id).map_err(|e| e.to_string())
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
    use crate::repo::people;
    use crate::services::projects;

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn new_project_has_me_as_member() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "华东客户交付", Some("2026-11-20"), NOW).unwrap();
        assert_eq!(p.member_ids.len(), 1);
        let cands = projects::owner_candidates(&c, Some(&p.id)).unwrap();
        assert_eq!(cands.len(), 1);
        assert!(cands[0].is_me);
    }

    #[test]
    fn adding_member_by_existing_name_does_not_duplicate() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "华东客户交付", None, NOW).unwrap();
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
        let p = projects::create(&c, "项目", None, NOW).unwrap();
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
        let a = projects::create(&c, "项目 A", None, NOW).unwrap();
        let b = projects::create(&c, "项目 B", None, NOW).unwrap();
        projects::add_member(&c, &a.id, None, Some("老李"), NOW).unwrap();

        assert_eq!(projects::owner_candidates(&c, Some(&a.id)).unwrap().len(), 2);
        assert_eq!(projects::owner_candidates(&c, Some(&b.id)).unwrap().len(), 1);
        assert_eq!(projects::owner_candidates(&c, None).unwrap().len(), 2);
    }
}
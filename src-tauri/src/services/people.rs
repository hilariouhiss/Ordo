use crate::dto::PersonDto;
use crate::repo::people;
use rusqlite::Connection;
use uuid::Uuid;

pub fn create(conn: &Connection, name: &str, now: &str) -> Result<PersonDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_person_name".into());
    }
    if let Some(existing) = people::find_by_name(conn, name).map_err(|e| e.to_string())? {
        return Ok(existing);
    }
    people::create(conn, &Uuid::new_v4().to_string(), name, now).map_err(|e| e.to_string())
}

pub fn rename(conn: &Connection, id: &str, name: &str, now: &str) -> Result<PersonDto, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("empty_person_name".into());
    }
    people::get(conn, id).map_err(|e| e.to_string())?;
    if let Some(existing) = people::find_by_name(conn, name).map_err(|e| e.to_string())? {
        if existing.id != id {
            return Err("person_exists".into());
        }
    }
    people::rename(conn, id, name, now).map_err(|e| e.to_string())?;
    people::get(conn, id).map_err(|e| e.to_string())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    let person = people::get(conn, id).map_err(|e| e.to_string())?;
    if person.is_me {
        return Err("cannot_delete_me".into());
    }
    let used: i64 = conn
        .query_row("SELECT COUNT(*) FROM tasks WHERE owner_id = ?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if used > 0 {
        return Err("person_in_use".into());
    }
    people::delete(conn, id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::repo::{people as people_repo, projects as projects_repo};
    use crate::services::{people, projects, week};

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn create_returns_the_existing_person_for_a_duplicate_name() {
        let c = db::open_in_memory().unwrap();
        let first = people::create(&c, "老李", NOW).unwrap();
        let second = people::create(&c, " 老李 ", NOW).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(people_repo::list(&c).unwrap().len(), 2);
    }

    #[test]
    fn create_rejects_an_empty_name() {
        let c = db::open_in_memory().unwrap();
        assert_eq!(
            people::create(&c, "  ", NOW).unwrap_err(),
            "empty_person_name"
        );
    }

    #[test]
    fn rename_is_global_and_rejects_a_taken_name() {
        let c = db::open_in_memory().unwrap();
        let li = people::create(&c, "老李", NOW).unwrap();
        let wang = people::create(&c, "老王", NOW).unwrap();

        let renamed = people::rename(&c, &li.id, "李工", NOW).unwrap();
        assert_eq!(renamed.name, "李工");
        assert_eq!(people_repo::get(&c, &li.id).unwrap().name, "李工");

        assert_eq!(
            people::rename(&c, &li.id, "老王", NOW).unwrap_err(),
            "person_exists"
        );
        assert_eq!(
            people::rename(&c, &wang.id, "  ", NOW).unwrap_err(),
            "empty_person_name"
        );
    }

    #[test]
    fn me_cannot_be_deleted() {
        let c = db::open_in_memory().unwrap();
        let me = people_repo::list(&c)
            .unwrap()
            .into_iter()
            .find(|p| p.is_me)
            .unwrap();
        assert_eq!(people::delete(&c, &me.id).unwrap_err(), "cannot_delete_me");
    }

    #[test]
    fn a_person_with_tasks_cannot_be_deleted() {
        let c = db::open_in_memory().unwrap();
        let li = people::create(&c, "老李", NOW).unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute("UPDATE tasks SET owner_id = ?1 WHERE id = 't1'", [&li.id])
            .unwrap();

        assert_eq!(people::delete(&c, &li.id).unwrap_err(), "person_in_use");
    }

    #[test]
    fn deleting_an_unused_person_removes_project_membership() {
        let c = db::open_in_memory().unwrap();
        let project = projects::create(&c, "项目", NOW).unwrap();
        let li = people::create(&c, "老李", NOW).unwrap();
        projects_repo::add_member(&c, &project.id, &li.id, NOW).unwrap();

        people::delete(&c, &li.id).unwrap();

        assert!(people_repo::get(&c, &li.id).is_err());
        assert!(!projects_repo::member_ids(&c, &project.id)
            .unwrap()
            .contains(&li.id));
    }
}

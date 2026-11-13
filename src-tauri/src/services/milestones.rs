use crate::dto::MilestoneDto;
use crate::repo::milestones;
use rusqlite::Connection;
use uuid::Uuid;

fn day(value: Option<&str>) -> Result<Option<&str>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "invalid_milestone_date".to_string())?;
    Ok(Some(value))
}

pub fn create(
    conn: &Connection,
    project_id: &str,
    title: &str,
    due_date: Option<&str>,
    now: &str,
) -> Result<MilestoneDto, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("empty_milestone_title".into());
    }
    // Milestones live on a live project; an archived one hides them with itself.
    if !crate::repo::projects::exists(conn, project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    let id = Uuid::new_v4().to_string();
    milestones::insert(conn, &id, project_id, title, day(due_date)?, now)
        .map_err(|e| e.to_string())?;
    milestones::dto(conn, &id).map_err(|e| e.to_string())
}

/// A rename writes only the title, so it cannot undo a date edit made meanwhile.
pub fn rename(conn: &Connection, id: &str, title: &str, now: &str) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("empty_milestone_title".into());
    }
    let changed = milestones::set_title(conn, id, title, now).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("milestone_not_found".into());
    }
    Ok(())
}

/// A date edit writes only the day, so it cannot undo a rename made meanwhile.
pub fn set_date(
    conn: &Connection,
    id: &str,
    due_date: Option<&str>,
    now: &str,
) -> Result<(), String> {
    let changed = milestones::set_date(conn, id, day(due_date)?, now).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("milestone_not_found".into());
    }
    Ok(())
}

pub fn set_done(conn: &Connection, id: &str, done: bool, now: &str) -> Result<(), String> {
    let changed = milestones::set_done(conn, id, done, now).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("milestone_not_found".into());
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    milestones::delete(conn, id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::projects;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn project(c: &Connection) -> String {
        projects::create(c, "华东客户交付", NOW).unwrap().id
    }

    #[test]
    fn creating_trims_the_title_and_an_empty_day_stays_empty() {
        let c = db::open_in_memory().unwrap();
        let project_id = project(&c);

        let saved = create(&c, &project_id, "  方案评审 ", Some("  "), NOW).unwrap();

        assert_eq!(saved.title, "方案评审");
        assert!(saved.due_date.is_none());
        assert_eq!(
            create(&c, &project_id, "  ", None, NOW).unwrap_err(),
            "empty_milestone_title"
        );
        assert_eq!(
            create(&c, "missing", "方案评审", None, NOW).unwrap_err(),
            "invalid_project"
        );
        assert_eq!(
            create(&c, &project_id, "方案评审", Some("周五"), NOW).unwrap_err(),
            "invalid_milestone_date"
        );
    }

    #[test]
    fn creating_needs_a_live_project() {
        let c = db::open_in_memory().unwrap();
        let project_id = project(&c);
        crate::repo::projects::set_archived(&c, &project_id, true, NOW).unwrap();

        assert_eq!(
            create(&c, &project_id, "方案评审", None, NOW).unwrap_err(),
            "invalid_project"
        );
    }

    #[test]
    fn renaming_only_touches_the_title() {
        let c = db::open_in_memory().unwrap();
        let project_id = project(&c);
        let saved = create(&c, &project_id, "方案评审", Some("2026-11-20"), NOW).unwrap();

        rename(&c, &saved.id, " 方案评审 2 ", NOW).unwrap();

        let after = crate::repo::milestones::dto(&c, &saved.id).unwrap();
        assert_eq!(after.title, "方案评审 2");
        assert_eq!(after.due_date.as_deref(), Some("2026-11-20"));
        assert_eq!(
            rename(&c, &saved.id, "  ", NOW).unwrap_err(),
            "empty_milestone_title"
        );
        assert_eq!(
            rename(&c, "missing", "改名", NOW).unwrap_err(),
            "milestone_not_found"
        );
    }

    #[test]
    fn setting_the_day_can_clear_it_and_rejects_a_bad_day() {
        let c = db::open_in_memory().unwrap();
        let project_id = project(&c);
        let saved = create(&c, &project_id, "方案评审", Some("2026-11-20"), NOW).unwrap();

        set_date(&c, &saved.id, Some("  "), NOW).unwrap();

        let after = crate::repo::milestones::dto(&c, &saved.id).unwrap();
        assert_eq!(after.title, "方案评审");
        assert!(after.due_date.is_none());
        assert_eq!(
            set_date(&c, &saved.id, Some("周五"), NOW).unwrap_err(),
            "invalid_milestone_date"
        );
        assert_eq!(
            set_date(&c, "missing", None, NOW).unwrap_err(),
            "milestone_not_found"
        );
    }

    #[test]
    fn marking_done_stamps_and_canceling_clears_it() {
        let c = db::open_in_memory().unwrap();
        let project_id = project(&c);
        let saved = create(&c, &project_id, "方案评审", None, NOW).unwrap();

        set_done(&c, &saved.id, true, NOW).unwrap();
        assert_eq!(
            crate::repo::milestones::dto(&c, &saved.id)
                .unwrap()
                .done_at
                .as_deref(),
            Some(NOW)
        );

        set_done(&c, &saved.id, false, "2026-10-21T08:00:00Z").unwrap();
        assert!(crate::repo::milestones::dto(&c, &saved.id).unwrap().done_at.is_none());
        assert_eq!(
            set_done(&c, "missing", true, NOW).unwrap_err(),
            "milestone_not_found"
        );
    }

    #[test]
    fn deleting_a_missing_milestone_is_a_noop_and_a_project_takes_its_own() {
        let c = db::open_in_memory().unwrap();
        delete(&c, "missing").unwrap();
        let project_id = project(&c);
        create(&c, &project_id, "方案评审", None, NOW).unwrap();
        crate::repo::projects::set_archived(&c, &project_id, true, NOW).unwrap();

        projects::delete(&c, &project_id, NOW).unwrap();

        let left: i64 = c
            .query_row("SELECT COUNT(*) FROM project_milestones", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "a deleted project takes its milestones with it");
    }
}

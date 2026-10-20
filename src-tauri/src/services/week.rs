use crate::dto::TaskDto;
use crate::repo::tasks;
use rusqlite::Connection;

pub fn capture(conn: &Connection, raw: &str, now: &str, id: &str) -> Result<TaskDto, String> {
    let title = raw.trim();
    if title.is_empty() {
        return Err("empty_title".into());
    }
    tasks::insert(conn, id, title, now).map_err(|e| e.to_string())?;
    tasks::dto(conn, id).map_err(|e| e.to_string())
}

pub fn list(conn: &Connection) -> Result<Vec<TaskDto>, String> {
    tasks::list_week(conn).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::services::week;

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn capture_rejects_blank() {
        let c = db::open_in_memory().unwrap();
        assert_eq!(
            week::capture(&c, "   ", NOW, "t1").unwrap_err(),
            "empty_title"
        );
    }

    #[test]
    fn capture_keeps_original_and_enters_week() {
        let c = db::open_in_memory().unwrap();
        let long = "甲".repeat(2000);
        let t = week::capture(&c, &long, NOW, "t2").unwrap();
        assert_eq!(t.title.chars().count(), 2000);
        assert!(t.in_week);
        assert_eq!(t.carry_count, 0);
    }

    #[test]
    fn week_sorts_by_due_then_created() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "没有截止", NOW, "t1").unwrap();
        week::capture(&c, "晚的", NOW, "t2").unwrap();
        week::capture(&c, "早的", NOW, "t3").unwrap();
        c.execute("UPDATE tasks SET due_date='2026-11-20' WHERE id='t2'", [])
            .unwrap();
        c.execute("UPDATE tasks SET due_date='2026-10-21' WHERE id='t3'", [])
            .unwrap();

        let ids: Vec<String> = week::list(&c).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t3", "t2", "t1"]);
    }
}

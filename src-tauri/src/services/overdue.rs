use crate::dto::OverdueTaskDto;
use rusqlite::Connection;

/// The open tasks whose expected finish day has passed, in the order to ask about them.
/// The setting is read here too: when the prompt is off the command returns no rows, so
/// a stale front end cannot start a queue on its own.
pub fn list(conn: &Connection, today: &str) -> Result<Vec<OverdueTaskDto>, String> {
    if !crate::repo::settings::overdue_prompt(conn) {
        return Ok(Vec::new());
    }
    // A rule owns its own finish and a task with children derives its dates; neither can
    // be moved by the defer dialog. `visible_task_filter` also keeps archived, canceled,
    // deleted, archived-project and parent rows out of the queue.
    let sql = format!(
        "SELECT id, title, expected_finish_date FROM tasks
         WHERE expected_finish_date IS NOT NULL AND expected_finish_date < ?1
           AND status <> 'done' AND parked = 0
           AND rule_id IS NULL AND expected_finish_time IS NULL
           AND (expected_start_date IS NULL OR expected_start_date <= ?1)
           AND {}
         ORDER BY expected_finish_date, sort_order, id",
        crate::repo::tasks::visible_task_filter("tasks")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([today], |row| {
            Ok(OverdueTaskDto {
                id: row.get(0)?,
                title: row.get(1)?,
                expected_finish_date: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::dto::RuleInput;
    use crate::repo::settings;
    use crate::services::{local_today, rules, subtasks, week};
    use chrono::{Duration, NaiveDate};

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn day(today: NaiveDate, offset: i64) -> String {
        (today + Duration::days(offset))
            .format("%Y-%m-%d")
            .to_string()
    }

    fn capture(c: &Connection, title: &str, id: &str) -> String {
        week::capture(c, title, NOW, id).unwrap();
        id.into()
    }

    fn due(c: &Connection, id: &str, finish: &str) {
        c.execute(
            "UPDATE tasks SET expected_finish_date = ?1 WHERE id = ?2",
            [finish, id],
        )
        .unwrap();
    }

    fn on(c: &Connection) {
        settings::set(c, settings::keys::TASKS_OVERDUE_PROMPT, "true").unwrap();
    }

    #[test]
    fn overdue_tasks_are_listed_in_finish_order() {
        let c = db::open_in_memory().unwrap();
        on(&c);
        let today = local_today(NOW).unwrap();
        capture(&c, "前天", "t1");
        capture(&c, "昨天", "t2");
        capture(&c, "今天", "t3");
        capture(&c, "明天", "t4");
        due(&c, "t1", &day(today, -2));
        due(&c, "t2", &day(today, -1));
        due(&c, "t3", &day(today, 0));
        due(&c, "t4", &day(today, 1));

        let ids: Vec<String> = list(&c, &day(today, 0)).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["t1".to_string(), "t2".to_string()]);
        assert_eq!(list(&c, &day(today, 0)).unwrap()[0].expected_finish_date, day(today, -2));
    }

    #[test]
    fn only_open_leaf_tasks_are_asked_about() {
        let c = db::open_in_memory().unwrap();
        on(&c);
        let today = local_today(NOW).unwrap();
        let yesterday = day(today, -1);

        let done = capture(&c, "完成了", "done");
        let parked = capture(&c, "挂起", "parked");
        let waiting = capture(&c, "等人", "waiting");
        let rule = capture(&c, "周期", "rule");
        let archived = capture(&c, "归档", "archived");
        let canceled = capture(&c, "取消", "canceled");
        let deleted = capture(&c, "删除", "deleted");
        let project = capture(&c, "归档项目里的", "project");
        let future_start = capture(&c, "开始在未来", "future-start");
        let parent = capture(&c, "父任务", "parent");
        let child = subtasks::add(&c, &parent, "子任务", NOW)
            .unwrap()
            .children[0]
            .id
            .clone();
        for id in [
            &done,
            &parked,
            &waiting,
            &rule,
            &archived,
            &canceled,
            &deleted,
            &project,
            &future_start,
            &parent,
            &child,
        ] {
            due(&c, id, &yesterday);
        }

        c.execute(
            "UPDATE tasks SET status = 'done', in_week = 0 WHERE id = ?1",
            [&done],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET parked = 1, in_week = 0 WHERE id = ?1",
            [&parked],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET parked = 1, in_week = 0 WHERE id = ?1",
            [&waiting],
        )
        .unwrap();
        let rule_id = rules::save(
            &c,
            &RuleInput {
                title: "报销".into(),
                weekdays: vec![2],
                at: "09:00".into(),
                ..Default::default()
            },
            NOW,
        )
        .unwrap()
        .id;
        c.execute(
            "UPDATE tasks SET rule_id = ?1, expected_finish_time = '09:00' WHERE id = ?2",
            [&rule_id, &rule],
        )
        .unwrap();
        c.execute("UPDATE tasks SET archived_at = ?1 WHERE id = ?2", [NOW, &archived])
            .unwrap();
        c.execute("UPDATE tasks SET canceled_at = ?1 WHERE id = ?2", [NOW, &canceled])
            .unwrap();
        c.execute("UPDATE tasks SET deleted_at = ?1 WHERE id = ?2", [NOW, &deleted])
            .unwrap();
        let project_id = crate::services::projects::create(&c, "归档项目", NOW)
            .unwrap()
            .id;
        c.execute(
            "UPDATE projects SET archived_at = ?1 WHERE id = ?2",
            [NOW, &project_id],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET project_id = ?1 WHERE id = ?2",
            [&project_id, &project],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET expected_start_date = ?1 WHERE id = ?2",
            [&day(today, 1), &future_start],
        )
        .unwrap();

        let ids: Vec<String> = list(&c, &day(today, 0)).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![child]);
    }

    #[test]
    fn the_prompt_setting_gates_the_list() {
        let c = db::open_in_memory().unwrap();
        let today = local_today(NOW).unwrap();
        capture(&c, "逾期", "t1");
        due(&c, "t1", &day(today, -1));

        assert!(list(&c, &day(today, 0)).unwrap().is_empty());
        on(&c);
        assert_eq!(list(&c, &day(today, 0)).unwrap().len(), 1);
    }
}

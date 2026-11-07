use crate::dto::{
    CategoryProgressDto, DayStatsDto, ProjectSummaryDto, StatsOverviewDto, StatsSliceDto,
};
use crate::repo::projects;
use crate::repo::tasks::VISIBLE_TASK_FILTER;
use chrono::{NaiveDate, TimeDelta};
use rusqlite::Connection;
use std::collections::HashMap;

/// What finished work means everywhere on the statistics page: a live done task
/// with a real completion stamp. Archiving is filing, not undoing, so archived
/// tasks and tasks inside archived projects still count. Reopening a task clears
/// its stamp, which is why only the latest completion of a task can be counted.
const COMPLETED_FILTER: &str = concat!(
    "t.deleted_at IS NULL AND t.canceled_at IS NULL ",
    "AND t.status = 'done' AND t.actual_finish_at IS NOT NULL ",
    // A finished umbrella only adds its children up; counting it would count the work twice.
    "AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = t.id ",
    "AND c.deleted_at IS NULL AND c.archived_at IS NULL AND c.canceled_at IS NULL)"
);

struct RangeCounts {
    completed: i64,
    minutes: i64,
    on_time: i64,
    with_due: i64,
}

fn format_day(day: NaiveDate) -> String {
    day.format("%Y-%m-%d").to_string()
}

fn parse_day(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "invalid_stats_range".to_string())
}

fn range_counts(conn: &Connection, from: &str, to: &str) -> Result<RangeCounts, String> {
    conn.query_row(
        &format!(
            "SELECT COUNT(*),
                    COALESCE(SUM(COALESCE(t.actual_effort_minutes, t.effort_minutes)), 0),
                    COALESCE(SUM(t.expected_finish_date IS NOT NULL
                                 AND date(t.actual_finish_at, 'localtime') <= t.expected_finish_date), 0),
                    COALESCE(SUM(t.expected_finish_date IS NOT NULL), 0)
             FROM tasks t
             WHERE {COMPLETED_FILTER}
               AND date(t.actual_finish_at, 'localtime') BETWEEN ?1 AND ?2"
        ),
        [from, to],
        |r| {
            Ok(RangeCounts {
                completed: r.get(0)?,
                minutes: r.get(1)?,
                on_time: r.get(2)?,
                with_due: r.get(3)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn created_count(conn: &Connection, from: &str, to: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM tasks
         WHERE deleted_at IS NULL AND date(created_at, 'localtime') BETWEEN ?1 AND ?2",
        [from, to],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

fn delayed_count(conn: &Connection, from: &str, to: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM delays WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2",
        [from, to],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Completions and additions per local day, skipping the days neither happened.
fn daily(conn: &Connection, from: &str, to: &str) -> Result<Vec<DayStatsDto>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT day, SUM(completed), SUM(created) FROM (
                SELECT date(t.actual_finish_at, 'localtime') AS day, 1 AS completed, 0 AS created
                FROM tasks t
                WHERE {COMPLETED_FILTER}
                  AND date(t.actual_finish_at, 'localtime') BETWEEN ?1 AND ?2
                UNION ALL
                SELECT date(created_at, 'localtime'), 0, 1
                FROM tasks
                WHERE deleted_at IS NULL
                  AND date(created_at, 'localtime') BETWEEN ?1 AND ?2
             ) GROUP BY day ORDER BY day"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([from, to], |r| {
            Ok(DayStatsDto {
                date: r.get(0)?,
                completed: r.get(1)?,
                created: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

/// Completed work per project or category, largest first. Names come from a left
/// join so a soft-deleted category still labels its history.
fn slices(conn: &Connection, from: &str, to: &str, by_project: bool) -> Result<Vec<StatsSliceDto>, String> {
    let (id, name, join) = if by_project {
        ("t.project_id", "p.name", "LEFT JOIN projects p ON p.id = t.project_id")
    } else {
        ("t.category_id", "c.name", "LEFT JOIN categories c ON c.id = t.category_id")
    };
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {id}, {name}, COUNT(*),
                    COALESCE(SUM(COALESCE(t.actual_effort_minutes, t.effort_minutes)), 0)
             FROM tasks t {join}
             WHERE {COMPLETED_FILTER}
               AND date(t.actual_finish_at, 'localtime') BETWEEN ?1 AND ?2
             GROUP BY {id}
             ORDER BY COUNT(*) DESC, 4 DESC, 2"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([from, to], |r| {
            Ok(StatsSliceDto {
                id: r.get(0)?,
                name: r.get(1)?,
                completed: r.get(2)?,
                minutes: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

/// The statistics page's whole payload for one local date range.
pub fn overview(conn: &Connection, from: &str, to: &str) -> Result<StatsOverviewDto, String> {
    let start = parse_day(from)?;
    let end = parse_day(to)?;
    if start > end {
        return Err("invalid_stats_range".into());
    }
    let days = (end - start).num_days() + 1;
    if days > crate::limits::LIMITS.stats_range_days {
        return Err("stats_range_too_long".into());
    }
    let from = format_day(start);
    let to = format_day(end);

    let current = range_counts(conn, &from, &to)?;
    let previous_from = format_day(start - TimeDelta::days(days));
    let previous_to = format_day(start - TimeDelta::days(1));
    let previous = range_counts(conn, &previous_from, &previous_to)?;

    Ok(StatsOverviewDto {
        completed: current.completed,
        created: created_count(conn, &from, &to)?,
        completed_minutes: current.minutes,
        on_time: current.on_time,
        with_due: current.with_due,
        delayed: delayed_count(conn, &from, &to)?,
        daily: daily(conn, &from, &to)?,
        by_project: slices(conn, &from, &to, true)?,
        by_category: slices(conn, &from, &to, false)?,
        previous_completed: previous.completed,
        previous_minutes: previous.minutes,
        previous_on_time: previous.on_time,
        previous_with_due: previous.with_due,
        previous_delayed: delayed_count(conn, &previous_from, &previous_to)?,
        from,
        to,
    })
}

pub fn summary(conn: &Connection, project_id: &str) -> Result<ProjectSummaryDto, String> {
    let project = projects::dto(conn, project_id).map_err(|e| e.to_string())?;

    let (total, done): (i64, i64) = conn
        .query_row(
            &format!(
                "SELECT COUNT(*), COALESCE(SUM(status = 'done'), 0) FROM tasks
                 WHERE project_id = ?1 AND {VISIBLE_TASK_FILTER}"
            ),
            [project_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT c.id, c.name, COUNT(tasks.id), COALESCE(SUM(tasks.status = 'done'), 0)
             FROM tasks JOIN categories c ON c.id = tasks.category_id
             WHERE tasks.project_id = ?1 AND {VISIBLE_TASK_FILTER} AND c.deleted_at IS NULL
             GROUP BY c.id, c.name, c.sort_order
             ORDER BY c.sort_order"
        ))
        .map_err(|e| e.to_string())?;
    let by_category: Vec<CategoryProgressDto> = stmt
        .query_map([project_id], |r| {
            Ok(CategoryProgressDto {
                category_id: r.get(0)?,
                name: r.get(1)?,
                total: r.get(2)?,
                done: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    Ok(ProjectSummaryDto {
        id: project.id,
        name: project.name,
        group_id: project.group_id,
        priority: project.priority,
        total,
        done,
        by_category,
    })
}

/// Every live project's counters, with one query per metric instead of a round of
/// queries per project. Runs on every bootstrap, so the count has to stay flat.
pub fn list(conn: &Connection) -> Result<Vec<ProjectSummaryDto>, String> {
    let projects = projects::list_brief(conn).map_err(|e| e.to_string())?;

    let mut totals: HashMap<String, (i64, i64)> = HashMap::new();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT project_id, COUNT(*), COALESCE(SUM(status = 'done'), 0) FROM tasks
             WHERE project_id IS NOT NULL AND {VISIBLE_TASK_FILTER}
             GROUP BY project_id"
        ))
        .map_err(|e| e.to_string())?;
    let counters = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in counters {
        let (project_id, total, done) = row.map_err(|e| e.to_string())?;
        totals.insert(project_id, (total, done));
    }

    let mut by_category: HashMap<String, Vec<CategoryProgressDto>> = HashMap::new();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT tasks.project_id, c.id, c.name, COUNT(tasks.id),
                    COALESCE(SUM(tasks.status = 'done'), 0)
             FROM tasks JOIN categories c ON c.id = tasks.category_id
             WHERE tasks.project_id IS NOT NULL AND {VISIBLE_TASK_FILTER} AND c.deleted_at IS NULL
             GROUP BY tasks.project_id, c.id, c.name, c.sort_order
             ORDER BY c.sort_order"
        ))
        .map_err(|e| e.to_string())?;
    let grouped = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                CategoryProgressDto {
                    category_id: r.get(1)?,
                    name: r.get(2)?,
                    total: r.get(3)?,
                    done: r.get(4)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in grouped {
        let (project_id, category) = row.map_err(|e| e.to_string())?;
        by_category.entry(project_id).or_default().push(category);
    }

    Ok(projects
        .into_iter()
        .map(|project| {
            let (total, done) = totals.get(&project.id).copied().unwrap_or((0, 0));
            let by_category = by_category.remove(&project.id).unwrap_or_default();
            ProjectSummaryDto {
                id: project.id,
                name: project.name,
                group_id: project.group_id,
                priority: project.priority,
                total,
                done,
                by_category,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::repo::categories;
    use crate::services::{projects, stats, week};
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn setup() -> (Connection, String) {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "华东客户交付", NOW).unwrap();
        let cats = categories::list(&c).unwrap();
        let software = cats.iter().find(|x| x.name == "软件").unwrap().id.clone();
        let docs = cats.iter().find(|x| x.name == "资料").unwrap().id.clone();

        week::capture(&c, "方案评审", NOW, "t1").unwrap();
        week::capture(&c, "接口协议", NOW, "t2").unwrap();
        week::capture(&c, "资料目录", NOW, "t3").unwrap();
        week::capture(&c, "不要了", NOW, "t4").unwrap();

        for (id, cat) in [
            ("t1", software.as_str()),
            ("t2", software.as_str()),
            ("t4", software.as_str()),
            ("t3", docs.as_str()),
        ] {
            c.execute(
                "UPDATE tasks SET project_id = ?1, category_id = ?2 WHERE id = ?3",
                rusqlite::params![p.id, cat, id],
            )
            .unwrap();
        }
        c.execute("UPDATE tasks SET status='done' WHERE id='t1'", [])
            .unwrap();
        c.execute("UPDATE tasks SET canceled_at=?1 WHERE id='t4'", [NOW])
            .unwrap();

        (c, p.id)
    }

    #[test]
    fn canceled_tasks_leave_denominator_and_suspended_stay() {
        let (c, id) = setup();
        c.execute(
            "UPDATE tasks SET in_week=0, suspended=1, suspended_until='2026-11-01'
             WHERE id='t3'",
            [],
        )
        .unwrap();
        let s = stats::summary(&c, &id).unwrap();
        assert_eq!(s.total, 3);
        assert_eq!(s.done, 1);
        assert_eq!(s.priority, "normal");
        assert_eq!(s.by_category.len(), 2);
        assert_eq!(s.by_category[0].name, "软件");
        assert_eq!(s.by_category[0].total, 2);
        assert_eq!(s.by_category[0].done, 1);
        assert_eq!(s.by_category[1].name, "资料");
        assert_eq!(s.by_category[1].total, 1);
        assert_eq!(s.by_category[1].done, 0);
    }

    /// Local `YYYY-MM-DD` of an RFC3339 stamp, matching the SQL `localtime` bucket.
    fn local_day(stamp: &str) -> String {
        chrono::DateTime::parse_from_rfc3339(stamp)
            .unwrap()
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d")
            .to_string()
    }

    fn finish(c: &Connection, id: &str, stamp: &str, due: Option<&str>, minutes: i64) {
        c.execute(
            "UPDATE tasks SET status='done', in_week=0, actual_finish_at=?1,
                    expected_finish_date=?2, effort_minutes=?3 WHERE id=?4",
            rusqlite::params![stamp, due, minutes, id],
        )
        .unwrap();
    }

    #[test]
    fn a_finished_umbrella_counts_its_children_once() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交付资料", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集清单", NOW).unwrap();
        let child = parent.children[0].id.clone();
        crate::services::tasks::set_status(&c, &child, "done", "2026-10-21T09:00:00Z").unwrap();

        let s = stats::overview(&c, "2026-10-19", "2026-10-21").unwrap();

        assert_eq!(s.completed, 1, "the umbrella is not a second completion");
        assert_eq!(s.completed_minutes, 480);
        // The daily bars must add up to the same number the header shows.
        let per_day: i64 = s.daily.iter().map(|day| day.completed).sum();
        assert_eq!(per_day, s.completed);
    }

    #[test]
    fn overview_buckets_by_local_day_and_splits_on_time() {
        let c = db::open_in_memory().unwrap();
        for id in ["t1", "t2", "t3", "t4"] {
            week::capture(&c, id, NOW, id).unwrap();
        }
        finish(&c, "t1", "2026-10-05T09:00:00Z", Some("2026-10-05"), 240);
        finish(&c, "t2", "2026-10-05T15:00:00Z", Some("2026-10-04"), 480);
        // No expected finish day: it counts as work done, not as punctuality.
        finish(&c, "t3", "2026-10-07T02:00:00Z", None, 120);

        let s = stats::overview(&c, "2026-10-01", "2026-10-15").unwrap();

        assert_eq!((s.from.as_str(), s.to.as_str()), ("2026-10-01", "2026-10-15"));
        assert_eq!(s.completed, 3);
        assert_eq!(s.completed_minutes, 840);
        assert_eq!(s.on_time, 1);
        assert_eq!(s.with_due, 2);
        // The captures happened after this window, so only two days carry counters.
        assert_eq!(s.created, 0);
        assert_eq!(s.daily.len(), 2);
        assert_eq!(s.daily[0].date, local_day("2026-10-05T09:00:00Z"));
        assert_eq!(s.daily[0].completed, 2);
        assert_eq!(s.daily[1].date, local_day("2026-10-07T02:00:00Z"));
        assert_eq!(s.daily[1].completed, 1);
    }

    #[test]
    fn overview_counts_archived_tasks_but_not_canceled_ones() {
        let c = db::open_in_memory().unwrap();
        for id in ["t1", "t2", "t3"] {
            week::capture(&c, id, NOW, id).unwrap();
        }
        finish(&c, "t1", "2026-10-06T09:00:00Z", None, 480);
        finish(&c, "t2", "2026-10-06T10:00:00Z", None, 480);
        finish(&c, "t3", "2026-10-06T11:00:00Z", None, 480);
        c.execute("UPDATE tasks SET archived_at=?1 WHERE id='t2'", [NOW])
            .unwrap();
        c.execute("UPDATE tasks SET canceled_at=?1 WHERE id='t3'", [NOW])
            .unwrap();

        let s = stats::overview(&c, "2026-10-01", "2026-10-31").unwrap();

        assert_eq!(s.completed, 2);
        assert_eq!(s.completed_minutes, 960);
    }

    #[test]
    fn overview_keeps_archived_projects_visible() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "旧项目", NOW).unwrap();
        week::capture(&c, "收尾", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET project_id=?1 WHERE id='t1'",
            [&p.id],
        )
        .unwrap();
        finish(&c, "t1", "2026-10-06T09:00:00Z", None, 480);
        c.execute("UPDATE projects SET archived_at=?1 WHERE id=?2", rusqlite::params![NOW, p.id])
            .unwrap();

        let s = stats::overview(&c, "2026-10-01", "2026-10-31").unwrap();

        assert_eq!(s.completed, 1);
        assert_eq!(s.by_project.len(), 1);
        assert_eq!(s.by_project[0].name.as_deref(), Some("旧项目"));
    }

    #[test]
    fn overview_compares_with_the_equally_long_previous_window() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "上期", NOW, "t1").unwrap();
        week::capture(&c, "本期", NOW, "t2").unwrap();
        finish(&c, "t1", "2026-09-28T09:00:00Z", None, 480);
        finish(&c, "t2", "2026-10-05T09:00:00Z", None, 240);
        c.execute(
            "INSERT INTO delays (id, task_id, kind, old_due, new_due, reason, created_at)
             VALUES ('d1', 't1', 'reschedule', '2026-09-28', '2026-09-30', NULL,
                     '2026-09-29T09:00:00Z')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO delays (id, task_id, kind, old_due, new_due, reason, created_at)
             VALUES ('d2', 't2', 'overdue_note', NULL, NULL, NULL, '2026-10-05T09:00:00Z')",
            [],
        )
        .unwrap();

        // 10-05 .. 10-11; the previous window is 09-28 .. 10-04.
        let s = stats::overview(&c, "2026-10-05", "2026-10-11").unwrap();

        assert_eq!((s.completed, s.completed_minutes), (1, 240));
        assert_eq!((s.previous_completed, s.previous_minutes), (1, 480));
        assert_eq!((s.delayed, s.previous_delayed), (1, 1));
    }

    #[test]
    fn overview_is_empty_outside_any_activity() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "没做完", NOW, "t1").unwrap();

        let s = stats::overview(&c, "2025-01-01", "2025-01-31").unwrap();

        assert_eq!(s.completed, 0);
        assert_eq!(s.completed_minutes, 0);
        assert_eq!(s.with_due, 0);
        assert!(s.daily.is_empty());
        assert!(s.by_project.is_empty());
        assert!(s.by_category.is_empty());
        // Nothing was created in the window either; the seeded capture is "now".
        assert_eq!(s.created, 0);
        assert_eq!(s.previous_completed, 0);
    }

    #[test]
    fn overview_rejects_backwards_and_oversized_ranges() {
        let c = db::open_in_memory().unwrap();

        assert_eq!(
            stats::overview(&c, "2026-10-31", "2026-10-01").unwrap_err(),
            "invalid_stats_range"
        );
        assert_eq!(
            stats::overview(&c, "2026-10-01", "not-a-day").unwrap_err(),
            "invalid_stats_range"
        );
        assert_eq!(
            stats::overview(&c, "2025-01-01", "2026-10-01").unwrap_err(),
            "stats_range_too_long"
        );
        // The limit itself is inclusive: 366 days pass.
        assert!(stats::overview(&c, "2025-10-01", "2026-10-01").is_ok());
    }

    #[test]
    fn the_project_list_agrees_with_each_summary() {
        let (c, id) = setup();
        let empty = projects::create(&c, "空项目", "2026-10-19T08:00:00Z").unwrap();

        let listed = stats::list(&c).unwrap();

        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, empty.id, "the list keeps the created order");
        assert_eq!((listed[0].total, listed[0].done), (0, 0));
        assert!(listed[0].by_category.is_empty());

        let direct = stats::summary(&c, &id).unwrap();
        let row = listed.iter().find(|project| project.id == id).unwrap();
        assert_eq!((row.total, row.done), (direct.total, direct.done));
        assert_eq!(row.priority, direct.priority);
        assert_eq!(row.name, direct.name);
        assert_eq!(row.by_category.len(), direct.by_category.len());
        for (listed, direct) in row.by_category.iter().zip(direct.by_category.iter()) {
            assert_eq!(listed.category_id, direct.category_id);
            assert_eq!((listed.total, listed.done), (direct.total, direct.done));
        }
    }

    #[test]
    fn project_progress_counts_leaves_not_umbrellas() {
        let c = db::open_in_memory().unwrap();
        let p = projects::create(&c, "项目", NOW).unwrap();
        let category = categories::list(&c).unwrap()[0].id.clone();
        week::capture(&c, "交付", NOW, "p").unwrap();
        c.execute(
            "UPDATE tasks SET project_id = ?1, category_id = ?2 WHERE id = 'p'",
            rusqlite::params![p.id, category],
        )
        .unwrap();
        crate::services::subtasks::add(&c, "p", "收集", NOW).unwrap();
        let parent = crate::services::subtasks::add(&c, "p", "汇编", NOW).unwrap();
        let first = parent.children[0].id.clone();

        let summary = stats::summary(&c, &p.id).unwrap();
        assert_eq!(
            (summary.total, summary.done),
            (2, 0),
            "the umbrella is not a third item of work"
        );
        assert_eq!(
            summary
                .by_category
                .iter()
                .map(|row| (row.total, row.done))
                .collect::<Vec<_>>(),
            vec![(2, 0)]
        );

        crate::services::tasks::set_status(&c, &first, "done", NOW).unwrap();

        let summary = stats::summary(&c, &p.id).unwrap();
        assert_eq!((summary.total, summary.done), (2, 1));
        let listed = stats::list(&c)
            .unwrap()
            .into_iter()
            .find(|row| row.id == p.id)
            .unwrap();
        assert_eq!((listed.total, listed.done), (2, 1));
        let category_row = listed
            .by_category
            .iter()
            .find(|row| row.category_id == category)
            .unwrap();
        assert_eq!((category_row.total, category_row.done), (2, 1));
    }

    #[test]
    fn completed_minutes_use_the_recorded_effort() {
        let c = db::open_in_memory().unwrap();
        week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::services::tasks::set_status(&c, "t1", "doing", "2026-10-20T09:00:00Z").unwrap();
        let done =
            crate::services::tasks::set_status(&c, "t1", "done", "2026-10-20T09:30:00Z").unwrap();
        assert_eq!(done.actual_effort_minutes, Some(30));

        let overview = stats::overview(&c, "2026-10-19", "2026-10-21").unwrap();

        assert_eq!(overview.completed, 1);
        assert_eq!(overview.completed_minutes, 30);
        assert_eq!(overview.by_category[0].minutes, 30);
    }
}

use chrono::{Datelike, Duration, NaiveDate, Weekday};
use rusqlite::{params, Connection};
use uuid::Uuid;

/// One task day is eight hours, so the estimate decides how many working days it needs.
pub const MINUTES_PER_DAY: i64 = 480;

/// The same calendar day, or the Friday before when it falls on a weekend.
pub fn workday_on_or_before(day: NaiveDate) -> NaiveDate {
    let mut day = day;
    while matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
        day -= Duration::days(1);
    }
    day
}

/// The same calendar day, or the next Monday when it falls on a weekend.
pub fn workday_on_or_after(day: NaiveDate) -> NaiveDate {
    let mut day = day;
    while matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
        day += Duration::days(1);
    }
    day
}

fn next_workday(day: NaiveDate) -> NaiveDate {
    workday_on_or_after(day + Duration::days(1))
}

/// The day the estimated work ends: whole eight-hour days counted from the anchor,
/// skipping weekends. One hour of work still ends on the anchor day.
pub fn finish_for(anchor: NaiveDate, effort_minutes: i64) -> NaiveDate {
    let days = ((effort_minutes.max(1) + MINUTES_PER_DAY - 1) / MINUTES_PER_DAY).max(1);
    let mut day = workday_on_or_after(anchor);
    for _ in 1..days {
        day = next_workday(day);
    }
    day
}

/// The estimate a chosen finish day implies: whole workdays from the anchor through
/// that day, counting both ends. A day before the anchor has no answer, and more than
/// sixty workdays would overflow the estimate the rest of the app allows.
pub fn effort_for_finish(anchor: NaiveDate, finish: NaiveDate) -> Result<i64, String> {
    // A weekend pick reads as the Friday before it, so the stored day is always one the
    // estimate can reproduce.
    let finish = workday_on_or_before(finish);
    if finish < anchor {
        return Err("finish_before_start".into());
    }
    let mut days = 0i64;
    let mut day = workday_on_or_after(anchor);
    while day <= finish {
        if !matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
            days += 1;
            if days * MINUTES_PER_DAY > crate::limits::LIMITS.effort_minutes {
                return Err("finish_too_far".into());
            }
        }
        day += Duration::days(1);
    }
    if days == 0 {
        return Err("finish_before_start".into());
    }
    Ok(days * MINUTES_PER_DAY)
}

/// Work starts today unless the task already carries a later expected start.
pub fn anchor_for(today: NaiveDate, expected_start: Option<&str>) -> NaiveDate {
    let start = expected_start
        .and_then(|text| NaiveDate::parse_from_str(text, "%Y-%m-%d").ok())
        .filter(|day| *day > today)
        .unwrap_or(today);
    workday_on_or_after(start)
}

/// Writes the finish the estimate implies. A later finish records a reschedule, so the
/// delay ledger keeps every day the work was pushed back. The caller owns the
/// transaction, so its own writes and the delay record land together.
pub(crate) fn write_finish_in(
    conn: &Connection,
    task_id: &str,
    finish: NaiveDate,
    now: &str,
) -> Result<(), String> {
    let finish = finish.format("%Y-%m-%d").to_string();
    let old: Option<String> = conn
        .query_row(
            "SELECT expected_finish_date FROM tasks WHERE id = ?1",
            [task_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tasks SET expected_finish_date = ?1, updated_at = ?2 WHERE id = ?3",
        params![finish, now, task_id],
    )
    .map_err(|e| e.to_string())?;
    if let Some(old) = old {
        if finish > old {
            crate::repo::delays::insert(
                conn,
                &Uuid::new_v4().to_string(),
                task_id,
                "reschedule",
                Some(&old),
                Some(&finish),
                None,
                now,
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Rewrites the finish of a live task from its current start and estimate. Recurring
/// tasks keep the occurrence date the rule gave them, and finished or archived work is
/// left alone. The caller owns the transaction.
pub(crate) fn sync_finish_in(conn: &Connection, task_id: &str, now: &str) -> Result<(), String> {
    let (status, canceled, archived, start, effort, rule): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT status, canceled_at, archived_at, expected_start_date, effort_minutes, rule_id
             FROM tasks WHERE id = ?1",
            [task_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    if status == "done" || canceled.is_some() || archived.is_some() || rule.is_some() {
        return Ok(());
    }
    let today = crate::services::local_today(now)?;
    let anchor = anchor_for(today, start.as_deref());
    write_finish_in(conn, task_id, finish_for(anchor, effort), now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: &str = "2026-10-19T08:00:00Z";

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn one_hour_ends_on_the_same_workday() {
        assert_eq!(finish_for(day("2026-10-19"), 60), day("2026-10-19"));
        assert_eq!(finish_for(day("2026-10-19"), 480), day("2026-10-19"));
    }

    #[test]
    fn whole_days_count_from_the_anchor() {
        assert_eq!(finish_for(day("2026-10-19"), 960), day("2026-10-20"));
        assert_eq!(finish_for(day("2026-10-19"), 1200), day("2026-10-21"));
    }

    #[test]
    fn weekends_are_skipped() {
        assert_eq!(finish_for(day("2026-10-23"), 960), day("2026-10-26"));
        assert_eq!(finish_for(day("2026-10-24"), 60), day("2026-10-26"));
    }

    /// The same examples run in `src/lib/__tests__/timing-cases.json`; both suites read
    /// the one table, so the capture preview and the stored date cannot drift apart.
    #[test]
    fn the_shared_finish_examples_hold() {
        #[derive(serde::Deserialize, Debug)]
        struct Case {
            today: String,
            start: Option<String>,
            effort: i64,
            finish: String,
        }

        let raw = include_str!("../../../src/lib/__tests__/timing-cases.json");
        let cases: Vec<Case> = serde_json::from_str(raw).unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let anchor = anchor_for(day(&case.today), case.start.as_deref());
            assert_eq!(
                finish_for(anchor, case.effort)
                    .format("%Y-%m-%d")
                    .to_string(),
                case.finish,
                "{case:?}"
            );
        }
    }

    #[test]
    fn a_zero_estimate_still_ends_that_day() {
        assert_eq!(finish_for(day("2026-10-19"), 0), day("2026-10-19"));
    }

    #[test]
    fn an_earlier_start_rolls_to_today() {
        let today = day("2026-10-19");
        assert_eq!(anchor_for(today, Some("2026-10-15")), today);
        assert_eq!(anchor_for(today, Some("2026-10-21")), day("2026-10-21"));
        assert_eq!(anchor_for(today, Some("2026-10-24")), day("2026-10-26"));
    }

    #[test]
    fn capture_stores_the_finish_the_estimate_implies() {
        let c = db::open_in_memory().unwrap();
        let fields = crate::dto::CaptureFields {
            effort_minutes: Some(960),
            ..Default::default()
        };

        let task = crate::services::week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();

        let today = crate::services::local_today(NOW).unwrap();
        assert_eq!(
            task.expected_finish_date.as_deref(),
            Some(finish_for(today, 960).format("%Y-%m-%d").to_string().as_str())
        );
    }

    #[test]
    fn an_effort_change_moves_the_finish_and_records_it() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        let before = crate::repo::tasks::dto(&c, "t1").unwrap().expected_finish_date;

        let patch = crate::dto::TaskPatch {
            effort_minutes: Some(1440),
            ..Default::default()
        };
        let task = crate::services::tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_ne!(task.expected_finish_date, before);
        assert_eq!(task.delays.len(), 1);
        assert_eq!(task.delays[0].kind, "reschedule");
    }

    #[test]
    fn a_start_change_moves_the_finish() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();

        let patch = crate::dto::TaskPatch {
            expected_start_date: Some(Some("2026-10-21".into())),
            ..Default::default()
        };
        let task = crate::services::tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(task.expected_finish_date.as_deref(), Some("2026-10-21"));
    }

    #[test]
    fn a_done_task_keeps_the_finish_it_had() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::services::tasks::set_status(&c, "t1", "done", NOW).unwrap();
        let finished = crate::repo::tasks::dto(&c, "t1").unwrap().expected_finish_date;

        let patch = crate::dto::TaskPatch {
            effort_minutes: Some(1440),
            ..Default::default()
        };
        let task = crate::services::tasks::update_patch(&c, "t1", &patch, NOW).unwrap();

        assert_eq!(task.expected_finish_date, finished);
    }

    #[test]
    fn the_shared_finish_to_effort_examples_hold() {
        #[derive(serde::Deserialize, Debug)]
        struct Case {
            today: String,
            start: Option<String>,
            finish: String,
            effort: Option<i64>,
        }

        let raw = include_str!("../../../src/lib/__tests__/timing-inverse-cases.json");
        let cases: Vec<Case> = serde_json::from_str(raw).unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let anchor = anchor_for(day(&case.today), case.start.as_deref());
            assert_eq!(
                effort_for_finish(anchor, day(&case.finish)).ok(),
                case.effort,
                "{case:?}"
            );
        }
    }

    #[test]
    fn a_weekend_rolls_back_to_the_friday() {
        assert_eq!(workday_on_or_before(day("2026-10-23")), day("2026-10-23"));
        assert_eq!(workday_on_or_before(day("2026-10-24")), day("2026-10-23"));
        assert_eq!(workday_on_or_before(day("2026-10-25")), day("2026-10-23"));
        assert_eq!(workday_on_or_before(day("2026-10-26")), day("2026-10-26"));
    }

    #[test]
    fn whole_workdays_count_from_the_anchor_through_the_finish() {
        assert_eq!(effort_for_finish(day("2026-10-21"), day("2026-10-21")), Ok(480));
        assert_eq!(effort_for_finish(day("2026-10-21"), day("2026-10-22")), Ok(960));
        assert_eq!(effort_for_finish(day("2026-10-23"), day("2026-10-26")), Ok(960));
    }

    #[test]
    fn a_finish_before_the_anchor_or_too_far_out_is_rejected() {
        assert_eq!(
            effort_for_finish(day("2026-10-21"), day("2026-10-20")),
            Err("finish_before_start".into())
        );
        assert_eq!(
            effort_for_finish(day("2026-10-21"), day("2027-02-01")),
            Err("finish_too_far".into())
        );
    }
}

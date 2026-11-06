use crate::repo::tasks::VISIBLE_TASK_FILTER;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone, Timelike};
use rusqlite::Connection;

pub struct Candidate {
    pub task_id: String,
    pub kind: &'static str,
    pub due_key: String,
    pub scheduled_for: DateTime<Local>,
    /// Snoozes are not written to `notifications`: the first reminder already counted.
    pub record: bool,
}

/// The daily digest: what is due today, what is late, and the first few names.
pub struct Digest {
    pub due: usize,
    pub overdue: usize,
    pub titles: Vec<String>,
    pub folded: usize,
}

const CATCH_UP_DAYS: i64 = 14;
/// The digest fires once a day at this local time.
const DIGEST_HOUR: u32 = 9;
/// Names the digest body spells out before folding the rest into a count.
const DIGEST_TITLES: usize = 2;

pub fn candidates(conn: &Connection, now: DateTime<Local>) -> Result<Vec<Candidate>, String> {
    let mut out = Vec::new();
    let today = now.date_naive();
    let lead = crate::repo::settings::reminder_lead_minutes(conn);
    // A pending snooze owns the task's next reminder; other kinds would double up.
    let snoozed = crate::repo::snoozes::all(conn).map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT id, expected_finish_date, expected_finish_time, created_at FROM tasks
         WHERE expected_finish_date IS NOT NULL AND status <> 'done' AND suspended = 0
           AND {}",
        VISIBLE_TASK_FILTER
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (task_id, due, expected_finish_time, created_at) = row.map_err(|e| e.to_string())?;
        let Ok(due_date) = NaiveDate::parse_from_str(&due, "%Y-%m-%d") else {
            continue;
        };
        // A task that did not exist yet at the reminder's moment must not trigger a
        // catch-up toast for a slot already gone by. The creation stamp is used, not the
        // edit stamp: fixing a typo after the slot must not silence the reminder.
        let created = chrono::DateTime::parse_from_rfc3339(&created_at)
            .map(|stamp| stamp.with_timezone(&Local))
            .ok();
        if snoozed.iter().any(|(id, _)| id == &task_id) {
            continue;
        }
        // A daylight-saving gap means this clock time does not exist that day; skip the
        // task instead of failing every other reminder in the scan.
        let timed = expected_finish_time
            .as_deref()
            .and_then(|raw| NaiveTime::parse_from_str(raw, "%H:%M").ok());
        let moment = match timed {
            Some(at) => match local_at(due_date, at.hour(), at.minute()) {
                Ok(moment) => moment,
                Err(_) => continue,
            },
            None => match local_at(due_date, 17, 30) {
                Ok(moment) => moment,
                Err(_) => continue,
            },
        };
        // Without a lead the untimed reminder keeps its day-before slot; a lead pulls
        // both kinds forward from the task's own moment.
        let scheduled = if lead == 0 && timed.is_none() {
            match local_at(due_date - Duration::days(1), 17, 30) {
                Ok(advance) => advance,
                Err(_) => continue,
            }
        } else {
            moment - Duration::minutes(lead)
        };
        if due_date >= today
            && scheduled <= now
            && recent(scheduled, now)
            && created_before_slot(created, scheduled)
        {
            out.push(Candidate {
                task_id: task_id.clone(),
                kind: "due_tomorrow",
                due_key: due.clone(),
                scheduled_for: scheduled,
                record: true,
            });
        }
        // The task is overdue only after its own day ends; the notice belongs to
        // the next day's 17:30, or the first launch after that.
        let overdue_at = match local_at(due_date + Duration::days(1), 17, 30) {
            Ok(at) => at,
            Err(_) => continue,
        };
        if due_date < today && overdue_at <= now && recent(overdue_at, now) {
            out.push(Candidate {
                task_id,
                kind: "overdue",
                due_key: due,
                scheduled_for: overdue_at,
                record: true,
            });
        }
    }

    let sql = format!(
        "SELECT id, suspended_until FROM tasks
         WHERE suspended_until IS NOT NULL AND status <> 'done'
           AND {}",
        VISIBLE_TASK_FILTER
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (task_id, until) = row.map_err(|e| e.to_string())?;
        let Ok(date) = NaiveDate::parse_from_str(&until, "%Y-%m-%d") else {
            continue;
        };
        let scheduled = local_at(date, 9, 0)?;
        if scheduled <= now && recent(scheduled, now) {
            out.push(Candidate {
                task_id,
                kind: "suspend_start",
                due_key: until,
                scheduled_for: scheduled,
                record: true,
            });
        }
    }

    // Snoozes the user asked for; a row is dropped as soon as it is handed over, so a
    // reminder that was postponed once cannot come back next tick.
    for (task_id, fire_at) in snoozed {
        let due: Option<String> = conn
            .query_row(
                &format!(
                    "SELECT expected_finish_date FROM tasks
                     WHERE id = ?1 AND expected_finish_date IS NOT NULL AND status <> 'done'
                       AND suspended = 0 AND {}",
                    VISIBLE_TASK_FILTER
                ),
                [&task_id],
                |r| r.get(0),
            )
            .ok();
        let Some(due) = due else {
            // Finished, deleted, archived, or it lost its day while postponed.
            let _ = crate::repo::snoozes::remove(conn, &task_id);
            continue;
        };
        let Ok(fire_at) = DateTime::parse_from_rfc3339(&fire_at) else {
            let _ = crate::repo::snoozes::remove(conn, &task_id);
            continue;
        };
        let fire_at = fire_at.with_timezone(&Local);
        if fire_at > now {
            continue;
        }
        let _ = crate::repo::snoozes::remove(conn, &task_id);
        if !recent(fire_at, now) {
            continue;
        }
        let Ok(due_date) = NaiveDate::parse_from_str(&due, "%Y-%m-%d") else {
            continue;
        };
        out.push(Candidate {
            task_id,
            kind: if due_date < today { "overdue" } else { "due_tomorrow" },
            due_key: due,
            scheduled_for: fire_at,
            record: false,
        });
    }

    Ok(out)
}

/// The 09:00 digest, once a day: what is due today and what is already late.
/// Returns nothing before 09:00, on a day with no work, or when it already fired.
pub fn digest(conn: &Connection, now: DateTime<Local>) -> Result<Option<Digest>, String> {
    if !crate::repo::settings::reminders_digest(conn) {
        return Ok(None);
    }
    let today = now.date_naive();
    let Ok(at) = local_at(today, DIGEST_HOUR, 0) else {
        return Ok(None);
    };
    if at > now {
        return Ok(None);
    }
    let key = today.format("%Y-%m-%d").to_string();
    let fired = crate::repo::settings::get(conn, "reminders.digest_date")
        .ok()
        .flatten()
        .as_deref()
        == Some(key.as_str());
    if fired {
        return Ok(None);
    }
    let count = |extra: &str| -> Result<i64, String> {
        conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM tasks
                 WHERE status <> 'done' AND suspended = 0 AND {extra} AND {VISIBLE_TASK_FILTER}"
            ),
            [&key],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
    };
    let due = count("expected_finish_date = ?1")?;
    let overdue = count("expected_finish_date < ?1")?;
    if due == 0 && overdue == 0 {
        return Ok(None);
    }
    let mut stmt = conn
        .prepare(&format!(
            "SELECT title FROM tasks
             WHERE expected_finish_date IS NOT NULL AND expected_finish_date <= ?1
               AND status <> 'done' AND suspended = 0 AND {}
             ORDER BY expected_finish_date DESC, sort_order
             LIMIT {DIGEST_TITLES}",
            VISIBLE_TASK_FILTER
        ))
        .map_err(|e| e.to_string())?;
    let titles: Vec<String> = stmt
        .query_map([&key], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let total = (due + overdue) as usize;
    Ok(Some(Digest {
        due: due as usize,
        overdue: overdue as usize,
        folded: total.saturating_sub(titles.len()),
        titles,
    }))
}

fn local_at(date: NaiveDate, hour: u32, minute: u32) -> Result<DateTime<Local>, String> {
    Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), hour, minute, 0)
        .single()
        .ok_or_else(|| "invalid_local_time".into())
}

fn recent(scheduled: DateTime<Local>, now: DateTime<Local>) -> bool {
    scheduled >= now - Duration::days(CATCH_UP_DAYS)
}

/// Whether the task already existed when the reminder came due. A task captured after
/// that moment did not have the deadline then, so its toast is skipped instead of arriving
/// as a catch-up right after the capture.
fn created_before_slot(created: Option<DateTime<Local>>, scheduled: DateTime<Local>) -> bool {
    match created {
        Some(created) => created <= scheduled,
        // An unreadable stamp keeps the old behaviour rather than silencing reminders.
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Local, TimeZone};
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn task_with_due(c: &Connection, id: &str, due: &str) {
        crate::services::week::capture(c, "交底", NOW, id).unwrap();
        // Backdate the creation stamp: a deadline set now would be newer than the reminder
        // slot, and these cases are about tasks that had the deadline all along. The edit
        // stamp is backdated too so a later edit can be simulated on its own.
        c.execute(
            "UPDATE tasks SET expected_finish_date = ?1,
                    created_at = '2026-10-18T00:00:00Z',
                    updated_at = '2026-10-18T00:00:00Z'
             WHERE id = ?2",
            rusqlite::params![due, id],
        )
        .unwrap();
    }

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> chrono::DateTime<Local> {
        Local.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    #[test]
    fn advance_reminder_fires_at_1730() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-21");
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].kind, "due_tomorrow");
        assert_eq!(
            cands[0].scheduled_for.format("%Y-%m-%d %H:%M").to_string(),
            "2026-10-20 17:30"
        );
    }

    #[test]
    fn advance_reminder_not_early() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-21");
        assert!(
            crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 29))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn overdue_waits_until_1730_the_next_day() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-20");

        let early = crate::reminders::rules::candidates(&c, at(2026, 10, 21, 0, 1)).unwrap();
        assert!(early.iter().all(|candidate| candidate.kind != "overdue"));

        let late = crate::reminders::rules::candidates(&c, at(2026, 10, 21, 17, 31)).unwrap();
        let overdue = late
            .iter()
            .find(|candidate| candidate.kind == "overdue")
            .unwrap();
        assert_eq!(
            overdue.scheduled_for.format("%Y-%m-%d %H:%M").to_string(),
            "2026-10-21 17:30"
        );
    }

    #[test]
    fn overdue_catches_up_after_the_next_evening() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-20");

        let caught = crate::reminders::rules::candidates(&c, at(2026, 10, 22, 10, 0)).unwrap();
        let overdue = caught
            .iter()
            .find(|candidate| candidate.kind == "overdue")
            .unwrap();
        assert_eq!(
            overdue.scheduled_for.format("%Y-%m-%d %H:%M").to_string(),
            "2026-10-21 17:30"
        );
    }

    #[test]
    fn overdue_fires_once() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-17");
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 10, 0)).unwrap();
        let overdue = cands.iter().find(|x| x.kind == "overdue").unwrap();
        let first = crate::repo::notifications::fire(
            &c,
            "n1",
            &overdue.task_id,
            overdue.kind,
            &overdue.due_key,
            &overdue.scheduled_for.to_rfc3339(),
            NOW,
        )
        .unwrap();
        let second = crate::repo::notifications::fire(
            &c,
            "n2",
            &overdue.task_id,
            overdue.kind,
            &overdue.due_key,
            &overdue.scheduled_for.to_rfc3339(),
            NOW,
        )
        .unwrap();
        assert!(first);
        assert!(!second);
        let count: i64 = c
            .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn suspend_start_fires_at_0900() {
        let c = crate::db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET in_week=0, suspended=1, suspended_until='2026-10-20'
             WHERE id='t1'",
            [],
        )
        .unwrap();
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 9, 1)).unwrap();
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].kind, "suspend_start");
    }

    #[test]
    fn an_undated_suspension_has_no_reminder() {
        let c = crate::db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::services::week::suspend(&c, "t1", None, Some("等甲方"), NOW).unwrap();

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 9, 1)).unwrap();
        assert!(cands.iter().all(|c| c.kind != "suspend_start"));
    }

    #[test]
    fn a_deadline_derived_after_its_slot_does_not_catch_up() {
        let c = crate::db::open_in_memory().unwrap();
        // Captured today with a one-hour estimate: the finish is today, but the
        // "tomorrow's deadline" slot from yesterday evening was never theirs.
        crate::services::week::capture(&c, "买螺丝", "2026-10-20T08:00:00Z", "t1").unwrap();
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 8, 0)).unwrap();
        assert!(
            cands.iter().all(|candidate| candidate.task_id != "t1"),
            "a freshly captured task must not toast for a slot that already passed"
        );
    }

    #[test]
    fn an_older_deadline_still_reminds() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-21");
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert!(cands.iter().any(|c| c.task_id == "t1" && c.kind == "due_tomorrow"));
    }

    #[test]
    fn catch_up_skips_older_than_14_days() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-09-30");
        assert!(
            crate::reminders::rules::candidates(&c, at(2026, 10, 20, 10, 0))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn malformed_dates_are_skipped_not_fatal() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "bad-due", "2026-10-21");
        c.execute("UPDATE tasks SET expected_finish_date = '周五' WHERE id = 'bad-due'", [])
            .unwrap();
        task_with_due(&c, "good-due", "2026-10-21");

        crate::services::week::capture(&c, "挂起坏的", NOW, "bad-suspend").unwrap();
        crate::services::week::capture(&c, "挂起好的", NOW, "good-suspend").unwrap();
        c.execute(
            "UPDATE tasks SET in_week=0, suspended=1, suspended_until='不是日期'
             WHERE id='bad-suspend'",
            [],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET in_week=0, suspended=1, suspended_until='2026-10-20'
             WHERE id='good-suspend'",
            [],
        )
        .unwrap();

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert!(
            cands
                .iter()
                .any(|c| c.task_id == "good-due" && c.kind == "due_tomorrow")
        );
        assert!(
            cands
                .iter()
                .any(|c| c.task_id == "good-suspend" && c.kind == "suspend_start")
        );
        assert!(cands.iter().all(|c| c.task_id != "bad-due"));
        assert!(cands.iter().all(|c| c.task_id != "bad-suspend"));
    }

    #[test]
    fn archived_project_tasks_do_not_remind() {
        let c = crate::db::open_in_memory().unwrap();
        let project = crate::services::projects::create(&c, "项目", NOW).unwrap();
        task_with_due(&c, "t1", "2026-10-21");
        c.execute(
            "UPDATE tasks SET project_id = ?1 WHERE id = 't1'",
            [&project.id],
        )
        .unwrap();
        crate::repo::projects::set_archived(&c, &project.id, true, NOW).unwrap();

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert!(cands.iter().all(|c| c.task_id != "t1"));

        task_with_due(&c, "t2", "2026-10-21");
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert!(
            cands
                .iter()
                .any(|c| c.task_id == "t2" && c.kind == "due_tomorrow")
        );
    }

    fn timed_task(c: &Connection, id: &str, due: &str, time: &str) {
        task_with_due(c, id, due);
        c.execute(
            "UPDATE tasks SET expected_finish_time = ?1 WHERE id = ?2",
            rusqlite::params![time, id],
        )
        .unwrap();
    }

    #[test]
    fn a_timed_reminder_waits_for_its_own_minute() {
        let c = crate::db::open_in_memory().unwrap();
        timed_task(&c, "t1", "2026-10-20", "13:30");

        let early = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 13, 29)).unwrap();
        assert!(early.is_empty());

        let on_time = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 13, 30)).unwrap();
        assert_eq!(on_time.len(), 1);
        assert_eq!(on_time[0].task_id, "t1");
        assert_eq!(on_time[0].due_key, "2026-10-20");
        assert_eq!(
            on_time[0].scheduled_for.format("%H:%M").to_string(),
            "13:30"
        );
    }

    #[test]
    fn a_timed_task_skips_the_evening_before_notice() {
        let c = crate::db::open_in_memory().unwrap();
        timed_task(&c, "t1", "2026-10-21", "13:30");
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();
        assert!(cands.is_empty());
    }

    #[test]
    fn yesterday_timed_task_gets_no_late_toast() {
        let c = crate::db::open_in_memory().unwrap();
        timed_task(&c, "t1", "2026-10-19", "13:30");
        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 10, 0)).unwrap();
        // No timed toast for a past day; it is only the next day's 17:30 overdue check.
        assert!(cands.iter().all(|c| c.scheduled_for.format("%Y-%m-%d").to_string()
            != "2026-10-19"));
    }

    fn lead(c: &Connection, minutes: i64) {
        crate::repo::settings::set(c, "reminders.lead_minutes", &minutes.to_string()).unwrap();
    }

    fn scheduled(c: &Connection, now: chrono::DateTime<Local>) -> Vec<String> {
        crate::reminders::rules::candidates(c, now)
            .unwrap()
            .into_iter()
            .map(|candidate| candidate.scheduled_for.format("%Y-%m-%d %H:%M").to_string())
            .collect()
    }

    #[test]
    fn a_lead_pulls_a_timed_reminder_forward() {
        let c = crate::db::open_in_memory().unwrap();
        timed_task(&c, "t1", "2026-10-20", "17:30");
        lead(&c, 30);

        let early = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 16, 59)).unwrap();
        assert!(early.is_empty());

        let on_time = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 0)).unwrap();
        assert_eq!(on_time.len(), 1);
        assert_eq!(on_time[0].due_key, "2026-10-20");
        assert_eq!(on_time[0].kind, "due_tomorrow");
        assert_eq!(
            on_time[0].scheduled_for.format("%H:%M").to_string(),
            "17:00"
        );
    }

    #[test]
    fn a_lead_moves_a_date_only_task_off_the_day_before() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-20");
        lead(&c, 30);

        // 17:00 on the due day, not the 17:30 of the day before.
        assert_eq!(scheduled(&c, at(2026, 10, 20, 17, 1)), ["2026-10-20 17:00"]);
        // A whole day of lead is the built-in slot again.
        lead(&c, 1440);
        assert_eq!(scheduled(&c, at(2026, 10, 19, 17, 31)), ["2026-10-19 17:30"]);
        // No lead keeps the day-before slot.
        lead(&c, 0);
        assert_eq!(scheduled(&c, at(2026, 10, 19, 17, 31)), ["2026-10-19 17:30"]);
    }

    #[test]
    fn a_lead_can_cross_midnight_without_duplicating() {
        let c = crate::db::open_in_memory().unwrap();
        timed_task(&c, "t1", "2026-10-21", "00:15");
        lead(&c, 60);

        assert_eq!(scheduled(&c, at(2026, 10, 20, 23, 16)), ["2026-10-20 23:15"]);
        // The same due day yields the same key, so the notification table dedupes it.
        let candidate = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 23, 30))
            .unwrap()
            .remove(0);
        let fired = crate::repo::notifications::fire(
            &c,
            "n1",
            &candidate.task_id,
            candidate.kind,
            &candidate.due_key,
            &candidate.scheduled_for.to_rfc3339(),
            NOW,
        )
        .unwrap();
        let again = crate::repo::notifications::fire(
            &c,
            "n2",
            &candidate.task_id,
            candidate.kind,
            &candidate.due_key,
            &candidate.scheduled_for.to_rfc3339(),
            NOW,
        )
        .unwrap();
        assert!(fired && !again);
    }

    #[test]
    fn a_snooze_replaces_the_other_reminders_and_fires_once() {
        let c = crate::db::open_in_memory().unwrap();
        timed_task(&c, "t1", "2026-10-20", "17:30");
        crate::repo::snoozes::set(
            &c,
            "t1",
            &at(2026, 10, 20, 10, 0)
                .with_timezone(&chrono::Utc)
                .to_rfc3339(),
        )
        .unwrap();

        // Before its moment neither the snooze nor the task's own reminder fires.
        assert!(scheduled(&c, at(2026, 10, 20, 9, 0)).is_empty());

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 10, 1)).unwrap();
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].kind, "due_tomorrow");
        assert!(!cands[0].record, "a snooze must not write a second notification");
        // The row is gone, so the next tick has nothing left to hand over.
        assert!(crate::repo::snoozes::all(&c).unwrap().is_empty());
        assert!(scheduled(&c, at(2026, 10, 20, 10, 2)).is_empty());
    }

    #[test]
    fn a_snooze_goes_late_once_the_day_passes() {
        let c = crate::db::open_in_memory().unwrap();
        timed_task(&c, "t1", "2026-10-20", "17:30");
        crate::repo::snoozes::set(
            &c,
            "t1",
            &at(2026, 10, 21, 1, 0).with_timezone(&chrono::Utc).to_rfc3339(),
        )
        .unwrap();

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 21, 9, 0)).unwrap();
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].kind, "overdue");
        assert_eq!(cands[0].due_key, "2026-10-20");
    }

    #[test]
    fn a_snooze_on_a_finished_task_is_dropped() {
        let c = crate::db::open_in_memory().unwrap();
        timed_task(&c, "t1", "2026-10-20", "17:30");
        crate::repo::snoozes::set(
            &c,
            "t1",
            &at(2026, 10, 20, 1, 0).with_timezone(&chrono::Utc).to_rfc3339(),
        )
        .unwrap();
        crate::services::tasks::set_status(&c, "t1", "done", NOW).unwrap();

        assert!(scheduled(&c, at(2026, 10, 20, 10, 0)).is_empty());
        assert!(crate::repo::snoozes::all(&c).unwrap().is_empty());
    }

    #[test]
    fn the_digest_waits_for_nine_and_fires_once_a_day() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-20");

        assert!(crate::reminders::rules::digest(&c, at(2026, 10, 20, 8, 59))
            .unwrap()
            .is_none());

        let digest = crate::reminders::rules::digest(&c, at(2026, 10, 20, 9, 0))
            .unwrap()
            .unwrap();
        assert_eq!((digest.due, digest.overdue), (1, 0));
        assert_eq!(digest.titles, ["交底"]);

        // The tick dates it before showing, so later ticks stay quiet.
        crate::repo::settings::set(&c, "reminders.digest_date", "2026-10-20").unwrap();
        assert!(crate::reminders::rules::digest(&c, at(2026, 10, 20, 15, 0))
            .unwrap()
            .is_none());
        // The next day the same task is late, and the digest still goes out once.
        let tomorrow = crate::reminders::rules::digest(&c, at(2026, 10, 21, 9, 0))
            .unwrap()
            .unwrap();
        assert_eq!((tomorrow.due, tomorrow.overdue), (0, 1));
    }

    #[test]
    fn the_digest_counts_overdue_work_and_skips_empty_days() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-20");
        task_with_due(&c, "t2", "2026-10-19");
        task_with_due(&c, "t3", "2026-10-18");
        task_with_due(&c, "t4", "2026-10-25");

        let digest = crate::reminders::rules::digest(&c, at(2026, 10, 20, 9, 30))
            .unwrap()
            .unwrap();
        assert_eq!((digest.due, digest.overdue), (1, 2));
        assert_eq!(digest.titles.len(), 2, "only the first two names are spelled out");
        assert_eq!(digest.folded, 1);

        let quiet = crate::db::open_in_memory().unwrap();
        task_with_due(&quiet, "t1", "2026-10-25");
        assert!(crate::reminders::rules::digest(&quiet, at(2026, 10, 20, 9, 30))
            .unwrap()
            .is_none());
    }

    #[test]
    fn the_digest_can_be_turned_off() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-20");
        crate::repo::settings::set(&c, "reminders.digest", "false").unwrap();

        assert!(crate::reminders::rules::digest(&c, at(2026, 10, 20, 9, 30))
            .unwrap()
            .is_none());
    }

    #[test]
    fn a_parked_task_does_not_remind_about_its_deadline() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-21");
        crate::services::week::suspend(&c, "t1", Some("2026-11-02"), None, NOW).unwrap();

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 17, 31)).unwrap();

        assert!(
            cands.iter().all(|candidate| candidate.task_id != "t1"),
            "a parked task must not nag about a deadline the user put on hold"
        );
    }

    #[test]
    fn a_parked_task_is_left_out_of_the_digest() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-20");
        crate::services::week::suspend(&c, "t1", None, Some("等甲方"), NOW).unwrap();

        assert!(
            crate::reminders::rules::digest(&c, at(2026, 10, 20, 9, 30))
                .unwrap()
                .is_none(),
            "the morning digest counts parked work as due"
        );
    }

    #[test]
    fn an_edit_after_the_reminder_slot_still_reminds() {
        let c = crate::db::open_in_memory().unwrap();
        task_with_due(&c, "t1", "2026-10-21");
        // The user edits the title after the 17:30 slot; only the deadline changing later
        // may cancel the catch-up, not any edit at all.
        c.execute(
            "UPDATE tasks SET updated_at = '2026-10-20T18:00:00Z' WHERE id = 't1'",
            [],
        )
        .unwrap();

        let cands = crate::reminders::rules::candidates(&c, at(2026, 10, 20, 18, 1)).unwrap();

        assert!(
            cands
                .iter()
                .any(|candidate| candidate.task_id == "t1" && candidate.kind == "due_tomorrow"),
            "an edit must not silence the reminder permanently"
        );
    }
}

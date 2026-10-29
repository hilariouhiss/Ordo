use crate::dto::{RuleDto, RuleInput};
use crate::repo::rules;
use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, SecondsFormat};
use rusqlite::{params, Connection};
use uuid::Uuid;

/// Yesterday is included so an evening occurrence is not lost when the app was closed.
/// Anything older is skipped on purpose: stale occurrences would only pile up.
const BACK_DAYS: i64 = 1;

pub fn save(conn: &Connection, input: &RuleInput, now: &str) -> Result<RuleDto, String> {
    let rule = normalize(input)?;
    crate::services::validate_links(
        conn,
        rule.project_id.as_deref(),
        rule.category_id.as_deref(),
        rule.owner_id.as_deref(),
    )?;
    match rule.id.clone() {
        Some(id) => {
            if rules::update(conn, &id, &rule, now).map_err(|e| e.to_string())? == 0 {
                return Err("rule_not_found".into());
            }
            load(conn, &id)
        }
        None => {
            let id = Uuid::new_v4().to_string();
            rules::insert(conn, &id, &rule, now).map_err(|e| e.to_string())?;
            load(conn, &id)
        }
    }
}

pub fn set_enabled(
    conn: &Connection,
    id: &str,
    enabled: bool,
    now: &str,
) -> Result<RuleDto, String> {
    if rules::set_enabled(conn, id, enabled, now).map_err(|e| e.to_string())? == 0 {
        return Err("rule_not_found".into());
    }
    load(conn, id)
}

pub fn remove(conn: &Connection, id: &str, now: &str) -> Result<(), String> {
    if rules::soft_delete(conn, id, now).map_err(|e| e.to_string())? == 0 {
        return Err("rule_not_found".into());
    }
    Ok(())
}

fn load(conn: &Connection, id: &str) -> Result<RuleDto, String> {
    rules::get(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "rule_not_found".to_string())
}

fn normalize(input: &RuleInput) -> Result<RuleInput, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("empty_rule_title".into());
    }
    if input.weekdays.is_empty() || input.weekdays.iter().any(|day| !(1..=7).contains(day)) {
        return Err("invalid_weekday".into());
    }
    let mut weekdays = input.weekdays.clone();
    weekdays.sort_unstable();
    weekdays.dedup();
    let priority = input
        .priority
        .clone()
        .unwrap_or_else(|| "normal".to_string());
    if !crate::services::tasks::valid_priority(&priority) {
        return Err("invalid_priority".into());
    }
    let effort_minutes = input.effort_minutes.unwrap_or(480);
    if !crate::services::tasks::valid_effort(effort_minutes) {
        return Err("invalid_effort".into());
    }
    Ok(RuleInput {
        id: input.id.clone(),
        title: title.to_string(),
        weekdays,
        at: normalize_time(&input.at)?,
        project_id: input.project_id.clone(),
        category_id: input.category_id.clone(),
        owner_id: input.owner_id.clone(),
        priority: Some(priority),
        effort_minutes: Some(effort_minutes),
        exclusive: Some(input.exclusive.unwrap_or(true)),
    })
}

/// Accepts "9:00" and stores "09:00".
pub fn normalize_time(raw: &str) -> Result<String, String> {
    let (hour, minute) = raw
        .trim()
        .split_once(':')
        .ok_or_else(|| "invalid_time".to_string())?;
    let hour: u32 = hour.parse().map_err(|_| "invalid_time".to_string())?;
    let minute: u32 = minute.parse().map_err(|_| "invalid_time".to_string())?;
    if hour > 23 || minute > 59 {
        return Err("invalid_time".into());
    }
    Ok(format!("{hour:02}:{minute:02}"))
}

/// Creates the task rows for the occurrences that are due. Runs on the reminder tick and
/// right after a rule is saved, so a new rule shows today's occurrence immediately.
pub fn materialize(conn: &Connection, now: DateTime<Local>) -> Result<Vec<String>, String> {
    let mut created = Vec::new();
    for rule in rules::live(conn).map_err(|e| e.to_string())? {
        // One broken rule must not stop the others from appearing.
        if let Ok(ids) = materialize_rule(conn, &rule, now) {
            created.extend(ids);
        }
    }
    Ok(created)
}

pub fn materialize_rule(
    conn: &Connection,
    rule: &RuleDto,
    now: DateTime<Local>,
) -> Result<Vec<String>, String> {
    if NaiveTime::parse_from_str(&rule.at, "%H:%M").is_err() {
        return Ok(Vec::new());
    }
    // An archived project is parked, so its rules must not fill the ledger with rows
    // that no surface shows and that reappear when the project is restored.
    if let Some(project_id) = rule.project_id.as_deref() {
        if crate::repo::projects::is_archived(conn, project_id).map_err(|e| e.to_string())? {
            return Ok(Vec::new());
        }
    }
    let created_on = rules::created_on(conn, &rule.id).map_err(|e| e.to_string())?;
    let today = now.date_naive();
    let mut created = Vec::new();
    for back in 0..=BACK_DAYS {
        let date = today - Duration::days(back);
        if !rule
            .weekdays
            .contains(&date.weekday().number_from_monday())
        {
            continue;
        }
        let due = date.format("%Y-%m-%d").to_string();
        // A rule cannot owe occurrences from before it existed.
        if let Some(created) = created_on.as_deref() {
            if due.as_str() < created {
                continue;
            }
        }
        // Deleted and archived rows count too: a removed occurrence must not come back.
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tasks WHERE rule_id = ?1 AND due_date = ?2)",
                params![rule.id, due],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists {
            continue;
        }
        created.push(insert_generated(conn, rule, &due, now)?);
    }
    Ok(created)
}

fn insert_generated(
    conn: &Connection,
    rule: &RuleDto,
    due: &str,
    now: DateTime<Local>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let stamp = now
        .to_utc()
        .to_rfc3339_opts(SecondsFormat::Secs, true);
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // Same rule as a captured task: an owner inside a project is a member of it.
    crate::services::projects::ensure_member(
        &tx,
        rule.project_id.as_deref(),
        rule.owner_id.as_deref(),
        &stamp,
    )?;
    tx.execute(
        "INSERT INTO tasks (id, title, project_id, category_id, owner_id, priority, due_date,
                            due_time, effort_minutes, time_exclusive, status, in_week, carry_count,
                            sort_order, rule_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4,
                 COALESCE(?5, (SELECT id FROM people WHERE is_me = 1 LIMIT 1)),
                 ?6, ?7, ?8, ?9, ?10, 'todo', 1, 0,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks), ?11, ?12, ?12)",
        params![
            id,
            rule.title,
            rule.project_id,
            rule.category_id,
            rule.owner_id,
            rule.priority,
            due,
            rule.at,
            rule.effort_minutes,
            rule.exclusive as i64,
            rule.id,
            stamp
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use crate::db;
    use rusqlite::Connection;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    fn weekday(y: i32, m: u32, d: u32) -> u32 {
        chrono::NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .weekday()
            .number_from_monday()
    }

    fn input(title: &str, weekdays: Vec<u32>, at: &str) -> RuleInput {
        RuleInput {
            title: title.into(),
            weekdays,
            at: at.into(),
            ..Default::default()
        }
    }

    fn generated(c: &Connection, rule_id: &str) -> Vec<(String, Option<String>, bool)> {
        let mut stmt = c
            .prepare("SELECT due_date, due_time, in_week FROM tasks WHERE rule_id = ?1 ORDER BY due_date")
            .unwrap();
        let rows = stmt
            .query_map([rule_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? == 1))
            })
            .unwrap();
        rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
    }

    #[test]
    fn saving_rejects_empty_or_impossible_schedules() {
        let c = db::open_in_memory().unwrap();
        assert_eq!(save(&c, &input("  ", vec![1], "09:00"), NOW).unwrap_err(), "empty_rule_title");
        assert_eq!(save(&c, &input("报销", vec![], "09:00"), NOW).unwrap_err(), "invalid_weekday");
        assert_eq!(save(&c, &input("报销", vec![0], "09:00"), NOW).unwrap_err(), "invalid_weekday");
        assert_eq!(save(&c, &input("报销", vec![8], "09:00"), NOW).unwrap_err(), "invalid_weekday");
        assert_eq!(save(&c, &input("报销", vec![4], "25:00"), NOW).unwrap_err(), "invalid_time");
        assert_eq!(save(&c, &input("报销", vec![4], "12:60"), NOW).unwrap_err(), "invalid_time");
        assert_eq!(save(&c, &input("报销", vec![4], "9:00"), NOW).unwrap().at, "09:00");
    }

    #[test]
    fn saving_rejects_links_that_do_not_exist() {
        let c = db::open_in_memory().unwrap();
        let mut bad = input("开会", vec![1], "13:30");
        bad.owner_id = Some("nobody".into());
        assert_eq!(save(&c, &bad, NOW).unwrap_err(), "invalid_owner");
    }

    #[test]
    fn today_lands_once_and_carries_the_time() {
        let c = db::open_in_memory().unwrap();
        let day = weekday(2026, 10, 20);
        let rule = save(&c, &input("报销", vec![day], "09:00"), NOW).unwrap();

        let created = materialize(&c, at(2026, 10, 20, 10, 0)).unwrap();
        assert_eq!(created.len(), 1);
        assert!(materialize(&c, at(2026, 10, 20, 11, 0)).unwrap().is_empty());

        let rows = generated(&c, &rule.id);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "2026-10-20");
        assert_eq!(rows[0].1.as_deref(), Some("09:00"));
        assert!(rows[0].2);
    }

    #[test]
    fn an_existing_rule_backfills_yesterday() {
        let c = db::open_in_memory().unwrap();
        let yesterday = weekday(2026, 10, 19);
        let rule = save(&c, &input("开会", vec![yesterday], "13:30"), NOW).unwrap();
        // The rule existed before yesterday; the tick catches its missed occurrence up.
        c.execute(
            "UPDATE task_rules SET created_at = '2026-10-18T08:00:00Z' WHERE id = ?1",
            [&rule.id],
        )
        .unwrap();

        let created = materialize(&c, at(2026, 10, 20, 8, 0)).unwrap();
        assert_eq!(created.len(), 1);
        assert_eq!(generated(&c, &rule.id)[0].0, "2026-10-19");
    }

    #[test]
    fn a_new_rule_does_not_backfill_yesterday() {
        let c = db::open_in_memory().unwrap();
        let monday = weekday(2026, 10, 19);
        let rule = save(&c, &input("开会", vec![monday], "13:30"), NOW).unwrap();

        // The save command materializes right after creating the rule.
        let created = materialize_rule(&c, &rule, at(2026, 10, 20, 8, 0)).unwrap();

        assert!(created.is_empty());
        assert!(generated(&c, &rule.id).is_empty());

        // A later Monday is after the rule existed, so it still appears.
        assert_eq!(
            materialize_rule(&c, &rule, at(2026, 10, 26, 8, 0))
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn a_rule_for_an_archived_project_creates_nothing() {
        let c = db::open_in_memory().unwrap();
        let project = crate::services::projects::create(&c, "项目", NOW).unwrap();
        let day = weekday(2026, 10, 20);
        let mut draft = input("报销", vec![day], "09:00");
        draft.project_id = Some(project.id.clone());
        let rule = save(&c, &draft, NOW).unwrap();
        crate::repo::projects::set_archived(&c, &project.id, true, NOW).unwrap();

        assert!(materialize(&c, at(2026, 10, 20, 10, 0)).unwrap().is_empty());
        assert!(generated(&c, &rule.id).is_empty());
    }

    #[test]
    fn an_archived_project_rule_can_still_be_edited() {
        let c = db::open_in_memory().unwrap();
        let project = crate::services::projects::create(&c, "项目", NOW).unwrap();
        let day = weekday(2026, 10, 20);
        let mut draft = input("报销", vec![day], "09:00");
        draft.project_id = Some(project.id.clone());
        let rule = save(&c, &draft, NOW).unwrap();
        crate::repo::projects::set_archived(&c, &project.id, true, NOW).unwrap();

        draft.id = Some(rule.id.clone());
        draft.title = "报销（改）".into();
        let saved = save(&c, &draft, NOW).unwrap();

        assert_eq!(saved.title, "报销（改）");
        assert_eq!(saved.project_id.as_deref(), Some(project.id.as_str()));
    }

    #[test]
    fn a_generated_task_joins_the_project_members() {
        let c = db::open_in_memory().unwrap();
        let project = crate::services::projects::create(&c, "项目", NOW).unwrap();
        let outsider = crate::repo::people::create(&c, "u-outsider", "外人", NOW).unwrap();
        let day = weekday(2026, 10, 20);
        let mut draft = input("交底", vec![day], "09:00");
        draft.project_id = Some(project.id.clone());
        draft.owner_id = Some(outsider.id.clone());
        let rule = save(&c, &draft, NOW).unwrap();

        materialize(&c, at(2026, 10, 20, 10, 0)).unwrap();

        assert!(crate::repo::projects::is_member(&c, &project.id, &outsider.id).unwrap());
        assert_eq!(generated(&c, &rule.id).len(), 1);
    }

    #[test]
    fn older_than_yesterday_is_left_out() {
        let c = db::open_in_memory().unwrap();
        let two_days_ago = weekday(2026, 10, 18);
        let rule = save(&c, &input("开会", vec![two_days_ago], "13:30"), NOW).unwrap();
        assert!(materialize(&c, at(2026, 10, 20, 8, 0)).unwrap().is_empty());
        assert!(generated(&c, &rule.id).is_empty());
    }

    #[test]
    fn other_weekdays_generate_nothing() {
        let c = db::open_in_memory().unwrap();
        let tomorrow = weekday(2026, 10, 21);
        let rule = save(&c, &input("报销", vec![tomorrow], "09:00"), NOW).unwrap();
        assert!(materialize(&c, at(2026, 10, 20, 10, 0)).unwrap().is_empty());
        assert!(generated(&c, &rule.id).is_empty());
    }

    #[test]
    fn a_disabled_rule_stays_quiet() {
        let c = db::open_in_memory().unwrap();
        let day = weekday(2026, 10, 20);
        let rule = save(&c, &input("报销", vec![day], "09:00"), NOW).unwrap();
        set_enabled(&c, &rule.id, false, NOW).unwrap();

        assert!(materialize(&c, at(2026, 10, 20, 10, 0)).unwrap().is_empty());
        assert!(generated(&c, &rule.id).is_empty());
    }

    #[test]
    fn a_deleted_occurrence_is_not_recreated() {
        let c = db::open_in_memory().unwrap();
        let day = weekday(2026, 10, 20);
        let rule = save(&c, &input("报销", vec![day], "09:00"), NOW).unwrap();
        materialize(&c, at(2026, 10, 20, 10, 0)).unwrap();
        c.execute(
            "UPDATE tasks SET deleted_at = ?1 WHERE rule_id = ?2",
            rusqlite::params![NOW, rule.id],
        )
        .unwrap();

        assert!(materialize(&c, at(2026, 10, 20, 11, 0)).unwrap().is_empty());
        let total: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks WHERE rule_id = ?1", [&rule.id], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 1);
    }

    #[test]
    fn a_rule_remembers_its_category_and_exclusive_flag() {
        let c = db::open_in_memory().unwrap();
        let category = crate::repo::categories::list(&c).unwrap()[0].id.clone();
        let day = weekday(2026, 10, 20);
        let mut rule_input = input("评审", vec![day], "15:00");
        rule_input.category_id = Some(category.clone());
        rule_input.exclusive = Some(true);
        rule_input.effort_minutes = Some(960);
        let rule = save(&c, &rule_input, NOW).unwrap();

        materialize(&c, at(2026, 10, 20, 16, 0)).unwrap();

        let task_id: String = c
            .query_row("SELECT id FROM tasks WHERE rule_id = ?1", [&rule.id], |r| r.get(0))
            .unwrap();
        let task = crate::repo::tasks::dto(&c, &task_id).unwrap();
        assert_eq!(task.category_id.as_deref(), Some(category.as_str()));
        assert!(task.exclusive);
        assert_eq!(task.effort_minutes, 960);
        assert_eq!(task.due_time.as_deref(), Some("15:00"));
    }

    #[test]
    fn a_new_rule_and_its_task_are_exclusive_by_default() {
        let c = db::open_in_memory().unwrap();
        let day = weekday(2026, 10, 20);
        let rule = save(&c, &input("报销", vec![day], "09:00"), NOW).unwrap();
        assert!(rule.exclusive);

        materialize(&c, at(2026, 10, 20, 10, 0)).unwrap();

        let flag: i64 = c
            .query_row(
                "SELECT time_exclusive FROM tasks WHERE rule_id = ?1",
                [&rule.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(flag, 1);
    }

    #[test]
    fn deleting_a_rule_keeps_what_it_made() {
        let c = db::open_in_memory().unwrap();
        let day = weekday(2026, 10, 20);
        let rule = save(&c, &input("报销", vec![day], "09:00"), NOW).unwrap();
        materialize(&c, at(2026, 10, 20, 10, 0)).unwrap();
        remove(&c, &rule.id, NOW).unwrap();

        assert_eq!(remove(&c, &rule.id, NOW).unwrap_err(), "rule_not_found");
        let rows = generated(&c, &rule.id);
        assert_eq!(rows.len(), 1);
    }
}

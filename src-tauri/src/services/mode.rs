use crate::repo::settings::{self, keys};
use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, TimeZone, Utc};
use rusqlite::Connection;
use std::collections::HashMap;

pub const WORK: &str = settings::MODE_WORK;
pub const PERSONAL: &str = settings::MODE_PERSONAL;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    pub days: Vec<u32>,
    pub work_at: NaiveTime,
    pub personal_at: NaiveTime,
}

pub fn valid(value: &str) -> bool {
    settings::valid_mode(value)
}

fn time_of(value: Option<&String>) -> Option<NaiveTime> {
    value.and_then(|raw| NaiveTime::parse_from_str(raw.trim(), "%H:%M").ok())
}

/// A schedule only switched on (no times or days ever edited) still uses the
/// documented defaults, exactly as the settings page shows them.
fn time_or_default(value: Option<&String>, fallback: &str) -> Option<NaiveTime> {
    time_of(value).or_else(|| NaiveTime::parse_from_str(fallback, "%H:%M").ok())
}

/// A usable schedule, or none when auto is off or any piece is unusable. A broken
/// settings row must never panic or block the reminder tick.
pub fn parse_schedule(map: &HashMap<String, String>) -> Option<Schedule> {
    if map.get(keys::MODE_AUTO).map(String::as_str) != Some("true") {
        return None;
    }
    let days = map
        .get(keys::MODE_DAYS)
        .map(|raw| settings::parse_mode_days(raw))
        .filter(|days| !days.is_empty())
        .unwrap_or_else(|| settings::DEFAULT_MODE_DAYS.to_vec());
    let work_at = time_or_default(
        map.get(keys::MODE_WORK_AT),
        settings::DEFAULT_MODE_WORK_AT,
    )?;
    let personal_at = time_or_default(
        map.get(keys::MODE_PERSONAL_AT),
        settings::DEFAULT_MODE_PERSONAL_AT,
    )?;
    if work_at == personal_at {
        return None;
    }
    Some(Schedule {
        days,
        work_at,
        personal_at,
    })
}

/// The latest switch point at or before now, as (mode, UTC instant). Eight days back
/// covers a weekly day set plus the weekend gap.
pub fn latest_switch(
    schedule: &Schedule,
    now: DateTime<Local>,
) -> Option<(String, DateTime<Utc>)> {
    let mut best: Option<(String, DateTime<Utc>)> = None;
    for back in 0..=7 {
        let day = now.date_naive() - Duration::days(back);
        if !schedule
            .days
            .contains(&day.weekday().number_from_monday())
        {
            continue;
        }
        for (at, mode) in [(schedule.work_at, WORK), (schedule.personal_at, PERSONAL)] {
            // A local time skipped by a DST jump simply has no instant.
            let Some(local) = Local.from_local_datetime(&day.and_time(at)).earliest() else {
                continue;
            };
            if local > now {
                continue;
            }
            let stamp = local.with_timezone(&Utc);
            if best
                .as_ref()
                .is_none_or(|(_, current)| stamp > *current)
            {
                best = Some((mode.to_string(), stamp));
            }
        }
    }
    best
}

fn override_at(map: &HashMap<String, String>) -> Option<DateTime<Utc>> {
    map.get(keys::MODE_OVERRIDE_AT)
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|stamp| stamp.with_timezone(&Utc))
}

/// Switches the mode when a schedule point is newer than the last manual switch.
/// Returns the new mode only when it actually changed.
pub fn apply(conn: &Connection, now: DateTime<Local>) -> rusqlite::Result<Option<String>> {
    let map = settings::get_all(conn)?;
    let Some(schedule) = parse_schedule(&map) else {
        return Ok(None);
    };
    let Some((mode, at)) = latest_switch(&schedule, now) else {
        return Ok(None);
    };
    if override_at(&map).is_some_and(|manual| manual >= at) {
        return Ok(None);
    }
    if settings::mode_from_map(&map) == mode {
        return Ok(None);
    }
    settings::set(conn, keys::MODE, &mode)?;
    Ok(Some(mode))
}

/// A manual switch wins until the next schedule point newer than this stamp.
pub fn set_manual(conn: &Connection, mode: &str, now_iso: &str) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    settings::set(&tx, keys::MODE, mode)?;
    settings::set(&tx, keys::MODE_OVERRIDE_AT, now_iso)?;
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use chrono::Timelike;

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    fn weekdays_schedule() -> Schedule {
        Schedule {
            days: vec![1, 2, 3, 4, 5],
            work_at: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            personal_at: NaiveTime::from_hms_opt(18, 0, 0).unwrap(),
        }
    }

    fn auto_map(days: &str, work: &str, personal: &str) -> HashMap<String, String> {
        HashMap::from([
            (keys::MODE_AUTO.to_string(), "true".to_string()),
            (keys::MODE_DAYS.to_string(), days.to_string()),
            (keys::MODE_WORK_AT.to_string(), work.to_string()),
            (keys::MODE_PERSONAL_AT.to_string(), personal.to_string()),
        ])
    }

    #[test]
    fn latest_switch_takes_the_later_point_of_the_day() {
        let (mode, at) = latest_switch(&weekdays_schedule(), at(2026, 10, 20, 20, 0)).unwrap();
        assert_eq!(mode, PERSONAL);
        assert_eq!((at.hour(), at.minute()), (10, 0), "18:00 local is 10:00 UTC");
    }

    #[test]
    fn before_the_morning_point_the_last_evening_wins() {
        let (mode, _) = latest_switch(&weekdays_schedule(), at(2026, 10, 20, 8, 0)).unwrap();
        assert_eq!(mode, PERSONAL, "Monday 18:00 is still the latest point");
    }

    #[test]
    fn a_weekend_keeps_fridays_evening_mode() {
        let (mode, _) = latest_switch(&weekdays_schedule(), at(2026, 10, 24, 12, 0)).unwrap();
        assert_eq!(mode, PERSONAL);
        let (mode, _) = latest_switch(&weekdays_schedule(), at(2026, 10, 26, 8, 0)).unwrap();
        assert_eq!(mode, PERSONAL, "Monday before nine is still Friday's evening");
    }

    #[test]
    fn only_the_selected_days_switch() {
        let schedule = Schedule {
            days: vec![1],
            ..weekdays_schedule()
        };
        let (mode, at) = latest_switch(&schedule, at(2026, 10, 20, 10, 0)).unwrap();
        assert_eq!(mode, PERSONAL);
        assert_eq!((at.hour(), at.minute()), (10, 0), "Monday 18:00, not Tuesday work");
    }

    #[test]
    fn switching_auto_on_without_editing_uses_the_default_points() {
        // The settings page shows 09:00 / 18:00 / weekdays even before anything is
        // stored; the scheduler has to read the same defaults.
        let map = HashMap::from([(keys::MODE_AUTO.to_string(), "true".to_string())]);
        let schedule = parse_schedule(&map).expect("the defaults are a usable schedule");
        assert_eq!(schedule.days, vec![1, 2, 3, 4, 5]);
        assert_eq!((schedule.work_at.hour(), schedule.work_at.minute()), (9, 0));
        assert_eq!(
            (schedule.personal_at.hour(), schedule.personal_at.minute()),
            (18, 0)
        );
    }

    #[test]
    fn auto_off_broken_or_ambiguous_schedules_do_nothing() {
        assert!(parse_schedule(&auto_map("1,2,3,4,5", "09:00", "18:00")).is_some());
        let mut off = auto_map("1,2,3,4,5", "09:00", "18:00");
        off.insert(keys::MODE_AUTO.into(), "false".into());
        assert!(parse_schedule(&off).is_none());
        assert!(parse_schedule(&auto_map("1,2", "09:00", "09:00")).is_none());
        // A corrupt or emptied value reads as the default the settings page shows.
        assert_eq!(
            parse_schedule(&auto_map("1,2", "25:00", "18:00"))
                .unwrap()
                .work_at,
            NaiveTime::from_hms_opt(9, 0, 0).unwrap()
        );
        assert_eq!(
            parse_schedule(&auto_map("", "09:00", "18:00"))
                .unwrap()
                .days,
            vec![1, 2, 3, 4, 5]
        );
    }

    #[test]
    fn apply_writes_only_when_the_mode_actually_changes() {
        let c = db::open_in_memory().unwrap();
        for (key, value) in auto_map("1,2,3,4,5", "09:00", "18:00") {
            settings::set(&c, &key, &value).unwrap();
        }

        assert_eq!(
            apply(&c, at(2026, 10, 20, 20, 0)).unwrap().as_deref(),
            Some(PERSONAL)
        );
        assert_eq!(settings::mode(&c).unwrap(), PERSONAL);
        assert_eq!(apply(&c, at(2026, 10, 20, 20, 1)).unwrap(), None);
    }

    #[test]
    fn a_manual_switch_holds_until_the_next_point() {
        let c = db::open_in_memory().unwrap();
        for (key, value) in auto_map("1,2,3,4,5", "09:00", "18:00") {
            settings::set(&c, &key, &value).unwrap();
        }
        // Monday 19:30, after the evening point: the user goes back to work.
        set_manual(&c, WORK, "2026-10-19T11:30:00Z").unwrap();
        assert_eq!(apply(&c, at(2026, 10, 19, 20, 0)).unwrap(), None);
        assert_eq!(settings::mode(&c).unwrap(), WORK);
        // The next evening point is newer than the manual stamp, so it wins again.
        assert_eq!(
            apply(&c, at(2026, 10, 20, 18, 30)).unwrap().as_deref(),
            Some(PERSONAL)
        );
    }

    #[test]
    fn set_manual_stores_the_mode_and_the_stamp() {
        let c = db::open_in_memory().unwrap();
        set_manual(&c, PERSONAL, "2026-10-20T08:00:00Z").unwrap();

        assert_eq!(settings::mode(&c).unwrap(), PERSONAL);
        assert_eq!(
            settings::get(&c, keys::MODE_OVERRIDE_AT).unwrap().as_deref(),
            Some("2026-10-20T08:00:00Z")
        );
    }
}

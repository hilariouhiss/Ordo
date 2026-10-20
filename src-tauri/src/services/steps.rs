use crate::dto::TaskDto;
use crate::repo::{steps, tasks};
use crate::services::status::derive;
use rusqlite::Connection;
use uuid::Uuid;

pub fn add(
    conn: &Connection,
    task_id: &str,
    title: &str,
    now: &str,
) -> Result<TaskDto, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("empty_step".into());
    }
    let sort = steps::next_sort(conn, task_id).map_err(|e| e.to_string())?;
    steps::insert(
        conn,
        &Uuid::new_v4().to_string(),
        task_id,
        title,
        sort,
        now,
    )
    .map_err(|e| e.to_string())?;
    recompute(conn, task_id, now)
}

pub fn toggle(conn: &Connection, step_id: &str, now: &str) -> Result<TaskDto, String> {
    let step = steps::get(conn, step_id).map_err(|e| e.to_string())?;
    steps::set_done(conn, step_id, !step.done, now).map_err(|e| e.to_string())?;
    recompute(conn, &step.task_id, now)
}

pub fn remove(conn: &Connection, step_id: &str, now: &str) -> Result<TaskDto, String> {
    let step = steps::get(conn, step_id).map_err(|e| e.to_string())?;
    steps::soft_delete(conn, step_id, now).map_err(|e| e.to_string())?;
    recompute(conn, &step.task_id, now)
}

fn recompute(conn: &Connection, task_id: &str, now: &str) -> Result<TaskDto, String> {
    let stored = tasks::stored_status(conn, task_id).map_err(|e| e.to_string())?;
    let done_flags: Vec<bool> = steps::list(conn, task_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|s| s.done)
        .collect();
    let status = derive(&stored, &done_flags);
    tasks::set_status(conn, task_id, status, status == "done", now).map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

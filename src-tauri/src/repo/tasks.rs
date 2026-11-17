use crate::dto::{ArchiveTaskDto, CaptureFields, DelayDto, TagDto, TaskDto};
use rusqlite::types::Value;
use rusqlite::{params, Connection, OptionalExtension};

/// "This task has no live subtask", for a given table alias. A task with live subtasks
/// is an umbrella: its work is the children, so it is never planned or reminded alone.
/// One definition, because an umbrella must mean the same thing on every surface.
pub(crate) fn no_live_child(alias: &str) -> String {
    format!(
        "NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = {alias}.id \
         AND c.deleted_at IS NULL AND c.archived_at IS NULL AND c.canceled_at IS NULL)"
    )
}

/// The week, the pass, reminders and statistics only see live tasks outside archived
/// projects, and never an umbrella.
pub(crate) fn visible_task_filter(alias: &str) -> String {
    format!(
        "{alias}.canceled_at IS NULL AND {alias}.archived_at IS NULL \
         AND {alias}.deleted_at IS NULL \
         AND ({alias}.project_id IS NULL OR EXISTS (SELECT 1 FROM projects p \
              WHERE p.id = {alias}.project_id AND p.archived_at IS NULL)) \
         AND {}",
        no_live_child(alias)
    )
}

/// The week's finished rows: a done leaf, or the done umbrella whose live children are
/// all done. A done child under such an umbrella is left out, so one finished umbrella
/// reads as one card instead of its parts.
pub(crate) fn done_week_filter(alias: &str) -> String {
    let live_child = format!(
        "c.parent_id = {alias}.id AND c.deleted_at IS NULL AND c.archived_at IS NULL \
         AND c.canceled_at IS NULL"
    );
    format!(
        "{alias}.canceled_at IS NULL AND {alias}.archived_at IS NULL \
         AND {alias}.deleted_at IS NULL \
         AND ({alias}.project_id IS NULL OR EXISTS (SELECT 1 FROM projects p \
              WHERE p.id = {alias}.project_id AND p.archived_at IS NULL)) \
         AND (NOT EXISTS (SELECT 1 FROM tasks c WHERE {live_child}) \
              OR ({alias}.parent_id IS NULL \
                  AND NOT EXISTS (SELECT 1 FROM tasks c WHERE {live_child} AND c.status <> 'done'))) \
         AND NOT ({alias}.parent_id IS NOT NULL \
                  AND EXISTS (SELECT 1 FROM tasks p WHERE p.id = {alias}.parent_id \
                              AND p.status = 'done' AND p.deleted_at IS NULL \
                              AND p.archived_at IS NULL AND p.canceled_at IS NULL \
                              AND (p.project_id IS NULL OR EXISTS (SELECT 1 FROM projects pp \
                                   WHERE pp.id = p.project_id AND pp.archived_at IS NULL))))"
    )
}

/// How a task is parked. Every write of the parked columns goes through
/// [write_park_in], so the list below is the only place a new parked field is added.
#[derive(Clone, Copy)]
pub(crate) enum Park<'a> {
    /// Back on the week, nothing parked.
    InWeek,
    /// Out of the week until a day, on someone's reply, for a reason. `at` keeps the local
    /// day the park started; a later edit of the park keeps the first day.
    Parked {
        until: Option<&'a str>,
        reason: Option<&'a str>,
        on: Option<&'a str>,
        at: Option<&'a str>,
    },
}

/// Every parked column and the value that means "not parked". One list, so a new
/// parked field is picked up by the reset and the writer instead of silently missing one.
const PARK_FIELDS: [(&str, &str); 5] = [
    ("parked", "0"),
    ("parked_at", "NULL"),
    ("park_until", "NULL"),
    ("park_reason", "NULL"),
    ("parked_on_id", "NULL"),
];

/// The parked columns, written back to "nothing parked" when flag (a SQL parameter) is
/// true, and left alone otherwise.
pub(crate) fn park_reset(flag: &str) -> String {
    PARK_FIELDS
        .iter()
        .map(|(column, cleared)| {
            format!("{column} = CASE WHEN {flag} THEN {cleared} ELSE {column} END")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// The parked columns that take a value; the start day is its own CASE below. ?2..?5 are
/// the values, ?1 is in_week, ?6 the start day and ?7 the write stamp.
const WRITE_PARK_COLUMNS: &str = "parked = ?2, park_until = ?3, park_reason = ?4,
            parked_on_id = ?5";

fn write_park_sql(target: &str) -> String {
    format!(
        "UPDATE tasks SET in_week = ?1, {WRITE_PARK_COLUMNS},
            parked_at = CASE WHEN ?2 = 1 THEN COALESCE(parked_at, ?6) ELSE NULL END,
            updated_at = ?7
         WHERE {target}"
    )
}

/// Writes the parked columns for one task, or for every open child of it. The caller owns
/// the transaction. Re-parking keeps the day the park started.
pub(crate) fn write_park_in(
    conn: &Connection,
    task_id: &str,
    park: Park<'_>,
    now: &str,
    children: bool,
) -> rusqlite::Result<()> {
    let target = if children {
        "parent_id = ?8 AND deleted_at IS NULL AND status <> 'done'"
    } else {
        "id = ?8"
    };
    let (in_week, parked, until, reason, on, at) = match park {
        Park::InWeek => (1, 0, None, None, None, None),
        Park::Parked {
            until,
            reason,
            on,
            at,
        } => (0, 1, until, reason, on, at),
    };
    conn.execute(
        &write_park_sql(target),
        params![in_week, parked, until, reason, on, at, now, task_id],
    )?;
    Ok(())
}

/// Archive lists keep a task inside its archived project; restoring the project comes first.
pub(crate) const LIVE_PROJECT: &str = concat!(
    "(project_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects p ",
    "WHERE p.id = tasks.project_id AND p.archived_at IS NOT NULL))"
);

pub fn insert(
    conn: &Connection,
    id: &str,
    title: &str,
    fields: &CaptureFields,
    scope: &str,
    finish: &str,
    now: &str,
) -> rusqlite::Result<()> {
    // New tasks follow the saved default; switching one is still an explicit edit.
    let exclusive = crate::repo::settings::task_default_exclusive(conn) as i64;
    conn.execute(
        "INSERT INTO tasks (id, title, project_id, owner_id, priority, expected_start_date,
                            expected_finish_date, effort_minutes, status, in_week, carry_count,
                            sort_order, created_at, updated_at, time_exclusive, scope)
         VALUES (?1, ?2, ?3,
                 COALESCE(?4, (SELECT id FROM people WHERE is_me = 1 LIMIT 1)),
                 COALESCE(?5, 'normal'), ?11, ?6, COALESCE(?7, 480),
                 'todo', 1, 0,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks), ?8, ?8, ?10, ?9)",
        params![
            id,
            title,
            fields.project_id.as_deref(),
            fields.owner_id.as_deref(),
            fields.priority.as_deref(),
            finish,
            fields.effort_minutes,
            now,
            scope,
            exclusive,
            fields.expected_start_date.as_deref(),
        ],
    )?;
    Ok(())
}

/// A task lives in its project's world once it has one; the sheet and the AI fill can
/// both point a task at another project, so every such write ends with this.
pub fn sync_scope_from_project(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET scope = (SELECT scope FROM projects WHERE id = tasks.project_id)
         WHERE id = ?1 AND project_id IS NOT NULL",
        [id],
    )?;
    Ok(())
}

pub fn list_week(conn: &Connection) -> rusqlite::Result<Vec<TaskDto>> {
    let mode = crate::repo::settings::mode(conn)?;
    list_for(
        conn,
        &format!(
            "SELECT id FROM tasks
             WHERE in_week = 1 AND parked = 0 AND {} AND {}
             ORDER BY sort_order, id",
            visible_task_filter("tasks"),
            crate::repo::scope_eq("tasks", &mode)
        ),
        &[],
    )
}

pub fn list_all_active(conn: &Connection) -> rusqlite::Result<Vec<TaskDto>> {
    let mode = crate::repo::settings::mode(conn)?;
    list_for(
        conn,
        &format!(
            "SELECT id FROM tasks
             WHERE deleted_at IS NULL AND archived_at IS NULL AND canceled_at IS NULL
               AND status <> 'done' AND parent_id IS NULL AND {}
             ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
                      expected_finish_date IS NULL, expected_finish_date, created_at",
            crate::repo::scope_eq("tasks", &mode)
        ),
        &[],
    )
}

const TASK_COLUMNS: &str = "id, title, project_id, category_id, owner_id, expected_start_date,
            expected_finish_date, expected_finish_time, started_at, actual_finish_at,
            actual_effort_minutes, status,
            in_week, carry_count, park_until, parked, parked_at, park_reason,
            note, archived_at, canceled_at,
            created_at, updated_at, sort_order, effort_minutes, priority, time_exclusive,
            parent_id,
            (SELECT name FROM projects WHERE id = tasks.project_id AND deleted_at IS NULL),
            (SELECT title FROM tasks p WHERE p.id = tasks.parent_id),
            parked_on_id,
            requirement_id, issue_id";

fn read_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskDto> {
    Ok(TaskDto {
        id: row.get(0)?,
        title: row.get(1)?,
        project_id: row.get(2)?,
        category_id: row.get(3)?,
        owner_id: row.get(4)?,
        expected_start_date: row.get(5)?,
        expected_finish_date: row.get(6)?,
        expected_finish_time: row.get(7)?,
        actual_start_at: row.get(8)?,
        actual_finish_at: row.get(9)?,
        actual_effort_minutes: row.get(10)?,
        status: row.get(11)?,
        in_week: row.get::<_, i64>(12)? == 1,
        carry_count: row.get(13)?,
        park_until: row.get(14)?,
        parked: row.get::<_, i64>(15)? == 1,
        parked_at: row.get(16)?,
        park_reason: row.get(17)?,
        parked_on_id: row.get(30)?,
        note: row.get(18)?,
        archived_at: row.get(19)?,
        canceled_at: row.get(20)?,
        children: vec![],
        tags: vec![],
        delays: vec![],
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
        sort_order: row.get(23)?,
        effort_minutes: row.get(24)?,
        priority: row.get(25)?,
        exclusive: row.get::<_, i64>(26)? == 1,
        parent_id: row.get(27)?,
        parent_title: row.get(29)?,
        project_name: row.get(28)?,
        requirement_id: row.get(31)?,
        issue_id: row.get(32)?,
    })
}

/// Whether this id names a live (not deleted) task.
pub fn exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row("SELECT 1 FROM tasks WHERE id = ?1 AND deleted_at IS NULL", [id], |_| {
        Ok(true)
    })
    .optional()
    .map(|found| found.unwrap_or(false))
}

pub fn dto(conn: &Connection, id: &str) -> rusqlite::Result<TaskDto> {
    let ids = [id.to_owned()];
    let mut tasks = load_rows(conn, &ids)?;
    attach_tags_delays(conn, &mut tasks, &ids, true)?;
    attach_children(conn, &mut tasks, &ids)?;
    tasks.pop().ok_or(rusqlite::Error::QueryReturnedNoRows)
}

/// How many ids one statement may carry. SQLite's own ceiling is 999 on older builds and
/// 32766 since 3.32; staying well under both keeps a huge ledger from failing outright.
const LOAD_CHUNK: usize = 400;

/// The archive page shows the newest slice of each list. The lists only grow, and rendering
/// every task ever finished would eventually cost more than the page is worth; the search
/// still runs in SQL over the whole table before this cap.
const ARCHIVE_LIMIT: i64 = 1000;

/// The tasks an id query selects, in that order: the shared body of every list here.
pub fn list_for(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> rusqlite::Result<Vec<TaskDto>> {
    let mut stmt = conn.prepare(sql)?;
    let ids: Vec<String> = stmt
        .query_map(params, |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    dtos(conn, &ids)
}

/// Loads the full row and its children for each id, keeping the given order. The child
/// tables are read in one query each, so a long list costs a handful of statements
/// instead of four per task.
pub fn dtos(conn: &Connection, ids: &[String]) -> rusqlite::Result<Vec<TaskDto>> {
    let mut tasks = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(LOAD_CHUNK) {
        tasks.extend(load_chunk(conn, chunk)?);
    }
    Ok(tasks)
}

fn load_chunk(conn: &Connection, ids: &[String]) -> rusqlite::Result<Vec<TaskDto>> {
    let mut tasks = load_rows(conn, ids)?;
    if tasks.len() != ids.len() {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    attach_tags_delays(conn, &mut tasks, ids, false)?;
    attach_children(conn, &mut tasks, ids)?;
    Ok(tasks)
}

/// The plain rows for these ids, in the asked order, without their child tables.
fn load_rows(conn: &Connection, ids: &[String]) -> rusqlite::Result<Vec<TaskDto>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    // A known list of ids, so the rows are keyed by id and put back in the asked order.
    let sql = format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows: std::collections::HashMap<String, TaskDto> = std::collections::HashMap::new();
    let loaded = stmt.query_map(rusqlite::params_from_iter(ids), read_task)?;
    for task in loaded {
        let task = task?;
        rows.insert(task.id.clone(), task);
    }
    Ok(ids.iter().filter_map(|id| rows.remove(id)).collect())
}

/// Fills each task's children in one query, with their tags and delays.
fn attach_children(
    conn: &Connection,
    tasks: &mut [TaskDto],
    ids: &[String],
) -> rusqlite::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    // Keyed by owned id, so the map borrows nothing from the tasks it fills.
    let index: std::collections::HashMap<&str, usize> = ids
        .iter()
        .enumerate()
        .map(|(position, id)| (id.as_str(), position))
        .collect();

    // Children never carry children of their own: nesting stops at one level.
    let child_ids: Vec<String> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT id FROM tasks WHERE parent_id IN ({placeholders}) AND deleted_at IS NULL
               AND archived_at IS NULL AND canceled_at IS NULL
             ORDER BY sort_order, id"
        ))?;
        let rows = stmt.query_map(rusqlite::params_from_iter(ids), |row| row.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut children = load_rows(conn, &child_ids)?;
    attach_tags_delays(conn, &mut children, &child_ids, false)?;
    for child in children {
        if let Some(parent) = child.parent_id.as_deref() {
            if let Some(&position) = index.get(parent) {
                tasks[position].children.push(child);
            }
        }
    }
    Ok(())
}

/// Fills the tag list, and optionally the delay list, keyed back by task id. Lists skip
/// delays: only the single-task load the sheet uses renders them.
fn attach_tags_delays(
    conn: &Connection,
    tasks: &mut [TaskDto],
    ids: &[String],
    with_delays: bool,
) -> rusqlite::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    let index: std::collections::HashMap<&str, usize> = ids
        .iter()
        .enumerate()
        .map(|(position, id)| (id.as_str(), position))
        .collect();

    let mut tags = conn.prepare(&format!(
        "SELECT tt.task_id, t.id, t.name FROM tags t JOIN task_tags tt ON tt.tag_id = t.id
         WHERE tt.task_id IN ({placeholders}) AND t.deleted_at IS NULL ORDER BY tt.task_id, t.name"
    ))?;
    let rows = tags.query_map(rusqlite::params_from_iter(ids), |row| {
        Ok((
            row.get::<_, String>(0)?,
            TagDto {
                id: row.get(1)?,
                name: row.get(2)?,
            },
        ))
    })?;
    for row in rows {
        let (task_id, tag) = row?;
        if let Some(&position) = index.get(task_id.as_str()) {
            tasks[position].tags.push(tag);
        }
    }

    if !with_delays {
        return Ok(());
    }
    let mut delays = conn.prepare(&format!(
        "SELECT id, task_id, kind, old_due, new_due, reason, created_at FROM delays
         WHERE task_id IN ({placeholders}) ORDER BY task_id, created_at"
    ))?;
    let rows = delays.query_map(rusqlite::params_from_iter(ids), |row| {
        Ok(DelayDto {
            id: row.get(0)?,
            task_id: row.get(1)?,
            kind: row.get(2)?,
            old_due: row.get(3)?,
            new_due: row.get(4)?,
            reason: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    for row in rows {
        let delay = row?;
        if let Some(&position) = index.get(delay.task_id.as_str()) {
            tasks[position].delays.push(delay);
        }
    }
    Ok(())
}
pub fn stored_status(conn: &Connection, id: &str) -> rusqlite::Result<String> {
    conn.query_row("SELECT status FROM tasks WHERE id = ?1", [id], |r| r.get(0))
}

/// The status columns every completion and reopen shares. `?1` is the status and `?2`
/// is "left the week"; the parked half comes from the one column list in `park_reset`.
fn status_set() -> String {
    format!(
        "status = ?1,
            in_week = CASE WHEN ?2 THEN 0 WHEN parked THEN 0 ELSE 1 END,
            {}",
        park_reset("?2")
    )
}

pub fn set_status(
    conn: &Connection,
    id: &str,
    status: &str,
    leave_week: bool,
    now: &str,
) -> rusqlite::Result<()> {
    // Completing records the actual effort: the wall-clock time between start and finish
    // when the task was started, and the estimate when it never was. One minute is the
    // floor, so a quick tick still counts.
    let max_effort = crate::limits::LIMITS.effort_minutes;
    conn.execute(
        &format!(
            "UPDATE tasks SET {},
                started_at = CASE WHEN ?1 = 'doing' THEN COALESCE(started_at, ?3) ELSE started_at END,
                actual_finish_at = CASE WHEN ?2 THEN ?3 ELSE NULL END,
                actual_effort_minutes = CASE WHEN ?2 THEN
                    COALESCE(
                        MIN({max_effort}, MAX(1, CAST(ROUND((julianday(?3) - julianday(started_at)) * 1440.0)
                                                AS INTEGER))),
                        effort_minutes)
                    ELSE NULL END,
                updated_at = ?3
             WHERE id = ?4",
            status_set()
        ),
        params![status, leave_week as i64, now, id],
    )?;
    Ok(())
}

/// The status change alone, for `sync_actual`, which writes its own time stamps.
pub fn set_status_only(
    conn: &Connection,
    id: &str,
    status: &str,
    leave_week: bool,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        &format!("UPDATE tasks SET {}, updated_at = ?3 WHERE id = ?4", status_set()),
        params![status, leave_week as i64, now, id],
    )?;
    Ok(())
}

/// Writes only the fields the patch names, so untouched columns keep their value.
/// The caller owns the transaction, so a refused later step rolls these writes back too.
pub(crate) fn apply_patch_in(
    conn: &Connection,
    id: &str,
    patch: &crate::dto::TaskPatch,
    now: &str,
) -> rusqlite::Result<()> {
    fn push(
        cols: &mut Vec<&'static str>,
        vals: &mut Vec<Value>,
        col: &'static str,
        value: &Option<Option<String>>,
    ) {
        if let Some(value) = value {
            cols.push(col);
            vals.push(match value {
                Some(text) => Value::Text(text.clone()),
                None => Value::Null,
            });
        }
    }

    let mut cols: Vec<&'static str> = Vec::new();
    let mut vals: Vec<Value> = Vec::new();
    if let Some(title) = &patch.title {
        cols.push("title");
        vals.push(Value::Text(title.clone()));
    }
    push(&mut cols, &mut vals, "project_id", &patch.project_id);
    push(&mut cols, &mut vals, "category_id", &patch.category_id);
    push(&mut cols, &mut vals, "owner_id", &patch.owner_id);
    push(&mut cols, &mut vals, "expected_start_date", &patch.expected_start_date);
    push(&mut cols, &mut vals, "expected_finish_date", &patch.expected_finish_date);
    push(&mut cols, &mut vals, "note", &patch.note);
    if let Some(effort) = patch.effort_minutes {
        cols.push("effort_minutes");
        vals.push(Value::Integer(effort));
    }
    if let Some(priority) = &patch.priority {
        cols.push("priority");
        vals.push(Value::Text(priority.clone()));
    }
    if let Some(exclusive) = patch.exclusive {
        cols.push("time_exclusive");
        vals.push(Value::Integer(exclusive as i64));
    }
    push(&mut cols, &mut vals, "requirement_id", &patch.requirement_id);
    push(&mut cols, &mut vals, "issue_id", &patch.issue_id);

    if let Some(tags) = &patch.tags {
        conn.execute("DELETE FROM task_tags WHERE task_id = ?1", [id])?;
        for name in tags {
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            let tag = crate::repo::tags::find_or_create(
                conn,
                &uuid::Uuid::new_v4().to_string(),
                name,
                now,
            )?;
            conn.execute(
                "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                params![id, tag.id],
            )?;
        }
    }

    // A tags-only patch still counts as an edit, so archived lists re-sort on it.
    if cols.is_empty() && patch.tags.is_none() {
        return Ok(());
    }
    cols.push("updated_at");
    vals.push(Value::Text(now.to_owned()));
    let set = cols
        .iter()
        .enumerate()
        .map(|(i, col)| format!("{col} = ?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("UPDATE tasks SET {set} WHERE id = ?{}", cols.len() + 1);
    let mut args: Vec<&dyn rusqlite::ToSql> =
        vals.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let id_param: &str = id;
    args.push(&id_param);
    conn.prepare_cached(&sql)?.execute(args.as_slice())?;
    Ok(())
}

/// The two record links this task carries right now; used to log a link change.
pub fn links_of(
    conn: &Connection,
    id: &str,
) -> rusqlite::Result<(Option<String>, Option<String>)> {
    conn.query_row(
        "SELECT requirement_id, issue_id FROM tasks WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

/// Drops links a task (and its live children) can no longer keep after a project move:
/// a requirement or issue belongs to one project, and the task just left it.
pub fn clear_stale_links(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET
           requirement_id = CASE WHEN requirement_id IS NOT NULL
               AND (project_id IS NULL OR NOT EXISTS (
                   SELECT 1 FROM requirements r
                    WHERE r.id = tasks.requirement_id AND r.project_id = tasks.project_id))
             THEN NULL ELSE requirement_id END,
           issue_id = CASE WHEN issue_id IS NOT NULL
               AND (project_id IS NULL OR NOT EXISTS (
                   SELECT 1 FROM issues i
                    WHERE i.id = tasks.issue_id AND i.project_id = tasks.project_id))
             THEN NULL ELSE issue_id END
         WHERE id = ?1 OR parent_id = ?1",
        [id],
    )?;
    Ok(())
}

pub fn set_owner(conn: &Connection, id: &str, owner_id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET owner_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![owner_id, now, id],
    )?;
    Ok(())
}

pub fn list_project(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<TaskDto>> {
    let mode = crate::repo::settings::mode(conn)?;
    list_for(
        conn,
        &format!(
            "SELECT id FROM tasks
             WHERE project_id = ?1 AND deleted_at IS NULL AND canceled_at IS NULL
               AND archived_at IS NULL AND parent_id IS NULL AND {}
             ORDER BY expected_finish_date IS NULL, expected_finish_date, created_at",
            crate::repo::scope_eq("tasks", &mode)
        ),
        &[&project_id],
    )
}
pub fn archive(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET archived_at = ?1, in_week = 0, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn restore(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET archived_at = NULL, canceled_at = NULL,
              sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks),
              status = CASE WHEN status = 'done' THEN 'doing' ELSE status END,
              actual_finish_at = CASE WHEN status = 'done' THEN NULL ELSE actual_finish_at END,
              actual_effort_minutes = CASE WHEN status = 'done' THEN NULL
                                           ELSE actual_effort_minutes END,
              updated_at = ?1
         WHERE id = ?2",
        params![now, id],
    )?;
    write_park_in(conn, id, Park::InWeek, now, false)
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
    Ok(())
}

/// Ids with their current order value, so a move can write only what changed.
pub fn ordered_rows(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut stmt =
        conn.prepare("SELECT id, sort_order FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order, id")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// Writes only the given order values, in one transaction, so the order stays dense.
pub fn write_orders(conn: &Connection, orders: &[(String, i64)]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    write_orders_in(&tx, orders)?;
    tx.commit()
}

/// The same write without opening a transaction, for a caller that already holds one.
pub fn write_orders_in(conn: &Connection, orders: &[(String, i64)]) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare_cached("UPDATE tasks SET sort_order = ?1 WHERE id = ?2")?;
    for (id, order) in orders {
        stmt.execute(params![order, id])?;
    }
    Ok(())
}

fn list_where(
    conn: &Connection,
    condition: &str,
    query: Option<&str>,
    include_children: bool,
    live_project: bool,
) -> rusqlite::Result<Vec<ArchiveTaskDto>> {
    let top_level = if include_children { "" } else { "parent_id IS NULL AND " };
    let project_filter = if live_project {
        format!(" AND {LIVE_PROJECT}")
    } else {
        String::new()
    };
    let pattern = query.map(crate::repo::like_pattern);
    let mode = crate::repo::settings::mode(conn)?;
    let sql = format!(
        "SELECT id, title, archived_at, canceled_at, actual_finish_at FROM tasks
         WHERE deleted_at IS NULL AND {top_level}{}{project_filter} AND {}
           AND (?1 IS NULL OR title LIKE ?1 ESCAPE '!')
         ORDER BY updated_at DESC
         LIMIT {ARCHIVE_LIMIT}",
        condition,
        crate::repo::scope_eq("tasks", &mode)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([pattern], |r| {
        Ok(ArchiveTaskDto {
            id: r.get(0)?,
            title: r.get(1)?,
            archived_at: r.get(2)?,
            canceled_at: r.get(3)?,
            actual_finish_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn list_archived(conn: &Connection, query: Option<&str>) -> rusqlite::Result<Vec<ArchiveTaskDto>> {
    list_where(
        conn,
        "archived_at IS NOT NULL AND canceled_at IS NULL",
        query,
        false,
        true,
    )
}

/// Canceled work keeps its subtasks: a subtask canceled in the weekly pass is restored from
/// here, and the umbrella it belongs to is not listed beside it (only leaves are canceled).
/// While the umbrella itself is archived the subtask waits with it; restoring the child
/// alone would leave live work under a filed parent.
pub fn list_canceled(conn: &Connection, query: Option<&str>) -> rusqlite::Result<Vec<ArchiveTaskDto>> {
    list_where(
        conn,
        "canceled_at IS NOT NULL AND (parent_id IS NULL OR NOT EXISTS
           (SELECT 1 FROM tasks p WHERE p.id = tasks.parent_id AND p.archived_at IS NOT NULL))",
        query,
        true,
        true,
    )
}

/// Finished work stays findable even when its project was filed: the task page can
/// complete a task inside an archived project, so its done half must show it.
pub fn list_done(conn: &Connection, query: Option<&str>) -> rusqlite::Result<Vec<ArchiveTaskDto>> {
    list_where(
        conn,
        "status = 'done' AND canceled_at IS NULL AND archived_at IS NULL",
        query,
        false,
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: &str = "2026-10-20T08:00:00Z";

    #[test]
    fn every_parked_column_is_written_by_both_paths() {
        let reset = park_reset("?1");
        let write = write_park_sql("id = ?8");
        for (column, cleared) in PARK_FIELDS {
            assert!(
                reset.contains(&format!(
                    "{column} = CASE WHEN ?1 THEN {cleared} ELSE {column} END"
                )),
                "{column} is missing from the park reset"
            );
            let written = if column == "parked_at" {
                write.contains("COALESCE(parked_at, ?6)")
            } else {
                write.contains(&format!("{column} = ?"))
            };
            assert!(written, "{column} is missing from the park writer");
        }
    }

    #[test]
    fn a_batch_load_keeps_the_asked_order_and_its_children() {
        let c = db::open_in_memory().unwrap();
        for id in ["t1", "t2", "t3"] {
            crate::services::week::capture(&c, id, NOW, id).unwrap();
        }
        crate::services::subtasks::add(&c, "t2", "收集", NOW).unwrap();
        crate::services::deliverables::add_note(&c, "t3", "等回复", NOW).unwrap();
        c.execute(
            "INSERT INTO tags (id, name, created_at) VALUES ('g1', 'fix', ?1)",
            [NOW],
        )
        .unwrap();
        c.execute(
            "INSERT INTO task_tags (task_id, tag_id) VALUES ('t1', 'g1')",
            [],
        )
        .unwrap();

        let ids = vec!["t3".to_string(), "t1".to_string(), "t2".to_string()];
        let tasks = dtos(&c, &ids).unwrap();

        let loaded: Vec<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(loaded, vec!["t3", "t1", "t2"]);
        // The list path no longer carries delay history; the sheet asks for it separately.
        assert!(tasks[0].delays.is_empty());
        assert_eq!(tasks[1].tags[0].name, "fix");
        assert_eq!(tasks[2].children[0].title, "收集");
        // Each task must get only its own children, not the neighbouring ones.
        assert!(tasks[0].children.is_empty() && tasks[0].tags.is_empty());
        assert!(tasks[1].children.is_empty() && tasks[1].delays.is_empty());
        assert!(tasks[2].tags.is_empty() && tasks[2].delays.is_empty());
    }

    #[test]
    fn an_archived_child_leaves_the_children_list() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        let parent = crate::services::subtasks::add(&c, "t1", "收集", NOW).unwrap();
        let child = parent.children[0].id.clone();
        archive(&c, &child, NOW).unwrap();

        let parent = dto(&c, "t1").unwrap();

        assert!(parent.children.is_empty(), "only live children belong to a task");
    }

    #[test]
    fn a_batch_load_of_nothing_is_empty() {
        let c = db::open_in_memory().unwrap();
        assert!(dtos(&c, &[]).unwrap().is_empty());
    }

    #[test]
    fn a_batch_larger_than_one_statement_still_loads_in_order() {
        let c = db::open_in_memory().unwrap();
        let ids: Vec<String> = (0..LOAD_CHUNK + 5).map(|n| format!("t{n:04}")).collect();
        for id in &ids {
            crate::services::week::capture(&c, id, NOW, id).unwrap();
        }
        let parent =
            crate::services::subtasks::add(&c, &ids[LOAD_CHUNK + 4], "最后一步", NOW).unwrap();
        assert_eq!(parent.children.len(), 1);

        let tasks = dtos(&c, &ids).unwrap();

        let loaded: Vec<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(loaded, ids.iter().map(String::as_str).collect::<Vec<_>>());
        // The children of a task in the second chunk must come back too.
        assert_eq!(tasks[LOAD_CHUNK + 4].children.len(), 1);
    }

    #[test]
    fn a_batch_load_reports_a_missing_id() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "一", NOW, "t1").unwrap();
        let ids = vec!["t1".to_string(), "gone".to_string()];

        // A caller asking for a row that vanished must see an error, not a short list.
        assert!(dtos(&c, &ids).is_err());
    }

    #[test]
    fn week_lists_leave_delay_history_to_the_single_task_load() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        crate::services::deliverables::add_note(&c, "t1", "等甲方", NOW).unwrap();

        assert!(list_week(&c).unwrap()[0].delays.is_empty());
        assert_eq!(dto(&c, "t1").unwrap().delays.len(), 1);
    }

    #[test]
    fn the_archive_lists_stop_at_the_newest_thousand() {
        let c = db::open_in_memory().unwrap();
        {
            let mut stmt = c
                .prepare(
                    "INSERT INTO tasks (id, title, created_at, updated_at, archived_at)
                     VALUES (?1, ?2, ?3, ?3, ?3)",
                )
                .unwrap();
            for index in 0..1001 {
                stmt.execute(rusqlite::params![
                    format!("t{index}"),
                    format!("任务 {index}"),
                    NOW
                ])
                .unwrap();
            }
        }

        assert_eq!(list_archived(&c, None).unwrap().len(), 1000);
    }

    #[test]
    fn finished_work_in_an_archived_project_stays_in_the_done_list() {
        let c = db::open_in_memory().unwrap();
        let project = crate::services::projects::create(&c, "项目", NOW).unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET project_id = ?1, status = 'done', in_week = 0,
                    actual_finish_at = ?2 WHERE id = 't1'",
            rusqlite::params![&project.id, NOW],
        )
        .unwrap();
        crate::repo::projects::set_archived(&c, &project.id, true, NOW).unwrap();

        assert_eq!(
            list_done(&c, None).unwrap().len(),
            1,
            "the task page can finish it, so the done list must still find it"
        );
        assert!(list_archived(&c, None).unwrap().is_empty());
    }

    #[test]
    fn task_lists_only_show_the_active_mode() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "公司任务", NOW, "t-work").unwrap();
        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_PERSONAL,
        )
        .unwrap();
        crate::services::week::capture(&c, "个人任务", NOW, "t-personal").unwrap();

        let ids = |rows: Vec<TaskDto>| -> Vec<String> { rows.into_iter().map(|t| t.id).collect() };
        assert_eq!(ids(list_week(&c).unwrap()), vec!["t-personal"]);
        assert_eq!(ids(list_all_active(&c).unwrap()), vec!["t-personal"]);

        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_WORK,
        )
        .unwrap();
        assert_eq!(ids(list_week(&c).unwrap()), vec!["t-work"]);
        assert_eq!(ids(list_all_active(&c).unwrap()), vec!["t-work"]);
    }

    #[test]
    fn archive_lists_follow_the_mode() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "归档的公司任务", NOW, "t-archived").unwrap();
        crate::services::week::capture(&c, "完成的公司任务", NOW, "t-done").unwrap();
        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_PERSONAL,
        )
        .unwrap();
        crate::services::week::capture(&c, "取消的个人任务", NOW, "t-canceled").unwrap();

        c.execute(
            "UPDATE tasks SET archived_at = ?1 WHERE id = 't-archived'",
            [NOW],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET status = 'done', actual_finish_at = ?1, in_week = 0
             WHERE id = 't-done'",
            [NOW],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET canceled_at = ?1, in_week = 0 WHERE id = 't-canceled'",
            [NOW],
        )
        .unwrap();

        // Company mode sees its own filed and finished rows, not the personal cancellation.
        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_WORK,
        )
        .unwrap();
        assert_eq!(list_archived(&c, None).unwrap()[0].id, "t-archived");
        assert_eq!(list_done(&c, None).unwrap()[0].id, "t-done");
        assert!(list_canceled(&c, None).unwrap().is_empty());

        crate::repo::settings::set(
            &c,
            crate::repo::settings::keys::MODE,
            crate::repo::settings::MODE_PERSONAL,
        )
        .unwrap();
        assert!(list_archived(&c, None).unwrap().is_empty());
        assert!(list_done(&c, None).unwrap().is_empty());
        assert_eq!(list_canceled(&c, None).unwrap()[0].id, "t-canceled");
    }
}

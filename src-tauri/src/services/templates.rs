use crate::dto::{CaptureFields, TaskDto, TemplateDto, TemplateInput};
use crate::repo::{tasks, templates};
use crate::services::{subtasks, week};
use rusqlite::{params, Connection};
use uuid::Uuid;

pub fn save(conn: &Connection, input: &TemplateInput, now: &str) -> Result<TemplateDto, String> {
    let template = normalize(input)?;
    crate::services::validate_links(
        conn,
        template.project_id.as_deref(),
        template.category_id.as_deref(),
        template.owner_id.as_deref(),
    )?;
    match template.id.clone() {
        Some(id) => {
            if templates::update(conn, &id, &template, now).map_err(|e| e.to_string())? == 0 {
                return Err("template_not_found".into());
            }
            load(conn, &id)
        }
        None => {
            let id = Uuid::new_v4().to_string();
            templates::insert(conn, &id, &template, now).map_err(|e| e.to_string())?;
            load(conn, &id)
        }
    }
}

pub fn remove(conn: &Connection, id: &str, now: &str) -> Result<(), String> {
    if templates::soft_delete(conn, id, now).map_err(|e| e.to_string())? == 0 {
        return Err("template_not_found".into());
    }
    Ok(())
}

/// One capture plus the template's subtasks, so owner routing and the week rules stay shared.
pub fn create_task(
    conn: &Connection,
    template_id: &str,
    now: &str,
    task_id: &str,
) -> Result<TaskDto, String> {
    let template = load(conn, template_id)?;
    let fields = CaptureFields {
        project_id: template.project_id.clone(),
        owner_id: template.owner_id.clone(),
        priority: Some(template.priority.clone()),
        effort_minutes: Some(template.effort_minutes),
    };
    // One transaction: a failed subtask insert must not leave a task with half its flow.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    week::capture_rows(&tx, &template.name, &fields, now, task_id)?;
    // CaptureFields carries nothing for these three, so they land after the row exists.
    tx.execute(
        "UPDATE tasks SET category_id = ?1, time_exclusive = ?2, note = ?3, updated_at = ?4
         WHERE id = ?5",
        params![
            template.category_id,
            template.exclusive as i64,
            template.note,
            now,
            task_id
        ],
    )
    .map_err(|e| e.to_string())?;
    // The template's effort is the whole flow, so its subtasks split it.
    let shares = subtasks::split_shares(
        template.effort_minutes,
        &vec![None; template.steps.len()],
    );
    for (title, minutes) in template.steps.iter().zip(shares) {
        subtasks::insert_child(&tx, task_id, title, minutes, now)?;
    }
    if !template.steps.is_empty() {
        subtasks::refresh(&tx, task_id, now)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

fn load(conn: &Connection, id: &str) -> Result<TemplateDto, String> {
    templates::get(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "template_not_found".to_string())
}

fn normalize(input: &TemplateInput) -> Result<TemplateInput, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("empty_template_name".into());
    }
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
    Ok(TemplateInput {
        id: input.id.clone(),
        name: name.to_string(),
        project_id: input.project_id.clone(),
        category_id: input.category_id.clone(),
        owner_id: input.owner_id.clone(),
        priority: Some(priority),
        effort_minutes: Some(effort_minutes),
        exclusive: Some(input.exclusive.unwrap_or(true)),
        note: input
            .note
            .as_deref()
            .map(str::trim)
            .filter(|note| !note.is_empty())
            .map(str::to_string),
        steps: input
            .steps
            .iter()
            .map(|step| step.trim().to_string())
            .filter(|step| !step.is_empty())
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: &str = "2026-10-20T08:00:00Z";

    fn input(name: &str, steps: Vec<&str>) -> TemplateInput {
        TemplateInput {
            name: name.into(),
            steps: steps.into_iter().map(str::to_string).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn a_template_needs_a_name() {
        let c = db::open_in_memory().unwrap();
        assert_eq!(save(&c, &input("   ", vec![]), NOW).unwrap_err(), "empty_template_name");
    }

    #[test]
    fn blank_steps_are_dropped() {
        let c = db::open_in_memory().unwrap();
        let template = save(&c, &input("发布", vec![" ", " 写说明 ", ""]), NOW).unwrap();
        assert_eq!(template.steps, vec!["写说明".to_string()]);
    }

    #[test]
    fn creating_from_a_template_adds_every_subtask_in_order() {
        let c = db::open_in_memory().unwrap();
        let category = crate::repo::categories::list(&c).unwrap()[0].id.clone();
        let mut draft = input("发布流程", vec!["打标签", "发版"]);
        draft.effort_minutes = Some(960);
        draft.category_id = Some(category.clone());
        draft.note = Some("周五发".into());
        let template = save(&c, &draft, NOW).unwrap();

        let task = create_task(&c, &template.id, NOW, "t1").unwrap();

        assert_eq!(task.title, "发布流程");
        let titles: Vec<&str> = task.children.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["打标签", "发版"]);
        // The template's effort is the whole flow, split across its subtasks.
        let efforts: Vec<i64> = task.children.iter().map(|s| s.effort_minutes).collect();
        assert_eq!(efforts, vec![480, 480]);
        assert_eq!(task.effort_minutes, 960);
        assert_eq!(task.category_id.as_deref(), Some(category.as_str()));
        assert_eq!(task.note.as_deref(), Some("周五发"));
        assert_eq!(task.status, "todo");
        assert!(task.in_week);
    }

    #[test]
    fn a_template_without_steps_still_creates_a_task() {
        let c = db::open_in_memory().unwrap();
        let template = save(&c, &input("打电话", vec![]), NOW).unwrap();
        let task = create_task(&c, &template.id, NOW, "t1").unwrap();
        assert!(task.children.is_empty());
    }

    #[test]
    fn a_new_template_and_its_task_are_exclusive_by_default() {
        let c = db::open_in_memory().unwrap();
        let template = save(&c, &input("发布", vec![]), NOW).unwrap();
        assert!(template.exclusive);

        let task = create_task(&c, &template.id, NOW, "t1").unwrap();
        assert!(task.exclusive);
    }

    #[test]
    fn a_deleted_template_cannot_create() {
        let c = db::open_in_memory().unwrap();
        let template = save(&c, &input("发布", vec![]), NOW).unwrap();
        remove(&c, &template.id, NOW).unwrap();
        assert_eq!(
            create_task(&c, &template.id, NOW, "t1").unwrap_err(),
            "template_not_found"
        );
        assert_eq!(remove(&c, &template.id, NOW).unwrap_err(), "template_not_found");
    }

    #[test]
    fn saving_replaces_the_step_list() {
        let c = db::open_in_memory().unwrap();
        let template = save(&c, &input("发布", vec!["一", "二"]), NOW).unwrap();
        let mut draft = input("发布", vec!["只剩一步"]);
        draft.id = Some(template.id.clone());
        let saved = save(&c, &draft, NOW).unwrap();
        assert_eq!(saved.steps, vec!["只剩一步".to_string()]);
    }

    fn step_count(c: &rusqlite::Connection, template_id: &str) -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM template_steps WHERE template_id = ?1",
            [template_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_failed_step_write_keeps_the_old_step_list() {
        let c = db::open_in_memory().unwrap();
        let template = save(&c, &input("发布", vec!["一", "二"]), NOW).unwrap();
        // Steps are replaced by delete-then-insert; a failure mid-way must not leave a gap.
        c.execute_batch(
            "CREATE TRIGGER fail_step BEFORE INSERT ON template_steps
             BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .unwrap();

        let mut draft = input("发布", vec!["新的一步"]);
        draft.id = Some(template.id.clone());
        assert!(save(&c, &draft, NOW).is_err());

        let steps = crate::repo::templates::get(&c, &template.id)
            .unwrap()
            .unwrap()
            .steps;
        assert_eq!(steps, vec!["一".to_string(), "二".to_string()]);
        assert_eq!(step_count(&c, &template.id), 2);
    }

    #[test]
    fn a_failed_subtask_write_creates_no_task() {
        let c = db::open_in_memory().unwrap();
        let template = save(&c, &input("发布", vec!["打标签", "发版"]), NOW).unwrap();
        c.execute_batch(
            "CREATE TRIGGER fail_task_child BEFORE INSERT ON tasks
             WHEN NEW.parent_id IS NOT NULL
             BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .unwrap();

        assert!(create_task(&c, &template.id, NOW, "t1").is_err());

        // The task row must go with the subtasks it could not get.
        let tasks: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tasks, 0);
    }
}

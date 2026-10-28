use crate::ai::{client, AiContext, Enrichment};
use crate::dto::TaskDto;
use crate::now_iso;
use crate::state::{with_db, AppState};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub sample: Option<String>,
    pub error: Option<String>,
}

fn ai_settings(conn: &Connection) -> (bool, String, String) {
    let enabled = crate::repo::settings::get(conn, "ai.enabled")
        .ok()
        .flatten()
        .map(|v| v == "true")
        .unwrap_or(false);
    let base_url = crate::repo::settings::get(conn, "ai.base_url")
        .ok()
        .flatten()
        .unwrap_or_else(|| "https://api.deepseek.com".into());
    let model = crate::repo::settings::get(conn, "ai.model")
        .ok()
        .flatten()
        .unwrap_or_else(|| "deepseek-flash".into());
    (enabled, base_url, model)
}

fn context(conn: &Connection, today: &str) -> Result<AiContext, String> {
    let projects = crate::repo::projects::list(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|p| (p.id, p.name))
        .collect();
    let categories = crate::repo::categories::list(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c| (c.id, c.name))
        .collect();
    let people = crate::repo::people::list(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|p| (p.id, p.name))
        .collect();
    Ok(AiContext {
        today: today.to_string(),
        projects,
        categories,
        people,
    })
}

fn apply(conn: &Connection, task_id: &str, enrichment: &Enrichment, now: &str) -> Result<TaskDto, String> {
    let (before_category, current_project, current_owner): (
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT category_id, project_id, owner_id FROM tasks WHERE id = ?1",
            [task_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    // The UPDATE only fills empty columns, so these are the values it will actually
    // store; the enrichment must not add a member for a value it is not using.
    let effective_project = current_project.as_deref().or(enrichment.project_id.as_deref());
    let effective_owner = current_owner.as_deref().or(enrichment.owner_id.as_deref());
    crate::services::projects::ensure_member(conn, effective_project, effective_owner, now)?;
    conn.execute(
        "UPDATE tasks SET
            project_id = COALESCE(project_id, ?1),
            category_id = COALESCE(category_id, ?2),
            owner_id = COALESCE(owner_id, ?3),
            start_date = COALESCE(start_date, ?4),
            due_date = COALESCE(due_date, ?5),
            updated_at = ?6
         WHERE id = ?7",
        params![
            enrichment.project_id,
            enrichment.category_id,
            enrichment.owner_id,
            enrichment.start_date,
            enrichment.due_date,
            now,
            task_id
        ],
    )
    .map_err(|e| e.to_string())?;

    // A background fill hands a default-owned task to its specialty owner, but never
    // steals one the user already assigned.
    if enrichment.category_id.is_some() && before_category.is_none() {
        let task = crate::repo::tasks::dto(conn, task_id).map_err(|e| e.to_string())?;
        let me = crate::repo::people::me_id(conn).map_err(|e| e.to_string())?;
        let default_owned = match me {
            Some(me) => task.owner_id.as_deref() == Some(me.as_str()),
            None => task.owner_id.is_none(),
        };
        if default_owned {
            if let Some(owner) = crate::services::projects::assigned_owner(
                conn,
                task.project_id.as_deref(),
                task.category_id.as_deref(),
            )? {
                crate::repo::tasks::set_owner(conn, task_id, &owner, now)
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    for tag in &enrichment.tags {
        let created = crate::repo::tags::find_or_create(
            conn,
            &uuid::Uuid::new_v4().to_string(),
            tag,
            now,
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
            params![task_id, created.id],
        )
        .map_err(|e| e.to_string())?;
    }

    crate::repo::tasks::dto(conn, task_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_ai_key(key: String) -> Result<(), String> {
    client::set_key(key.trim())
}

#[tauri::command]
pub async fn clear_ai_key() -> Result<(), String> {
    client::clear_key()
}

/// Asked when the settings dialog opens; startup never touches the credential store.
#[tauri::command]
pub async fn ai_key_status() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| client::get_key().is_some())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_test(state: State<'_, AppState>) -> Result<AiTestResult, String> {
    let (_, base_url, model) = with_db(&state, |conn| Ok(ai_settings(conn))).await?;
    let Some(key) = client::get_key() else {
        return Ok(AiTestResult {
            ok: false,
            latency_ms: 0,
            sample: None,
            error: Some("no_key".into()),
        });
    };
    let started = std::time::Instant::now();
    let client = client::DeepSeekClient {
        base_url,
        model,
        key,
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        use crate::ai::Completions;
        client.complete(
            r#"只输出 json：{"ok":true}"#,
            "回复一个 json",
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    let latency_ms = started.elapsed().as_millis() as u64;
    Ok(match result {
        Ok(sample) if !sample.trim().is_empty() => AiTestResult {
            ok: true,
            latency_ms,
            sample: Some(sample),
            error: None,
        },
        Ok(_) => AiTestResult {
            ok: false,
            latency_ms,
            sample: None,
            error: Some("empty_response".into()),
        },
        Err(e) => AiTestResult {
            ok: false,
            latency_ms,
            sample: None,
            error: Some(e),
        },
    })
}

#[tauri::command]
pub async fn ai_enrich(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let (enabled, base_url, model) = with_db(&state, |conn| Ok(ai_settings(conn))).await?;
    let Some(key) = client::get_key() else {
        return Ok(());
    };
    if !enabled {
        return Ok(());
    }

    let today = crate::services::local_today(&now_iso())?
        .format("%Y-%m-%d")
        .to_string();
    let id = task_id.clone();
    let (title, ctx) = with_db(&state, move |conn| {
        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id = ?1", [&id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok((title, context(conn, &today)?))
    })
    .await?;

    let client = client::DeepSeekClient {
        base_url,
        model,
        key,
    };
    let enrichment = tauri::async_runtime::spawn_blocking(move || {
        crate::ai::enrich(&client, &ctx, &title)
    })
    .await
    .map_err(|e| e.to_string())?;

    let Ok(enrichment) = enrichment else {
        return Ok(());
    };

    let now = now_iso();
    let task = with_db(&state, move |conn| {
        apply(conn, &task_id, &enrichment, &now)
    })
    .await?;

    let _ = app.emit("ai:enriched", &task);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-10-20T08:00:00Z";
    const LATER: &str = "2026-10-21T00:00:00Z";

    fn category(c: &Connection, name: &str) -> String {
        crate::repo::categories::list(c)
            .unwrap()
            .into_iter()
            .find(|x| x.name == name)
            .unwrap()
            .id
    }

    #[test]
    fn a_filled_category_routes_the_task_to_the_specialty_owner() {
        let c = crate::db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
        let li = crate::services::projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        let hardware = category(&c, "硬件");
        crate::services::projects::set_member_category(&c, &p.id, &li.id, Some(&hardware), NOW)
            .unwrap();
        let fields = crate::dto::CaptureFields {
            project_id: Some(p.id.clone()),
            ..Default::default()
        };
        crate::services::week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();
        let enrichment = Enrichment {
            category_id: Some(hardware),
            ..Default::default()
        };

        let task = apply(&c, "t1", &enrichment, LATER).unwrap();

        assert_eq!(task.owner_id.as_deref(), Some(li.id.as_str()));
    }

    #[test]
    fn an_ai_owner_outside_the_project_joins_it() {
        let c = crate::db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
        let outsider = crate::repo::people::create(&c, "u-outsider", "外人", NOW).unwrap();
        let fields = crate::dto::CaptureFields {
            project_id: Some(p.id.clone()),
            ..Default::default()
        };
        crate::services::week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();
        // Capture normally defaults the owner to "me"; an ownerless task is the
        // case where the AI can fill a person.
        c.execute("UPDATE tasks SET owner_id = NULL WHERE id = 't1'", [])
            .unwrap();
        let enrichment = Enrichment {
            owner_id: Some(outsider.id.clone()),
            ..Default::default()
        };

        let task = apply(&c, "t1", &enrichment, LATER).unwrap();

        assert_eq!(task.owner_id.as_deref(), Some(outsider.id.as_str()));
        assert!(
            crate::repo::projects::is_member(&c, &p.id, &outsider.id).unwrap(),
            "an AI-filled owner should be a project member"
        );
    }

    #[test]
    fn a_filled_category_keeps_a_person_the_user_picked() {
        let c = crate::db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
        let li = crate::services::projects::add_member(&c, &p.id, None, Some("老李"), NOW).unwrap();
        let wang = crate::services::projects::add_member(&c, &p.id, None, Some("小王"), NOW).unwrap();
        let hardware = category(&c, "硬件");
        crate::services::projects::set_member_category(&c, &p.id, &wang.id, Some(&hardware), NOW)
            .unwrap();
        let fields = crate::dto::CaptureFields {
            project_id: Some(p.id.clone()),
            owner_id: Some(li.id.clone()),
            ..Default::default()
        };
        crate::services::week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();
        let enrichment = Enrichment {
            category_id: Some(hardware),
            ..Default::default()
        };

        let task = apply(&c, "t1", &enrichment, LATER).unwrap();

        assert_eq!(task.owner_id.as_deref(), Some(li.id.as_str()));
    }

    #[test]
    fn ai_does_not_add_an_owner_it_will_not_use() {
        let c = crate::db::open_in_memory().unwrap();
        let p = crate::services::projects::create(&c, "项目", NOW).unwrap();
        let other = crate::services::projects::create(&c, "另一个项目", NOW).unwrap();
        let outsider = crate::repo::people::create(&c, "u-outsider", "外人", NOW).unwrap();
        let fields = crate::dto::CaptureFields {
            project_id: Some(p.id.clone()),
            ..Default::default()
        };
        crate::services::week::capture_with_fields(&c, "交底", &fields, NOW, "t1").unwrap();
        let enrichment = Enrichment {
            project_id: Some(other.id.clone()),
            owner_id: Some(outsider.id.clone()),
            ..Default::default()
        };

        let task = apply(&c, "t1", &enrichment, LATER).unwrap();

        assert_eq!(task.project_id.as_deref(), Some(p.id.as_str()));
        assert_ne!(task.owner_id.as_deref(), Some(outsider.id.as_str()));
        assert!(
            !crate::repo::projects::is_member(&c, &other.id, &outsider.id).unwrap(),
            "the AI owner is ignored because the task already has one"
        );
    }

    #[test]
    fn enrichment_fills_empty_fields_and_keeps_the_users() {
        let c = crate::db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", NOW, "t1").unwrap();
        c.execute(
            "UPDATE tasks SET note = '用户写的', due_date = '2026-11-01' WHERE id = 't1'",
            [],
        )
        .unwrap();
        let enrichment = Enrichment {
            due_date: Some("2026-12-01".into()),
            start_date: Some("2026-10-22".into()),
            tags: vec!["fix".into()],
            ..Default::default()
        };

        let t = apply(&c, "t1", &enrichment, LATER).unwrap();

        assert_eq!(t.due_date.as_deref(), Some("2026-11-01"));
        assert_eq!(t.start_date.as_deref(), Some("2026-10-22"));
        assert_eq!(t.note.as_deref(), Some("用户写的"));
        assert_eq!(t.updated_at, LATER);
        let tags: Vec<String> = t.tags.into_iter().map(|tag| tag.name).collect();
        assert_eq!(tags, vec!["fix".to_string()]);

        // Running the same enrichment twice must not duplicate the tag.
        apply(&c, "t1", &enrichment, "2026-10-21T00:00:01Z").unwrap();
        assert_eq!(crate::repo::tasks::dto(&c, "t1").unwrap().tags.len(), 1);
    }
}

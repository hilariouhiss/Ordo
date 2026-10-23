pub mod client;
pub mod prompt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Enrichment {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AiContext {
    pub today: String,
    pub projects: Vec<(String, String)>,
    pub categories: Vec<(String, String)>,
    pub people: Vec<(String, String)>,
}

pub trait Completions {
    fn complete(&self, system: &str, user: &str) -> Result<String, String>;
}

pub fn enrich(
    client: &dyn Completions,
    ctx: &AiContext,
    text: &str,
) -> Result<Enrichment, String> {
    let system = prompt::system(ctx);
    let mut last = "ai_empty_or_invalid".to_string();
    for _ in 0..2 {
        let content = client.complete(&system, text)?;
        let trimmed = content.trim();
        if trimmed.is_empty() {
            last = "ai_empty".into();
            continue;
        }
        match serde_json::from_str::<Enrichment>(trimmed) {
            Ok(raw) => return Ok(validate(raw, ctx)),
            Err(e) => last = format!("ai_invalid_json: {e}"),
        }
    }
    Err(last)
}

pub fn validate(raw: Enrichment, ctx: &AiContext) -> Enrichment {
    let known = |list: &[(String, String)], id: &Option<String>| -> Option<String> {
        id.as_ref()
            .filter(|candidate| list.iter().any(|(id, _)| id == *candidate))
            .cloned()
    };
    let date = |value: &Option<String>| -> Option<String> {
        value
            .as_ref()
            .filter(|v| chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d").is_ok())
            .cloned()
    };
    Enrichment {
        project_id: known(&ctx.projects, &raw.project_id),
        category_id: known(&ctx.categories, &raw.category_id),
        owner_id: known(&ctx.people, &raw.owner_id),
        start_date: date(&raw.start_date),
        due_date: date(&raw.due_date),
        tags: raw
            .tags
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .take(3)
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use crate::ai::{enrich, validate, AiContext, Completions, Enrichment};
    use std::cell::{Cell, RefCell};

    struct Fake {
        replies: RefCell<Vec<String>>,
        calls: Cell<usize>,
    }

    impl Completions for Fake {
        fn complete(&self, _system: &str, _user: &str) -> Result<String, String> {
            self.calls.set(self.calls.get() + 1);
            Ok(self.replies.borrow_mut().remove(0))
        }
    }

    fn ctx() -> AiContext {
        AiContext {
            today: "2026-10-20".into(),
            projects: vec![("p1".into(), "华东客户交付".into())],
            categories: vec![("c1".into(), "软件".into())],
            people: vec![("u1".into(), "老李".into())],
        }
    }

    #[test]
    fn validation_drops_unknown_ids_and_bad_dates() {
        let raw = Enrichment {
            project_id: Some("nope".into()),
            category_id: Some("c1".into()),
            owner_id: Some("u1".into()),
            due_date: Some("周五".into()),
            tags: vec![" fix ".into(), "".into()],
            ..Default::default()
        };
        let out = validate(raw, &ctx());
        assert!(out.project_id.is_none());
        assert_eq!(out.category_id.as_deref(), Some("c1"));
        assert_eq!(out.owner_id.as_deref(), Some("u1"));
        assert!(out.due_date.is_none());
        assert_eq!(out.tags, vec!["fix".to_string()]);
    }

    #[test]
    fn empty_response_retries_once_then_fails() {
        let fake = Fake {
            replies: RefCell::new(vec!["".into(), "  ".into()]),
            calls: Cell::new(0),
        };
        assert!(enrich(&fake, &ctx(), "交底").is_err());
        assert_eq!(fake.calls.get(), 2);
    }

    #[test]
    fn valid_response_is_validated() {
        let fake = Fake {
            replies: RefCell::new(vec![
                r#"{"projectId":"p1","categoryId":"c1","ownerId":"nope","dueDate":"2026-11-20","tags":["交付"]}"#.into(),
            ]),
            calls: Cell::new(0),
        };
        let out = enrich(&fake, &ctx(), "周五前把软件方案评审发老李").unwrap();
        assert_eq!(out.project_id.as_deref(), Some("p1"));
        assert!(out.owner_id.is_none());
        assert_eq!(out.due_date.as_deref(), Some("2026-11-20"));
    }
}

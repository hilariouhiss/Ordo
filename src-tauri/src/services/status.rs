pub fn derive(stored: &str, steps: &[bool]) -> &'static str {
    if steps.is_empty() {
        return match stored {
            "doing" => "doing",
            "done" => "done",
            _ => "todo",
        };
    }
    let done = steps.iter().filter(|d| **d).count();
    if done == steps.len() {
        "done"
    } else if done > 0 {
        "doing"
    } else {
        "todo"
    }
}

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::services::status::derive;

    #[test]
    fn derive_all_done_is_done() {
        assert_eq!(derive("todo", &[true, true]), "done");
        assert_eq!(derive("todo", &[true, false]), "doing");
        assert_eq!(derive("todo", &[false, false]), "todo");
        assert_eq!(derive("doing", &[]), "doing");
    }

    #[test]
    fn ticking_a_step_does_not_pull_a_suspended_task_into_the_week() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交底", "2026-10-20T08:00:00Z", "t1").unwrap();
        let t = crate::services::steps::add(&c, "t1", "收集清单", "2026-10-20T08:00:00Z").unwrap();
        crate::services::steps::add(&c, "t1", "汇编初稿", "2026-10-20T08:00:00Z").unwrap();
        crate::services::week::resolve(
            &c,
            "t1",
            crate::services::week::PassAction::Suspend,
            Some("2026-11-02"),
            None,
            "2026-10-20T08:00:00Z",
        )
        .unwrap();

        let after = crate::services::steps::toggle(&c, &t.steps[0].id, "2026-10-20T08:00:00Z")
            .unwrap();

        assert_eq!(after.status, "doing");
        assert!(!after.in_week);
        assert_eq!(crate::services::week::list_suspended(&c).unwrap().len(), 1);
    }

    #[test]
    fn finishing_last_step_completes_task_and_leaves_week() {
        let c = db::open_in_memory().unwrap();
        crate::services::week::capture(&c, "交付资料目录", "2026-10-20T08:00:00Z", "t1").unwrap();
        let t = crate::services::steps::add(&c, "t1", "收集清单", "2026-10-20T08:00:00Z").unwrap();
        crate::services::steps::add(&c, "t1", "汇编初稿", "2026-10-20T08:00:00Z").unwrap();

        let s1 = &t.steps[0];
        let after_first =
            crate::services::steps::toggle(&c, &s1.id, "2026-10-20T08:00:00Z").unwrap();
        assert_eq!(after_first.status, "doing");
        assert!(after_first.in_week);

        let second_id = after_first.steps[1].id.clone();
        let after_last =
            crate::services::steps::toggle(&c, &second_id, "2026-10-20T08:00:00Z").unwrap();
        assert_eq!(after_last.status, "done");
        assert!(!after_last.in_week);
    }
}

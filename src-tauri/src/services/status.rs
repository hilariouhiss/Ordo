pub fn derive(stored: &str, statuses: &[&str]) -> &'static str {
    if statuses.is_empty() {
        return match stored {
            "doing" => "doing",
            "done" => "done",
            _ => "todo",
        };
    }
    if statuses.iter().all(|status| *status == "done") {
        "done"
    } else if statuses.iter().any(|status| *status == "done" || *status == "doing") {
        "doing"
    } else {
        "todo"
    }
}

#[cfg(test)]
mod tests {
    use crate::services::status::derive;

    #[test]
    fn derive_all_done_is_done() {
        assert_eq!(derive("todo", &["done", "done"]), "done");
        assert_eq!(derive("todo", &["done", "todo"]), "doing");
        assert_eq!(derive("todo", &["doing", "todo"]), "doing");
        assert_eq!(derive("todo", &["todo", "todo"]), "todo");
        assert_eq!(derive("doing", &[]), "doing");
    }
}

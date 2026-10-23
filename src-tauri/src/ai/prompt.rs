use super::AiContext;

pub fn system(ctx: &AiContext) -> String {
    let today = &ctx.today;
    let projects = list(&ctx.projects);
    let categories = list(&ctx.categories);
    let people = list(&ctx.people);
    format!(
        r#"你是任务字段解析器。用户给一句中文口语，你只输出一个 json 对象，不要解释。
当前日期是 {today}；相对日期按这一天算。
字段：projectId、categoryId、ownerId、startDate、dueDate、tags。
- id 只能从下面的列表里选，选不中就不填。
- 日期用 YYYY-MM-DD；说不清就不填。
- tags 是 0-3 个短词。
- 示例输入：周五前把软件方案评审发老李
- 示例 json 输出：{{"projectId":null,"categoryId":null,"ownerId":null,"startDate":null,"dueDate":null,"tags":[]}}
可用项目：{projects}
可用分类：{categories}
可用人员：{people}"#,
    )
}

#[cfg(test)]
mod tests {
    use super::system;
    use crate::ai::AiContext;

    #[test]
    fn prompt_names_today() {
        let ctx = AiContext {
            today: "2026-10-20".into(),
            ..Default::default()
        };
        assert!(system(&ctx).contains("2026-10-20"));
    }
}

fn list(items: &[(String, String)]) -> String {
    if items.is_empty() {
        return "（无）".into();
    }
    items
        .iter()
        .map(|(id, name)| format!("{}({})", name, id))
        .collect::<Vec<_>>()
        .join("、")
}

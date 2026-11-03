use super::AiContext;

pub fn system(ctx: &AiContext) -> String {
    let projects = list(&ctx.projects);
    let categories = list(&ctx.categories);
    let people = list(&ctx.people);
    format!(
        r#"你是任务字段解析器。用户给一句中文口语，你只输出一个 json 对象，不要解释。
字段：projectId、categoryId、ownerId、tags。
- id 只能从下面的列表里选，选不中就不填。
- 不要输出日期：预计开始和预计完成都由预计耗时推算，不由你决定。
- tags 是 0-3 个短词。
- 示例输入：周五前把软件方案评审发老李
- 示例 json 输出：{{"projectId":null,"categoryId":null,"ownerId":null,"tags":[]}}
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
    fn prompt_forbids_dates() {
        let ctx = AiContext::default();
        let prompt = system(&ctx);
        assert!(prompt.contains("不要输出日期"));
        assert!(!prompt.contains("expectedFinishDate"));
    }
}

fn list(items: &[(String, String)]) -> String {
    if items.is_empty() {
        return "（无）".into();
    }
    items
        .iter()
        .map(|(id, name)| format!("{name}({id})"))
        .collect::<Vec<_>>()
        .join("、")
}

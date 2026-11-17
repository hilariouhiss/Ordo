use super::ParsedSection;

/// An ATX heading: one to six hashes, a space, and the title. A trailing run of
/// hashes is the closed form and is dropped.
fn heading(line: &str) -> Option<(i64, String)> {
    let hashes = line.chars().take_while(|character| *character == '#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let rest = line[hashes..].strip_prefix(' ')?;
    let title = rest.trim().trim_end_matches('#').trim();
    if title.is_empty() {
        return None;
    }
    Some((hashes as i64, title.to_string()))
}

/// Splits Markdown on its headings. Text before the first heading becomes an intro
/// chapter named after the file; a file without headings is one chapter.
pub fn parse(title: &str, text: &str) -> Result<Vec<ParsedSection>, String> {
    if text.trim().is_empty() {
        return Err("empty_document".into());
    }
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut sections: Vec<ParsedSection> = Vec::new();
    let mut current: Option<ParsedSection> = None;
    let mut preamble = String::new();
    let mut in_fence = false;
    for line in normalized.lines() {
        let trimmed = line.trim_start();
        let fence =
            trimmed.starts_with(&"\u{0060}".repeat(3)) || trimmed.starts_with("~~~");
        if fence {
            in_fence = !in_fence;
        }
        if !in_fence {
            if let Some((level, heading_title)) = heading(trimmed) {
                if let Some(section) = current.take() {
                    sections.push(trimmed_section(section));
                } else if !preamble.trim().is_empty() {
                    sections.push(ParsedSection {
                        title: title.to_string(),
                        level: 0,
                        body: preamble.trim().to_string(),
                    });
                    preamble.clear();
                }
                current = Some(ParsedSection {
                    title: heading_title,
                    level,
                    body: String::new(),
                });
                continue;
            }
        }
        match current.as_mut() {
            Some(section) => {
                section.body.push_str(line);
                section.body.push('\n');
            }
            None => {
                preamble.push_str(line);
                preamble.push('\n');
            }
        }
    }
    if let Some(section) = current.take() {
        sections.push(trimmed_section(section));
    }
    if sections.is_empty() {
        if preamble.trim().is_empty() {
            return Err("empty_document".into());
        }
        sections.push(ParsedSection {
            title: title.to_string(),
            level: 0,
            body: preamble.trim().to_string(),
        });
    }
    Ok(sections)
}

fn trimmed_section(mut section: ParsedSection) -> ParsedSection {
    section.body = section.body.trim().to_string();
    section
}

#[cfg(test)]
mod tests {
    use super::*;

    fn titles(sections: &[ParsedSection]) -> Vec<&str> {
        sections.iter().map(|section| section.title.as_str()).collect()
    }

    #[test]
    fn headings_become_chapters_and_the_preamble_is_the_first_one() {
        let sections = parse(
            "技术附件",
            "# 范围\n\n交付范围。\n\n## 报表\n导出 CSV。\n",
        )
        .unwrap();
        assert_eq!(titles(&sections), ["范围", "报表"]);
        assert_eq!((sections[0].level, sections[1].level), (1, 2));
        assert_eq!(sections[0].body, "交付范围。");
    }

    #[test]
    fn text_before_the_first_heading_is_named_after_the_file() {
        let sections = parse("附件", "先看这里。\n## 范围\n正文").unwrap();
        assert_eq!(titles(&sections), ["附件", "范围"]);
        assert_eq!(sections[0].body, "先看这里。");
    }

    #[test]
    fn a_file_without_headings_is_one_chapter() {
        let sections = parse("笔记", "第一行\n第二行").unwrap();
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "笔记");
        assert_eq!(sections[0].body, "第一行\n第二行");
    }

    #[test]
    fn a_heading_inside_a_code_fence_stays_text() {
        let sections = parse("笔记", "# 真标题\n~~~\n# 不是标题\n~~~\n").unwrap();
        assert_eq!(titles(&sections), ["真标题"]);
        assert!(sections[0].body.contains("# 不是标题"));
    }

    #[test]
    fn a_blank_or_heading_only_file_still_parses() {
        assert_eq!(parse("空", "   \n").unwrap_err(), "empty_document");
        let sections = parse("只有标题", "# 范围\n").unwrap();
        assert_eq!(titles(&sections), ["范围"]);
        assert_eq!(sections[0].body, "");
    }
}

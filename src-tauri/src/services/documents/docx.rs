use super::ParsedSection;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::collections::HashMap;
use std::io::{Cursor, Read};

/// The most any part of a real document inflates to; Word XML is verbose but bounded.
/// shortcut: 64 MB covers a text-heavy file at the upload cap, revisit if that cap grows.
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;

fn entry(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<String, String> {
    entry_with_limit(archive, name, MAX_ENTRY_BYTES)
}

fn entry_with_limit(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
    limit: u64,
) -> Result<String, String> {
    let mut file = archive
        .by_name(name)
        .map_err(|_| "docx_invalid".to_string())?;
    if file.size() > limit {
        return Err("document_too_large".into());
    }
    // The header can lie about the size, so the read itself is capped too.
    let mut text = String::new();
    Read::take(&mut file, limit + 1)
        .read_to_string(&mut text)
        .map_err(|_| "docx_invalid".to_string())?;
    if text.len() as u64 > limit {
        return Err("document_too_large".into());
    }
    Ok(text)
}

fn attribute(element: &BytesStart<'_>, name: &str) -> Option<String> {
    for attribute in element.attributes().flatten() {
        if attribute.key.local_name().as_ref() == name {
            return attribute
                .unescape_value()
                .ok()
                .map(|value| value.into_owned());
        }
    }
    None
}

/// A Word built-in heading, in either language, or an outline level carried by the
/// paragraph style. A style id like "Heading2" is the fallback when styles.xml is absent.
fn heading_level(name: &str, outline: Option<i64>, style_id: Option<&str>) -> Option<i64> {
    let lower = name.trim().to_ascii_lowercase();
    for prefix in ["heading ", "heading", "标题 ", "标题"] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            if let Ok(level) = rest.trim().parse::<i64>() {
                if (1..=6).contains(&level) {
                    return Some(level);
                }
            }
        }
    }
    if let Some(level) = outline {
        if (0..9).contains(&level) {
            return Some(level + 1);
        }
    }
    if let Some(style_id) = style_id {
        let lower = style_id.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("heading") {
            if let Ok(level) = rest.trim().parse::<i64>() {
                if (1..=6).contains(&level) {
                    return Some(level);
                }
            }
        }
    }
    None
}

fn parse_styles(xml: &str) -> HashMap<String, i64> {
    let mut map = HashMap::new();
    let mut reader = Reader::from_str(xml);
    let mut in_style = false;
    let mut style_id: Option<String> = None;
    let mut name = String::new();
    let mut outline: Option<i64> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => match element.local_name().as_ref() {
                "style" => {
                    in_style = true;
                    style_id = attribute(&element, "styleId");
                    name.clear();
                    outline = None;
                }
                "name" if in_style => {
                    if let Some(value) = attribute(&element, "val") {
                        name = value;
                    }
                }
                "outlineLvl" if in_style => {
                    outline = attribute(&element, "val").and_then(|value| value.parse().ok());
                }
                _ => {}
            },
            Ok(Event::Empty(element)) if in_style => match element.local_name().as_ref() {
                "name" => {
                    if let Some(value) = attribute(&element, "val") {
                        name = value;
                    }
                }
                "outlineLvl" => {
                    outline = attribute(&element, "val").and_then(|value| value.parse().ok());
                }
                _ => {}
            },
            Ok(Event::End(element)) => {
                if element.local_name().as_ref() == "style" && in_style {
                    if let Some(level) = heading_level(&name, outline, style_id.as_deref()) {
                        if let Some(id) = style_id.take() {
                            map.insert(id, level);
                        }
                    }
                    in_style = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    map
}

fn parse_paragraphs(xml: &str) -> Result<Vec<(Option<String>, String)>, String> {
    let mut paragraphs = Vec::new();
    let mut reader = Reader::from_str(xml);
    let mut in_paragraph = false;
    let mut in_text = false;
    let mut style: Option<String> = None;
    let mut text = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => match element.local_name().as_ref() {
                "p" => {
                    in_paragraph = true;
                    style = None;
                    text.clear();
                }
                "pStyle" if in_paragraph => {
                    style = attribute(&element, "val");
                }
                "t" if in_paragraph => in_text = true,
                "tab" if in_paragraph => text.push('\t'),
                "br" | "cr" if in_paragraph => text.push('\n'),
                _ => {}
            },
            // Word writes an empty paragraph as <w:p/>, which only ever reaches Empty.
            Ok(Event::Empty(element)) => match element.local_name().as_ref() {
                "p" => paragraphs.push((None, String::new())),
                "pStyle" if in_paragraph => style = attribute(&element, "val"),
                "tab" if in_paragraph => text.push('\t'),
                "br" | "cr" if in_paragraph => text.push('\n'),
                _ => {}
            },
            Ok(Event::Text(value)) if in_paragraph && in_text => {
                let raw = value.into_inner();
                match quick_xml::escape::unescape(&raw) {
                    Ok(unescaped) => text.push_str(&unescaped),
                    Err(_) => text.push_str(&raw),
                }
            }
            Ok(Event::End(element)) => match element.local_name().as_ref() {
                "t" => in_text = false,
                "p" if in_paragraph => {
                    paragraphs.push((style.take(), std::mem::take(&mut text)));
                    in_paragraph = false;
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => return Err("docx_invalid".into()),
            _ => {}
        }
    }
    Ok(paragraphs)
}

fn trimmed(mut section: ParsedSection) -> ParsedSection {
    section.body = section.body.trim().to_string();
    section
}

pub fn parse(title: &str, bytes: &[u8]) -> Result<Vec<ParsedSection>, String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "docx_invalid".to_string())?;
    let document = entry(&mut archive, "word/document.xml")?;
    // Styles are a nicety: a missing or oversized one must not refuse the document.
    let styles = entry(&mut archive, "word/styles.xml")
        .ok()
        .map(|xml| parse_styles(&xml))
        .unwrap_or_default();
    let paragraphs = parse_paragraphs(&document)?;
    let mut sections: Vec<ParsedSection> = Vec::new();
    let mut current: Option<ParsedSection> = None;
    let mut preamble = String::new();
    for (style, text) in paragraphs {
        let level = style.as_deref().and_then(|id| {
            styles
                .get(id)
                .copied()
                .or_else(|| heading_level("", None, Some(id)))
        });
        let text = text.trim_end();
        if text.trim().is_empty() && level.is_none() {
            // A blank paragraph is a blank line, in the intro as well as in a chapter.
            if let Some(section) = current.as_mut() {
                section.body.push('\n');
            } else if !preamble.is_empty() {
                preamble.push('\n');
            }
            continue;
        }
        match level {
            Some(level) if !text.trim().is_empty() => {
                if let Some(section) = current.take() {
                    sections.push(trimmed(section));
                } else if !preamble.trim().is_empty() {
                    sections.push(ParsedSection {
                        title: title.to_string(),
                        level: 0,
                        body: preamble.trim().to_string(),
                    });
                    preamble.clear();
                }
                current = Some(ParsedSection {
                    title: text.trim().to_string(),
                    level,
                    body: String::new(),
                });
            }
            _ => {
                if text.trim().is_empty() {
                    continue;
                }
                if let Some(section) = current.as_mut() {
                    if !section.body.is_empty() {
                        section.body.push('\n');
                    }
                    section.body.push_str(text);
                } else {
                    if !preamble.is_empty() {
                        preamble.push('\n');
                    }
                    preamble.push_str(text);
                }
            }
        }
    }
    if let Some(section) = current.take() {
        sections.push(trimmed(section));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build(document: &str, styles: &str) -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("word/document.xml", options).unwrap();
            writer.write_all(document.as_bytes()).unwrap();
            writer.start_file("word/styles.xml", options).unwrap();
            writer.write_all(styles.as_bytes()).unwrap();
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    fn paragraph(style: Option<&str>, text: &str) -> String {
        let style = style
            .map(|value| format!("<w:pPr><w:pStyle w:val=\"{value}\"/></w:pPr>"))
            .unwrap_or_default();
        format!("<w:p>{style}<w:r><w:t>{text}</w:t></w:r></w:p>")
    }

    #[test]
    fn heading_styles_split_chapters_and_keep_the_intro() {
        let document = format!(
            "<w:document><w:body>{}{}{}{}</w:body></w:document>",
            paragraph(None, "导言"),
            paragraph(Some("Heading1"), "范围"),
            paragraph(None, "交付范围。"),
            paragraph(Some("Heading2"), "报表")
        );
        let styles = "<w:styles><w:style w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/></w:style><w:style w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/></w:style></w:styles>";
        let sections = parse("附件", &build(&document, styles)).unwrap();
        let titles: Vec<&str> = sections.iter().map(|section| section.title.as_str()).collect();
        assert_eq!(titles, ["附件", "范围", "报表"]);
        assert_eq!(sections[1].level, 1);
        assert_eq!(sections[1].body, "交付范围。");
    }

    #[test]
    fn a_word_file_without_headings_is_one_chapter() {
        let document = format!(
            "<w:document><w:body>{}{}</w:body></w:document>",
            paragraph(None, "第一段"),
            paragraph(None, "第二段")
        );
        let sections = parse("记录", &build(&document, "<w:styles/>")).unwrap();
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "记录");
        assert_eq!(sections[0].body, "第一段\n第二段");
    }

    #[test]
    fn a_bad_archive_is_refused() {
        assert_eq!(parse("坏文件", b"not a zip").unwrap_err(), "docx_invalid");
    }

    #[test]
    fn an_empty_word_paragraph_keeps_its_blank_line() {
        // Word writes a blank paragraph as <w:p/>, not as an open/close pair.
        let document = format!(
            "<w:document><w:body>{}<w:p/>{}</w:body></w:document>",
            paragraph(None, "第一段"),
            paragraph(None, "第二段")
        );
        let sections = parse("记录", &build(&document, "<w:styles/>")).unwrap();
        assert_eq!(sections[0].body, "第一段\n\n第二段");
    }

    #[test]
    fn a_part_past_the_size_limit_is_refused() {
        let bytes = build(&paragraph(None, "正文"), "<w:styles/>");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        // The real limit is large; the guard itself is what this pins.
        assert_eq!(
            entry_with_limit(&mut archive, "word/document.xml", 4).unwrap_err(),
            "document_too_large"
        );
    }
}

use super::ParsedSection;

const MAX_PAGES: usize = 2000;

/// PDFs have no reliable chapter structure outside bookmarks, and lopdf's outline API
/// does not expose the bookmark titles. Pages are the chapters: one section per page
/// that carries text, so every page can be linked and selected.
pub fn parse(_title: &str, bytes: &[u8], english: bool) -> Result<Vec<ParsedSection>, String> {
    let document =
        lopdf::Document::load_mem(bytes).map_err(|_| "pdf_invalid".to_string())?;
    let pages = document.get_pages();
    if pages.is_empty() {
        return Err("pdf_no_text".into());
    }
    if pages.len() > MAX_PAGES {
        return Err("document_too_large".into());
    }
    let mut sections = Vec::new();
    for number in pages.keys() {
        // One damaged page loses its own text, not the whole document.
        let text = document.extract_text(&[*number]).unwrap_or_default();
        let text = text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        sections.push(ParsedSection {
            title: if english {
                format!("Page {number}")
            } else {
                format!("第 {number} 页")
            },
            level: 0,
            body: text,
        });
    }
    if sections.is_empty() {
        return Err("pdf_no_text".into());
    }
    Ok(sections)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_non_pdf_is_refused() {
        let error = parse("坏文件", b"this is not a pdf", false).unwrap_err();
        assert!(
            error == "pdf_invalid" || error == "pdf_no_text",
            "unexpected error: {error}"
        );
    }
}

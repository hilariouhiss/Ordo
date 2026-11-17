mod docx;
mod markdown;
mod pdf;

use crate::dto::{DocumentDto, DocumentOutlineDto};
use crate::repo::{documents, projects, settings};
use base64::Engine;
use rusqlite::Connection;
use std::path::Path;
use uuid::Uuid;

/// One chapter as the importer sees it: a title, its outline depth, and its text.
#[derive(Debug)]
pub struct ParsedSection {
    pub title: String,
    pub level: i64,
    pub body: String,
}

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn stem(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn fallback_title(conn: &Connection) -> String {
    if settings::language(conn) == "en" {
        "Document".into()
    } else {
        "文档".into()
    }
}

/// A plain-text file in UTF-8, or a legacy Chinese file in GB18030. Docx/PDF decode
/// their own bytes; only the text formats land here.
pub(crate) fn decode_text(bytes: &[u8]) -> Result<String, String> {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(text.to_string());
    }
    let (text, _, had_errors) = encoding_rs::GB18030.decode(bytes);
    if had_errors {
        return Err("unsupported_document".into());
    }
    Ok(text.into_owned())
}

pub fn import(
    conn: &Connection,
    project_id: &str,
    file_name: &str,
    file_base64: &str,
    now: &str,
) -> Result<DocumentOutlineDto, String> {
    if !projects::exists(conn, project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    let source_name = file_name.trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(file_base64)
        .map_err(|_| "unsupported_document".to_string())?;
    if bytes.len() > crate::limits::LIMITS.document_bytes {
        return Err("document_too_large".into());
    }
    let extension = extension(source_name);
    let title = match stem(source_name) {
        stem if stem.is_empty() => fallback_title(conn),
        stem => stem,
    };
    let sections = match extension.as_str() {
        "md" | "markdown" | "txt" => {
            let text = decode_text(&bytes)?;
            markdown::parse(&title, &text)?
        }
        "docx" => docx::parse(&title, &bytes)?,
        "pdf" => pdf::parse(&title, &bytes, settings::language(conn) == "en")?,
        _ => return Err("unsupported_document".into()),
    };
    if sections.is_empty() {
        return Err("empty_document".into());
    }
    let stored: usize = sections
        .iter()
        .map(|section| section.title.len() + section.body.len())
        .sum();
    if stored > crate::limits::LIMITS.document_text_bytes {
        return Err("document_too_large".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let document_id = Uuid::new_v4().to_string();
    documents::insert_document(&tx, &document_id, project_id, &title, source_name, now)
        .map_err(|e| e.to_string())?;
    for (index, section) in sections.iter().enumerate() {
        documents::insert_section(
            &tx,
            &Uuid::new_v4().to_string(),
            &document_id,
            &section.title,
            section.level,
            &section.body,
            index as i64,
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    documents::outline_one(conn, &document_id).map_err(|e| e.to_string())
}

pub fn list(conn: &Connection, project_id: &str) -> Result<Vec<DocumentOutlineDto>, String> {
    if !projects::exists(conn, project_id).map_err(|e| e.to_string())? {
        return Err("invalid_project".into());
    }
    documents::outline(conn, project_id).map_err(|e| e.to_string())
}

pub fn get(conn: &Connection, id: &str) -> Result<DocumentDto, String> {
    if !documents::exists(conn, id).map_err(|e| e.to_string())? {
        return Err("document_not_found".into());
    }
    documents::detail(conn, id).map_err(|e| e.to_string())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    documents::delete(conn, id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::repo::settings;
    use crate::services::projects;
    use base64::Engine;

    const NOW: &str = "2026-11-17T01:00:00Z";

    fn setup() -> Connection {
        let c = db::open_in_memory().unwrap();
        settings::set(&c, settings::keys::LANGUAGE, "zh").unwrap();
        c.execute(
            "INSERT INTO people (id, name, is_me, created_at, updated_at)
             VALUES ('me', '我', 1, ?1, ?1)",
            [NOW],
        )
        .unwrap();
        c
    }

    fn project(c: &Connection) -> String {
        projects::create(c, "华东客户交付", NOW).unwrap().id
    }

    fn base64(text: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(text)
    }

    #[test]
    fn importing_markdown_stores_the_chapters() {
        let c = setup();
        let p = project(&c);
        let outline = import(
            &c,
            &p,
            "技术附件.md",
            &base64("# 范围\n交付范围。\n## 报表\n导出 CSV。".as_bytes()),
            NOW,
        )
        .unwrap();
        assert_eq!(outline.title, "技术附件");
        assert_eq!(outline.sections.len(), 2);
        let detail = get(&c, &outline.id).unwrap();
        assert_eq!(detail.sections[0].body, "交付范围。");
        assert_eq!(detail.sections[1].title, "报表");
    }

    #[test]
    fn a_plain_text_file_is_one_chapter_and_gb18030_is_readable() {
        let c = setup();
        let p = project(&c);
        let outline = import(&c, &p, "记录.txt", &base64("第一行\n第二行".as_bytes()), NOW).unwrap();
        assert_eq!(outline.sections.len(), 1);
        let (encoded, _, _) = encoding_rs::GB18030.encode("范围");
        let outline = import(&c, &p, "旧文件.txt", &base64(&encoded), NOW).unwrap();
        assert_eq!(get(&c, &outline.id).unwrap().sections[0].body, "范围");
    }

    #[test]
    fn a_chapter_reports_the_requirements_backing_it() {
        let c = setup();
        let p = project(&c);
        let outline = import(&c, &p, "附件.md", &base64("# 范围\n正文".as_bytes()), NOW).unwrap();
        let section = outline.sections[0].id.clone();
        let requirement =
            crate::services::requirements::create(&c, &p, "导出报表", NOW).unwrap();
        crate::services::requirements::link_section(&c, &requirement.id, &section, NOW).unwrap();

        let document = get(&c, &outline.id).unwrap();

        assert_eq!(document.sections[0].requirements.len(), 1);
        assert_eq!(document.sections[0].requirements[0].number, "REQ-001");
        assert_eq!(document.sections[0].requirements[0].title, "导出报表");
    }

    #[test]
    fn unsupported_empty_or_missing_files_are_refused() {
        let c = setup();
        let p = project(&c);
        assert_eq!(
            import(&c, &p, "程序.exe", &base64(b"data"), NOW).unwrap_err(),
            "unsupported_document"
        );
        assert_eq!(
            import(&c, &p, "空.md", &base64(b"   "), NOW).unwrap_err(),
            "empty_document"
        );
        assert_eq!(
            import(&c, "missing", "附件.md", &base64("正文".as_bytes()), NOW).unwrap_err(),
            "invalid_project"
        );
        assert_eq!(
            get(&c, "missing").unwrap_err(),
            "document_not_found"
        );
    }
}


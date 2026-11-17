use crate::dto::{
    DocumentDto, DocumentOutlineDto, DocumentSectionDto, DocumentSectionSummaryDto,
    RequirementRefDto,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

pub fn insert_document(
    conn: &Connection,
    id: &str,
    project_id: &str,
    title: &str,
    source_name: &str,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO project_documents (id, project_id, title, source_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, project_id, title, source_name, now],
    )?;
    Ok(())
}

pub fn insert_section(
    conn: &Connection,
    id: &str,
    document_id: &str,
    title: &str,
    level: i64,
    body: &str,
    sort_order: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO document_sections (id, document_id, title, level, body, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, document_id, title, level, body, sort_order],
    )?;
    Ok(())
}

pub fn project_of(conn: &Connection, document_id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT project_id FROM project_documents WHERE id = ?1",
        [document_id],
        |r| r.get(0),
    )
    .optional()
}

pub fn exists(conn: &Connection, document_id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM project_documents WHERE id = ?1",
        [document_id],
        |_| Ok(true),
    )
    .optional()
    .map(|found| found.unwrap_or(false))
}

/// Every document of a project with its chapter titles, no bodies: the list card and
/// the chapter picker need the outline, not the text.
pub fn outline(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<DocumentOutlineDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, source_name FROM project_documents
         WHERE project_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        Ok(DocumentOutlineDto {
            id: r.get(0)?,
            title: r.get(1)?,
            source_name: r.get(2)?,
            sections: vec![],
        })
    })?;
    let mut documents: Vec<DocumentOutlineDto> = rows.collect::<rusqlite::Result<_>>()?;
    let mut sections = conn.prepare(
        "SELECT ds.document_id, ds.id, ds.title, ds.level
         FROM document_sections ds JOIN project_documents pd ON pd.id = ds.document_id
         WHERE pd.project_id = ?1 ORDER BY ds.sort_order, ds.id",
    )?;
    let rows = sections.query_map([project_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            DocumentSectionSummaryDto {
                id: r.get(1)?,
                title: r.get(2)?,
                level: r.get(3)?,
            },
        ))
    })?;
    let index: HashMap<String, usize> = documents
        .iter()
        .enumerate()
        .map(|(position, document)| (document.id.clone(), position))
        .collect();
    for row in rows {
        let (document_id, section) = row?;
        if let Some(&position) = index.get(&document_id) {
            documents[position].sections.push(section);
        }
    }
    Ok(documents)
}

pub fn outline_one(
    conn: &Connection,
    document_id: &str,
) -> rusqlite::Result<DocumentOutlineDto> {
    let project_id = project_of(conn, document_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    outline(conn, &project_id)?
        .into_iter()
        .find(|document| document.id == document_id)
        .ok_or(rusqlite::Error::QueryReturnedNoRows)
}

/// One document with every chapter body and the requirements each chapter backs.
pub fn detail(conn: &Connection, document_id: &str) -> rusqlite::Result<DocumentDto> {
    let (id, title, source_name) = conn.query_row(
        "SELECT id, title, source_name FROM project_documents WHERE id = ?1",
        [document_id],
        |r| Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let mut stmt = conn.prepare(
        "SELECT id, title, level, body FROM document_sections
         WHERE document_id = ?1 ORDER BY sort_order, id",
    )?;
    let rows = stmt.query_map([document_id], |r| {
        Ok(DocumentSectionDto {
            id: r.get(0)?,
            title: r.get(1)?,
            level: r.get(2)?,
            body: r.get(3)?,
            requirements: vec![],
        })
    })?;
    let mut sections: Vec<DocumentSectionDto> = rows.collect::<rusqlite::Result<_>>()?;
    let mut links = conn.prepare(
        "SELECT rs.section_id, r.id, r.number, r.title
         FROM requirement_sections rs
         JOIN requirements r ON r.id = rs.requirement_id
         JOIN document_sections ds ON ds.id = rs.section_id
         WHERE ds.document_id = ?1
         ORDER BY r.created_at, r.id",
    )?;
    let rows = links.query_map([document_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            RequirementRefDto {
                id: r.get(1)?,
                number: r.get(2)?,
                title: r.get(3)?,
            },
        ))
    })?;
    let index: HashMap<String, usize> = sections
        .iter()
        .enumerate()
        .map(|(position, section)| (section.id.clone(), position))
        .collect();
    for row in rows {
        let (section_id, requirement) = row?;
        if let Some(&position) = index.get(&section_id) {
            sections[position].requirements.push(requirement);
        }
    }
    Ok(DocumentDto {
        id,
        title,
        source_name,
        sections,
    })
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM project_documents WHERE id = ?1", [id])?;
    Ok(())
}

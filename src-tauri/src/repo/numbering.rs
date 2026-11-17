use rusqlite::{Connection, OptionalExtension};

/// A project's number format for one kind of record.
pub fn format_number(prefix: &str, width: i64, seq: i64) -> String {
    format!("{prefix}{seq:0width$}", width = width.clamp(1, 6) as usize)
}

/// The next sequence and its finished number for one project's requirements or issues.
/// `table` is one of the two literals the service passes, never user input. A number
/// already taken (the format was changed back) is skipped instead of violating the
/// unique index.
pub fn next_number(
    conn: &Connection,
    project_id: &str,
    table: &str,
    prefix: &str,
    width: i64,
) -> rusqlite::Result<(i64, String)> {
    let mut seq: i64 = conn.query_row(
        &format!("SELECT COALESCE(MAX(seq), 0) + 1 FROM {table} WHERE project_id = ?1"),
        [project_id],
        |r| r.get(0),
    )?;
    loop {
        let number = format_number(prefix, width, seq);
        let taken: bool = conn
            .query_row(
                &format!("SELECT 1 FROM {table} WHERE project_id = ?1 AND number = ?2"),
                rusqlite::params![project_id, number],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if !taken {
            return Ok((seq, number));
        }
        seq += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pads_to_the_width_and_keeps_a_longer_sequence() {
        assert_eq!(format_number("REQ-", 3, 1), "REQ-001");
        assert_eq!(format_number("REQ-", 3, 42), "REQ-042");
        assert_eq!(format_number("R", 1, 9), "R9");
        assert_eq!(format_number("REQ-", 2, 100), "REQ-100");
    }
}

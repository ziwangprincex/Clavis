//! Explicit, local-only Zotero SQLite search.
//!
//! This module never discovers profiles, writes a Zotero database, attaches a
//! database, or executes user-provided SQL. The frontend supplies a path from a
//! native file picker; Clavis opens only a file named `zotero.sqlite` with
//! SQLite read-only flags and runs a fixed, bounded query.

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;

const MAX_DATABASE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_QUERY_CHARS: usize = 160;
const MAX_RESULTS: usize = 200;
const FETCH_LIMIT: usize = 1_500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroEntry {
    pub item_key: String,
    pub citation_key: Option<String>,
    pub item_type: String,
    pub title: Option<String>,
    pub creators: Option<String>,
    pub year: Option<String>,
    pub publication: Option<String>,
    pub doi: Option<String>,
    pub url: Option<String>,
    pub tags: Vec<String>,
}

fn database_path(raw: &str) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(raw).map_err(|e| format!("Zotero database not found: {e}"))?;
    let metadata = std::fs::metadata(&path).map_err(|e| format!("cannot inspect Zotero database: {e}"))?;
    if !metadata.is_file() || metadata.len() > MAX_DATABASE_BYTES {
        return Err("Zotero database must be a regular zotero.sqlite file up to 2 GiB".to_string());
    }
    if !path.file_name().is_some_and(|name| name.eq_ignore_ascii_case("zotero.sqlite")) {
        return Err("select Zotero's zotero.sqlite database file, not an arbitrary SQLite database".to_string());
    }
    Ok(path)
}

fn clean_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let cleaned = value.split_whitespace().collect::<Vec<_>>().join(" ");
        (!cleaned.is_empty()).then_some(cleaned)
    })
}

fn citation_key(extra: Option<String>) -> Option<String> {
    let extra = extra?;
    for line in extra.lines() {
        let Some((label, key)) = line.split_once(':') else { continue };
        if !matches!(label.trim().to_ascii_lowercase().as_str(), "citation key" | "citekey") {
            continue;
        }
        let key = key.trim();
        if !key.is_empty() && key.len() <= 200 && !key.chars().any(char::is_whitespace) {
            return Some(key.to_string());
        }
    }
    None
}

fn matches_query(entry: &ZoteroEntry, query: &str) -> bool {
    let terms = query.split_whitespace().map(str::to_ascii_lowercase).collect::<Vec<_>>();
    if terms.is_empty() {
        return true;
    }
    let haystack = [
        entry.item_key.as_str(),
        entry.citation_key.as_deref().unwrap_or(""),
        entry.title.as_deref().unwrap_or(""),
        entry.creators.as_deref().unwrap_or(""),
        entry.year.as_deref().unwrap_or(""),
        entry.publication.as_deref().unwrap_or(""),
        entry.doi.as_deref().unwrap_or(""),
        entry.url.as_deref().unwrap_or(""),
        &entry.tags.join(" "),
    ]
    .join(" ")
    .to_ascii_lowercase();
    terms.iter().all(|term| haystack.contains(term))
}

fn search_sync(database: String, query: String) -> Result<Vec<ZoteroEntry>, String> {
    let query = query.trim();
    if query.len() > MAX_QUERY_CHARS {
        return Err(format!("Zotero search is limited to {MAX_QUERY_CHARS} characters"));
    }
    let path = database_path(&database)?;
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("cannot open Zotero database read-only: {e}"))?;
    connection
        .busy_timeout(Duration::from_millis(1_000))
        .map_err(|e| format!("cannot configure Zotero database reader: {e}"))?;
    connection
        .pragma_update(None, "query_only", "ON")
        .map_err(|e| format!("cannot enforce read-only Zotero query: {e}"))?;

    // Fixed SQL only. Correlated subqueries avoid multiplying item-data rows by
    // creator/tag rows, and deleted Zotero items are excluded when that table is
    // present in normal profile schemas.
    let mut statement = connection.prepare(
        r#"
        SELECT
          items.key,
          COALESCE(itemTypes.typeName, 'item'),
          (SELECT values_.value FROM itemData data
             JOIN fields ON fields.fieldID = data.fieldID
             JOIN itemDataValues values_ ON values_.valueID = data.valueID
           WHERE data.itemID = items.itemID AND fields.fieldName = 'title' LIMIT 1),
          (SELECT group_concat(COALESCE(NULLIF(trim(creators.lastName), ''), creators.firstName), '; ')
             FROM itemCreators
             JOIN creators ON creators.creatorID = itemCreators.creatorID
           WHERE itemCreators.itemID = items.itemID),
          (SELECT values_.value FROM itemData data
             JOIN fields ON fields.fieldID = data.fieldID
             JOIN itemDataValues values_ ON values_.valueID = data.valueID
           WHERE data.itemID = items.itemID AND fields.fieldName = 'date' LIMIT 1),
          (SELECT values_.value FROM itemData data
             JOIN fields ON fields.fieldID = data.fieldID
             JOIN itemDataValues values_ ON values_.valueID = data.valueID
           WHERE data.itemID = items.itemID AND fields.fieldName IN ('publicationTitle', 'bookTitle') LIMIT 1),
          (SELECT values_.value FROM itemData data
             JOIN fields ON fields.fieldID = data.fieldID
             JOIN itemDataValues values_ ON values_.valueID = data.valueID
           WHERE data.itemID = items.itemID AND fields.fieldName = 'DOI' LIMIT 1),
          (SELECT values_.value FROM itemData data
             JOIN fields ON fields.fieldID = data.fieldID
             JOIN itemDataValues values_ ON values_.valueID = data.valueID
           WHERE data.itemID = items.itemID AND fields.fieldName = 'url' LIMIT 1),
          (SELECT values_.value FROM itemData data
             JOIN fields ON fields.fieldID = data.fieldID
             JOIN itemDataValues values_ ON values_.valueID = data.valueID
           WHERE data.itemID = items.itemID AND fields.fieldName = 'extra' LIMIT 1),
          (SELECT group_concat(tags.name, '; ')
             FROM itemTags JOIN tags ON tags.tagID = itemTags.tagID
           WHERE itemTags.itemID = items.itemID)
        FROM items
        LEFT JOIN itemTypes ON itemTypes.itemTypeID = items.itemTypeID
        WHERE NOT EXISTS (SELECT 1 FROM deletedItems WHERE deletedItems.itemID = items.itemID)
        ORDER BY items.dateModified DESC
        LIMIT ?1
        "#,
    ).map_err(|e| format!("not a compatible Zotero database: {e}"))?;
    let rows = statement
        .query_map([FETCH_LIMIT], |row| {
            let extra: Option<String> = row.get(8)?;
            let tags = row
                .get::<_, Option<String>>(9)?
                .unwrap_or_default()
                .split(';')
                .map(str::trim)
                .filter(|tag| !tag.is_empty())
                .map(str::to_string)
                .collect();
            Ok(ZoteroEntry {
                item_key: row.get(0)?,
                citation_key: citation_key(extra),
                item_type: row.get(1)?,
                title: clean_text(row.get(2)?),
                creators: clean_text(row.get(3)?),
                year: clean_text(row.get(4)?),
                publication: clean_text(row.get(5)?),
                doi: clean_text(row.get(6)?),
                url: clean_text(row.get(7)?),
                tags,
            })
        })
        .map_err(|e| format!("cannot query Zotero database: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let entry = row.map_err(|e| format!("cannot read Zotero result: {e}"))?;
        if matches_query(&entry, query) {
            out.push(entry);
            if out.len() >= MAX_RESULTS {
                break;
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn search_zotero_database(database: String, query: String) -> Result<Vec<ZoteroEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || search_sync(database, query))
        .await
        .map_err(|e| format!("Zotero search worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use tempfile::tempdir;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("zotero.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch(
            "CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INTEGER, key TEXT, dateModified TEXT);
             CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
             CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
             CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER);
             CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
             CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
             CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER);
             CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE itemTags (itemID INTEGER, tagID INTEGER);
             CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);",
        ).unwrap();
        connection.execute("INSERT INTO itemTypes VALUES (1, 'journalArticle')", []).unwrap();
        for (id, name) in [(1, "title"), (2, "date"), (3, "publicationTitle"), (4, "DOI"), (5, "extra")] {
            connection.execute("INSERT INTO fields VALUES (?1, ?2)", params![id, name]).unwrap();
        }
        connection.execute("INSERT INTO items VALUES (1, 1, 'ABCD1234', '2026-01-01')", []).unwrap();
        for (id, value) in [(1, "Labor Markets"), (2, "2024"), (3, "Economic Journal"), (4, "10.1/example"), (5, "Citation Key: smith2024labor")] {
            connection.execute("INSERT INTO itemDataValues VALUES (?1, ?2)", params![id, value]).unwrap();
            connection.execute("INSERT INTO itemData VALUES (1, ?1, ?1)", params![id]).unwrap();
        }
        connection.execute("INSERT INTO creators VALUES (1, 'Jane', 'Smith')", []).unwrap();
        connection.execute("INSERT INTO itemCreators VALUES (1, 1)", []).unwrap();
        connection.execute("INSERT INTO tags VALUES (1, 'labor')", []).unwrap();
        connection.execute("INSERT INTO itemTags VALUES (1, 1)", []).unwrap();
        connection.execute("INSERT INTO items VALUES (2, 1, 'DELETED1', '2026-02-01')", []).unwrap();
        connection.execute("INSERT INTO deletedItems VALUES (2)", []).unwrap();
        drop(connection);
        (dir, path)
    }

    #[test]
    fn searches_a_fixture_read_only_and_extracts_citation_key() {
        let (_dir, path) = fixture();
        let before = std::fs::read(&path).unwrap();
        let entries = search_sync(path.to_string_lossy().to_string(), "smith labor".to_string()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].item_key, "ABCD1234");
        assert_eq!(entries[0].citation_key.as_deref(), Some("smith2024labor"));
        assert_eq!(entries[0].tags, ["labor"]);
        assert_eq!(std::fs::read(&path).unwrap(), before, "search must not modify Zotero SQLite");
        assert!(!path.with_file_name("zotero.sqlite-wal").exists());
        assert!(!path.with_file_name("zotero.sqlite-shm").exists());
    }

    #[test]
    fn rejects_arbitrary_sqlite_file_names_and_long_queries() {
        let dir = tempdir().unwrap();
        let other = dir.path().join("other.sqlite");
        std::fs::write(&other, b"not used").unwrap();
        assert!(database_path(other.to_str().unwrap()).is_err());
        let (_dir, path) = fixture();
        assert!(search_sync(path.to_string_lossy().to_string(), "x".repeat(MAX_QUERY_CHARS + 1)).is_err());
    }

    #[test]
    fn parses_only_safe_citation_key_lines() {
        assert_eq!(citation_key(Some("Citation Key: doe2020".to_string())).as_deref(), Some("doe2020"));
        assert_eq!(citation_key(Some("Citation Key: bad key".to_string())), None);
        assert_eq!(citation_key(Some("Other: nope".to_string())), None);
    }
}

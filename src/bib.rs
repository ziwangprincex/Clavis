//! BibTeX entry parser.
//!
//! Extracted from `latex.rs` — recognises `@type{key, field = {...} | "...", ...}`.
//! No external crate; scans bytes and slices at ASCII boundaries.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibEntry {
    pub key: String,
    pub entry_type: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub year: Option<String>,
    pub source_file: String,
    pub source_line: u32,
}

pub fn parse_bib_files(bib_paths: Vec<String>) -> Vec<BibEntry> {
    let mut out = Vec::new();
    for path in bib_paths {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        parse_bib_text(&text, &path, &mut out);
    }
    out
}

fn parse_bib_text(text: &str, source: &str, out: &mut Vec<BibEntry>) {
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        while i < bytes.len() && bytes[i] != b'@' { i += 1; }
        if i >= bytes.len() { break; }
        let entry_start = i;
        i += 1;
        let type_start = i;
        while i < bytes.len() && (bytes[i] as char).is_ascii_alphabetic() { i += 1; }
        let entry_type = std::str::from_utf8(&bytes[type_start..i]).unwrap_or("").to_ascii_lowercase();
        if entry_type.is_empty() || matches!(entry_type.as_str(), "comment" | "preamble" | "string") {
            continue;
        }
        while i < bytes.len() && (bytes[i] as char).is_whitespace() { i += 1; }
        if i >= bytes.len() || bytes[i] != b'{' { continue; }
        i += 1;
        let key_start = i;
        while i < bytes.len() && bytes[i] != b',' && bytes[i] != b'}' && bytes[i] != b'\n' {
            i += 1;
        }
        let key = std::str::from_utf8(&bytes[key_start..i]).unwrap_or("").trim().to_string();
        if key.is_empty() { continue; }
        let source_line = (text[..entry_start].bytes().filter(|&b| b == b'\n').count() as u32) + 1;
        let body_start = i;
        let mut depth = 1i32;
        while i < bytes.len() && depth > 0 {
            match bytes[i] {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
        if depth != 0 { continue; }
        let body = &text[body_start..(i - 1)];
        let title = extract_field(body, "title");
        let author = extract_field(body, "author");
        let year = extract_field(body, "year").or_else(|| extract_field(body, "date"));
        out.push(BibEntry {
            key,
            entry_type,
            title,
            author,
            year,
            source_file: source.to_string(),
            source_line,
        });
    }
}

fn extract_field(body: &str, name: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    let needle_eq = name.to_string();
    let mut search_from = 0usize;
    loop {
        let idx = lower[search_from..].find(&needle_eq)?;
        let pos = search_from + idx;
        let prev_ok = pos == 0 || !body.as_bytes()[pos - 1].is_ascii_alphanumeric();
        let after = pos + needle_eq.len();
        let mut j = after;
        while j < body.len() && body.as_bytes()[j].is_ascii_whitespace() { j += 1; }
        if prev_ok && j < body.len() && body.as_bytes()[j] == b'=' {
            j += 1;
            while j < body.len() && body.as_bytes()[j].is_ascii_whitespace() { j += 1; }
            return Some(read_brace_or_quoted(body, j));
        }
        search_from = pos + needle_eq.len();
        if search_from >= lower.len() { return None; }
    }
}

fn read_brace_or_quoted(body: &str, start: usize) -> String {
    let bytes = body.as_bytes();
    if start >= bytes.len() { return String::new(); }
    match bytes[start] {
        b'{' => {
            let mut depth = 1i32;
            let mut i = start + 1;
            while i < bytes.len() && depth > 0 {
                match bytes[i] {
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    _ => {}
                }
                if depth == 0 { break; }
                i += 1;
            }
            clean_value(&body[(start + 1)..i])
        }
        b'"' => {
            let mut i = start + 1;
            while i < bytes.len() && bytes[i] != b'"' { i += 1; }
            clean_value(&body[(start + 1)..i])
        }
        _ => {
            let mut i = start;
            while i < bytes.len() && bytes[i] != b',' && bytes[i] != b'}' && bytes[i] != b'\n' {
                i += 1;
            }
            clean_value(body[start..i].trim())
        }
    }
}

fn clean_value(s: &str) -> String {
    let trimmed = s.trim();
    let stripped = trimmed.trim_matches(|c| c == '{' || c == '}');
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

//! Bounded, degradation-friendly BibTeX entry parser.
//!
//! It extracts the metadata Clavis needs for search and citation UX without
//! pretending to evaluate the full BibTeX macro language. Malformed entries are
//! skipped independently so one bad record does not discard the library.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const MAX_BIB_FILES: usize = 200;
const MAX_BIB_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_BIB_ENTRIES: usize = 100_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibEntry {
    pub key: String,
    pub entry_type: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub editor: Option<String>,
    pub year: Option<String>,
    pub journal: Option<String>,
    pub booktitle: Option<String>,
    pub publisher: Option<String>,
    pub doi: Option<String>,
    pub url: Option<String>,
    pub abstract_text: Option<String>,
    pub keywords: Vec<String>,
    pub volume: Option<String>,
    pub number: Option<String>,
    pub pages: Option<String>,
    pub source_file: String,
    pub source_line: u32,
    pub source_end_line: u32,
}

#[derive(Deserialize)]
pub struct BibDocument {
    pub path: String,
    pub content: String,
}

/// Parse editor snapshots with the same parser as the bibliography browser.
/// Reject incomplete requests rather than reporting unparsed keys as missing.
pub fn parse_bib_documents(documents: Vec<BibDocument>) -> Result<Vec<BibEntry>, String> {
    if documents.len() > MAX_BIB_FILES {
        return Err("Too many bibliography files to parse".into());
    }
    let mut out = Vec::new();
    for document in documents {
        if document.content.len() as u64 > MAX_BIB_FILE_BYTES {
            return Err("Bibliography file exceeds the parsing limit".into());
        }
        parse_bib_text(&document.content, &document.path, &mut out);
        if out.len() > MAX_BIB_ENTRIES {
            return Err("Too many bibliography entries to parse".into());
        }
    }
    Ok(out)
}

pub fn parse_bib_files(bib_paths: Vec<String>) -> Vec<BibEntry> {
    let mut out = Vec::new();
    for path in bib_paths.into_iter().take(MAX_BIB_FILES) {
        if out.len() >= MAX_BIB_ENTRIES {
            break;
        }
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_BIB_FILE_BYTES {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        parse_bib_text(&text, &path, &mut out);
        out.truncate(MAX_BIB_ENTRIES);
    }
    out
}

fn parse_bib_text(text: &str, source: &str, out: &mut Vec<BibEntry>) {
    let bytes = text.as_bytes();
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        let Some(relative) = bytes[cursor..].iter().position(|byte| *byte == b'@') else {
            break;
        };
        let entry_start = cursor + relative;
        let mut index = entry_start + 1;
        let type_start = index;
        while index < bytes.len() && (bytes[index] as char).is_ascii_alphabetic() {
            index += 1;
        }
        let entry_type = text[type_start..index].to_ascii_lowercase();
        if entry_type.is_empty() {
            cursor = entry_start + 1;
            continue;
        }
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let Some(&open) = bytes.get(index) else {
            break;
        };
        if !matches!(open, b'{' | b'(') {
            cursor = entry_start + 1;
            continue;
        }
        let close = if open == b'{' { b'}' } else { b')' };
        let Some(entry_end) = find_entry_end(bytes, index, close) else {
            // Do not let one unclosed entry consume later valid entries.
            cursor = entry_start + 1;
            continue;
        };
        cursor = entry_end + 1;
        if matches!(entry_type.as_str(), "comment" | "preamble" | "string") {
            continue;
        }

        index += 1;
        while index < entry_end && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let key_start = index;
        while index < entry_end && !matches!(bytes[index], b',' | b'\n' | b'\r') {
            index += 1;
        }
        if bytes.get(index) != Some(&b',') {
            continue;
        }
        let key = text[key_start..index].trim().to_string();
        if key.is_empty() {
            continue;
        }
        let fields = parse_fields(&text[index + 1..entry_end]);
        let source_line = line_at(text, entry_start);
        let source_end_line = line_at(text, entry_end);
        out.push(BibEntry {
            key,
            entry_type,
            title: field(&fields, "title"),
            author: field(&fields, "author"),
            editor: field(&fields, "editor"),
            year: field(&fields, "year").or_else(|| field(&fields, "date")),
            journal: field(&fields, "journal").or_else(|| field(&fields, "journaltitle")),
            booktitle: field(&fields, "booktitle"),
            publisher: field(&fields, "publisher"),
            doi: field(&fields, "doi").map(normalize_doi),
            url: field(&fields, "url"),
            abstract_text: field(&fields, "abstract"),
            keywords: field(&fields, "keywords")
                .map(|value| {
                    value
                        .split(|ch| ch == ',' || ch == ';')
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            volume: field(&fields, "volume"),
            number: field(&fields, "number").or_else(|| field(&fields, "issue")),
            pages: field(&fields, "pages"),
            source_file: source.to_string(),
            source_line,
            source_end_line,
        });
    }
}

fn at_indented_line_start(bytes: &[u8], index: usize) -> bool {
    let line_start = bytes[..index]
        .iter()
        .rposition(|byte| matches!(*byte, b'\n' | b'\r'))
        .map_or(0, |position| position + 1);
    bytes[line_start..index]
        .iter()
        .all(|byte| byte.is_ascii_whitespace())
}

fn find_entry_end(bytes: &[u8], open_at: usize, close: u8) -> Option<usize> {
    let mut brace_depth = 0i32;
    let mut in_quote = false;
    let mut index = open_at + 1;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\\' {
            index += 2;
            continue;
        }
        // Quotes inside a braced value (e.g. TeX accents) are ordinary text.
        if byte == b'"' && brace_depth == 0 {
            in_quote = !in_quote;
        } else if byte == b'{' {
            brace_depth += 1;
        } else if byte == b'}' && brace_depth > 0 {
            brace_depth -= 1;
        } else if !in_quote && brace_depth == 0 {
            if byte == close {
                return Some(index);
            }
            // Recover at the next entry rather than swallowing valid records.
            if byte == b'@' && at_indented_line_start(bytes, index) {
                return None;
            }
        }
        index += 1;
    }
    None
}

fn parse_fields(body: &str) -> BTreeMap<String, String> {
    let bytes = body.as_bytes();
    let mut fields = BTreeMap::new();
    let mut index = 0usize;
    while index < bytes.len() {
        while index < bytes.len() && (bytes[index].is_ascii_whitespace() || bytes[index] == b',') {
            index += 1;
        }
        let name_start = index;
        while index < bytes.len()
            && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'_' | b'-'))
        {
            index += 1;
        }
        if name_start == index {
            index += 1;
            continue;
        }
        let name = body[name_start..index].to_ascii_lowercase();
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if bytes.get(index) != Some(&b'=') {
            while index < bytes.len() && bytes[index] != b',' {
                index += 1;
            }
            continue;
        }
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let (value, next) = read_value(body, index);
        index = next;
        if !value.is_empty() {
            fields.insert(name, clean_value(&value));
        }
        // Full BibTeX string concatenation requires macro evaluation. Consume
        // unsupported tails safely rather than treating them as another field.
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if bytes.get(index) == Some(&b'#') {
            while index < bytes.len() && bytes[index] != b',' {
                index += 1;
            }
        }
    }
    fields
}

fn read_value(body: &str, start: usize) -> (String, usize) {
    let bytes = body.as_bytes();
    if start >= bytes.len() {
        return (String::new(), start);
    }
    match bytes[start] {
        b'{' => {
            let mut depth = 1i32;
            let mut index = start + 1;
            while index < bytes.len() && depth > 0 {
                if bytes[index] == b'\\' {
                    index += 2;
                    continue;
                }
                if bytes[index] == b'{' {
                    depth += 1;
                } else if bytes[index] == b'}' {
                    depth -= 1;
                    if depth == 0 {
                        return (body[start + 1..index].to_string(), index + 1);
                    }
                }
                index += 1;
            }
            (body[start + 1..].to_string(), bytes.len())
        }
        b'"' => {
            let mut index = start + 1;
            let mut depth = 0i32;
            while index < bytes.len() {
                match bytes[index] {
                    b'\\' => { index += 2; continue; }
                    b'{' => depth += 1,
                    b'}' if depth > 0 => depth -= 1,
                    b'"' if depth == 0 => {
                        return (body[start + 1..index].to_string(), index + 1);
                    }
                    _ => {}
                }
                index += 1;
            }
            (body[start + 1..].to_string(), bytes.len())
        }
        _ => {
            let mut index = start;
            while index < bytes.len() && !matches!(bytes[index], b',' | b'#' | b'\n' | b'\r') {
                index += 1;
            }
            (body[start..index].trim().to_string(), index)
        }
    }
}

fn field(fields: &BTreeMap<String, String>, name: &str) -> Option<String> {
    fields.get(name).filter(|value| !value.is_empty()).cloned()
}

fn normalize_doi(value: String) -> String {
    value
        .trim()
        .trim_start_matches("https://doi.org/")
        .trim_start_matches("http://doi.org/")
        .trim_start_matches("doi:")
        .trim()
        .to_string()
}

fn line_at(text: &str, offset: usize) -> u32 {
    text[..offset.min(text.len())]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count() as u32
        + 1
}

fn clean_value(value: &str) -> String {
    // Do not partially interpret TeX commands/accents and lose information.
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' && !matches!(chars.next(), Some('&' | '_' | '%')) {
            return value.split_whitespace().collect::<Vec<_>>().join(" ");
        }
    }
    let stripped: String = value
        .chars()
        .filter(|character| *character != '{' && *character != '}')
        .collect();
    stripped
        .replace("\\&", "&")
        .replace("\\_", "_")
        .replace("\\%", "%")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Vec<BibEntry> {
        let mut out = Vec::new();
        parse_bib_text(text, "test.bib", &mut out);
        out
    }

    #[test]
    fn parses_rich_metadata_and_normalizes_doi() {
        let entries = parse(
            r#"@article{smith2020,
            title = {A Study of {Things}},
            author = "Smith, John and Doe, Jane",
            journaltitle = {Economic Journal},
            year = 2020,
            doi = {https://doi.org/10.1000/test},
            url = {https://example.test},
            abstract = {A useful abstract.},
            keywords = {labor; minimum wage, policy},
            volume = 12, number = 3, pages = {10--20}
        }"#,
        );
        let entry = &entries[0];
        assert_eq!(entry.title.as_deref(), Some("A Study of Things"));
        assert_eq!(entry.journal.as_deref(), Some("Economic Journal"));
        assert_eq!(entry.doi.as_deref(), Some("10.1000/test"));
        assert_eq!(entry.keywords, ["labor", "minimum wage", "policy"]);
        assert_eq!(entry.volume.as_deref(), Some("12"));
        assert_eq!(entry.source_line, 1);
        assert_eq!(entry.source_end_line, 11);
    }

    #[test]
    fn supports_parenthesized_entries_and_escaped_quotes() {
        let entries = parse(
            r#"@book(key,
          title = "A \"quoted\" title",
          publisher = {Press}
        )"#,
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "key");
        assert!(entries[0].title.as_deref().unwrap().contains("quoted"));
        assert_eq!(entries[0].publisher.as_deref(), Some("Press"));
    }

    #[test]
    fn skips_comment_preamble_string_entries() {
        let entries = parse(
            r#"@comment{ignored}
            @string{acm = "ACM"}
            @preamble{"\\newcommand"}
            @book{real, title = {Real}}"#,
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "real");
    }

    #[test]
    fn malformed_entry_does_not_hide_later_valid_entry() {
        let entries = parse("@article{broken, title={oops}\n   @book{good, title={Good}}");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "good");
        assert_eq!(entries[0].title.as_deref(), Some("Good"));
        assert_eq!(entries[0].source_line, 2);
    }

    #[test]
    fn field_substrings_are_not_matched() {
        let entries = parse(r#"@misc{k, yearbook = {nope}, year = {2010}}"#);
        assert_eq!(entries[0].year.as_deref(), Some("2010"));
    }

    #[test]
    fn date_falls_back_for_year() {
        let entries = parse(r#"@misc{k, date = {2023-05-01}}"#);
        assert_eq!(entries[0].year.as_deref(), Some("2023-05-01"));
    }

    #[test]
    fn editor_snapshots_use_the_same_parser_without_reading_disk() {
        let source = "@article(key, title={Existing paper}, author={{World Health Organization}}, year=2024)";
        let entries = parse_bib_documents(vec![BibDocument {
            path: "/unsaved/refs.bib".into(), content: source.into(),
        }]).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, parse(source)[0].title);
        assert_eq!(entries[0].author.as_deref(), Some("World Health Organization"));
        assert_eq!(entries[0].source_file, "/unsaved/refs.bib");
    }

    #[test]
    fn quoted_tex_accents_are_not_truncated_or_partially_rewritten() {
        let entries = parse(r#"@article(key, title="M{\"u}ller study", year=2024)
@book{other, title="A {"grouped"} title", author={{Research and Development, Inc.}}}"#);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].title.as_deref(), Some(r#"M{\"u}ller study"#));
        assert_eq!(entries[0].year.as_deref(), Some("2024"));
        assert_eq!(entries[1].title.as_deref(), Some("A \"grouped\" title"));
        assert_eq!(entries[1].author.as_deref(), Some("Research and Development, Inc."));
    }

    #[test]
    fn braces_quotes_and_parentheses_do_not_end_a_value_early() {
        let entries = parse(r#"@book(key, title={An "unfinished quote (inside)}, year=2024)
@book{next, title={An escaped \} brace}, year=2025}"#);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].title.as_deref(), Some("An \"unfinished quote (inside)"));
        assert_eq!(entries[0].year.as_deref(), Some("2024"));
        assert_eq!(entries[1].title.as_deref(), Some(r"An escaped \} brace"));
        assert_eq!(entries[1].year.as_deref(), Some("2025"));
    }

    #[test]
    fn too_many_snapshots_report_failure_instead_of_missing_keys() {
        let documents = (0..=MAX_BIB_FILES).map(|i| BibDocument {
            path: format!("{i}.bib"), content: "@book(key, title={Report})".into(),
        }).collect();
        assert!(parse_bib_documents(documents).is_err());
    }

    #[test]
    fn keeps_existing_plain_text_escape_decoding() {
        let entries = parse(r"@book{key, title={Research \& Development}, doi={10.1000/foo\_bar}, author={{Company}}, year=2024}");
        assert_eq!(entries[0].title.as_deref(), Some("Research & Development"));
        assert_eq!(entries[0].doi.as_deref(), Some("10.1000/foo_bar"));
    }

}

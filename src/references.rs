//! Cross-language academic reference and citation index.
//!
//! LaTeX and Typst receive full label/citation coverage. Markdown stays
//! intentionally narrow: heading/explicit anchors, local fragment links,
//! Pandoc citations, and Quarto cross-references.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use typst_syntax::ast::Arg;
use typst_syntax::{LinkedNode, SyntaxKind};

const MAX_FILES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_OCCURRENCES: usize = 50_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOverride {
    pub path: String,
    pub language: String,
    pub text: String,
    #[serde(default)]
    pub is_dirty: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceIndexOptions {
    pub root: String,
    #[serde(default)]
    pub documents: Vec<DocumentOverride>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceOccurrence {
    pub key: String,
    pub namespace: String,
    pub role: String,
    pub language: String,
    pub path: String,
    pub relative_path: String,
    pub line: u32,
    pub column: u32,
    pub start: usize,
    pub end: usize,
    pub fingerprint: String,
    pub renameable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceDiagnostic {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub key: String,
    pub namespace: String,
    pub path: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceIndexResult {
    pub occurrences: Vec<ReferenceOccurrence>,
    pub diagnostics: Vec<ReferenceDiagnostic>,
    pub scanned_files: usize,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameReferenceOptions {
    pub root: String,
    #[serde(default)]
    pub documents: Vec<DocumentOverride>,
    pub namespace: String,
    pub old_key: String,
    pub new_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameFilePreview {
    pub path: String,
    pub relative_path: String,
    pub language: String,
    pub occurrences: usize,
    pub first_line: u32,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameReferencePreview {
    pub namespace: String,
    pub old_key: String,
    pub new_key: String,
    pub total_occurrences: usize,
    pub files: Vec<RenameFilePreview>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRenameOptions {
    pub root: String,
    pub namespace: String,
    pub old_key: String,
    pub new_key: String,
    pub fingerprints: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRenameResult {
    pub changed_files: Vec<String>,
    pub replacements: usize,
}

#[derive(Clone)]
struct SourceDoc {
    path: PathBuf,
    language: &'static str,
    text: String,
    is_dirty: bool,
}

#[derive(Clone)]
struct RawOccurrence {
    key: String,
    namespace: &'static str,
    role: &'static str,
    start: usize,
    end: usize,
    renameable: bool,
}

fn fingerprint(text: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}:{}", hasher.finish(), text.len())
}

fn portable(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("workspace not found: {e}"))?;
    if !root.is_dir() {
        return Err("workspace root is not a directory".to_string());
    }
    Ok(root)
}

fn language_for(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "tex" | "ltx" => Some("latex"),
        "typ" => Some("typst"),
        "md" | "qmd" => Some("markdown"),
        "bib" => Some("bibtex"),
        _ => None,
    }
}

fn skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".svn"
            | ".hg"
            | "node_modules"
            | "target"
            | "dist"
            | "__pycache__"
            | ".venv"
            | "venv"
    )
}

fn collect_sources(
    root: &Path,
    overrides: Vec<DocumentOverride>,
) -> Result<(Vec<SourceDoc>, bool), String> {
    let mut override_map = HashMap::new();
    for doc in overrides {
        let path = std::fs::canonicalize(&doc.path).unwrap_or_else(|_| PathBuf::from(&doc.path));
        if path.starts_with(root) {
            override_map.insert(portable(&path), doc);
        }
    }

    let mut docs = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut truncated = false;
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        for entry in entries.flatten() {
            let ty = match entry.file_type() {
                Ok(ty) => ty,
                Err(_) => continue,
            };
            if ty.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if ty.is_dir() {
                if !skip_dir(&name) {
                    stack.push(entry.path());
                }
                continue;
            }
            if !ty.is_file() || docs.len() >= MAX_FILES {
                truncated = docs.len() >= MAX_FILES;
                continue;
            }
            let path = entry.path();
            let Some(language) = language_for(&path) else {
                continue;
            };
            if entry.metadata().is_ok_and(|m| m.len() > MAX_FILE_BYTES) {
                continue;
            }
            let canonical = std::fs::canonicalize(&path).unwrap_or(path);
            let key = portable(&canonical);
            let override_doc = override_map.remove(&key);
            let is_dirty = override_doc.as_ref().is_some_and(|doc| doc.is_dirty);
            let language = override_doc
                .as_ref()
                .and_then(|doc| match doc.language.as_str() {
                    "latex" => Some("latex"),
                    "typst" => Some("typst"),
                    "markdown" => Some("markdown"),
                    _ => None,
                })
                .unwrap_or(language);
            let text = if let Some(doc) = override_doc {
                doc.text
            } else {
                match std::fs::read_to_string(&canonical) {
                    Ok(text) => text,
                    Err(_) => continue,
                }
            };
            docs.push(SourceDoc {
                path: canonical,
                language,
                text,
                is_dirty,
            });
        }
    }
    Ok((docs, truncated))
}

fn blank_range(bytes: &mut [u8], start: usize, end: usize) {
    for byte in &mut bytes[start..end] {
        if *byte != b'\n' && *byte != b'\r' {
            *byte = b' ';
        }
    }
}

fn latex_mask(text: &str) -> String {
    let mut bytes = text.as_bytes().to_vec();
    let source = text.as_bytes();
    let mut i = 0;
    while i < source.len() {
        if source[i] == b'%' {
            let slashes = source[..i]
                .iter()
                .rev()
                .take_while(|b| **b == b'\\')
                .count();
            if slashes % 2 == 0 {
                let end = text[i..].find('\n').map_or(source.len(), |x| i + x);
                blank_range(&mut bytes, i, end);
                i = end;
                continue;
            }
        }
        i += 1;
    }
    let mut masked = String::from_utf8(bytes).unwrap();
    let verbatim = Regex::new(r"(?s)\\begin\{(?:verbatim\*?|lstlisting|minted)\}.*?\\end\{(?:verbatim\*?|lstlisting|minted)\}").unwrap();
    let ranges: Vec<_> = verbatim
        .find_iter(&masked)
        .map(|m| (m.start(), m.end()))
        .collect();
    unsafe {
        let bytes = masked.as_bytes_mut();
        for (start, end) in ranges {
            blank_range(bytes, start, end);
        }
    }
    let verb = Regex::new(r"\\verb\*?(?s:.)(?s:.*?)").unwrap();
    // `\\verb` delimiters are arbitrary; handle them with a small byte scan.
    let source = masked.as_bytes().to_vec();
    unsafe {
        let out = masked.as_bytes_mut();
        let mut cursor = 0;
        while let Some(pos) = source[cursor..].windows(5).position(|w| w == b"\\verb") {
            let start = cursor + pos;
            let mut delim_at = start + 5;
            if source.get(delim_at) == Some(&b'*') {
                delim_at += 1;
            }
            let Some(&delim) = source.get(delim_at) else {
                break;
            };
            if delim.is_ascii_whitespace() {
                cursor = delim_at + 1;
                continue;
            }
            let end = source[delim_at + 1..]
                .iter()
                .position(|b| *b == delim)
                .map_or(source.len(), |x| delim_at + 2 + x);
            blank_range(out, start, end);
            cursor = end;
        }
    }
    let _ = verb;
    masked
}

fn markdown_mask(text: &str) -> String {
    let mut bytes = text.as_bytes().to_vec();
    let fence = Regex::new(r"(?ms)^\s*(```+|~~~+).*?^\s*(?:```+|~~~+)\s*$").unwrap();
    for hit in fence.find_iter(text) {
        blank_range(&mut bytes, hit.start(), hit.end());
    }
    let inline = Regex::new(r"`+[^\n]*?`+").unwrap();
    for hit in inline.find_iter(text) {
        blank_range(&mut bytes, hit.start(), hit.end());
    }
    String::from_utf8(bytes).unwrap()
}

fn captures(
    pattern: &str,
    text: &str,
    namespace: &'static str,
    role: &'static str,
    group: usize,
) -> Vec<RawOccurrence> {
    let re = Regex::new(pattern).unwrap();
    re.captures_iter(text)
        .filter_map(|cap| {
            let hit = cap.get(group)?;
            let key = hit.as_str().trim();
            (!key.is_empty()).then(|| RawOccurrence {
                key: key.to_string(),
                namespace,
                role,
                start: hit.start(),
                end: hit.end(),
                renameable: true,
            })
        })
        .collect()
}

fn split_group_keys(group: regex::Match<'_>, namespace: &'static str) -> Vec<RawOccurrence> {
    let mut out = Vec::new();
    let mut cursor = 0;
    for part in group.as_str().split(',') {
        let trimmed = part.trim();
        let leading = part.len() - part.trim_start().len();
        if !trimmed.is_empty() {
            let start = group.start() + cursor + leading;
            out.push(RawOccurrence {
                key: trimmed.to_string(),
                namespace,
                role: "usage",
                start,
                end: start + trimmed.len(),
                renameable: true,
            });
        }
        cursor += part.len() + 1;
    }
    out
}

fn scan_latex(text: &str) -> Vec<RawOccurrence> {
    let text = latex_mask(text);
    let mut out = captures(r"\\label\s*\{([^{}]+)\}", &text, "label", "definition", 1);
    let references =
        Regex::new(r"\\(?:ref|eqref|pageref|autoref|cref|Cref|vref)\*?\s*\{([^{}]+)\}").unwrap();
    for cap in references.captures_iter(&text) {
        if let Some(group) = cap.get(1) {
            out.extend(split_group_keys(group, "label"));
        }
    }
    let citations = Regex::new(r"\\(?:cite|citep|citet|autocite|parencite|textcite|footcite|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]+)\}").unwrap();
    for cap in citations.captures_iter(&text) {
        if let Some(group) = cap.get(1) {
            out.extend(split_group_keys(group, "citation"));
        }
    }
    out
}

fn scan_bib(text: &str) -> Vec<RawOccurrence> {
    let entry = Regex::new(r"(?mi)@([A-Za-z]+)\s*[\{(]\s*([^,\s}()]+)").unwrap();
    entry
        .captures_iter(text)
        .filter_map(|cap| {
            let kind = cap.get(1)?.as_str().to_ascii_lowercase();
            if matches!(kind.as_str(), "comment" | "string" | "preamble") {
                return None;
            }
            let key = cap.get(2)?;
            Some(RawOccurrence {
                key: key.as_str().to_string(),
                namespace: "citation",
                role: "definition",
                start: key.start(),
                end: key.end(),
                renameable: true,
            })
        })
        .collect()
}

fn static_typst_key(node: &LinkedNode<'_>) -> Option<(String, usize, usize, bool)> {
    match node.kind() {
        SyntaxKind::Str => {
            let raw = node.get().text();
            if raw.len() < 2 {
                return None;
            }
            let key = node
                .get()
                .cast::<typst_syntax::ast::Str>()?
                .get()
                .to_string();
            Some((
                key,
                node.offset() + 1,
                node.range().end - 1,
                !raw[1..raw.len() - 1].contains('\\'),
            ))
        }
        SyntaxKind::Label => {
            let raw = node.get().text();
            (raw.len() >= 2).then(|| {
                (
                    raw[1..raw.len() - 1].to_string(),
                    node.offset() + 1,
                    node.range().end - 1,
                    true,
                )
            })
        }
        SyntaxKind::FuncCall => {
            let callee = node
                .children()
                .find(|child| child.kind() == SyntaxKind::Ident)?;
            if callee.get().text().as_str() != "label" {
                return None;
            }
            let args = node
                .children()
                .find(|child| child.kind() == SyntaxKind::Args)?;
            for child in args.children() {
                let Some(Arg::Pos(_)) = child.get().cast::<Arg>() else {
                    continue;
                };
                if let Some(key) = static_typst_key(&child) {
                    return Some(key);
                }
            }
            None
        }
        _ => None,
    }
}

fn typst_call_occurrences(node: &LinkedNode<'_>) -> Option<Vec<RawOccurrence>> {
    let callee = node
        .children()
        .find(|child| child.kind() == SyntaxKind::Ident)?;
    let (namespace, variadic) = match callee.get().text().as_str() {
        "ref" => ("label", false),
        "cite" => ("citation", true),
        // `label("x")` constructs a label value. It does not attach that label
        // to a document element and therefore is not a definition by itself.
        _ => return None,
    };
    let args = node
        .children()
        .find(|child| child.kind() == SyntaxKind::Args)?;
    let mut keys = Vec::new();
    for child in args.children() {
        let Some(Arg::Pos(_)) = child.get().cast::<Arg>() else {
            continue;
        };
        if let Some((key, start, end, renameable)) = static_typst_key(&child) {
            keys.push(RawOccurrence {
                key,
                namespace,
                role: "usage",
                start,
                end,
                renameable,
            });
        }
        if !variadic && !keys.is_empty() {
            break;
        }
    }
    Some(keys)
}

fn walk_typst(node: LinkedNode<'_>, out: &mut Vec<RawOccurrence>) {
    match node.kind() {
        SyntaxKind::Label => {
            let raw = node.get().text();
            if raw.len() >= 2 {
                out.push(RawOccurrence {
                    key: raw[1..raw.len() - 1].to_string(),
                    namespace: "label",
                    role: "definition",
                    start: node.offset() + 1,
                    end: node.range().end - 1,
                    renameable: true,
                });
            }
        }
        SyntaxKind::Ref => {
            if let Some(marker) = node
                .children()
                .find(|child| child.kind() == SyntaxKind::RefMarker)
            {
                let raw = marker.get().text();
                if raw.len() >= 2 {
                    out.push(RawOccurrence {
                        key: raw[1..].to_string(),
                        namespace: "unresolved",
                        role: "usage",
                        start: marker.offset() + 1,
                        end: marker.range().end,
                        renameable: true,
                    });
                }
            }
        }
        SyntaxKind::FuncCall => {
            if let Some(items) = typst_call_occurrences(&node) {
                out.extend(items);
                return;
            }
        }
        _ => {}
    }
    for child in node.children() {
        walk_typst(child, out);
    }
}

fn scan_typst(text: &str) -> Vec<RawOccurrence> {
    let root = typst_syntax::parse(text);
    let mut out = Vec::new();
    walk_typst(LinkedNode::new(&root), &mut out);
    out
}

fn slugify_heading(raw: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in raw.trim().to_lowercase().chars() {
        if ch.is_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
            dash = false;
        } else if ch.is_whitespace() && !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn scan_markdown(text: &str) -> Vec<RawOccurrence> {
    let masked = markdown_mask(text);
    let mut out = Vec::new();
    let heading = Regex::new(r"(?m)^#{1,6}\s+(.+?)\s*$").unwrap();
    let explicit = Regex::new(r"\{#([A-Za-z0-9_.:-]+)\}\s*$").unwrap();
    for cap in heading.captures_iter(&masked) {
        let whole = cap.get(1).unwrap();
        if let Some(id) = explicit.captures(whole.as_str()).and_then(|c| c.get(1)) {
            out.push(RawOccurrence {
                key: id.as_str().to_string(),
                namespace: "label",
                role: "definition",
                start: whole.start() + id.start(),
                end: whole.start() + id.end(),
                renameable: true,
            });
        } else {
            let key = slugify_heading(whole.as_str());
            if !key.is_empty() {
                out.push(RawOccurrence {
                    key,
                    namespace: "label",
                    role: "definition",
                    start: whole.start(),
                    end: whole.end(),
                    renameable: false,
                });
            }
        }
    }
    out.extend(captures(
        r"\]\(#([A-Za-z0-9_.:-]+)\)",
        &masked,
        "label",
        "usage",
        1,
    ));
    let citations = Regex::new(r"(?m)(?:^|\[|\s)@([A-Za-z][A-Za-z0-9_.:-]*)").unwrap();
    for cap in citations.captures_iter(&masked) {
        let hit = cap.get(1).unwrap();
        let key = hit.as_str();
        let namespace = if key.starts_with("fig-")
            || key.starts_with("tbl-")
            || key.starts_with("eq-")
            || key.starts_with("sec-")
            || key.starts_with("lst-")
        {
            "label"
        } else {
            "citation"
        };
        out.push(RawOccurrence {
            key: key.to_string(),
            namespace,
            role: "usage",
            start: hit.start(),
            end: hit.end(),
            renameable: true,
        });
    }
    out
}

fn line_column(text: &str, offset: usize) -> (u32, u32) {
    let before = &text[..offset.min(text.len())];
    let line = before.bytes().filter(|b| *b == b'\n').count() as u32 + 1;
    let column = before
        .rsplit_once('\n')
        .map_or(before, |(_, tail)| tail)
        .chars()
        .count() as u32
        + 1;
    (line, column)
}

fn build_index(root: &Path, docs: Vec<SourceDoc>, truncated: bool) -> ReferenceIndexResult {
    let scanned_files = docs.len();
    let mut raw_docs = Vec::new();
    let mut label_defs = HashSet::new();
    let mut cite_defs = HashSet::new();
    for doc in docs {
        let raw = match doc.language {
            "latex" => scan_latex(&doc.text),
            "typst" => scan_typst(&doc.text),
            "markdown" => scan_markdown(&doc.text),
            "bibtex" => scan_bib(&doc.text),
            _ => Vec::new(),
        };
        for occurrence in &raw {
            if occurrence.role == "definition" {
                if occurrence.namespace == "label" {
                    label_defs.insert(occurrence.key.clone());
                }
                if occurrence.namespace == "citation" {
                    cite_defs.insert(occurrence.key.clone());
                }
            }
        }
        raw_docs.push((doc, raw));
    }

    let mut occurrences = Vec::new();
    let mut diagnostics = Vec::new();
    for (doc, raw) in raw_docs {
        let hash = fingerprint(&doc.text);
        for mut item in raw {
            if item.namespace == "unresolved" {
                let label = label_defs.contains(&item.key);
                let citation = cite_defs.contains(&item.key);
                item.namespace = if citation && !label {
                    "citation"
                } else if label && !citation {
                    "label"
                } else if label && citation {
                    "ambiguous"
                } else {
                    "unresolved"
                };
                if label && citation {
                    let (line, _) = line_column(&doc.text, item.start);
                    diagnostics.push(ReferenceDiagnostic {
                        code: "ambiguous-typst-at".into(),
                        severity: "warning".into(),
                        message: format!(
                            "Typst @{} matches both a label and a bibliography key",
                            item.key
                        ),
                        key: item.key.clone(),
                        namespace: "ambiguous".into(),
                        path: Some(portable(&doc.path)),
                        line: Some(line),
                    });
                }
            }
            let (line, column) = line_column(&doc.text, item.start);
            occurrences.push(ReferenceOccurrence {
                key: item.key,
                namespace: item.namespace.into(),
                role: item.role.into(),
                language: doc.language.into(),
                path: portable(&doc.path),
                relative_path: portable(doc.path.strip_prefix(root).unwrap_or(&doc.path)),
                line,
                column,
                start: item.start,
                end: item.end,
                fingerprint: hash.clone(),
                renameable: item.renameable,
            });
            if occurrences.len() >= MAX_OCCURRENCES {
                break;
            }
        }
        if occurrences.len() >= MAX_OCCURRENCES {
            break;
        }
    }
    let truncated = truncated || occurrences.len() >= MAX_OCCURRENCES;
    diagnostics.extend(index_diagnostics(&occurrences, truncated));
    ReferenceIndexResult {
        occurrences,
        diagnostics,
        scanned_files,
        truncated,
    }
}

fn index_diagnostics(items: &[ReferenceOccurrence], truncated: bool) -> Vec<ReferenceDiagnostic> {
    let mut diagnostics = Vec::new();
    let mut groups: BTreeMap<
        (String, String),
        (Vec<&ReferenceOccurrence>, Vec<&ReferenceOccurrence>),
    > = BTreeMap::new();
    for item in items {
        if item.namespace == "unresolved" {
            diagnostics.push(ReferenceDiagnostic {
                code: "unresolved-typst-at".into(),
                severity: "error".into(),
                message: format!(
                    "Typst @{} matches neither a label nor a bibliography key",
                    item.key
                ),
                key: item.key.clone(),
                namespace: item.namespace.clone(),
                path: Some(item.path.clone()),
                line: Some(item.line),
            });
            continue;
        }
        if item.namespace == "ambiguous" {
            continue;
        }
        let group = groups
            .entry((item.namespace.clone(), item.key.clone()))
            .or_default();
        if item.role == "definition" {
            group.0.push(item);
        } else {
            group.1.push(item);
        }
    }
    for ((namespace, key), (definitions, usages)) in groups {
        if definitions.len() > 1 {
            for item in &definitions {
                diagnostics.push(ReferenceDiagnostic {
                    code: format!("duplicate-{namespace}"),
                    severity: "error".into(),
                    message: format!("Duplicate {namespace} definition: {key}"),
                    key: key.clone(),
                    namespace: namespace.clone(),
                    path: Some(item.path.clone()),
                    line: Some(item.line),
                });
            }
        }
        if definitions.is_empty() {
            for item in usages {
                diagnostics.push(ReferenceDiagnostic {
                    code: format!("missing-{namespace}"),
                    severity: "error".into(),
                    message: format!("Missing {namespace}: {key}"),
                    key: key.clone(),
                    namespace: namespace.clone(),
                    path: Some(item.path.clone()),
                    line: Some(item.line),
                });
            }
        } else if usages.is_empty() && !truncated {
            let item = definitions[0];
            diagnostics.push(ReferenceDiagnostic {
                code: format!("unused-{namespace}"),
                severity: "warning".into(),
                message: format!("Unused {namespace}: {key}"),
                key,
                namespace,
                path: Some(item.path.clone()),
                line: Some(item.line),
            });
        }
    }
    diagnostics
}

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 256
        && key
            .chars()
            .all(|ch| ch.is_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':'))
}

fn rename_plan(
    options: RenameReferenceOptions,
) -> Result<(PathBuf, ReferenceIndexResult, Vec<SourceDoc>), String> {
    if !matches!(options.namespace.as_str(), "label" | "citation") {
        return Err("rename namespace must be label or citation".to_string());
    }
    if !valid_key(&options.old_key) || !valid_key(&options.new_key) {
        return Err(
            "reference keys may contain only letters, numbers, _, -, . and : (max 256 characters)"
                .to_string(),
        );
    }
    if options.old_key == options.new_key {
        return Err("new key is identical to the old key".to_string());
    }
    let root = canonical_root(&options.root)?;
    let (docs, truncated) = collect_sources(&root, options.documents)?;
    if truncated {
        return Err(
            "reference index is truncated; refine the workspace before renaming".to_string(),
        );
    }
    let result = build_index(&root, docs.clone(), false);
    if result.truncated {
        return Err("reference index is truncated; rename is disabled".to_string());
    }
    if result.occurrences.iter().any(|item| {
        item.namespace == options.namespace
            && item.key == options.new_key
            && item.role == "definition"
    }) {
        return Err(format!(
            "{} already exists: {}",
            options.namespace, options.new_key
        ));
    }
    let affected: Vec<_> = result
        .occurrences
        .iter()
        .filter(|item| item.namespace == options.namespace && item.key == options.old_key)
        .collect();
    if affected.is_empty() {
        return Err(format!(
            "{} not found: {}",
            options.namespace, options.old_key
        ));
    }
    if affected.iter().any(|item| !item.renameable) {
        return Err(
            "one or more occurrences cannot be renamed safely (generated anchor or escaped string)"
                .to_string(),
        );
    }
    let dirty: HashSet<_> = docs
        .iter()
        .filter(|doc| doc.is_dirty)
        .map(|doc| portable(&doc.path))
        .collect();
    if let Some(item) = affected.iter().find(|item| dirty.contains(&item.path)) {
        return Err(format!(
            "save the modified document before renaming: {}",
            item.path
        ));
    }
    Ok((root, result, docs))
}

fn preview_rename_sync(options: RenameReferenceOptions) -> Result<RenameReferencePreview, String> {
    let namespace = options.namespace.clone();
    let old_key = options.old_key.clone();
    let new_key = options.new_key.clone();
    let (_root, result, _docs) = rename_plan(options)?;
    let mut groups: BTreeMap<String, Vec<&ReferenceOccurrence>> = BTreeMap::new();
    for item in result
        .occurrences
        .iter()
        .filter(|item| item.namespace == namespace && item.key == old_key)
    {
        groups.entry(item.path.clone()).or_default().push(item);
    }
    let files = groups
        .into_iter()
        .map(|(path, items)| RenameFilePreview {
            path,
            relative_path: items[0].relative_path.clone(),
            language: items[0].language.clone(),
            occurrences: items.len(),
            first_line: items.iter().map(|item| item.line).min().unwrap_or(1),
            fingerprint: items[0].fingerprint.clone(),
        })
        .collect::<Vec<_>>();
    Ok(RenameReferencePreview {
        namespace,
        old_key,
        new_key,
        total_occurrences: files.iter().map(|file| file.occurrences).sum(),
        files,
    })
}

fn apply_rename_sync(options: ApplyRenameOptions) -> Result<ApplyRenameResult, String> {
    if !matches!(options.namespace.as_str(), "label" | "citation")
        || !valid_key(&options.old_key)
        || !valid_key(&options.new_key)
    {
        return Err("invalid reference rename request".to_string());
    }
    let root = canonical_root(&options.root)?;
    // Re-index from disk at apply time. Preview fingerprints must cover every
    // affected file and match the current content.
    let (docs, truncated) = collect_sources(&root, Vec::new())?;
    if truncated {
        return Err("reference index is truncated; rename is disabled".to_string());
    }
    for (path_text, expected) in &options.fingerprints {
        let doc = docs
            .iter()
            .find(|doc| portable(&doc.path) == *path_text)
            .ok_or_else(|| format!("rename preview file disappeared: {path_text}"))?;
        if &fingerprint(&doc.text) != expected {
            return Err(format!("file changed since rename preview: {path_text}"));
        }
    }
    let result = build_index(&root, docs.clone(), false);
    if result.occurrences.iter().any(|item| {
        item.namespace == options.namespace
            && item.key == options.new_key
            && item.role == "definition"
    }) {
        return Err(format!(
            "{} already exists: {}",
            options.namespace, options.new_key
        ));
    }
    let mut by_path: BTreeMap<String, Vec<&ReferenceOccurrence>> = BTreeMap::new();
    for item in result
        .occurrences
        .iter()
        .filter(|item| item.namespace == options.namespace && item.key == options.old_key)
    {
        if !item.renameable {
            return Err("one or more occurrences cannot be renamed safely".to_string());
        }
        by_path.entry(item.path.clone()).or_default().push(item);
    }
    if by_path.is_empty() {
        return Err(format!(
            "{} not found: {}",
            options.namespace, options.old_key
        ));
    }
    if by_path.len() != options.fingerprints.len()
        || by_path
            .keys()
            .any(|path| !options.fingerprints.contains_key(path))
    {
        return Err("rename preview is stale: affected file set changed".to_string());
    }

    let docs_by_path: HashMap<_, _> = docs
        .into_iter()
        .map(|doc| (portable(&doc.path), doc))
        .collect();
    let mut staged = Vec::new();
    let mut replacements = 0;
    for (path_text, mut items) in by_path {
        let doc = docs_by_path
            .get(&path_text)
            .ok_or_else(|| format!("missing indexed file: {path_text}"))?;
        let expected = options.fingerprints.get(&path_text).unwrap();
        if &fingerprint(&doc.text) != expected {
            return Err(format!("file changed since rename preview: {path_text}"));
        }
        items.sort_by_key(|item| std::cmp::Reverse(item.start));
        let mut next = doc.text.clone();
        for item in items {
            if next.get(item.start..item.end) != Some(options.old_key.as_str()) {
                return Err(format!(
                    "indexed occurrence changed: {path_text}:{}",
                    item.line
                ));
            }
            next.replace_range(item.start..item.end, &options.new_key);
            replacements += 1;
        }
        let path = doc.path.clone();
        let suffix = uuid::Uuid::new_v4();
        let temp = path.with_extension(format!("clavis-{suffix}.tmp"));
        let backup = path.with_extension(format!("clavis-{suffix}.bak"));
        std::fs::write(&temp, next.as_bytes()).map_err(|e| format!("{}: {e}", temp.display()))?;
        if let Ok(meta) = std::fs::metadata(&path) {
            let _ = std::fs::set_permissions(&temp, meta.permissions());
        }
        staged.push((path, temp, backup));
    }

    let mut installed: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (path, temp, backup) in &staged {
        if let Err(error) = std::fs::rename(path, backup) {
            rollback_rename(&installed);
            cleanup_rename_staged(&staged);
            return Err(format!("cannot prepare {}: {error}", path.display()));
        }
        if let Err(error) = std::fs::rename(temp, path) {
            let _ = std::fs::rename(backup, path);
            rollback_rename(&installed);
            cleanup_rename_staged(&staged);
            return Err(format!("cannot install {}: {error}", path.display()));
        }
        installed.push((path.clone(), backup.clone()));
    }
    let changed_files = installed.iter().map(|(path, _)| portable(path)).collect();
    for (_, backup) in installed {
        let _ = std::fs::remove_file(backup);
    }
    Ok(ApplyRenameResult {
        changed_files,
        replacements,
    })
}

fn cleanup_rename_staged(staged: &[(PathBuf, PathBuf, PathBuf)]) {
    for (_, temp, _) in staged {
        let _ = std::fs::remove_file(temp);
    }
}

fn rollback_rename(installed: &[(PathBuf, PathBuf)]) {
    for (path, backup) in installed.iter().rev() {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::rename(backup, path);
    }
}

#[tauri::command]
pub async fn preview_reference_rename(
    options: RenameReferenceOptions,
) -> Result<RenameReferencePreview, String> {
    tauri::async_runtime::spawn_blocking(move || preview_rename_sync(options))
        .await
        .map_err(|error| format!("rename preview worker failed: {error}"))?
}

#[tauri::command]
pub async fn apply_reference_rename(
    options: ApplyRenameOptions,
) -> Result<ApplyRenameResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_rename_sync(options))
        .await
        .map_err(|error| format!("rename worker failed: {error}"))?
}

fn index_sync(options: ReferenceIndexOptions) -> Result<ReferenceIndexResult, String> {
    let root = canonical_root(&options.root)?;
    let (docs, truncated) = collect_sources(&root, options.documents)?;
    Ok(build_index(&root, docs, truncated))
}

#[tauri::command]
pub async fn index_references(
    options: ReferenceIndexOptions,
) -> Result<ReferenceIndexResult, String> {
    tauri::async_runtime::spawn_blocking(move || index_sync(options))
        .await
        .map_err(|error| format!("reference index worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(path: &str, language: &'static str, text: &str) -> SourceDoc {
        SourceDoc {
            path: PathBuf::from(path),
            language,
            text: text.into(),
            is_dirty: false,
        }
    }

    #[test]
    fn bibtex_skips_non_entries_and_accepts_parentheses() {
        let raw = scan_bib(
            "@comment{ignored}\n@string{x=\"y\"}\n@preamble{z}\n@article(real, title={T})",
        );
        assert_eq!(
            raw.iter().map(|item| item.key.as_str()).collect::<Vec<_>>(),
            ["real"]
        );
    }

    #[test]
    fn latex_multi_reference_commands_split_keys() {
        let raw = scan_latex("\\cref{one, two}");
        assert!(raw.iter().any(|item| item.key == "one"));
        assert!(raw.iter().any(|item| item.key == "two"));
        assert!(!raw.iter().any(|item| item.key.contains(',')));
    }

    #[test]
    fn repeated_latex_cite_keys_keep_distinct_offsets() {
        let text = "\\cite{same, same}";
        let raw = scan_latex(text);
        let starts: Vec<_> = raw
            .iter()
            .filter(|item| item.key == "same")
            .map(|item| item.start)
            .collect();
        assert_eq!(starts.len(), 2);
        assert_ne!(starts[0], starts[1]);
        assert_eq!(&text[starts[0]..starts[0] + 4], "same");
        assert_eq!(&text[starts[1]..starts[1] + 4], "same");
    }

    #[test]
    fn latex_ignores_comments_verbatim_and_indexes_citations() {
        let raw = scan_latex("% \\label{ghost}\n\\label{real} \\ref{real} \\citep{a,b}\n\\begin{verbatim}\\ref{ghost}\\end{verbatim}");
        assert!(raw
            .iter()
            .any(|x| x.key == "real" && x.role == "definition"));
        assert_eq!(raw.iter().filter(|x| x.namespace == "citation").count(), 2);
        assert!(!raw.iter().any(|x| x.key == "ghost"));
    }

    #[test]
    fn typst_ignores_comments_strings_and_supports_explicit_calls() {
        let source =
            "// @ghost\n= Head <sec:x>\n@sec:x #cite(\"paper\") #let s = \"@string\" /* <nope> */";
        let raw = scan_typst(source);
        assert!(raw
            .iter()
            .any(|x| x.key == "sec:x" && x.role == "definition"));
        assert!(raw
            .iter()
            .any(|x| x.key == "paper" && x.namespace == "citation"));
        assert!(!raw
            .iter()
            .any(|x| x.key == "ghost" || x.key == "string" || x.key == "nope"));
    }

    #[test]
    fn typst_cite_reads_variadic_positional_keys_not_named_strings() {
        let raw = scan_typst("#cite(<one>, <two>, form: \"prose\")");
        let keys: Vec<_> = raw
            .iter()
            .filter(|item| item.namespace == "citation")
            .map(|item| item.key.as_str())
            .collect();
        assert_eq!(keys, ["one", "two"]);
        assert!(!raw.iter().any(|item| item.key == "prose"));
    }

    #[test]
    fn typst_escaped_static_strings_are_indexed_but_not_renameable() {
        let raw = scan_typst("#cite(\"paper\\u{2d}one\")");
        let item = raw
            .iter()
            .find(|item| item.namespace == "citation")
            .unwrap();
        assert_eq!(item.key, "paper-one");
        assert!(!item.renameable);
    }

    #[test]
    fn typst_label_constructor_is_not_a_definition() {
        let raw = scan_typst("#label(\"sec:x\") #ref(label(\"sec:x\"))");
        assert!(!raw.iter().any(|item| item.role == "definition"));
        assert!(raw
            .iter()
            .any(|item| item.key == "sec:x" && item.role == "usage"));
    }

    #[test]
    fn typst_label_arguments_are_usages_not_definitions() {
        let raw = scan_typst("#ref(<sec:x>) #cite(<paper>)");
        assert!(raw
            .iter()
            .any(|item| item.key == "sec:x" && item.role == "usage" && item.namespace == "label"));
        assert!(raw.iter().any(|item| item.key == "paper"
            && item.role == "usage"
            && item.namespace == "citation"));
        assert!(!raw.iter().any(|item| item.role == "definition"));
    }

    #[test]
    fn unresolved_typst_at_is_honestly_diagnosed() {
        let result = build_index(
            Path::new("/p"),
            vec![doc("/p/main.typ", "typst", "@unknown")],
            false,
        );
        assert!(result
            .diagnostics
            .iter()
            .any(|item| item.code == "unresolved-typst-at"));
        assert!(!result
            .diagnostics
            .iter()
            .any(|item| item.code == "missing-label"));
    }

    #[test]
    fn typst_at_resolves_against_project_labels_and_bib_keys() {
        let result = build_index(
            Path::new("/p"),
            vec![
                doc("/p/main.typ", "typst", "= H <sec:h>\n@sec:h @smith"),
                doc("/p/refs.bib", "bibtex", "@article{smith, title={T}}"),
            ],
            false,
        );
        assert!(result
            .occurrences
            .iter()
            .any(|x| x.key == "sec:h" && x.role == "usage" && x.namespace == "label"));
        assert!(result
            .occurrences
            .iter()
            .any(|x| x.key == "smith" && x.role == "usage" && x.namespace == "citation"));
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn markdown_citation_at_start_of_document_is_indexed() {
        let raw = scan_markdown("@smith argues this.");
        assert!(raw
            .iter()
            .any(|item| item.key == "smith" && item.namespace == "citation"));
    }

    #[test]
    fn markdown_indexes_headings_links_pandoc_and_quarto_but_not_code() {
        let raw = scan_markdown("# Intro\n[go](#intro) [@smith] @fig-plot\n```\n@ignored\n```");
        assert!(raw
            .iter()
            .any(|x| x.key == "intro" && x.role == "definition"));
        assert!(raw
            .iter()
            .any(|x| x.key == "smith" && x.namespace == "citation"));
        assert!(raw
            .iter()
            .any(|x| x.key == "fig-plot" && x.namespace == "label"));
        assert!(!raw.iter().any(|x| x.key == "ignored"));
    }

    #[test]
    fn rename_preview_rejects_dirty_and_collision() {
        let dir = tempfile::tempdir().unwrap();
        let main = dir.path().join("main.typ");
        std::fs::write(&main, "= A <old>\n@old\n= B <taken>").unwrap();
        let dirty = RenameReferenceOptions {
            root: portable(dir.path()),
            namespace: "label".into(),
            old_key: "old".into(),
            new_key: "new".into(),
            documents: vec![DocumentOverride {
                path: portable(&main),
                language: "typst".into(),
                text: "= A <old>\n@old".into(),
                is_dirty: true,
            }],
        };
        assert!(preview_rename_sync(dirty)
            .unwrap_err()
            .contains("save the modified"));
        let collision = RenameReferenceOptions {
            root: portable(dir.path()),
            namespace: "label".into(),
            old_key: "old".into(),
            new_key: "taken".into(),
            documents: vec![],
        };
        assert!(preview_rename_sync(collision)
            .unwrap_err()
            .contains("already exists"));
    }

    #[test]
    fn rename_applies_across_latex_typst_markdown_and_bib() {
        let dir = tempfile::tempdir().unwrap();
        let tex = dir.path().join("a.tex");
        let typ = dir.path().join("b.typ");
        let md = dir.path().join("c.qmd");
        let bib = dir.path().join("refs.bib");
        std::fs::write(&tex, "\\cite{old}").unwrap();
        std::fs::write(&typ, "#cite(\"old\")").unwrap();
        std::fs::write(&md, "[@old]").unwrap();
        std::fs::write(&bib, "@article{old, title={T}}").unwrap();
        let preview = preview_rename_sync(RenameReferenceOptions {
            root: portable(dir.path()),
            namespace: "citation".into(),
            old_key: "old".into(),
            new_key: "new".into(),
            documents: vec![],
        })
        .unwrap();
        assert_eq!(preview.total_occurrences, 4);
        let fingerprints = preview
            .files
            .into_iter()
            .map(|file| (file.path, file.fingerprint))
            .collect();
        let result = apply_rename_sync(ApplyRenameOptions {
            root: portable(dir.path()),
            namespace: "citation".into(),
            old_key: "old".into(),
            new_key: "new".into(),
            fingerprints,
        })
        .unwrap();
        assert_eq!(result.replacements, 4);
        for file in [tex, typ, md, bib] {
            assert!(std::fs::read_to_string(file).unwrap().contains("new"));
        }
    }

    #[test]
    fn rename_apply_rejects_stale_preview_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("main.tex");
        std::fs::write(&file, "\\label{old} \\ref{old}").unwrap();
        let preview = preview_rename_sync(RenameReferenceOptions {
            root: portable(dir.path()),
            namespace: "label".into(),
            old_key: "old".into(),
            new_key: "new".into(),
            documents: vec![],
        })
        .unwrap();
        let fingerprints = preview
            .files
            .into_iter()
            .map(|file| (file.path, file.fingerprint))
            .collect();
        std::fs::write(&file, "externally changed").unwrap();
        let error = apply_rename_sync(ApplyRenameOptions {
            root: portable(dir.path()),
            namespace: "label".into(),
            old_key: "old".into(),
            new_key: "new".into(),
            fingerprints,
        })
        .unwrap_err();
        assert!(error.contains("file changed since rename preview"));
        assert_eq!(std::fs::read_to_string(file).unwrap(), "externally changed");
    }

    #[test]
    fn diagnostics_cover_duplicate_missing_and_unused_for_both_namespaces() {
        let result = build_index(
            Path::new("/p"),
            vec![
                doc(
                    "/p/a.tex",
                    "latex",
                    "\\label{x} \\label{x} \\ref{missing} \\cite{c}",
                ),
                doc("/p/r.bib", "bibtex", "@book{unused,}"),
            ],
            false,
        );
        let codes: HashSet<_> = result.diagnostics.iter().map(|x| x.code.as_str()).collect();
        assert!(codes.contains("duplicate-label"));
        assert!(codes.contains("missing-label"));
        assert!(codes.contains("missing-citation"));
        assert!(codes.contains("unused-citation"));
    }
}

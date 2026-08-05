//! Read-only submission readiness checks for academic projects.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_FILES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionDocumentOverride {
    pub path: String,
    pub language: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionCheckOptions {
    pub root: String,
    #[serde(default)]
    pub documents: Vec<SubmissionDocumentOverride>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionIssue {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub path: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionReport {
    pub ready: bool,
    pub issues: Vec<SubmissionIssue>,
    pub scanned_files: usize,
    pub truncated: bool,
}

fn portable(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
fn root(path: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(path).map_err(|e| format!("workspace not found: {e}"))?;
    if !root.is_dir() {
        return Err("workspace root is not a directory".into());
    }
    Ok(root)
}
fn language(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "tex" | "ltx" => Some("latex"),
        "typ" => Some("typst"),
        "md" | "qmd" => Some("markdown"),
        _ => None,
    }
}
fn skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "_site" | "_book" | ".venv" | "venv"
    )
}
fn line_at(text: &str, offset: usize) -> u32 {
    text[..offset.min(text.len())]
        .bytes()
        .filter(|b| *b == b'\n')
        .count() as u32
        + 1
}

fn collect(
    root: &Path,
    overrides: Vec<SubmissionDocumentOverride>,
) -> Result<(Vec<(PathBuf, String, String)>, bool), String> {
    let mut override_map = std::collections::HashMap::new();
    for doc in overrides {
        let path = std::fs::canonicalize(&doc.path).unwrap_or_else(|_| PathBuf::from(&doc.path));
        if path.starts_with(root) {
            override_map.insert(portable(&path), doc);
        }
    }
    let mut docs = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut seen = 0;
    let mut truncated = false;
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            if seen >= MAX_FILES {
                truncated = true;
                break;
            }
            seen += 1;
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if kind.is_dir() {
                if !skip_dir(&name) {
                    stack.push(path);
                }
                continue;
            }
            let Some(language) = language(&path) else {
                continue;
            };
            if entry.metadata().is_ok_and(|m| m.len() > MAX_FILE_BYTES) {
                continue;
            }
            let canonical = std::fs::canonicalize(&path).unwrap_or(path);
            let key = portable(&canonical);
            let override_doc = override_map.remove(&key);
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
            docs.push((canonical, language.to_string(), text));
        }
        if truncated {
            break;
        }
    }
    Ok((docs, truncated))
}

fn issue(
    issues: &mut Vec<SubmissionIssue>,
    code: &str,
    severity: &str,
    message: String,
    path: &Path,
    text: &str,
    offset: usize,
) {
    issues.push(SubmissionIssue {
        code: code.into(),
        severity: severity.into(),
        message,
        path: Some(portable(path)),
        line: Some(line_at(text, offset)),
    });
}

fn inspect_doc(issues: &mut Vec<SubmissionIssue>, path: &Path, language: &str, text: &str) {
    for pattern in ["TODO", "FIXME", "XXX"] {
        let mut offset = 0;
        while let Some(hit) = text[offset..].find(pattern) {
            let at = offset + hit;
            issue(
                issues,
                "todo",
                "warning",
                format!("Submission marker remains: {pattern}"),
                path,
                text,
                at,
            );
            offset = at + pattern.len();
        }
    }
    // Absolute Unix/Windows paths are common accidental submission dependencies.
    for re in [
        r#"(?m)(?:^|[\"'{(\s])([A-Za-z]:[\\/][^\s\"'}]+)"#,
        r#"(?m)(?:^|[\"'{(\s])(/(?:Users|home|tmp|var|private)/[^\s\"'}]+)"#,
    ] {
        let re = regex::Regex::new(re).unwrap();
        for cap in re.captures_iter(text) {
            if let Some(hit) = cap.get(1) {
                issue(
                    issues,
                    "absolute-path",
                    "warning",
                    "Absolute local path may break a clean submission build.".into(),
                    path,
                    text,
                    hit.start(),
                );
            }
        }
    }
    if language == "latex" {
        let re = regex::Regex::new(r"\\(?:author|thanks|affiliation)\s*\{([^}]*)\}").unwrap();
        for cap in re.captures_iter(text) {
            if let Some(hit) = cap.get(1) {
                issue(
                    issues,
                    "author-metadata",
                    "info",
                    "Author/affiliation metadata is present; review for anonymous submission."
                        .into(),
                    path,
                    text,
                    hit.start(),
                );
            }
        }
        for (code, message, needle) in [
            (
                "shell-escape",
                "Shell escape command found; review submission policy.",
                "\\write18",
            ),
            (
                "shell-escape",
                "Shell escape command found; review submission policy.",
                "\\immediate\\write18",
            ),
        ] {
            if let Some(at) = text.find(needle) {
                issue(issues, code, "warning", message.into(), path, text, at);
            }
        }
    }
    if language == "markdown" {
        let re = regex::Regex::new(r"(?m)^\s*author\s*:").unwrap();
        for hit in re.find_iter(text) {
            issue(
                issues,
                "author-metadata",
                "info",
                "Author front-matter is present; review for anonymous submission.".into(),
                path,
                text,
                hit.start(),
            );
        }
    }
    if language == "typst" {
        let re = regex::Regex::new(r"(?m)#set\s+document\s*\([^)]*author").unwrap();
        for hit in re.find_iter(text) {
            issue(
                issues,
                "author-metadata",
                "info",
                "Typst document author metadata is present; review for anonymous submission."
                    .into(),
                path,
                text,
                hit.start(),
            );
        }
    }
}

fn check_sync(options: SubmissionCheckOptions) -> Result<SubmissionReport, String> {
    let root = root(&options.root)?;
    let (docs, truncated) = collect(&root, options.documents)?;
    let mut issues = Vec::new();
    for (path, language, text) in docs.iter() {
        inspect_doc(&mut issues, path, language, text);
    }
    let ready = !issues.iter().any(|issue| issue.severity == "error");
    Ok(SubmissionReport {
        ready,
        issues,
        scanned_files: docs.len(),
        truncated,
    })
}

#[tauri::command]
pub async fn check_submission(options: SubmissionCheckOptions) -> Result<SubmissionReport, String> {
    tauri::async_runtime::spawn_blocking(move || check_sync(options))
        .await
        .map_err(|e| format!("submission check worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    #[test]
    fn finds_todos_paths_and_author_metadata() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(
            root.join("main.tex"),
            "\\author{Name}\nTODO: fix\n\\includegraphics{C:\\Users\\me\\plot.pdf}",
        )
        .unwrap();
        let report = check_sync(SubmissionCheckOptions {
            root: portable(&root),
            documents: vec![],
        })
        .unwrap();
        let codes: Vec<_> = report.issues.iter().map(|i| i.code.as_str()).collect();
        assert!(
            codes.contains(&"todo")
                && codes.contains(&"absolute-path")
                && codes.contains(&"author-metadata")
        );
    }
    #[test]
    fn override_content_is_used_for_open_document() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let path = root.join("main.md");
        std::fs::write(&path, "clean").unwrap();
        let report = check_sync(SubmissionCheckOptions {
            root: portable(&root),
            documents: vec![SubmissionDocumentOverride {
                path: portable(&path),
                language: "markdown".into(),
                text: "TODO".into(),
            }],
        })
        .unwrap();
        assert!(report.issues.iter().any(|i| i.code == "todo"));
    }
}

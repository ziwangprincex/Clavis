//! Bounded workspace text search and conflict-safe replacement.

use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

const MAX_FILES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RESULTS: usize = 5_000;
const MAX_QUERY_BYTES: usize = 4_096;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub root: String,
    pub query: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub relative_path: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
    pub fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub scanned_files: usize,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceOptions {
    pub root: String,
    pub query: String,
    pub replacement: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    pub fingerprints: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub changed_files: Vec<String>,
    pub replacements: usize,
}

fn fingerprint(text: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}:{}", hasher.finish(), text.len())
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("workspace not found: {e}"))?;
    if !root.is_dir() {
        return Err("workspace root is not a directory".into());
    }
    Ok(root)
}

fn skipped(name: &str) -> bool {
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

fn collect_files(root: &Path) -> Result<(Vec<PathBuf>, bool), String> {
    let mut files = Vec::new();
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
                if !skipped(&name) {
                    stack.push(entry.path());
                }
            } else if ty.is_file() {
                if files.len() >= MAX_FILES {
                    truncated = true;
                    break;
                }
                if entry.metadata().is_ok_and(|m| m.len() <= MAX_FILE_BYTES) {
                    files.push(entry.path());
                }
            }
        }
        if truncated {
            break;
        }
    }
    Ok((files, truncated))
}

fn matcher(query: &str, regex: bool, case_sensitive: bool) -> Result<Regex, String> {
    if query.is_empty() {
        return Err("search query must not be empty".into());
    }
    if query.len() > MAX_QUERY_BYTES {
        return Err("search query exceeds 4096 bytes".into());
    }
    let pattern = if regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("invalid regular expression: {e}"))
}

fn read_text(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn portable(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn search_workspace_sync(options: SearchOptions) -> Result<SearchResult, String> {
    let root = canonical_root(&options.root)?;
    let re = matcher(&options.query, options.regex, options.case_sensitive)?;
    let (files, mut truncated) = collect_files(&root)?;
    let mut matches = Vec::new();
    let mut scanned = 0;
    for path in files {
        let Some(text) = read_text(&path) else {
            continue;
        };
        scanned += 1;
        let hash = fingerprint(&text);
        for (line_idx, line) in text.lines().enumerate() {
            for hit in re.find_iter(line) {
                matches.push(SearchMatch {
                    path: portable(&path),
                    relative_path: portable(path.strip_prefix(&root).unwrap_or(&path)),
                    line: line_idx as u32 + 1,
                    column: line[..hit.start()].chars().count() as u32 + 1,
                    preview: line.chars().take(500).collect(),
                    fingerprint: hash.clone(),
                });
                if matches.len() >= MAX_RESULTS {
                    truncated = true;
                    break;
                }
            }
            if matches.len() >= MAX_RESULTS {
                break;
            }
        }
        if matches.len() >= MAX_RESULTS {
            break;
        }
    }
    Ok(SearchResult {
        matches,
        scanned_files: scanned,
        truncated,
    })
}

#[tauri::command]
pub async fn search_workspace(options: SearchOptions) -> Result<SearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || search_workspace_sync(options))
        .await
        .map_err(|error| format!("workspace search worker failed: {error}"))?
}

#[tauri::command]
pub async fn replace_workspace(options: ReplaceOptions) -> Result<ReplaceResult, String> {
    tauri::async_runtime::spawn_blocking(move || replace_workspace_sync(options))
        .await
        .map_err(|error| format!("workspace replace worker failed: {error}"))?
}

fn cleanup_staged(staged: &[(PathBuf, PathBuf, PathBuf)]) {
    for (_, temp, _) in staged {
        let _ = std::fs::remove_file(temp);
    }
}

fn rollback(installed: &[(PathBuf, PathBuf)]) {
    for (path, backup) in installed.iter().rev() {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::rename(backup, path);
    }
}

fn replace_workspace_sync(options: ReplaceOptions) -> Result<ReplaceResult, String> {
    let root = canonical_root(&options.root)?;
    let re = matcher(&options.query, options.regex, options.case_sensitive)?;
    let mut prepared = Vec::new();
    let mut replacements = 0;
    let mut seen = HashSet::new();

    // Prepare every write and verify every fingerprint before touching disk.
    for (path_text, expected) in &options.fingerprints {
        let path = std::fs::canonicalize(path_text).map_err(|e| format!("{path_text}: {e}"))?;
        if !path.is_file() || !path.starts_with(&root) || !seen.insert(path.clone()) {
            return Err(format!(
                "replacement path is outside the workspace: {path_text}"
            ));
        }
        let text = read_text(&path).ok_or_else(|| format!("not a UTF-8 text file: {path_text}"))?;
        if &fingerprint(&text) != expected {
            return Err(format!("file changed since search: {path_text}"));
        }
        let count = re.find_iter(&text).count();
        if count == 0 {
            continue;
        }
        let next = if options.regex {
            re.replace_all(&text, options.replacement.as_str())
                .into_owned()
        } else {
            re.replace_all(&text, NoExpand(options.replacement.as_str()))
                .into_owned()
        };
        replacements += count;
        prepared.push((path, next));
    }

    // Stage every new file beside its target. Preserve permissions and recheck
    // fingerprints after staging, before the first target is moved.
    let mut staged = Vec::new();
    for (path, next) in prepared {
        let suffix = uuid::Uuid::new_v4();
        let temp = path.with_extension(format!("clavis-{suffix}.tmp"));
        let backup = path.with_extension(format!("clavis-{suffix}.bak"));
        std::fs::write(&temp, next.as_bytes()).map_err(|e| format!("{}: {e}", temp.display()))?;
        if let Ok(metadata) = std::fs::metadata(&path) {
            let _ = std::fs::set_permissions(&temp, metadata.permissions());
        }
        staged.push((path, temp, backup));
    }
    for (path, _, _) in &staged {
        let current =
            read_text(path).ok_or_else(|| format!("not a UTF-8 text file: {}", path.display()))?;
        let key = portable(path);
        if options.fingerprints.get(&key) != Some(&fingerprint(&current)) {
            for (_, temp, _) in &staged {
                let _ = std::fs::remove_file(temp);
            }
            return Err(format!(
                "file changed while preparing replacement: {}",
                path.display()
            ));
        }
    }

    // Cross-platform replacement: Windows cannot rename over an existing file.
    // Move originals to same-directory backups, install staged files, and roll
    // back already-installed targets if any step fails.
    let mut installed: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (path, temp, backup) in &staged {
        if let Err(error) = std::fs::rename(path, backup) {
            rollback(&installed);
            cleanup_staged(&staged);
            return Err(format!(
                "cannot prepare {} for replacement: {error}",
                path.display()
            ));
        }
        if let Err(error) = std::fs::rename(temp, path) {
            let _ = std::fs::rename(backup, path);
            rollback(&installed);
            cleanup_staged(&staged);
            return Err(format!(
                "cannot install replacement for {}: {error}",
                path.display()
            ));
        }
        installed.push((path.clone(), backup.clone()));
    }
    let changed = installed.iter().map(|(path, _)| portable(path)).collect();
    for (_, backup) in installed {
        let _ = std::fs::remove_file(backup);
    }

    Ok(ReplaceResult {
        changed_files: changed,
        replacements,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn invalid_regex_is_reported() {
        let error = matcher("(", true, true).unwrap_err();
        assert!(error.contains("invalid regular expression"));
    }

    #[test]
    fn search_marks_result_limit_as_truncated() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("many.txt"), "x\n".repeat(MAX_RESULTS + 1)).unwrap();
        let result = search_workspace_sync(SearchOptions {
            root: portable(dir.path()),
            query: "x".into(),
            regex: false,
            case_sensitive: true,
        })
        .unwrap();
        assert_eq!(result.matches.len(), MAX_RESULTS);
        assert!(result.truncated);
    }

    #[test]
    fn searches_text_and_skips_git_and_binary() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "Alpha\nalpha").unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join(".git/x"), "alpha").unwrap();
        std::fs::write(dir.path().join("bin.dat"), b"alpha\0x").unwrap();
        let result = search_workspace_sync(SearchOptions {
            root: portable(dir.path()),
            query: "alpha".into(),
            regex: false,
            case_sensitive: false,
        })
        .unwrap();
        assert_eq!(result.matches.len(), 2);
        assert!(result.matches.iter().all(|m| m.relative_path == "a.md"));
    }

    #[test]
    fn replace_refuses_stale_files_before_writing() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        std::fs::write(&a, "old").unwrap();
        std::fs::write(&b, "old").unwrap();
        let found = search_workspace_sync(SearchOptions {
            root: portable(dir.path()),
            query: "old".into(),
            regex: false,
            case_sensitive: true,
        })
        .unwrap();
        let fingerprints = found
            .matches
            .into_iter()
            .map(|m| (m.path, m.fingerprint))
            .collect();
        std::fs::write(&b, "externally changed").unwrap();
        assert!(replace_workspace_sync(ReplaceOptions {
            root: portable(dir.path()),
            query: "old".into(),
            replacement: "new".into(),
            regex: false,
            case_sensitive: true,
            fingerprints
        })
        .unwrap_err()
        .contains("changed since search"));
        assert_eq!(std::fs::read_to_string(a).unwrap(), "old");
    }

    #[test]
    fn literal_replacement_does_not_expand_dollar_groups() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("a.md");
        std::fs::write(&file, "price").unwrap();
        let found = search_workspace_sync(SearchOptions {
            root: portable(dir.path()),
            query: "price".into(),
            regex: false,
            case_sensitive: true,
        })
        .unwrap();
        let fingerprints = found
            .matches
            .into_iter()
            .map(|m| (m.path, m.fingerprint))
            .collect();
        replace_workspace_sync(ReplaceOptions {
            root: portable(dir.path()),
            query: "price".into(),
            replacement: "$1".into(),
            regex: false,
            case_sensitive: true,
            fingerprints,
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(file).unwrap(), "$1");
    }

    #[test]
    fn regex_replace_is_atomic_per_validated_batch() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a.md");
        std::fs::write(&a, "x1 x2").unwrap();
        let found = search_workspace_sync(SearchOptions {
            root: portable(dir.path()),
            query: "x(\\d)".into(),
            regex: true,
            case_sensitive: true,
        })
        .unwrap();
        let fingerprints = found
            .matches
            .into_iter()
            .map(|m| (m.path, m.fingerprint))
            .collect();
        let result = replace_workspace_sync(ReplaceOptions {
            root: portable(dir.path()),
            query: "x(\\d)".into(),
            replacement: "y$1".into(),
            regex: true,
            case_sensitive: true,
            fingerprints,
        })
        .unwrap();
        assert_eq!(result.replacements, 2);
        assert_eq!(std::fs::read_to_string(a).unwrap(), "y1 y2");
    }
}

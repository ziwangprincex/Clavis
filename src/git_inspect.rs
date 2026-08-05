//! Read-only Git workspace inspection.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

const GIT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_DIFF_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceStatus {
    pub root: String,
    pub is_repository: bool,
    pub branch: Option<String>,
    pub detached: bool,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFileStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub id: String,
    pub short_id: String,
    pub author: String,
    pub subject: String,
    pub timestamp: String,
}

fn workspace_root(path: &str) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(path).map_err(|e| format!("workspace not found: {e}"))?;
    if !path.is_dir() {
        return Err("workspace root is not a directory".into());
    }
    Ok(path)
}

fn relative_path(path: &str) -> Result<&str, String> {
    let p = Path::new(path);
    if p.is_absolute()
        || p.components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("Git file path must be relative and inside the workspace".into());
    }
    Ok(path)
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("git unavailable: {e}"))?;
    let deadline = std::time::Instant::now() + GIT_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().map_err(|e| e.to_string())?;
                if !status.success() {
                    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
                }
                return Ok(String::from_utf8_lossy(&output.stdout).to_string());
            }
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("git command timed out".into());
            }
        }
    }
}

fn parse_status(root: &Path, output: &str) -> GitWorkspaceStatus {
    let mut branch = None;
    let mut detached = false;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();
    for line in output.lines() {
        if let Some(head) = line.strip_prefix("## ") {
            let name = head.split("...").next().unwrap_or(head).trim();
            detached = name.starts_with("HEAD (detached");
            if !detached && !name.is_empty() {
                branch = Some(name.to_string());
            }
            if let Some(counts) = head.split('[').nth(1).and_then(|v| v.strip_suffix(']')) {
                for item in counts.split(',') {
                    let item = item.trim();
                    if let Some(value) = item.strip_prefix("ahead ") {
                        ahead = value.parse().unwrap_or(0);
                    }
                    if let Some(value) = item.strip_prefix("behind ") {
                        behind = value.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        if line.len() < 3 {
            continue;
        }
        let x = &line[0..1];
        let y = &line[1..2];
        let path = line[3..].to_string();
        files.push(GitFileStatus {
            path,
            index_status: x.to_string(),
            worktree_status: y.to_string(),
            untracked: x == "?" && y == "?",
        });
    }
    GitWorkspaceStatus {
        root: root.to_string_lossy().replace('\\', "/"),
        is_repository: true,
        branch,
        detached,
        ahead,
        behind,
        files,
    }
}

#[tauri::command]
pub async fn inspect_git_workspace(root: String) -> Result<GitWorkspaceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&root)?;
        match git(&root, &["status", "--porcelain=v1", "--branch"]) {
            Ok(output) => Ok(parse_status(&root, &output)),
            Err(error) if error.contains("not a git repository") => Ok(GitWorkspaceStatus {
                root: root.to_string_lossy().replace('\\', "/"),
                is_repository: false,
                branch: None,
                detached: false,
                ahead: 0,
                behind: 0,
                files: Vec::new(),
            }),
            Err(error) => Err(error),
        }
    })
    .await
    .map_err(|e| format!("git worker failed: {e}"))?
}

#[tauri::command]
pub async fn git_history(root: String, path: Option<String>) -> Result<Vec<GitCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&root)?;
        let mut args = vec!["log", "-n", "30", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"];
        let owned_path;
        if let Some(path) = path {
            owned_path = relative_path(&path)?.to_string();
            args.extend(["--", &owned_path]);
        }
        let output = git(&root, &args)?;
        Ok(output
            .lines()
            .filter_map(|line| {
                let mut parts = line.split('\x1f');
                Some(GitCommit {
                    id: parts.next()?.to_string(),
                    short_id: parts.next()?.to_string(),
                    author: parts.next()?.to_string(),
                    timestamp: parts.next()?.to_string(),
                    subject: parts.next()?.to_string(),
                })
            })
            .collect())
    })
    .await
    .map_err(|e| format!("git worker failed: {e}"))?
}

#[tauri::command]
pub async fn git_file_diff(root: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&root)?;
        let path = relative_path(&path)?.to_string();
        let output = git(&root, &["diff", "--no-ext-diff", "HEAD", "--", &path])?;
        if output.len() > MAX_DIFF_BYTES {
            return Err("Git diff exceeds 1 MiB; narrow the file before viewing".into());
        }
        Ok(output)
    })
    .await
    .map_err(|e| format!("git worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escaping_file_paths() {
        assert!(relative_path("../secret").is_err());
        assert!(relative_path("C:/secret").is_err());
        assert_eq!(relative_path("paper/main.tex").unwrap(), "paper/main.tex");
    }
    #[test]
    fn parses_branch_counts_and_status() {
        let parsed = parse_status(
            Path::new("/work"),
            "## main...origin/main [ahead 2, behind 1]\n M paper.tex\n?? new.md\n",
        );
        assert!(parsed.is_repository);
        assert_eq!(parsed.branch.as_deref(), Some("main"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
        assert_eq!(parsed.files.len(), 2);
        assert!(parsed.files[1].untracked);
    }
}

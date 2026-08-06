//! Bounded Git workspace inspection plus explicitly local staging and commits.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

const GIT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_DIFF_BYTES: usize = 1_000_000;
const MAX_COMMIT_MESSAGE_CHARS: usize = 200;

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
    if path.is_empty()
        || p.is_absolute()
        || p.components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir | Component::CurDir))
    {
        return Err("Git file path must be relative and inside the workspace".into());
    }
    Ok(path)
}

fn tracked_status(root: &Path) -> Result<GitWorkspaceStatus, String> {
    let output = git(root, &["status", "--porcelain=v1", "--branch"])?;
    let status = parse_status(root, &output);
    if !status.is_repository {
        return Err("workspace is not a Git repository".to_string());
    }
    Ok(status)
}

fn checked_status_path(root: &Path, path: &str) -> Result<GitFileStatus, String> {
    let path = relative_path(path)?;
    let status = tracked_status(root)?;
    status.files.into_iter().find(|file| file.path == path)
        .ok_or_else(|| "Git file is no longer changed; refresh before writing".to_string())
}

fn has_configured_filter(root: &Path, path: &str) -> Result<bool, String> {
    // `git add` may execute a repository-defined clean filter (for example
    // Git LFS). Refuse that file rather than allowing the staging operation to
    // become an arbitrary process-execution surface.
    let output = git(root, &["check-attr", "filter", "--", path])?;
    let value = output.rsplit(':').next().unwrap_or("").trim();
    Ok(!matches!(value, "unspecified" | "unset" | ""))
}

fn valid_commit_message(message: &str) -> Result<&str, String> {
    let message = message.trim();
    if message.is_empty() || message.chars().count() > MAX_COMMIT_MESSAGE_CHARS || message.contains(['\0', '\r', '\n']) {
        return Err("commit message must be a non-empty single line up to 200 characters".to_string());
    }
    Ok(message)
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

fn git_without_hooks(root: &Path, args: &[&str]) -> Result<String, String> {
    // `--no-verify` skips only selected commit hooks; a post-commit hook could
    // still execute arbitrary repository code. Point hooksPath at a fresh empty
    // directory for this one direct-argv Git invocation instead.
    let hooks = tempfile::tempdir().map_err(|e| format!("cannot create empty hooks directory: {e}"))?;
    let hook_path = hooks.path().to_string_lossy().to_string();
    let mut all = vec!["-c", "core.hooksPath"];
    // Git accepts `-c key=value` as one argv element. Keeping it assembled here
    // avoids a shell while allowing the platform-native temporary path.
    let config = format!("core.hooksPath={hook_path}");
    all[1] = &config;
    all.extend_from_slice(args);
    git(root, &all)
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

#[tauri::command]
pub async fn git_stage_file(root: String, path: String) -> Result<GitWorkspaceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&root)?;
        let status = checked_status_path(&root, &path)?;
        if status.worktree_status == " " && !status.untracked {
            return Err("file has no unstaged changes to stage".to_string());
        }
        if has_configured_filter(&root, &path)? {
            return Err("refusing to stage a file with a configured Git filter".to_string());
        }
        git(&root, &["add", "--", &path])?;
        tracked_status(&root)
    }).await.map_err(|e| format!("git worker failed: {e}"))?
}

#[tauri::command]
pub async fn git_unstage_file(root: String, path: String) -> Result<GitWorkspaceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&root)?;
        let status = checked_status_path(&root, &path)?;
        if status.untracked || status.index_status == " " {
            return Err("file has no staged changes to unstage".to_string());
        }
        // `restore --staged` only changes the index. It never restores the worktree.
        git(&root, &["restore", "--staged", "--", &path])?;
        tracked_status(&root)
    }).await.map_err(|e| format!("git worker failed: {e}"))?
}

#[tauri::command]
pub async fn git_create_commit(root: String, message: String) -> Result<GitCommit, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = workspace_root(&root)?;
        let message = valid_commit_message(&message)?;
        let status = tracked_status(&root)?;
        if !status.files.iter().any(|file| !file.untracked && file.index_status != " ") {
            return Err("stage at least one tracked file before committing".to_string());
        }
        // Direct argv + --no-verify avoids executing repository hooks. This action
        // is deliberately local only: no remote argument is accepted anywhere.
        git_without_hooks(&root, &["commit", "--no-verify", "--no-gpg-sign", "-m", message])?;
        let output = git(&root, &["log", "-n", "1", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"])?;
        output.lines().next().and_then(|line| {
            let mut parts = line.split('\x1f');
            Some(GitCommit {
                id: parts.next()?.to_string(), short_id: parts.next()?.to_string(),
                author: parts.next()?.to_string(), timestamp: parts.next()?.to_string(), subject: parts.next()?.to_string(),
            })
        }).ok_or_else(|| "Git commit completed but its metadata could not be read".to_string())
    }).await.map_err(|e| format!("git worker failed: {e}"))?
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

    #[test]
    fn rejects_unsafe_or_multiline_commit_messages() {
        assert!(valid_commit_message("").is_err());
        assert!(valid_commit_message("first\nsecond").is_err());
        assert_eq!(valid_commit_message("Local change").unwrap(), "Local change");
    }

    #[test]
    fn refuses_paths_with_current_directory_components() {
        assert!(relative_path("./paper.tex").is_err());
        assert!(relative_path("").is_err());
    }

    #[test]
    fn detects_a_configured_filter_before_staging() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git(root, &["init"]).unwrap();
        std::fs::write(root.join(".gitattributes"), "*.dat filter=unsafe\n").unwrap();
        std::fs::write(root.join("data.dat"), "x").unwrap();
        assert!(has_configured_filter(root, "data.dat").unwrap());
    }

    #[test]
    fn stage_unstage_and_commit_are_local_argv_operations() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git(root, &["init"]).unwrap();
        git(root, &["config", "user.name", "Test User"]).unwrap();
        git(root, &["config", "user.email", "test@example.invalid"]).unwrap();
        std::fs::write(root.join("paper.txt"), "draft").unwrap();
        git(root, &["add", "--", "paper.txt"]).unwrap();
        git(root, &["commit", "--no-verify", "-m", "Initial"]).unwrap();
        std::fs::create_dir_all(root.join(".git/hooks")).unwrap();
        #[cfg(unix)]
        std::fs::write(root.join(".git/hooks/post-commit"), "#!/bin/sh\ntouch hook-ran\n").unwrap();
        #[cfg(windows)]
        std::fs::write(root.join(".git/hooks/post-commit"), "echo hook > hook-ran\n").unwrap();
        std::fs::write(root.join("paper.txt"), "revised").unwrap();
        let path = "paper.txt";
        let status = checked_status_path(root, path).unwrap();
        assert_eq!(status.worktree_status, "M");
        git(root, &["add", "--", path]).unwrap();
        let staged = checked_status_path(root, path).unwrap();
        assert_eq!(staged.index_status, "M");
        git(root, &["restore", "--staged", "--", path]).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("paper.txt")).unwrap(), "revised");
        git(root, &["add", "--", path]).unwrap();
        git_without_hooks(root, &["commit", "--no-verify", "--no-gpg-sign", "-m", "Local update"]).unwrap();
        assert!(!root.join("hook-ran").exists(), "commit hooks must not run");
    }

}

//! Generated artifact status for research tables, figures, and documents.

use crate::project_config::{ArtifactConfig, ProjectConfig};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSourceStatus {
    pub relative_path: String,
    pub path: String,
    pub exists: bool,
    pub modified_millis: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactStatus {
    pub name: String,
    pub relative_path: String,
    pub path: String,
    pub kind: String,
    pub description: Option<String>,
    pub task: Option<String>,
    pub status: String,
    pub reason: String,
    pub modified_millis: Option<u128>,
    pub sources: Vec<ArtifactSourceStatus>,
}

fn portable(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn modified(path: &Path) -> Option<u128> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

fn safe_existing_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let expected = root.join(relative);
    let canonical = std::fs::canonicalize(expected).ok()?;
    (canonical.starts_with(root) && canonical.is_file()).then_some(canonical)
}

fn inspect_one(root: &Path, name: &str, config: &ArtifactConfig) -> ArtifactStatus {
    let expected = root.join(&config.path);
    let artifact_path = safe_existing_path(root, &config.path);
    let artifact_modified = artifact_path.as_deref().and_then(modified);
    let sources: Vec<_> = config
        .sources
        .iter()
        .map(|relative| {
            let expected = root.join(relative);
            let path = safe_existing_path(root, relative);
            ArtifactSourceStatus {
                relative_path: relative.clone(),
                path: portable(path.as_deref().unwrap_or(&expected)),
                exists: path.is_some(),
                modified_millis: path.as_deref().and_then(modified),
            }
        })
        .collect();

    let missing_sources: Vec<_> = sources
        .iter()
        .filter(|source| !source.exists)
        .map(|source| source.relative_path.as_str())
        .collect();
    let newest_source = sources
        .iter()
        .filter_map(|source| source.modified_millis)
        .max();
    let (status, reason) = if artifact_path.is_none() {
        ("missing", "Artifact file does not exist".to_string())
    } else if !missing_sources.is_empty() {
        (
            "stale",
            format!("Missing source(s): {}", missing_sources.join(", ")),
        )
    } else if newest_source
        .is_some_and(|source| artifact_modified.is_some_and(|artifact| source > artifact))
    {
        (
            "stale",
            "A source file is newer than the artifact".to_string(),
        )
    } else {
        (
            "ready",
            "Artifact is up to date with declared sources".to_string(),
        )
    };

    ArtifactStatus {
        name: name.to_string(),
        relative_path: config.path.clone(),
        path: portable(artifact_path.as_deref().unwrap_or(&expected)),
        kind: config
            .kind
            .clone()
            .unwrap_or_else(|| "artifact".to_string()),
        description: config.description.clone(),
        task: config.task.clone(),
        status: status.to_string(),
        reason,
        modified_millis: artifact_modified,
        sources,
    }
}

fn inspect_sync(root: String) -> Result<Vec<ArtifactStatus>, String> {
    let root =
        std::fs::canonicalize(&root).map_err(|error| format!("workspace not found: {error}"))?;
    if !root.is_dir() {
        return Err("workspace root is not a directory".to_string());
    }
    let config_path = root.join("clavis.toml");
    let text = std::fs::read_to_string(&config_path)
        .map_err(|error| format!("cannot read clavis.toml: {error}"))?;
    let config: ProjectConfig =
        toml::from_str(&text).map_err(|error| format!("invalid clavis.toml: {error}"))?;
    let issues = crate::project_config::validate_project_config(&config);
    if !issues.is_empty() {
        return Err(format!(
            "invalid project configuration: {}",
            issues.join("; ")
        ));
    }
    Ok(config
        .artifacts
        .iter()
        .map(|(name, artifact)| inspect_one(&root, name, artifact))
        .collect())
}

#[tauri::command]
pub async fn inspect_artifacts(root: String) -> Result<Vec<ArtifactStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_sync(root))
        .await
        .map_err(|error| format!("artifact inspection worker failed: {error}"))?
}

#[tauri::command]
pub async fn open_artifact_path(root: String, path: String) -> Result<(), String> {
    let root =
        std::fs::canonicalize(root).map_err(|error| format!("workspace not found: {error}"))?;
    let path = std::fs::canonicalize(path).map_err(|error| format!("file not found: {error}"))?;
    if !path.is_file() || !path.starts_with(&root) {
        return Err("file must exist inside the workspace".to_string());
    }
    let mut command = if cfg!(windows) {
        let mut command = tokio::process::Command::new("explorer.exe");
        command.arg(&path);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = tokio::process::Command::new("open");
        command.arg(&path);
        command
    } else {
        let mut command = tokio::process::Command::new("xdg-open");
        command.arg(&path);
        command
    };
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| format!("cannot open file: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn config(path: &str, sources: &[&str]) -> ArtifactConfig {
        ArtifactConfig {
            path: path.into(),
            sources: sources.iter().map(|source| source.to_string()).collect(),
            task: Some("build".into()),
            kind: Some("table".into()),
            description: None,
        }
    }

    #[test]
    fn reports_missing_ready_and_stale() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let missing = inspect_one(&root, "missing", &config("out/missing.tex", &["src.R"]));
        assert_eq!(missing.status, "missing");

        std::fs::create_dir(root.join("out")).unwrap();
        std::fs::write(root.join("src.R"), "source").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(root.join("out/table.tex"), "table").unwrap();
        let ready = inspect_one(&root, "table", &config("out/table.tex", &["src.R"]));
        assert_eq!(ready.status, "ready");

        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(root.join("src.R"), "new source").unwrap();
        let stale = inspect_one(&root, "table", &config("out/table.tex", &["src.R"]));
        assert_eq!(stale.status, "stale");
        assert!(stale.reason.contains("newer"));
    }

    #[test]
    fn missing_source_makes_existing_artifact_stale() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("table.tex"), "table").unwrap();
        let status = inspect_one(&root, "table", &config("table.tex", &["missing.csv"]));
        assert_eq!(status.status, "stale");
        assert!(status.reason.contains("missing.csv"));
    }
}

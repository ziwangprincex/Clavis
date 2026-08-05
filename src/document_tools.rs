//! Safe adapters for Quarto and Pandoc document rendering.
//!
//! The frontend selects fixed enums only. Program names and argv are built here,
//! then executed through the existing trusted Task Run seam.

use crate::project_config::{trusted_workspace_root, ProjectConfig, TaskConfig};
use crate::tasks::{resolve_program, start_configured_run, TaskRunStarted, TaskState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentToolsInspection {
    pub root: String,
    pub quarto: ToolInfo,
    pub pandoc: ToolInfo,
    pub quarto_project_file: Option<String>,
    pub qmd_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderDocumentOptions {
    pub root: String,
    pub document: String,
    pub tool: String,
    pub format: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactOptions {
    pub root: String,
    pub document: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentArtifact {
    pub path: String,
    pub relative_path: String,
    pub format: String,
    pub modified_millis: Option<u128>,
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

fn confined_document(root: &Path, document: &str) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(document).map_err(|e| format!("document not found: {e}"))?;
    if !path.is_file() || !path.starts_with(root) {
        return Err("document must be a file inside the workspace".to_string());
    }
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "qmd" | "md") {
        return Err("Quarto/Pandoc render supports only .qmd and .md documents".to_string());
    }
    Ok(path)
}

fn validate_format(format: &str) -> Result<&str, String> {
    match format {
        "html" | "pdf" | "docx" => Ok(format),
        _ => Err("render format must be html, pdf, or docx".to_string()),
    }
}

fn validate_tool(tool: &str) -> Result<&str, String> {
    match tool {
        "quarto" | "pandoc" => Ok(tool),
        _ => Err("render tool must be quarto or pandoc".to_string()),
    }
}

fn render_task(
    root: &Path,
    document: &Path,
    tool: &str,
    format: &str,
) -> Result<TaskConfig, String> {
    let relative = document
        .strip_prefix(root)
        .map_err(|_| "document is outside the workspace".to_string())?;
    let relative = portable(relative);
    let args = match tool {
        "quarto" => vec![
            "render".to_string(),
            relative,
            "--to".to_string(),
            format.to_string(),
        ],
        "pandoc" => {
            let output = portable(
                &document
                    .with_extension(format)
                    .strip_prefix(root)
                    .map_err(|_| "document output is outside the workspace".to_string())?,
            );
            vec![relative, "-o".to_string(), output]
        }
        _ => unreachable!("validated tool"),
    };
    Ok(TaskConfig {
        command: tool.to_string(),
        args,
        cwd: None,
        env: BTreeMap::new(),
        timeout_seconds: Some(1800),
        depends_on: Vec::new(),
    })
}

fn probe_tool(root: &Path, name: &str) -> ToolInfo {
    let path = resolve_program(root, name).ok();
    let version = path.as_ref().and_then(|program| {
        let mut child = Command::new(program)
            .arg("--version")
            .current_dir(root)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .ok()?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    let output = child.wait_with_output().ok()?;
                    let text = if output.stdout.is_empty() {
                        &output.stderr
                    } else {
                        &output.stdout
                    };
                    break String::from_utf8_lossy(text)
                        .lines()
                        .next()
                        .map(|line| line.trim().to_string());
                }
                Ok(None) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
            }
        }
    });
    ToolInfo {
        name: name.to_string(),
        path: path.map(|path| portable(&path)),
        version,
    }
}

fn find_qmd(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if kind.is_dir() {
                if !matches!(
                    name.as_str(),
                    ".git"
                        | "node_modules"
                        | "target"
                        | "dist"
                        | ".venv"
                        | "venv"
                        | "_site"
                        | "_book"
                ) {
                    stack.push(entry.path());
                }
            } else if kind.is_file()
                && entry
                    .path()
                    .extension()
                    .and_then(|x| x.to_str())
                    .is_some_and(|x| x.eq_ignore_ascii_case("qmd"))
            {
                out.push(portable(
                    entry.path().strip_prefix(root).unwrap_or(&entry.path()),
                ));
                if out.len() >= 500 {
                    return out;
                }
            }
        }
    }
    out.sort();
    out
}

fn inspect_sync(root: String) -> Result<DocumentToolsInspection, String> {
    let root = canonical_root(&root)?;
    let project = ["_quarto.yml", "_quarto.yaml"]
        .into_iter()
        .map(|name| root.join(name))
        .find(|path| path.is_file())
        .map(|path| portable(&path));
    Ok(DocumentToolsInspection {
        root: portable(&root),
        quarto: probe_tool(&root, "quarto"),
        pandoc: probe_tool(&root, "pandoc"),
        quarto_project_file: project,
        qmd_files: find_qmd(&root),
    })
}

#[tauri::command]
pub async fn inspect_document_tools(root: String) -> Result<DocumentToolsInspection, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_sync(root))
        .await
        .map_err(|error| format!("document tools worker failed: {error}"))?
}

#[tauri::command]
pub async fn start_document_render(
    options: RenderDocumentOptions,
    window: tauri::Window,
    state: tauri::State<'_, Arc<TaskState>>,
) -> Result<TaskRunStarted, String> {
    let tool = validate_tool(&options.tool)?;
    let format = validate_format(&options.format)?;
    let root = trusted_workspace_root(&options.root)?;
    let document = confined_document(&root, &options.document)?;
    let task = render_task(&root, &document, tool, format)?;
    resolve_program(&root, &task.command)?;
    let name = format!("render:{tool}:{format}");
    let config = ProjectConfig {
        tasks: BTreeMap::from([(name.clone(), task)]),
        ..ProjectConfig::default()
    };
    start_configured_run(
        state.inner().clone(),
        window,
        root,
        config,
        name.clone(),
        vec![name],
    )
}

fn artifact_candidates(root: &Path, document: &Path, format: &str) -> Vec<PathBuf> {
    let stem = document
        .file_stem()
        .and_then(|x| x.to_str())
        .unwrap_or("output");
    let relative_parent = document
        .parent()
        .and_then(|parent| parent.strip_prefix(root).ok())
        .unwrap_or_else(|| Path::new(""));
    let filename = format!("{stem}.{format}");
    let mut candidates = vec![document.with_extension(format)];
    for output_dir in ["_site", "_book", "docs"] {
        candidates.push(root.join(output_dir).join(relative_parent).join(&filename));
        candidates.push(root.join(output_dir).join(&filename));
    }
    if format == "html" {
        candidates.push(root.join("_site").join("index.html"));
        candidates.push(root.join("docs").join("index.html"));
    }
    candidates
}

fn discover_named_artifacts(root: &Path, filename: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut visited = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if visited >= 10_000 {
                return out;
            }
            visited += 1;
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if kind.is_dir() {
                if !matches!(
                    name.as_str(),
                    ".git" | "node_modules" | "target" | ".venv" | "venv"
                ) {
                    stack.push(entry.path());
                }
            } else if kind.is_file() && name.eq_ignore_ascii_case(filename) {
                out.push(entry.path());
            }
        }
    }
    out
}

fn list_artifacts_sync(options: ArtifactOptions) -> Result<Vec<DocumentArtifact>, String> {
    let format = validate_format(&options.format)?;
    let root = canonical_root(&options.root)?;
    let document = confined_document(&root, &options.document)?;
    let mut out = Vec::new();
    let filename = format!(
        "{}.{}",
        document
            .file_stem()
            .and_then(|x| x.to_str())
            .unwrap_or("output"),
        format
    );
    let mut candidates = artifact_candidates(&root, &document, format);
    candidates.extend(discover_named_artifacts(&root, &filename));
    for candidate in candidates {
        let Ok(path) = std::fs::canonicalize(&candidate) else {
            continue;
        };
        if !path.is_file() || !path.starts_with(&root) {
            continue;
        }
        let modified_millis = std::fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis());
        if !out
            .iter()
            .any(|item: &DocumentArtifact| item.path == portable(&path))
        {
            out.push(DocumentArtifact {
                relative_path: portable(path.strip_prefix(&root).unwrap_or(&path)),
                path: portable(&path),
                format: format.to_string(),
                modified_millis,
            });
        }
    }
    out.sort_by(|a, b| b.modified_millis.cmp(&a.modified_millis));
    Ok(out)
}

#[tauri::command]
pub async fn list_document_artifacts(
    options: ArtifactOptions,
) -> Result<Vec<DocumentArtifact>, String> {
    tauri::async_runtime::spawn_blocking(move || list_artifacts_sync(options))
        .await
        .map_err(|error| format!("artifact worker failed: {error}"))?
}

#[tauri::command]
pub async fn open_document_artifact(root: String, path: String) -> Result<(), String> {
    let root = canonical_root(&root)?;
    let path = std::fs::canonicalize(&path).map_err(|e| format!("artifact not found: {e}"))?;
    if !path.is_file() || !path.starts_with(&root) {
        return Err("artifact must be a file inside the workspace".to_string());
    }
    let ext = path
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "html" | "pdf" | "docx") {
        return Err("only html, pdf, and docx artifacts can be opened".to_string());
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
        .map_err(|e| format!("cannot open artifact: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn render_args_are_fixed_and_path_is_relative() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("paper.qmd");
        std::fs::write(&doc, "---\ntitle: Test\n---").unwrap();
        let task = render_task(dir.path(), &doc, "quarto", "pdf").unwrap();
        assert_eq!(task.command, "quarto");
        assert_eq!(task.args, ["render", "paper.qmd", "--to", "pdf"]);
        assert!(!task.args.join(" ").contains(";") && !task.args.join(" ").contains("&&"));
    }

    #[test]
    fn pandoc_output_stays_beside_nested_source() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("chapters");
        std::fs::create_dir(&nested).unwrap();
        let doc = nested.join("paper.qmd");
        std::fs::write(&doc, "x").unwrap();
        let task = render_task(dir.path(), &doc, "pandoc", "docx").unwrap();
        assert_eq!(
            task.args,
            ["chapters/paper.qmd", "-o", "chapters/paper.docx"]
        );
    }

    #[test]
    fn rejects_escape_and_unsupported_formats() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let doc = outside.path().join("x.qmd");
        std::fs::write(&doc, "x").unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        assert!(confined_document(&root, doc.to_str().unwrap()).is_err());
        assert!(validate_format("exe").is_err());
        assert!(validate_tool("shell").is_err());
    }

    #[test]
    fn discovers_custom_quarto_output_directory() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("paper.qmd");
        std::fs::write(&doc, "x").unwrap();
        std::fs::create_dir(dir.path().join("published")).unwrap();
        std::fs::write(dir.path().join("published/paper.pdf"), "pdf").unwrap();
        let artifacts = list_artifacts_sync(ArtifactOptions {
            root: portable(dir.path()),
            document: portable(&doc),
            format: "pdf".into(),
        })
        .unwrap();
        assert_eq!(artifacts[0].relative_path, "published/paper.pdf");
    }

    #[test]
    fn discovers_common_quarto_outputs_inside_workspace() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("paper.qmd");
        std::fs::write(&doc, "x").unwrap();
        std::fs::create_dir(dir.path().join("_site")).unwrap();
        std::fs::write(dir.path().join("_site/paper.html"), "html").unwrap();
        let artifacts = list_artifacts_sync(ArtifactOptions {
            root: portable(dir.path()),
            document: portable(&doc),
            format: "html".into(),
        })
        .unwrap();
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].relative_path, "_site/paper.html");
    }
}

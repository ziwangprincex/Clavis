//! Read-only LaTeX submission bundle manifest.
//!
//! This is deliberately a dry run. It reuses the same confined project
//! collector as LaTeX compilation, reports what would be bundled, and never
//! writes a staging directory or archive.

use crate::project_config::{validate_project_config, ProjectConfig};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleManifestFile {
    pub relative_path: String,
    pub kind: String,
    pub size_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleManifest {
    pub root: String,
    pub main_document: String,
    pub files: Vec<BundleManifestFile>,
    pub warnings: Vec<String>,
    pub ready: bool,
}

fn portable(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn root(path: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(path).map_err(|e| format!("workspace not found: {e}"))?;
    if !root.is_dir() {
        return Err("workspace root is not a directory".to_string());
    }
    Ok(root)
}

fn kind(path: &str, binary: bool, is_bib: bool) -> String {
    if is_bib {
        return "bibliography".to_string();
    }
    if binary {
        return "binary-resource".to_string();
    }
    match Path::new(path)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "tex" | "ltx" => "latex-source".to_string(),
        "sty" | "cls" => "latex-style".to_string(),
        _ => "text-resource".to_string(),
    }
}

fn manifest_sync(workspace: String) -> Result<BundleManifest, String> {
    let root = root(&workspace)?;
    let config_path = root.join("clavis.toml");
    let config_text = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("cannot read clavis.toml: {e}"))?;
    let config: ProjectConfig =
        toml::from_str(&config_text).map_err(|e| format!("invalid clavis.toml: {e}"))?;
    let issues = validate_project_config(&config);
    if !issues.is_empty() {
        return Err(format!(
            "invalid project configuration: {}",
            issues.join("; ")
        ));
    }
    let main = config
        .project
        .main
        .ok_or_else(|| "project.main is required for a LaTeX bundle manifest".to_string())?;
    let main_path = root.join(&main);
    let canonical_main =
        std::fs::canonicalize(&main_path).map_err(|e| format!("main document not found: {e}"))?;
    if !canonical_main.starts_with(&root)
        || canonical_main
            .extension()
            .and_then(|v| v.to_str())
            .is_none_or(|v| !matches!(v.to_ascii_lowercase().as_str(), "tex" | "ltx"))
    {
        return Err("project.main must be a LaTeX document inside the workspace".to_string());
    }
    let collected = crate::latex::project::collect_project_files(portable(&canonical_main))?;
    let files = collected
        .files
        .into_iter()
        .map(|file| BundleManifestFile {
            relative_path: file.rel_path,
            kind: kind(&file.abs_path, file.binary_base64.is_some(), file.is_bib),
            size_bytes: file
                .binary_base64
                .as_ref()
                .map(|value| value.len() * 3 / 4)
                .unwrap_or_else(|| file.content.len()),
        })
        .collect();
    let ready = collected.warnings.is_empty();
    Ok(BundleManifest {
        root: portable(&root),
        main_document: portable(&canonical_main),
        files,
        warnings: collected.warnings,
        ready,
    })
}

#[tauri::command]
pub async fn inspect_submission_bundle(root: String) -> Result<BundleManifest, String> {
    tauri::async_runtime::spawn_blocking(move || manifest_sync(root))
        .await
        .map_err(|e| format!("bundle manifest worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn requires_latex_project_main() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(
            root.join("clavis.toml"),
            "[project]\nmain = \"paper.qmd\"\n",
        )
        .unwrap();
        std::fs::write(root.join("paper.qmd"), "x").unwrap();
        assert!(manifest_sync(portable(&root))
            .unwrap_err()
            .contains("LaTeX"));
    }

    #[test]
    fn reports_collected_source_and_resources_without_writing() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("clavis.toml"), "[project]\nmain = \"main.tex\"\n").unwrap();
        std::fs::create_dir(root.join("figures")).unwrap();
        std::fs::write(root.join("figures/chart.png"), b"png").unwrap();
        std::fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\includegraphics{figures/chart.png}",
        )
        .unwrap();
        let manifest = manifest_sync(portable(&root)).unwrap();
        assert!(manifest
            .files
            .iter()
            .any(|file| file.relative_path == "main.tex"));
        assert!(manifest.files.iter().any(
            |file| file.relative_path == "figures/chart.png" && file.kind == "binary-resource"
        ));
    }
}

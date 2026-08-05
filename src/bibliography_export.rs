//! Read-only declared bibliography export status (e.g. Better BibTeX).

use crate::project_config::{validate_project_config, ProjectConfig};
use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibliographyExportStatus {
    pub provider: String,
    pub relative_path: String,
    pub path: String,
    pub exists: bool,
    pub size_bytes: Option<u64>,
    pub modified_millis: Option<u128>,
}

fn portable(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn inspect_sync(root: String) -> Result<Vec<BibliographyExportStatus>, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("workspace not found: {e}"))?;
    let config_text = std::fs::read_to_string(root.join("clavis.toml"))
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
    let provider = config
        .bibliography
        .provider
        .unwrap_or_else(|| "local".to_string());
    Ok(config
        .bibliography
        .files
        .into_iter()
        .map(|relative_path| {
            let expected = root.join(&relative_path);
            let canonical = std::fs::canonicalize(&expected)
                .ok()
                .filter(|path| path.starts_with(&root) && path.is_file());
            let metadata = canonical
                .as_deref()
                .and_then(|path| std::fs::metadata(path).ok());
            BibliographyExportStatus {
                provider: provider.clone(),
                relative_path: relative_path.clone(),
                path: portable(canonical.as_deref().unwrap_or(&expected)),
                exists: canonical.is_some(),
                size_bytes: metadata.as_ref().map(|value| value.len()),
                modified_millis: metadata
                    .and_then(|value| value.modified().ok())
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis()),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn inspect_bibliography_exports(
    root: String,
) -> Result<Vec<BibliographyExportStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_sync(root))
        .await
        .map_err(|e| format!("bibliography export worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    #[test]
    fn reports_declared_export_without_reading_zotero() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::create_dir(root.join("references")).unwrap();
        std::fs::write(root.join("references/library.bib"), "@article{k,}").unwrap();
        std::fs::write(
            root.join("clavis.toml"),
            "[bibliography]\nprovider = \"better-bibtex\"\nfiles = [\"references/library.bib\"]\n",
        )
        .unwrap();
        let result = inspect_sync(portable(&root)).unwrap();
        assert!(result[0].exists);
        assert_eq!(result[0].provider, "better-bibtex");
        assert!(result[0].size_bytes.unwrap() > 0);
    }
}

//! Workspace project configuration and trust.
//!
//! The repository-owned `clavis.toml` describes a project, but trust is stored
//! separately under Clavis' user config directory. A project therefore cannot
//! grant itself permission to run a latexmk full build (whose `.latexmkrc` can
//! execute commands) by editing a checked-in file.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

const CONFIG_NAME: &str = "clavis.toml";
const MAX_CONFIG_BYTES: u64 = 256 * 1024;
const TRUST_FILE: &str = "trusted-workspaces.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectSection {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub main: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct LatexSection {
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub bibliography: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritingSection {
    #[serde(default)]
    pub spelling: Option<String>,
    #[serde(default, alias = "ignored_acronyms")]
    pub ignored_acronyms: Vec<String>,
    #[serde(default)]
    pub terms: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PathsSection {
    #[serde(default)]
    pub generated: Vec<String>,
    #[serde(default)]
    pub ignored: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectConfig {
    #[serde(default)]
    pub project: ProjectSection,
    #[serde(default)]
    pub latex: LatexSection,
    #[serde(default)]
    pub paths: PathsSection,
    #[serde(default)]
    pub writing: WritingSection,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInspection {
    pub root: String,
    pub config_path: Option<String>,
    pub config: Option<ProjectConfig>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTrust {
    pub root: String,
    pub trust: String,
}

fn canonical_workspace(root: &str) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(root).map_err(|e| format!("workspace not found: {e}"))?;
    if !path.is_dir() {
        return Err("workspace root is not a directory".to_string());
    }
    Ok(path)
}

fn portable_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn contains_parent_or_absolute(path: &str) -> bool {
    let p = Path::new(path);
    p.is_absolute()
        || p.components()
            .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
}

fn validate_project_config(config: &ProjectConfig) -> Vec<String> {
    let mut issues = Vec::new();
    if config.latex.engine.as_deref().is_some_and(|engine| !matches!(engine, "pdflatex" | "xelatex" | "lualatex")) { issues.push("latex.engine must be pdflatex, xelatex, or lualatex".into()); }
    if config.latex.bibliography.as_deref().is_some_and(|engine| !matches!(engine, "auto" | "bibtex" | "biber" | "none")) { issues.push("latex.bibliography must be auto, bibtex, biber, or none".into()); }
    if let Some(main) = config.project.main.as_deref() {
        if main.trim().is_empty() {
            issues.push("project.main must not be empty".to_string());
        } else if contains_parent_or_absolute(main) {
            issues.push("project.main must be a relative path inside the workspace".to_string());
        }
    }

    if let Some(spelling) = config.writing.spelling.as_deref() {
        if !matches!(spelling, "us" | "uk" | "mixed") {
            issues.push("writing.spelling must be us, uk, or mixed".to_string());
        }
    }
    if config.writing.ignored_acronyms.len() > 500 || config.writing.terms.len() > 500 {
        issues.push("writing ignored_acronyms and terms are limited to 500 items each".to_string());
    }
    for acronym in &config.writing.ignored_acronyms {
        if !acronym
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
            || acronym.len() < 2
            || acronym.len() > 12
        {
            issues.push(
                "writing.ignored_acronyms must be 2-12 uppercase alphanumeric characters"
                    .to_string(),
            );
            break;
        }
    }

    for term in &config.writing.terms {
        if term.trim().is_empty() || term.len() > 200 || term.contains(['\n', '\r']) {
            issues.push(
                "writing.terms must be non-empty single-line strings up to 200 characters".to_string(),
            );
            break;
        }
    }

    issues
}

fn trust_path() -> Result<PathBuf, String> {
    crate::settings::clavis_config_dir()
        .map(|dir| dir.join(TRUST_FILE))
        .ok_or_else(|| "no config directory available".to_string())
}

fn read_trusted_roots() -> BTreeSet<String> {
    let Ok(path) = trust_path() else {
        return BTreeSet::new();
    };
    let Ok(bytes) = std::fs::read(path) else {
        return BTreeSet::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn write_trusted_roots(roots: &BTreeSet<String>) -> Result<(), String> {
    let path = trust_path()?;
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(roots).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn inspect(root: PathBuf) -> WorkspaceInspection {
    let root_key = portable_path(&root);
    let config_path = root.join(CONFIG_NAME);
    if !config_path.is_file() {
        return WorkspaceInspection {
            root: root_key,
            config_path: None,
            config: None,
            issues: Vec::new(),
        };
    }

    let mut issues = Vec::new();
    let config = match std::fs::metadata(&config_path) {
        Ok(meta) if meta.len() > MAX_CONFIG_BYTES => {
            issues.push(format!("{CONFIG_NAME} exceeds the 256 KiB size limit"));
            None
        }
        Ok(_) => match std::fs::read_to_string(&config_path) {
            Ok(text) => match toml::from_str::<ProjectConfig>(&text) {
                Ok(parsed) => {
                    issues.extend(validate_project_config(&parsed));
                    Some(parsed)
                }
                Err(error) => {
                    issues.push(format!("invalid {CONFIG_NAME}: {error}"));
                    None
                }
            },
            Err(error) => {
                issues.push(format!("cannot read {CONFIG_NAME}: {error}"));
                None
            }
        },
        Err(error) => {
            issues.push(format!("cannot inspect {CONFIG_NAME}: {error}"));
            None
        }
    };

    WorkspaceInspection {
        root: root_key,
        config_path: Some(portable_path(&config_path)),
        config,
        issues,
    }
}

/// Re-read trust immediately before execution. This closes the
/// time-of-check/time-of-use gap between granting trust and starting a build.
pub(crate) fn trusted_workspace_root(root: &str) -> Result<PathBuf, String> {
    let root = canonical_workspace(root)?;
    let key = portable_path(&root);
    if !read_trusted_roots().contains(&key) {
        return Err("workspace is not trusted for external tool execution".to_string());
    }
    Ok(root)
}

#[tauri::command]
pub fn inspect_workspace(root: String) -> Result<WorkspaceInspection, String> {
    let root = canonical_workspace(&root)?;
    Ok(inspect(root))
}

#[tauri::command]
pub fn set_workspace_trust(root: String, trusted: bool) -> Result<WorkspaceTrust, String> {
    let root = canonical_workspace(&root)?;
    let key = portable_path(&root);
    let mut roots = read_trusted_roots();
    if trusted {
        roots.insert(key.clone());
    } else {
        roots.remove(&key);
    }
    write_trusted_roots(&roots)?;
    Ok(WorkspaceTrust {
        root: key,
        trust: if trusted { "trusted" } else { "untrusted" }.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn inspect_at(text: Option<&str>) -> WorkspaceInspection {
        let dir = tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(dir.path().join(CONFIG_NAME), text).unwrap();
        }
        inspect(std::fs::canonicalize(dir.path()).unwrap())
    }

    #[test]
    fn no_config_is_not_an_issue() {
        let result = inspect_at(None);
        assert!(result.config_path.is_none());
        assert!(result.config.is_none());
        assert!(result.issues.is_empty());
    }

    #[test]
    fn parses_project_and_ignores_retired_sections() {
        let result = inspect_at(Some(
            r#"
[project]
name = "Paper"
main = "paper/main.tex"

[tasks.tables]
command = "Rscript"
args = ["scripts/tables.R"]

[artifacts.table]
path = "out/table.tex"

[bibliography]
provider = "better-bibtex"
files = ["library.bib"]
"#,
        ));
        assert!(result.issues.is_empty());
        let config = result.config.unwrap();
        assert_eq!(config.project.name.as_deref(), Some("Paper"));
        assert_eq!(config.project.main.as_deref(), Some("paper/main.tex"));
    }

    #[test]
    fn rejects_paths_that_escape_the_workspace() {
        let result = inspect_at(Some(
            r#"
[project]
main = "../secret.tex"
"#,
        ));
        assert!(result.issues.iter().any(|x| x.contains("project.main")));
    }

    #[test]
    fn validates_writing_config() {
        let valid = inspect_at(Some(
            r#"
[writing]
spelling = "uk"
ignored_acronyms = ["GDP", "IV"]
terms = ["difference-in-differences"]
"#,
        ));
        assert!(valid.issues.is_empty());
        assert_eq!(
            valid.config.as_ref().map(|config| config.writing.ignored_acronyms.clone()),
            Some(vec!["GDP".to_string(), "IV".to_string()])
        );
        assert_eq!(
            valid.config.as_ref().map(|config| config.writing.terms.clone()),
            Some(vec!["difference-in-differences".to_string()])
        );
        let invalid = inspect_at(Some(
            r#"
[writing]
spelling = "canadian"
ignored_acronyms = ["bad"]
terms = [""]
"#,
        ));
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.contains("writing.spelling")));
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.contains("writing.ignored_acronyms")));
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.contains("writing.terms")));
    }

    #[test]
    fn invalid_toml_is_an_issue_not_a_crash() {
        let result = inspect_at(Some("[project\nname = nope"));
        assert!(result.config.is_none());
        assert!(result.issues[0].contains("invalid clavis.toml"));
    }
}

//! Workspace project configuration and trust.
//!
//! The repository-owned `clavis.toml` describes a project, but trust is stored
//! separately under Clavis' user config directory. A project therefore cannot
//! grant itself permission to execute commands by editing a checked-in file.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
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
pub struct BibliographySection {
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub provider: Option<String>,
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
#[serde(rename_all = "camelCase")]
pub struct TaskConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default, alias = "timeout_seconds")]
    pub timeout_seconds: Option<u64>,
    #[serde(default, alias = "depends_on")]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactConfig {
    pub path: String,
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
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
    pub bibliography: BibliographySection,
    #[serde(default)]
    pub writing: WritingSection,
    #[serde(default)]
    pub tasks: BTreeMap<String, TaskConfig>,
    #[serde(default)]
    pub artifacts: BTreeMap<String, ArtifactConfig>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInspection {
    pub root: String,
    pub config_path: Option<String>,
    pub config: Option<ProjectConfig>,
    pub issues: Vec<String>,
    pub trust: String,
    pub has_executable_tasks: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTrust {
    pub root: String,
    pub trust: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDoctorCheck {
    pub id: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDoctorReport {
    pub root: String,
    pub ok: bool,
    pub checks: Vec<ProjectDoctorCheck>,
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

pub(crate) fn validate_project_config(config: &ProjectConfig) -> Vec<String> {
    let mut issues = Vec::new();
    if let Some(main) = config.project.main.as_deref() {
        if main.trim().is_empty() {
            issues.push("project.main must not be empty".to_string());
        } else if contains_parent_or_absolute(main) {
            issues.push("project.main must be a relative path inside the workspace".to_string());
        }
    }

    for (name, task) in &config.tasks {
        if name.trim().is_empty() {
            issues.push("task names must not be empty".to_string());
        }
        if task.command.trim().is_empty() {
            issues.push(format!("tasks.{name}.command must not be empty"));
        }
        if matches!(task.timeout_seconds, Some(0 | 3601..)) {
            issues.push(format!(
                "tasks.{name}.timeoutSeconds must be between 1 and 3600"
            ));
        }
        if let Some(cwd) = task.cwd.as_deref() {
            if cwd.trim().is_empty() || contains_parent_or_absolute(cwd) {
                issues.push(format!(
                    "tasks.{name}.cwd must be a relative path inside the workspace"
                ));
            }
        }
        for dependency in &task.depends_on {
            if !config.tasks.contains_key(dependency) {
                issues.push(format!("tasks.{name} depends on unknown task {dependency}"));
            }
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

    if let Some(provider) = config.bibliography.provider.as_deref() {
        if !matches!(provider, "better-bibtex" | "local") {
            issues.push("bibliography.provider must be better-bibtex or local".to_string());
        }
    }
    if config.bibliography.files.len() > 50 {
        issues.push("bibliography.files exceeds the 50-file limit".to_string());
    }
    for file in &config.bibliography.files {
        if file.trim().is_empty()
            || contains_parent_or_absolute(file)
            || !file.to_ascii_lowercase().ends_with(".bib")
        {
            issues.push(
                "bibliography.files must contain relative .bib paths inside the workspace"
                    .to_string(),
            );
            break;
        }
    }

    for (name, artifact) in &config.artifacts {
        if name.trim().is_empty() {
            issues.push("artifact names must not be empty".to_string());
        }
        if artifact.path.trim().is_empty() || contains_parent_or_absolute(&artifact.path) {
            issues.push(format!(
                "artifacts.{name}.path must be a relative path inside the workspace"
            ));
        }
        if let Some(task) = artifact.task.as_deref() {
            if !config.tasks.contains_key(task) {
                issues.push(format!("artifacts.{name} references unknown task {task}"));
            }
        }
        for source in &artifact.sources {
            if source.trim().is_empty() || contains_parent_or_absolute(source) {
                issues.push(format!(
                    "artifacts.{name}.sources must contain relative paths inside the workspace"
                ));
                break;
            }
        }
        if artifact.sources.len() > 200 {
            issues.push(format!("artifacts.{name} exceeds the 200-source limit"));
        }
    }

    // A dependency cycle would otherwise deadlock the future task runner. Catch
    // it at the configuration seam rather than teaching every caller about it.
    fn visit(
        name: &str,
        tasks: &BTreeMap<String, TaskConfig>,
        visiting: &mut BTreeSet<String>,
        visited: &mut BTreeSet<String>,
    ) -> bool {
        if visited.contains(name) {
            return false;
        }
        if !visiting.insert(name.to_string()) {
            return true;
        }
        if let Some(task) = tasks.get(name) {
            for dep in &task.depends_on {
                if tasks.contains_key(dep) && visit(dep, tasks, visiting, visited) {
                    return true;
                }
            }
        }
        visiting.remove(name);
        visited.insert(name.to_string());
        false
    }

    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    for name in config.tasks.keys() {
        if visit(name, &config.tasks, &mut visiting, &mut visited) {
            issues.push("task dependency graph contains a cycle".to_string());
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

fn inspect_with_trust(root: PathBuf, trusted: &BTreeSet<String>) -> WorkspaceInspection {
    let root_key = portable_path(&root);
    let config_path = root.join(CONFIG_NAME);
    if !config_path.is_file() {
        return WorkspaceInspection {
            root: root_key,
            config_path: None,
            config: None,
            issues: Vec::new(),
            trust: "not-required".to_string(),
            has_executable_tasks: false,
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

    let has_executable_tasks = config.as_ref().is_some_and(|c| !c.tasks.is_empty());
    let trust = if !has_executable_tasks {
        "not-required"
    } else if trusted.contains(&root_key) {
        "trusted"
    } else {
        "untrusted"
    };

    WorkspaceInspection {
        root: root_key,
        config_path: Some(portable_path(&config_path)),
        config,
        issues,
        trust: trust.to_string(),
        has_executable_tasks,
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ExecutableWorkspace {
    pub root: PathBuf,
    pub config: ProjectConfig,
}

/// Re-read configuration and trust immediately before execution. This closes the
/// time-of-check/time-of-use gap between opening a folder and starting a task.
pub(crate) fn trusted_workspace_root(root: &str) -> Result<PathBuf, String> {
    let root = canonical_workspace(root)?;
    let key = portable_path(&root);
    if !read_trusted_roots().contains(&key) {
        return Err("workspace is not trusted for external tool execution".to_string());
    }
    Ok(root)
}

pub(crate) fn executable_workspace(root: &str) -> Result<ExecutableWorkspace, String> {
    let root = canonical_workspace(root)?;
    let inspection = inspect_with_trust(root.clone(), &read_trusted_roots());
    if !inspection.issues.is_empty() {
        return Err(format!(
            "invalid project configuration: {}",
            inspection.issues.join("; ")
        ));
    }
    if inspection.trust != "trusted" {
        return Err("workspace is not trusted for task execution".to_string());
    }
    let config = inspection
        .config
        .ok_or_else(|| "workspace has no clavis.toml".to_string())?;
    Ok(ExecutableWorkspace { root, config })
}

fn command_available(root: &Path, command: &str) -> bool {
    crate::tasks::resolve_program(root, command).is_ok()
}

#[tauri::command]
pub fn doctor_workspace(root: String) -> Result<ProjectDoctorReport, String> {
    let root = canonical_workspace(&root)?;
    let inspection = inspect_with_trust(root.clone(), &read_trusted_roots());
    let mut checks = Vec::new();
    if inspection.config_path.is_none() {
        checks.push(ProjectDoctorCheck {
            id: "config".to_string(),
            status: "warning".to_string(),
            message: "No clavis.toml; project tasks and shared metadata are unavailable"
                .to_string(),
        });
    } else if inspection.issues.is_empty() {
        checks.push(ProjectDoctorCheck {
            id: "config".to_string(),
            status: "ok".to_string(),
            message: "clavis.toml is valid".to_string(),
        });
    } else {
        for issue in &inspection.issues {
            checks.push(ProjectDoctorCheck {
                id: "config".to_string(),
                status: "error".to_string(),
                message: issue.clone(),
            });
        }
    }

    if let Some(config) = inspection.config.as_ref() {
        if let Some(main) = config.project.main.as_deref() {
            let exists = root.join(main).is_file();
            checks.push(ProjectDoctorCheck {
                id: "main".to_string(),
                status: if exists { "ok" } else { "error" }.to_string(),
                message: if exists {
                    format!("Main document found: {main}")
                } else {
                    format!("Main document is missing: {main}")
                },
            });
        }
        if !config.tasks.is_empty() {
            checks.push(ProjectDoctorCheck {
                id: "trust".to_string(),
                status: if inspection.trust == "trusted" {
                    "ok"
                } else {
                    "warning"
                }
                .to_string(),
                message: if inspection.trust == "trusted" {
                    "Workspace is trusted for task execution".to_string()
                } else {
                    "Workspace tasks are disabled until the workspace is trusted".to_string()
                },
            });
        }
        for (name, task) in &config.tasks {
            let available = command_available(&root, &task.command);
            checks.push(ProjectDoctorCheck {
                id: format!("task-command:{name}"),
                status: if available { "ok" } else { "error" }.to_string(),
                message: if available {
                    format!("Task {name}: command found ({})", task.command)
                } else {
                    format!("Task {name}: command not found ({})", task.command)
                },
            });
            if let Some(cwd) = task.cwd.as_deref() {
                let valid = confined_relative_dir_for_doctor(&root, cwd);
                checks.push(ProjectDoctorCheck {
                    id: format!("task-cwd:{name}"),
                    status: if valid { "ok" } else { "error" }.to_string(),
                    message: if valid {
                        format!("Task {name}: working directory found ({cwd})")
                    } else {
                        format!("Task {name}: working directory is missing or outside the workspace ({cwd})")
                    },
                });
            }
        }
    }
    let ok = !checks.iter().any(|check| check.status == "error");
    Ok(ProjectDoctorReport {
        root: portable_path(&root),
        ok,
        checks,
    })
}

fn confined_relative_dir_for_doctor(root: &Path, relative: &str) -> bool {
    if contains_parent_or_absolute(relative) {
        return false;
    }
    std::fs::canonicalize(root.join(relative))
        .is_ok_and(|path| path.is_dir() && path.starts_with(root))
}

#[tauri::command]
pub fn inspect_workspace(root: String) -> Result<WorkspaceInspection, String> {
    let root = canonical_workspace(&root)?;
    Ok(inspect_with_trust(root, &read_trusted_roots()))
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

    fn inspect_at(text: Option<&str>, trusted: bool) -> WorkspaceInspection {
        let dir = tempdir().unwrap();
        if let Some(text) = text {
            std::fs::write(dir.path().join(CONFIG_NAME), text).unwrap();
        }
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let mut roots = BTreeSet::new();
        if trusted {
            roots.insert(portable_path(&root));
        }
        inspect_with_trust(root, &roots)
    }

    #[test]
    fn no_config_requires_no_trust() {
        let result = inspect_at(None, false);
        assert_eq!(result.trust, "not-required");
        assert!(result.config.is_none());
    }

    #[test]
    fn parses_project_and_tasks_but_does_not_auto_trust() {
        let result = inspect_at(
            Some(
                r#"
[project]
name = "Paper"
main = "paper/main.tex"

[tasks.tables]
command = "Rscript"
args = ["scripts/tables.R"]
"#,
            ),
            false,
        );
        assert_eq!(
            result.config.unwrap().project.name.as_deref(),
            Some("Paper")
        );
        assert!(result.has_executable_tasks);
        assert_eq!(result.trust, "untrusted");
        assert!(result.issues.is_empty());
    }

    #[test]
    fn trust_is_external_to_the_repository_config() {
        let text = r#"[tasks.paper]
command = "latexmk"
"#;
        assert_eq!(inspect_at(Some(text), false).trust, "untrusted");
        assert_eq!(inspect_at(Some(text), true).trust, "trusted");
    }

    #[test]
    fn rejects_paths_that_escape_the_workspace() {
        let result = inspect_at(
            Some(
                r#"
[project]
main = "../secret.tex"
[tasks.paper]
command = "latexmk"
cwd = "../outside"
"#,
            ),
            false,
        );
        assert!(result.issues.iter().any(|x| x.contains("project.main")));
        assert!(result.issues.iter().any(|x| x.contains("tasks.paper.cwd")));
    }

    #[test]
    fn reports_unknown_dependencies_and_cycles() {
        let unknown = inspect_at(
            Some(
                r#"
[tasks.a]
command = "a"
depends_on = ["missing"]
"#,
            ),
            false,
        );
        assert!(unknown.issues.iter().any(|x| x.contains("unknown task")));

        let cycle = inspect_at(
            Some(
                r#"
[tasks.a]
command = "a"
depends_on = ["b"]
[tasks.b]
command = "b"
depends_on = ["a"]
"#,
            ),
            false,
        );
        assert!(cycle.issues.iter().any(|x| x.contains("cycle")));
    }

    #[test]
    fn doctor_reports_missing_main_and_command() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join(CONFIG_NAME),
            r#"[project]
main = "paper/main.tex"
[tasks.paper]
command = "definitely-not-a-real-clavis-command"
"#,
        )
        .unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let inspection = inspect_with_trust(root.clone(), &BTreeSet::new());
        let config = inspection.config.unwrap();
        assert!(!root.join(config.project.main.unwrap()).is_file());
        assert!(!command_available(&root, &config.tasks["paper"].command));
    }

    #[test]
    fn doctor_confines_task_working_directories() {
        let dir = tempdir().unwrap();
        std::fs::create_dir(dir.path().join("scripts")).unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        assert!(confined_relative_dir_for_doctor(&root, "scripts"));
        assert!(!confined_relative_dir_for_doctor(&root, "../outside"));
        assert!(!confined_relative_dir_for_doctor(&root, "missing"));
    }

    #[test]
    fn validates_artifact_paths_tasks_and_source_limits() {
        let invalid = inspect_at(
            Some(
                r#"
[tasks.tables]
command = "Rscript"
[artifacts.good]
path = "paper/tables/good.tex"
task = "tables"
sources = ["scripts/tables.R"]
[artifacts.bad]
path = "../escape.tex"
task = "missing"
sources = ["../secret.csv"]
"#,
            ),
            false,
        );
        assert!(!invalid
            .issues
            .iter()
            .any(|issue| issue.contains("artifacts.good")));
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.contains("artifacts.bad.path")));
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.contains("unknown task")));
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.contains("artifacts.bad.sources")));
    }

    #[test]
    fn validates_writing_config() {
        let valid = inspect_at(
            Some(
                r#"
[writing]
spelling = "uk"
ignored_acronyms = ["GDP", "IV"]
terms = ["difference-in-differences"]
"#,
            ),
            false,
        );
        assert!(valid.issues.is_empty());
        assert_eq!(
            valid.config.as_ref().map(|config| config.writing.ignored_acronyms.clone()),
            Some(vec!["GDP".to_string(), "IV".to_string()])
        );
        assert_eq!(
            valid.config.as_ref().map(|config| config.writing.terms.clone()),
            Some(vec!["difference-in-differences".to_string()])
        );
        let invalid = inspect_at(
            Some(
                r#"
[writing]
spelling = "canadian"
ignored_acronyms = ["bad"]
terms = [""]
"#,
            ),
            false,
        );
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
    fn validates_better_bibtex_export_config() {
        let valid = inspect_at(
            Some(
                r#"
[bibliography]
provider = "better-bibtex"
files = ["references/library.bib"]
"#,
            ),
            false,
        );
        assert!(valid.issues.is_empty());
        let invalid = inspect_at(
            Some(
                r#"
[bibliography]
provider = "zotero-sqlite"
files = ["../outside.bib", "notes.txt"]
"#,
            ),
            false,
        );
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.contains("bibliography.provider")));
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.contains("bibliography.files")));
    }

    #[test]
    fn invalid_toml_is_an_issue_not_a_crash() {
        let result = inspect_at(Some("[project\nname = nope"), false);
        assert!(result.config.is_none());
        assert!(result.issues[0].contains("invalid clavis.toml"));
    }
}

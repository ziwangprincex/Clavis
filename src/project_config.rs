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
    #[serde(default, alias = "depends_on")]
    pub depends_on: Vec<String>,
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
    pub tasks: BTreeMap<String, TaskConfig>,
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

fn validate_config(config: &ProjectConfig) -> Vec<String> {
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
                    issues.extend(validate_config(&parsed));
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
    fn invalid_toml_is_an_issue_not_a_crash() {
        let result = inspect_at(Some("[project\nname = nope"), false);
        assert!(result.config.is_none());
        assert!(result.issues[0].contains("invalid clavis.toml"));
    }
}

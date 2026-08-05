//! Trusted project-task execution.
//!
//! Tasks are loaded from `clavis.toml` again at start time, planned as a
//! dependency-ordered DAG, and launched directly (never through a shell). Output
//! is streamed as Tauri events. Each run has one cancellation channel and at
//! most one child process alive at a time.

use crate::project_config::{executable_workspace, ProjectConfig, TaskConfig};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::watch;

const DEFAULT_TIMEOUT_SECONDS: u64 = 15 * 60;

#[derive(Default)]
pub struct TaskState {
    cancellations: Mutex<HashMap<String, watch::Sender<bool>>>,
}

impl TaskState {
    pub fn cancel_all(&self) {
        for sender in self.cancellations.lock().values() {
            let _ = sender.send(true);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunStarted {
    pub run_id: String,
    pub requested_task: String,
    pub plan: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStepStarted {
    pub run_id: String,
    pub task: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskOutput {
    pub run_id: String,
    pub task: String,
    pub stream: &'static str,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStepFinished {
    pub run_id: String,
    pub task: String,
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunFinished {
    pub run_id: String,
    pub requested_task: String,
    pub ok: bool,
    pub cancelled: bool,
    pub failed_task: Option<String>,
    pub reason: Option<String>,
}

fn task_plan(config: &ProjectConfig, requested: &str) -> Result<Vec<String>, String> {
    if !config.tasks.contains_key(requested) {
        return Err(format!("unknown task: {requested}"));
    }
    fn visit(
        name: &str,
        config: &ProjectConfig,
        visiting: &mut BTreeSet<String>,
        visited: &mut BTreeSet<String>,
        plan: &mut Vec<String>,
    ) -> Result<(), String> {
        if visited.contains(name) {
            return Ok(());
        }
        if !visiting.insert(name.to_string()) {
            return Err(format!("task dependency cycle at {name}"));
        }
        let task = config
            .tasks
            .get(name)
            .ok_or_else(|| format!("unknown task dependency: {name}"))?;
        for dependency in &task.depends_on {
            visit(dependency, config, visiting, visited, plan)?;
        }
        visiting.remove(name);
        visited.insert(name.to_string());
        plan.push(name.to_string());
        Ok(())
    }

    let mut plan = Vec::new();
    visit(
        requested,
        config,
        &mut BTreeSet::new(),
        &mut BTreeSet::new(),
        &mut plan,
    )?;
    Ok(plan)
}

fn confined_cwd(root: &Path, cwd: Option<&str>) -> Result<PathBuf, String> {
    let candidate = match cwd {
        Some(relative) => {
            let path = Path::new(relative);
            if path.is_absolute()
                || path
                    .components()
                    .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
            {
                return Err("task cwd must stay inside the workspace".to_string());
            }
            root.join(path)
        }
        None => root.to_path_buf(),
    };
    let canonical = std::fs::canonicalize(&candidate)
        .map_err(|e| format!("task cwd does not exist ({}): {e}", candidate.display()))?;
    if !canonical.is_dir() || !canonical.starts_with(root) {
        return Err("task cwd must resolve to a directory inside the workspace".to_string());
    }
    Ok(canonical)
}

fn display_command(task: &TaskConfig) -> String {
    std::iter::once(task.command.as_str())
        .chain(task.args.iter().map(String::as_str))
        .map(|arg| {
            if arg.contains(char::is_whitespace) {
                format!("\"{}\"", arg.replace('"', "\\\""))
            } else {
                arg.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn task_path() -> OsString {
    let separator = if cfg!(windows) { ";" } else { ":" };
    let mut entries = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        entries.push(path.to_string_lossy().into_owned());
    }
    #[cfg(target_os = "macos")]
    entries.extend([
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/Library/TeX/texbin".to_string(),
    ]);
    #[cfg(target_os = "linux")]
    entries.push("/usr/local/bin".to_string());
    OsString::from(entries.join(separator))
}

pub(crate) fn resolve_program(root: &Path, configured: &str) -> Result<PathBuf, String> {
    let path = Path::new(configured);
    if path.components().count() > 1 || path.is_absolute() {
        let candidate = if path.is_absolute() {
            path.to_path_buf()
        } else {
            root.join(path)
        };
        if candidate.is_file() {
            return Ok(candidate);
        }
        return Err(format!("command not found: {}", candidate.display()));
    }
    which::which_in(configured, Some(task_path()), root)
        .map_err(|_| format!("command not found in PATH: {configured}"))
}

fn build_command(task: &TaskConfig, cwd: &Path, program: &Path) -> Command {
    let mut command = Command::new(program);
    command
        .args(&task.args)
        .current_dir(cwd)
        .env("PATH", task_path())
        .envs(&task.env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Put the child in its own process group so cancellation can target helpers
    // it launches (R, Quarto, latexmk, etc.) rather than only the direct child.
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }
    command
}

async fn terminate_process_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await;
        }
        #[cfg(unix)]
        {
            // Negative PID addresses the process group created above.
            let _ = Command::new("kill")
                .args(["-TERM", &format!("-{pid}")])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await;
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn stream_lines<R>(
    reader: R,
    window: tauri::Window,
    run_id: String,
    task: String,
    stream: &'static str,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(text)) = lines.next_line().await {
        let _ = window.emit(
            "task-output",
            TaskOutput {
                run_id: run_id.clone(),
                task: task.clone(),
                stream,
                text,
            },
        );
    }
}

struct StepOutcome {
    ok: bool,
    cancelled: bool,
    exit_code: Option<i32>,
    reason: Option<String>,
}

async fn execute_step(
    window: &tauri::Window,
    run_id: &str,
    name: &str,
    task: &TaskConfig,
    root: &Path,
    cancel: &mut watch::Receiver<bool>,
) -> StepOutcome {
    if *cancel.borrow() {
        return StepOutcome {
            ok: false,
            cancelled: true,
            exit_code: None,
            reason: Some("cancelled".to_string()),
        };
    }
    let cwd = match confined_cwd(root, task.cwd.as_deref()) {
        Ok(cwd) => cwd,
        Err(reason) => {
            return StepOutcome {
                ok: false,
                cancelled: false,
                exit_code: None,
                reason: Some(reason),
            }
        }
    };

    let program = match resolve_program(root, &task.command) {
        Ok(program) => program,
        Err(reason) => {
            return StepOutcome {
                ok: false,
                cancelled: false,
                exit_code: None,
                reason: Some(reason),
            };
        }
    };

    let display = display_command(task);
    let _ = window.emit(
        "task-step-started",
        TaskStepStarted {
            run_id: run_id.to_string(),
            task: name.to_string(),
            command: display,
        },
    );

    let mut child = match build_command(task, &cwd, &program).spawn() {
        Ok(child) => child,
        Err(error) => {
            return StepOutcome {
                ok: false,
                cancelled: false,
                exit_code: None,
                reason: Some(format!("failed to start {}: {error}", task.command)),
            }
        }
    };
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let out_task = tokio::spawn(stream_lines(
        stdout,
        window.clone(),
        run_id.to_string(),
        name.to_string(),
        "stdout",
    ));
    let err_task = tokio::spawn(stream_lines(
        stderr,
        window.clone(),
        run_id.to_string(),
        name.to_string(),
        "stderr",
    ));

    let timeout_seconds = task.timeout_seconds.unwrap_or(DEFAULT_TIMEOUT_SECONDS);
    let timeout = tokio::time::sleep(Duration::from_secs(timeout_seconds));
    tokio::pin!(timeout);

    let outcome = tokio::select! {
        status = child.wait() => match status {
            Ok(status) => StepOutcome {
                ok: status.success(),
                cancelled: false,
                exit_code: status.code(),
                reason: if status.success() { None } else { Some(format!("exited with {}", status.code().map_or_else(|| "signal".to_string(), |c| c.to_string()))) },
            },
            Err(error) => StepOutcome { ok: false, cancelled: false, exit_code: None, reason: Some(format!("wait failed: {error}")) },
        },
        changed = cancel.changed() => {
            let cancelled = changed.is_ok() && *cancel.borrow();
            terminate_process_tree(&mut child).await;
            StepOutcome { ok: false, cancelled, exit_code: None, reason: Some(if cancelled { "cancelled".to_string() } else { "task controller closed".to_string() }) }
        },
        _ = &mut timeout => {
            terminate_process_tree(&mut child).await;
            StepOutcome { ok: false, cancelled: false, exit_code: None, reason: Some(format!("timed out after {timeout_seconds}s")) }
        },
    };

    // A misbehaving command can leave a descendant holding inherited pipe
    // handles after the direct child exits. Do not let that wedge the whole run.
    let mut out_task = out_task;
    let mut err_task = err_task;
    if tokio::time::timeout(Duration::from_secs(2), async {
        let _ = (&mut out_task).await;
        let _ = (&mut err_task).await;
    })
    .await
    .is_err()
    {
        out_task.abort();
        err_task.abort();
    }
    outcome
}

async fn execute_run(
    state: Arc<TaskState>,
    window: tauri::Window,
    run_id: String,
    requested_task: String,
    root: PathBuf,
    config: ProjectConfig,
    plan: Vec<String>,
    mut cancel: watch::Receiver<bool>,
) {
    let mut final_result = TaskRunFinished {
        run_id: run_id.clone(),
        requested_task: requested_task.clone(),
        ok: true,
        cancelled: false,
        failed_task: None,
        reason: None,
    };

    for name in plan {
        let task = config.tasks.get(&name).expect("validated task plan");
        let outcome = execute_step(&window, &run_id, &name, task, &root, &mut cancel).await;
        let _ = window.emit(
            "task-step-finished",
            TaskStepFinished {
                run_id: run_id.clone(),
                task: name.clone(),
                ok: outcome.ok,
                exit_code: outcome.exit_code,
                reason: outcome.reason.clone(),
            },
        );
        if !outcome.ok {
            final_result.ok = false;
            final_result.cancelled = outcome.cancelled;
            final_result.failed_task = Some(name);
            final_result.reason = outcome.reason;
            break;
        }
    }

    state.cancellations.lock().remove(&run_id);
    let _ = window.emit("task-run-finished", final_result);
}

#[tauri::command]
pub async fn start_project_task(
    root: String,
    task: String,
    window: tauri::Window,
    state: tauri::State<'_, Arc<TaskState>>,
) -> Result<TaskRunStarted, String> {
    let workspace = executable_workspace(&root)?;
    let plan = task_plan(&workspace.config, &task)?;
    let run_id = uuid::Uuid::new_v4().to_string();
    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let mut active = state.cancellations.lock();
        if !active.is_empty() {
            return Err("another project task is already running".to_string());
        }
        active.insert(run_id.clone(), cancel_tx);
    }

    let started = TaskRunStarted {
        run_id: run_id.clone(),
        requested_task: task.clone(),
        plan: plan.clone(),
    };
    let _ = window.emit("task-run-started", started.clone());
    let owned_state = state.inner().clone();
    tauri::async_runtime::spawn(execute_run(
        owned_state,
        window,
        run_id,
        task,
        workspace.root,
        workspace.config,
        plan,
        cancel_rx,
    ));
    Ok(started)
}

#[tauri::command]
pub async fn cancel_project_task(
    run_id: String,
    state: tauri::State<'_, Arc<TaskState>>,
) -> Result<bool, String> {
    let sender = state.cancellations.lock().get(&run_id).cloned();
    let Some(sender) = sender else {
        return Ok(false);
    };
    sender
        .send(true)
        .map_err(|_| "task already finished".to_string())?;

    // `cancel` means the process run has ended, not merely that a signal was
    // queued. This makes workspace switching and the Stop button reliable.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        if !state.cancellations.lock().contains_key(&run_id) {
            return Ok(true);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("task cancellation did not finish within 10 seconds".to_string());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tempfile::tempdir;

    fn task(deps: &[&str]) -> TaskConfig {
        TaskConfig {
            command: "echo".to_string(),
            depends_on: deps.iter().map(|x| x.to_string()).collect(),
            ..TaskConfig::default()
        }
    }

    #[test]
    fn plan_orders_dependencies_once() {
        let config = ProjectConfig {
            tasks: BTreeMap::from([
                ("data".to_string(), task(&[])),
                ("tables".to_string(), task(&["data"])),
                ("figures".to_string(), task(&["data"])),
                ("paper".to_string(), task(&["tables", "figures"])),
            ]),
            ..ProjectConfig::default()
        };
        assert_eq!(
            task_plan(&config, "paper").unwrap(),
            ["data", "tables", "figures", "paper"]
        );
    }

    #[test]
    fn plan_rejects_unknown_task() {
        assert!(task_plan(&ProjectConfig::default(), "missing")
            .unwrap_err()
            .contains("unknown task"));
    }

    #[test]
    fn cwd_is_confined_and_canonicalized() {
        let dir = tempdir().unwrap();
        std::fs::create_dir(dir.path().join("scripts")).unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        assert_eq!(
            confined_cwd(&root, Some("scripts")).unwrap(),
            root.join("scripts")
        );
        assert!(confined_cwd(&root, Some("../outside")).is_err());
        assert!(confined_cwd(&root, Some("missing")).is_err());
    }

    #[test]
    fn resolves_workspace_relative_programs_without_a_shell() {
        let dir = tempdir().unwrap();
        let program = dir.path().join("tools").join("runner");
        std::fs::create_dir_all(program.parent().unwrap()).unwrap();
        std::fs::write(&program, b"placeholder").unwrap();
        assert_eq!(
            resolve_program(dir.path(), "tools/runner").unwrap(),
            program
        );
        assert!(resolve_program(dir.path(), "tools/missing").is_err());
    }

    #[test]
    fn command_is_passed_as_argv_not_shell_text() {
        let configured = TaskConfig {
            command: "printf".to_string(),
            args: vec!["hello; touch pwned".to_string()],
            ..TaskConfig::default()
        };
        let display = display_command(&configured);
        assert!(display.contains("hello; touch pwned"));
        let command = build_command(&configured, Path::new("."), Path::new("printf"));
        let debug = format!("{command:?}");
        assert!(!debug.contains("sh -c"));
        assert!(!debug.contains("cmd /C"));
    }
}

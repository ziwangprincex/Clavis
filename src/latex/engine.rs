//! Engine resolution, PATH enrichment, and streaming process execution.

use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

use super::types::{LogLine, RunStart};

pub(crate) const SINGLE_RUN_TIMEOUT: Duration = Duration::from_secs(120);
pub(crate) const SYNCTEX_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) fn resolve_engine(name: &str, custom: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = custom.filter(|s| !s.trim().is_empty()) {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Ok(pb);
        } else {
            return Err(format!("custom path for {name} not found: {p}"));
        }
    }
    if let Ok(p) = which::which(name) {
        return Ok(p);
    }
    // macOS .app bundles inherit a minimal PATH from launchd that does not include
    // /Library/TeX/texbin or Homebrew dirs. Search common locations explicitly.
    if let Some(p) = find_in_fallback_dirs(name) {
        return Ok(p);
    }
    Err(format!("{name} not found in PATH"))
}

pub fn find_in_fallback_dirs(name: &str) -> Option<PathBuf> {
    for dir in fallback_engine_dirs() {
        let candidate = dir.join(if cfg!(windows) { format!("{name}.exe") } else { name.to_string() });
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Build a PATH value enriched with our fallback dirs so that child processes
/// (LaTeX engines invoke kpsewhich/bibtex/makeindex internally) can find their
/// helpers even when the parent .app bundle inherited a minimal launchd PATH.
pub fn enriched_path() -> std::ffi::OsString {
    use std::ffi::OsString;
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut parts: Vec<String> = Vec::new();
    if let Some(p) = std::env::var_os("PATH") {
        parts.push(p.to_string_lossy().into_owned());
    }
    for dir in fallback_engine_dirs() {
        if dir.is_dir() {
            parts.push(dir.to_string_lossy().into_owned());
        }
    }
    OsString::from(parts.join(sep))
}

fn fallback_engine_dirs() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let mut dirs = vec![PathBuf::from("/Library/TeX/texbin")];
        dirs.extend(discover_texlive_dirs("universal-darwin"));
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs
    }
    #[cfg(target_os = "linux")]
    {
        let mut dirs = discover_texlive_dirs("x86_64-linux");
        dirs.extend(discover_texlive_dirs("aarch64-linux"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs
    }
    #[cfg(target_os = "windows")]
    {
        Vec::new()
    }
}

/// Scan /usr/local/texlive for year directories and return bin/<arch> paths,
/// sorted newest-first so the most recent TeX Live wins.
fn discover_texlive_dirs(arch: &str) -> Vec<PathBuf> {
    let base = Path::new("/usr/local/texlive");
    let Ok(entries) = std::fs::read_dir(base) else { return Vec::new() };
    let mut years: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name();
            let s = name.to_string_lossy();
            if s.chars().all(|c| c.is_ascii_digit()) && s.len() == 4 {
                let bin = e.path().join("bin").join(arch);
                if bin.is_dir() { Some(bin) } else { None }
            } else {
                None
            }
        })
        .collect();
    years.sort_unstable_by(|a, b| b.cmp(a));
    years
}

pub(crate) async fn run_streaming(
    program: &Path,
    args: &[&str],
    cwd: &Path,
    font_dirs: &[PathBuf],
    window: &tauri::Window,
    run_idx: u32,
) -> Result<(i32, String), String> {
    let display_cmd = format!(
        "{} {}",
        program.display(),
        args.iter().map(|a| {
            if a.contains(' ') { format!("\"{a}\"") } else { (*a).to_string() }
        }).collect::<Vec<_>>().join(" ")
    );
    let _ = window.emit("latex-run-start", RunStart { run: run_idx, command: display_cmd.clone() });

    let mut cmd = TokioCommand::new(program);
    let mut os_font_dir_parts = vec![cwd.to_path_buf()];
    for dir in font_dirs {
        if !os_font_dir_parts.iter().any(|d| d == dir) {
            os_font_dir_parts.push(dir.clone());
        }
    }
    let sep = if cfg!(windows) { ";" } else { ":" };
    let os_font_dir = os_font_dir_parts
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(sep);
    cmd.args(args)
        .current_dir(cwd)
        .env("PATH", enriched_path())
        .env("OSFONTDIR", os_font_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let win_out = window.clone();
    let win_err = window.clone();

    let mut combined = String::new();

    // Stream stdout
    // Bounded channel: senders await when receiver falls behind so a chatty
    // engine (thousands of log lines) can't balloon RSS.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(&'static str, String)>(1024);
    let tx2 = tx.clone();
    tokio::spawn(async move {
        let mut r = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = r.next_line().await {
            let _ = win_out.emit("latex-log", LogLine { run: run_idx, stream: "stdout", text: line.clone() });
            if tx.send(("stdout", line)).await.is_err() { break; }
        }
    });
    tokio::spawn(async move {
        let mut r = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = r.next_line().await {
            let _ = win_err.emit("latex-log", LogLine { run: run_idx, stream: "stderr", text: line.clone() });
            if tx2.send(("stderr", line)).await.is_err() { break; }
        }
    });

    let collector = tokio::spawn(async move {
        let mut acc = String::new();
        while let Some((_, line)) = rx.recv().await {
            acc.push_str(&line);
            acc.push('\n');
        }
        acc
    });

    // Wait for child with timeout
    let status = match timeout(SINGLE_RUN_TIMEOUT, child.wait()).await {
        Ok(s) => s.map_err(|e| format!("wait failed: {e}"))?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(format!("engine timed out after {}s", SINGLE_RUN_TIMEOUT.as_secs()));
        }
    };

    // Drain remaining output
    if let Ok(s) = collector.await {
        combined.push_str(&s);
    }

    Ok((status.code().unwrap_or(-1), combined))
}

pub(crate) async fn run_synctex(prog: &Path, args: &[&str], cwd: &Path) -> Result<String, String> {
    let mut cmd = TokioCommand::new(prog);
    cmd.args(args)
        .current_dir(cwd)
        .env("PATH", enriched_path())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());
    let child = cmd.spawn().map_err(|e| format!("synctex spawn: {e}"))?;
    let out = match timeout(SYNCTEX_TIMEOUT, child.wait_with_output()).await {
        Ok(o) => o.map_err(|e| format!("synctex wait: {e}"))?,
        Err(_) => return Err("synctex timed out".into()),
    };
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

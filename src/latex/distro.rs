//! TeX distribution detection and (user-confirmed) package installation.

use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

use super::engine::{enriched_path, find_in_fallback_dirs};
use super::types::LogLine;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistroInfo {
    pub name: String,            // "miktex" | "texlive" | "unknown"
    pub manager: String,         // "miktex" | "mpm" | "tlmgr" | "none"
    pub manager_path: Option<String>,
    pub version: Option<String>,
}

#[tauri::command]
pub fn detect_distro(engine_path: Option<String>) -> DistroInfo {
    // Try to identify by running --version on the LaTeX engine first.
    let engine = engine_path
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| which::which("pdflatex").ok())
        .or_else(|| which::which("xelatex").ok())
        .or_else(|| which::which("lualatex").ok())
        .or_else(|| find_in_fallback_dirs("pdflatex"))
        .or_else(|| find_in_fallback_dirs("xelatex"))
        .or_else(|| find_in_fallback_dirs("lualatex"));

    let mut version = None;
    let mut name = "unknown";
    if let Some(p) = engine {
        if let Ok(o) = std::process::Command::new(&p).arg("--version").output() {
            let s = String::from_utf8_lossy(&o.stdout).to_string();
            let head = s.lines().take(3).collect::<Vec<_>>().join(" / ");
            version = Some(head.clone());
            let lo = head.to_lowercase();
            if lo.contains("miktex") { name = "miktex"; }
            else if lo.contains("tex live") || lo.contains("texlive") { name = "texlive"; }
        }
    }
    let (manager, manager_path) = match name {
        "miktex" => {
            // Prefer modern `miktex packages install`, fallback to `mpm`
            if let Some(p) = which::which("miktex").ok().or_else(|| find_in_fallback_dirs("miktex")) {
                ("miktex".to_string(), Some(p.to_string_lossy().to_string()))
            } else if let Some(p) = which::which("mpm").ok().or_else(|| find_in_fallback_dirs("mpm")) {
                ("mpm".to_string(), Some(p.to_string_lossy().to_string()))
            } else {
                ("none".to_string(), None)
            }
        }
        "texlive" => {
            if let Some(p) = which::which("tlmgr").ok().or_else(|| find_in_fallback_dirs("tlmgr")) {
                ("tlmgr".to_string(), Some(p.to_string_lossy().to_string()))
            } else {
                ("none".to_string(), None)
            }
        }
        _ => ("none".to_string(), None),
    };
    DistroInfo {
        name: name.to_string(),
        manager,
        manager_path,
        version,
    }
}

const PKG_INSTALL_TIMEOUT: Duration = Duration::from_secs(300);

#[tauri::command]
pub async fn install_package(
    manager: String,
    name: String,
    window: tauri::Window,
) -> Result<(), String> {
    // Whitelist: package names are typically [A-Za-z0-9._+-]
    if name.is_empty()
        || name.len() > 80
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
    {
        return Err(format!("invalid package name: {name}"));
    }

    let (program, args): (PathBuf, Vec<String>) = match manager.as_str() {
        "miktex" => {
            let p = which::which("miktex").ok()
                .or_else(|| find_in_fallback_dirs("miktex"))
                .ok_or_else(|| "miktex not in PATH".to_string())?;
            (p, vec!["packages".into(), "install".into(), name.clone()])
        }
        "mpm" => {
            let p = which::which("mpm").ok()
                .or_else(|| find_in_fallback_dirs("mpm"))
                .ok_or_else(|| "mpm not in PATH".to_string())?;
            (p, vec!["--verbose".into(), format!("--install={name}")])
        }
        "tlmgr" => {
            let p = which::which("tlmgr").ok()
                .or_else(|| find_in_fallback_dirs("tlmgr"))
                .ok_or_else(|| "tlmgr not in PATH".to_string())?;
            (p, vec!["install".into(), name.clone()])
        }
        other => return Err(format!("unknown package manager: {other}")),
    };

    let display_cmd = format!("{} {}", program.display(), args.join(" "));
    let _ = window.emit("latex-log", LogLine {
        run: 0,
        stream: "info",
        text: format!("[install] {display_cmd}"),
    });

    let mut cmd = TokioCommand::new(&program);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    cmd.args(&arg_refs)
        .env("PATH", enriched_path())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("install spawn: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let win_o = window.clone();
    let win_e = window.clone();
    tokio::spawn(async move {
        let mut r = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = r.next_line().await {
            let _ = win_o.emit("latex-log", LogLine { run: 0, stream: "stdout", text: line });
        }
    });
    tokio::spawn(async move {
        let mut r = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = r.next_line().await {
            let _ = win_e.emit("latex-log", LogLine { run: 0, stream: "stderr", text: line });
        }
    });

    let status = match timeout(PKG_INSTALL_TIMEOUT, child.wait()).await {
        Ok(s) => s.map_err(|e| format!("install wait: {e}"))?,
        Err(_) => {
            let _ = child.kill().await;
            return Err("install timed out".into());
        }
    };
    if !status.success() {
        return Err(format!("installer exited with code {:?}", status.code()));
    }
    Ok(())
}

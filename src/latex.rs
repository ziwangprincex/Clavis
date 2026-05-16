//! Real LaTeX compilation via system pdflatex / xelatex / lualatex.
//!
//! Features:
//! - Streaming logs over Tauri events (`latex-log`, `latex-run-start`, `latex-done`)
//! - Auto rerun for cross references and BibTeX/biber
//! - Configurable engine + custom path
//! - SyncTeX forward / backward via the `synctex` CLI
//! - Workdir registry keyed by token so SyncTeX can find the .synctex.gz later

use base64::Engine as _;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

const SINGLE_RUN_TIMEOUT: Duration = Duration::from_secs(60);
const TOTAL_COMPILE_TIMEOUT: Duration = Duration::from_secs(180);
const SYNCTEX_TIMEOUT: Duration = Duration::from_secs(10);
const MAIN_TEX: &str = "main.tex";
const MAIN_PDF: &str = "main.pdf";

// ---------------- Workdir registry ----------------

#[derive(Default)]
pub struct LatexState {
    pub workdirs: Mutex<HashMap<String, Arc<TempDir>>>,
}

impl LatexState {
    pub fn get(&self, token: &str) -> Option<Arc<TempDir>> {
        self.workdirs.lock().get(token).cloned()
    }
    pub fn insert(&self, token: String, dir: TempDir) {
        self.workdirs.lock().insert(token, Arc::new(dir));
    }
    pub fn remove(&self, token: &str) {
        self.workdirs.lock().remove(token);
    }
    pub fn clear(&self) {
        self.workdirs.lock().clear();
    }
}

// ---------------- IPC types ----------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileOptions {
    pub source: String,
    pub engine: String,
    #[serde(default)]
    pub custom_path: Option<String>,
    #[serde(default)]
    pub bib_engine: Option<String>, // "auto" | "bibtex" | "biber" | "none"
    #[serde(default = "default_true")]
    pub auto_rerun: bool,
    #[serde(default = "default_max_runs")]
    pub max_runs: u32,
    #[serde(default = "default_true")]
    pub synctex: bool,
    #[serde(default)]
    pub workdir_token: Option<String>,
    /// Multi-file project: relative paths + content for every auxiliary file.
    /// `main.tex` is overwritten by `source`; do not include it here.
    #[serde(default)]
    pub project_files: Vec<ProjectFile>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    /// Relative path inside the workdir (e.g. "chapters/intro.tex"). Must not escape root.
    pub rel_path: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary_base64: Option<String>,
}

fn default_true() -> bool { true }
fn default_max_runs() -> u32 { 4 }

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub ok: bool,
    pub pdf_base64: Option<String>,
    pub errors: Vec<LatexDiag>,
    pub log_tail: String,
    pub runs: u32,
    pub workdir_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexDiag {
    pub line: Option<u32>,
    pub message: String,
    pub kind: &'static str, // "error" | "warning" | "badbox" | "missing-ref" | "missing-file"
    /// For `missing-file`: the inferred package or file name (without extension).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogLine {
    run: u32,
    stream: &'static str, // "stdout" | "stderr" | "info"
    text: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RunStart {
    run: u32,
    command: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTexHit {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub h: f64,
    pub v: f64,
    pub w: f64,
    pub height: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTexEdit {
    pub line: u32,
    pub column: u32,
    pub input_file: String,
}

// ---------------- Helpers ----------------

fn resolve_engine(name: &str, custom: Option<&str>) -> Result<PathBuf, String> {
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
fn enriched_path() -> std::ffi::OsString {
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
        vec![
            PathBuf::from("/Library/TeX/texbin"),
            PathBuf::from("/usr/local/texlive/2026/bin/universal-darwin"),
            PathBuf::from("/usr/local/texlive/2025/bin/universal-darwin"),
            PathBuf::from("/usr/local/texlive/2024/bin/universal-darwin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        vec![
            PathBuf::from("/usr/local/texlive/2026/bin/x86_64-linux"),
            PathBuf::from("/usr/local/texlive/2025/bin/x86_64-linux"),
            PathBuf::from("/usr/local/bin"),
        ]
    }
    #[cfg(target_os = "windows")]
    {
        Vec::new()
    }
}

fn detect_bib_kind(source: &str) -> Option<&'static str> {
    if source.contains("\\addbibresource") {
        Some("biber")
    } else if source.contains("\\bibliography{") {
        Some("bibtex")
    } else {
        None
    }
}

fn rerun_signal(text: &str) -> bool {
    text.contains("Rerun to get cross-references right")
        || text.contains("Label(s) may have changed")
        || text.contains("Rerun LaTeX")
        || text.contains("Please rerun LaTeX")
        || text.contains("Citation")
            && (text.contains("undefined") || text.contains("on page"))
}

/// Classify a log message text (without the leading `file.tex:NN:` if any).
/// Returns (kind, package_if_missing_file).
fn classify_message(msg: &str) -> (&'static str, Option<String>) {
    if let Some(pkg) = extract_missing_pkg(msg) {
        return ("missing-file", Some(pkg));
    }
    let lo = msg.to_ascii_lowercase();
    if lo.starts_with("latex warning") || lo.starts_with("package ") && lo.contains("warning") {
        return ("warning", None);
    }
    if lo.starts_with("overfull \\") || lo.starts_with("underfull \\") {
        return ("badbox", None);
    }
    ("error", None)
}

fn parse_diags(log: &str) -> Vec<LatexDiag> {
    use regex::Regex;
    let re_file_line = Regex::new(r"^(?:\./)?[^:\n]*\.tex:(\d+):\s*(.*)$").unwrap();
    let re_latex_err = Regex::new(r"^! LaTeX Error:\s*(.*)$").unwrap();
    let re_package_err = Regex::new(r"^! Package\s+([A-Za-z0-9._-]+)\s+Error:\s*(.*)$").unwrap();
    let re_font_err = Regex::new(r"^! Font\s+([A-Za-z0-9._-]+)\s+Error:\s*(.*)$").unwrap();
    let re_generic_err = Regex::new(r"^!\s*(.*\S)\s*$").unwrap();
    let re_warn = Regex::new(r"^LaTeX Warning:\s*(.*?)(?:\s+on input line\s+(\d+))?\.?\s*$").unwrap();
    let re_badbox = Regex::new(r"^(Overfull|Underfull) \\(?:hbox|vbox)\b.*$").unwrap();
    let re_bibtex_db = Regex::new(r"I couldn't open database file\s+(.+)$").unwrap();
    // Missing files: handle a few common phrasings across MiKTeX / TeX Live.
    let re_file_not_found = Regex::new(r"(?i)!?\s*(?:LaTeX Error:\s*)?File\s+[`'](.+?)['`]\s+not found").unwrap();
    let re_miktex = Regex::new(r"(?i)the\s+package\s+(\S+?)\s+(?:is\s+)?(?:not\s+installed|could\s+not\s+be\s+found)").unwrap();

    let mut out = Vec::new();
    for line in log.lines() {
        if let Some(c) = re_file_line.captures(line) {
            // -file-line-error wraps almost every diagnostic as "main.tex:N: ...";
            // classify by the inner message, not by the wrapper.
            let line_no = c.get(1).and_then(|m| m.as_str().parse().ok());
            let msg = c.get(2).map_or("", |m| m.as_str()).trim().to_string();
            let (kind, package) = classify_message(&msg);
            out.push(LatexDiag { line: line_no, message: msg, kind, package });
        } else if let Some(c) = re_file_not_found.captures(line) {
            let raw = c.get(1).map(|m| m.as_str()).unwrap_or("");
            let pkg = strip_known_ext(raw);
            out.push(LatexDiag {
                line: None,
                message: format!("File `{raw}' not found"),
                kind: "missing-file",
                package: Some(pkg),
            });
        } else if let Some(c) = re_miktex.captures(line) {
            let raw = c.get(1).map(|m| m.as_str()).unwrap_or("?").to_string();
            out.push(LatexDiag {
                line: None,
                message: format!("MiKTeX: package {raw} not installed"),
                kind: "missing-file",
                package: Some(raw),
            });
        } else if let Some(c) = re_latex_err.captures(line) {
            let msg = c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let (kind, package) = classify_message(&msg);
            out.push(LatexDiag { line: None, message: msg, kind, package });
        } else if let Some(c) = re_package_err.captures(line) {
            let package = c.get(1).map(|m| m.as_str().to_string());
            let msg = c.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            let (kind, _) = classify_message(&msg);
            out.push(LatexDiag { line: None, message: format!("Package {} Error: {}", package.as_deref().unwrap_or("?"), msg), kind, package });
        } else if let Some(c) = re_font_err.captures(line) {
            let package = c.get(1).map(|m| m.as_str().to_string());
            let msg = c.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            out.push(LatexDiag { line: None, message: format!("Font {} Error: {}", package.as_deref().unwrap_or("?"), msg), kind: "missing-file", package });
        } else if let Some(c) = re_generic_err.captures(line) {
            let msg = c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let (kind, package) = classify_message(&msg);
            out.push(LatexDiag { line: None, message: msg, kind, package });
        } else if let Some(c) = re_warn.captures(line) {
            out.push(LatexDiag {
                line: c.get(2).and_then(|m| m.as_str().parse().ok()),
                message: c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                kind: "warning",
                package: None,
            });
        } else if re_badbox.is_match(line) {
            out.push(LatexDiag {
                line: None,
                message: line.trim().to_string(),
                kind: "badbox",
                package: None,
            });
        } else if let Some(c) = re_bibtex_db.captures(line) {
            out.push(LatexDiag {
                line: None,
                message: format!("Missing bibliography database: {}", c.get(1).map(|m| m.as_str()).unwrap_or("?")),
                kind: "missing-ref",
                package: None,
            });
        }
    }
    out.dedup_by(|a, b| a.kind == b.kind && a.package == b.package && a.message == b.message);
    out
}

fn strip_known_ext(name: &str) -> String {
    let n = name.trim();
    for ext in [".sty", ".cls", ".bst", ".def", ".cfg", ".fd", ".tfm", ".tex", ".ltx"] {
        if let Some(stem) = n.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    n.to_string()
}

fn extract_missing_pkg(msg: &str) -> Option<String> {
    // "File `xxx.sty' not found." inside a message
    let re = regex::Regex::new(r"File\s+[`'](.+?)['`]\s+not found").unwrap();
    let cap = re.captures(msg)?;
    Some(strip_known_ext(cap.get(1)?.as_str()))
}

fn log_tail(log: &str) -> String {
    const MAX: usize = 8 * 1024;
    if log.len() <= MAX {
        log.to_string()
    } else {
        let start = log.len() - MAX;
        // align to a char boundary
        let mut s = start;
        while s < log.len() && !log.is_char_boundary(s) {
            s += 1;
        }
        format!("...[{} bytes truncated]...\n{}", start, &log[s..])
    }
}

async fn run_streaming(
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
    let os_font_dir = os_font_dir_parts
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(":" );
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
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(&'static str, String)>();
    let tx2 = tx.clone();
    tokio::spawn(async move {
        let mut r = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = r.next_line().await {
            let _ = win_out.emit("latex-log", LogLine { run: run_idx, stream: "stdout", text: line.clone() });
            let _ = tx.send(("stdout", line));
        }
    });
    tokio::spawn(async move {
        let mut r = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = r.next_line().await {
            let _ = win_err.emit("latex-log", LogLine { run: run_idx, stream: "stderr", text: line.clone() });
            let _ = tx2.send(("stderr", line));
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

// ---------------- Commands ----------------

#[tauri::command]
pub async fn compile_latex(
    opts: CompileOptions,
    window: tauri::Window,
    state: tauri::State<'_, LatexState>,
) -> Result<CompileResult, String> {
    // Reuse existing workdir if token provided & still alive.
    let (workdir_arc, token) = match opts
        .workdir_token
        .as_deref()
        .and_then(|t| state.get(t).map(|d| (t.to_string(), d)))
    {
        Some((tok, arc)) => (arc, tok),
        None => {
            let dir = TempDir::new().map_err(|e| format!("tempdir: {e}"))?;
            let token = uuid::Uuid::new_v4().to_string();
            state.insert(token.clone(), dir);
            // re-fetch the Arc we just inserted
            let arc = state.get(&token).ok_or_else(|| "workdir vanished".to_string())?;
            (arc, token)
        }
    };
    let workdir = workdir_arc.path().to_path_buf();

    // Write project files first (auxiliary files). Skip any whose rel_path equals MAIN_TEX
    // (main.tex is always written from `source`).
    for pf in &opts.project_files {
        if !is_safe_relpath(&pf.rel_path) {
            return Ok(CompileResult {
                ok: false,
                errors: vec![LatexDiag {
                    line: None,
                    message: format!("rejected unsafe relative path: {}", pf.rel_path),
                    kind: "error",
                    package: None,
                }],
                workdir_token: Some(token),
                ..Default::default()
            });
        }
        if pf.rel_path == MAIN_TEX { continue; }
        let dst = workdir.join(&pf.rel_path);
        if let Some(parent) = dst.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Some(b64) = &pf.binary_base64 {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64.as_bytes())
                .map_err(|e| format!("decode {}: {e}", pf.rel_path))?;
            std::fs::write(&dst, &bytes)
                .map_err(|e| format!("write {}: {e}", pf.rel_path))?;

            let ext = Path::new(&pf.rel_path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if is_font_like_ext(&ext) {
                if let Some(name) = Path::new(&pf.rel_path).file_name().and_then(|n| n.to_str()) {
                    let alias = workdir.join(name);
                    if alias != dst {
                        let _ = std::fs::write(alias, &bytes);
                    }
                }
            }
        } else {
            std::fs::write(&dst, pf.content.as_bytes())
                .map_err(|e| format!("write {}: {e}", pf.rel_path))?;
        }
    }

    let has_local_fonts = opts.project_files.iter().any(|pf| {
        if pf.binary_base64.is_none() { return false; }
        let ext = Path::new(&pf.rel_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        is_font_like_ext(&ext)
    });
    if let Err(e) = write_local_cjk_font_shim(&workdir, &opts.source, has_local_fonts) {
        return Ok(CompileResult {
            ok: false,
            errors: vec![LatexDiag { line: None, message: format!("write cjk shim: {e}"), kind: "error", package: None }],
            workdir_token: Some(token),
            ..Default::default()
        });
    }

    // Write main.tex (always from `source`).
    let tex_path = workdir.join(MAIN_TEX);
    std::fs::write(&tex_path, opts.source.as_bytes())
        .map_err(|e| format!("write main.tex: {e}"))?;

    let engine_path = match resolve_engine(&opts.engine, opts.custom_path.as_deref()) {
        Ok(p) => p,
        Err(e) => {
            return Ok(CompileResult {
                ok: false,
                errors: vec![LatexDiag { line: None, message: e, kind: "error", package: None }],
                workdir_token: Some(token),
                ..Default::default()
            });
        }
    };

    // Build arg vector (tex filename last; Path-based outputs)
    let synctex_arg = if opts.synctex { "-synctex=1" } else { "-synctex=0" };
    let outdir_arg = format!("-output-directory={}", workdir.display());

    let mut log_full = String::new();
    let mut runs: u32 = 0;
    let max_runs = opts.max_runs.max(1).min(8);
    let mut font_dirs: Vec<PathBuf> = Vec::new();
    for pf in &opts.project_files {
        if !pf.binary_base64.is_some() { continue; }
        let ext = Path::new(&pf.rel_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !is_font_like_ext(&ext) { continue; }
        if let Some(parent) = Path::new(&pf.rel_path).parent() {
            let dir = workdir.join(parent);
            if !font_dirs.iter().any(|d| d == &dir) {
                font_dirs.push(dir);
            }
        }
    }

    let bib_choice = opts.bib_engine.clone().unwrap_or_else(|| "auto".to_string());
    let want_bib = match bib_choice.as_str() {
        "none" => None,
        "bibtex" => Some("bibtex"),
        "biber" => Some("biber"),
        _ => {
            let mut detected = detect_bib_kind(&opts.source);
            if detected.is_none() {
                for pf in &opts.project_files {
                    detected = detect_bib_kind(&pf.content);
                    if detected.is_some() { break; }
                }
            }
            detected
        }
    };

    let started = std::time::Instant::now();
    let mut bib_done = false;

    while runs < max_runs {
        if started.elapsed() > TOTAL_COMPILE_TIMEOUT {
            log_full.push_str("\n[clavis] total compile timeout exceeded\n");
            break;
        }
        runs += 1;
        let args: Vec<&str> = vec![
            "-interaction=nonstopmode",
            "-halt-on-error",
            synctex_arg,
            "-file-line-error",
            &outdir_arg,
            MAIN_TEX,
        ];
        let (code, out) = match run_streaming(&engine_path, &args, &workdir, &font_dirs, &window, runs).await {
            Ok(r) => r,
            Err(e) => {
                log_full.push_str(&format!("\n[clavis] {}\n", e));
                let _ = window.emit("latex-done", serde_json::json!({ "ok": false, "runs": runs }));
                return Ok(CompileResult {
                    ok: false,
                    errors: vec![LatexDiag { line: None, message: e, kind: "error", package: None }],
                    log_tail: log_tail(&log_full),
                    runs,
                    workdir_token: Some(token),
                    ..Default::default()
                });
            }
        };
        log_full.push_str(&out);

        let success = code == 0 && workdir.join(MAIN_PDF).exists();

        // After first run, optionally invoke bibtex/biber once.
        if runs == 1 && !bib_done {
            if let Some(bib_name) = want_bib {
                match resolve_engine(bib_name, None) {
                    Ok(bib_path) => {
                        let bib_args: Vec<String> = if bib_name == "biber" {
                            vec![format!("--output-directory={}", workdir.display()), "main".to_string()]
                        } else {
                            // bibtex needs the .aux path; cwd-relative is fine since output-directory == cwd here
                            vec!["main".to_string()]
                        };
                        let bib_args_ref: Vec<&str> = bib_args.iter().map(|s| s.as_str()).collect();
                        match run_streaming(&bib_path, &bib_args_ref, &workdir, &font_dirs, &window, runs).await {
                            Ok((_c, bo)) => log_full.push_str(&bo),
                            Err(e) => log_full.push_str(&format!("\n[clavis] {bib_name} failed: {e}\n")),
                        }
                        bib_done = true;
                        continue; // force at least one more LaTeX run
                    }
                    Err(e) => {
                        log_full.push_str(&format!("\n[clavis] {bib_name} not available: {e}\n"));
                        bib_done = true;
                    }
                }
            }
        }

        if !opts.auto_rerun {
            // Single shot mode: stop after first run regardless of warnings.
            let _ = window.emit("latex-done", serde_json::json!({ "ok": success, "runs": runs }));
            let errors = parse_diags(&log_full);
            let pdf = if success { read_pdf(&workdir) } else { None };
            return Ok(CompileResult {
                ok: success && pdf.is_some(),
                pdf_base64: pdf,
                errors,
                log_tail: log_tail(&log_full),
                runs,
                workdir_token: Some(token),
            });
        }

        if !success {
            // No PDF: stop, surface errors.
            break;
        }

        if !rerun_signal(&out) {
            break;
        }
    }

    let success = workdir.join(MAIN_PDF).exists();
    let _ = window.emit("latex-done", serde_json::json!({ "ok": success, "runs": runs }));

    let errors = parse_diags(&log_full);
    let pdf = if success { read_pdf(&workdir) } else { None };
    Ok(CompileResult {
        ok: success && pdf.is_some(),
        pdf_base64: pdf,
        errors,
        log_tail: log_tail(&log_full),
        runs,
        workdir_token: Some(token),
    })
}

fn read_pdf(workdir: &Path) -> Option<String> {
    let bytes = std::fs::read(workdir.join(MAIN_PDF)).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn synctex_forward(
    workdir_token: String,
    line: u32,
    column: u32,
    state: tauri::State<'_, LatexState>,
) -> Result<SyncTexHit, String> {
    let dir = state.get(&workdir_token).ok_or_else(|| "unknown workdir".to_string())?;
    let workdir = dir.path().to_path_buf();
    let synctex = which::which("synctex").ok()
        .or_else(|| find_in_fallback_dirs("synctex"))
        .ok_or_else(|| "synctex not in PATH".to_string())?;
    let i_arg = format!("{}:{}:{}", line, column, MAIN_TEX);
    let pdf = MAIN_PDF.to_string();
    let out = run_synctex(&synctex, &["view", "-i", &i_arg, "-o", &pdf], &workdir).await?;

    // Pick the FIRST block (the engine emits one per match).
    let mut hit: Option<SyncTexHit> = None;
    let mut cur = SyncTexAcc::default();
    for raw in out.lines() {
        let l = raw.trim();
        if l == "SyncTeX result begin" || l == "SyncTeX result end" {
            if !cur.is_empty() {
                if let Some(h) = cur.take_view() { hit = Some(h); break; }
            }
            continue;
        }
        cur.feed(l);
    }
    if hit.is_none() {
        if let Some(h) = cur.take_view() { hit = Some(h); }
    }
    hit.ok_or_else(|| "no SyncTeX hit".to_string())
}

#[tauri::command]
pub async fn synctex_backward(
    workdir_token: String,
    page: u32,
    x: f64,
    y: f64,
    state: tauri::State<'_, LatexState>,
) -> Result<SyncTexEdit, String> {
    let dir = state.get(&workdir_token).ok_or_else(|| "unknown workdir".to_string())?;
    let workdir = dir.path().to_path_buf();
    let synctex = which::which("synctex").ok()
        .or_else(|| find_in_fallback_dirs("synctex"))
        .ok_or_else(|| "synctex not in PATH".to_string())?;
    let o_arg = format!("{}:{}:{}:{}", page, x, y, MAIN_PDF);
    let out = run_synctex(&synctex, &["edit", "-o", &o_arg], &workdir).await?;

    let mut edit: Option<SyncTexEdit> = None;
    let mut cur = SyncTexAcc::default();
    for raw in out.lines() {
        let l = raw.trim();
        if l == "SyncTeX result begin" || l == "SyncTeX result end" {
            if !cur.is_empty() {
                if let Some(e) = cur.take_edit() { edit = Some(e); break; }
            }
            continue;
        }
        cur.feed(l);
    }
    if edit.is_none() {
        if let Some(e) = cur.take_edit() { edit = Some(e); }
    }
    edit.ok_or_else(|| "no SyncTeX backward hit".to_string())
}

#[tauri::command]
pub fn cleanup_workdir(workdir_token: String, state: tauri::State<'_, LatexState>) -> Result<(), String> {
    state.remove(&workdir_token);
    Ok(())
}

/// Copy the most recent compile's main.pdf out of the working dir into a user-chosen path.
#[tauri::command]
pub fn export_latex_pdf(
    workdir_token: String,
    target_path: String,
    state: tauri::State<'_, LatexState>,
) -> Result<(), String> {
    let dir = state.get(&workdir_token).ok_or_else(|| "no compiled output (compile first)".to_string())?;
    let src = dir.path().join(MAIN_PDF);
    if !src.exists() {
        return Err("main.pdf not found — compile may have failed".to_string());
    }
    std::fs::copy(&src, &target_path).map_err(|e| format!("copy failed: {e}"))?;
    Ok(())
}

/// Read the full TeX `.log` file from the most recent compile's workdir.
#[tauri::command]
pub fn read_latex_log(
    workdir_token: String,
    state: tauri::State<'_, LatexState>,
) -> Result<String, String> {
    let dir = state.get(&workdir_token).ok_or_else(|| "no workdir (compile first)".to_string())?;
    let log_path = dir.path().join("main.log");
    if !log_path.exists() {
        return Err("main.log not found — compile may have failed before writing log".to_string());
    }
    // The log can contain non-UTF-8 bytes (font names with weird encodings); read lossy.
    let bytes = std::fs::read(&log_path).map_err(|e| format!("read failed: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

async fn run_synctex(prog: &Path, args: &[&str], cwd: &Path) -> Result<String, String> {
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

#[derive(Default)]
struct SyncTexAcc {
    page: Option<u32>,
    x: Option<f64>,
    y: Option<f64>,
    h: Option<f64>,
    v: Option<f64>,
    w: Option<f64>,
    height: Option<f64>,
    line: Option<u32>,
    column: Option<u32>,
    input: Option<String>,
}

impl SyncTexAcc {
    fn is_empty(&self) -> bool {
        self.page.is_none() && self.line.is_none()
    }
    fn feed(&mut self, l: &str) {
        if let Some(v) = l.strip_prefix("Page:") { self.page = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("x:") { self.x = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("y:") { self.y = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("h:") { self.h = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("v:") { self.v = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("W:") { self.w = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("H:") { self.height = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("Line:") { self.line = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("Column:") { self.column = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("Input:") { self.input = Some(v.trim().to_string()); }
    }
    fn take_view(&mut self) -> Option<SyncTexHit> {
        let page = self.page.take()?;
        Some(SyncTexHit {
            page,
            x: self.x.take().unwrap_or(0.0),
            y: self.y.take().unwrap_or(0.0),
            h: self.h.take().unwrap_or(0.0),
            v: self.v.take().unwrap_or(0.0),
            w: self.w.take().unwrap_or(0.0),
            height: self.height.take().unwrap_or(0.0),
        })
    }
    fn take_edit(&mut self) -> Option<SyncTexEdit> {
        let line = self.line.take()?;
        Some(SyncTexEdit {
            line,
            column: self.column.take().unwrap_or(0),
            input_file: self.input.take().unwrap_or_default(),
        })
    }
}

// ---------------- Distribution detection + package install ----------------

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

// ---------------- Multi-file project collection ----------------

const MAX_PROJECT_FILES: usize = 200;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_DEPTH: u32 = 5;

/// Reject paths that escape the project root or contain absolute components.
fn is_safe_relpath(rel: &str) -> bool {
    if rel.is_empty() { return false; }
    let p = Path::new(rel);
    if p.is_absolute() { return false; }
    for comp in p.components() {
        match comp {
            std::path::Component::Normal(_) => {}
            _ => return false, // ParentDir, RootDir, Prefix, CurDir all rejected
        }
    }
    true
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectedFile {
    pub rel_path: String,
    pub abs_path: String,
    pub content: String,
    pub is_bib: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary_base64: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectResult {
    pub root_rel: String,
    pub files: Vec<CollectedFile>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn collect_project_files(root: String) -> Result<CollectResult, String> {
    let root_path = std::fs::canonicalize(&root).map_err(|e| format!("canonicalize root: {e}"))?;
    if !root_path.is_file() {
        return Err(format!("not a file: {}", root_path.display()));
    }
    let root_dir = root_path.parent().ok_or_else(|| "no parent dir".to_string())?.to_path_buf();
    let root_dir_canon = std::fs::canonicalize(&root_dir).map_err(|e| format!("canon dir: {e}"))?;

    let mut warnings = Vec::new();
    let mut visited: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut out: Vec<CollectedFile> = Vec::new();

    let root_basename = root_path.file_name().and_then(|s| s.to_str()).unwrap_or("main.tex").to_string();

    fn read_text(p: &Path) -> Option<String> {
        let meta = std::fs::metadata(p).ok()?;
        if meta.len() > MAX_FILE_BYTES { return None; }
        std::fs::read_to_string(p).ok()
    }

    fn read_binary(p: &Path) -> Option<String> {
        let meta = std::fs::metadata(p).ok()?;
        if meta.len() > MAX_FILE_BYTES { return None; }
        let bytes = std::fs::read(p).ok()?;
        Some(base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    fn rel_from(base: &Path, full: &Path) -> Option<String> {
        full.strip_prefix(base).ok()
            .map(|p| p.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
    }

    fn binary_ext(ext: &str) -> bool {
        matches!(ext,
            "otf" | "ttf" | "ttc" | "otc" | "woff" | "woff2" |
            "pfb" | "afm" | "pfm" | "vf" | "tfm" |
            "png" | "jpg" | "jpeg" | "gif" | "pdf" | "eps"
        )
    }

    fn add_file(
        canon: PathBuf,
        root_dir_canon: &Path,
        visited: &mut std::collections::HashSet<PathBuf>,
        out: &mut Vec<CollectedFile>,
        warnings: &mut Vec<String>,
    ) {
        if visited.contains(&canon) { return; }
        let ext = canon.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let Some(rel) = rel_from(root_dir_canon, &canon) else { return };
        let is_bib = ext == "bib";
        let binary_base64 = if binary_ext(&ext) { read_binary(&canon) } else { None };
        let content = if binary_base64.is_some() {
            String::new()
        } else {
            match read_text(&canon) {
                Some(c) => c,
                None => {
                    warnings.push(format!("could not read or too large: {}", canon.display()));
                    return;
                }
            }
        };
        visited.insert(canon.clone());
        out.push(CollectedFile {
            rel_path: rel,
            abs_path: canon.to_string_lossy().to_string(),
            content,
            is_bib,
            binary_base64,
        });
    }

    // BFS
    let mut stack: Vec<(PathBuf, u32)> = vec![(root_path.clone(), 0)];
    let root_content = match read_text(&root_path) {
        Some(c) => c,
        None => return Err("cannot read root file".into()),
    };
    out.push(CollectedFile {
        rel_path: root_basename.clone(),
        abs_path: root_path.to_string_lossy().to_string(),
        content: root_content,
        is_bib: false,
        binary_base64: None,
    });
    visited.insert(root_path.clone());

    let re_input = regex::Regex::new(
        r"\\(?:input|include|subfile|InputIfFileExists|includegraphics(?:\[[^\]]*\])?)\{([^}]+)\}"
    ).unwrap();
    let re_documentclass = regex::Regex::new(
        r"\\documentclass\*?(?:\[[^\]]*\])?\{([^}]+)\}"
    ).unwrap();
    let re_package = regex::Regex::new(
        r"\\(?:usepackage|RequirePackage|LoadClass|LoadClassWithOptions)\*?(?:\[[^\]]*\])?\{([^}]+)\}"
    ).unwrap();
    let re_bib = regex::Regex::new(
        r"\\(?:bibliography|addbibresource)\{([^}]+)\}"
    ).unwrap();
    let re_import = regex::Regex::new(
        r"\\(?:import|subimport)\{([^}]+)\}\{([^}]+)\}"
    ).unwrap();

    enum ResolveHint {
        Generic,
        Bib,
        Class,
        Sty,
    }

    while let Some((path, depth)) = stack.pop() {
        if depth >= MAX_DEPTH { continue; }
        if out.len() >= MAX_PROJECT_FILES {
            warnings.push(format!("max project files ({}) reached", MAX_PROJECT_FILES));
            break;
        }
        let Some(text) = read_text(&path) else { continue };
        let here = path.parent().unwrap_or(&root_dir).to_path_buf();

        let mut try_resolve = |raw: &str, hint: ResolveHint| {
            let raw = raw.trim();
            // Strip optional leading ./
            let raw = raw.strip_prefix("./").unwrap_or(raw);
            // Build candidate paths with possible extensions
            let exts: &[&str] = match hint {
                ResolveHint::Bib => {
                    if raw.ends_with(".bib") { &[""] } else { &[".bib", ""] }
                }
                ResolveHint::Class => {
                    if raw.contains('.') { &[""] } else { &[".cls", ""] }
                }
                ResolveHint::Sty => {
                    if raw.contains('.') { &[""] } else { &[".sty", ""] }
                }
                ResolveHint::Generic => {
                    if raw.contains('.') { &[""] } else { &[".tex", ".ltx", ""] }
                }
            };
            for ext in exts {
                let mut candidate = here.join(format!("{raw}{ext}"));
                if !candidate.exists() {
                    // also try relative to root_dir
                    candidate = root_dir.join(format!("{raw}{ext}"));
                }
                if !candidate.exists() { continue; }
                let canon = match std::fs::canonicalize(&candidate) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                // sandbox: must be inside root_dir_canon
                if !canon.starts_with(&root_dir_canon) {
                    warnings.push(format!("rejected outside-root path: {}", canon.display()));
                    continue;
                }
                add_file(canon.clone(), &root_dir_canon, &mut visited, &mut out, &mut warnings);
                if !visited.contains(&canon) {
                    return;
                }
                let is_bib = canon.extension().and_then(|e| e.to_str()) == Some("bib");
                if !is_bib {
                    stack.push((canon, depth + 1));
                }
                return;
            }
            warnings.push(format!("could not resolve: {raw}"));
        };

        for cap in re_input.captures_iter(&text) {
            try_resolve(&cap[1], ResolveHint::Generic);
        }
        for cap in re_bib.captures_iter(&text) {
            // \bibliography{a,b,c} can list multiple
            for name in cap[1].split(',') {
                try_resolve(name.trim(), ResolveHint::Bib);
            }
        }
        for cap in re_import.captures_iter(&text) {
            let dir = cap[1].trim().trim_end_matches('/');
            let file = cap[2].trim();
            try_resolve(&format!("{dir}/{file}"), ResolveHint::Generic);
        }
        for cap in re_documentclass.captures_iter(&text) {
            let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            try_resolve(raw, ResolveHint::Class);
        }
        for cap in re_package.captures_iter(&text) {
            // \usepackage{a,b} can list multiple packages
            for name in cap[1].split(',') {
                try_resolve(name.trim(), ResolveHint::Sty);
            }
        }
    }

    fn scan_resource_tree(
        dir: &Path,
        root_dir_canon: &Path,
        depth: u32,
        visited: &mut std::collections::HashSet<PathBuf>,
        out: &mut Vec<CollectedFile>,
        warnings: &mut Vec<String>,
    ) {
        if depth >= MAX_DEPTH || out.len() >= MAX_PROJECT_FILES { return; }
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if out.len() >= MAX_PROJECT_FILES { break; }
            let path = entry.path();
            let Ok(canon) = std::fs::canonicalize(&path) else { continue };
            if !canon.starts_with(root_dir_canon) { continue; }
            if canon.is_dir() {
                scan_resource_tree(&canon, root_dir_canon, depth + 1, visited, out, warnings);
                continue;
            }
            if visited.contains(&canon) { continue; }
            let ext = canon.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            if !binary_ext(&ext) {
                continue;
            }
            add_file(canon, root_dir_canon, visited, out, warnings);
        }
    }

    scan_resource_tree(&root_dir_canon, &root_dir_canon, 0, &mut visited, &mut out, &mut warnings);

    Ok(CollectResult {
        root_rel: root_basename,
        files: out,
        warnings,
    })
}

fn is_font_like_ext(ext: &str) -> bool {
    matches!(ext,
        "otf" | "ttf" | "ttc" | "otc" | "woff" | "woff2" |
        "pfb" | "afm" | "pfm" | "vf" | "tfm"
    )
}

fn write_local_cjk_font_shim(workdir: &Path, source: &str, has_local_fonts: bool) -> std::io::Result<()> {
        if !has_local_fonts || !source.contains("zh_CN-Adobefonts_external") {
                return Ok(());
        }

        let shim = r#"\ProvidesPackage{zh_CN-Adobefonts_external}[2026/05/15 local font shim]
\RequirePackage{iftex}
\ifXeTeX
    \RequirePackage{fontspec}
    \RequirePackage{xeCJK}
    \defaultfontfeatures{Ligatures=TeX}
    \IfFileExists{font/AdobeSongStd-Light.otf}{%
        \setCJKmainfont[Path=font/,Extension=.otf]{AdobeSongStd-Light}%
    }{%
        \IfFileExists{font/AdobeSongStd-Light.ttf}{%
            \setCJKmainfont[Path=font/,Extension=.ttf]{AdobeSongStd-Light}%
        }{%
            \IfFontExistsTF{Noto Serif CJK SC}{%
                \setCJKmainfont{Noto Serif CJK SC}%
            }{%
                \IfFontExistsTF{PingFang SC}{%
                    \setCJKmainfont{PingFang SC}%
                }{%
                    \IfFontExistsTF{Songti SC}{%
                        \setCJKmainfont{Songti SC}%
                    }{%
                        \setCJKmainfont{STSong}%
                    }%
                }%
            }%
        }%
    }
\else
    \PackageError{zh_CN-Adobefonts_external}{XeLaTeX required}{Compile this document with XeLaTeX}%
\fi
"#;

        std::fs::write(workdir.join("zh_CN-Adobefonts_external.sty"), shim)
}


// ---------------- BibTeX entry parsing ----------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibEntry {
    pub key: String,
    pub entry_type: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub year: Option<String>,
    pub source_file: String,
    pub source_line: u32,
}

/// Parse a list of .bib files and return all entries.
/// Lightweight (no nom-bibtex): recognises @type{key, field = {...} | "...", ...}.
#[tauri::command]
pub fn parse_bib(bib_paths: Vec<String>) -> Vec<BibEntry> {
    let mut out = Vec::new();
    for path in bib_paths {
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        parse_bib_text(&text, &path, &mut out);
    }
    out
}

fn parse_bib_text(text: &str, source: &str, out: &mut Vec<BibEntry>) {
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        // Find next '@'
        while i < bytes.len() && bytes[i] != b'@' { i += 1; }
        if i >= bytes.len() { break; }
        let entry_start = i;
        i += 1;
        // entry type (letters)
        let type_start = i;
        while i < bytes.len() && (bytes[i] as char).is_ascii_alphabetic() { i += 1; }
        let entry_type = std::str::from_utf8(&bytes[type_start..i]).unwrap_or("").to_ascii_lowercase();
        if entry_type.is_empty() || matches!(entry_type.as_str(), "comment" | "preamble" | "string") {
            continue;
        }
        // skip ws + '{'
        while i < bytes.len() && (bytes[i] as char).is_whitespace() { i += 1; }
        if i >= bytes.len() || bytes[i] != b'{' { continue; }
        i += 1;
        // citation key — up to first ',' or '}'
        let key_start = i;
        while i < bytes.len() && bytes[i] != b',' && bytes[i] != b'}' && bytes[i] != b'\n' {
            i += 1;
        }
        let key = std::str::from_utf8(&bytes[key_start..i]).unwrap_or("").trim().to_string();
        if key.is_empty() { continue; }
        // line number of '@'
        let source_line = (text[..entry_start].bytes().filter(|&b| b == b'\n').count() as u32) + 1;
        // Collect body up to matching '}'
        let body_start = i;
        let mut depth = 1i32;
        while i < bytes.len() && depth > 0 {
            match bytes[i] {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
        if depth != 0 { continue; }
        let body = &text[body_start..(i - 1)];
        let title = extract_field(body, "title");
        let author = extract_field(body, "author");
        let year = extract_field(body, "year").or_else(|| extract_field(body, "date"));
        out.push(BibEntry {
            key,
            entry_type,
            title,
            author,
            year,
            source_file: source.to_string(),
            source_line,
        });
    }
}

/// Extract a single field value. Handles `field = {value}` or `field = "value"`.
fn extract_field(body: &str, name: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    let needle_eq = format!("{name}");
    // Find name followed (after optional ws) by '='.
    let mut search_from = 0usize;
    loop {
        let idx = lower[search_from..].find(&needle_eq)?;
        let pos = search_from + idx;
        // Must be at start of body or preceded by non-alphanumeric (so "subtitle" doesn't match "title").
        let prev_ok = pos == 0 || !body.as_bytes()[pos - 1].is_ascii_alphanumeric();
        let after = pos + needle_eq.len();
        // Must be followed by optional ws then '='.
        let mut j = after;
        while j < body.len() && body.as_bytes()[j].is_ascii_whitespace() { j += 1; }
        if prev_ok && j < body.len() && body.as_bytes()[j] == b'=' {
            j += 1;
            while j < body.len() && body.as_bytes()[j].is_ascii_whitespace() { j += 1; }
            return Some(read_brace_or_quoted(body, j));
        }
        search_from = pos + needle_eq.len();
        if search_from >= lower.len() { return None; }
    }
}

fn read_brace_or_quoted(body: &str, start: usize) -> String {
    let bytes = body.as_bytes();
    if start >= bytes.len() { return String::new(); }
    match bytes[start] {
        b'{' => {
            let mut depth = 1i32;
            let mut i = start + 1;
            while i < bytes.len() && depth > 0 {
                match bytes[i] {
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    _ => {}
                }
                if depth == 0 { break; }
                i += 1;
            }
            clean_value(&body[(start + 1)..i])
        }
        b'"' => {
            let mut i = start + 1;
            while i < bytes.len() && bytes[i] != b'"' { i += 1; }
            clean_value(&body[(start + 1)..i])
        }
        _ => {
            // bare value (number/word)
            let mut i = start;
            while i < bytes.len() && bytes[i] != b',' && bytes[i] != b'}' && bytes[i] != b'\n' {
                i += 1;
            }
            clean_value(body[start..i].trim())
        }
    }
}

fn clean_value(s: &str) -> String {
    // Drop redundant {...} braces, collapse whitespace.
    let trimmed = s.trim();
    let stripped = trimmed.trim_matches(|c| c == '{' || c == '}');
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

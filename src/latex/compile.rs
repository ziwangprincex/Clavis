//! The `compile_latex` command: orchestrates workdir setup, project-file
//! materialization, engine invocation with auto-rerun + bib passes, and result
//! assembly.

use base64::Engine as _;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::TempDir;

use super::diagnostics::{detect_bib_kind, log_tail, merge_diags, parse_diags, rerun_signal};
use super::engine::{resolve_engine, run_streaming};
use super::project::{is_font_like_ext, is_safe_relpath, write_local_cjk_font_shim};
use super::types::{CompileOptions, CompileResult, LatexDiag};
use super::workdir::LatexState;
use super::{MAIN_PDF, MAIN_TEX};

const TOTAL_COMPILE_TIMEOUT: Duration = Duration::from_secs(180);

#[tauri::command]
pub async fn compile_latex(
    opts: CompileOptions,
    window: tauri::Window,
    state: tauri::State<'_, LatexState>,
) -> Result<CompileResult, String> {
    let request_id = opts.request_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let cancel = state.cancellations.lock().entry(request_id.clone()).or_default().clone();
    let _guard = super::workdir::CompileGuard { id: request_id, state: &state };
    if cancel.load(std::sync::atomic::Ordering::SeqCst) { return Err("Compilation cancelled".into()); }
    let trusted_root = if opts.full_build {
        Some(crate::project_config::trusted_workspace_root(opts.workspace_root.as_deref().ok_or("Full build requires a trusted workspace")?)?)
    } else { None };
    let previous = opts.cache_token.as_deref().or(opts.workdir_token.as_deref()).and_then(|token| state.get(token));
    let dir = TempDir::new().map_err(|e| format!("tempdir: {e}"))?;
    let token = uuid::Uuid::new_v4().to_string();
    state.insert(token.clone(), dir);
    let workdir_arc = state.get(&token).ok_or("workdir vanished")?;
    let workdir = workdir_arc.path().to_path_buf();
    let cleanup_token = token.clone();
    let result = async {
    // A reused directory can contain a PDF from a previous invocation.
    // Invalidate it before any operation that can fail (including resolution).
    clear_pdf(&workdir)?;
    super::cache::prepare(&opts, previous.as_ref().map(|p| p.path()), &workdir)?;

    // Write project files first (auxiliary files). Skip any whose rel_path equals MAIN_TEX
    // (main.tex is always written from `source`).
    for pf in &opts.project_files {
        if !is_safe_relpath(&pf.rel_path) {
            return Ok(CompileResult {
                ok: false,
                errors: vec![LatexDiag {
                    line: None,
                    file: None,
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
            errors: vec![LatexDiag { line: None, file: None, message: format!("write cjk shim: {e}"), kind: "error", package: None }],
            workdir_token: Some(token),
            ..Default::default()
        });
    }

    // Write main.tex (always from `source`).
    let tex_path = workdir.join(MAIN_TEX);
    std::fs::write(&tex_path, opts.source.as_bytes())
        .map_err(|e| format!("write main.tex: {e}"))?;

    let engine_path = match resolve_engine(if opts.full_build { "latexmk" } else { &opts.engine }, if opts.full_build { None } else { opts.custom_path.as_deref() }) {
        Ok(p) => p,
        Err(e) => {
            return Ok(CompileResult {
                ok: false,
                errors: vec![LatexDiag { line: None, file: None, message: e, kind: "error", package: None }],
                workdir_token: Some(token),
                ..Default::default()
            });
        }
    };

    // Build arg vector (tex filename last; Path-based outputs)
    let synctex_arg = if opts.synctex { "-synctex=1" } else { "-synctex=0" };
    let outdir_arg = format!("-output-directory={}", workdir.display());

    let mut log_full = String::new();
    // Output of the *most recent* LaTeX run only. Errors/warnings are parsed
    // from this so that stale diagnostics from earlier passes (e.g. "Citation
    // undefined" before BibTeX has produced .bbl) don't leak into the final
    // error panel.
    let mut last_latex_out = String::new();
    // Diagnostics harvested from bibtex/biber output (kept across runs).
    let mut bib_diags: Vec<LatexDiag> = Vec::new();
    let mut runs: u32 = 0;
    let max_runs = if opts.full_build { 1 } else { opts.max_runs.max(1).min(8) };
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
    let mut success = false;

    while runs < max_runs {
        if cancel.load(std::sync::atomic::Ordering::SeqCst) { return Err("Compilation cancelled".into()); }
        if started.elapsed() > TOTAL_COMPILE_TIMEOUT {
            log_full.push_str("\n[clavis] total compile timeout exceeded\n");
            success = false;
            break;
        }
        clear_pdf(&workdir)?;
        runs += 1;
        let mut args: Vec<&str> = vec![
            "-interaction=nonstopmode",
            "-halt-on-error",
            // Security: never let an untrusted .tex run external commands via
            // \write18. This must not depend on the user's TeX distribution
            // default (which may be `shell_escape = t`). Accepted by TeX Live
            // (pdf/xe/lua) and MiKTeX. If shell-escape is ever exposed as an
            // option it MUST default off with an explicit danger prompt.
            "-no-shell-escape",
            synctex_arg,
            "-file-line-error",
            &outdir_arg,
            MAIN_TEX,
        ];
        let full_args;
        if opts.full_build {
            full_args = full_build_args(&opts, trusted_root.as_deref())?;
            args = full_args.iter().map(String::as_str).collect();
        }
        let (code, out) = match run_streaming(&engine_path, &args, &workdir, &font_dirs, &window, runs, &cancel).await {
            Ok(r) => r,
            Err(e) => {
                clear_pdf(&workdir)?;
                log_full.push_str(&format!("\n[clavis] {}\n", e));
                let _ = window.emit("latex-done", serde_json::json!({ "ok": false, "runs": runs }));
                return Ok(CompileResult {
                    ok: false,
                    errors: vec![LatexDiag { line: None, file: None, message: e, kind: "error", package: None }],
                    log_tail: log_tail(&log_full),
                    runs,
                    workdir_token: Some(token),
                    ..Default::default()
                });
            }
        };
        log_full.push_str(&out);
        last_latex_out = out.clone();

        success = run_succeeded(code, &workdir);
        if !success { break; }

        // After first run, optionally invoke bibtex/biber once.
        if runs == 1 && !bib_done && runs < max_runs {
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
                        match run_streaming(&bib_path, &bib_args_ref, &workdir, &font_dirs, &window, runs, &cancel).await {
                            Ok((bib_code, bo)) => {
                                // Harvest persistent diagnostics from bib runner output
                                // (e.g. "I couldn't open database file ...", or a .bib
                                // syntax error with its line). LaTeX runs after this
                                // won't reproduce them, so capture here.
                                let mut entry_errors = 0usize;
                                for d in parse_diags(&bo) {
                                    if d.kind == "bib-error" { entry_errors += 1; }
                                    if matches!(d.kind, "missing-ref" | "missing-file" | "bib-error" | "warning") {
                                        bib_diags.push(d);
                                    }
                                }
                                // bibtex exits 2 and biber exits 2 for *any* entry-level
                                // error even though they still write a usable .bbl with
                                // the remaining entries (that is what a plain terminal
                                // run does too). Only a run that produced no .bbl is fatal.
                                let bbl_ok = std::fs::metadata(workdir.join("main.bbl")).map(|m| m.len() > 0).unwrap_or(false);
                                if bib_code != 0 && !(bbl_ok && entry_errors > 0) {
                                    bib_diags.push(LatexDiag { line: None, file: None, message: format!("{bib_name} exited with code {bib_code}"), kind: "error", package: None });
                                }
                                log_full.push_str(&bo);
                            }
                            Err(e) => {
                                log_full.push_str(&format!("\n[clavis] {bib_name} failed: {e}\n"));
                                bib_diags.push(LatexDiag { line: None, file: None, message: e, kind: "error", package: None });
                            }
                        }
                        bib_done = true;
                        continue; // force at least one more LaTeX run
                    }
                    Err(e) => {
                        log_full.push_str(&format!("\n[clavis] {bib_name} not available: {e}\n"));
                        bib_diags.push(LatexDiag { line: None, file: None, message: e, kind: "error", package: None });
                        bib_done = true;
                    }
                }
            }
        }

        if !opts.auto_rerun { break; }

        if !rerun_signal(&out) {
            break;
        }
    }

    success = success && !bib_diags.iter().any(|diag| diag.kind == "error");
    if !success { clear_pdf(&workdir)?; }
    let _ = window.emit("latex-done", serde_json::json!({ "ok": success, "runs": runs }));

    let mut errors = merge_diags(parse_diags(&last_latex_out), &bib_diags);
    if !success && !errors.iter().any(|diag| diag.kind == "error") {
        errors.push(LatexDiag { line: None, file: None, message: "LaTeX did not finish successfully with a new PDF. See the compile log.".to_string(), kind: "error", package: None });
    }
    let pdf = if success { read_pdf(&workdir) } else { None };
    Ok(CompileResult {
        ok: success && pdf.is_some(),
        pdf_base64: pdf,
        errors,
        log_tail: log_tail(&log_full),
        runs,
        workdir_token: Some(token),
    })
    }.await;
    if result.is_err() { state.remove(&cleanup_token); }
    result
}

fn full_build_args(opts: &CompileOptions, root: Option<&Path>) -> Result<Vec<String>, String> {
    if opts.custom_path.as_ref().is_some_and(|path| !path.trim().is_empty()) {
        return Err("latexmk full build uses distribution engines; remove the custom engine path or define a trusted project task".into());
    }
    let mode = match opts.engine.as_str() {
        "pdflatex" => "-pdf", "xelatex" => "-xelatex", "lualatex" => "-lualatex",
        _ => return Err("Unsupported latexmk engine".into()),
    };
    let mut args = vec!["-norc".into(), mode.into(), "-interaction=nonstopmode".into(), "-halt-on-error".into(), "-file-line-error".into(), "-synctex=1".into(), "-latexoption=-no-shell-escape".into()];
    if let Some(root) = root {
        let rc = root.join(".latexmkrc");
        if rc.is_file() {
            let rc = std::fs::canonicalize(rc).map_err(|e| e.to_string())?;
            if !rc.starts_with(root) { return Err("latexmk configuration is outside the workspace".into()); }
            args.extend(["-r".into(), rc.to_string_lossy().into_owned()]);
        }
    }
    args.push(MAIN_TEX.into());
    Ok(args)
}

fn clear_pdf(workdir: &Path) -> Result<(), String> {
    match std::fs::remove_file(workdir.join(MAIN_PDF)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove previous PDF: {e}")),
    }
}

fn run_succeeded(code: i32, workdir: &Path) -> bool {
    code == 0 && read_pdf(workdir).is_some()
}

fn read_pdf(workdir: &Path) -> Option<String> {
    let bytes = std::fs::read(workdir.join(MAIN_PDF)).ok()?;
    if !bytes.starts_with(b"%PDF-") { return None; }
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_previous_pdf_cannot_count_as_a_new_run() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(MAIN_PDF), b"%PDF-1.4 previous").unwrap();
        clear_pdf(dir.path()).unwrap();
        assert!(!run_succeeded(0, dir.path()));
        clear_pdf(dir.path()).unwrap();
    }

    #[test]
    fn a_nonzero_exit_fails_even_if_a_pdf_was_written() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(MAIN_PDF), b"%PDF-1.4 partial").unwrap();
        assert!(!run_succeeded(1, dir.path()));
        assert!(run_succeeded(0, dir.path()));
    }

    #[test]
    fn an_empty_or_invalid_pdf_is_not_success() {
        let dir = tempfile::tempdir().unwrap();
        for bytes in [b"".as_slice(), b"not a PDF".as_slice()] {
            std::fs::write(dir.path().join(MAIN_PDF), bytes).unwrap();
            assert!(!run_succeeded(0, dir.path()));
        }
    }
    #[test]
    #[ignore = "requires installed latexmk and pdflatex"]
    fn real_latexmk_builds_document_and_index() {
        let program = resolve_engine("latexmk", None).unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(MAIN_TEX), r"\documentclass{article}
\usepackage{makeidx}\makeindex
\begin{document}Hello\index{hello}\printindex\end{document}").unwrap();
        let opts: CompileOptions = serde_json::from_value(serde_json::json!({ "source": "", "engine": "pdflatex", "fullBuild": true })).unwrap();
        let args = full_build_args(&opts, None).unwrap();
        let output = std::process::Command::new(program).args(args).current_dir(dir.path()).env("PATH", super::super::engine::enriched_path()).output().unwrap();
        assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert!(dir.path().join("main.ind").exists());
        assert!(read_pdf(dir.path()).is_some());
    }

}

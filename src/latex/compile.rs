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
    // Output of the *most recent* LaTeX run only. Errors/warnings are parsed
    // from this so that stale diagnostics from earlier passes (e.g. "Citation
    // undefined" before BibTeX has produced .bbl) don't leak into the final
    // error panel.
    let mut last_latex_out = String::new();
    // Diagnostics harvested from bibtex/biber output (kept across runs).
    let mut bib_diags: Vec<LatexDiag> = Vec::new();
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
        last_latex_out = out.clone();

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
                            Ok((_c, bo)) => {
                                // Harvest persistent diagnostics from bib runner output
                                // (e.g. "I couldn't open database file ..."). LaTeX runs
                                // after this won't reproduce them, so capture here.
                                for d in parse_diags(&bo) {
                                    if d.kind == "missing-ref" || d.kind == "missing-file" {
                                        bib_diags.push(d);
                                    }
                                }
                                log_full.push_str(&bo);
                            }
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
            let errors = merge_diags(parse_diags(&last_latex_out), &bib_diags);
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

    let errors = merge_diags(parse_diags(&last_latex_out), &bib_diags);
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

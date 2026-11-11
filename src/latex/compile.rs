//! The `compile_latex` command: reads the project (with the open editor
//! buffers laid over it), syncs it into the document's build folder, runs the
//! engine with auto-rerun and bibliography passes, and assembles the result.
//! The PDF stays in the build folder (`read_build_pdf`) and is also saved
//! beside the main file.

use tauri::Emitter as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::build_dir::{self, Content, Input};
use super::diagnostics::{detect_bib_kind, log_tail, merge_diags, parse_diags, rerun_signal};
use super::engine::{resolve_engine, run_streaming};
use super::project::{collect_with_overlays, write_local_cjk_font_shim, CollectResult};
use super::types::{CompileOptions, CompileResult, LatexDiag};
use super::workdir::LatexState;
use super::{MAIN_PDF, MAIN_TEX};

const TOTAL_COMPILE_TIMEOUT: Duration = Duration::from_secs(180);

/// Generic over the runtime so a test can call it through Tauri's IPC layer.
#[tauri::command]
pub async fn compile_latex<R: tauri::Runtime>(
    mut opts: CompileOptions,
    window: tauri::Window<R>,
    state: tauri::State<'_, LatexState>,
) -> Result<CompileResult, String> {
    let request_id = opts.request_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let cancel = state.cancellations.lock().entry(request_id.clone()).or_default().clone();
    let _guard = super::workdir::CompileGuard { id: request_id.clone(), state: &state };
    if cancel.load(Ordering::SeqCst) { return Err("Compilation cancelled".into()); }
    let trusted_root = if opts.full_build {
        Some(crate::project_config::trusted_workspace_root(opts.workspace_root.as_deref().ok_or("Full build requires a trusted workspace")?)?)
    } else { None };

    // What to build: the saved project read from disk with the open buffers
    // laid over it (without saving them), or a document without a main file.
    let snapshot = match opts.root_path.clone() {
        Some(root) => {
            let documents = std::mem::take(&mut opts.documents);
            Some(tauri::async_runtime::spawn_blocking(move || collect_with_overlays(root, documents))
                .await
                .map_err(|e| format!("project reader failed: {e}"))??)
        }
        None => None,
    };
    // The first collected file is the main file, at its canonical path.
    let identity = match &snapshot {
        Some(snapshot) => format!("main:{}", snapshot.files[0].source.display()),
        None => format!("scratch:{}", opts.source_identity.as_deref().unwrap_or(&request_id)),
    };
    let (token, build) = state.build_for(&identity)?;
    let busy = build.busy.lock().await;
    let mut result = build_in(&opts, snapshot.as_ref(), build.path(), &token, trusted_root.as_deref(), &window, &cancel).await;
    drop(busy);
    match &mut result {
        Ok(result) => result.snapshot = snapshot,
        // A cancelled or broken run can leave half-written auxiliary files.
        Err(_) => state.remove(&token),
    }
    result
}

/// Syncs the sources into `workdir` and runs the engine there.
async fn build_in<R: tauri::Runtime>(
    opts: &CompileOptions,
    snapshot: Option<&CollectResult>,
    workdir: &Path,
    token: &str,
    trusted_root: Option<&Path>,
    window: &tauri::Window<R>,
    cancel: &AtomicBool,
) -> Result<CompileResult, String> {
    let fail = |message: String| CompileResult {
        ok: false,
        errors: vec![LatexDiag { line: None, file: None, message, kind: "error", package: None }],
        workdir_token: Some(token.to_string()),
        ..Default::default()
    };
    // The folder holds the previous build's PDF. Invalidate it before anything
    // that can fail.
    clear_pdf(workdir)?;

    let main_source = snapshot.map_or(opts.source.as_str(), |snapshot| snapshot.files[0].content.as_str());
    let inputs: Vec<Input> = snapshot
        .map(|snapshot| {
            snapshot.files[1..]
                .iter()
                .map(|file| Input {
                    rel_path: &file.rel_path,
                    content: if file.is_binary { Content::File(&file.source) } else { Content::Text(&file.content) },
                })
                .collect()
        })
        .unwrap_or_default();
    if let Err(e) = build_dir::sync(workdir, &build_dir::signature(opts, &inputs), opts.clean, main_source, &inputs) {
        return Ok(fail(e));
    }
    if let Err(e) = write_local_cjk_font_shim(workdir, main_source, inputs.iter().any(Input::is_font)) {
        return Ok(fail(format!("write cjk shim: {e}")));
    }

    let engine_path = match resolve_engine(if opts.full_build { "latexmk" } else { &opts.engine }, if opts.full_build { None } else { opts.custom_path.as_deref() }) {
        Ok(p) => p,
        Err(e) => return Ok(fail(e)),
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
    let mut bib_tool: Option<String> = None;
    let max_runs = if opts.full_build { 1 } else { opts.max_runs.clamp(1, 8) };
    let mut font_dirs: Vec<PathBuf> = Vec::new();
    for input in inputs.iter().filter(|input| input.is_font()) {
        if let Some(parent) = Path::new(input.rel_path).parent() {
            let dir = workdir.join(parent);
            if !font_dirs.contains(&dir) {
                font_dirs.push(dir);
            }
        }
    }

    let bib_choice = opts.bib_engine.clone().unwrap_or_else(|| "auto".to_string());
    let want_bib = match bib_choice.as_str() {
        "none" => None,
        "bibtex" => Some("bibtex"),
        "biber" => Some("biber"),
        _ => detect_bib_kind(main_source).or_else(|| {
            inputs.iter().find_map(|input| match input.content {
                Content::Text(text) => detect_bib_kind(text),
                Content::File(_) => None,
            })
        }),
    };

    let started = std::time::Instant::now();
    let mut bib_done = false;
    let mut success = false;

    while runs < max_runs {
        if cancel.load(Ordering::SeqCst) { return Err("Compilation cancelled".into()); }
        if started.elapsed() > TOTAL_COMPILE_TIMEOUT {
            log_full.push_str("\n[clavis] total compile timeout exceeded\n");
            success = false;
            break;
        }
        clear_pdf(workdir)?;
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
            full_args = full_build_args(opts, trusted_root)?;
            args = full_args.iter().map(String::as_str).collect();
        }
        let (code, out) = match run_streaming(&engine_path, &args, workdir, &font_dirs, window, runs, cancel).await {
            Ok(r) => r,
            Err(e) => {
                clear_pdf(workdir)?;
                log_full.push_str(&format!("\n[clavis] {}\n", e));
                let _ = window.emit("latex-done", serde_json::json!({ "ok": false, "runs": runs }));
                return Ok(CompileResult {
                    ok: false,
                    errors: vec![LatexDiag { line: None, file: None, message: e, kind: "error", package: None }],
                    log_tail: log_tail(&log_full),
                    runs,
                    workdir_token: Some(token.to_string()),
                    ..Default::default()
                });
            }
        };
        log_full.push_str(&out);
        last_latex_out = out.clone();

        success = run_succeeded(code, workdir);
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
                        match run_streaming(&bib_path, &bib_args_ref, workdir, &font_dirs, window, runs, cancel).await {
                            Ok((bib_code, bo)) => {
                                bib_tool = Some(bib_name.to_string());
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
    if !success { clear_pdf(workdir)?; }
    let _ = window.emit("latex-done", serde_json::json!({ "ok": success, "runs": runs }));

    let mut errors = merge_diags(parse_diags(&last_latex_out), &bib_diags);
    if !success && !errors.iter().any(|diag| diag.kind == "error") {
        errors.push(LatexDiag { line: None, file: None, message: "LaTeX did not finish successfully with a new PDF. See the compile log.".to_string(), kind: "error", package: None });
    }
    let pdf = if success { read_pdf(workdir) } else { None };
    let (saved_pdf, pdf_save_error) = match (&pdf, opts.root_path.as_deref()) {
        (Some(bytes), Some(source)) => match save_beside_source(Path::new(source), bytes) {
            Ok(path) => (Some(path.to_string_lossy().into_owned()), None),
            Err(e) => (None, Some(e)),
        },
        _ => (None, None),
    };
    Ok(CompileResult {
        ok: success && pdf.is_some(),
        errors,
        log_tail: log_tail(&log_full),
        runs,
        workdir_token: Some(token.to_string()),
        engine: if opts.full_build { "latexmk".to_string() } else { opts.engine.clone() },
        bib_tool,
        saved_pdf,
        pdf_save_error,
        snapshot: None,
    })
}

fn full_build_args(opts: &CompileOptions, root: Option<&Path>) -> Result<Vec<String>, String> {
    if opts.custom_path.as_ref().is_some_and(|path| !path.trim().is_empty()) {
        return Err("latexmk full build uses distribution engines; remove the custom engine path to use it".into());
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

fn read_pdf(workdir: &Path) -> Option<Vec<u8>> {
    let bytes = std::fs::read(workdir.join(MAIN_PDF)).ok()?;
    if !bytes.starts_with(b"%PDF-") { return None; }
    Some(bytes)
}

/// Write the PDF to `<stem>.pdf` beside the saved main `.tex` file.
///
/// The source must be an existing `.tex` file, so the frontend cannot use this
/// to write anywhere else. The PDF is written to a temporary file in the same
/// folder and renamed over the old one, so a viewer never sees half a file and
/// a failed write leaves the previous PDF intact.
fn save_beside_source(source: &Path, pdf: &[u8]) -> Result<PathBuf, String> {
    use std::io::Write as _;
    if !source.is_absolute() { return Err("source path is not absolute".into()); }
    let is_tex = source.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("tex"));
    if !is_tex { return Err("source is not a .tex file".into()); }
    if !std::fs::metadata(source).is_ok_and(|m| m.is_file()) {
        return Err("source file is not saved on disk".into());
    }
    let target = source.with_extension("pdf");
    if let Ok(meta) = std::fs::symlink_metadata(&target) {
        if !meta.file_type().is_file() {
            return Err(format!("{} exists and is not a regular file", target.display()));
        }
    }
    let parent = target.parent().ok_or("source has no folder")?;
    let mut temp = tempfile::Builder::new()
        .prefix(".clavis-")
        .suffix(".pdf.tmp")
        .tempfile_in(parent)
        .map_err(|e| format!("cannot write in {}: {e}", parent.display()))?;
    temp.write_all(pdf).and_then(|()| temp.as_file().sync_all()).map_err(|e| format!("write PDF: {e}"))?;
    // A temporary file is private (0600); keep the old PDF's mode, or the usual 0644.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let permissions = std::fs::metadata(&target)
            .map(|m| m.permissions())
            .unwrap_or_else(|_| std::fs::Permissions::from_mode(0o644));
        temp.as_file().set_permissions(permissions).map_err(|e| format!("set PDF permissions: {e}"))?;
    }
    temp.persist(&target).map_err(|e| format!("replace {}: {}", target.display(), e.error))?;
    Ok(target)
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
    fn a_built_pdf_replaces_the_one_beside_the_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Thesis.tex");
        std::fs::write(&source, "\\documentclass{article}").unwrap();
        std::fs::write(dir.path().join("Thesis.pdf"), b"%PDF-1.4 old").unwrap();
        let saved = save_beside_source(&source, b"%PDF-1.4 new").unwrap();
        assert_eq!(saved, dir.path().join("Thesis.pdf"));
        assert_eq!(std::fs::read(&saved).unwrap(), b"%PDF-1.4 new");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(".clavis-"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files left behind: {leftovers:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_new_pdf_is_readable_by_others() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("main.tex");
        std::fs::write(&source, "x").unwrap();
        let saved = save_beside_source(&source, b"%PDF-1.4").unwrap();
        assert_eq!(std::fs::metadata(saved).unwrap().permissions().mode() & 0o777, 0o644);
    }

    #[test]
    fn only_a_saved_tex_file_gets_a_pdf_beside_it() {
        let dir = tempfile::tempdir().unwrap();
        let notes = dir.path().join("notes.md");
        std::fs::write(&notes, "x").unwrap();
        assert!(save_beside_source(&notes, b"%PDF-1.4").is_err());
        assert!(save_beside_source(&dir.path().join("unsaved.tex"), b"%PDF-1.4").is_err());
        assert!(save_beside_source(Path::new("relative.tex"), b"%PDF-1.4").is_err());
        assert!(!dir.path().join("notes.pdf").exists());
        assert!(!dir.path().join("unsaved.pdf").exists());
    }

    #[test]
    fn a_folder_named_like_the_pdf_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("main.tex");
        std::fs::write(&source, "x").unwrap();
        std::fs::create_dir(dir.path().join("main.pdf")).unwrap();
        assert!(save_beside_source(&source, b"%PDF-1.4").is_err());
        assert!(dir.path().join("main.pdf").is_dir());
    }

    /// The whole path a compile takes in the app: the frontend's camelCase
    /// options through Tauri's IPC layer, the project read from disk with an
    /// unsaved buffer laid over it, a real pdflatex run, the PDF saved beside
    /// the source and read back as raw bytes, and the build folder reused.
    #[test]
    #[ignore = "requires an installed pdflatex"]
    fn the_compile_command_builds_a_project_from_disk_and_unsaved_buffers() {
        use tauri::ipc::{CallbackFn, InvokeBody};
        let app = tauri::test::mock_builder()
            .manage(LatexState::default())
            .invoke_handler(tauri::generate_handler![compile_latex, super::super::workdir::read_build_pdf])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        let invoke = |cmd: &str, body: serde_json::Value| {
            tauri::test::get_ipc_response(&webview, tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                // The app's own origin; anything else counts as a remote page.
                url: if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" }.parse().unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            })
        };
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("Paper.tex");
        let chapter = dir.path().join("chapter.tex");
        std::fs::write(&source, "\\documentclass{article}\\begin{document}\\input{chapter}\\end{document}").unwrap();
        std::fs::write(&chapter, "saved text").unwrap();
        let compile = || -> serde_json::Value {
            invoke("compile_latex", serde_json::json!({ "opts": {
                "rootPath": source.to_string_lossy(),
                "documents": [{ "path": chapter.to_string_lossy(), "content": "unsaved text" }],
                "engine": "pdflatex",
                "bibEngine": "none",
            }}))
            .expect("compile_latex failed")
            .deserialize()
            .unwrap()
        };

        let first = compile();
        assert_eq!(first["ok"], true, "{first:#}");
        let saved = dir.path().join("Paper.pdf");
        assert_eq!(first["savedPdf"], saved.to_string_lossy().as_ref(), "{first:#}");
        let files = first["snapshot"]["files"].as_array().unwrap();
        assert!(files.iter().any(|f| f["relPath"] == "chapter.tex" && f["content"] == "unsaved text"), "{first:#}");
        assert_eq!(std::fs::read_to_string(&chapter).unwrap(), "saved text", "the buffer is compiled, not saved");

        let token = first["workdirToken"].as_str().unwrap();
        let pdf = invoke("read_build_pdf", serde_json::json!({ "workdirToken": token })).expect("read_build_pdf failed");
        let tauri::ipc::InvokeResponseBody::Raw(bytes) = pdf else { panic!("the PDF should come back as raw bytes") };
        assert!(bytes.starts_with(b"%PDF-"));
        assert_eq!(bytes, std::fs::read(&saved).unwrap());

        let second = compile();
        assert_eq!(second["ok"], true, "{second:#}");
        assert_eq!(second["workdirToken"], first["workdirToken"], "the project keeps its build folder");
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

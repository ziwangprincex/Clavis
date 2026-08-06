//! Confined LaTeX submission-bundle inspection and source snapshot creation.
//!
//! Creation is intentionally narrower than a compiler or archive feature: after
//! explicit workspace trust and a user-selected existing destination directory,
//! Clavis copies only the collector manifest to a new sibling staging directory
//! and atomically publishes that directory. It never changes the source
//! workspace, runs a process, overwrites a destination, or creates a zip.

use crate::project_config::{validate_project_config, ProjectConfig};
use base64::Engine as _;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use uuid::Uuid;
use zip::write::SimpleFileOptions;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleManifestFile {
    pub relative_path: String,
    pub kind: String,
    pub size_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleManifest {
    pub root: String,
    pub main_document: String,
    pub files: Vec<BundleManifestFile>,
    pub warnings: Vec<String>,
    pub ready: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedSubmissionBundle {
    pub path: String,
    pub files: usize,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedSubmissionArchive {
    pub path: String,
    pub files: usize,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionBuildVerification {
    pub ok: bool,
    pub engine: String,
    pub log_tail: String,
    pub output_present: bool,
}

struct PreparedBundle {
    root: PathBuf,
    manifest: BundleManifest,
    files: Vec<crate::latex::project::CollectedFile>,
}

fn portable(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn workspace_root(path: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(path).map_err(|e| format!("workspace not found: {e}"))?;
    if !root.is_dir() {
        return Err("workspace root is not a directory".to_string());
    }
    Ok(root)
}

fn kind(path: &str, binary: bool, is_bib: bool) -> String {
    if is_bib {
        return "bibliography".to_string();
    }
    if binary {
        return "binary-resource".to_string();
    }
    match Path::new(path)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "tex" | "ltx" => "latex-source".to_string(),
        "sty" | "cls" => "latex-style".to_string(),
        _ => "text-resource".to_string(),
    }
}

fn prepare_bundle(workspace: String) -> Result<PreparedBundle, String> {
    let root = workspace_root(&workspace)?;
    let config_path = root.join("clavis.toml");
    let config_text = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("cannot read clavis.toml: {e}"))?;
    let config: ProjectConfig =
        toml::from_str(&config_text).map_err(|e| format!("invalid clavis.toml: {e}"))?;
    let issues = validate_project_config(&config);
    if !issues.is_empty() {
        return Err(format!("invalid project configuration: {}", issues.join("; ")));
    }
    let main = config
        .project
        .main
        .ok_or_else(|| "project.main is required for a LaTeX bundle".to_string())?;
    let canonical_main = std::fs::canonicalize(root.join(&main))
        .map_err(|e| format!("main document not found: {e}"))?;
    if !canonical_main.starts_with(&root)
        || canonical_main
            .extension()
            .and_then(|v| v.to_str())
            .is_none_or(|v| !matches!(v.to_ascii_lowercase().as_str(), "tex" | "ltx"))
    {
        return Err("project.main must be a LaTeX document inside the workspace".to_string());
    }
    let collected = crate::latex::project::collect_project_files(portable(&canonical_main))?;
    let ready = collected.warnings.is_empty();
    let files = collected.files;
    let manifest_files = files
        .iter()
        .map(|file| BundleManifestFile {
            relative_path: file.rel_path.clone(),
            kind: kind(&file.abs_path, file.binary_base64.is_some(), file.is_bib),
            size_bytes: file
                .binary_base64
                .as_ref()
                .map(|value| value.len() * 3 / 4)
                .unwrap_or_else(|| file.content.len()),
        })
        .collect();
    Ok(PreparedBundle {
        root: root.clone(),
        manifest: BundleManifest {
            root: portable(&root),
            main_document: portable(&canonical_main),
            files: manifest_files,
            warnings: collected.warnings,
            ready,
        },
        files,
    })
}

fn manifest_sync(workspace: String) -> Result<BundleManifest, String> {
    Ok(prepare_bundle(workspace)?.manifest)
}

fn destination_parent(root: &Path, selected: &str) -> Result<PathBuf, String> {
    let parent = std::fs::canonicalize(selected)
        .map_err(|e| format!("bundle destination folder not found: {e}"))?;
    if !parent.is_dir() {
        return Err("bundle destination must be an existing directory".to_string());
    }
    if parent.starts_with(root) {
        return Err("bundle destination must be outside the source workspace".to_string());
    }
    Ok(parent)
}

fn write_bundle_file(stage: &Path, file: &crate::latex::project::CollectedFile) -> Result<usize, String> {
    if !crate::latex::project::is_safe_relpath(&file.rel_path) {
        return Err(format!("collector returned an unsafe relative path: {}", file.rel_path));
    }
    let target = stage.join(&file.rel_path);
    let parent = target.parent().ok_or_else(|| "bundle file has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("cannot create bundle directory: {e}"))?;
    if file.binary_base64.is_some() && !file.content.is_empty() {
        return Err(format!("collector returned both text and binary data: {}", file.rel_path));
    }
    let bytes = match &file.binary_base64 {
        Some(encoded) => base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| format!("invalid collected binary data for {}: {e}", file.rel_path))?,
        None => file.content.as_bytes().to_vec(),
    };
    std::fs::write(&target, &bytes).map_err(|e| format!("cannot write bundle file {}: {e}", file.rel_path))?;
    Ok(bytes.len())
}

fn create_prepared_bundle(
    prepared: PreparedBundle,
    selected_destination: String,
) -> Result<CreatedSubmissionBundle, String> {
    const MAX_BUNDLE_BYTES: usize = 64 * 1024 * 1024;
    if !prepared.manifest.ready {
        return Err(format!(
            "submission bundle has unresolved files: {}",
            prepared.manifest.warnings.join("; ")
        ));
    }
    let estimated_bytes = prepared.manifest.files.iter().try_fold(0usize, |sum, file| {
        sum.checked_add(file.size_bytes).ok_or_else(|| "bundle size overflow".to_string())
    })?;
    if estimated_bytes > MAX_BUNDLE_BYTES {
        return Err("submission bundle exceeds the 64 MiB source snapshot limit".to_string());
    }
    let parent = destination_parent(&prepared.root, &selected_destination)?;
    let id = Uuid::new_v4().simple().to_string();
    let stage = parent.join(format!(".clavis-submission-{id}.tmp"));
    let final_dir = parent.join(format!("clavis-submission-{id}"));
    std::fs::create_dir(&stage).map_err(|e| format!("cannot create bundle staging directory: {e}"))?;

    let result = (|| {
        let mut bytes = 0usize;
        for file in &prepared.files {
            bytes = bytes
                .checked_add(write_bundle_file(&stage, file)?)
                .ok_or_else(|| "bundle size overflow".to_string())?;
        }
        // The random final name must not replace an existing directory. Rename
        // makes the fully populated staging directory visible in one operation.
        std::fs::rename(&stage, &final_dir)
            .map_err(|e| format!("cannot publish submission bundle: {e}"))?;
        Ok(CreatedSubmissionBundle {
            path: portable(&final_dir),
            files: prepared.files.len(),
            bytes,
        })
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&stage);
    }
    result
}

fn archive_prepared_bundle(
    prepared: PreparedBundle,
    selected_destination: String,
) -> Result<CreatedSubmissionArchive, String> {
    const MAX_BUNDLE_BYTES: usize = 64 * 1024 * 1024;
    if !prepared.manifest.ready {
        return Err(format!("submission archive has unresolved files: {}", prepared.manifest.warnings.join("; ")));
    }
    let estimated = prepared.manifest.files.iter().try_fold(0usize, |sum, file| sum.checked_add(file.size_bytes).ok_or_else(|| "bundle size overflow".to_string()))?;
    if estimated > MAX_BUNDLE_BYTES {
        return Err("submission archive exceeds the 64 MiB source snapshot limit".to_string());
    }
    let parent = destination_parent(&prepared.root, &selected_destination)?;
    let id = Uuid::new_v4().simple().to_string();
    let stage = parent.join(format!(".clavis-submission-{id}.zip.tmp"));
    let final_path = parent.join(format!("clavis-submission-{id}.zip"));
    let result = (|| {
        let file = std::fs::File::create(&stage).map_err(|e| format!("cannot create archive staging file: {e}"))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o644);
        let mut bytes = 0usize;
        for entry in &prepared.files {
            if !crate::latex::project::is_safe_relpath(&entry.rel_path) {
                return Err(format!("collector returned an unsafe relative path: {}", entry.rel_path));
            }
            let data = match &entry.binary_base64 {
                Some(encoded) => base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e| format!("invalid collected binary data for {}: {e}", entry.rel_path))?,
                None => entry.content.as_bytes().to_vec(),
            };
            zip.start_file(&entry.rel_path, options).map_err(|e| format!("cannot start archive entry {}: {e}", entry.rel_path))?;
            zip.write_all(&data).map_err(|e| format!("cannot write archive entry {}: {e}", entry.rel_path))?;
            bytes = bytes.checked_add(data.len()).ok_or_else(|| "bundle size overflow".to_string())?;
        }
        zip.finish().map_err(|e| format!("cannot finalize submission archive: {e}"))?;
        std::fs::rename(&stage, &final_path).map_err(|e| format!("cannot publish submission archive: {e}"))?;
        Ok(CreatedSubmissionArchive { path: portable(&final_path), files: prepared.files.len(), bytes })
    })();
    if result.is_err() { let _ = std::fs::remove_file(&stage); }
    result
}

fn create_archive_sync(workspace: String, selected_destination: String) -> Result<CreatedSubmissionArchive, String> {
    archive_prepared_bundle(prepare_bundle(workspace)?, selected_destination)
}

const BUILD_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_BUILD_LOG_BYTES: usize = 256 * 1024;

fn configured_engine(root: &Path) -> Result<String, String> {
    let text = std::fs::read_to_string(root.join("clavis.toml")).map_err(|e| format!("cannot read clavis.toml: {e}"))?;
    let config: ProjectConfig = toml::from_str(&text).map_err(|e| format!("invalid clavis.toml: {e}"))?;
    let engine = config.latex.engine.unwrap_or_else(|| "pdflatex".to_string());
    if !matches!(engine.as_str(), "pdflatex" | "xelatex" | "lualatex") {
        return Err("submission verification engine must be pdflatex, xelatex, or lualatex".to_string());
    }
    Ok(engine)
}

fn tail_log(bytes: &[u8]) -> String {
    let start = bytes.len().saturating_sub(12 * 1024);
    String::from_utf8_lossy(&bytes[start..]).to_string()
}

fn verification_args(main: &str) -> [&str; 5] {
    ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "-file-line-error", main]
}

fn verify_bundle_sync(workspace: String) -> Result<SubmissionBuildVerification, String> {
    let prepared = prepare_bundle(workspace)?;
    if !prepared.manifest.ready {
        return Err(format!("submission verification has unresolved files: {}", prepared.manifest.warnings.join("; ")));
    }
    let engine_name = configured_engine(&prepared.root)?;
    let engine = crate::latex::engine::resolve_engine(&engine_name, None)?;
    let snapshot = tempfile::tempdir().map_err(|e| format!("cannot create isolated verification directory: {e}"))?;
    let mut written = 0usize;
    for file in &prepared.files {
        written = written.checked_add(write_bundle_file(snapshot.path(), file)?).ok_or_else(|| "bundle size overflow".to_string())?;
    }
    if written > 64 * 1024 * 1024 { return Err("submission verification exceeds the 64 MiB source snapshot limit".to_string()); }
    let main = Path::new(&prepared.manifest.main_document).file_name().and_then(|name| name.to_str()).ok_or_else(|| "bundle main document has no file name".to_string())?;
    // Do not pipe engine output: a verbose TeX run could fill an OS pipe before
    // `try_wait` observes exit. Temporary log files cap memory while remaining
    // entirely inside the isolated snapshot that is deleted on return.
    let stdout_path = snapshot.path().join("clavis-verification.stdout.log");
    let stderr_path = snapshot.path().join("clavis-verification.stderr.log");
    let stdout = std::fs::File::create(&stdout_path).map_err(|e| format!("cannot create verification stdout log: {e}"))?;
    let stderr = std::fs::File::create(&stderr_path).map_err(|e| format!("cannot create verification stderr log: {e}"))?;
    let mut child = Command::new(&engine)
        .args(verification_args(main))
        .current_dir(snapshot.path())
        .env("PATH", crate::latex::engine::enriched_path())
        .stdin(Stdio::null()).stdout(Stdio::from(stdout)).stderr(Stdio::from(stderr))
        .spawn().map_err(|e| format!("cannot start isolated LaTeX verification: {e}"))?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < BUILD_TIMEOUT => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) | Err(_) => {
                let _ = child.kill(); let _ = child.wait();
                return Err(format!("isolated LaTeX verification timed out after {}s", BUILD_TIMEOUT.as_secs()));
            }
        }
    };
    let mut log = std::fs::read(&stdout_path).unwrap_or_default();
    log.extend_from_slice(&std::fs::read(&stderr_path).unwrap_or_default());
    if log.len() > MAX_BUILD_LOG_BYTES { log = log[log.len() - MAX_BUILD_LOG_BYTES..].to_vec(); }
    let output_present = snapshot.path().join("main.pdf").is_file();
    Ok(SubmissionBuildVerification { ok: status.success() && output_present, engine: engine_name, log_tail: tail_log(&log), output_present })
}

fn create_bundle_sync(workspace: String, selected_destination: String) -> Result<CreatedSubmissionBundle, String> {
    // The destination comes from a native user folder picker. Re-read and
    // canonicalize both source and destination immediately before copying;
    // this write does not run a project command and never writes the source.
    create_prepared_bundle(prepare_bundle(workspace)?, selected_destination)
}

#[tauri::command]
pub async fn inspect_submission_bundle(root: String) -> Result<BundleManifest, String> {
    tauri::async_runtime::spawn_blocking(move || manifest_sync(root))
        .await
        .map_err(|e| format!("bundle manifest worker failed: {e}"))?
}

#[tauri::command]
pub async fn create_submission_bundle(
    root: String,
    destination_parent: String,
) -> Result<CreatedSubmissionBundle, String> {
    tauri::async_runtime::spawn_blocking(move || create_bundle_sync(root, destination_parent))
        .await
        .map_err(|e| format!("submission bundle worker failed: {e}"))?
}

#[tauri::command]
pub async fn create_submission_archive(
    root: String,
    destination_parent: String,
) -> Result<CreatedSubmissionArchive, String> {
    tauri::async_runtime::spawn_blocking(move || create_archive_sync(root, destination_parent))
        .await
        .map_err(|e| format!("submission archive worker failed: {e}"))?
}

#[tauri::command]
pub async fn verify_submission_bundle(root: String) -> Result<SubmissionBuildVerification, String> {
    tauri::async_runtime::spawn_blocking(move || verify_bundle_sync(root))
        .await
        .map_err(|e| format!("submission verification worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use tempfile::tempdir;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("clavis.toml"), "[project]\nmain = \"main.tex\"\n").unwrap();
        std::fs::create_dir(root.join("figures")).unwrap();
        std::fs::write(root.join("figures/chart.png"), b"png").unwrap();
        std::fs::write(
            root.join("main.tex"),
            "\\documentclass{article}\n\\includegraphics{figures/chart.png}",
        )
        .unwrap();
        (dir, root)
    }

    #[test]
    fn requires_latex_project_main() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("clavis.toml"), "[project]\nmain = \"paper.qmd\"\n").unwrap();
        std::fs::write(root.join("paper.qmd"), "x").unwrap();
        assert!(manifest_sync(portable(&root)).unwrap_err().contains("LaTeX"));
    }

    #[test]
    fn reports_collected_source_and_resources_without_writing() {
        let (_dir, root) = fixture();
        let manifest = manifest_sync(portable(&root)).unwrap();
        assert!(manifest.files.iter().any(|file| file.relative_path == "main.tex"));
        assert!(manifest.files.iter().any(|file| file.relative_path == "figures/chart.png" && file.kind == "binary-resource"));
    }

    #[test]
    fn writes_a_complete_snapshot_outside_the_workspace() {
        let (_dir, root) = fixture();
        let output = tempdir().unwrap();
        let created = create_bundle_sync(portable(&root), portable(output.path())).unwrap();
        let final_dir = PathBuf::from(created.path);
        assert_eq!(created.bytes, std::fs::read(final_dir.join("main.tex")).unwrap().len() + 3);
        assert_eq!(std::fs::read(final_dir.join("figures/chart.png")).unwrap(), b"png");
        assert_eq!(std::fs::read(root.join("main.tex")).unwrap(), b"\\documentclass{article}\n\\includegraphics{figures/chart.png}");
    }

    #[test]
    fn archives_the_complete_snapshot_outside_the_workspace() {
        let (_dir, root) = fixture();
        let output = tempdir().unwrap();
        let created = create_archive_sync(portable(&root), portable(output.path())).unwrap();
        let file = std::fs::File::open(&created.path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert_eq!(archive.len(), 2);
        let mut main = String::new();
        archive.by_name("main.tex").unwrap().read_to_string(&mut main).unwrap();
        assert!(main.contains("includegraphics"));
        assert!(std::fs::read(root.join("main.tex")).unwrap().starts_with(b"\\documentclass"));
    }

    #[test]
    fn verification_uses_fixed_shell_escape_safe_args() {
        assert_eq!(verification_args("main.tex"), ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "-file-line-error", "main.tex"]);
    }

    #[test]
    fn rejects_non_allowlisted_verification_engine() {
        let (_dir, root) = fixture();
        std::fs::write(root.join("clavis.toml"), "[project]\nmain = \"main.tex\"\n[latex]\nengine = \"latexmk\"\n").unwrap();
        assert!(configured_engine(&root).unwrap_err().contains("must be"));
    }

    #[test]
    fn refuses_destination_inside_source_workspace() {
        let (_dir, root) = fixture();
        assert!(destination_parent(&root, root.to_str().unwrap()).is_err());
    }

    #[test]
    fn cleans_staging_directory_after_copy_failure() {
        let (_dir, root) = fixture();
        let output = tempdir().unwrap();
        let mut prepared = prepare_bundle(portable(&root)).unwrap();
        prepared.files[0].rel_path = "../escape.tex".to_string();
        let error = create_prepared_bundle(prepared, portable(output.path())).unwrap_err();
        assert!(error.contains("unsafe relative path"));
        let names = std::fs::read_dir(output.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(names.is_empty(), "staging output left behind: {names:?}");
    }

    #[test]
    fn refuses_to_create_when_manifest_has_missing_source() {
        let (_dir, root) = fixture();
        std::fs::write(root.join("main.tex"), "\\input{missing-section}").unwrap();
        let output = tempdir().unwrap();
        let error = create_bundle_sync(portable(&root), portable(output.path())).unwrap_err();
        assert!(error.contains("unresolved files"));
        assert!(std::fs::read_dir(output.path()).unwrap().next().is_none());
    }
}

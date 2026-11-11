//! Build-folder registry and the commands that use a finished build: its PDF,
//! export, cleanup and cancellation.
//!
//! Each document has one build folder (see `build_dir`), named by an identity:
//! the main file's canonical path, or a tab id for a document without one. The
//! frontend refers to it by an opaque token that stays the same across builds.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tempfile::TempDir;

use super::MAIN_PDF;

pub struct Build {
    dir: TempDir,
    identity: String,
    /// Held while a compile writes into the folder.
    pub(crate) busy: tokio::sync::Mutex<()>,
}

impl Build {
    pub fn path(&self) -> &Path {
        self.dir.path()
    }
}

#[derive(Default)]
struct Builds {
    by_token: HashMap<String, Arc<Build>>,
    token_of: HashMap<String, String>,
}

#[derive(Default)]
pub struct LatexState {
    builds: Mutex<Builds>,
    pub cancellations: Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
}

impl LatexState {
    pub fn get(&self, token: &str) -> Option<Arc<Build>> {
        self.builds.lock().by_token.get(token).cloned()
    }
    /// The build folder of `identity` and its token, created on first use.
    pub fn build_for(&self, identity: &str) -> Result<(String, Arc<Build>), String> {
        let mut builds = self.builds.lock();
        if let Some(token) = builds.token_of.get(identity) {
            if let Some(build) = builds.by_token.get(token) {
                return Ok((token.clone(), build.clone()));
            }
        }
        let dir = TempDir::new().map_err(|e| format!("create build folder: {e}"))?;
        let token = uuid::Uuid::new_v4().to_string();
        let build = Arc::new(Build { dir, identity: identity.to_string(), busy: Default::default() });
        builds.by_token.insert(token.clone(), build.clone());
        builds.token_of.insert(identity.to_string(), token.clone());
        Ok((token, build))
    }
    /// Forgets a build; its folder is deleted once no compile still uses it.
    pub fn remove(&self, token: &str) {
        let mut builds = self.builds.lock();
        if let Some(build) = builds.by_token.remove(token) {
            if builds.token_of.get(&build.identity).is_some_and(|t| t == token) {
                builds.token_of.remove(&build.identity);
            }
        }
    }
    pub fn clear(&self) {
        for flag in self.cancellations.lock().values() { flag.store(true, std::sync::atomic::Ordering::SeqCst); }
        *self.builds.lock() = Builds::default();
    }
}

pub struct CompileGuard<'a> { pub id: String, pub state: &'a LatexState }
impl Drop for CompileGuard<'_> {
    fn drop(&mut self) { self.state.cancellations.lock().remove(&self.id); }
}
#[tauri::command]
pub fn cancel_latex_compile(request_id: String, state: tauri::State<'_, LatexState>) -> Result<(), String> {
    if request_id.len() > 100 { return Err("invalid request ID".into()); }
    let mut registry = state.cancellations.lock();
    if registry.len() >= 100 && !registry.contains_key(&request_id) { return Err("too many pending cancellations".into()); }
    registry.entry(request_id).or_default().store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn cleanup_workdir(workdir_token: String, state: tauri::State<'_, LatexState>) -> Result<(), String> {
    state.remove(&workdir_token);
    Ok(())
}

/// The PDF of a document's last build, as raw bytes (an `ArrayBuffer` in the
/// frontend), so a large PDF does not travel as base64 text.
#[tauri::command]
pub fn read_build_pdf(workdir_token: String, state: tauri::State<'_, LatexState>) -> Result<tauri::ipc::Response, String> {
    let build = state.get(&workdir_token).ok_or_else(|| "no compiled output (compile first)".to_string())?;
    let bytes = std::fs::read(build.path().join(MAIN_PDF)).map_err(|e| format!("read PDF: {e}"))?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("the build left no PDF".into());
    }
    Ok(tauri::ipc::Response::new(bytes))
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
    let target = std::path::PathBuf::from(&target_path);
    if !target.is_absolute() {
        return Err("target_path must be absolute".to_string());
    }
    // Reject writes into the compile workdir; that dir is auto-cleaned.
    // Both sides must be canonicalized: on macOS, TempDir returns a path through
    // /var/folders/… which is a symlink to /private/var/folders/…, so a raw
    // starts_with check against a canonicalized target would always fail.
    if let (Ok(canon_target_parent), Ok(canon_workdir)) = (
        target.parent().ok_or(()).and_then(|p| std::fs::canonicalize(p).map_err(|_| ())),
        std::fs::canonicalize(dir.path()),
    ) {
        if canon_target_parent.starts_with(&canon_workdir) {
            return Err("cannot export into the compile workdir".to_string());
        }
    }
    std::fs::copy(&src, &target).map_err(|e| format!("copy failed: {e}"))?;
    Ok(())
}

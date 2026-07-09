//! Compile-workdir registry (keyed by opaque token) and the commands that
//! operate on a previously-produced workdir: cleanup, PDF export, log read.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tempfile::TempDir;

use super::MAIN_PDF;

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
    let target = std::path::PathBuf::from(&target_path);
    if !target.is_absolute() {
        return Err("target_path must be absolute".to_string());
    }
    // Reject writes into the compile workdir; that dir is auto-cleaned.
    if let Ok(canon_target_parent) = target.parent().ok_or(())
        .and_then(|p| std::fs::canonicalize(p).map_err(|_| ()))
    {
        if canon_target_parent.starts_with(dir.path()) {
            return Err("cannot export into the compile workdir".to_string());
        }
    }
    std::fs::copy(&src, &target).map_err(|e| format!("copy failed: {e}"))?;
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

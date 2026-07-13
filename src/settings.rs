//! Persistent user settings + LaTeX/Bib engine detection.
//!
//! Settings live at `<config_dir>/clavis/settings.json`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_engine")]
    pub latex_engine: String,
    #[serde(default = "default_bib_engine")]
    pub bib_engine: String,
    #[serde(default = "default_true")]
    pub auto_rerun: bool,
    #[serde(default = "default_max_runs")]
    pub max_runs: u32,
    #[serde(default)]
    pub latex_custom_paths: HashMap<String, String>,
    #[serde(default = "default_dark_mode")]
    pub pdf_dark_mode: String,
    #[serde(default = "default_editor_font_family")]
    pub editor_font_family: String,
    #[serde(default = "default_editor_font_size")]
    pub editor_font_size: u32,
    #[serde(default = "default_editor_line_height")]
    pub editor_line_height: f32,
    #[serde(default = "default_editor_theme")]
    pub editor_theme: String,
    /// Optional per-key color overrides on top of the chosen theme.
    /// Recognised keys: bg, fg, gutter_bg, gutter_fg, active_bg, cursor, selection.
    #[serde(default)]
    pub editor_theme_overrides: HashMap<String, String>,
    #[serde(default)]
    pub editor_spellcheck: bool,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub recent_folders: Vec<String>,
    #[serde(default)]
    pub pane_sidebar_width: u32,
    #[serde(default)]
    pub pane_editor_width: u32,
    /// Frontend-owned settings this struct doesn't model explicitly
    /// (ui_theme, ui_font_*, pdf_bg_color, editor_tab_size, …). Without this
    /// catch-all, serde would silently drop them on save and every UI
    /// preference would reset on restart.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn default_engine() -> String { "pdflatex".to_string() }
fn default_bib_engine() -> String { "auto".to_string() }
fn default_true() -> bool { true }
fn default_max_runs() -> u32 { 4 }
fn default_dark_mode() -> String { "off".to_string() }
fn default_editor_font_family() -> String {
    "\"Cascadia Code\", \"JetBrains Mono\", \"Fira Code\", Consolas, Menlo, monospace".to_string()
}
fn default_editor_font_size() -> u32 { 14 }
fn default_editor_line_height() -> f32 { 1.55 }
fn default_editor_theme() -> String { "auto".to_string() }

impl Default for Settings {
    fn default() -> Self {
        Self {
            latex_engine: default_engine(),
            bib_engine: default_bib_engine(),
            auto_rerun: true,
            max_runs: default_max_runs(),
            latex_custom_paths: HashMap::new(),
            pdf_dark_mode: default_dark_mode(),
            editor_font_family: default_editor_font_family(),
            editor_font_size: default_editor_font_size(),
            editor_line_height: default_editor_line_height(),
            editor_theme: default_editor_theme(),
            editor_theme_overrides: HashMap::new(),
            editor_spellcheck: false,
            recent_files: Vec::new(),
            recent_folders: Vec::new(),
            pane_sidebar_width: 0,
            pane_editor_width: 0,
            extra: serde_json::Map::new(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = clavis_config_dir()?;
    let new_path = dir.join("settings.json");
    // One-shot migration from the previous "tritypeset" name. If our file doesn't
    // exist yet but the legacy one does, copy it across silently.
    if !new_path.exists() {
        if let Some(base) = tauri::api::path::config_dir() {
            let legacy = base.join("tritypeset").join("settings.json");
            if legacy.exists() {
                let _ = std::fs::copy(&legacy, &new_path);
            }
        }
    }
    let _ = app; // currently unused but reserved
    Some(new_path)
}

/// The `<config_dir>/clavis` directory, created if missing. Shared by settings
/// and session persistence so they live side by side.
pub fn clavis_config_dir() -> Option<PathBuf> {
    let base = tauri::api::path::config_dir()?;
    let dir = base.join("clavis");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

fn load_from_disk(app: &AppHandle) -> Settings {
    let Some(p) = settings_path(app) else { return Settings::default(); };
    let Ok(bytes) = std::fs::read(&p) else { return Settings::default(); };
    serde_json::from_slice::<Settings>(&bytes).unwrap_or_default()
}

fn save_to_disk(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let p = settings_path(app).ok_or_else(|| "no config dir available".to_string())?;
    let bytes = serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(&p, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    load_from_disk(&app)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    save_to_disk(&app, &settings)
}

// ---------------- Session persistence ----------------
//
// The session (open tabs + their content + active tab) is persisted as an
// opaque JSON string owned entirely by the frontend. Rust just reads/writes the
// blob to `<config_dir>/clavis/session.json`, so the session schema can evolve
// without touching Rust. This backs crash recovery / restore-on-launch.

fn session_path() -> Option<PathBuf> {
    Some(clavis_config_dir()?.join("session.json"))
}

/// Return the persisted session JSON blob, or an empty string if none exists.
#[tauri::command]
pub fn load_session() -> String {
    session_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default()
}

/// Persist the session JSON blob. Written atomically (temp file + rename) so a
/// crash mid-write can't truncate an existing good session.
#[tauri::command]
pub fn save_session(data: String) -> Result<(), String> {
    let p = session_path().ok_or_else(|| "no config dir available".to_string())?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, data.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct EngineInfo {
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
}

fn probe_engine(name: &str, custom: Option<&str>, version_arg: &str) -> EngineInfo {
    // 1) custom path first if provided & non-empty
    let resolved: Option<PathBuf> = custom
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(|| which::which(name).ok())
        .or_else(|| crate::latex::find_in_fallback_dirs(name));

    let Some(path) = resolved else {
        return EngineInfo { name: name.to_string(), path: None, version: None };
    };
    let version = Command::new(&path)
        .arg(version_arg)
        .output()
        .ok()
        .and_then(|out| {
            let s = String::from_utf8_lossy(&out.stdout).to_string();
            s.lines().next().map(|l| l.trim().to_string())
        });
    EngineInfo {
        name: name.to_string(),
        path: Some(path.to_string_lossy().to_string()),
        version,
    }
}

#[tauri::command]
pub fn detect_latex_engines(app: AppHandle) -> Vec<EngineInfo> {
    let s = load_from_disk(&app);
    let names = ["pdflatex", "xelatex", "lualatex"];
    names
        .iter()
        .map(|n| {
            let custom = s.latex_custom_paths.get(*n).map(String::as_str);
            probe_engine(n, custom, "--version")
        })
        .collect()
}

#[tauri::command]
pub fn detect_bib_engines(app: AppHandle) -> Vec<EngineInfo> {
    let s = load_from_disk(&app);
    let names = ["bibtex", "biber"];
    names
        .iter()
        .map(|n| {
            let custom = s.latex_custom_paths.get(*n).map(String::as_str);
            probe_engine(n, custom, "--version")
        })
        .collect()
}

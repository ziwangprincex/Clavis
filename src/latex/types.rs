//! IPC-facing types shared across the latex submodules.

use serde::{Deserialize, Serialize};

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
    /// Source file the diagnostic refers to (project-relative, e.g.
    /// "chapters/intro.tex"), when the engine reported one. None = main/root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// For `missing-file`: the inferred package or file name (without extension).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogLine {
    pub run: u32,
    pub stream: &'static str, // "stdout" | "stderr" | "info"
    pub text: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunStart {
    pub run: u32,
    pub command: String,
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

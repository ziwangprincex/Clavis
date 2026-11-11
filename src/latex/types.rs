//! IPC-facing types shared across the latex submodules.

use serde::{Deserialize, Serialize};

use super::project::{CollectResult, SourceOverlay};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileOptions {
    /// Text of a document that has no saved main file. Ignored when
    /// `root_path` is set: the main file's text then comes from the snapshot.
    #[serde(default)]
    pub source: String,
    /// Absolute path of the saved main `.tex`. The backend reads the project
    /// from disk itself, with `documents` laid over it, and a successful build
    /// also writes `<stem>.pdf` beside it, as other TeX editors do.
    #[serde(default)]
    pub root_path: Option<String>,
    /// Open editor buffers (path and text) to use instead of the files on disk.
    #[serde(default)]
    pub documents: Vec<SourceOverlay>,
    /// Names the build folder of a document without a main file (a tab id).
    #[serde(default)]
    pub source_identity: Option<String>,
    /// Start from an empty build folder, without the previous auxiliary files.
    #[serde(default)]
    pub clean: bool,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub full_build: bool,
    #[serde(default)]
    pub workspace_root: Option<String>,
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
}

fn default_true() -> bool { true }
fn default_max_runs() -> u32 { 4 }

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    /// The build produced a PDF; read it with `read_build_pdf`.
    pub ok: bool,
    pub errors: Vec<LatexDiag>,
    pub log_tail: String,
    pub runs: u32,
    pub workdir_token: Option<String>,
    /// The program that typeset the document (`xelatex`, or `latexmk` for a full build).
    pub engine: String,
    /// `bibtex` or `biber` when the bibliography was processed during this build.
    pub bib_tool: Option<String>,
    /// Where the PDF was saved beside the source, when it was.
    pub saved_pdf: Option<String>,
    /// Why the PDF could not be saved beside the source. The build still succeeded.
    pub pdf_save_error: Option<String>,
    /// The project as it was compiled (none for a document without a main file).
    pub snapshot: Option<CollectResult>,
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

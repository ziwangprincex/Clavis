//! Real LaTeX compilation via system pdflatex / xelatex / lualatex.
//!
//! Features:
//! - Streaming logs over Tauri events (`latex-log`, `latex-run-start`, `latex-done`)
//! - Auto rerun for cross references and BibTeX/biber
//! - Configurable engine + custom path
//! - SyncTeX forward / backward via the `synctex` CLI
//! - Workdir registry keyed by token so SyncTeX can find the .synctex.gz later
//!
//! Split into focused submodules. Tauri commands are registered in `main.rs`
//! by their canonical path (e.g. `latex::compile::compile_latex`) because the
//! `#[tauri::command]` macro generates a sibling `__cmd__*` helper that a
//! `pub use` re-export would not carry. Only the handful of items used by other
//! crates modules are re-exported below.

pub(crate) mod compile;
pub(crate) mod diagnostics;
pub(crate) mod distro;
pub(crate) mod engine;
pub(crate) mod project;
pub(crate) mod synctex;
pub(crate) mod types;
pub(crate) mod workdir;

// Used outside this module: `main.rs` manages the workdir state and handles the
// destroy event; `settings.rs` probes engine fallback dirs.
pub use engine::find_in_fallback_dirs;
pub use workdir::LatexState;

/// Names of the main source / output files inside every compile workdir.
/// Shared by compile, synctex, and workdir commands.
pub(crate) const MAIN_TEX: &str = "main.tex";
pub(crate) const MAIN_PDF: &str = "main.pdf";

// ---------------- BibTeX entry parsing ----------------
// Parser lives in `crate::bib`; this thin command just forwards.

#[tauri::command]
pub fn parse_bib(bib_paths: Vec<String>) -> Vec<crate::bib::BibEntry> {
    crate::bib::parse_bib_files(bib_paths)
}

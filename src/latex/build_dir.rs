//! The build folder of a document: one per project (or per document without a
//! main file), reused across compiles. Auxiliary files (.aux, .toc, .bbl,
//! latexmk's database) stay where the engine left them, and only sources that
//! changed are written again.
//!
//! The folder is emptied first whenever an input that old auxiliary files
//! depend on changes: the toolchain, the set of files, or any resource other
//! than a `.tex` source (LaTeX's own reruns settle those). So a removed
//! `\input` can never be satisfied by a source left over from an earlier build.

use std::path::Path;

use sha2::{Digest, Sha256};

use super::project::{is_font_like_ext, is_safe_relpath};
use super::types::CompileOptions;
use super::MAIN_TEX;

/// Records what the folder's auxiliary files were built from.
const STAMP: &str = ".clavis-inputs.json";

/// One file of the build, besides `main.tex`.
pub(crate) struct Input<'a> {
    /// Path inside the build folder, with forward slashes.
    pub rel_path: &'a str,
    pub content: Content<'a>,
}

pub(crate) enum Content<'a> {
    Text(&'a str),
    /// A binary file (image, font), copied from disk.
    File(&'a Path),
}

impl Input<'_> {
    pub fn extension(&self) -> String {
        Path::new(self.rel_path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
    }
    pub fn is_font(&self) -> bool {
        matches!(self.content, Content::File(_)) && is_font_like_ext(&self.extension())
    }
}

/// What old auxiliary files are valid for: the toolchain, the set of files,
/// and the content of every input except `.tex` sources.
pub(crate) fn signature(opts: &CompileOptions, inputs: &[Input]) -> String {
    let mut files: Vec<(&str, String)> = inputs
        .iter()
        .map(|input| {
            let stamp = match &input.content {
                Content::Text(_) if input.extension() == "tex" => String::new(),
                Content::Text(text) => format!("{:x}", Sha256::digest(text.as_bytes())),
                Content::File(path) => std::fs::metadata(path)
                    .map(|meta| {
                        let modified = meta.modified().ok()
                            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                            .map_or(0, |since| since.as_nanos());
                        format!("{}:{modified}", meta.len())
                    })
                    .unwrap_or_default(),
            };
            (input.rel_path, stamp)
        })
        .collect();
    files.sort();
    serde_json::to_string(&(
        opts.engine.as_str(),
        &opts.custom_path,
        &opts.bib_engine,
        opts.full_build,
        files,
    ))
    .expect("a signature is plain data")
}

/// Make `dir` hold `main_source` as `main.tex` plus every input. With a new
/// signature, or when `clean`, the folder is emptied first.
pub(crate) fn sync(dir: &Path, signature: &str, clean: bool, main_source: &str, inputs: &[Input]) -> Result<(), String> {
    let previous = std::fs::read_to_string(dir.join(STAMP)).ok();
    if clean || previous.as_deref() != Some(signature) {
        empty(dir)?;
    }
    for input in inputs {
        if !is_safe_relpath(input.rel_path) {
            return Err(format!("rejected unsafe relative path: {}", input.rel_path));
        }
        if input.rel_path == MAIN_TEX {
            continue;
        }
        let target = dir.join(input.rel_path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        match &input.content {
            Content::Text(text) => write_if_changed(&target, text.as_bytes())?,
            // A changed binary changes the signature, which empties the folder,
            // so one that is present is current.
            Content::File(source) => {
                if !target.exists() {
                    std::fs::copy(source, &target).map_err(|e| format!("copy {}: {e}", input.rel_path))?;
                }
                // fontspec finds fonts by file name in the folder of main.tex.
                if input.is_font() {
                    let alias = dir.join(Path::new(input.rel_path).file_name().unwrap_or_default());
                    if alias != target && !alias.exists() {
                        let _ = std::fs::copy(source, alias);
                    }
                }
            }
        }
    }
    write_if_changed(&dir.join(MAIN_TEX), main_source.as_bytes())?;
    std::fs::write(dir.join(STAMP), signature).map_err(|e| format!("write build stamp: {e}"))
}

/// Leaves an unchanged file alone, so its modification time keeps meaning
/// "changed" to latexmk.
fn write_if_changed(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if std::fs::read(path).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    std::fs::write(path, bytes).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Removes everything inside `dir`, keeping the folder itself.
fn empty(dir: &Path) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read build folder: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read build folder: {e}"))?;
        let path = entry.path();
        let removed = if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        removed.map_err(|e| format!("clear build folder ({}): {e}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> CompileOptions {
        serde_json::from_value(serde_json::json!({ "engine": "xelatex" })).unwrap()
    }

    fn build(dir: &Path, opts: &CompileOptions, main: &str, inputs: &[Input]) {
        sync(dir, &signature(opts, inputs), false, main, inputs).unwrap();
    }

    #[test]
    fn auxiliary_files_stay_while_only_tex_sources_change() {
        let dir = tempfile::tempdir().unwrap();
        let opts = options();
        let inputs = [
            Input { rel_path: "chapter.tex", content: Content::Text("one") },
            Input { rel_path: "refs.bib", content: Content::Text("@book{a,}") },
        ];
        build(dir.path(), &opts, "main one", &inputs);
        std::fs::write(dir.path().join("main.aux"), "aux").unwrap();
        let inputs = [
            Input { rel_path: "chapter.tex", content: Content::Text("two") },
            Input { rel_path: "refs.bib", content: Content::Text("@book{a,}") },
        ];
        build(dir.path(), &opts, "main two", &inputs);
        assert_eq!(std::fs::read_to_string(dir.path().join("main.aux")).unwrap(), "aux");
        assert_eq!(std::fs::read_to_string(dir.path().join("chapter.tex")).unwrap(), "two");
        assert_eq!(std::fs::read_to_string(dir.path().join(MAIN_TEX)).unwrap(), "main two");
    }

    #[test]
    fn a_removed_source_or_changed_resource_empties_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let opts = options();
        let chapter = Input { rel_path: "chapter.tex", content: Content::Text("chapter") };
        let bib = Input { rel_path: "refs.bib", content: Content::Text("old") };
        build(dir.path(), &opts, "main", &[chapter, bib]);
        std::fs::write(dir.path().join("main.aux"), "aux").unwrap();

        // The chapter is no longer part of the project: it must not survive.
        build(dir.path(), &opts, "main", &[Input { rel_path: "refs.bib", content: Content::Text("old") }]);
        assert!(!dir.path().join("chapter.tex").exists());
        assert!(!dir.path().join("main.aux").exists());

        std::fs::write(dir.path().join("main.aux"), "aux").unwrap();
        build(dir.path(), &opts, "main", &[Input { rel_path: "refs.bib", content: Content::Text("new") }]);
        assert!(!dir.path().join("main.aux").exists(), "a changed bibliography invalidates the .bbl and .aux");
    }

    #[test]
    fn a_clean_build_or_another_engine_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        let opts = options();
        build(dir.path(), &opts, "main", &[]);
        std::fs::write(dir.path().join("main.aux"), "aux").unwrap();
        sync(dir.path(), &signature(&opts, &[]), true, "main", &[]).unwrap();
        assert!(!dir.path().join("main.aux").exists());

        std::fs::write(dir.path().join("main.aux"), "aux").unwrap();
        let lualatex: CompileOptions = serde_json::from_value(serde_json::json!({ "engine": "lualatex" })).unwrap();
        build(dir.path(), &lualatex, "main", &[]);
        assert!(!dir.path().join("main.aux").exists());
    }

    #[test]
    fn binary_files_are_copied_once_and_fonts_also_by_name() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir(project.path().join("fonts")).unwrap();
        let font = project.path().join("fonts/Body.otf");
        std::fs::write(&font, b"font").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let opts = options();
        let inputs = [Input { rel_path: "fonts/Body.otf", content: Content::File(&font) }];
        build(dir.path(), &opts, "main", &inputs);
        assert_eq!(std::fs::read(dir.path().join("fonts/Body.otf")).unwrap(), b"font");
        assert_eq!(std::fs::read(dir.path().join("Body.otf")).unwrap(), b"font");

        // A second build with the same font does not copy it again.
        std::fs::write(dir.path().join("fonts/Body.otf"), b"marker").unwrap();
        build(dir.path(), &opts, "main", &inputs);
        assert_eq!(std::fs::read(dir.path().join("fonts/Body.otf")).unwrap(), b"marker");
    }

    #[test]
    fn unchanged_sources_keep_their_modification_time() {
        let dir = tempfile::tempdir().unwrap();
        let opts = options();
        let inputs = [Input { rel_path: "chapter.tex", content: Content::Text("same") }];
        build(dir.path(), &opts, "main", &inputs);
        let before = std::fs::metadata(dir.path().join("chapter.tex")).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        build(dir.path(), &opts, "main", &inputs);
        let after = std::fs::metadata(dir.path().join("chapter.tex")).unwrap().modified().unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn unsafe_paths_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let opts = options();
        let inputs = [Input { rel_path: "../escape.tex", content: Content::Text("x") }];
        assert!(sync(dir.path(), &signature(&opts, &inputs), false, "main", &inputs).is_err());
    }
}

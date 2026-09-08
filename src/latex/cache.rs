//! Reuse only auxiliary outputs, never materialized sources or old PDFs.
use super::types::CompileOptions;
use std::path::Path;

fn signature(opts: &CompileOptions) -> String {
    let mut files: Vec<_> = opts
        .project_files
        .iter()
        .map(|file| {
            let content = if file.rel_path.ends_with(".tex") {
                String::new()
            } else {
                file.binary_base64
                    .clone()
                    .unwrap_or_else(|| file.content.clone())
            };
            (file.rel_path.clone(), content)
        })
        .collect();
    files.sort();
    serde_json::to_string(&(
        opts.engine.as_str(),
        &opts.custom_path,
        &opts.bib_engine,
        opts.full_build,
        &opts.source_identity,
        files,
    ))
    .unwrap()
}

pub fn prepare(
    opts: &CompileOptions,
    previous: Option<&Path>,
    destination: &Path,
) -> Result<(), String> {
    let signature = signature(opts);
    let valid = previous.is_some_and(|path| {
        std::fs::read_to_string(path.join(".clavis-inputs.json"))
            .ok()
            .as_deref()
            == Some(signature.as_str())
    });
    if valid {
        let previous = previous.unwrap();
        let mut stems = vec!["main".to_string()];
        stems.extend(
            opts.project_files
                .iter()
                .filter_map(|file| file.rel_path.strip_suffix(".tex").map(str::to_string)),
        );
        for stem in stems {
            for extension in ["aux", "toc", "out", "lof", "lot", "bbl", "bcf", "run.xml"] {
                let relative = format!("{stem}.{extension}");
                if !super::project::is_safe_relpath(&relative) {
                    continue;
                }
                let from = previous.join(&relative);
                if std::fs::symlink_metadata(&from)
                    .is_ok_and(|m| m.file_type().is_file() && m.len() < 16 * 1024 * 1024)
                {
                    let to = destination.join(&relative);
                    if let Some(parent) = to.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    std::fs::copy(from, to).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    std::fs::write(destination.join(".clavis-inputs.json"), signature).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options() -> CompileOptions {
        serde_json::from_value(serde_json::json!({ "source": "hello", "engine": "xelatex", "projectFiles": [{"relPath":"chapter.tex","content":"chapter"}, {"relPath":"refs.bib","content":"bibliography"}]})).unwrap()
    }
    #[test]
    fn removed_sources_or_changed_resources_invalidate_auxiliaries() {
        let old = tempfile::tempdir().unwrap();
        let next = tempfile::tempdir().unwrap();
        let mut opts = options();
        prepare(&opts, None, old.path()).unwrap();
        std::fs::write(old.path().join("main.aux"), "aux").unwrap();
        std::fs::write(old.path().join("main.pdf"), "stale PDF").unwrap();
        std::fs::write(old.path().join("removed.tex"), "stale source").unwrap();
        opts.source = "edited".into();
        prepare(&opts, Some(old.path()), next.path()).unwrap();
        assert!(next.path().join("main.aux").exists());
        assert!(!next.path().join("main.pdf").exists());
        assert!(!next.path().join("removed.tex").exists());
        opts.project_files.remove(0);
        let removed = tempfile::tempdir().unwrap();
        prepare(&opts, Some(old.path()), removed.path()).unwrap();
        assert!(!removed.path().join("main.aux").exists());
        let mut opts = options();
        opts.project_files[1].content = "new bibliography".into();
        let changed = tempfile::tempdir().unwrap();
        prepare(&opts, Some(old.path()), changed.path()).unwrap();
        assert!(!changed.path().join("main.aux").exists());
    }
}

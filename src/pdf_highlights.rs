//! Highlights a reader marks on a compiled PDF. They are kept beside the main
//! source as `<main>.highlights.json`, so they outlive rebuilds and travel
//! with the project. The file's path is derived here from the source; the page
//! only ever names the `.tex` file it compiled.

use std::path::{Path, PathBuf};

/// A highlight file this size or smaller is accepted.
const MAX_BYTES: usize = 4 * 1024 * 1024;

fn sidecar(source: &str) -> Result<PathBuf, String> {
    let path = Path::new(source);
    let is_tex = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tex"));
    if !is_tex || !path.is_file() {
        return Err("highlights belong to an existing .tex source".into());
    }
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or("the source has no file name")?;
    Ok(path.with_file_name(format!("{stem}.highlights.json")))
}

/// The file's contents; empty when there are no highlights yet.
#[tauri::command]
pub fn read_pdf_highlights(source: String) -> Result<String, String> {
    let path = sidecar(&source)?;
    match std::fs::metadata(&path) {
        Ok(meta) if meta.len() > MAX_BYTES as u64 => {
            return Err(format!("{} is larger than {} MB", path.display(), MAX_BYTES / 1024 / 1024))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(format!("cannot read {}: {error}", path.display())),
        Ok(_) => {}
    }
    std::fs::read_to_string(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

/// Replaces the file atomically. A file without highlights is removed rather
/// than left behind empty.
#[tauri::command]
pub fn write_pdf_highlights(source: String, json: String) -> Result<(), String> {
    use std::io::Write;
    let path = sidecar(&source)?;
    if json.len() > MAX_BYTES {
        return Err(format!("highlights are larger than {} MB", MAX_BYTES / 1024 / 1024));
    }
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|error| format!("invalid highlights: {error}"))?;
    let Some(list) = value.get("highlights").and_then(|list| list.as_array()) else {
        return Err("invalid highlights: no list".into());
    };
    if list.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err(format!("cannot remove {}: {error}", path.display()))
            }
            _ => Ok(()),
        };
    }
    let parent = path.parent().ok_or("the source has no folder")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    file.write_all(json.as_bytes()).map_err(|error| error.to_string())?;
    file.as_file().sync_all().map_err(|error| error.to_string())?;
    file.persist(&path).map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_sits_beside_an_existing_tex_source() {
        let dir = tempfile::tempdir().unwrap();
        let tex = dir.path().join("paper.tex");
        std::fs::write(&tex, "x").unwrap();
        assert_eq!(sidecar(tex.to_str().unwrap()).unwrap(), dir.path().join("paper.highlights.json"));
        assert!(sidecar(dir.path().join("missing.tex").to_str().unwrap()).is_err());
        let other = dir.path().join("notes.md");
        std::fs::write(&other, "x").unwrap();
        assert!(sidecar(other.to_str().unwrap()).is_err());
    }

    #[test]
    fn writes_reads_and_removes_when_empty() {
        let dir = tempfile::tempdir().unwrap();
        let tex = dir.path().join("paper.tex");
        std::fs::write(&tex, "x").unwrap();
        let source = tex.to_string_lossy().into_owned();
        assert_eq!(read_pdf_highlights(source.clone()).unwrap(), "");
        let json = r#"{"version":1,"highlights":[{"id":"a"}]}"#;
        write_pdf_highlights(source.clone(), json.into()).unwrap();
        assert_eq!(read_pdf_highlights(source.clone()).unwrap(), json);
        assert!(write_pdf_highlights(source.clone(), "not json".into()).is_err());
        write_pdf_highlights(source.clone(), r#"{"version":1,"highlights":[]}"#.into()).unwrap();
        assert!(!dir.path().join("paper.highlights.json").exists());
    }
}

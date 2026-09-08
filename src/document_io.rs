//! Version-checked document saves. Cooperating operations are serialized; a
//! sibling temporary file is synced before replacement. External programs do
//! not participate in our lock: re-check immediately before rename, but do not
//! claim a portable cross-process compare-and-swap filesystem primitive.
use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

static DOCUMENT_IO: Mutex<()> = Mutex::new(());
const MAX_DOCUMENT_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSnapshot {
    pub content: Option<String>,
    pub revision: String,
    pub stamp: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub path: String,
    pub stamp: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveResult {
    Saved {
        revision: String,
        stamp: String,
        history_warning: Option<String>,
    },
    Conflict {
        disk: DiskSnapshot,
    },
}

fn revision(content: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(content.as_bytes()))
}

fn resolved(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Document path must be absolute".into());
    }
    match std::fs::canonicalize(path) {
        Ok(target) => Ok(target),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Never replace a dangling symlink with an unrelated regular file.
            if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err("Document is a dangling symbolic link; choose Save As".into());
            }
            let parent = path.parent().ok_or("Document has no parent folder")?;
            let parent = std::fs::canonicalize(parent).map_err(|e| e.to_string())?;
            Ok(parent.join(path.file_name().ok_or("Document has no filename")?))
        }
        Err(error) => Err(error.to_string()),
    }
}

fn stamp(path: &Path) -> Result<String, String> {
    let target = resolved(path)?;
    match std::fs::metadata(&target) {
        Ok(meta) => {
            if !meta.is_file() {
                return Err("Document is not a regular file".into());
            }
            let modified = meta
                .modified()
                .map_err(|e| e.to_string())?
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            #[cfg(unix)]
            let identity = {
                use std::os::unix::fs::MetadataExt;
                format!(
                    "{}:{}:{}:{}",
                    meta.dev(),
                    meta.ino(),
                    meta.ctime(),
                    meta.ctime_nsec()
                )
            };
            #[cfg(not(unix))]
            let identity = format!("{:?}", meta.created().ok());
            Ok(format!(
                "{}|{}|{modified}|{identity}",
                target.display(),
                meta.len()
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok("missing".into()),
        Err(error) => Err(error.to_string()),
    }
}

fn read(path: &Path) -> Result<DiskSnapshot, String> {
    // Guard against a file being replaced while read. Don't return content with
    // another version's stamp, which would suppress the next external check.
    for _ in 0..3 {
        let before = stamp(path)?;
        let content = match std::fs::File::open(path) {
            Ok(file) => {
                if file.metadata().map_err(|e| e.to_string())?.len() > MAX_DOCUMENT_BYTES {
                    return Err("Document exceeds the 32 MiB safe-edit limit".into());
                }
                let mut bytes = Vec::new();
                file.take(MAX_DOCUMENT_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
                    return Err("Document exceeds the 32 MiB safe-edit limit".into());
                }
                Some(String::from_utf8(bytes).map_err(|_| "Document is not valid UTF-8")?)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.to_string()),
        };
        let after = stamp(path)?;
        if before == after {
            return Ok(DiskSnapshot {
                revision: content
                    .as_deref()
                    .map(revision)
                    .unwrap_or_else(|| "missing".into()),
                content,
                stamp: after,
            });
        }
    }
    Err("Document keeps changing on disk; retry after the other writer finishes".into())
}

fn save_with_history(
    path: &Path,
    contents: &str,
    expected: &str,
    checkpoint: impl FnOnce(&str) -> Result<(), String>,
) -> Result<SaveResult, String> {
    if contents.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("Document exceeds the 32 MiB safe-edit limit".into());
    }
    let target = resolved(path)?;
    let disk = read(path)?;
    if disk.revision != expected {
        return Ok(SaveResult::Conflict { disk });
    }
    if disk.content.as_deref() == Some(contents) {
        return Ok(SaveResult::Saved {
            revision: disk.revision,
            stamp: disk.stamp,
            history_warning: None,
        });
    }
    let mut temp = tempfile::Builder::new()
        .prefix(".clavis-save-")
        .tempfile_in(target.parent().ok_or("Document has no parent folder")?)
        .map_err(|e| e.to_string())?;
    if let Ok(metadata) = std::fs::metadata(&target) {
        if metadata.permissions().readonly() {
            return Err("Document is read-only; choose Save As".into());
        }
        // Atomic replacement would break hard links. Refuse instead of silently
        // making other aliases stale. Symlinks resolve to their target above.
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() > 1 {
                return Err(
                    "Document has hard links; choose Save As to preserve its aliases".into(),
                );
            }
        }
        temp.as_file()
            .set_permissions(metadata.permissions())
            .map_err(|e| e.to_string())?;
    }
    temp.write_all(contents.as_bytes())
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    let history_warning = disk
        .content
        .as_deref()
        .and_then(|text| checkpoint(text).err());
    let current = read(path)?;
    if current.revision != expected || resolved(path)? != target {
        return Ok(SaveResult::Conflict { disk: current });
    }
    if expected == "missing" {
        match temp.persist_noclobber(&target) {
            Ok(_) => (),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Ok(SaveResult::Conflict { disk: read(path)? });
            }
            Err(error) => return Err(error.error.to_string()),
        }
    } else {
        temp.persist(&target).map_err(|e| e.error.to_string())?;
    }
    // Preserve the revision WE wrote. A later external writer is detected on
    // the next probe/save rather than accidentally accepted as our baseline.
    Ok(SaveResult::Saved {
        revision: revision(contents),
        stamp: String::new(),
        history_warning,
    })
}

#[tauri::command]
pub async fn read_document(path: String) -> Result<DiskSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DOCUMENT_IO.lock();
        read(Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn probe_documents(paths: Vec<String>) -> Result<Vec<Probe>, String> {
    if paths.len() > 200 {
        return Err("Too many documents in one probe".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| match stamp(Path::new(&path)) {
                Ok(value) => Probe {
                    path,
                    stamp: Some(value),
                    error: None,
                },
                Err(error) => Probe {
                    path,
                    stamp: None,
                    error: Some(error),
                },
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_document(
    path: String,
    contents: String,
    expected_revision: String,
) -> Result<SaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DOCUMENT_IO.lock();
        save_with_history(Path::new(&path), &contents, &expected_revision, |text| {
            crate::local_history::record(&path, text)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn save(path: &Path, content: &str, revision: &str) -> Result<SaveResult, String> {
        save_with_history(path, content, revision, |_| Ok(()))
    }
    #[test]
    fn history_captures_previous_disk_and_failure_does_not_block_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("main.typ");
        std::fs::write(&path, "previous").unwrap();
        let baseline = read(&path).unwrap();
        let mut captured = String::new();
        let result = save_with_history(&path, "new", &baseline.revision, |text| {
            captured = text.into();
            Err("history disk full".into())
        })
        .unwrap();
        assert_eq!(captured, "previous");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert!(matches!(
            result,
            SaveResult::Saved {
                history_warning: Some(_),
                ..
            }
        ));
    }
    #[test]
    fn external_edits_conflict_even_with_same_length() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.typ");
        std::fs::write(&p, "first").unwrap();
        let base = read(&p).unwrap();
        std::fs::write(&p, "other").unwrap();
        assert!(matches!(
            save(&p, "mine", &base.revision).unwrap(),
            SaveResult::Conflict { .. }
        ));
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "other");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn deletion_and_creation_are_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.tex");
        let missing = read(&p).unwrap();
        assert_eq!(missing.revision, "missing");
        assert!(matches!(
            save(&p, "first", &missing.revision).unwrap(),
            SaveResult::Saved { .. }
        ));
        assert!(matches!(
            save(&p, "new", "missing").unwrap(),
            SaveResult::Conflict { .. }
        ));
        let base = read(&p).unwrap();
        std::fs::remove_file(&p).unwrap();
        assert!(matches!(
            save(&p, "new", &base.revision).unwrap(),
            SaveResult::Conflict { .. }
        ));
    }
    #[test]
    fn explicit_resolution_still_checks_latest_version() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        std::fs::write(&p, "disk").unwrap();
        let reviewed = read(&p).unwrap();
        assert!(matches!(
            save(&p, "merged", &reviewed.revision).unwrap(),
            SaveResult::Saved { .. }
        ));
        assert_eq!(read(&p).unwrap().content.as_deref(), Some("merged"));
        assert!(matches!(
            save(&p, "stale confirmation", &reviewed.revision).unwrap(),
            SaveResult::Conflict { .. }
        ));
    }
    #[test]
    fn invalid_utf8_and_non_files_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("binary");
        std::fs::write(&p, [255, 254]).unwrap();
        assert!(read(&p).is_err());
        assert!(save(&p, "mine", "missing").is_err());
        assert_eq!(std::fs::read(&p).unwrap(), [255, 254]);
        assert!(read(dir.path()).is_err());
        assert!(read(Path::new("relative.typ")).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn preserves_symlinks_and_permissions_and_refuses_hardlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.typ");
        let alias = dir.path().join("alias.typ");
        std::fs::write(&p, "old").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o640)).unwrap();
        symlink(&p, &alias).unwrap();
        let base = read(&alias).unwrap();
        save(&alias, "new", &base.revision).unwrap();
        assert!(std::fs::symlink_metadata(&alias)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "new");
        assert_eq!(
            std::fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o640
        );
        std::fs::hard_link(&p, dir.path().join("hard.typ")).unwrap();
        assert!(save(&p, "third", &read(&p).unwrap().revision)
            .unwrap_err()
            .contains("hard links"));
    }
    #[cfg(unix)]
    #[test]
    fn dangling_symlink_is_not_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let alias = dir.path().join("alias.typ");
        std::os::unix::fs::symlink(dir.path().join("missing.typ"), &alias).unwrap();
        assert!(save(&alias, "new", "missing").is_err());
        assert!(std::fs::symlink_metadata(alias)
            .unwrap()
            .file_type()
            .is_symlink());
    }
    #[test]
    fn same_content_save_and_unicode_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("论文.typ");
        save(&p, "正文 😀\r\n", "missing").unwrap();
        let snapshot = read(&p).unwrap();
        assert_eq!(snapshot.content.as_deref(), Some("正文 😀\r\n"));
        assert!(matches!(
            save(&p, snapshot.content.as_deref().unwrap(), &snapshot.revision).unwrap(),
            SaveResult::Saved { .. }
        ));
    }
}

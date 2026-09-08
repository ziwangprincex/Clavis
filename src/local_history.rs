//! Content snapshots, independent of Git. Only this module owns retention.
use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
static HISTORY: Mutex<()> = Mutex::new(());
const PER_DOCUMENT: usize = 50;
const TOTAL_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Serialize)]
pub struct Version {
    pub id: String,
    pub timestamp: u64,
    pub bytes: u64,
}
fn root() -> Result<PathBuf, String> {
    Ok(crate::settings::clavis_config_dir()
        .ok_or("No local settings directory")?
        .join("history"))
}
fn folder(root: &Path, path: &str) -> PathBuf {
    // Canonicalize existing aliases, but history remains readable after deletion.
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
    root.join(format!(
        "{:x}",
        Sha256::digest(path.to_string_lossy().as_bytes())
    ))
}
fn entries(dir: &Path) -> Result<Vec<Version>, String> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut versions = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().and_then(|s| s.to_str()) != Some("txt") {
            continue;
        }
        let id = entry
            .path()
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let Some(timestamp) = id.split('-').next().and_then(|s| s.parse().ok()) else {
            continue;
        };
        versions.push(Version {
            id,
            timestamp,
            bytes: entry.metadata().map_err(|e| e.to_string())?.len(),
        });
    }
    versions.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(versions)
}
fn record_at(root: &Path, path: &str, content: &str) -> Result<(), String> {
    if content.len() > 32 * 1024 * 1024 {
        return Err("Version exceeds 32 MiB".into());
    }
    let dir = folder(root, path);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let hash = format!("{:x}", Sha256::digest(content.as_bytes()));
    let versions = entries(&dir)?;
    if versions.first().is_some_and(|v| v.id.ends_with(&hash)) {
        return Ok(());
    }
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let millis = millis.max(versions.first().map_or(0, |v| u128::from(v.timestamp) + 1));
    let id = format!("{millis:013}-{hash}");
    let mut tmp = tempfile::NamedTempFile::new_in(&dir).map_err(|e| e.to_string())?;
    tmp.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(dir.join(format!("{id}.txt")))
        .map_err(|e| e.to_string())?;
    for v in entries(&dir)?.into_iter().skip(PER_DOCUMENT) {
        std::fs::remove_file(dir.join(format!("{}.txt", v.id))).map_err(|e| e.to_string())?;
    }
    prune(root, TOTAL_BYTES)
}
fn prune(root: &Path, budget: u64) -> Result<(), String> {
    let mut all = Vec::new();
    for dir in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let dir = dir.map_err(|e| e.to_string())?.path();
        if !dir.is_dir() {
            continue;
        }
        for v in entries(&dir)? {
            all.push((v.timestamp, v.bytes, dir.join(format!("{}.txt", v.id))));
        }
    }
    all.sort_by_key(|v| v.0);
    let mut total: u64 = all.iter().map(|v| v.1).sum();
    for (_, size, path) in all {
        if total <= budget {
            break;
        }
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
        total -= size;
    }
    Ok(())
}
pub fn record(path: &str, content: &str) -> Result<(), String> {
    let _guard = HISTORY.lock();
    record_at(&root()?, path, content)
}
#[tauri::command]
pub async fn checkpoint_document(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || record(&path, &content))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn list_document_versions(path: String) -> Result<Vec<Version>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = HISTORY.lock();
        entries(&folder(&root()?, &path))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_document_version(path: String, id: String) -> Result<String, String> {
    if !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("Invalid version identifier".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = HISTORY.lock();
        std::fs::read_to_string(folder(&root()?, &path).join(format!("{id}.txt")))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deduplicates_latest_and_keeps_exact_unicode() {
        let root = tempfile::tempdir().unwrap();
        let path = "/paper/main.typ";
        record_at(root.path(), path, "论文\r\n").unwrap();
        record_at(root.path(), path, "论文\r\n").unwrap();
        let dir = folder(root.path(), path);
        let versions = entries(&dir).unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(
            std::fs::read_to_string(dir.join(format!("{}.txt", versions[0].id))).unwrap(),
            "论文\r\n"
        );
        assert!(entries(&folder(root.path(), "/other/main.typ"))
            .unwrap()
            .is_empty());
    }
    #[test]
    fn bounded_per_document_and_globally() {
        let root = tempfile::tempdir().unwrap();
        for n in 0..60 {
            record_at(root.path(), "/main.typ", &format!("version {n}")).unwrap();
        }
        assert_eq!(
            entries(&folder(root.path(), "/main.typ")).unwrap().len(),
            PER_DOCUMENT
        );
        prune(root.path(), 20).unwrap();
        assert!(
            entries(&folder(root.path(), "/main.typ"))
                .unwrap()
                .iter()
                .map(|v| v.bytes)
                .sum::<u64>()
                <= 20
        );
    }
}

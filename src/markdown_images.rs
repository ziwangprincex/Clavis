//! Images pasted or dropped into a Markdown document. They are placed in an
//! `assets` folder beside the document and referenced by a relative path, so
//! the document and its images move together. Nothing existing is overwritten.

use base64::Engine as _;
use std::io::Write as _;
use std::path::{Component, Path, PathBuf};

const FOLDER: &str = "assets";
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];

fn document_dir(document: &str) -> Result<PathBuf, String> {
    let document = std::fs::canonicalize(document).map_err(|e| format!("document not found on disk: {e}"))?;
    document.parent().map(Path::to_path_buf).ok_or_else(|| "document has no folder".to_string())
}

fn image_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    EXTENSIONS.contains(&extension.as_str()).then_some(extension)
}

/// `a/b.png` relative to the document's folder, with forward slashes.
fn relative(dir: &Path, path: &Path) -> String {
    path.strip_prefix(dir).unwrap_or(path).components()
        .filter_map(|c| match c { Component::Normal(part) => part.to_str(), _ => None })
        .collect::<Vec<_>>().join("/")
}

/// Writes `bytes` under `stem.extension`, or `stem-2.extension` and so on when
/// the name is taken by a different file. An identical file is reused.
fn write_unique(dir: &Path, stem: &str, extension: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    for n in 1..1000 {
        let name = if n == 1 { format!("{stem}.{extension}") } else { format!("{stem}-{n}.{extension}") };
        let path = dir.join(name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    let _ = std::fs::remove_file(&path);
                    return Err(format!("cannot write image: {e}"));
                }
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if std::fs::read(&path).is_ok_and(|existing| existing == bytes) { return Ok(path); }
            }
            Err(e) => return Err(format!("cannot write image: {e}")),
        }
    }
    Err("too many images with this name".into())
}

/// A file name usable on every platform, without the extension.
fn safe_stem(path: &Path) -> String {
    let stem: String = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image").chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '-' })
        .collect();
    let stem = stem.trim_matches(['-', '.']);
    if stem.is_empty() { "image".into() } else { stem.chars().take(80).collect() }
}

fn save(document: &str, extension: &str, data: &str) -> Result<String, String> {
    let extension = extension.to_ascii_lowercase();
    if !EXTENSIONS.contains(&extension.as_str()) { return Err(format!("unsupported image type: {extension}")); }
    if data.len() as u64 > MAX_IMAGE_BYTES * 4 / 3 + 4 { return Err("image is larger than 20 MB".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| format!("invalid image data: {e}"))?;
    let dir = document_dir(document)?;
    let stem = format!("image-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    Ok(relative(&dir, &write_unique(&dir.join(FOLDER), &stem, &extension, &bytes)?))
}

fn place(document: &str, source: &str) -> Result<String, String> {
    let dir = document_dir(document)?;
    let source = std::fs::canonicalize(source).map_err(|e| format!("image not found: {e}"))?;
    let extension = image_extension(&source).ok_or_else(|| "not an image file".to_string())?;
    // Already beside the document: refer to it where it is.
    if source.starts_with(&dir) { return Ok(relative(&dir, &source)); }
    let size = std::fs::metadata(&source).map_err(|e| format!("cannot read image: {e}"))?.len();
    if size > MAX_IMAGE_BYTES { return Err("image is larger than 20 MB".into()); }
    let bytes = std::fs::read(&source).map_err(|e| format!("cannot read image: {e}"))?;
    Ok(relative(&dir, &write_unique(&dir.join(FOLDER), &safe_stem(&source), &extension, &bytes)?))
}

/// Saves clipboard image data (base64) and returns its path relative to the document.
#[tauri::command]
pub async fn save_markdown_image(document: String, extension: String, data: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || save(&document, &extension, &data))
        .await
        .map_err(|e| format!("image worker failed: {e}"))?
}

/// Returns a dropped image's path relative to the document, copying it into
/// the assets folder when it lives elsewhere.
#[tauri::command]
pub async fn place_markdown_image(document: String, source: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || place(&document, &source))
        .await
        .map_err(|e| format!("image worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf, String) {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let document = root.join("notes").join("draft.md");
        std::fs::create_dir_all(document.parent().unwrap()).unwrap();
        std::fs::write(&document, "# Draft").unwrap();
        (dir, root, document.to_string_lossy().into_owned())
    }

    #[test]
    fn pasted_images_get_new_names_and_never_overwrite() {
        let (_dir, root, document) = setup();
        let a = save(&document, "PNG", &base64::engine::general_purpose::STANDARD.encode(b"one")).unwrap();
        let b = save(&document, "png", &base64::engine::general_purpose::STANDARD.encode(b"two")).unwrap();
        assert!(a.starts_with("assets/image-") && a.ends_with(".png"));
        assert_ne!(a, b);
        assert_eq!(std::fs::read(root.join("notes").join(&a)).unwrap(), b"one");
        assert_eq!(std::fs::read(root.join("notes").join(&b)).unwrap(), b"two");
        assert!(save(&document, "exe", "AAAA").is_err());
    }

    #[test]
    fn dropped_images_are_referenced_in_place_or_copied_beside_the_document() {
        let (_dir, root, document) = setup();
        std::fs::create_dir_all(root.join("notes/figures")).unwrap();
        std::fs::write(root.join("notes/figures/plot.png"), b"plot").unwrap();
        assert_eq!(place(&document, root.join("notes/figures/plot.png").to_str().unwrap()).unwrap(), "figures/plot.png");

        std::fs::write(root.join("My Photo.jpg"), b"photo").unwrap();
        let outside = root.join("My Photo.jpg");
        assert_eq!(place(&document, outside.to_str().unwrap()).unwrap(), "assets/My-Photo.jpg");
        // The same file again reuses the copy; a different one with that name does not replace it.
        assert_eq!(place(&document, outside.to_str().unwrap()).unwrap(), "assets/My-Photo.jpg");
        std::fs::write(&outside, b"another").unwrap();
        assert_eq!(place(&document, outside.to_str().unwrap()).unwrap(), "assets/My-Photo-2.jpg");
        assert_eq!(std::fs::read(root.join("notes/assets/My-Photo.jpg")).unwrap(), b"photo");

        std::fs::write(root.join("notes.txt"), b"text").unwrap();
        assert!(place(&document, root.join("notes.txt").to_str().unwrap()).is_err());
    }
}

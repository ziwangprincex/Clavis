//! Images pasted or dropped into a Markdown document. They are placed in a
//! folder beside the document (`assets` unless the settings or the document's
//! front matter choose another, as Typora allows) and referenced by a relative
//! path, so the document and its images move together. The folder stays inside
//! the workspace, or the document's own folder outside one. Nothing existing is
//! overwritten.

use base64::Engine as _;
use std::io::Write as _;
use std::path::{Component, Path, PathBuf};

const DEFAULT_FOLDER: &str = "assets";
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

/// `a/b.png` or `../images/b.png` relative to the document's folder, with forward slashes.
fn relative(dir: &Path, path: &Path) -> String {
    let from: Vec<_> = dir.components().collect();
    let to: Vec<_> = path.components().collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let up = std::iter::repeat_n("..".to_string(), from.len() - common);
    let down = to[common..].iter().filter_map(|c| match c { Component::Normal(part) => part.to_str().map(str::to_string), _ => None });
    up.chain(down).collect::<Vec<_>>().join("/")
}

/// The folder images go to: `spec` (relative to the document, `${filename}` for its
/// name) resolved beside the document. It must stay inside `limit`.
fn image_folder(document: &Path, dir: &Path, spec: Option<&str>, limit: &Path) -> Result<PathBuf, String> {
    let spec = spec.map(str::trim).filter(|spec| !spec.is_empty()).unwrap_or(DEFAULT_FOLDER);
    let name = document.file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let spec = spec.replace("${filename}", name);
    let mut folder = dir.to_path_buf();
    for component in Path::new(&spec).components() {
        match component {
            Component::Normal(part) => folder.push(part),
            Component::CurDir => {}
            Component::ParentDir => { folder.pop(); }
            Component::RootDir | Component::Prefix(_) => return Err("the image folder must be a relative path".into()),
        }
    }
    if !folder.starts_with(limit) {
        return Err("the image folder must stay inside the workspace".into());
    }
    Ok(folder)
}

/// Creates `folder` and checks where it really is, so a symlink cannot lead outside `limit`.
fn create_folder(folder: &Path, limit: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(folder).map_err(|e| format!("cannot create {}: {e}", folder.display()))?;
    let real = std::fs::canonicalize(folder).map_err(|e| format!("cannot open {}: {e}", folder.display()))?;
    if !real.starts_with(limit) { return Err("the image folder must stay inside the workspace".into()); }
    Ok(real)
}

/// The workspace root when the document is inside it, otherwise the document's folder.
fn folder_limit(dir: &Path, root: Option<&str>) -> PathBuf {
    root.and_then(|root| std::fs::canonicalize(root).ok())
        .filter(|root| dir.starts_with(root))
        .unwrap_or_else(|| dir.to_path_buf())
}

/// Writes `bytes` under `stem.extension`, or `stem-2.extension` and so on when
/// the name is taken by a different file. An identical file is reused.
fn write_unique(dir: &Path, stem: &str, extension: &str, bytes: &[u8]) -> Result<PathBuf, String> {
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

/// Where images of `document` go, created and checked.
fn target_folder(document: &str, folder: Option<&str>, root: Option<&str>) -> Result<(PathBuf, PathBuf), String> {
    let dir = document_dir(document)?;
    let limit = folder_limit(&dir, root);
    let path = std::fs::canonicalize(document).map_err(|e| format!("document not found on disk: {e}"))?;
    let target = create_folder(&image_folder(&path, &dir, folder, &limit)?, &limit)?;
    Ok((dir, target))
}

fn save(document: &str, extension: &str, data: &str, folder: Option<&str>, root: Option<&str>) -> Result<String, String> {
    let extension = extension.to_ascii_lowercase();
    if !EXTENSIONS.contains(&extension.as_str()) { return Err(format!("unsupported image type: {extension}")); }
    if data.len() as u64 > MAX_IMAGE_BYTES * 4 / 3 + 4 { return Err("image is larger than 20 MB".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| format!("invalid image data: {e}"))?;
    let (dir, target) = target_folder(document, folder, root)?;
    let stem = format!("image-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    Ok(relative(&dir, &write_unique(&target, &stem, &extension, &bytes)?))
}

fn place(document: &str, source: &str, folder: Option<&str>, root: Option<&str>) -> Result<String, String> {
    let dir = document_dir(document)?;
    let source = std::fs::canonicalize(source).map_err(|e| format!("image not found: {e}"))?;
    let extension = image_extension(&source).ok_or_else(|| "not an image file".to_string())?;
    // Already beside the document: refer to it where it is.
    if source.starts_with(&dir) { return Ok(relative(&dir, &source)); }
    let size = std::fs::metadata(&source).map_err(|e| format!("cannot read image: {e}"))?.len();
    if size > MAX_IMAGE_BYTES { return Err("image is larger than 20 MB".into()); }
    let bytes = std::fs::read(&source).map_err(|e| format!("cannot read image: {e}"))?;
    let (dir, target) = target_folder(document, folder, root)?;
    Ok(relative(&dir, &write_unique(&target, &safe_stem(&source), &extension, &bytes)?))
}

/// Saves clipboard image data (base64) and returns its path relative to the
/// document. `folder` is relative to the document (default `assets`); `root` is
/// the open workspace, which the folder may not leave.
#[tauri::command]
pub async fn save_markdown_image(document: String, extension: String, data: String, folder: Option<String>, root: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || save(&document, &extension, &data, folder.as_deref(), root.as_deref()))
        .await
        .map_err(|e| format!("image worker failed: {e}"))?
}

/// Returns a dropped image's path relative to the document, copying it into
/// the image folder when it lives elsewhere.
#[tauri::command]
pub async fn place_markdown_image(document: String, source: String, folder: Option<String>, root: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || place(&document, &source, folder.as_deref(), root.as_deref()))
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
        let a = save(&document, "PNG", &base64::engine::general_purpose::STANDARD.encode(b"one"), None, None).unwrap();
        let b = save(&document, "png", &base64::engine::general_purpose::STANDARD.encode(b"two"), None, None).unwrap();
        assert!(a.starts_with("assets/image-") && a.ends_with(".png"));
        assert_ne!(a, b);
        assert_eq!(std::fs::read(root.join("notes").join(&a)).unwrap(), b"one");
        assert_eq!(std::fs::read(root.join("notes").join(&b)).unwrap(), b"two");
        assert!(save(&document, "exe", "AAAA", None, None).is_err());
    }

    #[test]
    fn dropped_images_are_referenced_in_place_or_copied_beside_the_document() {
        let (_dir, root, document) = setup();
        std::fs::create_dir_all(root.join("notes/figures")).unwrap();
        std::fs::write(root.join("notes/figures/plot.png"), b"plot").unwrap();
        assert_eq!(place(&document, root.join("notes/figures/plot.png").to_str().unwrap(), None, None).unwrap(), "figures/plot.png");

        std::fs::write(root.join("My Photo.jpg"), b"photo").unwrap();
        let outside = root.join("My Photo.jpg");
        assert_eq!(place(&document, outside.to_str().unwrap(), None, None).unwrap(), "assets/My-Photo.jpg");
        // The same file again reuses the copy; a different one with that name does not replace it.
        assert_eq!(place(&document, outside.to_str().unwrap(), None, None).unwrap(), "assets/My-Photo.jpg");
        std::fs::write(&outside, b"another").unwrap();
        assert_eq!(place(&document, outside.to_str().unwrap(), None, None).unwrap(), "assets/My-Photo-2.jpg");
        assert_eq!(std::fs::read(root.join("notes/assets/My-Photo.jpg")).unwrap(), b"photo");

        std::fs::write(root.join("notes.txt"), b"text").unwrap();
        assert!(place(&document, root.join("notes.txt").to_str().unwrap(), None, None).is_err());
    }

    #[test]
    fn the_image_folder_follows_the_setting_and_stays_inside_the_workspace() {
        let (_dir, root, document) = setup();
        let png = base64::engine::general_purpose::STANDARD.encode(b"img");
        let named = save(&document, "png", &png, Some("${filename}.assets"), None).unwrap();
        assert!(named.starts_with("draft.assets/image-"), "{named}");
        let beside = save(&document, "png", &png, Some("."), None).unwrap();
        assert!(beside.starts_with("image-") && !beside.contains('/'), "{beside}");
        // Up to the workspace's own folder, with the workspace open; not past it.
        let workspace = root.to_str().unwrap();
        let up = save(&document, "png", &png, Some("../images"), Some(workspace)).unwrap();
        assert!(up.starts_with("../images/image-"), "{up}");
        assert!(root.join("images").is_dir());
        assert!(save(&document, "png", &png, Some("../../outside"), Some(workspace)).is_err());
        // Without a workspace, the document's folder is the limit.
        assert!(save(&document, "png", &png, Some("../images"), None).is_err());
        assert!(save(&document, "png", &png, Some("/tmp/abs"), None).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_image_folder_cannot_lead_outside() {
        let (_dir, root, document) = setup();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("notes/escape")).unwrap();
        let png = base64::engine::general_purpose::STANDARD.encode(b"img");
        assert!(save(&document, "png", &png, Some("escape"), None).is_err());
    }
}

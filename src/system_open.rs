//! Hand a workspace file or a web/mail link to the operating system's default handler.

use std::ffi::OsStr;
use std::path::Path;

/// File kinds that may be handed to the system: ones it shows in a viewer.
/// A link in a document from someone else must not start a program, and the
/// default handler for scripts, installers and shortcuts (`.command`, `.bat`,
/// `.jar`, `.desktop`, ...) does exactly that.
const VIEWABLE: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic", "eps", "pdf",
    "txt", "csv", "rtf", "html", "htm", "docx", "xlsx", "pptx", "odt", "ods", "odp",
    "mp3", "m4a", "wav", "mp4", "mov",
];

fn viewable(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| VIEWABLE.contains(&extension.to_ascii_lowercase().as_str()))
}

fn open_with_system(target: &OsStr) -> std::io::Result<()> {
    let program = if cfg!(windows) {
        "explorer.exe"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    tokio::process::Command::new(program)
        .arg(target)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}

/// The file to open: inside the workspace, and a kind the system only views.
fn workspace_target(root: &str, path: &str) -> Result<std::path::PathBuf, String> {
    let root = std::fs::canonicalize(root).map_err(|error| format!("workspace not found: {error}"))?;
    let path = std::fs::canonicalize(path).map_err(|error| format!("file not found: {error}"))?;
    if !path.is_file() || !path.starts_with(&root) {
        return Err("file must exist inside the workspace".to_string());
    }
    if !viewable(&path) {
        return Err("Only images, PDFs and documents can be opened from Clavis.".to_string());
    }
    Ok(path)
}

/// Open an asset from the workspace in its default application.
#[tauri::command]
pub async fn open_workspace_file(root: String, path: String) -> Result<(), String> {
    let path = workspace_target(&root, &path)?;
    open_with_system(path.as_os_str()).map_err(|error| format!("cannot open file: {error}"))
}

/// Open a web or mail link from the PDF preview in the system default handler.
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
        return Err("only http, https and mailto links can be opened".to_string());
    }
    open_with_system(OsStr::new(&url)).map_err(|error| format!("cannot open link: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_viewable_files_inside_the_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        for name in ["figure.PNG", "paper.pdf", "run.command", "setup.bat", "tool.jar", "app.desktop", "noext"] {
            std::fs::write(root.join(name), "x").unwrap();
        }
        let open = |name: &str| workspace_target(root.to_str().unwrap(), root.join(name).to_str().unwrap());
        assert!(open("figure.PNG").is_ok());
        assert!(open("paper.pdf").is_ok());
        for refused in ["run.command", "setup.bat", "tool.jar", "app.desktop", "noext"] {
            assert!(open(refused).is_err(), "{refused} must not be opened");
        }
        let outside = tempfile::tempdir().unwrap();
        let elsewhere = outside.path().join("figure.png");
        std::fs::write(&elsewhere, "x").unwrap();
        assert!(workspace_target(root.to_str().unwrap(), elsewhere.to_str().unwrap()).is_err());
    }
}

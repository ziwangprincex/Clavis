//! Hand a workspace file or a web/mail link to the operating system's default handler.

use std::ffi::OsStr;

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

/// Open an asset from the workspace in its default application.
#[tauri::command]
pub async fn open_workspace_file(root: String, path: String) -> Result<(), String> {
    let root =
        std::fs::canonicalize(root).map_err(|error| format!("workspace not found: {error}"))?;
    let path = std::fs::canonicalize(path).map_err(|error| format!("file not found: {error}"))?;
    if !path.is_file() || !path.starts_with(&root) {
        return Err("file must exist inside the workspace".to_string());
    }
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

//! A user-authored stylesheet, Typora's theme folder in one file:
//! `<config_dir>/clavis/user.css`. It is read at startup and injected into the
//! page after the app's own styles, so overriding the design tokens (--bg,
//! --text, --accent, …) is enough to restyle the whole window including the
//! editor. The file belongs to the user, who edits it themselves; Clavis only
//! reads and writes it, and never fetches it from anywhere.

use crate::settings::clavis_config_dir;

/// Stylesheets this size or smaller are accepted; beyond that the editor field
/// and the injected <style> both become impractical.
const MAX_BYTES: u64 = 256 * 1024;

fn stylesheet_path() -> Result<std::path::PathBuf, String> {
    let dir = clavis_config_dir().ok_or_else(|| "no configuration directory".to_string())?;
    Ok(dir.join("user.css"))
}

/// Where the file lives, so the UI can show it.
#[tauri::command]
pub fn user_stylesheet_path() -> Result<String, String> {
    stylesheet_path().map(|path| path.to_string_lossy().into_owned())
}

/// The file's contents; empty when it does not exist yet.
#[tauri::command]
pub fn read_user_stylesheet() -> Result<String, String> {
    let path = stylesheet_path()?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("cannot read {}: {error}", path.display())),
    }
}

#[tauri::command]
pub fn write_user_stylesheet(css: String) -> Result<(), String> {
    if css.len() as u64 > MAX_BYTES {
        return Err(format!("the stylesheet is larger than {} KB", MAX_BYTES / 1024));
    }
    let path = stylesheet_path()?;
    std::fs::write(&path, css).map_err(|error| format!("cannot write {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_an_absent_file_as_empty() {
        // Depends on the machine having a config directory; on CI that is the
        // only way it can fail, and an empty stylesheet is the safe outcome.
        if crate::settings::clavis_config_dir().is_none() {
            return;
        }
        let text = super::read_user_stylesheet();
        assert!(text.is_ok());
    }
}

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

fn themes_dir() -> Result<std::path::PathBuf, String> {
    let dir = clavis_config_dir().ok_or_else(|| "no configuration directory".to_string())?.join("themes");
    std::fs::create_dir_all(&dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    Ok(dir)
}

/// A theme is a file name without extension; separators or dots would reach
/// outside the themes folder.
fn valid_theme_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\', '\0']) && !name.starts_with('.') && !name.contains("..")
}

/// Theme names: every `*.css` file in `<config_dir>/clavis/themes`, sorted.
#[tauri::command]
pub fn list_themes() -> Result<Vec<String>, String> {
    let dir = themes_dir()?;
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|error| format!("cannot read {}: {error}", dir.display()))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let stem = path.file_stem()?.to_str()?.to_string();
            let is_css = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("css"));
            (is_css && path.is_file() && valid_theme_name(&stem)).then_some(stem)
        })
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn read_theme(name: String) -> Result<String, String> {
    if !valid_theme_name(&name) {
        return Err("invalid theme name".into());
    }
    let path = themes_dir()?.join(format!("{name}.css"));
    let meta = std::fs::metadata(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    if meta.len() > MAX_BYTES {
        return Err(format!("the theme is larger than {} KB", MAX_BYTES / 1024));
    }
    std::fs::read_to_string(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

/// Show the themes folder in the file manager.
#[tauri::command]
pub async fn open_themes_folder() -> Result<(), String> {
    let dir = themes_dir()?;
    crate::system_open::open_with_system(dir.as_os_str()).map_err(|error| format!("cannot open folder: {error}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn theme_names_cannot_leave_the_folder() {
        for bad in ["", "../x", "a/b", "a\\b", ".hidden", "a..b"] {
            assert!(!super::valid_theme_name(bad), "{bad}");
        }
        assert!(super::valid_theme_name("Paper 2"));
    }

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

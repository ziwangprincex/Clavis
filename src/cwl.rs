//! Loading of TeXstudio `.cwl` completion word lists.
//!
//! LaTeX ships no machine-readable command index, so autocompletion relies on
//! the community-maintained `.cwl` corpus bundled under `resources/cwl/`
//! (fetched at build time by `tools/fetch-cwl.mjs`; GPLv3, see the generated
//! `LICENSE-cwl.md`).
//!
//! Files are served **by package name**, never by path: the names originate in
//! `\usepackage{...}` inside a user document, which is untrusted input. The
//! same `[A-Za-z0-9._+-]` whitelist that guards `install_package` applies here,
//! so there is no path-traversal surface — consistent with the security model's
//! rule that the frontend holds no filesystem capability.

use std::path::PathBuf;
use tauri::AppHandle;

/// Longest package name we will look up. TeX package names are short; this only
/// exists to bound the work done on hostile input.
const MAX_NAME_LEN: usize = 80;

/// A `.cwl` file large enough to be suspect. The biggest real file is
/// `biblatex.cwl` at ~276 KiB, so this leaves generous headroom while keeping a
/// corrupt or hostile user-supplied file from being read into memory wholesale.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Reject anything that is not a bare package name.
///
/// Mirrors `install_package`'s whitelist rather than relying on path
/// canonicalisation: `..`, `/`, `\`, NUL and drive letters all fail the
/// character test, so traversal cannot be expressed in the first place.
fn is_safe_package_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_LEN
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
        // A leading dot would allow `.` / `..` through the character test.
        && !name.starts_with('.')
}

/// User-supplied overrides live beside the other Clavis state, so a user can
/// add a `.cwl` for their own package or newer upstream data without a rebuild.
fn user_cwl_dir() -> Option<PathBuf> {
    Some(crate::settings::clavis_config_dir()?.join("cwl"))
}

/// The bundled corpus, resolved through Tauri so it works both in `dev` (where
/// it sits in the repo) and in a packaged app (where it is a bundled resource).
fn bundled_cwl_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path_resolver().resolve_resource("resources/cwl")
}

/// Read one `.cwl` file's text, preferring a user override over the bundle.
///
/// Returns `Ok(None)` when the package simply has no `.cwl` — the common case,
/// since a document may load packages the corpus does not cover. That is not an
/// error and must not be reported as one.
#[tauri::command]
pub fn read_cwl(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if !is_safe_package_name(&name) {
        return Err(format!("invalid cwl package name: {name}"));
    }
    let file = format!("{name}.cwl");

    let candidates = [user_cwl_dir(), bundled_cwl_dir(&app)];
    for dir in candidates.into_iter().flatten() {
        let path = dir.join(&file);
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        if !meta.is_file() {
            continue;
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(format!("{file}: exceeds {MAX_FILE_BYTES} byte limit"));
        }
        return match std::fs::read_to_string(&path) {
            Ok(text) => Ok(Some(text)),
            // A file that exists but is unreadable or not UTF-8 is worth
            // surfacing; falling through would hide a broken user override
            // behind the bundled copy.
            Err(e) => Err(format!("{file}: {e}")),
        };
    }
    Ok(None)
}

/// Which packages have a `.cwl` available at all.
///
/// The frontend uses this to avoid asking for files that cannot exist: without
/// it, a document loading 15 uncovered packages would trigger 15 failed reads
/// on every scan.
#[tauri::command]
pub fn list_cwl_packages(app: AppHandle) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    // Bundled first, then user overrides, deduplicated below — a user file with
    // the same name shadows the bundled one at read time.
    for dir in [bundled_cwl_dir(&app), user_cwl_dir()].into_iter().flatten() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("cwl") {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort_unstable();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::is_safe_package_name;

    #[test]
    fn accepts_real_package_names() {
        for name in [
            "amsmath",
            "latex-document",
            "class-beamer",
            "pgfplotslibrarydecorations.softclip",
            "tikzlibraryext.node-families.shapes.geometric",
            "IEEEtran",
            "url+",
            "t1enc",
        ] {
            assert!(is_safe_package_name(name), "should accept {name}");
        }
    }

    #[test]
    fn rejects_traversal_and_separators() {
        for name in [
            "",
            ".",
            "..",
            "../../etc/passwd",
            "..\\windows\\system32",
            "a/b",
            "a\\b",
            "/abs",
            "C:/abs",
            "with space",
            "quote'",
            "semi;colon",
            "null\0byte",
            ".hidden",
        ] {
            assert!(!is_safe_package_name(name), "should reject {name:?}");
        }
    }

    #[test]
    fn rejects_overlong_names() {
        assert!(!is_safe_package_name(&"a".repeat(81)));
        assert!(is_safe_package_name(&"a".repeat(80)));
    }
}

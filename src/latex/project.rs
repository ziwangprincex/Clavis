//! Multi-file LaTeX project collection: starting from a root `.tex`, follow
//! `\input`/`\include`/`\usepackage`/`\bibliography`/etc. and gather every
//! referenced file (plus a resource-tree sweep for images/fonts), all confined
//! to the root document's directory.
//!
//! Also hosts the path-safety helper and font helpers shared with `compile`.

use base64::Engine as _;
use serde::Serialize;
use std::path::{Path, PathBuf};

pub(crate) const MAX_PROJECT_FILES: usize = 200;
pub(crate) const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
pub(crate) const MAX_DEPTH: u32 = 5;

/// Reject paths that escape the project root or contain absolute components.
pub(crate) fn is_safe_relpath(rel: &str) -> bool {
    if rel.is_empty() { return false; }
    let p = Path::new(rel);
    if p.is_absolute() { return false; }
    for comp in p.components() {
        match comp {
            std::path::Component::Normal(_) => {}
            _ => return false, // ParentDir, RootDir, Prefix, CurDir all rejected
        }
    }
    true
}

pub(crate) fn is_font_like_ext(ext: &str) -> bool {
    matches!(ext,
        "otf" | "ttf" | "ttc" | "otc" | "woff" | "woff2" |
        "pfb" | "afm" | "pfm" | "vf" | "tfm"
    )
}

pub(crate) fn write_local_cjk_font_shim(workdir: &Path, source: &str, has_local_fonts: bool) -> std::io::Result<()> {
        if !has_local_fonts || !source.contains("zh_CN-Adobefonts_external") {
                return Ok(());
        }

        let shim = r#"\ProvidesPackage{zh_CN-Adobefonts_external}[2026/05/15 local font shim]
\RequirePackage{iftex}
\ifXeTeX
    \RequirePackage{fontspec}
    \RequirePackage{xeCJK}
    \defaultfontfeatures{Ligatures=TeX}
    \IfFileExists{font/AdobeSongStd-Light.otf}{%
        \setCJKmainfont[Path=font/,Extension=.otf]{AdobeSongStd-Light}%
    }{%
        \IfFileExists{font/AdobeSongStd-Light.ttf}{%
            \setCJKmainfont[Path=font/,Extension=.ttf]{AdobeSongStd-Light}%
        }{%
            \IfFontExistsTF{Noto Serif CJK SC}{%
                \setCJKmainfont{Noto Serif CJK SC}%
            }{%
                \IfFontExistsTF{PingFang SC}{%
                    \setCJKmainfont{PingFang SC}%
                }{%
                    \IfFontExistsTF{Songti SC}{%
                        \setCJKmainfont{Songti SC}%
                    }{%
                        \setCJKmainfont{STSong}%
                    }%
                }%
            }%
        }%
    }
\else
    \PackageError{zh_CN-Adobefonts_external}{XeLaTeX required}{Compile this document with XeLaTeX}%
\fi
"#;

        std::fs::write(workdir.join("zh_CN-Adobefonts_external.sty"), shim)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectedFile {
    pub rel_path: String,
    pub abs_path: String,
    pub content: String,
    pub is_bib: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary_base64: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectResult {
    pub root_rel: String,
    pub files: Vec<CollectedFile>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn collect_project_files(root: String) -> Result<CollectResult, String> {
    let root_path = std::fs::canonicalize(&root).map_err(|e| format!("canonicalize root: {e}"))?;
    if !root_path.is_file() {
        return Err(format!("not a file: {}", root_path.display()));
    }
    let root_dir = root_path.parent().ok_or_else(|| "no parent dir".to_string())?.to_path_buf();
    let root_dir_canon = std::fs::canonicalize(&root_dir).map_err(|e| format!("canon dir: {e}"))?;

    let mut warnings = Vec::new();
    let mut visited: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut out: Vec<CollectedFile> = Vec::new();

    let root_basename = root_path.file_name().and_then(|s| s.to_str()).unwrap_or("main.tex").to_string();

    fn read_text(p: &Path) -> Option<String> {
        let meta = std::fs::metadata(p).ok()?;
        if meta.len() > MAX_FILE_BYTES { return None; }
        std::fs::read_to_string(p).ok()
    }

    fn read_binary(p: &Path) -> Option<String> {
        let meta = std::fs::metadata(p).ok()?;
        if meta.len() > MAX_FILE_BYTES { return None; }
        let bytes = std::fs::read(p).ok()?;
        Some(base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    fn rel_from(base: &Path, full: &Path) -> Option<String> {
        full.strip_prefix(base).ok()
            .map(|p| p.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
    }

    fn binary_ext(ext: &str) -> bool {
        matches!(ext,
            "otf" | "ttf" | "ttc" | "otc" | "woff" | "woff2" |
            "pfb" | "afm" | "pfm" | "vf" | "tfm" |
            "png" | "jpg" | "jpeg" | "gif" | "pdf" | "eps"
        )
    }

    fn add_file(
        canon: PathBuf,
        root_dir_canon: &Path,
        visited: &mut std::collections::HashSet<PathBuf>,
        out: &mut Vec<CollectedFile>,
        warnings: &mut Vec<String>,
    ) {
        if visited.contains(&canon) { return; }
        let ext = canon.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let Some(rel) = rel_from(root_dir_canon, &canon) else { return };
        let is_bib = ext == "bib";
        let binary_base64 = if binary_ext(&ext) { read_binary(&canon) } else { None };
        let content = if binary_base64.is_some() {
            String::new()
        } else {
            match read_text(&canon) {
                Some(c) => c,
                None => {
                    warnings.push(format!("could not read or too large: {}", canon.display()));
                    return;
                }
            }
        };
        visited.insert(canon.clone());
        out.push(CollectedFile {
            rel_path: rel,
            abs_path: canon.to_string_lossy().to_string(),
            content,
            is_bib,
            binary_base64,
        });
    }

    // BFS
    let mut stack: Vec<(PathBuf, u32)> = vec![(root_path.clone(), 0)];
    let root_content = match read_text(&root_path) {
        Some(c) => c,
        None => return Err("cannot read root file".into()),
    };
    out.push(CollectedFile {
        rel_path: root_basename.clone(),
        abs_path: root_path.to_string_lossy().to_string(),
        content: root_content,
        is_bib: false,
        binary_base64: None,
    });
    visited.insert(root_path.clone());

    let re_input = regex::Regex::new(
        r"\\(?:input|include|subfile|InputIfFileExists|includegraphics(?:\[[^\]]*\])?)\{([^}]+)\}"
    ).unwrap();
    let re_documentclass = regex::Regex::new(
        r"\\documentclass\*?(?:\[[^\]]*\])?\{([^}]+)\}"
    ).unwrap();
    let re_package = regex::Regex::new(
        r"\\(?:usepackage|RequirePackage|LoadClass|LoadClassWithOptions)\*?(?:\[[^\]]*\])?\{([^}]+)\}"
    ).unwrap();
    let re_bib = regex::Regex::new(
        r"\\(?:bibliography|addbibresource)\{([^}]+)\}"
    ).unwrap();
    let re_import = regex::Regex::new(
        r"\\(?:import|subimport)\{([^}]+)\}\{([^}]+)\}"
    ).unwrap();

    enum ResolveHint {
        Generic,
        Bib,
        Class,
        Sty,
    }

    while let Some((path, depth)) = stack.pop() {
        if depth >= MAX_DEPTH { continue; }
        if out.len() >= MAX_PROJECT_FILES {
            warnings.push(format!("max project files ({}) reached", MAX_PROJECT_FILES));
            break;
        }
        let Some(text) = read_text(&path) else { continue };
        let here = path.parent().unwrap_or(&root_dir).to_path_buf();

        let mut try_resolve = |raw: &str, hint: ResolveHint| {
            let raw = raw.trim();
            // Strip optional leading ./
            let raw = raw.strip_prefix("./").unwrap_or(raw);
            // Build candidate paths with possible extensions
            let exts: &[&str] = match hint {
                ResolveHint::Bib => {
                    if raw.ends_with(".bib") { &[""] } else { &[".bib", ""] }
                }
                ResolveHint::Class => {
                    if raw.contains('.') { &[""] } else { &[".cls", ""] }
                }
                ResolveHint::Sty => {
                    if raw.contains('.') { &[""] } else { &[".sty", ""] }
                }
                ResolveHint::Generic => {
                    if raw.contains('.') { &[""] } else { &[".tex", ".ltx", ""] }
                }
            };
            for ext in exts {
                let mut candidate = here.join(format!("{raw}{ext}"));
                if !candidate.exists() {
                    // also try relative to root_dir
                    candidate = root_dir.join(format!("{raw}{ext}"));
                }
                if !candidate.exists() { continue; }
                let canon = match std::fs::canonicalize(&candidate) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                // sandbox: must be inside root_dir_canon
                if !canon.starts_with(&root_dir_canon) {
                    warnings.push(format!("rejected outside-root path: {}", canon.display()));
                    continue;
                }
                add_file(canon.clone(), &root_dir_canon, &mut visited, &mut out, &mut warnings);
                if !visited.contains(&canon) {
                    return;
                }
                let is_bib = canon.extension().and_then(|e| e.to_str()) == Some("bib");
                if !is_bib {
                    stack.push((canon, depth + 1));
                }
                return;
            }
            warnings.push(format!("could not resolve: {raw}"));
        };

        for cap in re_input.captures_iter(&text) {
            try_resolve(&cap[1], ResolveHint::Generic);
        }
        for cap in re_bib.captures_iter(&text) {
            // \bibliography{a,b,c} can list multiple
            for name in cap[1].split(',') {
                try_resolve(name.trim(), ResolveHint::Bib);
            }
        }
        for cap in re_import.captures_iter(&text) {
            let dir = cap[1].trim().trim_end_matches('/');
            let file = cap[2].trim();
            try_resolve(&format!("{dir}/{file}"), ResolveHint::Generic);
        }
        for cap in re_documentclass.captures_iter(&text) {
            let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            try_resolve(raw, ResolveHint::Class);
        }
        for cap in re_package.captures_iter(&text) {
            // \usepackage{a,b} can list multiple packages
            for name in cap[1].split(',') {
                try_resolve(name.trim(), ResolveHint::Sty);
            }
        }
    }

    fn scan_resource_tree(
        dir: &Path,
        root_dir_canon: &Path,
        depth: u32,
        visited: &mut std::collections::HashSet<PathBuf>,
        out: &mut Vec<CollectedFile>,
        warnings: &mut Vec<String>,
    ) {
        if depth >= MAX_DEPTH || out.len() >= MAX_PROJECT_FILES { return; }
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if out.len() >= MAX_PROJECT_FILES { break; }
            let path = entry.path();
            let Ok(canon) = std::fs::canonicalize(&path) else { continue };
            if !canon.starts_with(root_dir_canon) { continue; }
            if canon.is_dir() {
                scan_resource_tree(&canon, root_dir_canon, depth + 1, visited, out, warnings);
                continue;
            }
            if visited.contains(&canon) { continue; }
            let ext = canon.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            if !binary_ext(&ext) {
                continue;
            }
            add_file(canon, root_dir_canon, visited, out, warnings);
        }
    }

    scan_resource_tree(&root_dir_canon, &root_dir_canon, 0, &mut visited, &mut out, &mut warnings);

    Ok(CollectResult {
        root_rel: root_basename,
        files: out,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_safe_relpath_accepts_nested_relative() {
        assert!(is_safe_relpath("main.tex"));
        assert!(is_safe_relpath("chapters/intro.tex"));
        assert!(is_safe_relpath("a/b/c/fig.png"));
    }

    #[test]
    fn is_safe_relpath_rejects_traversal_and_absolute() {
        assert!(!is_safe_relpath(""));
        assert!(!is_safe_relpath("../secret"));
        assert!(!is_safe_relpath("a/../../etc/passwd"));
        assert!(!is_safe_relpath("./main.tex")); // CurDir component rejected
        #[cfg(unix)]
        assert!(!is_safe_relpath("/etc/passwd"));
        #[cfg(windows)]
        {
            assert!(!is_safe_relpath("C:\\Windows\\system.ini"));
            assert!(!is_safe_relpath("\\\\server\\share\\f"));
        }
    }
}

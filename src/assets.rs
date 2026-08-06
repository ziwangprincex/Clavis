//! Workspace asset inventory and cross-language image-reference diagnostics.
//!
//! This intentionally indexes explicit image/graphic references only. It does
//! not guess dynamic Typst paths, execute code, or treat arbitrary local links
//! as assets.

use base64::Engine as _;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use typst_syntax::ast::Arg;
use typst_syntax::{LinkedNode, SyntaxKind};

const MAX_FILES: usize = 10_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ASSETS: usize = 10_000;
const MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "svg", "pdf", "eps", "gif", "webp", "tif", "tiff",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDocumentOverride {
    pub path: String,
    pub language: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexOptions {
    pub root: String,
    #[serde(default)]
    pub documents: Vec<AssetDocumentOverride>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetUsage {
    pub asset_path: String,
    pub relative_asset_path: String,
    pub source_path: String,
    pub relative_source_path: String,
    pub language: String,
    pub line: u32,
    pub column: u32,
    pub raw_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAsset {
    pub path: String,
    pub relative_path: String,
    pub extension: String,
    pub size_bytes: u64,
    pub usages: Vec<AssetUsage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDiagnostic {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub path: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexResult {
    pub assets: Vec<WorkspaceAsset>,
    pub missing_usages: Vec<AssetUsage>,
    pub diagnostics: Vec<AssetDiagnostic>,
    pub scanned_files: usize,
    pub truncated: bool,
}

#[derive(Clone)]
struct SourceDoc {
    path: PathBuf,
    language: &'static str,
    text: String,
}

#[derive(Clone)]
struct RawUsage {
    raw_path: String,
    start: usize,
}

fn portable(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn language_for(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "tex" | "ltx" => Some("latex"),
        "typ" => Some("typst"),
        "md" | "qmd" => Some("markdown"),
        _ => None,
    }
}

fn asset_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    IMAGE_EXTENSIONS
        .contains(&extension.as_str())
        .then_some(extension)
}

fn skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".svn"
            | ".hg"
            | "node_modules"
            | "target"
            | "dist"
            | "__pycache__"
            | ".venv"
            | "venv"
            | "_site"
            | "_book"
    )
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let root =
        std::fs::canonicalize(root).map_err(|error| format!("workspace not found: {error}"))?;
    if !root.is_dir() {
        return Err("workspace root is not a directory".to_string());
    }
    Ok(root)
}

fn collect(
    root: &Path,
    overrides: Vec<AssetDocumentOverride>,
) -> Result<(Vec<SourceDoc>, Vec<(PathBuf, String, u64)>, bool), String> {
    let mut override_map = HashMap::new();
    for doc in overrides {
        let path = std::fs::canonicalize(&doc.path).unwrap_or_else(|_| PathBuf::from(&doc.path));
        if path.starts_with(root) {
            override_map.insert(portable(&path), doc);
        }
    }
    let mut docs = Vec::new();
    let mut assets = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut visited = 0usize;
    let mut truncated = false;
    while let Some(dir) = stack.pop() {
        let entries =
            std::fs::read_dir(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        for entry in entries.flatten() {
            if visited >= MAX_FILES {
                truncated = true;
                break;
            }
            visited += 1;
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            if kind.is_dir() {
                if !skip_dir(&name) {
                    stack.push(path);
                }
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if let Some(extension) = asset_extension(&path) {
                if assets.len() < MAX_ASSETS {
                    assets.push((path, extension, metadata.len()));
                } else {
                    truncated = true;
                }
                continue;
            }
            let Some(language) = language_for(&path) else {
                continue;
            };
            if metadata.len() > MAX_FILE_BYTES {
                continue;
            }
            let canonical = std::fs::canonicalize(&path).unwrap_or(path);
            let key = portable(&canonical);
            let override_doc = override_map.remove(&key);
            let language = override_doc
                .as_ref()
                .and_then(|doc| match doc.language.as_str() {
                    "latex" => Some("latex"),
                    "typst" => Some("typst"),
                    "markdown" => Some("markdown"),
                    _ => None,
                })
                .unwrap_or(language);
            let text = if let Some(doc) = override_doc {
                doc.text
            } else {
                match std::fs::read_to_string(&canonical) {
                    Ok(text) => text,
                    Err(_) => continue,
                }
            };
            docs.push(SourceDoc {
                path: canonical,
                language,
                text,
            });
        }
        if truncated {
            break;
        }
    }
    Ok((docs, assets, truncated))
}

fn blank_range(bytes: &mut [u8], start: usize, end: usize) {
    for byte in &mut bytes[start..end] {
        if !matches!(*byte, b'\n' | b'\r') {
            *byte = b' ';
        }
    }
}

fn latex_mask(text: &str) -> String {
    let mut bytes = text.as_bytes().to_vec();
    let source = text.as_bytes();
    let mut line_start = 0usize;
    for (index, byte) in source.iter().enumerate() {
        if *byte == b'\n' {
            line_start = index + 1;
            continue;
        }
        if *byte == b'%' {
            let slashes = source[line_start..index]
                .iter()
                .rev()
                .take_while(|value| **value == b'\\')
                .count();
            if slashes % 2 == 0 {
                let end = text[index..]
                    .find('\n')
                    .map_or(source.len(), |offset| index + offset);
                blank_range(&mut bytes, index, end);
            }
        }
    }
    let masked = String::from_utf8(bytes).unwrap();
    let blocks = Regex::new(r"(?s)\\begin\{(?:verbatim\*?|lstlisting|minted)\}.*?\\end\{(?:verbatim\*?|lstlisting|minted)\}").unwrap();
    let mut out = masked.into_bytes();
    for hit in blocks.find_iter(text) {
        blank_range(&mut out, hit.start(), hit.end());
    }
    String::from_utf8(out).unwrap()
}

fn markdown_mask(text: &str) -> String {
    let mut bytes = text.as_bytes().to_vec();
    let fences = Regex::new(r"(?ms)^\s*(```+|~~~+).*?^\s*(?:```+|~~~+)\s*$").unwrap();
    for hit in fences.find_iter(text) {
        blank_range(&mut bytes, hit.start(), hit.end());
    }
    let inline = Regex::new(r"`+[^\n]*?`+").unwrap();
    for hit in inline.find_iter(text) {
        blank_range(&mut bytes, hit.start(), hit.end());
    }
    String::from_utf8(bytes).unwrap()
}

fn scan_latex(text: &str) -> Vec<RawUsage> {
    let masked = latex_mask(text);
    let re = Regex::new(r"\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}").unwrap();
    re.captures_iter(&masked)
        .filter_map(|capture| {
            let hit = capture.get(1)?;
            let raw_path = hit.as_str().trim();
            (!raw_path.is_empty()).then(|| RawUsage {
                raw_path: raw_path.to_string(),
                start: hit.start(),
            })
        })
        .collect()
}

fn static_typst_string(node: &LinkedNode<'_>) -> Option<(String, usize)> {
    if node.kind() != SyntaxKind::Str {
        return None;
    }
    let raw = node.get().text();
    if raw.len() < 2 || raw[1..raw.len() - 1].contains('\\') {
        return None;
    }
    Some((raw[1..raw.len() - 1].to_string(), node.offset() + 1))
}

fn typst_image_call(node: &LinkedNode<'_>) -> Option<RawUsage> {
    if node.kind() != SyntaxKind::FuncCall {
        return None;
    }
    let callee = node
        .children()
        .find(|child| child.kind() == SyntaxKind::Ident)?;
    if callee.get().text().as_str() != "image" {
        return None;
    }
    let args = node
        .children()
        .find(|child| child.kind() == SyntaxKind::Args)?;
    for child in args.children() {
        // Typst 0.11 keeps a direct `Str` child for simple call arguments,
        // while other expression shapes arrive through an Arg wrapper.
        if let Some((raw_path, start)) = static_typst_string(&child) {
            return Some(RawUsage { raw_path, start });
        }
        let Some(Arg::Pos(_)) = child.get().cast::<Arg>() else {
            continue;
        };
        for grandchild in child.children() {
            if let Some((raw_path, start)) = static_typst_string(&grandchild) {
                return Some(RawUsage { raw_path, start });
            }
        }
    }
    None
}

fn scan_typst_walk(node: LinkedNode<'_>, out: &mut Vec<RawUsage>) {
    if let Some(usage) = typst_image_call(&node) {
        out.push(usage);
        return;
    }
    for child in node.children() {
        scan_typst_walk(child, out);
    }
}

fn scan_typst(text: &str) -> Vec<RawUsage> {
    let tree = typst_syntax::parse(text);
    let mut usages = Vec::new();
    scan_typst_walk(LinkedNode::new(&tree), &mut usages);
    usages
}

fn scan_markdown(text: &str) -> Vec<RawUsage> {
    let masked = markdown_mask(text);
    let re = Regex::new(r"!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)").unwrap();
    re.captures_iter(&masked)
        .filter_map(|capture| {
            let hit = capture.get(1)?;
            let raw_path = hit.as_str().trim();
            if raw_path.is_empty()
                || raw_path.starts_with("http://")
                || raw_path.starts_with("https://")
                || raw_path.starts_with("data:")
            {
                return None;
            }
            Some(RawUsage {
                raw_path: raw_path.to_string(),
                start: hit.start(),
            })
        })
        .collect()
}

fn line_column(text: &str, offset: usize) -> (u32, u32) {
    let before = &text[..offset.min(text.len())];
    let line = before.bytes().filter(|byte| *byte == b'\n').count() as u32 + 1;
    let column = before
        .rsplit_once('\n')
        .map_or(before, |(_, tail)| tail)
        .chars()
        .count() as u32
        + 1;
    (line, column)
}

fn resolve_usage(root: &Path, document: &Path, raw: &str, latex: bool) -> Option<PathBuf> {
    if raw.starts_with('/') || raw.contains("..") {
        return None;
    }
    let parent = document.parent().unwrap_or(root);
    let base = parent.join(raw);
    let mut candidates = vec![base.clone(), root.join(raw)];
    if latex && Path::new(raw).extension().is_none() {
        for extension in IMAGE_EXTENSIONS {
            candidates.push(parent.join(format!("{raw}.{extension}")));
        }
    }
    candidates.into_iter().find_map(|candidate| {
        let canonical = std::fs::canonicalize(candidate).ok()?;
        (canonical.starts_with(root)
            && canonical.is_file()
            && asset_extension(&canonical).is_some())
        .then_some(canonical)
    })
}

fn preview_mime(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "pdf" => Some("application/pdf"),
        _ => None,
    }
}

fn preview_sync(root: String, path: String) -> Result<Option<String>, String> {
    let root = canonical_root(&root)?;
    let asset = std::fs::canonicalize(&path).map_err(|error| format!("asset not found: {error}"))?;
    if !asset.starts_with(&root) || !asset.is_file() {
        return Err("asset preview path must be a file inside the workspace".to_string());
    }
    let extension = asset_extension(&asset).ok_or_else(|| "unsupported asset preview type".to_string())?;
    let Some(mime) = preview_mime(&extension) else { return Ok(None) };
    let metadata = std::fs::metadata(&asset).map_err(|error| format!("cannot inspect asset preview: {error}"))?;
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Ok(None);
    }
    let bytes = std::fs::read(&asset).map_err(|error| format!("cannot read asset preview: {error}"))?;
    Ok(Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )))
}

fn index_sync(options: AssetIndexOptions) -> Result<AssetIndexResult, String> {
    let root = canonical_root(&options.root)?;
    let (documents, asset_files, truncated) = collect(&root, options.documents)?;
    let mut asset_map: BTreeMap<String, WorkspaceAsset> = BTreeMap::new();
    for (path, extension, size_bytes) in asset_files {
        let canonical = std::fs::canonicalize(&path).unwrap_or(path);
        let key = portable(&canonical);
        asset_map.entry(key.clone()).or_insert(WorkspaceAsset {
            relative_path: portable(canonical.strip_prefix(&root).unwrap_or(&canonical)),
            path: key,
            extension,
            size_bytes,
            usages: Vec::new(),
        });
    }
    let mut missing_usages = Vec::new();
    let mut scanned_files = 0usize;
    for document in documents {
        scanned_files += 1;
        let raw = match document.language {
            "latex" => scan_latex(&document.text),
            "typst" => scan_typst(&document.text),
            "markdown" => scan_markdown(&document.text),
            _ => Vec::new(),
        };
        for item in raw {
            let (line, column) = line_column(&document.text, item.start);
            let resolved = resolve_usage(
                &root,
                &document.path,
                &item.raw_path,
                document.language == "latex",
            );
            let usage = AssetUsage {
                asset_path: resolved.as_deref().map(portable).unwrap_or_else(|| {
                    portable(&document.path.parent().unwrap_or(&root).join(&item.raw_path))
                }),
                relative_asset_path: resolved
                    .as_deref()
                    .map(|path| portable(path.strip_prefix(&root).unwrap_or(path)))
                    .unwrap_or_else(|| item.raw_path.clone()),
                source_path: portable(&document.path),
                relative_source_path: portable(
                    document.path.strip_prefix(&root).unwrap_or(&document.path),
                ),
                language: document.language.to_string(),
                line,
                column,
                raw_path: item.raw_path,
            };
            if let Some(path) = resolved {
                if let Some(asset) = asset_map.get_mut(&portable(&path)) {
                    asset.usages.push(usage);
                }
            } else {
                missing_usages.push(usage);
            }
        }
    }
    let mut diagnostics = Vec::new();
    for usage in &missing_usages {
        diagnostics.push(AssetDiagnostic {
            code: "missing-asset".into(),
            severity: "error".into(),
            message: format!("Missing asset: {}", usage.raw_path),
            path: Some(usage.source_path.clone()),
            line: Some(usage.line),
        });
    }
    if !truncated {
        for asset in asset_map.values() {
            if asset.usages.is_empty() {
                diagnostics.push(AssetDiagnostic {
                    code: "unused-asset".into(),
                    severity: "warning".into(),
                    message: format!("Unused asset: {}", asset.relative_path),
                    path: Some(asset.path.clone()),
                    line: None,
                });
            }
        }
    }
    let assets = asset_map.into_values().collect();
    Ok(AssetIndexResult {
        assets,
        missing_usages,
        diagnostics,
        scanned_files,
        truncated,
    })
}

#[tauri::command]
pub async fn index_assets(options: AssetIndexOptions) -> Result<AssetIndexResult, String> {
    tauri::async_runtime::spawn_blocking(move || index_sync(options))
        .await
        .map_err(|error| format!("asset index worker failed: {error}"))?
}

#[tauri::command]
pub async fn asset_preview(root: String, path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || preview_sync(root, path))
        .await
        .map_err(|error| format!("asset preview worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolves_latex_extensionless_and_marks_unused() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::create_dir(root.join("figures")).unwrap();
        std::fs::write(root.join("figures/plot.pdf"), "pdf").unwrap();
        std::fs::write(root.join("unused.png"), "png").unwrap();
        std::fs::write(root.join("main.tex"), "placeholder").unwrap();
        let result = index_sync(AssetIndexOptions {
            root: portable(&root),
            documents: vec![AssetDocumentOverride {
                path: portable(&root.join("main.tex")),
                language: "latex".into(),
                text: "\\includegraphics{figures/plot}".into(),
            }],
        })
        .unwrap();
        assert_eq!(
            result
                .assets
                .iter()
                .find(|asset| asset.relative_path == "figures/plot.pdf")
                .unwrap()
                .usages
                .len(),
            1
        );
        assert!(result
            .diagnostics
            .iter()
            .any(|item| item.code == "unused-asset" && item.message.contains("unused.png")));
    }

    #[test]
    fn indexes_typst_and_markdown_but_not_urls_or_comments() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("chart.svg"), "svg").unwrap();
        std::fs::write(root.join("a.typ"), "placeholder").unwrap();
        std::fs::write(root.join("b.md"), "placeholder").unwrap();
        let result = index_sync(AssetIndexOptions {
            root: portable(&root),
            documents: vec![
                AssetDocumentOverride {
                    path: portable(&root.join("a.typ")),
                    language: "typst".into(),
                    text: "// #image(\"ghost.png\")\n#image(\"chart.svg\")".into(),
                },
                AssetDocumentOverride {
                    path: portable(&root.join("b.md")),
                    language: "markdown".into(),
                    text: "![chart](chart.svg) ![web](https://example.test/a.png)".into(),
                },
            ],
        })
        .unwrap();
        assert_eq!(result.assets[0].usages.len(), 2);
        assert!(result.missing_usages.is_empty());
    }

    #[test]
    fn ignores_latex_verbatim_and_markdown_code_asset_lookalikes() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("real.png"), "png").unwrap();
        std::fs::write(root.join("a.tex"), "placeholder").unwrap();
        std::fs::write(root.join("b.md"), "placeholder").unwrap();
        let result = index_sync(AssetIndexOptions { root: portable(&root), documents: vec![
          AssetDocumentOverride { path: portable(&root.join("a.tex")), language: "latex".into(), text: "\\begin{verbatim}\\includegraphics{ghost.png}\\end{verbatim}\n\\includegraphics{real.png}".into() },
          AssetDocumentOverride { path: portable(&root.join("b.md")), language: "markdown".into(), text: "`![ghost](ghost.png)`\n```\n![also](also.png)\n```\n![real](real.png)".into() },
        ] }).unwrap();
        assert_eq!(result.assets[0].usages.len(), 2);
        assert!(result.missing_usages.is_empty());
    }

    #[test]
    fn preview_is_confined_bounded_and_raster_only() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let image = root.join("chart.png");
        std::fs::write(&image, b"png").unwrap();
        let preview = preview_sync(portable(&root), portable(&image)).unwrap().unwrap();
        assert!(preview.starts_with("data:image/png;base64,"));
        let pdf = root.join("figure.pdf");
        std::fs::write(&pdf, b"pdf").unwrap();
        assert!(preview_sync(portable(&root), portable(&pdf)).unwrap().unwrap().starts_with("data:application/pdf;base64,"));
        let outside = tempdir().unwrap();
        let outside_file = outside.path().join("outside.png");
        std::fs::write(&outside_file, b"png").unwrap();
        assert!(preview_sync(portable(&root), portable(&outside_file)).is_err());
    }

    #[test]
    fn missing_and_escaping_paths_are_diagnosed() {
        let dir = tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join("main.tex"), "placeholder").unwrap();
        let result = index_sync(AssetIndexOptions {
            root: portable(&root),
            documents: vec![AssetDocumentOverride {
                path: portable(&root.join("main.tex")),
                language: "latex".into(),
                text: "\\includegraphics{../secret}\n\\includegraphics{none.png}".into(),
            }],
        })
        .unwrap();
        assert_eq!(result.missing_usages.len(), 2);
        assert_eq!(
            result
                .diagnostics
                .iter()
                .filter(|item| item.code == "missing-asset")
                .count(),
            2
        );
    }
}

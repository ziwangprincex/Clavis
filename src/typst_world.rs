// Minimal Typst `World` impl: in-memory main source, embedded + system fonts,
// and on-disk project files (images / includes) confined to the document root.

use chrono::{DateTime, Datelike, Local};
use comemo::Prehashed;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use typst::diag::{FileError, FileResult, SourceDiagnostic};
use typst::eval::Tracer;
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, Source, VirtualPath};
use typst::text::{Font, FontBook};
use typst::Library;
use typst::World;

enum FontSlot {
    Embedded {
        buffer: Bytes,
        index: u32,
        font: once_cell::sync::OnceCell<Option<Font>>,
    },
    System {
        path: std::path::PathBuf,
        index: u32,
        font: once_cell::sync::OnceCell<Option<Font>>,
    },
}

impl FontSlot {
    fn get(&self) -> Option<Font> {
        match self {
            FontSlot::Embedded { buffer, index, font } => {
                font.get_or_init(|| Font::new(buffer.clone(), *index)).clone()
            }
            FontSlot::System { path, index, font } => {
                font.get_or_init(|| {
                    let bytes = std::fs::read(path).ok()?;
                    Font::new(Bytes::from(bytes), *index)
                }).clone()
            }
        }
    }
}

static FONTS: Lazy<(Prehashed<FontBook>, Vec<FontSlot>)> = Lazy::new(|| {
    let mut book = FontBook::new();
    let mut slots: Vec<FontSlot> = Vec::new();

    // 1) Embedded fonts shipped with typst-assets (Latin & math coverage).
    for data in typst_assets::fonts() {
        let buffer = Bytes::from_static(data);
        for font in Font::iter(buffer.clone()) {
            book.push(font.info().clone());
            slots.push(FontSlot::Embedded {
                buffer: buffer.clone(),
                index: font.index(),
                font: once_cell::sync::OnceCell::new(),
            });
        }
    }

    // 2) System fonts (CJK, etc.). Failure to load any individual face is silently
    //    ignored — we never want font discovery errors to block compilation.
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    // Only iterate face IDs to avoid holding the lock while reading file bytes.
    let face_ids: Vec<fontdb::ID> = db.faces().map(|f| f.id).collect();
    for id in face_ids {
        let Some(face) = db.face(id) else { continue };
        let path = match &face.source {
            fontdb::Source::File(p) => p.clone(),
            _ => continue, // skip in-memory or shared faces
        };
        let Ok(file) = std::fs::File::open(&path) else { continue };
        if let Ok(mmap) = unsafe { memmap2::Mmap::map(&file) } {
            let count = ttf_parser::fonts_in_collection(&mmap).unwrap_or(1);
            for index in 0..count {
                if let Some(info) = typst::text::FontInfo::new(&mmap, index) {
                    book.push(info);
                    slots.push(FontSlot::System {
                        path: path.clone(),
                        index,
                        font: once_cell::sync::OnceCell::new(),
                    });
                }
            }
        }
    }

    (Prehashed::new(book), slots)
});

static LIBRARY: Lazy<Prehashed<Library>> =
    Lazy::new(|| Prehashed::new(Library::default()));

pub struct SimpleWorld {
    main_id: FileId,
    main_source: Source,
    /// Absolute, canonicalized project root. On-disk file access (`#image`,
    /// `#include`, data files) is confined to this directory. `None` means the
    /// document is unsaved / has no root, so no file access is permitted.
    root: Option<PathBuf>,
    today: DateTime<Local>,
    /// Per-compile caches so repeated reads within one compile are cheap and
    /// deterministic (comemo requires stable results).
    file_cache: std::sync::Mutex<HashMap<FileId, FileResult<Bytes>>>,
    source_cache: std::sync::Mutex<HashMap<FileId, FileResult<Source>>>,
}

impl SimpleWorld {
    pub fn new() -> Result<Self, String> {
        let main_id = FileId::new(None, VirtualPath::new("/main.typ"));
        Ok(Self {
            main_id,
            main_source: Source::new(main_id, String::new()),
            root: None,
            today: Local::now(),
            file_cache: std::sync::Mutex::new(HashMap::new()),
            source_cache: std::sync::Mutex::new(HashMap::new()),
        })
    }

    pub fn set_source(&mut self, text: String) {
        self.main_source = Source::new(self.main_id, text);
        // Drop per-compile caches: on-disk files may have changed between edits.
        self.file_cache.lock().unwrap().clear();
        self.source_cache.lock().unwrap().clear();
        // Advance memoization one generation so stale entries eventually drop
        // without wiping the whole cache (which would defeat incremental compile).
        comemo::evict(30);
    }

    /// Set the project root from the main document's absolute path. The file's
    /// parent directory becomes the root within which `#image` / `#include`
    /// may resolve. Passing `None` (unsaved buffer) disables file access.
    pub fn set_root_from_doc(&mut self, doc_path: Option<&str>) {
        self.root = doc_path.and_then(|p| {
            let parent = Path::new(p).parent()?;
            // Canonicalize so the containment check below compares real paths
            // (defeats `..` and symlink games).
            std::fs::canonicalize(parent).ok()
        });
        self.file_cache.lock().unwrap().clear();
        self.source_cache.lock().unwrap().clear();
    }

    /// Resolve a Typst `FileId` to an absolute path *inside* the project root.
    /// Returns `AccessDenied`/`NotFound` rather than escaping the root.
    fn resolve_in_root(&self, id: FileId) -> FileResult<PathBuf> {
        let vpath = id.vpath();
        let root = self
            .root
            .as_ref()
            .ok_or_else(|| FileError::NotFound(vpath.as_rootless_path().to_path_buf()))?;
        // VirtualPath::resolve normalizes and rejects paths that climb above
        // the root (returns None on escape).
        let resolved = vpath
            .resolve(root)
            .ok_or_else(|| FileError::AccessDenied)?;
        // Defense in depth: canonicalize the result and re-check it is still
        // under the (already canonical) root, so symlinks can't break out.
        let canon = std::fs::canonicalize(&resolved)
            .map_err(|_| FileError::NotFound(resolved.clone()))?;
        if !canon.starts_with(root) {
            return Err(FileError::AccessDenied);
        }
        Ok(canon)
    }
}

impl World for SimpleWorld {
    fn library(&self) -> &Prehashed<Library> { &LIBRARY }
    fn book(&self) -> &Prehashed<FontBook> { &FONTS.0 }
    fn main(&self) -> Source { self.main_source.clone() }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main_id {
            return Ok(self.main_source.clone());
        }
        if let Some(cached) = self.source_cache.lock().unwrap().get(&id) {
            return cached.clone();
        }
        let result = (|| {
            let path = self.resolve_in_root(id)?;
            let text = std::fs::read_to_string(&path)
                .map_err(|e| FileError::from_io(e, &path))?;
            Ok(Source::new(id, text))
        })();
        self.source_cache.lock().unwrap().insert(id, result.clone());
        result
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(cached) = self.file_cache.lock().unwrap().get(&id) {
            return cached.clone();
        }
        let result = (|| {
            let path = self.resolve_in_root(id)?;
            let bytes = std::fs::read(&path)
                .map_err(|e| FileError::from_io(e, &path))?;
            Ok(Bytes::from(bytes))
        })();
        self.file_cache.lock().unwrap().insert(id, result.clone());
        result
    }

    fn font(&self, index: usize) -> Option<Font> {
        FONTS.1.get(index).and_then(|slot| slot.get())
    }

    fn today(&self, _offset: Option<i64>) -> Option<Datetime> {
        Datetime::from_ymd(
            self.today.year(),
            self.today.month().try_into().ok()?,
            self.today.day().try_into().ok()?,
        )
    }
}

/// Compile the world's main source to a single merged SVG string.
/// On failure, returns a human-readable error message.
pub fn compile_to_svg(world: &SimpleWorld) -> Result<String, String> {
    let mut tracer = Tracer::new();
    match typst::compile(world, &mut tracer) {
        Ok(doc) => {
            let svg = typst_svg::svg_merged(&doc, typst::layout::Abs::pt(0.0));
            Ok(svg)
        }
        Err(errors) => Err(format_diagnostics(&errors, world)),
    }
}

/// Compile the world's main source to PDF bytes.
pub fn compile_to_pdf(world: &SimpleWorld) -> Result<Vec<u8>, String> {
    let mut tracer = Tracer::new();
    match typst::compile(world, &mut tracer) {
        Ok(doc) => Ok(typst_pdf::pdf(&doc, typst::foundations::Smart::Auto, None)),
        Err(errors) => Err(format_diagnostics(&errors, world)),
    }
}

/// Return the unique font family names known to Typst (system + embedded).
/// Sorted, case-insensitive deduped.
pub fn list_fonts() -> Vec<String> {
    let mut names: Vec<String> = FONTS.0.families().map(|(name, _)| name.to_string()).collect();
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    names.dedup_by(|a, b| a.to_lowercase() == b.to_lowercase());
    names
}

fn format_diagnostics(errors: &[SourceDiagnostic], world: &SimpleWorld) -> String {
    let mut out = String::new();
    for diag in errors {
        let span = diag.span;
        let file = span.id();
        let line_info = file
            .and_then(|id| world.source(id).ok())
            .and_then(|src| {
                let range = src.range(span)?;
                let line = src.byte_to_line(range.start)?;
                let col = src.byte_to_column(range.start)?;
                Some(format!("line {}, col {}: ", line + 1, col + 1))
            })
            .unwrap_or_default();
        out.push_str(&format!("{}{}\n", line_info, diag.message));
        for hint in &diag.hints {
            out.push_str(&format!("  hint: {}\n", hint));
        }
    }
    if out.is_empty() {
        out.push_str("unknown compile error");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_root_denies_file_access() {
        let w = SimpleWorld::new().unwrap();
        let id = FileId::new(None, VirtualPath::new("/secret.png"));
        assert!(w.resolve_in_root(id).is_err());
    }

    #[test]
    fn traversal_escaping_root_is_denied() {
        let mut w = SimpleWorld::new().unwrap();
        // Point the root at this crate's src/ directory (guaranteed to exist).
        let src = concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs");
        w.set_root_from_doc(Some(src));
        // Root is .../src ; climbing out must be rejected.
        let escape = FileId::new(None, VirtualPath::new("/../Cargo.toml"));
        assert!(w.resolve_in_root(escape).is_err());
    }

    #[test]
    fn file_inside_root_resolves() {
        let mut w = SimpleWorld::new().unwrap();
        let this = concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs");
        w.set_root_from_doc(Some(this));
        // A sibling file that exists under the same root resolves ok.
        let ok = FileId::new(None, VirtualPath::new("/typst_world.rs"));
        let resolved = w.resolve_in_root(ok);
        assert!(resolved.is_ok(), "expected resolve ok, got {resolved:?}");
        assert!(resolved.unwrap().ends_with("typst_world.rs"));
    }
}

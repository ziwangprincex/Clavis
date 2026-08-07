// Minimal Typst `World` impl: in-memory main source, embedded + system fonts,
// and on-disk project files (images / includes) confined to the document root.

use chrono::{DateTime, Datelike, Local, Utc};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use typst::diag::{FileError, FileResult, SourceDiagnostic};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::{Library, LibraryExt, World, WorldExt};
use typst_layout::PagedDocument;
use typst_utils::LazyHash;

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
            FontSlot::Embedded {
                buffer,
                index,
                font,
            } => font
                .get_or_init(|| Font::new(buffer.clone(), *index))
                .clone(),
            FontSlot::System { path, index, font } => font
                .get_or_init(|| {
                    let bytes = std::fs::read(path).ok()?;
                    Font::new(Bytes::new(bytes), *index)
                })
                .clone(),
        }
    }
}

static FONTS: Lazy<(LazyHash<FontBook>, Vec<FontSlot>)> = Lazy::new(|| {
    let mut book = FontBook::new();
    let mut slots: Vec<FontSlot> = Vec::new();

    // 1) Embedded fonts shipped with typst-assets (Latin & math coverage).
    for data in typst_assets::fonts() {
        let buffer = Bytes::new(data);
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
        let Ok(file) = std::fs::File::open(&path) else {
            continue;
        };
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

    (LazyHash::new(book), slots)
});

pub(crate) static LIBRARY: Lazy<LazyHash<Library>> =
    Lazy::new(|| LazyHash::new(Library::default()));

fn project_file_id(path: &str) -> Result<FileId, String> {
    let vpath = VirtualPath::new(path).map_err(|error| error.to_string())?;
    Ok(FileId::new(RootedPath::new(VirtualRoot::Project, vpath)))
}

pub struct SimpleWorld {
    main_id: FileId,
    main_source: Source,
    /// Absolute, canonicalized project root. On-disk file access (`#image`,
    /// `#include`, data files) is confined to this directory. `None` means the
    /// document is unsaved / has no root, so no file access is permitted.
    root: Option<PathBuf>,
    /// Per-compile caches so repeated reads within one compile are cheap and
    /// deterministic for Typst's tracked world queries.
    file_cache: std::sync::Mutex<HashMap<FileId, FileResult<Bytes>>>,
    source_cache: std::sync::Mutex<HashMap<FileId, FileResult<Source>>>,
}

impl SimpleWorld {
    pub fn new() -> Result<Self, String> {
        let main_id = project_file_id("/main.typ")?;
        Ok(Self {
            main_id,
            main_source: Source::new(main_id, String::new()),
            root: None,
            file_cache: std::sync::Mutex::new(HashMap::new()),
            source_cache: std::sync::Mutex::new(HashMap::new()),
        })
    }

    pub fn set_source(&mut self, text: String) {
        self.main_source = Source::new(self.main_id, text);
        // Drop per-compile caches: on-disk files may have changed between edits.
        self.file_cache.lock().unwrap().clear();
        self.source_cache.lock().unwrap().clear();
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
            .ok_or_else(|| FileError::NotFound(PathBuf::from(vpath.get_without_slash())))?;
        // `VirtualPath` is normalized at construction, and `realize` maps it
        // underneath the supplied root without allowing `..` escapes.
        let resolved = vpath.realize(root).map_err(FileError::from)?;
        // Defense in depth: canonicalize the result and re-check it is still
        // under the (already canonical) root, so symlinks can't break out.
        let canon =
            std::fs::canonicalize(&resolved).map_err(|_| FileError::NotFound(resolved.clone()))?;
        if !canon.starts_with(root) {
            return Err(FileError::AccessDenied);
        }
        Ok(canon)
    }
}

fn today_at<Tz: chrono::TimeZone>(now: DateTime<Tz>, offset: Option<Duration>) -> Option<Datetime> {
    let (year, month, day) = match offset {
        None => (now.year(), now.month(), now.day()),
        Some(offset) => {
            // Typst requests the date at UTC plus the supplied timezone offset.
            // Do not convert the shifted instant back to the machine timezone:
            // that would add the local offset a second time.
            let millis = (offset.seconds() * 1_000.0).round();
            if !millis.is_finite() || millis < i64::MIN as f64 || millis > i64::MAX as f64 {
                return None;
            }
            let shifted =
                now.with_timezone(&Utc) + chrono::Duration::try_milliseconds(millis as i64)?;
            (shifted.year(), shifted.month(), shifted.day())
        }
    };
    Datetime::from_ymd(year, month.try_into().ok()?, day.try_into().ok()?)
}

impl World for SimpleWorld {
    fn library(&self) -> &LazyHash<Library> {
        &LIBRARY
    }
    fn book(&self) -> &LazyHash<FontBook> {
        &FONTS.0
    }
    fn main(&self) -> FileId {
        self.main_id
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main_id {
            return Ok(self.main_source.clone());
        }
        if let Some(cached) = self.source_cache.lock().unwrap().get(&id) {
            return cached.clone();
        }
        let result = (|| {
            let path = self.resolve_in_root(id)?;
            let text = std::fs::read_to_string(&path).map_err(|e| FileError::from_io(e, &path))?;
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
            let bytes = std::fs::read(&path).map_err(|e| FileError::from_io(e, &path))?;
            Ok(Bytes::new(bytes))
        })();
        self.file_cache.lock().unwrap().insert(id, result.clone());
        result
    }

    fn font(&self, index: usize) -> Option<Font> {
        FONTS.1.get(index).and_then(|slot| slot.get())
    }

    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        today_at(Local::now(), offset)
    }
}

/// Compile the world's main source to a paged document.
fn compile_paged(world: &SimpleWorld) -> Result<PagedDocument, String> {
    let result = typst::compile::<PagedDocument>(world);
    result
        .output
        .map_err(|errors| format_diagnostics(&errors, world))
}

/// Compile the world's main source to a single merged SVG string.
/// On failure, returns a human-readable error message.
pub fn compile_to_svg(world: &SimpleWorld) -> Result<String, String> {
    let document = compile_paged(world)?;
    Ok(typst_svg::svg_merged(
        &document,
        &typst_svg::SvgOptions::default(),
        typst::layout::Abs::zero(),
    ))
}

/// Compile the world's main source to PDF bytes.
pub fn compile_to_pdf(world: &SimpleWorld) -> Result<Vec<u8>, String> {
    let document = compile_paged(world)?;
    typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default())
        .map_err(|errors| format_diagnostics(&errors, world))
}

/// Return the unique font family names known to Typst (system + embedded).
/// Sorted, case-insensitive deduped.
pub fn list_fonts() -> Vec<String> {
    let mut names: Vec<String> = FONTS
        .0
        .families()
        .map(|(name, _)| name.to_string())
        .collect();
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
                let range = world.range(span)?;
                let (line, col) = src.lines().byte_to_line_column(range.start)?;
                Some(format!("line {}, col {}: ", line + 1, col + 1))
            })
            .unwrap_or_default();
        out.push_str(&format!("{}{}\n", line_info, diag.message));
        for hint in &diag.hints {
            out.push_str(&format!("  hint: {}\n", hint.v));
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
    fn curated_math_completion_examples_compile() {
        let examples = [
            "$ sum_(i=1)^(n) i $",
            "$ product_(i=1)^(n) i $",
            "$ integral_(0)^(1) x dif x $",
            "$ frac(a, b) $",
            "$ sqrt(x) $",
            "$ root(n, x) $",
            "$ vec(x) $",
            "$ mat(1, 2; 3, 4) $",
            "$ cases(x &\"if\" y, z &\"otherwise\") $",
            "$ binom(n, k) $",
            "$ abs(x) $",
            "$ norm(x) $",
        ];
        for source in examples {
            let mut world = SimpleWorld::new().unwrap();
            world.set_source(source.into());
            assert!(
                compile_to_svg(&world).is_ok(),
                "curated math completion must compile: {source}"
            );
        }
    }

    #[test]
    fn typst_015_renders_svg_and_pdf() {
        let mut world = SimpleWorld::new().unwrap();
        world.set_source("= Typst 0.15\n#box[body]\n$ frac(a, b) $".into());

        let svg = compile_to_svg(&world).expect("SVG compilation should succeed");
        assert!(svg.contains("<svg"), "expected SVG output");

        let pdf = compile_to_pdf(&world).expect("PDF compilation should succeed");
        assert!(pdf.starts_with(b"%PDF-"), "expected PDF header");
    }

    #[test]
    fn diagnostics_keep_line_and_column() {
        let mut world = SimpleWorld::new().unwrap();
        world.set_source("first line\n#unknown-function()".into());
        let error = compile_to_svg(&world).expect_err("unknown function should fail");
        assert!(
            error.contains("line 2, col 2:"),
            "unexpected diagnostic: {error}"
        );
        assert!(
            error.contains("unknown variable"),
            "unexpected diagnostic: {error}"
        );
    }

    #[test]
    fn includes_stay_inside_the_workspace_root() {
        let dir = tempfile::tempdir().unwrap();
        let main = dir.path().join("main.typ");
        let child = dir.path().join("child.typ");
        std::fs::write(&main, "#include \"child.typ\"").unwrap();
        std::fs::write(&child, "Included").unwrap();

        let mut world = SimpleWorld::new().unwrap();
        world.set_root_from_doc(main.to_str());
        world.set_source(std::fs::read_to_string(&main).unwrap());
        assert!(
            compile_to_svg(&world).is_ok(),
            "in-root include should compile"
        );

        world.set_source("#include \"../outside.typ\"".into());
        let error = compile_to_svg(&world).expect_err("escaping include should fail");
        assert!(
            error.contains("escape the project root")
                || error.contains("outside of the project sandbox"),
            "unexpected escape diagnostic: {error}"
        );
    }

    #[test]
    fn today_honors_local_and_requested_timezone_dates() {
        use chrono::{FixedOffset, TimeZone};

        // At this instant UTC and UTC+8 are on different dates. The no-offset
        // branch follows the supplied local zone, while explicit offsets are
        // calculated from UTC exactly once.
        let zone = FixedOffset::east_opt(8 * 3600).unwrap();
        let local = zone.with_ymd_and_hms(2026, 1, 2, 4, 30, 0).unwrap();

        let local_date = today_at(local, None).unwrap();
        assert_eq!(
            (local_date.year(), local_date.month(), local_date.day()),
            (Some(2026), Some(1), Some(2))
        );

        let utc_date = today_at(local, Some(Duration::construct(0, 0, 0, 0, 0))).unwrap();
        assert_eq!(
            (utc_date.year(), utc_date.month(), utc_date.day()),
            (Some(2026), Some(1), Some(1))
        );

        let plus_eight = today_at(local, Some(Duration::construct(0, 0, 8, 0, 0))).unwrap();
        assert_eq!(
            (plus_eight.year(), plus_eight.month(), plus_eight.day()),
            (Some(2026), Some(1), Some(2))
        );
    }

    #[test]
    fn no_root_denies_file_access() {
        let w = SimpleWorld::new().unwrap();
        let id = project_file_id("/secret.png").unwrap();
        assert!(w.resolve_in_root(id).is_err());
    }

    #[test]
    fn traversal_escaping_root_is_denied() {
        let mut w = SimpleWorld::new().unwrap();
        // Point the root at this crate's src/ directory (guaranteed to exist).
        let src = concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs");
        w.set_root_from_doc(Some(src));
        // Root is .../src ; climbing out must be rejected.
        let escape = project_file_id("/../Cargo.toml");
        assert!(
            escape.is_err(),
            "virtual traversal must be rejected before resolution"
        );
    }

    #[test]
    fn file_inside_root_resolves() {
        let mut w = SimpleWorld::new().unwrap();
        let this = concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs");
        w.set_root_from_doc(Some(this));
        // A sibling file that exists under the same root resolves ok.
        let ok = project_file_id("/typst_world.rs").unwrap();
        let resolved = w.resolve_in_root(ok);
        assert!(resolved.is_ok(), "expected resolve ok, got {resolved:?}");
        assert!(resolved.unwrap().ends_with("typst_world.rs"));
    }
}

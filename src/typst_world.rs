// Minimal Typst `World` impl: in-memory source, embedded fonts + system fonts.

use chrono::{DateTime, Datelike, Local};
use comemo::Prehashed;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use typst::diag::{FileError, FileResult, SourceDiagnostic};
use typst::eval::Tracer;
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, Source, VirtualPath};
use typst::text::{Font, FontBook};
use typst::Library;
use typst::World;

static FONTS: Lazy<(Prehashed<FontBook>, Vec<Font>)> = Lazy::new(|| {
    let mut book = FontBook::new();
    let mut fonts: Vec<Font> = Vec::new();

    // 1) Embedded fonts shipped with typst-assets (Latin & math coverage).
    for data in typst_assets::fonts() {
        let buffer = Bytes::from_static(data);
        for font in Font::iter(buffer) {
            book.push(font.info().clone());
            fonts.push(font);
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
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let buffer = Bytes::from(bytes);
        for font in Font::iter(buffer) {
            book.push(font.info().clone());
            fonts.push(font);
        }
    }

    (Prehashed::new(book), fonts)
});

static LIBRARY: Lazy<Prehashed<Library>> =
    Lazy::new(|| Prehashed::new(Library::default()));

pub struct SimpleWorld {
    main_id: FileId,
    sources: HashMap<FileId, Source>,
    today: DateTime<Local>,
}

impl SimpleWorld {
    pub fn new() -> Result<Self, String> {
        let main_id = FileId::new(None, VirtualPath::new("/main.typ"));
        let main_src = Source::new(main_id, String::new());
        let mut sources = HashMap::new();
        sources.insert(main_id, main_src);
        Ok(Self {
            main_id,
            sources,
            today: Local::now(),
        })
    }

    pub fn set_source(&mut self, text: String) {
        let src = Source::new(self.main_id, text);
        self.sources.insert(self.main_id, src);
        // Reset memoization so changed source actually re-evaluates
        comemo::evict(0);
    }
}

impl World for SimpleWorld {
    fn library(&self) -> &Prehashed<Library> { &LIBRARY }
    fn book(&self) -> &Prehashed<FontBook> { &FONTS.0 }
    fn main(&self) -> Source { self.sources[&self.main_id].clone() }

    fn source(&self, id: FileId) -> FileResult<Source> {
        self.sources
            .get(&id)
            .cloned()
            .ok_or_else(|| FileError::NotFound(id.vpath().as_rootless_path().to_path_buf()))
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        Err(FileError::NotFound(id.vpath().as_rootless_path().to_path_buf()))
    }

    fn font(&self, index: usize) -> Option<Font> {
        FONTS.1.get(index).cloned()
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

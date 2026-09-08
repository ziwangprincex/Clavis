use crate::typst_world::SimpleWorld;
use serde::{Deserialize, Serialize};
use typst::layout::{Frame, FrameItem, Point, Transform};
use typst::syntax::DiagSpan;
use typst::{World, WorldExt};
use typst_layout::PagedDocument;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstSnapshot {
    #[serde(default)]
    pub known_svg: Vec<String>,
    pub root: Option<String>,
    #[serde(default)]
    pub documents: Vec<OpenDocument>,
}
#[derive(Deserialize)]
pub struct OpenDocument {
    pub path: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub file: Option<String>,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub end_line: Option<usize>,
    pub end_column: Option<usize>,
    pub severity: &'static str,
    pub message: String,
    pub hints: Vec<String>,
}
#[derive(Serialize)]
pub struct SourcePoint {
    pub file: Option<String>,
    pub line: usize,
    pub column: usize,
    pub x: f64,
    pub y: f64,
}
#[derive(Serialize)]
pub struct TextRun {
    pub text: String,
    pub width: f64,
    pub size: f64,
    pub matrix: [f64; 6],
}
#[derive(Serialize)]
pub struct PageLink {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub page: usize,
    pub target_y: f64,
}
#[derive(Serialize)]
pub struct PreviewPage {
    pub svg: String,
    #[serde(rename = "svgHash")]
    pub svg_hash: String,
    pub width: f64,
    pub height: f64,
    pub points: Vec<SourcePoint>,
    pub text: Vec<TextRun>,
    pub links: Vec<PageLink>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstPreview {
    pub ok: bool,
    pub pages: Vec<PreviewPage>,
    pub diagnostics: Vec<Diagnostic>,
    pub missing_packages: Vec<String>,
    pub dependencies: Vec<String>,
}

fn location(
    world: &SimpleWorld,
    span: DiagSpan,
    offset: usize,
) -> Option<(Option<String>, usize, usize)> {
    let id = span.id()?;
    let source = world.source(id).ok()?;
    let range = world.range(span)?;
    let byte = (range.start + offset).min(range.end);
    let (line, _) = source.lines().byte_to_line_column(byte)?;
    let start = source.lines().line_to_byte(line)?;
    let column = source.text().get(start..byte)?.encode_utf16().count();
    Some((world.source_path(id), line + 1, column + 1))
}
fn diagnostic(
    world: &SimpleWorld,
    diag: &typst::diag::SourceDiagnostic,
    severity: &'static str,
) -> Diagnostic {
    let start = location(world, diag.span, 0);
    let end = world
        .range(diag.span)
        .and_then(|r| location(world, diag.span, r.len()));
    Diagnostic {
        file: start.as_ref().and_then(|p| p.0.clone()).or_else(|| {
            diag.span.id().and_then(|id| match id.root() {
                typst::syntax::VirtualRoot::Package(spec) => {
                    Some(format!("{spec}/{}", id.vpath().get_without_slash()))
                }
                _ => None,
            })
        }),
        line: start.as_ref().map(|p| p.1),
        column: start.as_ref().map(|p| p.2),
        end_line: end.as_ref().map(|p| p.1),
        end_column: end.as_ref().map(|p| p.2),
        severity,
        message: diag.message.to_string(),
        hints: diag.hints.iter().map(|h| h.v.to_string()).collect(),
    }
}
fn points(world: &SimpleWorld, frame: &Frame, transform: Transform, out: &mut Vec<SourcePoint>) {
    for (position, item) in frame.items() {
        let translated = transform.pre_concat(Transform::translate(position.x, position.y));
        match item {
            FrameItem::Group(group) => points(
                world,
                &group.frame,
                translated.pre_concat(group.transform),
                out,
            ),
            FrameItem::Text(text) => {
                // A shaped run lies on one typeset line. One source point is
                // enough for line navigation; per-glyph points dwarf the SVG.
                if let Some((file, line, column)) = text.glyphs.iter().find_map(|glyph| {
                    location(world, glyph.span.0.into(), usize::from(glyph.span.1))
                }) {
                    let position = Point::zero().transform(translated);
                    out.push(SourcePoint {
                        file,
                        line,
                        column,
                        x: position.x.to_pt(),
                        y: position.y.to_pt(),
                    });
                }
            }
            FrameItem::Image(_, _, span) | FrameItem::Shape(_, span) => {
                if let Some((file, line, column)) = location(world, (*span).into(), 0) {
                    let position = Point::zero().transform(translated);
                    out.push(SourcePoint {
                        file,
                        line,
                        column,
                        x: position.x.to_pt(),
                        y: position.y.to_pt(),
                    });
                }
            }
            _ => {}
        }
    }
}

fn reading_layer(
    frame: &Frame,
    transform: Transform,
    document: &PagedDocument,
    text: &mut Vec<TextRun>,
    links: &mut Vec<PageLink>,
) {
    use typst::model::Destination;
    for (position, item) in frame.items() {
        let t = transform.pre_concat(Transform::translate(position.x, position.y));
        match item {
            FrameItem::Group(g) => {
                reading_layer(&g.frame, t.pre_concat(g.transform), document, text, links)
            }
            FrameItem::Text(run) => {
                let origin = Point::zero().transform(t);
                let unit_x = Point::new(typst::layout::Abs::pt(1.0), typst::layout::Abs::zero())
                    .transform(t);
                let unit_y = Point::new(typst::layout::Abs::zero(), typst::layout::Abs::pt(1.0))
                    .transform(t);
                text.push(TextRun {
                    text: run.text.to_string(),
                    width: run.width().to_pt(),
                    size: run.size.to_pt(),
                    matrix: [
                        (unit_x.x - origin.x).to_pt(),
                        (unit_x.y - origin.y).to_pt(),
                        (unit_y.x - origin.x).to_pt(),
                        (unit_y.y - origin.y).to_pt(),
                        origin.x.to_pt(),
                        origin.y.to_pt(),
                    ],
                });
            }
            FrameItem::Link(destination, size) => {
                let target = match destination {
                    Destination::Position(p) => Some(*p),
                    Destination::Location(l) => document.introspector().position(*l),
                    Destination::Url(_) => None,
                };
                if let Some(target) = target {
                    let a = Point::zero().transform(t);
                    let b = Point::new(size.x, size.y).transform(t);
                    links.push(PageLink {
                        x: a.x.to_pt(),
                        y: a.y.to_pt(),
                        width: (b.x - a.x).to_pt(),
                        height: (b.y - a.y).to_pt(),
                        page: target.page.get(),
                        target_y: target.point.y.to_pt(),
                    });
                }
            }
            _ => {}
        }
    }
}

fn cached_svg(page: &typst_layout::Page) -> (String, String) {
    use std::hash::{Hash, Hasher};
    type Cache = std::collections::VecDeque<(u64, String)>;
    static CACHE: once_cell::sync::Lazy<parking_lot::Mutex<Cache>> =
        once_cell::sync::Lazy::new(Default::default);
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    page.hash(&mut hash);
    let key = hash.finish();
    let mut cache = CACHE.lock();
    if let Some(i) = cache.iter().position(|entry| entry.0 == key) {
        let entry = cache.remove(i).unwrap();
        let svg = entry.1.clone();
        cache.push_back(entry);
        return (format!("{key:x}"), svg);
    }
    let svg = typst_svg::svg(page, &Default::default());
    cache.push_back((key, svg.clone()));
    let mut bytes: usize = cache.iter().map(|entry| entry.1.len()).sum();
    while bytes > 32 * 1024 * 1024 {
        bytes -= cache.pop_front().unwrap().1.len();
    }
    (format!("{key:x}"), svg)
}

pub fn preview(world: &SimpleWorld) -> Result<TypstPreview, String> {
    let result = typst::compile::<PagedDocument>(world);
    let mut diagnostics: Vec<_> = result
        .warnings
        .iter()
        .map(|d| diagnostic(world, d, "warning"))
        .collect();
    let pages = match result.output {
        Ok(document) => document
            .pages()
            .iter()
            .map(|page| {
                let mut map = Vec::new();
                points(world, &page.frame, Transform::identity(), &mut map);
                let mut text = Vec::new();
                let mut links = Vec::new();
                reading_layer(
                    &page.frame,
                    Transform::identity(),
                    &document,
                    &mut text,
                    &mut links,
                );
                let (svg_hash, svg) = cached_svg(page);
                PreviewPage {
                    text,
                    links,
                    svg_hash,
                    svg,
                    width: page.frame.width().to_pt(),
                    height: page.frame.height().to_pt(),
                    points: map,
                }
            })
            .collect(),
        Err(errors) => {
            diagnostics.extend(errors.iter().map(|d| diagnostic(world, d, "error")));
            Vec::new()
        }
    };
    Ok(TypstPreview {
        ok: !diagnostics.iter().any(|d| d.severity == "error"),
        pages,
        diagnostics,
        missing_packages: world.missing_packages.lock().unwrap().clone(),
        dependencies: world.dependencies(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preview_and_export_use_unsaved_sibling_buffers() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("chapters")).unwrap();
        let main = dir.path().join("main.typ");
        let child = dir.path().join("chapters/child.typ");
        std::fs::write(&main, "#include \"chapters/child.typ\"").unwrap();
        std::fs::write(&child, "#unknown()").unwrap();
        let snapshot = TypstSnapshot {
            known_svg: vec![],
            root: Some(dir.path().to_string_lossy().into()),
            documents: vec![OpenDocument {
                path: child.to_string_lossy().into(),
                content: "Unsaved chapter".into(),
            }],
        };
        let mut world = SimpleWorld::new().unwrap();
        world
            .configure(
                std::fs::read_to_string(&main).unwrap(),
                main.to_str(),
                &snapshot,
            )
            .unwrap();
        let result = preview(&world).unwrap();
        assert!(result.ok);
        assert!(result.pages[0].points.iter().any(|p| p
            .file
            .as_ref()
            .is_some_and(|f| f.ends_with("chapters/child.typ"))));
        assert!(crate::typst_world::compile_to_pdf(&world)
            .unwrap()
            .starts_with(b"%PDF-"));
        world
            .configure(
                std::fs::read_to_string(&main).unwrap(),
                main.to_str(),
                &Default::default(),
            )
            .unwrap();
        let failed = preview(&world).unwrap();
        assert!(!failed.ok);
        assert!(failed.diagnostics.iter().any(|d| d
            .file
            .as_ref()
            .is_some_and(|f| f.ends_with("chapters/child.typ"))));
    }
    #[test]
    fn nested_main_resolves_parent_imports_with_explicit_root() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("paper")).unwrap();
        let main = dir.path().join("paper/main.typ");
        std::fs::write(&main, "#include \"../shared.typ\"").unwrap();
        std::fs::write(dir.path().join("shared.typ"), "Shared").unwrap();
        let mut world = SimpleWorld::new().unwrap();
        world
            .configure(
                std::fs::read_to_string(&main).unwrap(),
                main.to_str(),
                &TypstSnapshot {
                    known_svg: vec![],
                    root: Some(dir.path().to_string_lossy().into()),
                    documents: vec![],
                },
            )
            .unwrap();
        assert!(preview(&world).unwrap().ok);
    }
    #[test]
    fn warning_and_error_are_structured() {
        let mut world = SimpleWorld::new().unwrap();
        world.set_source("#set text(font: \"missing-clavis-test-font\")\nHello".into());
        assert!(preview(&world)
            .unwrap()
            .diagnostics
            .iter()
            .any(|d| d.severity == "warning"));
        world.set_source("😀 #missing()".into());
        let result = preview(&world).unwrap();
        assert!(!result.ok);
        assert_eq!(result.diagnostics[0].column, Some(5));
    }
}

#[cfg(test)]
mod writer_benchmarks {
    use super::*;
    #[test]
    #[ignore = "Explicit long-document timing, run with --ignored --nocapture"]
    fn long_document_measurements() {
        let mut world = SimpleWorld::new().unwrap();
        for count in [20, 100, 300] {
            let page = "= Research section\n\n".to_string()
                + &"Evidence supports a carefully tested hypothesis. ".repeat(35);
            let source = (0..count)
                .map(|_| page.clone())
                .collect::<Vec<_>>()
                .join("\n#pagebreak()\n");
            let start = std::time::Instant::now();
            world.set_source(source.clone());
            let result = preview(&world).unwrap();
            let initial = start.elapsed();
            assert!(result.ok);
            let start = std::time::Instant::now();
            world.set_source(source.replacen("Evidence", "The evidence", 1));
            let revised = preview(&world).unwrap();
            let edit = start.elapsed();
            assert!(revised.ok);
            let payload = serde_json::to_vec(&revised).unwrap().len();
            println!(
                "WRITER_BENCH sections={} pages={} cold_ms={} edit_ms={} payload_bytes={}",
                count,
                result.pages.len(),
                initial.as_millis(),
                edit.as_millis(),
                payload
            );
        }
    }
}

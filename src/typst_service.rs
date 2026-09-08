//! Run CPU-heavy Typst work off the command/UI thread. The world is shared only
//! inside blocking workers; SVG preview and PDF export cannot mix source roots.
use parking_lot::Mutex;
use std::sync::Arc;

use crate::typst_world::{self, SimpleWorld};

#[derive(Default)]
pub struct TypstCompiler {
    world: Mutex<Option<SimpleWorld>>,
    formula_world: Mutex<Option<SimpleWorld>>,
}

impl TypstCompiler {
    pub async fn formula(self: Arc<Self>, source: String) -> Result<Option<String>, String> {
        tauri::async_runtime::spawn_blocking(move || {
            // Formula requests never queue behind document work or each other.
            let Some(mut guard) = self.formula_world.try_lock() else {
                return Ok(None);
            };
            if guard.is_none() {
                *guard = Some(SimpleWorld::new()?);
            }
            let world = guard.as_mut().unwrap();
            world.configure(
                format!("#set page(width: auto, height: auto, margin: 2pt)\n${source}$"),
                None,
                &Default::default(),
            )?;
            typst_world::compile_to_svg(world).map(Some)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    async fn render<T: Send + 'static>(
        self: Arc<Self>,
        source: String,
        doc_path: Option<String>,
        render: fn(&SimpleWorld) -> Result<T, String>,
        snapshot: crate::typst_preview::TypstSnapshot,
    ) -> Result<T, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let mut guard = self.world.lock();
            if guard.is_none() {
                *guard = Some(SimpleWorld::new().map_err(|error| format!("init: {error}"))?);
            }
            let world = guard.as_mut().expect("world initialized above");
            world.configure(source, doc_path.as_deref(), &snapshot)?;
            render(world)
        })
        .await
        .map_err(|error| format!("Typst worker failed: {error}"))?
    }

    #[cfg(test)]
    pub async fn svg(
        self: Arc<Self>,
        source: String,
        doc_path: Option<String>,
    ) -> Result<String, String> {
        self.render(
            source,
            doc_path,
            typst_world::compile_to_svg,
            Default::default(),
        )
        .await
    }

    #[cfg(test)]
    pub async fn pdf(
        self: Arc<Self>,
        source: String,
        doc_path: Option<String>,
    ) -> Result<Vec<u8>, String> {
        self.render(
            source,
            doc_path,
            typst_world::compile_to_pdf,
            Default::default(),
        )
        .await
    }
    pub async fn preview(
        self: Arc<Self>,
        source: String,
        doc_path: Option<String>,
        snapshot: crate::typst_preview::TypstSnapshot,
    ) -> Result<crate::typst_preview::TypstPreview, String> {
        let known = snapshot.known_svg.clone();
        let mut result = self
            .render(source, doc_path, crate::typst_preview::preview, snapshot)
            .await?;
        for (i, page) in result.pages.iter_mut().enumerate() {
            if known.get(i) == Some(&page.svg_hash) {
                page.svg.clear();
            }
        }
        Ok(result)
    }
    pub async fn export(
        self: Arc<Self>,
        source: String,
        doc_path: Option<String>,
        snapshot: crate::typst_preview::TypstSnapshot,
    ) -> Result<Vec<u8>, String> {
        self.render(source, doc_path, typst_world::compile_to_pdf, snapshot)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn exports_svg_and_pdf_in_background() {
        let compiler = Arc::new(TypstCompiler::default());
        assert!(compiler
            .clone()
            .svg("= Preview".into(), None)
            .await
            .unwrap()
            .contains("<svg"));
        assert!(compiler
            .pdf("= Export".into(), None)
            .await
            .unwrap()
            .starts_with(b"%PDF-"));
    }

    #[tokio::test]
    async fn concurrent_requests_do_not_mix_sources() {
        let compiler = Arc::new(TypstCompiler::default());
        let (valid, invalid) = tokio::join!(
            compiler.clone().svg("= Valid".into(), None),
            compiler.svg("#missing-function()".into(), None),
        );
        assert!(valid.unwrap().contains("<svg"));
        assert!(invalid.unwrap_err().contains("unknown variable"));
    }

    #[tokio::test]
    async fn scratch_request_does_not_inherit_previous_root() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("child.typ"), "Included").unwrap();
        let compiler = Arc::new(TypstCompiler::default());
        let source = "#include \"child.typ\"".to_string();
        std::fs::write(dir.path().join("main.typ"), &source).unwrap();
        let path = Some(dir.path().join("main.typ").to_string_lossy().into_owned());
        assert!(compiler.clone().svg(source.clone(), path).await.is_ok());
        assert!(compiler.svg(source, None).await.is_err());
    }

    #[tokio::test]
    async fn failed_compile_does_not_poison_next_request() {
        let compiler = Arc::new(TypstCompiler::default());
        assert!(compiler
            .clone()
            .svg("#missing-function()".into(), None)
            .await
            .is_err());
        assert!(compiler.svg("Recovered".into(), None).await.is_ok());
    }
}

#[cfg(test)]
mod formula_tests {
    use super::*;
    #[tokio::test]
    async fn formulas_do_not_wait_for_document_lock() {
        let compiler = Arc::new(TypstCompiler::default());
        let _document_lock = compiler.world.lock();
        assert!(compiler
            .clone()
            .formula("a^2+b^2".into())
            .await
            .unwrap()
            .unwrap()
            .contains("<svg"));
    }
    #[tokio::test]
    async fn busy_formula_work_is_discardable() {
        let compiler = Arc::new(TypstCompiler::default());
        let _formula_lock = compiler.formula_world.lock();
        assert!(compiler
            .clone()
            .formula("a+b".into())
            .await
            .unwrap()
            .is_none());
    }
}

#[cfg(test)]
mod incremental_page_tests {
    use super::*;
    #[tokio::test]
    async fn only_omits_svg_the_client_already_holds() {
        let compiler = Arc::new(TypstCompiler::default());
        let source = "= First\nA paragraph.\n#pagebreak()\n= Second\nMore writing.".to_string();
        let first = compiler
            .clone()
            .preview(source.clone(), None, Default::default())
            .await
            .unwrap();
        let known_svg = first.pages.iter().map(|p| p.svg_hash.clone()).collect();
        let next = compiler
            .clone()
            .preview(
                source.clone(),
                None,
                crate::typst_preview::TypstSnapshot {
                    known_svg,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(next
            .pages
            .iter()
            .all(|p| p.svg.is_empty() && !p.text.is_empty() && !p.points.is_empty()));
        let fresh = compiler
            .preview(source, None, Default::default())
            .await
            .unwrap();
        assert!(fresh.pages.iter().all(|p| !p.svg.is_empty()));
        println!(
            "TRANSPORT first={} repeated={}",
            serde_json::to_vec(&first).unwrap().len(),
            serde_json::to_vec(&next).unwrap().len()
        );
    }
}

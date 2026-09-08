//! Run CPU-heavy Typst work off the command/UI thread. The world is shared only
//! inside blocking workers; SVG preview and PDF export cannot mix source roots.
use parking_lot::Mutex;
use std::sync::Arc;

use crate::typst_world::{self, SimpleWorld};

#[derive(Default)]
pub struct TypstCompiler {
    world: Mutex<Option<SimpleWorld>>,
}

impl TypstCompiler {
    async fn render<T: Send + 'static>(
        self: Arc<Self>,
        source: String,
        doc_path: Option<String>,
        render: fn(&SimpleWorld) -> Result<T, String>,
    ) -> Result<T, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let mut guard = self.world.lock();
            if guard.is_none() {
                *guard = Some(SimpleWorld::new().map_err(|error| format!("init: {error}"))?);
            }
            let world = guard.as_mut().expect("world initialized above");
            world.set_root_from_doc(doc_path.as_deref());
            world.set_source(source);
            render(world)
        })
        .await
        .map_err(|error| format!("Typst worker failed: {error}"))?
    }

    pub async fn svg(self: Arc<Self>, source: String, doc_path: Option<String>) -> Result<String, String> {
        self.render(source, doc_path, typst_world::compile_to_svg).await
    }

    pub async fn pdf(self: Arc<Self>, source: String, doc_path: Option<String>) -> Result<Vec<u8>, String> {
        self.render(source, doc_path, typst_world::compile_to_pdf).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn exports_svg_and_pdf_in_background() {
        let compiler = Arc::new(TypstCompiler::default());
        assert!(compiler.clone().svg("= Preview".into(), None).await.unwrap().contains("<svg"));
        assert!(compiler.pdf("= Export".into(), None).await.unwrap().starts_with(b"%PDF-"));
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
        let path = Some(dir.path().join("main.typ").to_string_lossy().into_owned());
        assert!(compiler.clone().svg(source.clone(), path).await.is_ok());
        assert!(compiler.svg(source, None).await.is_err());
    }

    #[tokio::test]
    async fn failed_compile_does_not_poison_next_request() {
        let compiler = Arc::new(TypstCompiler::default());
        assert!(compiler.clone().svg("#missing-function()".into(), None).await.is_err());
        assert!(compiler.svg("Recovered".into(), None).await.is_ok());
    }
}

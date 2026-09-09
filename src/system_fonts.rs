//! Font families installed on this machine, not Typst's embedded assets.
use std::collections::BTreeSet;

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let names: BTreeSet<String> = db.faces()
            .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
            .collect();
        let mut names: Vec<_> = names.into_iter().collect();
        names.sort_by_key(|name| name.to_lowercase());
        names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        names
    }).await.map_err(|error| error.to_string())
}
